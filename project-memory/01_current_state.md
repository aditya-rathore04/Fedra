# Current State of System

> **Last Updated:** 2026-09-05 (Session 0)  
> **Current Phase:** Phase 1 (Foundation and Infrastructure) — Finishing Week 2/3 Milestone  
> **Target Milestone:** End-of-Phase 1 Test (Robust JWT Auth + Federated Patient Search)

---

## 🚦 High-Level Component Health

| Component | Status | Location / Port | Notes |
|---|---|---|---|
| **Docker Engine** | 🟢 Running | Localhost | Docker Desktop active |
| **HAPI FHIR Node 1 (Apollo)** | 🟢 Up | `localhost:8081/fhir` | Spring Boot active, Synthea bundles loaded |
| **HAPI FHIR Node 2 (Fortis)** | 🟢 Up | `localhost:8082/fhir` | Spring Boot active, Synthea bundles loaded |
| **HAPI FHIR Node 3 (Max)** | 🟢 Up | `localhost:8083/fhir` | Spring Boot active, Synthea bundles loaded |
| **MongoDB Hospital 1-3** | 🟢 Up | Ports `27017`, `27018`, `27019` | Local hospital persistence containers |
| **MongoDB System Central** | 🟢 Up | `localhost:27020` | Contains `system_db` (33 users) & `registry_db` (32 entries) |
| **Backend Gateway** | 🟡 Prototype | `localhost:3000` | Express app in `backend/index.js`. Health check & patient search active. |
| **Identity Service (Auth / JWT)** | 🟡 Incomplete (Mock) | `backend/index.js` | Login endpoint accepts ID/email with no password check; claims differ from spec `C-01`. |
| **Doctor Portal (Frontend)** | 🟢 Working Prototype | `frontend/index.html`, `dashboard.html` | Login redirect, ABHA discovery query & card layout working. |
| **Consent Service** | ⚪ Not Started | Spec: `docs/05` | Planned for Phase 2 (Weeks 4–6) |
| **Blockchain Audit Log** | ⚪ Not Started | Spec: `docs/02` | Contract written; Hardhat/Ganache deployment planned for Phase 3 |
| **ML Anomaly Detection** | ⚪ Not Started | Spec: `docs/04` | FastAPI scoring service planned for Phase 4 |
| **Patient Mobile App** | ⚪ Not Started | Spec: `docs/00` | Flutter shell planned for Phase 2 / 3 |

---

## 📋 Task Status

### ✅ Completed
- [x] Multi-container Docker compose environment configured with 3 HAPI FHIR nodes and 4 MongoDB databases.
- [x] Ingestion & synthetic data seeding pipeline (`scripts/seed_and_load.js`) loaded 30 Synthea patient files into FHIR nodes.
- [x] Seeded central directory `system-mongo:27020`:
  - `system_db.users`: 33 users (doctors, patients, emergency persona).
  - `registry_db.registry_entries`: 32 registry index entries with multi-hospital federation links.
- [x] Implemented discovery query endpoint (`GET /patient/search?health_id=...`).
- [x] Implemented helper endpoint (`GET /patients`) to list all registered patients for the demo UI.
- [x] Built frontend practitioner verification page (`frontend/index.html`) and discovery dashboard (`frontend/dashboard.html`).

### 🔧 In Progress
- [ ] **JWT Authentication Spec Alignment**: Bring `backend/index.js` auth from mock prototype to spec standard (see `docs/05_api_service_design.md` and `03_contracts.md` C-01).

### ⛔ Blocked / Critical Attention
- None currently blocking execution. Docker containers and data verified online.

---

## 🎯 Next Tasks for Coding Agent
1. **Spec-Compliant JWT Auth**:
   - Refactor `POST /auth/login` to support verified credentials / role claims.
   - Enforce spec payload: `{ user_id, role, institution_id, issued_at, expires_at }`.
   - Update `verifyJWT` middleware to validate role-based permissions at gateway level.
2. **Phase 1 Verification**:
   - Run end-to-end curl/Postman test validating login -> token issuance -> protected patient search -> token rejection without auth.
3. **Transition to Phase 2 Scaffold**:
   - Prepare Consent Service models in MongoDB for consent policies and access tokens.
