# Phase 2 developer guide: backend and doctor portal

This guide walks the backend developer through building the Consent Service, the federated FHIR record aggregator, and the Doctor Portal additions for Phase 2.

You can test and verify all of your work using an automated test script before handing your endpoints over to your teammate. You do not need the Flutter mobile app to be ready to complete this work.

---

## Architecture overview

In Phase 2, the backend gateway in [`backend/index.js`](file:///c:/Users/adity/FEDRA/backend/index.js) takes on access control and clinical record aggregation.

The core services you need to build:
1. **Consent Service.** Manage policies, grant tokens, handle revocations, and provide sub-50 ms token validation.
2. **Federated record aggregator (`POST /records/fetch`).** Query Apollo, Fortis, and Max HAPI FHIR servers in parallel, filter out sensitive records, and return a unified bundle.
3. **Notification dispatcher (`POST /notify`).** Store and dispatch notification events.
4. **Doctor Portal additions (`frontend/`).** Add access request forms with a mandatory purpose input, token status timers, and the clinical records viewer.
5. **Automated test script (`scripts/test_phase2_consent.js`).** Prove all endpoints pass end to end before integrating with the mobile app.

---

## Step 1: MongoDB schemas in `system_db`

Connect to central MongoDB on port 27020. Implement two collections per [`docs/01_database_schema.md`](file:///c:/Users/adity/FEDRA/docs/01_database_schema.md#L198-L260).

### 1. Collection: `consent_policies`
Stores the agreement between a patient and a doctor.

```javascript
{
  "_id": ObjectId(),
  "policy_id": "POL-uuid",
  "request_id": "REQ-uuid",
  "health_id": "ABHA-1234-5678-9012",
  "doctor_id": "DOC-1",
  "institution_id": "HOSP-1",
  "status": "active", // "pending", "active", "revoked", "expired"
  "granted_at": new Date(),
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
  "purpose": "Cardiology follow-up post emergency care"
}
```

Indexes required:
```javascript
db.consent_policies.createIndex({ health_id: 1, doctor_id: 1, status: 1 });
db.consent_policies.createIndex({ request_id: 1 }, { unique: true, sparse: true });
db.consent_policies.createIndex({ policy_id: 1 }, { unique: true });
```

### 2. Collection: `access_tokens`
Stores short-lived access permits issued after consent is granted.

```javascript
{
  "_id": ObjectId(),
  "token_id": "TOK-uuid",
  "policy_id": "POL-uuid",
  "health_id": "ABHA-1234-5678-9012",
  "doctor_id": "DOC-1",
  "institution_id": "HOSP-1",
  "token_type": "standard", // "standard", "break_glass"
  "issued_at": new Date(),
  "expires_at": new Date(Date.now() + 8 * 3600 * 1000), // 8 hours for standard doctor access
  "status": "active", // "active", "revoked", "expired"
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

Indexes required:
```javascript
db.access_tokens.createIndex({ token_id: 1 }, { unique: true });
db.access_tokens.createIndex({ policy_id: 1 });
db.access_tokens.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }); // auto-clean expired tokens
```

---

## Step 2: Consent Service endpoints

Add these endpoints to [`backend/index.js`](file:///c:/Users/adity/FEDRA/backend/index.js) following [`docs/05_api_service_design.md`](file:///c:/Users/adity/FEDRA/docs/05_api_service_design.md#L222-L373).

### `POST /consent/request`
A doctor requests access to a patient record.
* Allowed roles: `doctor`, `doctor_supervisor`.
* Body: `{ health_id, purpose, institution_id }`.
* Actions:
  1. Verify the patient exists in `registry_db.registry_entries` or `system_db.users`.
  2. Create a pending policy record in `system_db.consent_policies` with a generated `request_id`.
  3. Send an internal notification via `POST /notify` of type `consent_request_received`.
* Response `202`:
  ```json
  {
    "request_id": "REQ-uuid",
    "status": "pending_patient_consent",
    "patient_notified": true
  }
  ```

### `GET /consent/pending`
The patient app calls this to check their inbox.
* Allowed roles: `patient`.
* Query or token filter: extract `health_id` from the logged-in patient's JWT.
* Returns all policies with `status: "pending"`.

### `POST /consent/grant`
The patient grants consent to a pending request.
* Allowed roles: `patient`.
* Body: `{ request_id, scope }`.
* Actions:
  1. Find the pending policy by `request_id`.
  2. Update policy status to `"active"` and set `granted_at: new Date()`.
  3. Generate a new `token_id` (such as `TOK-` plus UUID v4).
  4. Set `expires_at` to 8 hours from now per contract [`C-01`](file:///c:/Users/adity/FEDRA/project-memory/03_contracts.md#L25-L40).
  5. Insert the new token document into `system_db.access_tokens`.
* Response `200`:
  ```json
  {
    "policy_id": "POL-uuid",
    "token_id": "TOK-uuid",
    "expires_at": 1700028800,
    "scope": { ... }
  }
  ```

### `POST /consent/revoke`
The patient revokes consent.
* Allowed roles: `patient`.
* Body: `{ policy_id }`.
* Actions:
  1. Set `status: "revoked"` and `revoked_at: new Date()` on the policy.
  2. Update all active tokens referencing this `policy_id` to `status: "revoked"`.
* Response `200`:
  ```json
  {
    "revoked": true,
    "active_tokens_invalidated": 1,
    "doctor_notified": true
  }
  ```

### `POST /consent/sensitive`
Patient selectively grants or revokes a sensitive category on an active policy.
* Allowed roles: `patient`.
* Body: `{ policy_id, category, grant }`.
* Updates both the policy and any active tokens with the new category flag.

### `GET /consent/validate`
Internal validation endpoint called by the record aggregator before fetching data.
* Header: `X-Access-Token: TOK-uuid`.
* Contract rule: contract [`C-02`](file:///c:/Users/adity/FEDRA/project-memory/03_contracts.md#L41-L44) requires validation in under 50 ms.
* Check: find token in `system_db.access_tokens` where `status: "active"` and `expires_at > new Date()`. If MongoDB is slow, cache active tokens in an in-memory Map.
* Response `200`:
  ```json
  {
    "valid": true,
    "health_id": "ABHA-1234-5678-9012",
    "scope": { ... },
    "expires_at": 1700028800,
    "token_type": "standard"
  }
  ```

---

## Step 3: Record Fetch Aggregator (`POST /records/fetch`)

This is the central clinical endpoint in [`backend/index.js`](file:///c:/Users/adity/FEDRA/backend/index.js).

### Request
```json
{
  "health_id": "ABHA-DEMO-001",
  "token_id": "TOK-uuid"
}
```

### Orchestration steps
1. **JWT authentication.** Verify the doctor's Bearer token using `verifyJWT`.
2. **Access token validation.** Check `system_db.access_tokens` for `token_id`. Confirm the token is active, not expired, and belongs to the requested `health_id`.
3. **Lookup hospital locations.** Query `registry_db.registry_entries` for all entries matching `health_id`. Extract the `fhir_endpoint` for each hospital.
4. **Parallel FHIR queries.**
   * For each hospital node, fetch clinical resources:
     * `/Patient?identifier={health_id}`
     * `/Condition?patient={fhir_id}`
     * `/MedicationRequest?patient={fhir_id}`
     * `/AllergyIntolerance?patient={fhir_id}`
     * `/DiagnosticReport?patient={fhir_id}`
   * Execute queries across all three nodes simultaneously using `Promise.allSettled`.
   * Enforce contract [`C-08`](file:///c:/Users/adity/FEDRA/project-memory/03_contracts.md#L101-L104): 3000 ms timeout per node. If a node times out, flag that hospital as `"degraded"` in the response metadata and continue with the other nodes.
5. **Sensitive category filtering.**
   * Inspect each returned record's security labels or condition code tags.
   * If a record contains tags for `psychiatric`, `reproductive`, `hiv`, or `substance_abuse`, check the token's `scope.sensitive_categories`.
   * If the patient has not granted that category, strip the record out of the bundle before returning.
6. **Return unified response.**

```json
{
  "health_id": "ABHA-DEMO-001",
  "patient_name": "AdhiRaj",
  "retrieved_at": "2026-09-09T10:00:00Z",
  "node_statuses": {
    "HOSP-1": "active",
    "HOSP-2": "active",
    "HOSP-3": "active"
  },
  "records": {
    "allergies": [ ... ],
    "medications": [ ... ],
    "conditions": [ ... ],
    "lab_reports": [ ... ]
  }
}
```

---

## Step 4: Doctor Portal updates (`frontend/`)

Update [`frontend/dashboard.html`](file:///c:/Users/adity/FEDRA/frontend/dashboard.html):
1. **Access request modal.** When clicking a patient, show a dialog requiring a purpose declaration before submitting `POST /consent/request`.
2. **Token status badge.** When consent is granted, display a live timer showing token expiration (for example, "Token active: 7h 45m remaining").
3. **Clinical records viewer.** Render cards for allergies, medications, and conditions grouped by hospital source.
4. **Sensitive category button.** If sensitive categories exist in discovery metadata but are locked, display a button: "Request Psychiatric Records".

---

## Step 5: Verify with automated test script

Do not wait for the Flutter app. Write `scripts/test_phase2_consent.js` to simulate the full journey:

```javascript
// Outline of scripts/test_phase2_consent.js
const assert = require('assert');

async function runTests() {
  console.log('Testing Phase 2 Consent and Record Fetch...');

  // 1. Log in as Doctor
  // 2. Request consent for ABHA-DEMO-001
  // 3. Log in as Patient AdhiRaj
  // 4. Fetch pending requests, verify REQ-uuid exists
  // 5. Grant consent with psychiatric: false
  // 6. As Doctor, call POST /records/fetch with token_id
  //    Assert general conditions returned, psychiatric condition omitted
  // 7. As Patient, call POST /consent/sensitive (psychiatric: true)
  // 8. As Doctor, call POST /records/fetch again
  //    Assert psychiatric condition now visible
  // 9. As Patient, call POST /consent/revoke
  // 10. As Doctor, call POST /records/fetch
  //     Assert 401/422 Access Token Revoked

  console.log('All Phase 2 tests passed successfully!');
}

runTests();
```

When this script passes, your backend is ready. Tell your mobile teammate to flip `useMock = false` in their Flutter configuration and test together.
