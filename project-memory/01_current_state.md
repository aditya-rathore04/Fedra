# Current State of System

> **Last Updated:** 2026-10-07 (Session 11)  
> **Current Phase:** Phase 3 (Break-Glass Emergency Access & Blockchain Audit Trail) — Sprint 2 Complete  
> **Target Milestone:** Phase 3 Sprint 3 (Blockchain Audit Log Node Deployment & On-Chain Anchoring)

---

## 🚦 High-Level Component Health

| Component | Status | Location / Port | Notes |
|---|---|---|---|
| **Docker Engine** | 🟢 Running | Localhost | Docker Desktop active, 7 containers up |
| **HAPI FHIR Node 1 (Apollo)** | 🟢 Up | `localhost:8081/fhir` | Spring Boot active, Serial GC + `-Xmx384m`, Indian cohort loaded, `mem_limit: 480m` |
| **HAPI FHIR Node 2 (Fortis)** | 🟢 Up | `localhost:8082/fhir` | Spring Boot active, Serial GC + `-Xmx384m`, Indian cohort loaded, `mem_limit: 480m` |
| **HAPI FHIR Node 3 (Max)** | 🟢 Up | `localhost:8083/fhir` | Spring Boot active, Serial GC + `-Xmx384m`, Indian cohort loaded, `mem_limit: 480m` |
| **MongoDB Hospital 1-3** | 🟢 Up | Ports `27017`, `27018`, `27019` | WiredTiger cache capped at 256MB, `mem_limit: 220m` |
| **MongoDB System Central** | 🟢 Up | `localhost:27020` | WiredTiger cache capped at 256MB, `mem_limit: 220m` |
| **Backend Gateway** | 🟢 Spec-Compliant | `localhost:3000` | Express gateway in `backend/index.js` with RBAC and JWT validation. |
| **Identity Service (Auth / JWT)** | 🟢 Spec-Compliant | `backend/index.js` | Contract `C-01` verified, role lifetimes, `/auth/refresh`, registration endpoints active. |
| **Consent & Break-Glass Service** | 🟢 Spec-Compliant | `backend/index.js` | Full break-glass declaration, 2h tokens, 3/hr rate limit, caregiver notifications, Safe Harbor. |
| **Federated Record Aggregator** | 🟢 Spec-Compliant | `POST /records/fetch` | Parallel FHIR queries (C-08), strict sensitive category lockdown invariant under break-glass. |
| **Audit Trail Service** | 🟢 Spec-Compliant | `GET /audit/patient/:id` | Contract C-04 hash chain genesis link, C-03 pre-computed ML features, patient privacy RBAC. |
| **Doctor Portal (Frontend)** | 🟢 Interactive Deep Viewer | `frontend/dashboard.html` | Access request modal, live token timer, clinical drawer with findings, codes & FHIR inspection. |
| **Patient Browser App (Workaround)** | 🟢 All 6 Patients Synced | `frontend/patient.html` | Smartphone mockup frame, all 6 Indian patients, inbox, approval sheet, sensitive toggles, self-timeline. |
| **Blockchain Audit Log** | ⚪ In Progress | Spec: `docs/02` | `AuditLog.sol` ready; Hardhat node and C-05 anchor pipeline scheduled for Sprint 2 |
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
- [x] **Ultra-Lean Docker Memory Optimization & Synthea Purge**:
  - Removed bloated Synthea synthetic datasets (purged ~3,000 resources) in favor of exclusively hosting the Indian patient cohort (~172 resources across 3 hospitals).
  - Switched HAPI FHIR JVM to Serial GC (`-XX:+UseSerialGC`) eliminating native GC metadata overhead, capped heap at `-Xmx384m -Xms128m`, capped Tomcat worker threads to 20, and set hard container limit `mem_limit: 480m`.
  - Tuned MongoDB instances with WiredTiger 256MB cache limits (`--wiredTigerCacheSizeGB 0.25`) and `mem_limit: 220m`.
  - Configured host `C:\Users\adity\.wslconfig` with `memory=3.5GB` and `autoMemoryReclaim=gradual`.
  - Result: Total container RSS slashed by 66% (from 4.93 GB to 1.69 GB), freeing over 4 GB of physical RAM on the Windows host machine while passing 100% of tests (126/126 assertions).
- [x] **Phase 3 Sprint 2: Break-Glass Emergency Lifecycle Branches, 15-Minute Grace Period & Supervisor Engine**:
  - Implemented Branch A (Upfront Long-Window Routing): Requests >2h immediately grant the standard 2h token to eliminate clinical delay, while queuing an upfront extension ticket (`TICK-UPFRONT-*`) in `system_db.supervisor_tickets` with a 15-min SLA.
  - Implemented Branch B (Pre-Expiry Extension): `POST /consent/break-glass/extend` with a Layer 1 Automated Rule Engine (auto-approves <=2h, 1st extension, 0 doctor misuse flags) emitting Contract `C-04` chained audit events (`linked_event_id`). Non-standard extensions escalate to Layer 2 supervisor review (`TICK-EXT-*`).
  - Implemented Branch C (15-Minute Grace Period — Decision `D-07`): Expired tokens enter a 15-minute grace period where records remain visible in the browser, but fresh node queries via `POST /records/fetch` return `HTTP 423 Locked`. Emergency reinstatement endpoint `POST /consent/break-glass/reinstate` queues a supervisor ticket (`TICK-REINSTATE-*`); requests past 15 min return `HTTP 410 Gone`.
  - Implemented Clinical Supervisor Service: `GET /supervisor/queue` with dynamic SLA countdown timers (`sla_remaining_sec`, `sla_breached`) and `POST /supervisor/review` with Contract `C-04` chained audit events (`supervisor_break_glass_approved` / `supervisor_break_glass_denied`).
  - Enhanced Doctor Portal (`frontend/dashboard.html`): "🚨 Declare Break-Glass Emergency" modal with live Safe Harbor triage inspection, live HUD countdown timer, 15-minute grace banner, and Supervisor Review modal with 1-click Approve/Deny.
  - Authored automated verification test suite `scripts/test_phase3_sprint2_breakglass.js` (60/60 PASS) with zero regressions across prior suites (**253/253 total passing assertions**).

### 🔧 In Progress
- [ ] Phase 3 Sprint 3: Blockchain Audit Log Deployment (Hardhat local network, `AuditLog.sol` compilation & deployment, on-chain hash anchoring `C-04`/`C-05`).

### ⛔ Blocked / Critical Attention
- None.

---

## 🎯 Next Tasks for Coding Agent
1. **Phase 3 Sprint 3: Blockchain Audit Log Deployment**:
   - Set up local Ethereum/Hardhat node.
   - Compile and deploy `AuditLog.sol` per `docs/02_smart_contract.md`.
   - Wire Audit Service in `backend/index.js` to anchor access events on-chain with canonical JSON serialization (`C-05`).
2. **Phase 4: ML Anomaly Detection Service**:
   - Build FastAPI scoring service evaluating `C-03` pre-computed features and weights (`C-06`).


