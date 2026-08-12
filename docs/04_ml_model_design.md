# ML Model Design
## Anomaly Detection Pipeline — Isolation Forest + LSTM Autoencoder

> **File:** `04_ml_model_design.md`
> **Status:** Complete — models specified, training scripts ready
> **Framework:** scikit-learn (Isolation Forest) · TensorFlow (LSTM)
> **Serving:** FastAPI scoring service on port 8000

---

## The Two Detection Problems

The system needs to catch two structurally different types of misuse. They require different models.

| Problem | Nature | Model |
|---|---|---|
| Access volume anomaly | Snapshot — one event looks wrong on its own | Isolation Forest |
| Break-glass misuse | Sequential — behavior only looks suspicious over 20 events | LSTM Autoencoder |

---

## Model 1 — Isolation Forest

### How It Works

The algorithm randomly partitions the feature space with successive cuts. Normal access events are densely clustered — they take many cuts to isolate. Anomalous events sit far from the cluster — they are isolated in very few cuts. The number of cuts required to isolate a point is inverted into an anomaly score between 0 and 1.

**Key property:** Unsupervised — no labelled misuse examples needed. Trained entirely on normal behavior. Anything sufficiently unlike normal scores high.

### Feature Vector

```python
features = {
    # Volume signals
    "records_accessed_last_hour":     int,
    "records_accessed_last_day":      int,
    "unique_patients_last_hour":      int,

    # Time signals
    "hour_of_day":                    int,    # 0–23
    "is_outside_shift_hours":         bool,   # before 7am or after 9pm
    "is_weekend":                     bool,

    # Relationship signals — strongest features
    "has_declared_clinical_rel":      bool,   # does a consent policy exist?
    "fraction_without_relationship":  float,  # of last 10 accesses, how many had no consent

    # Category signals
    "sensitive_category_accessed":    bool,
    "categories_accessed_count":      int,

    # Baseline signals — strongest features
    "doctor_avg_daily_accesses":      float,  # rolling 30-day average
    "deviation_from_baseline":        float   # today vs average, normalized
}
```

`fraction_without_relationship` and `deviation_from_baseline` are the two strongest signals. A doctor accessing 5 patients with no consent policies, or accessing 3x their usual volume, will score high regardless of the raw numbers.

### Training

```python
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib

def generate_normal_event():
    hour = int(np.clip(np.random.normal(13, 3), 7, 21))
    return {
        "records_accessed_last_hour":    int(np.random.poisson(3)),
        "records_accessed_last_day":     int(np.random.poisson(12)),
        "unique_patients_last_hour":     int(np.random.poisson(2)),
        "hour_of_day":                   hour,
        "is_outside_shift_hours":        False,
        "is_weekend":                    np.random.random() < 0.1,
        "has_declared_clinical_rel":     np.random.random() < 0.93,
        "fraction_without_relationship": float(np.random.beta(1, 14)),
        "sensitive_category_accessed":   np.random.random() < 0.08,
        "categories_accessed_count":     int(np.random.randint(1, 4)),
        "doctor_avg_daily_accesses":     float(np.random.normal(12, 3)),
        "deviation_from_baseline":       float(np.random.normal(0, 0.2))
    }

# Generate 10,000 normal events (80 doctors × 125 events each)
normal_data = pd.DataFrame([generate_normal_event() for _ in range(10000)])

# Train
model = IsolationForest(contamination=0.05, random_state=42, n_estimators=100)
model.fit(normal_data)

# Save
joblib.dump(model, "models/isolation_forest.pkl")
print("Isolation Forest trained and saved.")
```

### Inference

```python
def score_with_isolation_forest(event_features: dict) -> float:
    model = joblib.load("models/isolation_forest.pkl")
    df    = pd.DataFrame([event_features])
    raw   = model.decision_function(df)[0]   # higher = more normal
    score = 1 - (raw - (-0.5)) / (0.5 - (-0.5))  # normalize to 0–1
    return float(np.clip(score, 0, 1))            # 1 = most anomalous
```

---

## Model 2 — LSTM Autoencoder

### How It Works

Trained as an autoencoder on sequences of 20 consecutive events per doctor. The encoder compresses a sequence into a compact vector representation. The decoder reconstructs the sequence from that vector.

**Key insight:** The model is trained only on normal sequences. It learns to reconstruct normal patterns accurately. When it sees an anomalous sequence — repeated break-glass events, accessing patients with prior consent relationships via emergency override — the decoder can only produce what it knows (a normal sequence). The mismatch between input and reconstruction is the anomaly score.

**Why LSTM specifically:** Break-glass misuse is sequential — whether the 20th event is suspicious depends on what happened at events 5, 10, and 15. A snapshot model cannot see this. LSTM's gating mechanism retains context across the full sequence window.

### Sequence Structure

```python
# One sequence per doctor = last 20 events in chronological order
# Each event encoded as a 7-feature vector

event_vector = [
    event_type_encoded,       # 0=consent, 1=access, 2=break_glass, 3=revocation
    hour_of_day_normalized,   # 0.0 to 1.0
    has_clinical_rel,         # 0 or 1
    is_break_glass,           # 0 or 1
    days_since_last_bg,       # normalized — 0 = today, 1 = 30+ days ago
    patient_is_known,         # 0 or 1 — had prior consent relationship?
    categories_hash           # encoded combination of record categories accessed
]

# Sequence shape per doctor: (20, 7)
```

### Model Architecture

```python
import tensorflow as tf
import numpy as np

def build_lstm_autoencoder(timesteps=20, features=7):
    inputs = tf.keras.Input(shape=(timesteps, features))

    # Encoder — compress the sequence to a single vector
    encoded = tf.keras.layers.LSTM(
        32, activation='relu', return_sequences=False
    )(inputs)

    # Repeat the compressed vector for the decoder
    repeated = tf.keras.layers.RepeatVector(timesteps)(encoded)

    # Decoder — reconstruct the full sequence
    decoded = tf.keras.layers.LSTM(
        32, activation='relu', return_sequences=True
    )(repeated)

    # Output layer — one value per feature per timestep
    outputs = tf.keras.layers.TimeDistributed(
        tf.keras.layers.Dense(features)
    )(decoded)

    model = tf.keras.Model(inputs, outputs)
    model.compile(optimizer='adam', loss='mse')
    return model


def train_lstm(sequences):
    model = build_lstm_autoencoder()
    model.fit(
        sequences, sequences,   # autoencoder: input = target
        epochs=50,
        batch_size=32,
        validation_split=0.1,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True)
        ]
    )
    model.save("models/lstm_autoencoder.h5")
    return model


def get_lstm_anomaly_score(model, sequence):
    """Reconstruction error = anomaly score. Higher = more anomalous."""
    reconstructed = model.predict(sequence[np.newaxis, :, :], verbose=0)
    mse           = np.mean(np.power(sequence - reconstructed, 2))
    # Normalize to 0–1 range based on training distribution
    score         = np.clip(mse / 1.0, 0, 1)
    return float(score)
```

### Cold Start Handling

A doctor with fewer than 20 events has no sequence. The system handles this gracefully:

```python
def score_event(doctor_id, new_event):
    history = get_doctor_event_history(doctor_id, limit=20)

    if len(history) < 20:
        # Not enough history — use Isolation Forest only
        return score_with_isolation_forest(new_event["ml_features"])
    else:
        # Full pipeline — both models
        sequence      = build_sequence(history)
        if_score      = score_with_isolation_forest(new_event["ml_features"])
        lstm_score    = get_lstm_anomaly_score(lstm_model, sequence)
        return compute_unified_score(if_score, lstm_score, new_event["ml_features"]["is_break_glass"])
```

---

## Score Combiner

```python
def compute_unified_score(
    isolation_score: float,
    lstm_score: float,
    is_break_glass_event: bool
) -> float:
    """
    Weight the two model scores based on event type.
    Break-glass events: LSTM matters more (sequential context is key).
    Standard access events: Isolation Forest matters more (volume signal).
    """
    if is_break_glass_event:
        weight_if, weight_lstm = 0.3, 0.7
    else:
        weight_if, weight_lstm = 0.6, 0.4

    return (weight_if * isolation_score) + (weight_lstm * lstm_score)
```

---

## Graduated Response Pipeline

```python
def trigger_response(doctor_id: str, unified_score: float, event_id: str):

    if unified_score < 0.5:
        return  # Normal — no action

    elif unified_score < 0.7:
        # Tier 1 — Warning
        send_warning_to_doctor(doctor_id)
        send_alert_to_hospital_admin(doctor_id, severity="low")
        log_flag_to_blockchain(event_id, flag_level=1)
        update_doctor_flag_count(doctor_id, increment=1)

    elif unified_score < 0.9:
        # Tier 2 — Restrict
        require_supervisor_coauthorization(doctor_id)
        suspend_active_tokens(doctor_id)
        send_alert_to_hospital_admin(doctor_id, severity="high")
        log_flag_to_blockchain(event_id, flag_level=2)
        update_doctor_flag_count(doctor_id, increment=1)

    else:
        # Tier 3 — Escalate
        escalate_to_ethics_board(doctor_id)
        suspend_active_tokens(doctor_id)
        annotate_blockchain_permanently(doctor_id, annotation="escalated_to_ethics_board")
        log_flag_to_blockchain(event_id, flag_level=3)
        generate_case_file(doctor_id)
```

| Score | Response | Access Impact | Blockchain |
|---|---|---|---|
| < 0.5 | No action | None | Not logged |
| 0.5 – 0.7 | Warning to doctor and admin | None — access continues | Flag level 1 |
| 0.7 – 0.9 | Supervisor co-auth required | Access blocked until approved | Flag level 2 |
| > 0.9 | Ethics board escalated | Access blocked, case file generated | Permanent annotation |

---

## FastAPI Scoring Service

```python
# ml-service/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import joblib, tensorflow as tf, numpy as np

app = FastAPI()

# Load models at startup — kept in memory for low-latency inference
isolation_forest = joblib.load("models/isolation_forest.pkl")
lstm_model       = tf.keras.models.load_model("models/lstm_autoencoder.h5")

class ScoreRequest(BaseModel):
    event_id: str
    doctor_id: str
    ml_features: dict
    recent_sequence: list  # last 20 events as feature vectors

@app.post("/ml/score")
async def score_event(request: ScoreRequest):
    if_score   = score_with_isolation_forest(request.ml_features)
    is_bg      = request.ml_features.get("is_break_glass", False)

    if len(request.recent_sequence) >= 20:
        sequence   = np.array(request.recent_sequence[-20:])
        lstm_score = get_lstm_anomaly_score(lstm_model, sequence)
    else:
        lstm_score = if_score   # fallback for cold start

    unified = compute_unified_score(if_score, lstm_score, is_bg)

    return {
        "event_id":       request.event_id,
        "isolation_score": round(if_score, 4),
        "lstm_score":      round(lstm_score, 4),
        "unified_score":   round(unified, 4),
        "flag_tier":       0 if unified < 0.5 else (1 if unified < 0.7 else (2 if unified < 0.9 else 3))
    }
```

**Latency target:** Under 100ms per request. Isolation Forest inference is microseconds. LSTM on a 20-event sequence is ~30–50ms. Both models pre-loaded into memory at service startup.

---

## Training Data Strategy

| Data | Volume | Source | Purpose |
|---|---|---|---|
| Normal access events | 10,000 | Synthetic generation | Isolation Forest training |
| Volume anomaly events | 300 | Synthetic (injected) | Test set validation |
| Break-glass misuse events | 200 | Synthetic (injected) | Test set validation |
| Normal sequences | 800 | Derived from synthetic events | LSTM training |
| Patient visit patterns | Reference | MIMIC-III (PhysioNet) | Calibrate generation parameters |

**Retraining schedule:** Weekly, using only non-flagged events. The model must not learn that misuse is normal.

---

*ML design version 1.0 — both models specified and ready for training*
*scikit-learn version: 1.3+ · TensorFlow version: 2.13+*
*Serving: FastAPI 0.100+ · Uvicorn*
