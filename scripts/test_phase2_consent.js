/**
 * FEDRA — Phase 2 Core Access Control & Consent Service Verification Suite
 * Tests:
 *   1. Gateway & Phase 2 collection indexing
 *   2. Doctor access request (POST /consent/request) & input validation
 *   3. Patient pending requests inbox (GET /consent/pending)
 *   4. Patient standard consent grant (POST /consent/grant) & 8h token issuance
 *   5. Sub-50ms token validation (GET /consent/validate - Contract C-02 SLA)
 *   6. Federated FHIR record fetch (POST /records/fetch) with sensitive category filtering
 *   7. Selective sensitive category grant (POST /consent/sensitive)
 *   8. Re-fetch verifying previously locked psychiatric records are now unlocked
 *   9. Consent revocation (POST /consent/revoke) & token invalidation (422)
 *  10. Emergency break-glass access (POST /consent/break-glass) & sensitive lock invariant
 *  11. Safe harbor emergency access (GET /patient/:health_id/safe-harbor)
 *  12. MongoDB Audit Trail verification (GET /audit/patient/:health_id)
 *
 * Usage: node scripts/test_phase2_consent.js
 */

const path = require('path');
let MongoClient;
try {
  ({ MongoClient } = require('mongodb'));
} catch (e) {
  ({ MongoClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mongodb')));
}

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const MONGO_SYSTEM_URI = process.env.MONGO_SYSTEM_URI || 'mongodb://localhost:27020';

const LAKSHMI_ABHA = 'ABHA-4471-2298-6613';

async function runTests() {
  console.log('================================================================');
  console.log('  FEDRA — Phase 2 Consent Service & Access Control Verification');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.error(`  FAIL: ${message}`);
      failed++;
    }
  }

  const sysClient = new MongoClient(MONGO_SYSTEM_URI);

  try {
    await sysClient.connect();
    const systemDb = sysClient.db('system_db');

    // -------------------------------------------------------------
    // Test 1: Gateway & Database Health
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying Gateway & Phase 2 Collections...');
    const healthRes = await fetch(`${GATEWAY_URL}/health`);
    const health = await healthRes.json();
    assert(healthRes.status === 200, 'Gateway responds HTTP 200 on /health');
    assert(health.databases.system_db === true, 'Connected to system_db');
    assert(health.databases.registry_db === true, 'Connected to registry_db');

    // Verify collections in MongoDB
    const collections = await systemDb.listCollections().toArray();
    const colNames = collections.map(c => c.name);
    assert(colNames.includes('consent_policies'), 'system_db.consent_policies collection exists');
    assert(colNames.includes('access_tokens'), 'system_db.access_tokens collection exists');
    assert(colNames.includes('audit_events'), 'system_db.audit_events collection exists');

    // -------------------------------------------------------------
    // Test 2: Doctor and Patient Authentication
    // -------------------------------------------------------------
    console.log('\n[Test 2] Authenticating Doctor and Patient Demo Personas...');
    const docLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doc1@test.com', password: 'password123' })
    });
    const docData = await docLoginRes.json();
    assert(docLoginRes.status === 200 && !!docData.token, 'Doctor A (DOC-1) login succeeds with 200');
    const docToken = docData.token;

    const patLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
    });
    const patData = await patLoginRes.json();
    assert(patLoginRes.status === 200 && !!patData.token, 'Patient Lakshmi login succeeds with 200');
    const patToken = patData.token;

    // -------------------------------------------------------------
    // Test 3: Doctor Requests Access (POST /consent/request)
    // -------------------------------------------------------------
    console.log('\n[Test 3] Doctor Creates Consent Request...');
    
    // Validation check: Missing purpose rejected with 400
    const invalidReqRes = await fetch(`${GATEWAY_URL}/consent/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${docToken}`
      },
      body: JSON.stringify({ health_id: LAKSHMI_ABHA })
    });
    assert(invalidReqRes.status === 400, 'Request without purpose rejected with 400');

    // Valid request
    const createReqRes = await fetch(`${GATEWAY_URL}/consent/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${docToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        purpose: 'Cardiology evaluation post emergency room admission',
        institution_id: 'HOSP-1'
      })
    });
    const createReq = await createReqRes.json();
    assert(createReqRes.status === 202, 'Doctor consent request accepted with 202');
    assert(createReq.status === 'pending_patient_consent', 'Response status is pending_patient_consent');
    assert(!!createReq.request_id, 'Generated request_id returned');
    assert(!!createReq.policy_id, 'Generated policy_id returned');

    const requestId = createReq.request_id;
    const policyId = createReq.policy_id;

    // -------------------------------------------------------------
    // Test 4: Patient Checks Pending Inbox (GET /consent/pending)
    // -------------------------------------------------------------
    console.log('\n[Test 4] Patient Checks Pending Consent Inbox...');
    const inboxRes = await fetch(`${GATEWAY_URL}/consent/pending`, {
      headers: { 'Authorization': `Bearer ${patToken}` }
    });
    const inbox = await inboxRes.json();
    assert(inboxRes.status === 200, 'Patient pending inbox returns 200');
    assert(inbox.count >= 1, `Pending inbox contains requests (got ${inbox.count})`);
    
    const matchingReq = inbox.pending_requests.find(r => r.request_id === requestId);
    assert(!!matchingReq, `Target request_id ${requestId} present in patient inbox`);
    assert(matchingReq.doctor_id === 'DOC-1', 'Request records correct doctor_id (DOC-1)');

    // -------------------------------------------------------------
    // Test 5: Patient Grants Standard Consent (POST /consent/grant)
    // -------------------------------------------------------------
    console.log('\n[Test 5] Patient Grants Standard Consent (Psychiatric Excluded)...');
    const grantRes = await fetch(`${GATEWAY_URL}/consent/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${patToken}`
      },
      body: JSON.stringify({
        request_id: requestId,
        scope: {
          general_access: true,
          sensitive_categories: {
            psychiatric: false,
            reproductive: false,
            hiv: false,
            substance_abuse: false
          }
        }
      })
    });
    const grantData = await grantRes.json();
    assert(grantRes.status === 200, 'Consent grant returns 200');
    assert(grantData.policy_id === policyId, 'Returned policy_id matches');
    assert(!!grantData.token_id, 'Short-lived access token_id issued');
    assert(grantData.scope.sensitive_categories.psychiatric === false, 'Psychiatric records explicitly excluded in initial grant');

    const tokenId = grantData.token_id;

    // -------------------------------------------------------------
    // Test 6: Sub-50ms Token Validation (Contract C-02 SLA)
    // -------------------------------------------------------------
    console.log('\n[Test 6] Sub-50ms Token Validation (Contract C-02 SLA)...');
    const valStart = Date.now();
    const valRes = await fetch(`${GATEWAY_URL}/consent/validate`, {
      headers: { 'X-Access-Token': tokenId }
    });
    const valElapsed = Date.now() - valStart;
    const valData = await valRes.json();
    assert(valRes.status === 200, 'Token validation returns 200');
    assert(valData.valid === true, 'Token is marked valid');
    assert(valElapsed < 50, `Contract C-02 SLA: Token validation completed in under 50ms (took ${valElapsed}ms)`);

    // -------------------------------------------------------------
    // Test 7: Record Fetch Aggregator (Sensitive Excluded)
    // -------------------------------------------------------------
    console.log('\n[Test 7] Record Fetch Aggregator (Sensitive Category Locked)...');
    const fetch1Res = await fetch(`${GATEWAY_URL}/records/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${docToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        token_id: tokenId
      })
    });
    const bundle1 = await fetch1Res.json();
    assert(fetch1Res.status === 200, 'Record fetch aggregator returns 200');
    assert(bundle1.node_statuses['HOSP-1'] === 'active', 'Apollo node status is active');
    assert(bundle1.records.conditions.length > 0, `General conditions retrieved (got ${bundle1.records.conditions.length})`);

    // Assert that psychiatric condition is excluded
    const hasPsych1 = bundle1.records.conditions.some(c => 
      c.id === 'lakshmi-cond-adj-disorder' || 
      (c.meta?.security || []).some(s => s.code === 'PSY')
    );
    assert(!hasPsych1, 'Security Gate Verified: Psychiatric condition is EXCLUDED when sensitive consent not granted');
    assert(bundle1.sensitive_records_filtered_count >= 1, `Sensitive records filtered count is recorded (got ${bundle1.sensitive_records_filtered_count})`);

    // -------------------------------------------------------------
    // Test 8: Patient Selectively Grants Psychiatric Records
    // -------------------------------------------------------------
    console.log('\n[Test 8] Patient Grants Psychiatric Category Access (POST /consent/sensitive)...');
    const sensRes = await fetch(`${GATEWAY_URL}/consent/sensitive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${patToken}`
      },
      body: JSON.stringify({
        policy_id: policyId,
        category: 'psychiatric',
        grant: true
      })
    });
    const sensData = await sensRes.json();
    assert(sensRes.status === 200, 'Sensitive toggle returns 200');
    assert(sensData.updated === true, 'Permission updated flag is true');
    assert(sensData.category === 'psychiatric' && sensData.access === true, 'Psychiatric category access set to true');

    // -------------------------------------------------------------
    // Test 9: Doctor Re-fetches Records (Psychiatric Now Included)
    // -------------------------------------------------------------
    console.log('\n[Test 9] Doctor Re-fetches Records (Psychiatric Category Unlocked)...');
    const fetch2Res = await fetch(`${GATEWAY_URL}/records/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${docToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        token_id: tokenId
      })
    });
    const bundle2 = await fetch2Res.json();
    assert(fetch2Res.status === 200, 'Second record fetch returns 200');
    
    // Assert psychiatric condition is now visible
    const hasPsych2 = bundle2.records.conditions.some(c => 
      c.id === 'lakshmi-cond-adj-disorder' || 
      (c.meta?.security || []).some(s => s.code === 'PSY')
    );
    assert(hasPsych2, 'Dynamic Permission Verified: Psychiatric condition is now INCLUDED after opt-in grant');

    // -------------------------------------------------------------
    // Test 10: Patient Revokes Consent (POST /consent/revoke)
    // -------------------------------------------------------------
    console.log('\n[Test 10] Patient Revokes Consent & Invalidates Active Token...');
    const revokeRes = await fetch(`${GATEWAY_URL}/consent/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${patToken}`
      },
      body: JSON.stringify({ policy_id: policyId })
    });
    const revokeData = await revokeRes.json();
    assert(revokeRes.status === 200, 'Consent revoke returns 200');
    assert(revokeData.revoked === true, 'Revoked boolean is true');
    assert(revokeData.active_tokens_invalidated >= 1, 'Active tokens invalidated count >= 1');

    // Doctor tries to query with the revoked token
    const fetchRevokedRes = await fetch(`${GATEWAY_URL}/records/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${docToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        token_id: tokenId
      })
    });
    assert(fetchRevokedRes.status === 422, 'Fetch with revoked token rejected with 422');

    // -------------------------------------------------------------
    // Test 11: Emergency Break-Glass Access (POST /consent/break-glass)
    // -------------------------------------------------------------
    console.log('\n[Test 11] Emergency Break-Glass Access & Sensitive Lock Invariant...');
    const erLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'er@test.com', password: 'password123' })
    });
    const erData = await erLoginRes.json();
    const erToken = erData.token;

    // Short justification should be rejected
    const badBgRes = await fetch(`${GATEWAY_URL}/consent/break-glass`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${erToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        justification: 'Emergency'
      })
    });
    assert(badBgRes.status === 400, 'Break-glass with justification < 10 chars rejected with 400');

    // Valid break-glass request
    const bgRes = await fetch(`${GATEWAY_URL}/consent/break-glass`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${erToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        justification: 'Patient unconscious in ER with severe acute chest pain and suspected cardiogenic shock',
        requested_duration_hrs: 2
      })
    });
    const bgData = await bgRes.json();
    assert(bgRes.status === 200, 'Break-glass declaration returns 200');
    assert(bgData.token_type === 'break_glass', 'Token type is break_glass');
    assert(bgData.default_window_hrs === 2, 'Default emergency window is strictly 2 hours (C-01)');
    assert(!!bgData.token_id, 'Emergency token_id issued');

    const bgTokenId = bgData.token_id;

    // Fetch records under break-glass token
    const bgFetchRes = await fetch(`${GATEWAY_URL}/records/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${erToken}`
      },
      body: JSON.stringify({
        health_id: LAKSHMI_ABHA,
        token_id: bgTokenId
      })
    });
    const bgBundle = await bgFetchRes.json();
    assert(bgFetchRes.status === 200, 'Record fetch under break-glass token returns 200');
    assert(bgBundle.records.allergies.length > 0, 'Critical allergies accessible under break-glass');
    
    // Invariant: Psychiatric records must stay locked under break-glass
    const hasPsychBg = bgBundle.records.conditions.some(c => 
      c.id === 'lakshmi-cond-adj-disorder' || 
      (c.meta?.security || []).some(s => s.code === 'PSY')
    );
    assert(!hasPsychBg, 'Break-Glass Lockdown Invariant: Psychiatric records remain LOCKED under emergency break-glass');

    // -------------------------------------------------------------
    // Test 12: Safe Harbor Emergency Data (GET /patient/:health_id/safe-harbor)
    // -------------------------------------------------------------
    console.log('\n[Test 12] Safe Harbor Emergency Query (Without Prior Consent)...');
    const safeRes = await fetch(`${GATEWAY_URL}/patient/${LAKSHMI_ABHA}/safe-harbor`, {
      headers: { 'Authorization': `Bearer ${erToken}` }
    });
    const safeData = await safeRes.json();
    assert(safeRes.status === 200, 'Safe harbor query returns 200 without consent');
    assert(safeData.safe_harbor?.critical_allergies?.includes('Penicillin'), 'Safe harbor lists Penicillin critical allergy');
    assert(safeData.safe_harbor?.emergency_contact?.name === 'Suresh Venkatesh', 'Safe harbor returns emergency contact Suresh Venkatesh');

    // -------------------------------------------------------------
    // Test 13: MongoDB Audit Trail (GET /audit/patient/:health_id)
    // -------------------------------------------------------------
    console.log('\n[Test 13] Verifying MongoDB Audit Events Trail...');
    const auditRes = await fetch(`${GATEWAY_URL}/audit/patient/${LAKSHMI_ABHA}`, {
      headers: { 'Authorization': `Bearer ${patToken}` }
    });
    const auditData = await auditRes.json();
    assert(auditRes.status === 200, 'Patient audit trail returns 200');
    assert(auditData.count >= 4, `Audit trail recorded at least 4 operations (got ${auditData.count})`);

    const eventTypes = auditData.audit_events.map(e => e.event_type);
    assert(eventTypes.includes('consent_request_created'), 'Audit trail recorded consent_request_created');
    assert(eventTypes.includes('consent_granted'), 'Audit trail recorded consent_granted');
    assert(eventTypes.includes('access_initiated'), 'Audit trail recorded access_initiated');
    assert(eventTypes.includes('consent_revoked'), 'Audit trail recorded consent_revoked');
    assert(eventTypes.includes('break_glass_triggered'), 'Audit trail recorded break_glass_triggered');

  } catch (err) {
    console.error('Test suite execution error:', err);
    assert(false, `Unexpected error: ${err.message}`);
  } finally {
    await sysClient.close().catch(() => {});
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
