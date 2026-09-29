/**
 * FEDRA — Phase 2 Automated Verification Suite
 * Tests Consent Service, In-Memory Token Cache (C-02 SLA), Multi-Gate Sensitive Filters,
 * Federated Cross-Node Aggregation (C-08 Timeout Budget), and Revocation Handshake.
 */

const assert = require('assert');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  let data;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

let passed = 0;
let failed = 0;

function check(desc, condition) {
  if (condition) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  FAIL: ${desc}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  FEDRA — Phase 2 Consent & Federated Aggregator Test Suite');
  console.log('================================================================\n');

  try {
    // ---------------------------------------------------------
    // Phase 2 - Step 1: Authentication of Doctor and Patient
    // ---------------------------------------------------------
    console.log('[Step 1] Authenticating Doctor & Patient...');
    const docLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'doc1@test.com', password: 'password123' })
    });
    check('Doctor A (doc1@test.com) login succeeds', docLogin.status === 200);
    const doctorToken = docLogin.data.token;
    check('Doctor Bearer token received', !!doctorToken);

    const patLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
    });
    check('Patient Lakshmi login succeeds', patLogin.status === 200);
    const patientToken = patLogin.data.token;
    const patientAbha = patLogin.data.health_id;
    check('Patient ABHA is ABHA-4471-2298-6613', patientAbha === 'ABHA-4471-2298-6613');

    // ---------------------------------------------------------
    // Phase 2 - Step 2: Doctor Requests Access (POST /consent/request)
    // ---------------------------------------------------------
    console.log('\n[Step 2] Doctor Access Request Flow...');
    const reqRes = await request('/consent/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` },
      body: JSON.stringify({
        health_id: patientAbha,
        purpose: 'Cardiology pre-operative assessment & oncology surveillance',
        institution_id: 'HOSP-1'
      })
    });
    check('Doctor requests consent -> HTTP 202 Accepted', reqRes.status === 202);
    check('Response status is pending_patient_consent', reqRes.data?.status === 'pending_patient_consent');
    check('Patient notified flag is true', reqRes.data?.patient_notified === true);
    const requestId = reqRes.data?.request_id;
    check('Valid request_id generated (REQ-*)', !!requestId && requestId.startsWith('REQ-'));

    // ---------------------------------------------------------
    // Phase 2 - Step 3: Patient Pending Inbox & Notifications
    // ---------------------------------------------------------
    console.log('\n[Step 3] Patient Inbox & Notifications...');
    const pendingRes = await request('/consent/pending', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    check('Patient fetches pending requests -> HTTP 200', pendingRes.status === 200);
    const foundReq = pendingRes.data?.requests?.find(r => r.request_id === requestId);
    check('Pending request found in patient inbox', !!foundReq);
    check('Request contains declared clinical purpose', foundReq?.purpose?.includes('Cardiology pre-operative'));
    check('Request contains requesting Doctor name', !!foundReq?.doctor_name);

    const notifRes = await request('/notifications', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    check('Patient notifications retrieved -> HTTP 200', notifRes.status === 200);
    const foundNotif = notifRes.data?.notifications?.find(n => n.notification_type === 'consent_request_received');
    check('Notification consent_request_received exists', !!foundNotif);

    // ---------------------------------------------------------
    // Phase 2 - Step 4: Patient Grants Consent with Sensitive Gate LOCKED
    // ---------------------------------------------------------
    console.log('\n[Step 4] Patient Grants Consent (Psychiatric: LOCKED)...');
    const grantRes = await request('/consent/grant', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
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
    check('Patient grant consent -> HTTP 200', grantRes.status === 200);
    check('Policy ID generated (POL-*)', !!grantRes.data?.policy_id && grantRes.data.policy_id.startsWith('POL-'));
    check('Access Token ID generated (TOK-*)', !!grantRes.data?.token_id && grantRes.data.token_id.startsWith('TOK-'));
    const policyId = grantRes.data?.policy_id;
    const tokenId = grantRes.data?.token_id;
    check('Granted scope has psychiatric: false', grantRes.data?.scope?.sensitive_categories?.psychiatric === false);

    // ---------------------------------------------------------
    // Phase 2 - Step 5: Contract C-02 Latency SLA (<50ms Token Validation)
    // ---------------------------------------------------------
    console.log('\n[Step 5] Contract C-02 Latency SLA Benchmark (<50ms)...');
    const startVal = performance.now();
    const valRes = await request('/consent/validate', {
      headers: { 'X-Access-Token': tokenId }
    });
    const valDuration = performance.now() - startVal;
    check('Token validation returns HTTP 200', valRes.status === 200);
    check('Token is marked valid: true', valRes.data?.valid === true);
    check(`Contract C-02 SLA: Latency is < 50ms (got ${valDuration.toFixed(2)}ms)`, valDuration < 50);
    check('Token scope matches granted policy', valRes.data?.scope?.sensitive_categories?.psychiatric === false);

    // ---------------------------------------------------------
    // Phase 2 - Step 6: Federated Record Fetch (Sensitive Gate Enforcement)
    // ---------------------------------------------------------
    console.log('\n[Step 6] Federated Record Aggregation (Privacy Gate Active)...');
    const fetch1 = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` },
      body: JSON.stringify({
        health_id: patientAbha,
        token_id: tokenId
      })
    });
    check('Doctor fetch records -> HTTP 200', fetch1.status === 200);
    check('Patient name returned in aggregate', fetch1.data?.patient_name === 'Lakshmi Venkatesh');
    check('Node statuses includes HOSP-1 active', fetch1.data?.node_statuses?.['HOSP-1'] === 'active');
    
    // Check general records present
    const condNames = (fetch1.data?.records?.conditions || []).map(c => c.clinical_text.toLowerCase());
    const medNames = (fetch1.data?.records?.medications || []).map(m => m.clinical_text.toLowerCase());
    check('General condition (Breast Carcinoma) returned', condNames.some(t => t.includes('carcinoma') || t.includes('lump')));
    check('General medication (Tamoxifen) returned', medNames.some(t => t.includes('tamoxifen')));

    // Check psychiatric records filtered out
    const hasPsychCond = condNames.some(t => t.includes('adjustment disorder') || t.includes('anxiety'));
    const hasPsychMed = medNames.some(t => t.includes('sertraline'));
    check('Privacy Gate: Psychiatric Condition (Adjustment Disorder) is OMITTED', !hasPsychCond);
    check('Privacy Gate: Psychiatric Medication (Sertraline) is OMITTED', !hasPsychMed);
    check('Sensitive records omitted counter > 0', fetch1.data?.total_sensitive_records_omitted > 0);

    // ---------------------------------------------------------
    // Phase 2 - Step 7: Dynamic Multi-Gate Unlock (POST /consent/sensitive)
    // ---------------------------------------------------------
    console.log('\n[Step 7] Dynamic Sensitive Gate Unlock (Psychiatric: GRANTED)...');
    const sensRes = await request('/consent/sensitive', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({
        policy_id: policyId,
        category: 'psychiatric',
        grant: true
      })
    });
    check('Patient unlocks psychiatric category -> HTTP 200', sensRes.status === 200);
    check('Category update confirmed: psychiatric: true', sensRes.data?.category === 'psychiatric' && sensRes.data?.access === true);

    // Doctor re-fetches records
    const fetch2 = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` },
      body: JSON.stringify({
        health_id: patientAbha,
        token_id: tokenId
      })
    });
    check('Doctor re-fetches records -> HTTP 200', fetch2.status === 200);
    const condNamesAfter = (fetch2.data?.records?.conditions || []).map(c => c.clinical_text.toLowerCase());
    const medNamesAfter = (fetch2.data?.records?.medications || []).map(m => m.clinical_text.toLowerCase());
    const encountersAfter = (fetch2.data?.records?.encounters_procedures || []).map(e => e.clinical_text.toLowerCase());

    const hasPsychCondAfter = condNamesAfter.some(t => t.includes('adjustment disorder'));
    const hasPsychMedAfter = medNamesAfter.some(t => t.includes('sertraline'));
    const hasCbtAfter = encountersAfter.some(t => t.includes('cbt'));

    check('Unlocked Gate: Psychiatric Condition (Adjustment Disorder) is now VISIBLE', hasPsychCondAfter);
    check('Unlocked Gate: Psychiatric Medication (Sertraline) is now VISIBLE', hasPsychMedAfter);
    check('Unlocked Gate: Psycho-Oncology CBT Counseling is now VISIBLE', hasCbtAfter);

    // ---------------------------------------------------------
    // Phase 2 - Step 8: Instant Revocation Handshake (POST /consent/revoke)
    // ---------------------------------------------------------
    console.log('\n[Step 8] Instant Revocation Handshake...');
    const revokeRes = await request('/consent/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` },
      body: JSON.stringify({ policy_id: policyId })
    });
    check('Patient revokes consent policy -> HTTP 200', revokeRes.status === 200);
    check('Policy response revoked: true', revokeRes.data?.revoked === true);
    check('Active tokens invalidated count >= 1', revokeRes.data?.active_tokens_invalidated >= 1);

    // Immediate token validation check
    const valRevoked = await request('/consent/validate', {
      headers: { 'X-Access-Token': tokenId }
    });
    check('Revoked token is rejected by validator (HTTP 401)', valRevoked.status === 401);

    // Doctor attempts to fetch records with revoked token
    const fetch3 = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doctorToken}` },
      body: JSON.stringify({
        health_id: patientAbha,
        token_id: tokenId
      })
    });
    check('Doctor fetch with revoked token rejected (HTTP 422)', fetch3.status === 422);

    // ---------------------------------------------------------
    // Phase 2 - Step 9: Patient Self Health Timeline (GET /records/patient)
    // ---------------------------------------------------------
    console.log('\n[Step 9] Patient Self Health Timeline...');
    const timelineRes = await request('/records/patient', {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    check('Patient views own cross-hospital timeline -> HTTP 200', timelineRes.status === 200);
    check('Timeline contains patient allergies', Array.isArray(timelineRes.data?.records?.allergies));
    check('Timeline contains patient medications', Array.isArray(timelineRes.data?.records?.medications));
    check('Timeline contains patient conditions', Array.isArray(timelineRes.data?.records?.conditions));
    check('Timeline shows all records including psychiatric (self-view)', 
      timelineRes.data?.records?.conditions?.some(c => c.clinical_text.toLowerCase().includes('adjustment disorder'))
    );

    // ---------------------------------------------------------
    // Phase 2 - Step 10: Security & RBAC Enforcement
    // ---------------------------------------------------------
    console.log('\n[Step 10] Security Boundaries & RBAC...');
    const rbac1 = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patientToken}` }, // Patient cannot act as Doctor to fetch records
      body: JSON.stringify({ health_id: patientAbha, token_id: tokenId })
    });
    check('RBAC: Patient role forbidden from calling /records/fetch (403)', rbac1.status === 403);

    const rbac2 = await request('/consent/request', {
      method: 'POST', // Unauthenticated request
      body: JSON.stringify({ health_id: patientAbha, purpose: 'Test' })
    });
    check('RBAC: Unauthenticated /consent/request rejected with 401', rbac2.status === 401);

  } catch (err) {
    console.error('Unexpected test error:', err);
    failed++;
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
