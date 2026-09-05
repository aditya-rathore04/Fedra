# AI Coding Agent Instructions — FEDRA

System instructions for autonomous coding agents, LLM harnesses, and code assistants operating on this repository.

---

## 🧭 Workflow & Memory Discovery

All architectural intent, project progress, and cross-service requirements are codified in the `project-memory/` directory.

### Mandatory Startup Protocol
Before analyzing, planning, or executing changes:
1. **Read `project-memory/00_index.md`** — Defines ground rules, read order, and system constraints.
2. **Read `project-memory/01_current_state.md`** — Contains the ground truth: active phase, component health, blockers, and the exact next task.
3. **Read the relevant spec in `docs/`** (`00_system_architecture.md` through `05_api_service_design.md`) for technical specifications.
4. **Consult `project-memory/03_contracts.md`** — Verify schemas (`C-01` to `C-08`) before modifying cross-service APIs, database collections, or smart contracts.

---

## 🔒 Invariant Rules
- **Design Docs are Frozen:** `docs/` is the authoritative specification layer. Do not alter files in `docs/` to accommodate bugs or discrepancies in code.
- **Strict Boundary Contracts:** Contract definitions in `project-memory/03_contracts.md` (e.g. JWT payload structure `C-01`, tamper hash serialization `C-05`, ML score weighting `C-06`) are strictly enforced.
- **Bug Protocol:** If a BLOCKER or HIGH issue is encountered, document it in `project-memory/01_current_state.md` and follow conventions in `project-memory/07_bug_triage.md`.
- **Handoff Requirement:** Every agent turn or work session MUST:
  1. Reflect newly finished tasks in `project-memory/01_current_state.md`.
  2. Append a session summary block to `project-memory/04_session_log.md`.

---

## ⚡ Quick Reference

- **Backend Gateway:** Node.js Express server on `http://localhost:3000` (`backend/index.js`).
- **Data Stores:** MongoDB on `localhost:27020` (`system_db` and `registry_db`).
- **FHIR Nodes:** HAPI FHIR R4 on ports `8081` (Apollo), `8082` (Fortis), `8083` (Max).
- **Network Map:** See `SETUP_GUIDE.md` for complete architecture port mappings.
