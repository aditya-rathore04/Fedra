# System Architecture
## Federated Medical Record Discovery and Secure Access System

> **File:** `00_system_architecture.md`
> **Status:** Complete — all layers designed and documented
> **Read this first — it links to all other spec files**

---

## Design Philosophy

> *"Hospitals own the records. Patients own the permissions. The system owns nothing."*

The system is a **discovery and access layer**, not a storage layer. Clinical records never move to a central location. Each hospital retains full custody of its own data. The system controls who can see what, logs every access permanently, and monitors for misuse.

---

## The Five Pillars

| Pillar | What It Does | Spec File |
|---|---|---|
| Federated architecture | No central database — hospitals keep their own records | This file |
| FHIR-based record discovery | HL7 FHIR R4 standardizes how records are retrieved across institutions | `01_database_schema.md` |
| Context-aware access control | Token-based consent, break-glass emergency access, sensitive category gates | `05_api_service_design.md` |
| Ethereum blockchain audit | Every access event logged immutably — tamper-evident via hash verification | `02_smart_contract.md` |
| ML anomaly detection | Isolation Forest + LSTM continuously monitor all access for misuse | `04_ml_model_design.md` |

---

## Six-Tier Architecture

```
┌─────────────────────────────────────────────────────────┐
│  CLIENTS                                                │
│  Doctor portal (React)  Patient app (Flutter)  Admin   │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────┐
│  API GATEWAY  (Node.js :3000)                           │
│  JWT auth · Role check · Rate limiting · Routing        │
└──┬────────┬────────┬────────┬────────┬──────────────────┘
   │        │        │        │        │
┌──▼──┐ ┌──▼──┐ ┌──▼──┐ ┌──▼──┐ ┌──▼──┐
│IDEN-│ │DISC-│ │CON- │ │NOTI-│ │AUDIT│   SERVICES
│TITY │ │OVERY│ │SENT │ │FIED │ │     │
│ABHA │ │Reg. │ │Tok. │ │Push │ │Evts │
│JWT  │ │FHIR │ │BG   │ │SMS  │ │Flgs │
└──┬──┘ └──┬──┘ └──┬──┘ └─────┘ └──┬──┘
   │        │        │               │
┌──▼──┐ ┌──▼──┐ ┌──▼──┐         ┌──▼──────────┐
│HSP  │ │DISC │ │CONS │         │ AUDIT DB    │   DATA
│NODES│ │DB   │ │DB   │         │ audit_events│
│FHIR │ │Reg. │ │Tok. │         └──┬──────────┘
│Mongo│ │Idx  │ │Pol. │            │
└─────┘ └─────┘ └─────┘            │ async
                                    ▼
                         ┌──────────────────────┐
                         │  ETHEREUM (Ganache)  │  BLOCKCHAIN
                         │  MedicalAuditLog.sol │
                         │  On-chain hashes     │
                         │  Verify endpoint     │
                         └──────────────────────┘
                                    ▲
                         ┌──────────┴───────────┐
                         │  ML SERVICE          │  ML
                         │  Isolation Forest    │
                         │  LSTM Autoencoder    │
                         │  Score combiner      │
                         │  Warn/Restrict/Esc.  │
                         └──────────────────────┘
```

---

## Three Data Domains

| Database | Instance | Owner | Contains |
|---|---|---|---|
| `hospital1_db` | `hospital1-mongo:27017` | Hospital 1 | Record metadata, patient demographics, FHIR pointers |
| `hospital2_db` | `hospital2-mongo:27018` | Hospital 2 | Same |
| `hospital3_db` | `hospital3-mongo:27019` | Hospital 3 | Same |
| `registry_db` | `system-mongo:27020` | System | Discovery index — where records exist |
| `system_db` | `system-mongo:27020` | System | Consent policies, access tokens, audit events, users |

Full schema: → `01_database_schema.md`

---

## Access Control Model

### Standard Access Flow

```
Doctor logs in → JWT issued
Doctor searches patient → Discovery Service returns institution list (no content)
Doctor requests access → Consent Service creates pending request
Patient notified → Patient approves via app
Consent policy created → Access token issued (8hr default)
Doctor fetches records → Token validated → FHIR queried → Records returned
Audit Service logs event → ML Service scores → Blockchain tx submitted async
Token expires → Consent policy remains dormant for next visit
```

### Break-Glass Emergency Flow

```
Emergency staff triggers break-glass with justification
Immediate 2hr token issued — patient safety not held hostage to approval
Critical categories only — allergies, blood type, medications, chronic conditions
Sensitive categories (psychiatric, HIV) remain locked
Patient and caregiver notified in real time
Blockchain logs trigger event immediately

Supervisor model (three layers):
  Layer 1 — Automated rule engine: approves routine extensions (~70-80% of cases)
  Layer 2 — Hospital doctor-supervisor: reviews flagged cases, 15min SLA
  Layer 3 — Ethics board: cross-institution events, repeated misuse, 2hr SLA

Token expiry options:
  Branch A — Upfront long window: 4hr, 8hr, 12hr options, routed to supervisor
  Branch B — Pre-expiry extension: soft warning at 90min, access continues during review
  Branch C — Post-expiry reinstatement: 15min grace (read-only), access suspended during review
```

Full API spec: → `05_api_service_design.md`

---

## Blockchain Audit Design

Every significant event is logged twice:
1. **MongoDB** — fast, queryable, human-readable (synchronous)
2. **Ethereum** — immutable hash proof (asynchronous, non-blocking)

Tamper detection: `keccak256(JSON.stringify(mongoDocument))` compared against stored `metadataHash` on-chain. Mismatch = tampering detected.

Break-glass event chain: All related events linked via `linkedEventId` → complete chain reconstructable via `getPatientChain()`.

Full contract: → `02_smart_contract.md`

---

## ML Anomaly Detection Design

Two models, one pipeline:

```
Every audit event write
        │
        ▼
  Feature extraction (from ml_features fields pre-computed at write time)
        │
   ┌────┴────┐
   │         │
   ▼         ▼
Isolation  LSTM
Forest     Autoencoder
(snapshot) (sequence of 20)
   │         │
   └────┬────┘
        │
   Score combiner
   (weights by event type)
        │
        ▼
   Unified score 0.0–1.0
        │
   ┌────┼────┐
   │    │    │
 <0.5 0.5  0.7   >0.9
  No  Warn Rest  Escalate
```

Full model design: → `04_ml_model_design.md`

---

## Demo Environment

Three hospital nodes simulated by three HAPI FHIR containers on different ports. Federated architecture is real — only the network separation is simulated.

Full container setup: → `03_docker_environment.md`

---

## Technology Stack

| Layer | Technology |
|---|---|
| Doctor / admin portal | React.js |
| Patient mobile app | Flutter |
| API gateway + core services | Node.js |
| ML scoring service | Python FastAPI |
| Clinical record storage | HAPI FHIR R4 |
| Metadata and system databases | MongoDB 7 |
| Blockchain | Ethereum + Solidity (Hardhat) |
| Blockchain bridge | Ethers.js |
| ML — access anomaly | scikit-learn Isolation Forest |
| ML — sequential misuse | TensorFlow LSTM Autoencoder |
| Containerization | Docker + Docker Compose |
| Push notifications | Firebase Cloud Messaging |
| Local blockchain | Ganache (deterministic mode) |

---

## Implemented vs Placeholder

| Feature | Status |
|---|---|
| Database schemas | ✅ Complete — implementation ready |
| Smart contract (Solidity) | ✅ Written — deployed to Ganache |
| Docker environment | ✅ Complete — all containers specified |
| ML model design | ✅ Complete — training scripts ready |
| API service design | ✅ Complete — all endpoints defined |
| Environment running | 🔄 In progress |
| Synthea data loaded | 🔄 In progress |
| Backend services coded | ⏳ Phase 2 |
| Break-glass flows | ⏳ Phase 3 |
| ML training + scoring | ⏳ Phase 4 |
| End-to-end demo | ⏳ Phase 5 |
| Drug interaction flag | 🔲 Planned — "coming soon" placeholder |
| Wearable integration | 🔲 Planned — UI placeholder only |

---

*Architecture version 1.0*
*All design decisions locked — implementation underway*
*Next conversation: Phase 1 implementation — Identity Service and Discovery Service coding*
