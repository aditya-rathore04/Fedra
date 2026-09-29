# Current State of System

> **Last Updated:** 2026-09-07 (Session 3)  
> **Current Phase:** Phase 1 (Foundation and Infrastructure) — Milestone Achieved; Phase 2 Seed Data Ready  
> **Target Milestone:** Transition to Phase 2 (Core Access Control & Consent Service)

---

## 🚦 High-Level Component Health

| Component | Status | Location / Port | Notes |
|---|---|---|---|
| **Docker Engine** | 🟢 Running | Localhost | Docker Desktop active, 7 containers up |
| **HAPI FHIR Node 1 (Apollo)** | 🟢 Up | `localhost:8081/fhir` | Spring Boot active, Synthea bundles loaded |
| **HAPI FHIR Node 2 (Fortis)** | 🟢 Up | `localhost:8082/fhir` | Spring Boot active, Synthea bundles loaded |
| **HAPI FHIR Node 3 (Max)** | 🟢 Up | `localhost:8083/fhir` | Spring Boot active, Synthea bundles loaded |
| **MongoDB Hospital 1-3** | 🟢 Up | Ports `27017`, `27018`, `27019` | Local hospital persistence containers |
| **MongoDB System Central** | 🟢 Up | `localhost:27020` | Contains `system_db` & `registry_db` |
| **Backend Gateway** | 🟢 Spec-Compliant | `localhost:3000` | Express gateway in `backend/index.js` with RBAC and JWT validation. |
| **Identity Service (Auth / JWT)** | 🟢 Spec-Compliant | `backend/index.js` | Contract `C-01` verified, role lifetimes, `/auth/refresh`, registration endpoints active. |
| **Doctor Portal (Frontend)** | 🟢 Working Prototype | `frontend/index.html`, `dashboard.html` | Login redirect, ABHA discovery query & card layout verified. |
| **Patient Seed Data Spec** | 🟢 Production-Ready | `06_patient_seed_data_spec.md` | Fully specified 6 Indian patients, doctor roster, sensitive gates & schemas. |
| **Consent Service** | 🟢 Spec-Compliant | `backend/index.js` | MongoDB `consent_policies` & `access_tokens`, C-02 <50ms cache, grant/revoke/sensitive active. |
| **Federated Record Aggregator** | 🟢 Spec-Compliant | `POST /records/fetch` | Parallel FHIR cross-node queries across Apollo/Fortis/Max (C-08 SLA), sensitive category privacy gates. |
| **Patient Browser App (Workaround)** | 🟢 Working Prototype | `frontend/patient.html` | Centered mobile phone mockup, inbox, approval sheet, active consents, instant revoke, self-timeline. |
| **Doctor Portal (Frontend)** | 🟢 Interactive Deep Viewer | `frontend/dashboard.html` | Access request modal, live token timer, clickable clinical drawer with diagnostic findings, LOINC/SNOMED codes, attending doctors, and raw FHIR R4 JSON inspection. |
| **Blockchain Audit Log** | ⚪ Not Started | Spec: `docs/02` | Contract written; Hardhat/Ganache deployment planned for Phase 3 |
| **ML Anomaly Detection** | ⚪ Not Started | Spec: `docs/04` | FastAPI scoring service planned for Phase 4 |
| **Patient Mobile App (Native Flutter)** | ⚪ Deferred (Workaround Active) | `patient_app/` | Browser mobile mockup active in `patient.html`; Flutter app build scheduled after demo. |

---

## 📋 Task Status

### ✅ Completed
- [x] Multi-container Docker compose environment configured with 3 HAPI FHIR nodes and 4 MongoDB databases.
- [x] Ingestion & synthetic data seeding pipeline (`scripts/seed_and_load.js`) loaded 30 Synthea patient files into FHIR nodes.
- [x] Seeded central directory `system-mongo:27020` (`system_db.users`, `registry_db.registry_entries`).
- [x] Implemented spec-compliant Contract `C-01` JWT Identity Service:
  - Strict payload: `{ user_id, role, institution_id, issued_at, expires_at }`.
  - Role lifetimes: Doctor (8h), Patient (24h), Admin (4h), Emergency (2h).
  - Password hashing with `bcrypt` & verification.
  - Endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/register/doctor`, `POST /auth/register/patient`.
- [x] Gateway security & RBAC: `verifyJWT` and `requireRole` middleware.
- [x] Discovery Service spec alignment:
  - `GET /patient/search?health_id=...` formatted per `docs/05`.
  - `POST /registry/register` endpoint to index record pointers.
- [x] Automated Phase 1 verification suite (`scripts/test_phase1_jwt.js`) passing 33/33 tests.
- [x] Doctor Portal UI verified with new gateway auth.
- [x] **Realistic Indian Patient Cohort & Multi-Hospital Seeding Specification (`06_patient_seed_data_spec.md`)**:
  - Re-aligned hospital topology to Apollo (`HOSP-1`), Fortis (`HOSP-2`), and Max (`HOSP-3`).
  - Added full Master Doctor & Practitioner Directory across FHIR and MongoDB.
  - Formalized sensitive data access architecture (multi-gate consent, FHIR security labels, break-glass lockdown invariant).
  - Specified clinical coding (SNOMED-CT, LOINC, RxNorm, CVX) and transaction bundle schemas for teammate handoff.
- [x] **Indian Cohort Seeding & End-to-End Verification**:
  - Implemented `scripts/seed_indian_patients.js` following `06_patient_seed_data_spec.md`.
  - All 6 Indian patients and 12 practitioners seeded into FHIR nodes (ports 8081, 8082, 8083).
  - 10 registry entries indexed in `registry_db.registry_entries`, with sensitive categories correctly flagged.
  - Automated verification suite `scripts/test_indian_patients.js` (45/45 tests passing across FHIR, Mongo, Gateway, RBAC).
- [x] **Phase 2 Implementation (Core Access Control, Consent Service & Federated Aggregator)**:
  - Designed and indexed MongoDB collections `system_db.consent_policies`, `system_db.access_tokens`, and `system_db.notifications`.
  - Implemented in-memory token cache achieving `<50ms` validation latency SLA (Contract `C-02` p95 SLA, tested at ~2ms).
  - Implemented Consent Service endpoints: `POST /consent/request`, `GET /consent/pending`, `GET /consent/active`, `POST /consent/grant`, `POST /consent/deny`, `POST /consent/revoke`, `POST /consent/sensitive`, `GET /consent/validate`.
  - Implemented Federated Record Aggregator (`POST /records/fetch`) querying Apollo (`:8081`), Fortis (`:8082`), and Max (`:8083`) in parallel with 3000ms timeout budget (Contract `C-08`).
  - Implemented granular multi-gate sensitive filtering stripping psychiatric (`PSY`), reproductive (`SEX`), and substance abuse (`ETH`) records unless specifically authorized by patient.
  - Implemented Patient Self-Timeline endpoint (`GET /records/patient`) for cross-hospital records viewing.
  - Created automated Phase 2 test suite `scripts/test_phase2_consent.js` (48/48 tests passing).
  - Enhanced Doctor Portal (`frontend/dashboard.html`) with access request modal, live token timer, and clinical record viewer.
  - Built Browser-based Patient App workaround (`frontend/patient.html`) featuring a smartphone mockup frame, instant inbox polling, granular approval sheet, dynamic sensitive category toggles, and instant revocation.

### 🔧 In Progress
- [ ] Phase 3 Planning: Blockchain Audit Log deployment (Ganache/Hardhat, smart contract audit hash chaining C-04/C-05).

### ⛔ Blocked / Critical Attention
- None.

---

## 🎯 Next Tasks for Coding Agent
1. **Phase 3 Blockchain Audit Service**:
   - Set up local Ethereum/Hardhat node.
   - Compile and deploy `AuditLog.sol` per `docs/02_smart_contract.md`.
   - Wire Audit Service in `backend/index.js` to log access events with canonical JSON serialization (`C-05`).

