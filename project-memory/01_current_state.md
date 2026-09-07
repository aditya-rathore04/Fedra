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
| **Consent Service** | ⚪ Not Started | Spec: `docs/05` | Planned for Phase 2 (Weeks 4–6) |
| **Blockchain Audit Log** | ⚪ Not Started | Spec: `docs/02` | Contract written; Hardhat/Ganache deployment planned for Phase 3 |
| **ML Anomaly Detection** | ⚪ Not Started | Spec: `docs/04` | FastAPI scoring service planned for Phase 4 |
| **Patient Mobile App** | ⚪ Not Started | Spec: `docs/00` | Flutter shell planned for Phase 2 / 3 |

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

### 🔧 In Progress
- [ ] Preparation for Phase 2 (Core Access Control & Consent Service scaffold).

### ⛔ Blocked / Critical Attention
- None.

---

## 🎯 Next Tasks for Coding Agent
1. **Phase 2 Implementation**:
   - Design MongoDB schemas for `consent_policies` and `access_tokens` in `system_db` per `docs/01_database_schema.md`.
   - Implement Consent Service endpoints per `docs/05_api_service_design.md` (`POST /consent/create`, `POST /consent/verify`, `POST /consent/sensitive`).
2. **Indian Cohort Data Seeder**:
   - Implement `scripts/seed_indian_patients.js` based on `06_patient_seed_data_spec.md`.

