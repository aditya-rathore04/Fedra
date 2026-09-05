# Project Memory Index
**Project:** Federated Medical Record Discovery and Secure Access System (FEDRA)  
**Team:** 4 members · Final Year B.E. Computer Engineering · 15-week development plan (see `docs/project_build_phases.md`)

---

## 🎯 Purpose of This Directory
- `docs/` is the **spec layer**: describes what the system *should be* (design decisions are locked; do not edit without explicit team agreement).
- `project-memory/` is the **operational layer**: describes what the system *is today* and evolves with every working session.

---

## 📖 Mandatory Read Order for Any Session (Agent & Human)
Before writing any code or modifying configurations, execute this exact reading sequence:

1. **`00_index.md`** (This file) — Ground rules, context, read order.
2. **`01_current_state.md`** — Current phase, working components, active blockers, and the exact next task.
3. **`docs/0X` specs** — The relevant design specification file for the task at hand (e.g., `05_api_service_design.md` for APIs, `02_smart_contract.md` for blockchain, `04_ml_model_design.md` for ML).
4. **`03_contracts.md`** — The binding cross-service contracts (C-01 to C-08) before touching any code that crosses service boundaries.

---

## ⚖️ Ground Rules
- **Specs are Locked (`docs/`)**: Never change files in `docs/` to match broken or prototype code. If code and docs disagree, **STOP and flag** the discrepancy.
- **Contracts (`C-xx`) & Decisions (`D-xx`) are Binding**: All cross-service schemas, latency targets, and architectural decisions in `02_decisions_log.md` and `03_contracts.md` must be preserved.
- **Honest Placeholders**: Never leave half-functional fake implementations. If a feature or fallback is not yet built, keep it explicitly stubbed (e.g. returning 501 / clear message) rather than faking data.
- **End-of-Session Protocol**: Every working session must update `01_current_state.md` and append an entry to `04_session_log.md`.

---

## 🗺️ Project Memory Map

| File | Purpose |
|---|---|
| [`00_index.md`](file:///c:/Users/adity/FEDRA/project-memory/00_index.md) | Entry point, read order, and system ground rules |
| [`01_current_state.md`](file:///c:/Users/adity/FEDRA/project-memory/01_current_state.md) | Active phase, component health, blockers, next task |
| [`02_decisions_log.md`](file:///c:/Users/adity/FEDRA/project-memory/02_decisions_log.md) | Locked architectural decisions (D-01 to D-08) + rationale |
| [`03_contracts.md`](file:///c:/Users/adity/FEDRA/project-memory/03_contracts.md) | Cross-service boundary contracts (C-01 to C-08) |
| [`04_session_log.md`](file:///c:/Users/adity/FEDRA/project-memory/04_session_log.md) | Append-only history of development sessions |
| [`05_pitfalls.md`](file:///c:/Users/adity/FEDRA/project-memory/05_pitfalls.md) | Known gotchas, timeout issues, container quirks |
| [`06_glossary.md`](file:///c:/Users/adity/FEDRA/project-memory/06_glossary.md) | Domain terms (ABHA, Break-glass), personas, branches |
| [`07_bug_triage.md`](file:///c:/Users/adity/FEDRA/project-memory/07_bug_triage.md) | Severity tiers, triage protocol, bug tracking |
