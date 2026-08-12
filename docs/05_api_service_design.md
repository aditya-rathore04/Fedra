# API Service Design
## Five Core Services — Endpoints, Schemas, and Flow

> **File:** `05_api_service_design.md`
> **Status:** Complete — all endpoints defined
> **Gateway:** Single unified Node.js gateway on port 3000
> **Auth:** JWT on every request — validated at gateway before reaching any service

---

## Gateway — Three Jobs on Every Request

```
1. AUTHENTICATION  — Validate JWT signature and expiry
                     Reject with 401 if invalid or missing

2. AUTHORIZATION   — Check role has permission for this endpoint
                     Reject with 403 if role not permitted

3. ROUTING         — Forward to the correct internal service
```

All five services are behind the gateway. No service is publicly exposed.

---

## JWT Token Structure

```json
{
  "user_id":       "DOC-uuid",
  "role":          "doctor",
  "institution_id":"HOSP-BLR-002",
  "issued_at":     1700000000,
  "expires_at":    1700028800
}
```

**Roles:** `doctor`, `patient`, `lab_technician`, `hospital_admin`, `doctor_supervisor`, `system_admin`

**Token lifetime by role:**

|         Role              |         Lifetime           |
|---------------------------|----------------------------|
| Doctor                    | 8 hours                    |
| Patient                   | 24 hours                   |
| Lab technician            | 8 hours                    |
| Admin                     | 4 hours                    |
| Break-glass access token  | 2 hours (default)          |

---

## Rate Limiting

| Endpoint | Limit | Reason |
|---|---|---|
| `POST /auth/login` | 5 requests / 10 min per IP | Brute force prevention |
| `GET /patient/search` | 30 requests / min per doctor | Anomalous bulk search detection |
| `POST /records/fetch` | 60 requests / min per token | Unusual volume flag |
| `POST /consent/break-glass` | 3 requests / hour per doctor | Break-glass misuse friction |

Rate limit hits are logged to the Audit Service as events — they feed directly into the ML anomaly scoring pipeline.

---

## Service 1 — Identity Service

**Responsibility:** Who are you? Onboarding, login, and JWT issuance.

### Endpoints

#### `POST /auth/register/doctor`
Register a new doctor.

**Request:**
```json
{
  "name": "Dr. Arjun Nair",
  "email": "arjun.nair@hosp-blr.com",
  "institution_id": "HOSP-BLR-002",
  "abha_id": "ABHA-DOC-1234",
  "medical_license_number": "KA-MCI-56789"
}
```

**Response `201`:**
```json
{
  "user_id": "DOC-uuid",
  "role": "doctor",
  "status": "pending_verification"
}
```

---

#### `POST /auth/register/patient`
Register a new patient.

**Request:**
```json
{
  "name": "Priya Sharma",
  "dob": "1990-04-15",
  "gender": "female",
  "abha_id": "ABHA-1234-5678-9012",
  "phone": "+91-9876543210"
}
```

**Response `201`:**
```json
{
  "user_id": "PAT-uuid",
  "health_id": "ABHA-1234-5678-9012",
  "role": "patient"
}
```

---

#### `POST /auth/login`
Login and receive JWT.

**Request:**
```json
{
  "email": "arjun.nair@hosp-blr.com",
  "password": "hashed-password"
}
```

**Response `200`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1700028800,
  "role": "doctor"
}
```

---

#### `POST /auth/refresh`
Refresh an expiring JWT.

**Headers:** `Authorization: Bearer <token>`

**Response `200`:**
```json
{
  "token": "new-jwt-token",
  "expires_at": 1700057600
}
```

---

## Service 2 — Discovery Service

**Responsibility:** Where do records exist? Patient search and registry management.

### Endpoints

#### `GET /patient/search?health_id=ABHA-1234-5678-9012`
Search for a patient by ABHA. Returns institution list only — no clinical content.

**Headers:** `Authorization: Bearer <doctor-token>`

**Response `200`:**
```json
{
  "health_id": "ABHA-1234-5678-9012",
  "patient_name": "Priya Sharma",
  "institutions": [
    {
      "institution_id": "HOSP-MYS-001",
      "institution_name": "Mysore General Hospital",
      "record_summary": {
        "total_records": 12,
        "categories_present": ["allergy", "medication", "condition", "lab_result"],
        "sensitive_categories_present": ["psychiatric"],
        "date_range": {
          "earliest": "2018-03-01",
          "latest": "2024-11-20"
        }
      },
      "node_status": "active"
    }
  ]
}
```

**Permitted roles:** `doctor`, `doctor_supervisor`

---

#### `POST /registry/register`
Register a new record in the discovery index. Called by hospital systems when a record is uploaded.

**Request:**
```json
{
  "health_id": "ABHA-1234-5678-9012",
  "institution_id": "HOSP-MYS-001",
  "record_id": "REC-uuid",
  "fhir_resource_type": "MedicationRequest",
  "category": "medication",
  "sensitive_category": null
}
```

**Response `201`:**
```json
{ "registered": true, "registry_entry_updated": true }
```

**Permitted roles:** `hospital_admin`, `lab_technician`

---

## Service 3 — Consent Service

**Responsibility:** Can you access this? Consent policies, access tokens, and break-glass flows.

### Endpoints

#### `POST /consent/request`
Doctor requests access to a patient's records.

**Request:**
```json
{
  "health_id": "ABHA-1234-5678-9012",
  "purpose": "Cardiology follow-up — post-emergency care",
  "institution_id": "HOSP-BLR-002"
}
```

**Response `202`:**
```json
{
  "request_id": "REQ-uuid",
  "status": "pending_patient_consent",
  "patient_notified": true
}
```

---

#### `POST /consent/grant`
Patient grants consent to a doctor.

**Request:**
```json
{
  "request_id": "REQ-uuid",
  "scope": {
    "general_access": true,
    "sensitive_categories": {
      "psychiatric": false,
      "reproductive": false,
      "hiv": false,
      "substance_abuse": false
    }
  }
}
```

**Response `200`:**
```json
{
  "policy_id": "POL-uuid",
  "token_id": "TOK-uuid",
  "expires_at": 1700028800,
  "scope": { "general_access": true, "sensitive_categories": { ... } }
}
```

**Permitted roles:** `patient`

---

#### `POST /consent/revoke`
Patient revokes a doctor's consent. Immediately invalidates any active tokens.

**Request:**
```json
{ "policy_id": "POL-uuid" }
```

**Response `200`:**
```json
{
  "revoked": true,
  "active_tokens_invalidated": 1,
  "doctor_notified": true
}
```

---

#### `POST /consent/sensitive`
Patient grants or revokes access to a specific sensitive category.

**Request:**
```json
{
  "policy_id": "POL-uuid",
  "category": "psychiatric",
  "grant": true
}
```

**Response `200`:**
```json
{ "updated": true, "category": "psychiatric", "access": true }
```

---

#### `POST /consent/break-glass`
Emergency staff triggers break-glass access.

**Request:**
```json
{
  "health_id": "ABHA-1234-5678-9012",
  "justification": "Patient unconscious, suspected anaphylactic shock",
  "requested_duration_hrs": 8
}
```

**Response `200`:**
```json
{
  "token_id": "TOK-bg-uuid",
  "event_id": "BG-20241120-0042",
  "token_type": "break_glass",
  "default_window_hrs": 2,
  "expires_at": 1700007200,
  "extension_request_status": "pending_supervisor",
  "patient_notified": true,
  "caregiver_notified": true
}
```

**Permitted roles:** `doctor`, `doctor_supervisor`

---

#### `GET /consent/validate`
Internal endpoint — other services call this to validate a token before fetching records.

**Headers:** `X-Access-Token: TOK-uuid`

**Response `200`:**
```json
{
  "valid": true,
  "health_id": "ABHA-1234-5678-9012",
  "scope": { "general_access": true, "sensitive_categories": { ... } },
  "expires_at": 1700028800,
  "token_type": "standard"
}
```

**Response `401`:**
```json
{ "valid": false, "reason": "token_expired" }
```

---

## Service 4 — Notification Service

**Responsibility:** Stateless message dispatch. Receives events, sends notifications.

### Endpoints

#### `POST /notify`
Internal only — called by other services.

**Request:**
```json
{
  "recipient_id": "PAT-uuid",
  "recipient_role": "patient",
  "notification_type": "break_glass_triggered",
  "payload": {
    "doctor_name": "Dr. Arjun Nair",
    "institution": "Chennai Metro Hospital",
    "event_id": "BG-20241120-0042",
    "categories_accessed": ["allergy", "medication", "condition"]
  },
  "channel": ["push", "sms"]
}
```

**Response `202`:**
```json
{ "dispatched": true, "channels": ["push", "sms"] }
```

**Notification types:**
`consent_request_received`, `consent_granted`, `consent_revoked`,
`break_glass_triggered`, `break_glass_extended`, `break_glass_reinstated`,
`record_uploaded`, `token_expiring_soon`, `anomaly_warning`

---

## Service 5 — Audit Service

**Responsibility:** Log everything. MongoDB first, blockchain asynchronously.

### Endpoints

#### `POST /audit/log`
Internal only — called by all other services on significant events.

**Request:**
```json
{
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
    "token_id": "TOK-uuid"
  }
}
```

**Response `201`:**
```json
{
  "event_id": "EVT-uuid",
  "logged_to_mongodb": true,
  "blockchain_tx": "pending"
}
```

---

#### `GET /audit/patient/:health_id`
Patient retrieves their full access history.

**Headers:** `Authorization: Bearer <patient-token>`

**Response `200`:**
```json
{
  "health_id": "ABHA-1234-5678-9012",
  "events": [
    {
      "event_id": "EVT-uuid",
      "event_type": "break_glass_triggered",
      "actor": { "role": "doctor", "institution": "Chennai Metro Hospital" },
      "timestamp": "2024-11-20T14:32:00Z",
      "metadata": { "categories_accessed": ["allergy", "medication"] },
      "blockchain_tx_hash": "0xabc123...",
      "verified": true
    }
  ]
}
```

---

#### `GET /audit/verify/:event_id`
Verify a MongoDB audit record against the blockchain.

**Response `200`:**
```json
{
  "event_id": "EVT-uuid",
  "verified": true,
  "blockchain_tx_hash": "0xabc123...",
  "message": "Record matches blockchain — not tampered"
}
```

**Response `200` (tampered):**
```json
{
  "event_id": "EVT-uuid",
  "verified": false,
  "message": "Warning — record does not match blockchain"
}
```

---

## Records Fetch Flow

This is not a single service endpoint — it is an orchestrated flow across three services:

```
1. Doctor sends: POST /records/fetch
   Body: { health_id, institution_id, token_id }

2. Gateway validates JWT → routes to Consent Service

3. Consent Service validates access token:
   → Is it active? Not expired? Not revoked?
   → What categories is this token permitted to access?

4. Discovery Service resolves FHIR endpoint:
   → Looks up institution_id in registry
   → Returns fhir_endpoint URL

5. Backend calls hospital's HAPI FHIR server:
   GET {fhir_endpoint}/Patient?identifier={health_id}
   GET {fhir_endpoint}/AllergyIntolerance?patient={fhir_id}
   GET {fhir_endpoint}/MedicationRequest?patient={fhir_id}
   GET {fhir_endpoint}/Condition?patient={fhir_id}
   GET {fhir_endpoint}/DiagnosticReport?patient={fhir_id}

6. Sensitive category filter applied at aggregation:
   → Records with sensitive_category not in token scope are excluded

7. Unified FHIR bundle returned to doctor

8. Audit Service logs access_initiated event asynchronously

9. ML Service scores the event asynchronously
   → Anomaly score written back to audit_events
   → Graduated response triggered if threshold crossed
```

---

## Error Codes

| Code | Meaning |
|---|---|
| `401` | JWT missing, expired, or invalid |
| `403` | Role not permitted for this endpoint |
| `404` | Patient not found in registry |
| `409` | Consent policy already exists |
| `422` | Token expired or revoked — re-request consent |
| `423` | Access suspended — supervisor co-authorization required |
| `429` | Rate limit exceeded |
| `503` | Hospital node offline — records unavailable |

---

*API version 1.0 — all endpoints specified*
*Inter-service communication: REST (prototype) → event queue for production scale*
*Authentication: JWT HS256 · Token refresh: sliding window*
