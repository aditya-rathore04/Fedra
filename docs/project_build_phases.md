# Federated Medical Record Discovery and Secure Access System
## Project Build Phases — Development Roadmap

> Final Year B.E. Computer Engineering Project
> 15 weeks · 5 phases · 3 weeks per phase
> Each phase ends with a working, testable milestone — nothing deferred to the end

---

## Table of Contents

1. [Phasing Overview](#1-phasing-overview)
2. [Phase 1 — Foundation and Infrastructure](#2-phase-1--foundation-and-infrastructure-weeks-13)
3. [Phase 2 — Core Access Control](#3-phase-2--core-access-control-weeks-46)
4. [Phase 3 — Break-Glass and Audit](#4-phase-3--break-glass-and-audit-weeks-79)
5. [Phase 4 — ML Anomaly Detection](#5-phase-4--ml-anomaly-detection-weeks-1012)
6. [Phase 5 — Integration, Demo Prep, and Polish](#6-phase-5--integration-demo-prep-and-polish-weeks-1315)
7. [Sequencing Logic](#7-sequencing-logic)
8. [Demo Readiness by Phase](#8-demo-readiness-by-phase)
9. [Risk Register](#9-risk-register)

---

## 1. Phasing Overview

| Phase | Name | Weeks | End Goal |
|---|---|---|---|
| 1 | Foundation and infrastructure | 1–3 | Three hospital nodes running, patient searchable, JWT auth working end-to-end |
| 2 | Core access control | 4–6 | Doctor searches, patient consents, doctor views records — full happy path working |
| 3 | Break-glass and audit | 7–9 | Emergency access working, full event chain on blockchain, verification in patient app |
| 4 | ML anomaly detection | 10–12 | Live anomaly scoring on access events, graduated response pipeline triggering correctly |
| 5 | Integration, demo prep, and polish | 13–15 | All four demos runnable end-to-end without interruption |

**Buffer logic:** Phase 5 is deliberately low-risk — data seeding, UI polish, and rehearsal. If earlier phases slip slightly, Phase 5 absorbs it without panic.

---

## 2. Phase 1 — Foundation and Infrastructure (Weeks 1–3)

### Goal
Get the skeleton standing. By the end of this phase, a doctor can log in, search for a patient, and see which hospitals hold their records. Nothing more — but everything else builds on this.

### What You Build

#### Environment Setup
- Node.js, Python, MongoDB, Docker installed and configured
- Ganache desktop app installed, local Ethereum network running
- Three HAPI FHIR R4 instances on different ports simulating three hospital nodes:
  - Hospital 1: `localhost:8081`
  - Hospital 2: `localhost:8082`
  - Hospital 3: `localhost:8083`

#### Database Setup
- Hospital node MongoDB instances (one per simulated hospital)
- Discovery registry MongoDB database
- Consent and access control MongoDB database
- Audit events MongoDB database
- All indexes created as specified in the database design

#### Data Seeding
- Synthetic patient records seeded into all three hospital FHIR nodes
- Discovery registry populated with institution entries pointing to each FHIR endpoint
- Doctor and patient user accounts created for demo personas

#### Identity Service
- Doctor registration and login
- Patient registration and login
- ABHA verification and UUID linkage
- JWT issuance: `{ user_id, role, institution_id, issued_at, expires_at }`
- Token refresh and session management

#### API Gateway
- Single unified gateway with JWT validation on every request
- Role-based endpoint authorization
- Basic routing to internal services
- Rate limiting configuration

#### Discovery Service
- Patient search by ABHA — returns institution list with record summaries
- Registry entry creation endpoint
- Node status management

#### Doctor Portal (React) — Basic Shell
- Login screen
- Patient search screen with ABHA input
- Search results screen showing institution list and record summaries

### Week-by-Week Breakdown

| Week | Focus | Deliverables |
|---|---|---|
| Week 1 | Environment and databases | All tools installed, three FHIR nodes running, all four MongoDB databases created and indexed |
| Week 2 | Identity service and gateway | JWT auth working, doctor and patient login functional, gateway routing requests |
| Week 3 | Discovery service and doctor portal | Patient search returns institution list, doctor portal displays results, synthetic data seeded |

### End-of-Phase Test
Log in as Doctor B, search for Patient A's ABHA, see a list of three hospitals with record summaries. No records visible yet — only the discovery layer. All three FHIR nodes responding. JWT token validated on every request.

### Key Technical Risks This Phase
- HAPI FHIR server configuration and patient identifier mapping — allow extra time
- MongoDB connection pooling across multiple databases — verify connection limits early
- JWT signing and validation across services — test thoroughly before moving to Phase 2

---

## 3. Phase 2 — Core Access Control (Weeks 4–6)

### Goal
The full standard access happy path — from consent request to viewing records. This is Demo 1, minus the blockchain and lab upload. The most important phase — every other feature depends on consent and tokens working correctly.

### What You Build

#### Consent Service
- Consent policy creation when patient grants access
- Access token issuance when a valid consent policy exists
- Token validation on every record fetch (called internally by other services)
- Consent revocation — immediate token invalidation
- Sensitive category gate — separate opt-in check for psychiatric, reproductive, HIV, and substance abuse records
- Pre-authorized consent policy creation
- Break-glass token type (scaffold only — fully implemented in Phase 3)

#### Record Fetch Flow
- Token validated by Consent Service before any FHIR call
- Discovery Service resolves FHIR endpoints per institution
- Backend queries each hospital's FHIR server using standard R4 search queries:
  - `GET {fhir_endpoint}/Patient?identifier={ABHA}`
  - `GET {fhir_endpoint}/MedicationRequest?patient={fhir_id}`
  - `GET {fhir_endpoint}/AllergyIntolerance?patient={fhir_id}`
  - `GET {fhir_endpoint}/Condition?patient={fhir_id}`
  - `GET {fhir_endpoint}/DiagnosticReport?patient={fhir_id}`
- Records aggregated and returned as unified bundle
- Sensitive category records filtered at aggregation step if not opted in

#### Notification Service
- Push notifications to patient app on consent request received
- Push notifications on consent granted or denied
- Push notifications on new record uploaded
- SMS fallback (stub — can be mocked for demo)

#### Lab Upload Flow (W6)
- Two-step upload confirmation — upload then confirm against patient name and DOB display
- Discovery registry updated with new record metadata
- Patient notified on every new record addition

#### Patient App (Flutter) — Core Shell
- Biometric login and PIN
- Consent request inbox — grant and deny UI
- Basic unified record view — records from all institutions in one timeline
- New record push notifications

#### Doctor Portal Additions
- Access request screen with purpose declaration field
- Record viewer — displays fetched FHIR records in readable format
- Token status indicator — active, expiring, expired
- Sensitive category request UI — separate request flow

### Week-by-Week Breakdown

| Week | Focus | Deliverables |
|---|---|---|
| Week 4 | Consent service and token lifecycle | Policy creation, token issuance, token validation, revocation all working |
| Week 5 | Record fetch and FHIR integration | Full record fetch flow working, sensitive category filtering in place |
| Week 6 | Patient app shell and lab upload | Patient consents via app, lab uploads result, doctor sees it under existing token |

### End-of-Phase Test
Run Demo 1, Acts 1–4 completely without blockchain or ML:
- Act 1: Doctor searches for patient — discovery layer only
- Act 2: Doctor requests access, patient consents in app, doctor views Hospital 1 records
- Act 3: Doctor requests psychiatric history, patient grants separately, doctor views it
- Act 4: Lab uploads result, patient notified, doctor fetches under existing token

### Key Technical Risks This Phase
- FHIR resource aggregation across multiple nodes — test with all three nodes simultaneously
- Token validation latency — must be under 50ms; benchmark early
- Sensitive category filtering logic — test all combinations of opt-in and opt-out states
- Flutter push notifications on iOS and Android simulators — set up Firebase Cloud Messaging early

---

## 4. Phase 3 — Break-Glass and Audit (Weeks 7–9)

### Goal
Emergency access working end-to-end, and every significant event permanently recorded on the Ethereum blockchain with tamper-evident verification available in the patient app.

### What You Build

#### Break-Glass Access Flow (W16)
- Distinct break-glass UI — clearly marked, separate from standard access request
- Mandatory justification field
- Immediate 2-hour token issuance — patient safety not held hostage to any approval
- Upfront extended window request option (Branch A) — 4hr, 8hr, 12hr options
- Critical categories only — allergies, blood type, medications, chronic conditions
- Sensitive categories locked even under break-glass (psychiatric, reproductive, HIV)
- Real-time notification to patient and designated caregiver

#### Break-Glass Token Extension (W18)
- Branch A — upfront long-window request routed to supervisor while default 2hr access granted
- Branch B — pre-expiry extension request (soft warning at 90-minute mark)
  - Layer 1 auto-approval for routine Branch B requests where all checks pass
  - Layer 2 supervisor review when any check fails
- Branch C — post-expiry reinstatement
  - 15-minute read-only grace display window
  - Access suspended during review
  - Always Layer 2 minimum
  - New token issued from reinstatement approval time

#### Supervisor Model
- Layer 1 automated rule engine — checks same doctor, patient still incapacitated, first extension, within standard window, no misuse flags
- Layer 2 hospital doctor-supervisor UI — review queue, approve or deny with notes, 15-minute SLA
- Escalation routing if supervisor unresponsive

#### MedicalAuditLog Smart Contract (Solidity)
```solidity
// Deployed to Ganache local network
// authorizedWriter = backend wallet address only
// logEvent(), verifyEntry(), getPatientChain()
```
- Contract written, tested with Hardhat, deployed to Ganache
- `CONTRACT_ADDRESS` saved to backend config
- Backend wallet loaded as `authorizedWriter`

#### Audit Service
- Writes to `audit_events` MongoDB collection first (synchronous, fast)
- Submits blockchain transaction asynchronously — does not block the main request
- Backfills `blockchain_tx_hash` once transaction confirms
- Pre-computes `ml_features` fields at write time for Phase 4

#### Blockchain Event Chain
All event types logging correctly with `linked_event_id` chaining:
- `break_glass_triggered` → `break_glass_ext_requested` → `break_glass_ext_authorized` → `break_glass_expired` → `break_glass_reinstated`
- `consent_granted`, `consent_revoked`, `access_initiated`, `access_terminated`
- `sensitive_category_accessed`

#### Blockchain Verification Endpoint
- `GET /audit/verify/:event_id`
- Re-hashes MongoDB document, calls `contract.verifyEntry()`, returns true or false
- Patient app displays "Verified" or "Warning" indicator per audit entry

#### Patient App — Audit and Emergency Features
- Full audit log screen with filter by doctor, institution, date, access type
- Blockchain verification indicator per entry (tap to verify)
- Break-glass notification — distinct alert type with categories accessed shown
- Flag access event for review mechanism
- Emergency contact designation (W39)

### Week-by-Week Breakdown

| Week | Focus | Deliverables |
|---|---|---|
| Week 7 | Break-glass flows | W16 complete, Branch A working, supervisor Layer 1 and Layer 2 working |
| Week 8 | Smart contract and audit service | Contract deployed, all event types logging to blockchain and MongoDB |
| Week 9 | Branch B, Branch C, patient app audit | Full W18 implemented, blockchain verification in patient app, Demo 2 runnable |

### End-of-Phase Test
Run Demo 2 completely:
- Act 1: Safe harbor data visible without consent
- Act 2: Break-glass triggered with upfront 8hr extension request, caregiver notified
- Act 3: Critical categories accessed, psychiatric history locked, drug allergy found
- Act 4: Supervisor approves extension, blockchain chain shown with two linked entries
- Act 5: Patient sees break-glass event in audit log with blockchain verification returning true

Run Demo 3 partially:
- Patient app login, unified record timeline, audit log review, consent revocation, pre-authorization

### Key Technical Risks This Phase
- Async blockchain write not blocking main request — test under load
- Grace period state management — 15 minutes, read-only, clearly indicated in UI
- Ganache transaction confirmation speed — instant locally, but test the backfill logic
- Supervisor SLA enforcement — 15-minute escalation timer must be reliable

---

## 5. Phase 4 — ML Anomaly Detection (Weeks 10–12)

### Goal
The system is self-monitoring. Anomalous access behavior is detected in real time, scored, and responded to proportionately without human intervention for the first two tiers.

### What You Build

#### Synthetic Data Generation
- Script to generate 10,000 realistic normal access events with `ml_features` fields populated
- Script to generate 500 anomalous events across two categories:
  - Volume anomalies — bulk access, no clinical relationships, odd hours
  - Sequential misuse — repeated break-glass, prior consent relationship exists
- Scripts to seed Doctor D and Doctor E access histories for Demo 4

#### Isolation Forest Model
- Features: `records_accessed_last_hour`, `unique_patients_last_hour`, `hour_of_day`, `is_outside_shift_hours`, `has_declared_clinical_rel`, `fraction_without_relationship`, `deviation_from_baseline`, etc.
- Training: `IsolationForest(contamination=0.05, random_state=42)` on 10,000 normal events
- Serialized to `isolation_forest.pkl`
- Tested against 500 anomalous events — validate detection rate before proceeding

#### LSTM Autoencoder Model
- Sequence length: last 20 events per doctor
- Feature vector per event: `[event_type_encoded, hour_normalized, has_clinical_rel, is_break_glass, days_since_last_bg, patient_is_known, categories_hash]`
- Architecture: LSTM encoder (32 units) → RepeatVector → LSTM decoder → TimeDistributed Dense
- Trained as autoencoder — reconstruction error is the anomaly score
- Serialized to `lstm_autoencoder.h5`

#### Score Combiner
```python
# Break-glass events: LSTM weight 0.7, Isolation Forest 0.3
# Standard access events: Isolation Forest 0.6, LSTM 0.4
# Unified score 0.0–1.0
```

#### ML Scoring Service (Python FastAPI)
- `POST /ml/score` — receives audit event, returns `{ isolation_score, lstm_score, unified_score }`
- Called by Audit Service synchronously on every event write
- Latency target: under 100ms
- Anomaly score written back to `audit_events.ml_features.anomaly_score`

#### Graduated Response Pipeline
| Score | Response | Access Impact |
|---|---|---|
| < 0.5 | No action | None |
| 0.5–0.7 | Warning to doctor and admin, blockchain flag level 1 | None — access continues |
| 0.7–0.9 | Supervisor co-authorization required, blockchain flag level 2 | Access blocked until approved |
| > 0.9 | Ethics board escalation, permanent blockchain annotation, flag level 3 | Access blocked, case file generated |

#### Admin Dashboard
- Live access feed — all events across all doctors in real time
- Anomaly score per doctor — color coded: green (< 0.5), amber (0.5–0.7), red (> 0.7)
- Active cases — doctors currently restricted or escalated
- Blockchain query panel — audit chains for flagged doctors
- Distinct break-glass misuse indicator separate from general anomaly indicator

### Week-by-Week Breakdown

| Week | Focus | Deliverables |
|---|---|---|
| Week 10 | Data generation and model training | Both models trained and validated, scoring service returning results |
| Week 11 | Graduated response pipeline | Warning, restrict, escalate all triggering correctly and logging to blockchain |
| Week 12 | Admin dashboard and Demo 4 seeding | Dashboard complete, Doctor D and E histories seeded, Demo 4 runnable end-to-end |

### End-of-Phase Test
Run Demo 4 completely:
- Act 1: Dashboard shows live feed, Doctor D amber, Doctor E at second flag
- Act 2: Doctor D accesses five records — score crosses threshold, warning issued, status green → amber
- Act 3: Doctor D continues — second threshold crossed, supervisor co-authorization required, access blocked, status amber → red
- Act 4: Doctor E triggers new break-glass — third flag, blockchain annotated, escalated to admin, future break-glass requires upfront co-authorization
- Act 5: Full dashboard with both cases in audit log, blockchain chains for both doctors shown

### Key Technical Risks This Phase
- ML scoring latency under 100ms — benchmark Isolation Forest and LSTM separately
- LSTM sequence building — needs 20 prior events per doctor; handle cold start (fewer than 20 events)
- Graduated response pipeline wiring to Consent Service — test token blocking end-to-end
- Blockchain flag annotation as a distinct event type — verify chain integrity

---

## 6. Phase 5 — Integration, Demo Prep, and Polish (Weeks 13–15)

### Goal
All four demos run without interruption on a clean, consistently seeded environment. Every placeholder communicates clearly. The system is stable enough for a live examination.

### What You Build

#### Patient App — Remaining Features
- Medications section — active medications pulled from cross-institution prescription records
- Medication reminders — time-based push notifications (W37)
- Drug interaction flag — "coming soon" placeholder label (not functional — communicated honestly)
- Appointment booking at linked institutions with pre-authorization prompt during booking (W38)
- Upcoming appointments view with reminder notifications
- Sensitive category toggles — per-category opt-in controls (W33)
- Research data sharing opt-in toggle — single toggle, explanation of what is and is not shared (W40)
- Patient-reported family history — structured input form (W20)
- Wearable integration — "Connect Device" UI, non-functional placeholder
- Health summary — auto-generated from record data
- Vitals manual entry — basic form

#### Demo Environment
- Single-command demo reset script — wipes and re-seeds all databases and FHIR nodes to clean demo state
- Pre-seeded data across all three hospital nodes covering Demo 1 through Demo 4 world state
- Demo 1 seed: Patient A records at Hospital 1 (including psychiatric history), Doctor B at Hospital 2, Diagnostic Lab registered
- Demo 2 seed: Hospital 3 with Doctor C, Patient A with no prior relationship, designated caregiver contact
- Demo 4 seed: Doctor D with elevated access history ready to cross threshold on next action, Doctor E at second misuse flag ready to cross third
- Blockchain events pre-verified — all seeded audit events have `blockchain_tx_hash` confirmed

#### Integration Testing
- Full end-to-end run of all four demos — identify and fix every rough edge
- Cross-service failure testing — what happens when FHIR node is slow, blockchain write is delayed, ML service is unreachable
- Token expiry and grace period behavior under realistic timing
- Concurrent access testing — multiple doctors, multiple tokens active simultaneously

#### Documentation
- `README.md` — setup instructions, environment requirements, how to run the demo reset script
- Architecture diagrams in `/docs` — system overview, database schemas, API flows
- Submission report draft aligned to synopsis claims

### Week-by-Week Breakdown

| Week | Focus | Deliverables |
|---|---|---|
| Week 13 | Patient app remaining features and demo seed scripts | All patient app features complete, demo reset script working |
| Week 14 | Integration testing and bug fixing | All four demos run end-to-end, cross-service failure cases handled gracefully |
| Week 15 | Polish, rehearsal, and documentation | Demo scripts rehearsed, documentation complete, system stable for examination |

### End-of-Phase Test
Run all four demos back to back on a freshly reset environment without any intervention, errors, or placeholder failures breaking the narrative.

---

## 7. Sequencing Logic

Three principles drove this sequence:

### Dependencies First
Identity → Consent → Break-glass → ML. Each phase's core feature depends on the previous phase being stable.

- You cannot test break-glass extensions without working tokens (Phase 2)
- You cannot log audit events to the blockchain without knowing what events to log (Phase 2 and 3)
- You cannot score anomalies without a volume of audit events to score against (Phase 3)
- You cannot wire the graduated response pipeline without the Consent Service being stable (Phase 2)

### Demo-Driven Milestones
Phases 2, 3, and 4 each end with a specific demo scenario that can be run. Not a feature list — a working scenario. This keeps the project grounded and catches architectural problems early while there is still time to fix them.

### Risk Front-Loaded, Polish Back-Loaded
The hardest technical risks — FHIR integration, blockchain write latency, LSTM training, cross-service wiring — all land in Phases 1–4. Phase 5 is deliberately low-risk: data seeding, UI polish, and rehearsal. If any earlier phase slips by a few days, Phase 5 has the buffer to absorb it.

---

## 8. Demo Readiness by Phase

| Demo | First Runnable | Fully Complete |
|---|---|---|
| Demo 1 — The Clinical Journey | End of Phase 2 (without blockchain verification) | End of Phase 3 (with blockchain verification) |
| Demo 2 — The Emergency | End of Phase 3 | End of Phase 5 (with full seeding) |
| Demo 3 — The Patient App | End of Phase 3 (partial) | End of Phase 5 (all features present) |
| Demo 4 — The ML Detection Layer | End of Phase 4 | End of Phase 5 (with full seeding) |

---

## 9. Risk Register

| Risk | Phase | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| HAPI FHIR configuration issues | 1 | Medium | High | Allocate week 1 entirely to FHIR setup; have fallback mock FHIR endpoints ready |
| Token validation latency over 50ms | 2 | Low | Medium | Benchmark in week 4; add Redis caching for active tokens if needed |
| FHIR aggregation across three nodes too slow | 2 | Medium | Medium | Implement parallel FHIR calls; set per-node timeout of 3 seconds |
| Blockchain write blocking main request | 3 | Low | High | Audit service writes async from day one; test backfill logic separately |
| Ganache instability during long demo | 3 | Low | High | Snapshot Ganache state after seeding; restore from snapshot before demo |
| LSTM cold start with fewer than 20 events | 4 | High | Low | Handle gracefully — use Isolation Forest only until 20 events accumulated |
| ML scoring over 100ms latency | 4 | Medium | Medium | Benchmark week 10; pre-load models into memory; batch feature computation |
| Graduated response pipeline blocking legitimate access | 4 | Low | High | Test with flagged and unflagged doctors simultaneously in week 11 |
| Demo reset script missing edge cases | 5 | Medium | High | Run full reset and demo rehearsal at least three times in week 15 |
| Flutter push notifications not working on demo device | 2 | Medium | Low | Use in-app notification banner as fallback; do not rely on OS push for demo |

---

*End of build phases document.*
*All design decisions referenced here are locked in the project handoff document and the technical architecture document.*
