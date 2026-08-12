# Database Schema
## Federated Medical Record Discovery and Secure Access System

> **File:** `01_database_schema.md`
> **Status:** Complete — implementation ready
> **Domain:** Three logically separate databases across the system

---

## Overview

The system uses three distinct MongoDB database domains. Each maps to a different owner and purpose.

| Database | Owner | Purpose |
|---|---|---|
| `hospital_node_db` | Each hospital (one instance per hospital) | Clinical record metadata and FHIR pointers |
| `registry_db` | The system | Discovery index — knows where records exist |
| `system_db` | The system | Consent policies, access tokens, audit events |

---

## Database 1 — Hospital Node (`hospital_node_db`)

One instance per hospital. Stores metadata and pointers to the HAPI FHIR server. Never stores raw clinical content directly.

### Collection: `patients`

```json
{
  "_id": "ObjectId()",
  "health_id": "ABHA-1234-5678-9012",
  "hospital_uuid": "HOSP-MYS-001",

  "demographics": {
    "name": "Priya Sharma",
    "dob": "1990-04-15",
    "blood_type": "B+",
    "gender": "female"
  },

  "safe_harbor": {
    "critical_allergies": ["Penicillin", "Sulfa drugs"],
    "emergency_contact": {
      "name": "Ravi Sharma",
      "phone": "+91-9876543210"
    }
  },

  "records": [
    {
      "record_id": "REC-uuid-001",
      "fhir_resource_type": "AllergyIntolerance",
      "fhir_resource_id": "fhir-allergy-uuid",
      "category": "allergy",
      "sensitive_category": null,
      "created_at": "ISODate()",
      "uploaded_by": {
        "institution": "HOSP-MYS-001",
        "doctor_id": "DOC-uuid"
      },
      "version": 1,
      "superseded_by": null
    },
    {
      "record_id": "REC-uuid-002",
      "fhir_resource_type": "MedicationRequest",
      "fhir_resource_id": "fhir-med-uuid",
      "category": "medication",
      "sensitive_category": null,
      "created_at": "ISODate()",
      "uploaded_by": {
        "institution": "HOSP-MYS-001",
        "doctor_id": "DOC-uuid"
      },
      "version": 1,
      "superseded_by": null
    },
    {
      "record_id": "REC-uuid-003",
      "fhir_resource_type": "Condition",
      "fhir_resource_id": "fhir-condition-uuid",
      "category": "condition",
      "sensitive_category": "psychiatric",
      "created_at": "ISODate()",
      "uploaded_by": {
        "institution": "HOSP-MYS-001",
        "doctor_id": "DOC-uuid"
      },
      "version": 1,
      "superseded_by": null
    }
  ],

  "family_history": {
    "reported_by_patient": true,
    "entries": [
      {
        "relation": "father",
        "condition": "Type 2 Diabetes",
        "deceased": true,
        "cause_of_death": "Cardiac arrest"
      }
    ]
  }
}
```

### Field Notes

| Field | Purpose |
|---|---|
| `health_id` | ABHA as the primary lookup key — never name or DOB |
| `safe_harbor` | Accessible without consent or break-glass to any verified provider |
| `records[].fhir_resource_id` | Pointer to HAPI FHIR — clinical content lives there, not here |
| `records[].sensitive_category` | `null` for general records. One of `psychiatric`, `reproductive`, `hiv`, `substance_abuse` for sensitive records. Drives the separate opt-in gate. |
| `records[].superseded_by` | Versioning chain — records are never overwritten, only chained |

### Indexes

```javascript
db.patients.createIndex({ health_id: 1 }, { unique: true })
db.patients.createIndex({ hospital_uuid: 1 })
```

---

## Database 2 — Discovery Registry (`registry_db`)

### Collection: `registry_entries`

The central index. Knows that records exist and where — never what they contain.

```json
{
  "_id": "ObjectId()",
  "health_id": "ABHA-1234-5678-9012",
  "institution_id": "HOSP-MYS-001",
  "institution_name": "Mysore General Hospital",
  "fhir_endpoint": "http://hospital1-fhir:8080/fhir",

  "record_summary": {
    "total_records": 12,
    "categories_present": ["allergy", "medication", "condition", "lab_result", "imaging"],
    "sensitive_categories_present": ["psychiatric"],
    "date_range": {
      "earliest": "ISODate(2018-03-01)",
      "latest": "ISODate(2024-11-20)"
    }
  },

  "node_status": "active",
  "last_verified": "ISODate()",
  "registered_at": "ISODate()"
}
```

### Field Notes

| Field | Purpose |
|---|---|
| `fhir_endpoint` | Internal Docker container name — used by backend to call the hospital's FHIR server at access time |
| `sensitive_categories_present` | Tells doctors a separate opt-in gate exists — does not reveal content |
| `node_status` | One of `active`, `offline`, `offboarding` — handles node failure and exit scenarios |

### Indexes

```javascript
db.registry_entries.createIndex({ health_id: 1 })
db.registry_entries.createIndex({ health_id: 1, node_status: 1 })
```

---

## Database 3 — System Database (`system_db`)

### Collection: `users`

```json
{
  "_id": "ObjectId()",
  "user_id": "DOC-uuid",
  "health_id": "ABHA-1234-5678-9012",
  "role": "doctor",
  "institution_id": "HOSP-BLR-002",
  "name": "Dr. Arjun Nair",
  "email": "arjun.nair@hosp-blr.com",
  "abha_verified": true,
  "created_at": "ISODate()",
  "misuse_flag_count": 0,
  "supervisor_coauth_required": false
}
```

**Roles:** `doctor`, `patient`, `lab_technician`, `hospital_admin`, `doctor_supervisor`, `system_admin`

---

### Collection: `consent_policies`

```json
{
  "_id": "ObjectId()",
  "policy_id": "POL-uuid",
  "health_id": "ABHA-1234-5678-9012",
  "doctor_id": "DOC-uuid",
  "institution_id": "HOSP-BLR-002",

  "status": "active",
  "granted_at": "ISODate()",
  "revoked_at": null,

  "scope": {
    "general_access": true,
    "sensitive_categories": {
      "psychiatric": false,
      "reproductive": false,
      "hiv": false,
      "substance_abuse": false
    }
  },

  "purpose": "Cardiology follow-up — post-emergency care",
  "pre_authorized": false,
  "pre_auth_conditions": null
}
```

### Indexes

```javascript
db.consent_policies.createIndex({ health_id: 1, doctor_id: 1, status: 1 })
db.consent_policies.createIndex({ health_id: 1, status: 1 })
```

---

### Collection: `access_tokens`

```json
{
  "_id": "ObjectId()",
  "token_id": "TOK-uuid",
  "health_id": "ABHA-1234-5678-9012",
  "doctor_id": "DOC-uuid",
  "institution_id": "HOSP-BLR-002",

  "token_type": "standard",

  "issued_at": "ISODate()",
  "expires_at": "ISODate()",
  "status": "active",

  "consent_policy_id": "POL-uuid",

  "break_glass_context": null
}
```

**`token_type` values:** `standard`, `break_glass`, `sustained_care`

**`status` values:** `active`, `expired`, `revoked`, `grace_period`

**Break-glass context (populated when `token_type = break_glass`):**

```json
"break_glass_context": {
  "event_id": "BG-20241120-0042",
  "justification": "Patient unconscious, suspected drug reaction",
  "extension_history": [
    {
      "requested_at": "ISODate()",
      "approved_by": "SUP-uuid",
      "supervisor_type": "layer2_hospital",
      "duration_added_hrs": 8,
      "approved_at": "ISODate()"
    }
  ],
  "grace_period_started_at": null,
  "reinstated_at": null
}
```

### Indexes

```javascript
db.access_tokens.createIndex({ token_id: 1 }, { unique: true })
db.access_tokens.createIndex({ health_id: 1, status: 1, expires_at: 1 })
db.access_tokens.createIndex({ doctor_id: 1, status: 1 })
```

---

### Collection: `audit_events`

```json
{
  "_id": "ObjectId()",
  "event_id": "EVT-uuid",
  "blockchain_tx_hash": "0xabc123...",

  "event_type": "consent_granted",

  "actor": {
    "id": "DOC-uuid",
    "role": "doctor",
    "institution": "HOSP-BLR-002"
  },

  "subject_health_id": "ABHA-1234-5678-9012",
  "linked_event_id": null,

  "metadata": {
    "purpose": "Cardiology follow-up",
    "categories_accessed": ["medication", "allergy"],
    "token_id": "TOK-uuid",
    "justification": null
  },

  "timestamp": "ISODate()",

  "ml_features": {
    "hour_of_day": 14,
    "day_of_week": 2,
    "is_outside_shift_hours": false,
    "is_weekend": false,
    "has_clinical_relationship": true,
    "is_break_glass": false,
    "records_accessed_count": 8,
    "unique_patients_last_hour": 3,
    "fraction_without_relationship": 0.05,
    "deviation_from_baseline": 0.12,
    "anomaly_score": null
  }
}
```

**`event_type` values:**
`consent_granted`, `consent_revoked`, `access_initiated`, `access_terminated`,
`break_glass_triggered`, `break_glass_extended`, `break_glass_reinstated`,
`sensitive_category_accessed`, `anomaly_flagged`, `record_uploaded`, `record_amended`

### Indexes

```javascript
db.audit_events.createIndex({ subject_health_id: 1, timestamp: -1 })
db.audit_events.createIndex({ "actor.id": 1, timestamp: -1 })
db.audit_events.createIndex({ linked_event_id: 1 })
db.audit_events.createIndex({ event_type: 1, timestamp: -1 })
```

---

## FHIR Resource Mapping

Clinical content lives in HAPI FHIR at each hospital node. MongoDB stores only the metadata pointer.

| Record Type | FHIR R4 Resource | Category Tag |
|---|---|---|
| Drug allergies | `AllergyIntolerance` | `allergy` |
| Prescriptions | `MedicationRequest` | `medication` |
| Diagnoses / conditions | `Condition` | `condition` |
| Lab results | `DiagnosticReport` + `Observation` | `lab_result` |
| Imaging studies | `ImagingStudy` + `Media` | `imaging` |
| Vital signs | `Observation` | `vitals` |
| Patient demographics | `Patient` | — |
| Clinical visits | `Encounter` | `encounter` |
| Immunizations | `Immunization` | `immunization` |

---

*Schema version 1.0 — all fields implementation-ready*
*Sensitive category values: `psychiatric`, `reproductive`, `hiv`, `substance_abuse`*
*Node status values: `active`, `offline`, `offboarding`*
