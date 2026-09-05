# Project Glossary & Domain Concepts

Terminology, workflow branches, and demo personas used throughout Fedra.

---

## 🔑 Core Concepts

| Term | Definition |
|---|---|
| **ABHA** | *Ayushman Bharat Health Account* — The 14-digit national patient health identifier used in India's digital health ecosystem (represented in demo as `ABHA-DEMO-XXX`). |
| **Break-Glass** | Emergency access protocol allowing an emergency physician to bypass standard patient consent when a patient is unconscious or in life-threatening condition. Requires written clinical justification and triggers immutable audit logging. |
| **Grace Period** | A 15-minute window following the expiration of a 2-hour break-glass token during which a doctor can request a 1-hour extension. |
| **Consent Policy** | A cryptographically validated record created when a patient approves a doctor's access request, specifying permitted clinical categories and expiration date. |
| **Access Token** | A scoped, short-lived token issued by the Consent Service permitting the backend to query specific FHIR endpoints on behalf of an authorized doctor. |
| **Notary Stamp** | The pattern where complete records live off-chain in MongoDB, while only cryptographic hashes (`keccak256`) and actor proofs are committed to Ethereum. |

---

## 🔀 Workflow Branches

- **Branch A — Standard Consent Happy Path:**
  Doctor searches patient ABHA → views hospital locations → requests access for specific categories → Patient approves via mobile app → Doctor views aggregated FHIR bundle → Access event logged.
- **Branch B — Patient Denies / Selective Exclusions:**
  Patient denies consent OR approves general records while explicitly gating sensitive categories (psychiatric/HIV/substance abuse) → Gateway filters out unauthorized categories during FHIR bundle aggregation.
- **Branch C — Break-Glass Emergency:**
  Patient is unresponsive → Doctor declares emergency with mandatory justification text → System issues 2-hour break-glass token → Emergency push sent to patient/family → Smart contract creates immutable event chain → ML pipeline monitors event sequence.

---

## 👥 Demo Personas

| Persona ID | Name / Role | Institution | Purpose in Demos |
|---|---|---|---|
| `PAT-001` | **AdhiRaj** (`ABHA-DEMO-001`) | All 3 Hospitals | Primary patient persona. Holds cardiology records at Apollo, prescriptions at Fortis, and lab reports at Max. |
| `DOC-1` | **Dr. Aditya Sharma** | Apollo Memorial (`HOSP-1`) | Treating cardiologist demonstrating Branch A (Standard Consent & Discovery). |
| `DOC-2` | **Dr. Priya Patel** | Fortis Healthcare (`HOSP-2`) | Internal medicine specialist demonstrating cross-hospital record aggregation. |
| `DOC-EMERGENCY` | **Dr. Rahul Verma (ER)** | Apollo Memorial (`HOSP-1`) | Emergency physician demonstrating Branch C (Break-Glass & Grace Period Extension). |
| `DOC-ANOMALOUS` | **Dr. Anomalous (Flagged)** | Fortis Healthcare (`HOSP-2`) | Doctor performing excessive rapid searches and out-of-hours bulk accesses to trigger Demo 4 ML graduated responses. |

---

## 🏷️ System Constants

### Sensitive Clinical Categories
Records flagged with these categories require explicit secondary opt-in and are excluded by default:
- `psychiatric`
- `reproductive`
- `hiv`
- `substance_abuse`

### Federated Node Status Values
- `active`: Hospital node is fully online and responding within <3000ms.
- `sync_pending`: Node has uploaded new records that have not yet been indexed in central registry.
- `degraded`: Node response time exceeded timeout threshold; gateway returns partial federation results.
- `offline`: Node connection refused; gateway notifies doctor that hospital's records are temporarily unavailable.
