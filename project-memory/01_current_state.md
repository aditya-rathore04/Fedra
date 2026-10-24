# Current State of System

> **Last Updated:** 2026-10-25 (Session 14)  
> **Current Phase:** Phase 3 (Break-Glass Emergency Access & Tessera Transparency Log Audit Layer) — Sprint 3 Part 3 Complete  
> **Target Milestone:** Phase 3 Sprint 3 Part 4 (Backend Outbox Worker & Proof Relay API `GET /audit/proof/:event_id`)

---

## 🚦 High-Level Component Health

| Component | Status | Location / Port | Notes |
|---|---|---|---|
| **Docker Engine** | 🟢 Running | Localhost | Docker Desktop active, 8 containers up (including `tessera-log`) |
| **HAPI FHIR Node 1 (Apollo)** | 🟢 Up | `localhost:8081/fhir` | Spring Boot active, Serial GC + `-Xmx384m`, Indian cohort loaded, `mem_limit: 480m` |
| **HAPI FHIR Node 2 (Fortis)** | 🟢 Up | `localhost:8082/fhir` | Spring Boot active, Serial GC + `-Xmx384m`, Indian cohort loaded, `mem_limit: 480m` |
| **HAPI FHIR Node 3 (Max)** | 🟢 Up | `localhost:8083/fhir` | Spring Boot active, Serial GC + `-Xmx384m`, Indian cohort loaded, `mem_limit: 480m` |
| **MongoDB Hospital 1-3** | 🟢 Up | Ports `27017`, `27018`, `27019` | WiredTiger cache capped at 256MB, `mem_limit: 220m` |
| **MongoDB System Central** | 🟢 Up | `localhost:27020` | WiredTiger cache capped at 256MB, `mem_limit: 220m` |
| **Backend Gateway** | 🟢 Spec-Compliant | `localhost:3000` | Express gateway in `backend/index.js` with RBAC, JWT validation, fail-closed audit pipeline. |
| **Identity Service (Auth / JWT)** | 🟢 Spec-Compliant | `backend/index.js` | Contract `C-01` verified, role lifetimes, `/auth/refresh`, registration endpoints active. |
| **Consent & Break-Glass Service** | 🟢 Spec-Compliant | `backend/index.js` | Full break-glass declaration, 2h/4h/8h windows, rate limiting, caregiver notifications, Safe Harbor. |
| **Federated Record Aggregator** | 🟢 Spec-Compliant | `POST /records/fetch` | Parallel FHIR queries (C-08), strict sensitive category lockdown, fail-closed audit write (C-03/C-05). |
| **Audit Trail Service** | 🟢 Spec-Compliant | `GET /audit/patient/:id` | Contract C-04 hash chain + `patient_seq`, C-05 RFC 8785 JCS canonical hash, HMAC IDs, patient privacy RBAC. |
| **Doctor Portal (Frontend)** | 🟢 Interactive Deep Viewer | `frontend/dashboard.html` | Access request modal, live token timer, clinical drawer with findings, codes & FHIR inspection. |
| **Patient Browser App (Workaround)** | 🟢 All 6 Patients Synced | `frontend/patient.html` | Smartphone mockup frame, all 6 Indian patients, inbox, approval sheet, sensitive toggles, self-timeline. |
| **Audit Notary (Tessera)** | 🟢 Up & Verified | `localhost:3600` (`tessera-log`) | Go container active on port 3600: `/add`, `/checkpoint` (C2SP Signed Note), `/proof` (RFC 6962), `/pubkey`. Part 3 Complete (32/32 tests pass). |
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
  - Result: Total container RSS slashed by 66% (from 4.93 GB to 1.69 GB), freeing over 4 GB of physical RAM on the Windows host machine while passing 100% of tests.
- [x] **Phase 3 Sprint 2: Break-Glass Emergency Lifecycle Branches, 15-Minute Grace Period & Supervisor Engine**:
  - Implemented Branch A (Upfront Long-Window Routing): Requests >2h immediately grant the requested window upfront (2h, 4h, 8h) and enqueue a supervisor ticket (`TICK-UPFRONT-*`) in `system_db.supervisor_tickets` with a 15-min SLA.
  - Implemented Branch B (Pre-Expiry Extension): `POST /consent/break-glass/extend` with a Layer 1 Automated Rule Engine (auto-approves <=2h, 1st extension, 0 doctor misuse flags) emitting Contract `C-04` chained audit events (`linked_event_id`). Non-standard extensions escalate to Layer 2 supervisor review (`TICK-EXT-*`).
  - Implemented Branch C (15-Minute Grace Period — Decision `D-07`): Expired tokens enter a 15-minute grace period where records remain visible in the browser, but fresh node queries via `POST /records/fetch` return `HTTP 423 Locked`. Emergency reinstatement endpoint `POST /consent/break-glass/reinstate` queues a supervisor ticket (`TICK-REINSTATE-*`); requests past 15 min return `HTTP 410 Gone`.
  - Implemented Clinical Supervisor Service: `GET /supervisor/queue` with dynamic SLA countdown timers (`sla_remaining_sec`, `sla_breached`) and `POST /supervisor/review` with Contract `C-04` chained audit events (`supervisor_break_glass_approved` / `supervisor_break_glass_denied`).
  - Enhanced Doctor Portal (`frontend/dashboard.html`): "🚨 Declare Break-Glass Emergency" modal with live Safe Harbor triage inspection, live HUD countdown timer, 15-minute grace banner, and Supervisor Review modal with 1-click Approve/Deny.
  - Authored automated verification test suite `scripts/test_phase3_sprint2_breakglass.js` (76/76 PASS).
- [x] **Break-Glass Emergency Production Fixes (Duration, End Emergency & Patient App Visibility)**:
  - **Issue 1 Resolved (Patient App Visibility)**: Added active emergency alert cards, pulsating live indicators, sub-navigation filter tabs (`All`, `Authorizations`, `🚨 Break-Glass`), and historical break-glass audit logs in the Patient App (`frontend/patient.html`).
  - **Issue 2 Resolved (End Emergency Revocation Bug)**: Fixed `Policy not found` error in `POST /consent/revoke` by adding support for token IDs, invalidating in-memory cache, revoking associated supervisor tickets, and providing dedicated `POST /consent/break-glass/end` endpoint wired to the Doctor Dashboard's "End Emergency" button and Patient App.
  - **Issue 3 Resolved (Window Duration Selection)**: Fixed emergency window calculation in `POST /consent/break-glass` so choosing 2, 4, or 8 hours grants the exact requested window immediately without truncating to 2 hours. Updated Doctor Dashboard HUD timer, modal labels, and alerts.
- [x] **Phase 3 Sprint 3 — Tessera Migration Part 1 & Part 2 (Governance & Cryptographic Core Pipeline)**:
  - Preserved smart contract specs in `docs/02_smart_contract.md` while adding Section 7 (Tessera Architecture) and logging Decision `D-10`.
  - Updated Contract `C-04` (`linked_event_id` + contiguous `patient_seq`), Contract `C-05` (RFC 8785 JCS + SHA-256), and added Contract `C-09` (`GET /audit/proof/:event_id`).
  - Implemented `canonicalizeJCS(obj)` adhering to RFC 8785 (keys sorted by UTF-16 code units, zero whitespace, -0 to 0).
  - Implemented `computeCanonicalHash(immutableSubset)` using SHA-256.
  - Implemented keyed `hmacId(rawId)` using HMAC-SHA256 for actor and patient health IDs.
  - Implemented atomic contiguous monotonic sequence counter `getNextPatientSeq(patientHash)` backed by `system_db.audit_counters`.
  - Centralized all gateway audit logging into unified `writeAuditEvent(eventData)` generating `immutable_subset`, `canonical_hash`, and initial `tessera: { status: 'pending', log_index: null }`.
  - Enforced fail-closed audit logging on clinical records fetch (`POST /records/fetch` returns `HTTP 503` if audit write fails).
  - Wired missing audit events: `consent_granted`, `consent_revoked`, and `sensitive_category_updated`.
  - Authored automated verification test suite `scripts/test_audit_crypto.js` (**51/51 PASSED**).
- [x] **Phase 3 Sprint 3 — Tessera Migration Part 3 (Tessera Transparency Log Container & Merkle Personality)**:
  - Authored `tessera/main.go` using pure Go standard library implementing RFC 6962 Merkle tree algorithm, binary leaf persistence (`leaves.bin`), and C2SP Signed Note checkpoints signed with Ed25519.
  - Built multi-stage static Alpine container `tessera/Dockerfile` (image size ~15 MB, runtime RAM < 12 MB).
  - Added `tessera` container service to `docker-compose.yml` with port mapping `3600:3500` (bypassing Windows TCP port exclusion range 3452-3551), persistent volume `tessera-data:/data`, and `mem_limit: 128m`.
  - Configured `backend/.env` with `TESSERA_URL=http://localhost:3600`.
  - Authored automated verification test suite `scripts/test_tessera_service.js` (**32/32 PASSED**): verified container health, `POST /add` leaf appending, `GET /checkpoint` C2SP note format, Ed25519 signature validity, and `GET /proof` RFC 6962 inclusion proofs reconstruction against root hash.
  - Verified platform-wide health: **336/336 assertions passing platform-wide**.

### 🔧 In Progress
- [ ] Phase 3 Sprint 3: Tessera Transparency Log Deployment (Part 4 outbox poller & C-09 relay, Part 5 in-browser verifier).

### ⛔ Blocked / Critical Attention
- None.

---

## 🎯 Next Tasks for Coding Agent
1. **Phase 3 Sprint 3: Tessera Transparency Log Deployment (Decision D-10)**:
   - Part 1: Governance & Documentation Layer (Completed).
   - Part 2: Backend Cryptographic Core & Unified Audit Pipeline (Completed & Verified).
   - Part 3: Tessera Transparency Log Service Container (Completed & Verified).
   - **Part 4: Backend Outbox Worker & Proof Relay API (`GET /audit/proof/:event_id`)** — AWAITING USER CONFIRMATION.
   - Part 5: Patient App Audit UI & In-Browser Verifier (live Merkle proof validation & tamper demo).
2. **Phase 4: ML Anomaly Detection Service**:
   - Build FastAPI scoring service evaluating `C-03` pre-computed features and weights (`C-06`).
