# Claude Code Project Guidelines — FEDRA

Welcome to the **Federated Medical Record Discovery and Secure Access System (FEDRA)** repository.

---

## 🛑 MANDATORY PROTOCOL FOR EVERY SESSION

This repository maintains a strict separation between **Design Specifications** (`docs/`) and **Operational Reality** (`project-memory/`).

### 1. Mandatory Read Order (Do this before modifying any code)
1. **`project-memory/00_index.md`** — Ground rules, contracts overview, and read sequence.
2. **`project-memory/01_current_state.md`** — Active phase, component status, blockers, and next assigned tasks.
3. **`docs/0X`** — The relevant design specification in `docs/` for your current task.
4. **`project-memory/03_contracts.md`** — Boundary contracts (`C-01` to `C-08`) before writing any cross-service code.

### 2. Core Ground Rules
- **`docs/` is Locked:** Never modify or relax specifications in `docs/` to match broken or prototype code. If code and docs disagree, **stop and flag** the issue.
- **Contracts (`C-xx`) and Decisions (`D-xx`) are Binding:** Always check `project-memory/02_decisions_log.md` and `project-memory/03_contracts.md`.
- **Honest Stubs:** Never create half-working fake features. Keep placeholders explicitly stubbed with clear messages or 501 status.
- **Session End Requirement:** Before ending your work, update `project-memory/01_current_state.md` and append an entry to `project-memory/04_session_log.md`.

---

## 🛠️ Environment & Commands

- **Docker Containers (7 services):**
  - Start: `docker compose up -d` (or `docker start system-mongo hospital1-mongo hospital2-mongo hospital3-mongo hospital1-fhir hospital2-fhir hospital3-fhir`)
  - Status: `docker compose ps`
- **Central MongoDB:** `localhost:27020` (`system_db` for users, `registry_db` for indexed hospital locations).
- **FHIR Hospital Endpoints:**
  - Hospital 1 (Apollo): `http://localhost:8081/fhir`
  - Hospital 2 (Fortis): `http://localhost:8082/fhir`
  - Hospital 3 (Max): `http://localhost:8083/fhir`
- **Backend Gateway:**
  - Run: `node backend/index.js` (listens on `http://localhost:3000`)
- **Frontend Portal:**
  - Open: `frontend/index.html` (practitioner login) and `frontend/dashboard.html` (federated search).
