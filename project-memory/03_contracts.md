# Cross-Service Boundary Contracts

Cross-service contracts represent binding operational interfaces between services in the Federated EHR system.
Breaking any contract will cause silent failures across service boundaries.

---

## Summary Table

| ID | Contract | Scope | Source | Status |
|---|---|---|---|---|
| `C-01` | JWT Identity Token Payload | Gateway ↔ All Services | `docs/05 §JWT` | **LOCKED** |
| `C-02` | Token Validation Latency SLA (<50ms) | Gateway / Consent Service | `phases §Risks` | **LOCKED** |
| `C-03` | MongoDB `audit_events` with Embedded `ml_features` | Audit ↔ ML Service | `docs/01`, `docs/04` | **LOCKED** |
| `C-04` | Break-Glass Event Hash Chaining (`linked_event_id`) | Audit Service ↔ Smart Contract | `docs/02` | **LOCKED** |
| `C-05` | Deterministic `metadataHash` Serialization | Backend ↔ Smart Contract | `docs/02` | **LOCKED** |
| `C-06` | ML Score Combiner Weights (Break-Glass vs Standard) | ML Scoring Pipeline | `docs/04` | **LOCKED** |
| `C-07` | Graduated Response Policy Thresholds (0.5 / 0.7 / 0.9) | ML Service ↔ Consent Gateway | `docs/04` | **LOCKED** |
| `C-08` | Parallel FHIR Cross-Node Query Timeout (3000ms) | Backend Aggregator ↔ FHIR Nodes | `phases §Risks` | **LOCKED** |

---

## Contract Specifications

### `C-01`: JWT Identity Token Payload
- **Issuer:** Identity Service (`/auth/login`)
- **Consumer:** API Gateway (`verifyJWT`)
- **Required Claims Schema:**
  ```json
  {
    "user_id": "DOC-uuid",
    "role": "doctor | patient | lab_technician | hospital_admin | doctor_supervisor | system_admin | emergency",
    "institution_id": "HOSP-BLR-002",
    "issued_at": 1700000000,
    "expires_at": 1700028800
  }
  ```
- **Lifetimes:** Doctor: 8h · Patient: 24h · Lab Tech: 8h · Admin: 4h · Break-Glass: 2h
- **Violation:** Adding arbitrary unstructured fields or changing field types causes gateway authorization failure.

### `C-02`: Token Validation Latency SLA (<50ms)
- **Rule:** Every record request must validate the bearer token against revocation lists or active DB policies in under 50ms (p95).
- **Enforcement:** If validation exceeds 50ms, the Consent Service must implement an in-memory Redis or LRU cache for active token states.

### `C-03`: `audit_events` Schema & Pre-computed `ml_features`
- **Producer:** Audit Service (on every access/break-glass event)
- **Consumer:** ML Scoring Service (`POST /score`)
- **Required Schema Elements:**
  ```json
  {
    "event_id": "UUID-v4",
    "timestamp": "ISODate",
    "event_type": "record_access | break_glass_declared | token_issued | consent_revoked",
    "actor": { "id": "DOC-1", "role": "doctor", "institution_id": "HOSP-1" },
    "patient": { "health_id": "ABHA-DEMO-001" },
    "ml_features": {
      "records_accessed_last_hour": 3,
      "records_accessed_last_day": 12,
      "unique_patients_last_hour": 2,
      "hour_of_day": 14,
      "is_outside_shift_hours": false,
      "is_weekend": false,
      "has_declared_clinical_rel": true,
      "fraction_without_relationship": 0.05,
      "sensitive_category_accessed": false,
      "categories_accessed_count": 2,
      "doctor_avg_daily_accesses": 12.0,
      "deviation_from_baseline": 0.1
    }
  }
  ```

### `C-04`: Break-Glass Hash Chain (`linked_event_id`)
- **Rule:** Break-glass emergency requests and extensions must form a cryptographic back-linked chain:
  - Initial emergency declaration: `linked_event_id = bytes32(0)`
  - Extension 1: `linked_event_id = keccak256(initial_event_id)`
  - Extension 2: `linked_event_id = keccak256(extension_1_event_id)`
- **Verification:** The patient mobile app verifies the complete chain from the smart contract `patientEventChain(patientHash)`.

### `C-05`: Strict `metadataHash` Serialization
- **Rule:** The smart contract stores `metadataHash` as:
  $$\text{metadataHash} = \text{keccak256}(\text{canonicalJSON}(mongoDocument))$$
- **Canonical Serialization Rule:**
  - JSON keys must be sorted alphabetically before hashing.
  - No whitespace between delimiters (`{"a":1,"b":2}`).
  - Both writer (Audit Service) and verifier (Patient App / Audit Verifier) must use identical canonical JSON serialization.

### `C-06`: ML Score Combiner Weights
- **Pipeline:**
  $$\text{Final Score} = w_1 \cdot S_{\text{IF}} + w_2 \cdot S_{\text{LSTM}}$$
- **Fixed Weights:**
  - **Break-Glass Events:** $w_{\text{LSTM}} = 0.70$, $w_{\text{IF}} = 0.30$ (Sequential pattern is dominant signal).
  - **Standard Access Events:** $w_{\text{IF}} = 0.60$, $w_{\text{LSTM}} = 0.40$ (Volume anomaly is dominant signal).
  - **Cold-Start (<20 historical events for actor):** $w_{\text{IF}} = 1.0$, $w_{\text{LSTM}} = 0.0$.

### `C-07`: Graduated Response Policy Thresholds
- **Threshold 1 ($S \ge 0.50$):** `WARN` — Log warning audit event, show non-blocking visual prompt to clinician.
- **Threshold 2 ($S \ge 0.70$):** `RESTRICT` — Restrict token scope to non-sensitive categories (vital signs/allergies only); notify supervisor.
- **Threshold 3 ($S \ge 0.90$):** `ESCALATE` — Immediately revoke active access token, freeze doctor session, alert supervisor and security officers.

### `C-08`: Parallel FHIR Query Timeout Budget
- **Rule:** Queries across distributed hospital FHIR nodes (e.g. Apollo, Fortis, Max) must execute in parallel (`Promise.allSettled`).
- **Timeout:** 3000ms max per node. If a node times out, the gateway marks that node as `degraded` in the response and returns partial records with an alert rather than failing the entire request.
