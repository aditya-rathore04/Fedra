# Bug Triage & Issue Management

Standard conventions for classifying, tracking, and resolving bugs across the Fedra codebase.

---

## 🚦 Severity Tiers

| Severity | Definition | Impact on Workflow | Examples |
|---|---|---|---|
| **BLOCKER** | Complete breakdown of core demo flow or environment crash | **Work stops immediately.** No forward progress until resolved. | Docker DB unconnectable; Gateway crashes on boot; JWT validation throws unhandled 500 on all routes. |
| **HIGH** | Major feature broken or contract violation, but isolated or workaround exists | Fix in current or immediately subsequent session. Document in `01_current_state.md`. | Break-glass grace extension calculation off by minutes; FHIR parser fails on specific condition bundle; ML scoring latency >100ms. |
| **MEDIUM** | Non-critical feature bug, UX/UI defect, or spec gap | Backlogged for Phase polish or next relevant feature sprint. | UI CSS misalignment on mobile view; missing secondary category badge; non-standard JWT claim field names. |
| **LOW** | Minor cosmetic issue, log typo, or documentation discrepancy | Fix during spare buffer time in Phase 5. | Console warning about deprecated library method; markdown typo in setup guide. |

---

## 🤖 Coding Agent Rules for Bugs

1. **Never Silently Rewrite Specs:**
   If a bug stems from code not matching `docs/`, the code is wrong, NOT the spec. Do not edit `docs/` to "fix" an error unless the user explicitly commands a design revision.
2. **Blocker Protocol:**
   If an agent encounters a BLOCKER:
   - Immediately report the failure.
   - Output the exact error trace and root cause.
   - Propose the fix and wait for user guidance before proceeding with unrelated tasks.
3. **High Severity Workarounds:**
   If a workaround is needed to continue testing, flag the workaround clearly in code comments (`// WORKAROUND: Issue #XX`) and document it in `04_session_log.md`.
4. **Session Log Linkage:**
   Every identified bug must be mentioned in `04_session_log.md` under `Found Issues`.

---

## 📝 Standard Issue Template

```markdown
### [SEVERITY] Short Descriptive Title
- **Component:** [Backend Gateway / FHIR / MongoDB / Smart Contract / ML / Frontend]
- **Observed Behavior:** [What actually happened with error message]
- **Expected Behavior:** [What docs/ or contracts specify]
- **Steps to Reproduce:**
  1. ...
  2. ...
- **Root Cause:** [Brief diagnosis]
- **Recommended Fix:** [Actionable steps to resolve]
```
