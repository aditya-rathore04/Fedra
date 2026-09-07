

## Demo Readiness Overview

| Demo | First Runnable | Fully Complete |
|---|---|---|
| **Demo 1 — The Clinical Journey** | End of Phase 2 (no blockchain verification) | End of Phase 3 (with blockchain verification) |
| **Demo 2 — The Emergency** | End of Phase 3 | End of Phase 5 (full seeding) |
| **Demo 3 — The Patient App** | End of Phase 3 (partial) | End of Phase 5 (all features present) |
| **Demo 4 — The ML Detection Layer** | End of Phase 4 | End of Phase 5 (full seeding) |

---

## Demo 1 — The Clinical Journey
*Standard access happy path, no emergency/anomaly elements*

| Act | What Happens |
|---|---|
| **Act 1** | Doctor searches for patient — discovery layer only (no records shown, just institution list) |
| **Act 2** | Doctor requests access → patient consents in the app → doctor views Hospital 1 records |
| **Act 3** | Doctor requests **psychiatric history** specifically → patient grants that sensitive category separately → doctor views it |
| **Act 4** | Lab uploads a new result → patient is notified → doctor fetches it under the **existing** (still-active) token |

**Seed data (Phase 5):** Patient A's records at Hospital 1 (including psychiatric history), Doctor B at Hospital 2, a Diagnostic Lab registered in the system.

---

## Demo 2 — The Emergency (Break-Glass)

| Act | What Happens |
|---|---|
| **Act 1** | Safe harbor data (critical allergies, blood type, emergency contact) is visible **without any consent** |
| **Act 2** | Break-glass triggered with an **upfront 8-hour extension request** (Branch A) — designated caregiver notified in real time |
| **Act 3** | Critical categories accessed (allergies, meds, conditions) — **psychiatric history stays locked** even under break-glass; a drug allergy is found |
| **Act 4** | Supervisor approves the extension — blockchain chain shown with **two linked entries** (trigger → extension) |
| **Act 5** | Patient sees the break-glass event in their audit log, taps to verify, blockchain verification returns **true** |

**Seed data (Phase 5):** Hospital 3 with Doctor C, Patient A with **no prior relationship** to Doctor C, a designated caregiver contact configured.

---

## Demo 3 — The Patient App

Runs **partially** at end of Phase 3, fully by Phase 5:
- Patient app login (biometric/PIN)
- Unified record timeline (records from all institutions merged into one view)
- Audit log review (with blockchain verification indicators per entry)
- Consent revocation
- Pre-authorization of consent policies

By Phase 5 this expands to the full patient-app feature set: medications section, medication reminders, drug interaction flag (placeholder), appointment booking with pre-auth prompt, sensitive category toggles, single research opt-in toggle, family history input, wearable "Connect Device" placeholder, health summary, and manual vitals entry.

---

## Demo 4 — The ML Detection Layer

| Act | What Happens |
|---|---|
| **Act 1** | Admin dashboard shows the live feed — **Doctor D is amber**, **Doctor E is at second misuse flag** |
| **Act 2** | Doctor D accesses five records — unified score crosses the 0.5 threshold → **warning issued** → status flips green → amber |
| **Act 3** | Doctor D continues accessing — crosses 0.7 threshold → **supervisor co-authorization required, access blocked** → status flips amber → red |
| **Act 4** | Doctor E triggers a **new break-glass event** — this is their **third flag** → blockchain gets a permanent annotation → escalated to ethics board/admin → all Doctor E's *future* break-glass requests require upfront co-authorization |
| **Act 5** | Full dashboard view showing both doctors' cases in the audit log, with their respective blockchain chains displayed |

**Seed data (Phase 5):** Doctor D seeded with an access history positioned to cross the threshold on the very next action; Doctor E seeded at the second misuse flag, one action away from the third.

---

## Cross-cutting notes on the demos

- **Single reset script** (`scripts/reset-demo.sh`) wipes and reseeds all databases + FHIR nodes to a clean state covering all four demos' world-state in one command — critical for repeatable viva-day runs.
- **Demo stability was a deliberate design choice**: Docker Swarm / LAN-split architectures were considered and rejected specifically to avoid network dependency risk during the live demos.
- **Integration testing (Phase 5, Week 14)** explicitly includes running all four demos back-to-back on a freshly reset environment, plus cross-service failure testing (slow FHIR node, delayed blockchain write, unreachable ML service) so a hiccup during viva doesn't break the narrative.
- All demos are designed to chain conceptually: Demo 1 establishes the "normal" system, Demo 2 shows it under emergency stress, Demo 3 shows the patient-facing trust layer, and Demo 4 shows the system catching misuse — together they walk an evaluator through the entire value proposition (federation → consent → emergency access → transparency → self-policing).

