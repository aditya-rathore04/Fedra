# Project Memory Guideline for Fedra

Every time you work on this codebase, you must follow the strict Project Memory protocol:

1. **Read Order**:
   - Step 1: Read [`project-memory/00_index.md`](file:///c:/Users/adity/FEDRA/project-memory/00_index.md) and [`project-memory/01_current_state.md`](file:///c:/Users/adity/FEDRA/project-memory/01_current_state.md).
   - Step 2: Read the relevant design specification in `docs/` (`00_system_architecture.md` through `05_api_service_design.md`) for the task.
   - Step 3: Check [`project-memory/03_contracts.md`](file:///c:/Users/adity/FEDRA/project-memory/03_contracts.md) before modifying or adding code across service boundaries.

2. **Ground Rules**:
   - `docs/` is the locked design spec. Never modify files in `docs/` to fit broken or prototype code. If code and docs disagree, stop and flag.
   - Contracts (C-01 to C-08) and Decisions (D-01 to D-09) are binding.
   - At the conclusion of any session, update [`project-memory/01_current_state.md`](file:///c:/Users/adity/FEDRA/project-memory/01_current_state.md) and append a session log in [`project-memory/04_session_log.md`](file:///c:/Users/adity/FEDRA/project-memory/04_session_log.md).
