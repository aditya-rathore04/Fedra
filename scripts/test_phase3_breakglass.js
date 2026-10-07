/**
 * FEDRA — Phase 3 Sprint 1 Automated Verification Suite
 * Tests Break-Glass Emergency Access:
 * 1. Safe Harbor Endpoint (GET /patient/safe-harbor) without prior consent
 * 2. Break-Glass Declaration Validation & RBAC (POST /consent/break-glass)
 * 3. 2-Hour Scoped Emergency Token Issuance & Notifications (Patient + Caregiver)
 * 4. Token Validation Latency SLA (<50ms, Contract C-02)
 * 5. Sensitive Category Lockdown Invariant in Federated Aggregator (POST /records/fetch)
 * 6. Rate Limiting Friction (3 requests/hour per clinician -> HTTP 429)
 * 7. Audit Trail Verification (GET /audit/patient/:health_id) & Contract C-04 Genesis Link
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

const path = require('path');
let MongoClient;
try {
  ({ MongoClient } = require('mongodb'));
} catch (e) {
  const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
  ({ MongoClient } = require(path.join(backendModules, 'mongodb')));
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020';

async function cleanupTestData() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('system_db');
    // Clear prior test break-glass tokens and audit events for idempotent test runs
    await Promise.all([
      db.collection('audit_events').deleteMany({ 'actor.id': { $in: ['DOC-EMERGENCY', 'DOC-3'] } }),
      db.collection('access_tokens').deleteMany({ doctor_id: { $in: ['DOC-EMERGENCY', 'DOC-3'] } }),
      db.collection('notifications').deleteMany({ 'payload.doctor_id': { $in: ['DOC-EMERGENCY', 'DOC-3'] } })
    ]);
  } catch (e) {
    console.warn('Warning: DB cleanup before test failed:', e.message);
  } finally {
    await client.close().catch(() => {});
  }
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
  console.log('  FEDRA — Phase 3 Break-Glass Emergency Access Test Suite');
  console.log('================================================================\n');

  try {
    await cleanupTestData();

    // ---------------------------------------------------------
    // Step 0: Authenticate Personas
    // ---------------------------------------------------------
    console.log('[Step 0] Authenticating Personas...');
    
    // Emergency Clinician: Dr. Rahul Verma at Apollo (HOSP-1)
    const erLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'er@test.com', password: 'password123' })
    });
    check('Emergency Doctor (er@test.com) login succeeds (200)', erLogin.status === 200);
    const erToken = erLogin.data?.token;
    check('Emergency Doctor has role emergency', erLogin.data?.role === 'emergency');

    // Doctor C: Dr. Rajesh Iyer at Max (HOSP-3)
    const doc3Login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'doc3@test.com', password: 'password123' })
    });
    check('Doctor C (doc3@test.com) login succeeds (200)', doc3Login.status === 200);
    const doc3Token = doc3Login.data?.token;

    // Patient A: Lakshmi Venkatesh (ABHA-4471-2298-6613)
    const patALogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
    });
    check('Patient A (Lakshmi Venkatesh) login succeeds (200)', patALogin.status === 200);
    const patAToken = patALogin.data?.token;
    const patAAbha = patALogin.data?.health_id;
    check('Patient A ABHA matches ABHA-4471-2298-6613', patAAbha === 'ABHA-4471-2298-6613');

    // Patient B: Vikram Shetty (ABHA-6604-8817-2239)
    const patBLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'vikram-shetty@test.com', password: 'password123' })
    });
    check('Patient B (Vikram Shetty) login succeeds (200)', patBLogin.status === 200);
    const patBToken = patBLogin.data?.token;
    const patBAbha = patBLogin.data?.health_id;
    check('Patient B ABHA matches ABHA-6604-8817-2239', patBAbha === 'ABHA-6604-8817-2239');

    // ---------------------------------------------------------
    // Step 1: Safe Harbor Endpoint (GET /patient/safe-harbor)
    // ---------------------------------------------------------
    console.log('\n[Step 1] Safe Harbor Emergency Demographics (GET /patient/safe-harbor)...');
    
    // Clinician queries Safe Harbor WITHOUT consent or active token
    const shRes = await request(`/patient/safe-harbor?health_id=${patAAbha}`, {
      headers: { Authorization: `Bearer ${erToken}` }
    });
    check('Safe Harbor returns HTTP 200 without consent', shRes.status === 200);
    check('Safe Harbor contains correct patient health_id', shRes.data?.health_id === patAAbha);
    check('Safe Harbor contains patient name (Lakshmi Venkatesh)', shRes.data?.patient_name === 'Lakshmi Venkatesh');
    check('Safe Harbor contains blood type (O+)', shRes.data?.demographics?.blood_type === 'O+');
    check('Safe Harbor identifies critical drug allergy: Penicillin', 
      Array.isArray(shRes.data?.safe_harbor?.critical_allergies) && 
      shRes.data.safe_harbor.critical_allergies.includes('Penicillin')
    );
    check('Safe Harbor contains emergency contact: Suresh Venkatesh (husband)', 
      shRes.data?.safe_harbor?.emergency_contact?.name === 'Suresh Venkatesh' &&
      shRes.data?.safe_harbor?.emergency_contact?.phone === '+91-9845012345' &&
      shRes.data?.safe_harbor?.emergency_contact?.relation === 'husband'
    );
    check('Safe Harbor identifies registered hospital (HOSP-1)', shRes.data?.institution_id === 'HOSP-1');

    // Validation checks for Safe Harbor
    const shMissing = await request('/patient/safe-harbor', {
      headers: { Authorization: `Bearer ${erToken}` }
    });
    check('Safe Harbor without health_id parameter returns HTTP 400', shMissing.status === 400);

    const shUnknown = await request('/patient/safe-harbor?health_id=ABHA-9999-9999-9999', {
      headers: { Authorization: `Bearer ${erToken}` }
    });
    check('Safe Harbor for unregistered ABHA returns HTTP 404', shUnknown.status === 404);

    // RBAC: Patient cannot call Safe Harbor
    const shPatientRbac = await request(`/patient/safe-harbor?health_id=${patAAbha}`, {
      headers: { Authorization: `Bearer ${patAToken}` }
    });
    check('RBAC: Patient role calling /patient/safe-harbor returns HTTP 403', shPatientRbac.status === 403);

    // ---------------------------------------------------------
    // Step 2: Break-Glass Validation & RBAC (POST /consent/break-glass)
    // ---------------------------------------------------------
    console.log('\n[Step 2] Break-Glass Input Validation & RBAC...');

    const bgNoHealthId = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({ justification: 'Trauma victim polytrauma workup emergency' })
    });
    check('Break-Glass without health_id returns HTTP 400', bgNoHealthId.status === 400);

    const bgNoJust = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({ health_id: patAAbha })
    });
    check('Break-Glass without justification returns HTTP 400', bgNoJust.status === 400);

    const bgShortJust = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({ health_id: patAAbha, justification: 'urgent' })
    });
    check('Break-Glass with short justification (<10 chars) returns HTTP 400', bgShortJust.status === 400);

    const bgPatientRbac = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${patAToken}` },
      body: JSON.stringify({ health_id: patAAbha, justification: 'Patient attempting break-glass' })
    });
    check('RBAC: Patient role calling /consent/break-glass returns HTTP 403', bgPatientRbac.status === 403);

    const bgUnauth = await request('/consent/break-glass', {
      method: 'POST',
      body: JSON.stringify({ health_id: patAAbha, justification: 'Unauthenticated emergency call' })
    });
    check('RBAC: Unauthenticated /consent/break-glass returns HTTP 401', bgUnauth.status === 401);

    // ---------------------------------------------------------
    // Step 3: Break-Glass Emergency Execution (POST /consent/break-glass)
    // ---------------------------------------------------------
    console.log('\n[Step 3] Break-Glass Declaration Execution...');
    
    const bgClinicalJustification = 'Patient arrived unconscious via EMS with severe blunt chest and abdominal trauma following motor vehicle collision; emergency exploratory laparotomy and transfusion indicated.';
    const bgRes = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({
        health_id: patAAbha,
        justification: bgClinicalJustification,
        requested_duration_hrs: 2
      })
    });

    check('Break-Glass declaration succeeds -> HTTP 200', bgRes.status === 200);
    const bgTokenId = bgRes.data?.token_id;
    const bgEventId = bgRes.data?.event_id;
    check('Valid Emergency Token generated (TOK-BG-*)', !!bgTokenId && bgTokenId.startsWith('TOK-BG-'));
    check('Valid Audit Event generated (EVT-BG-*)', !!bgEventId && bgEventId.startsWith('EVT-BG-'));
    check('Token type is break_glass', bgRes.data?.token_type === 'break_glass');
    check('Default emergency window is 2 hours', bgRes.data?.default_window_hrs === 2);
    check('Patient notified flag is true', bgRes.data?.patient_notified === true);
    check('Caregiver notified flag is true', bgRes.data?.caregiver_notified === true);
    check('Caregiver details match Suresh Venkatesh', 
      bgRes.data?.caregiver_details?.name === 'Suresh Venkatesh' &&
      bgRes.data?.caregiver_details?.phone === '+91-9845012345'
    );

    // Check expiration timestamp (~2 hours from now)
    const expiresAt = new Date(bgRes.data?.expires_at).getTime();
    const diffHours = (expiresAt - Date.now()) / (3600 * 1000);
    check('Token lifetime is approximately 2 hours (~1.99 - 2.01h)', diffHours >= 1.95 && diffHours <= 2.05);

    // Verify patient notification delivered
    const notifsRes = await request('/notifications', {
      headers: { Authorization: `Bearer ${patAToken}` }
    });
    check('Patient fetches notifications -> HTTP 200', notifsRes.status === 200);
    const bgNotif = notifsRes.data?.notifications?.find(n => n.notification_type === 'break_glass_triggered');
    check('Patient received break_glass_triggered alert', !!bgNotif);
    check('Notification payload contains emergency event_id', bgNotif?.payload?.event_id === bgEventId);
    check('Notification payload contains clinical justification', bgNotif?.payload?.justification === bgClinicalJustification);

    // ---------------------------------------------------------
    // Step 4: Token Validation Latency SLA (<50ms, Contract C-02)
    // ---------------------------------------------------------
    console.log('\n[Step 4] Token Validation Latency SLA (<50ms, Contract C-02)...');
    
    const valStart = performance.now();
    const valRes = await request('/consent/validate', {
      headers: { 'X-Access-Token': bgTokenId }
    });
    const measuredLatency = performance.now() - valStart;

    check('Break-Glass token is valid (HTTP 200)', valRes.status === 200);
    check('Token status valid: true', valRes.data?.valid === true);
    check('Token type returned is break_glass', valRes.data?.token_type === 'break_glass');
    check('Associated health_id matches Lakshmi', valRes.data?.health_id === patAAbha);
    check(`Token validation latency (${measuredLatency.toFixed(2)}ms) satisfies <50ms SLA (C-02)`, measuredLatency < 50);

    // ---------------------------------------------------------
    // Step 5: Sensitive Category Lockdown Invariant (POST /records/fetch)
    // ---------------------------------------------------------
    console.log('\n[Step 5] Sensitive Category Lockdown Invariant (POST /records/fetch)...');
    
    // Emergency clinician fetches Lakshmi's records using the break-glass token
    const fetchRes = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({
        health_id: patAAbha,
        token_id: bgTokenId
      })
    });

    check('Emergency records fetch succeeds -> HTTP 200', fetchRes.status === 200);
    check('Total records returned > 0', fetchRes.data?.total_records_returned > 0);
    
    // Non-sensitive clinical data MUST be returned
    const conditions = (fetchRes.data?.records?.conditions || []).map(c => c.clinical_text.toLowerCase());
    const medications = (fetchRes.data?.records?.medications || []).map(m => m.clinical_text.toLowerCase());
    const allergies = (fetchRes.data?.records?.allergies || []).map(a => a.clinical_text.toLowerCase());
    const encounters = (fetchRes.data?.records?.encounters_procedures || []).map(e => e.clinical_text.toLowerCase());

    const hasCancer = conditions.some(t => t.includes('carcinoma') || t.includes('breast'));
    const hasChemo = medications.some(t => t.includes('chemotherapy') || t.includes('tamoxifen'));
    const hasPenicillin = allergies.some(t => t.includes('penicillin'));

    check('General condition (Breast Carcinoma) is VISIBLE to emergency clinician', hasCancer);
    check('General medication (Chemotherapy / Tamoxifen) is VISIBLE to emergency clinician', hasChemo);
    check('General allergy (Penicillin) is VISIBLE to emergency clinician', hasPenicillin);

    // CRITICAL INVARIANT: Sensitive psychiatric data MUST be omitted under break-glass
    const hasPsychCond = conditions.some(t => t.includes('adjustment disorder'));
    const hasPsychMed = medications.some(t => t.includes('sertraline'));
    const hasCbtSession = encounters.some(t => t.includes('cbt counselling') || t.includes('psycho-oncology'));

    check('SENSITIVE LOCKDOWN: Psychiatric Condition (Adjustment Disorder) is LOCKED / OMITTED', !hasPsychCond);
    check('SENSITIVE LOCKDOWN: Psychiatric Medication (Sertraline) is LOCKED / OMITTED', !hasPsychMed);
    check('SENSITIVE LOCKDOWN: Psycho-Oncology CBT Counseling is LOCKED / OMITTED', !hasCbtSession);
    check('Total sensitive records omitted count >= 2', fetchRes.data?.total_sensitive_records_omitted >= 2);
    check('Psychiatric sensitive omitted counter >= 2', fetchRes.data?.sensitive_records_omitted?.psychiatric >= 2);

    // ---------------------------------------------------------
    // Step 6: Rate Limiting Enforcement (3 requests / hour per clinician)
    // ---------------------------------------------------------
    console.log('\n[Step 6] Rate Limiting Friction (Max 3 / hour per clinician)...');
    
    // Dr. Rahul Verma already made 1 break-glass request in Step 3.
    // Call #2:
    const bgCall2 = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({
        health_id: patBAbha,
        justification: 'Acute respiratory distress and cyanosis; immediate intubation and blood gas access required.'
      })
    });
    check('Break-Glass request #2/3 succeeds (HTTP 200)', bgCall2.status === 200);

    // Call #3:
    const bgCall3 = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({
        health_id: patAAbha,
        justification: 'Second trauma review for worsening hemodynamics during ongoing ICU resuscitation.'
      })
    });
    check('Break-Glass request #3/3 succeeds (HTTP 200)', bgCall3.status === 200);

    // Call #4: Exceeds rate limit!
    const bgCall4 = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({
        health_id: patBAbha,
        justification: 'Fourth emergency request within the same hour exceeding clinician rate limit.'
      })
    });
    check('Break-Glass request #4/3 is BLOCKED by Rate Limiter -> HTTP 429', bgCall4.status === 429);
    check('Response contains rate limit exceeded message', 
      bgCall4.data?.error?.includes('Rate limit exceeded') && bgCall4.data?.code === 429
    );

    // Another doctor (Doctor C) has their own rate limit bucket
    const doc3Bg = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        health_id: patAAbha,
        justification: 'Independent trauma surgeon at Max hospital requesting emergency records for transfer review.'
      })
    });
    check('Different clinician (Doctor C) has independent rate limit bucket (HTTP 200)', doc3Bg.status === 200);

    // ---------------------------------------------------------
    // Step 7: Audit Trail Verification (GET /audit/patient/:health_id)
    // ---------------------------------------------------------
    console.log('\n[Step 7] Audit Trail Verification (GET /audit/patient/:health_id)...');

    // Patient Lakshmi views her own audit trail
    const auditRes = await request(`/audit/patient/${patAAbha}`, {
      headers: { Authorization: `Bearer ${patAToken}` }
    });
    check('Patient retrieves own audit trail -> HTTP 200', auditRes.status === 200);
    check('Audit trail contains logged events', auditRes.data?.total_events > 0);

    // Find break_glass_triggered event
    const bgAuditEvent = auditRes.data?.events?.find(e => e.event_id === bgEventId);
    check('Audit trail contains break_glass_triggered event', !!bgAuditEvent);
    check('Audit event contains clinician actor DOC-EMERGENCY', bgAuditEvent?.actor?.id === 'DOC-EMERGENCY');
    check('Audit event contains emergency clinical justification', bgAuditEvent?.metadata?.justification === bgClinicalJustification);
    check('Contract C-04: Initial break-glass event has genesis linked_event_id (0x00...00)', 
      bgAuditEvent?.linked_event_id === '0x0000000000000000000000000000000000000000000000000000000000000000'
    );
    check('Contract C-03: Pre-computed ml_features.is_break_glass is true', bgAuditEvent?.ml_features?.is_break_glass === true);
    check('Pre-computed ml_features contains hour_of_day', typeof bgAuditEvent?.ml_features?.hour_of_day === 'number');

    // Find record_access event
    const accessAuditEvent = auditRes.data?.events?.find(e => e.event_type === 'record_access' && e.metadata?.token_id === bgTokenId);
    check('Audit trail contains record_access event for break-glass token', !!accessAuditEvent);
    check('Record access event marks token_type as break_glass', accessAuditEvent?.metadata?.token_type === 'break_glass');
    check('Record access records sensitive records omitted count >= 2', accessAuditEvent?.metadata?.total_sensitive_omitted >= 2);

    // Privacy check: Patient B cannot view Patient A's audit trail
    const auditPrivacy = await request(`/audit/patient/${patAAbha}`, {
      headers: { Authorization: `Bearer ${patBToken}` }
    });
    check('Privacy RBAC: Patient B forbidden from viewing Patient A audit log (HTTP 403)', auditPrivacy.status === 403);

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
