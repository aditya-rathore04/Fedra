/**
 * Phase 1 & Contract C-01 JWT End-to-End Verification Suite
 * Usage: node scripts/test_phase1_jwt.js
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const FHIR_PORTS = [8081, 8082, 8083];

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
}

async function runTests() {
  console.log('====================================================');
  console.log('  FEDRA — Phase 1 & Contract C-01 Verification Suite');
  console.log('====================================================\n');

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

  try {
    // 1. Gateway Health Check
    console.log('[Test 1] Verifying Gateway & MongoDB Health...');
    const healthRes = await fetch(`${GATEWAY_URL}/health`);
    const health = await healthRes.json();
    assert(healthRes.status === 200, 'Gateway responds with 200');
    assert(health.databases.system_db === true, 'Connected to system_db');
    assert(health.databases.registry_db === true, 'Connected to registry_db');

    // 2. Doctor Login & Contract C-01 Claims Verification
    console.log('\n[Test 2] Doctor Login & Contract C-01 Token Claims...');
    const docLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'DOC-1' })
    });
    const docLogin = await docLoginRes.json();
    assert(docLoginRes.status === 200, 'Doctor login returns 200');
    assert(!!docLogin.token, 'Token string received');
    
    // Decode JWT payload and verify Contract C-01 constraints
    const docPayload = decodeJwtPayload(docLogin.token);
    assert(docPayload.user_id === 'DOC-1', 'JWT payload has user_id: DOC-1');
    assert(docPayload.role === 'doctor', 'JWT payload has role: doctor');
    assert(docPayload.institution_id === 'HOSP-1', 'JWT payload has institution_id: HOSP-1');
    assert(typeof docPayload.issued_at === 'number', 'JWT payload has numeric issued_at');
    assert(typeof docPayload.expires_at === 'number', 'JWT payload has numeric expires_at');
    
    // Check 8-hour lifetime for doctor
    const lifetimeHours = (docPayload.expires_at - docPayload.issued_at) / 3600;
    assert(lifetimeHours === 8, `Doctor token lifetime is strictly 8 hours (got ${lifetimeHours}h)`);

    // Verify absence of forbidden unstructured metadata inside token (C-01 violation check)
    assert(docPayload.name === undefined, 'No extraneous "name" claim inside JWT');
    assert(docPayload.department === undefined, 'No extraneous "department" claim inside JWT');
    assert(docPayload.institution_name === undefined, 'No extraneous "institution_name" claim inside JWT');

    // 3. Token Refresh
    console.log('\n[Test 3] Token Refresh (POST /auth/refresh)...');
    const refreshRes = await fetch(`${GATEWAY_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${docLogin.token}`
      }
    });
    const refreshData = await refreshRes.json();
    assert(refreshRes.status === 200, 'Token refresh returns 200');
    assert(!!refreshData.token, 'Refreshed token received');
    const refreshPayload = decodeJwtPayload(refreshData.token);
    assert(refreshPayload.user_id === 'DOC-1', 'Refreshed token belongs to DOC-1');

    // 4. Patient Registration & 24h Lifetime
    console.log('\n[Test 4] Patient Registration & 24h Token Lifetime...');
    const testAbha = `ABHA-TEST-${Date.now().toString().slice(-4)}`;
    const regPatientRes = await fetch(`${GATEWAY_URL}/auth/register/patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Patient',
        abha_id: testAbha,
        dob: '1995-06-15',
        gender: 'female',
        password: 'Password@123'
      })
    });
    const regPatient = await regPatientRes.json();
    assert(regPatientRes.status === 201, 'Patient registration returns 201');
    assert(regPatient.health_id === testAbha, 'Registered with correct ABHA');

    // Login with registered patient
    const patientLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: regPatient.user_id, password: 'Password@123' })
    });
    const patientLogin = await patientLoginRes.json();
    assert(patientLoginRes.status === 200, 'Patient login with password succeeds');
    const patientPayload = decodeJwtPayload(patientLogin.token);
    const patientLifetimeHours = (patientPayload.expires_at - patientPayload.issued_at) / 3600;
    assert(patientLifetimeHours === 24, `Patient token lifetime is strictly 24 hours (got ${patientLifetimeHours}h)`);

    // 5. Gateway Security Boundaries (401 & 403)
    console.log('\n[Test 5] Gateway Security Boundaries (401 & 403)...');
    
    // Unauthenticated -> 401
    const noAuthRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-DEMO-001`);
    assert(noAuthRes.status === 401, 'Unauthenticated request rejected with 401');

    // Malformed token -> 401
    const badTokenRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-DEMO-001`, {
      headers: { 'Authorization': 'Bearer invalid-token-string' }
    });
    assert(badTokenRes.status === 401, 'Invalid token rejected with 401');

    // Patient role attempting doctor discovery search -> 403 Forbidden
    const forbiddenRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-DEMO-001`, {
      headers: { 'Authorization': `Bearer ${patientLogin.token}` }
    });
    assert(forbiddenRes.status === 403, 'Patient role forbidden from discovery search (403)');

    // 6. Authorized Patient Discovery Search (Spec Schema)
    console.log('\n[Test 6] Authorized Patient Discovery Query...');
    const searchRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-DEMO-001`, {
      headers: { 'Authorization': `Bearer ${docLogin.token}` }
    });
    const searchData = await searchRes.json();
    assert(searchRes.status === 200, 'Doctor search query returns 200');
    assert(searchData.health_id === 'ABHA-DEMO-001', 'Response contains correct health_id');
    assert(searchData.patient_name === 'AdhiRaj', 'Response contains top-level patient_name (AdhiRaj)');
    assert(Array.isArray(searchData.institutions), 'Response contains institutions array');
    assert(searchData.institutions.length > 0, `Discovery returned ${searchData.institutions.length} institution record pointers`);

    // 7. Discovery Registry Record Registration
    console.log('\n[Test 7] Record Registry Indexing (POST /registry/register)...');
    const registerRecordRes = await fetch(`${GATEWAY_URL}/registry/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${docLogin.token}`
      },
      body: JSON.stringify({
        health_id: testAbha,
        patient_name: 'Test Patient',
        institution_id: 'HOSP-1',
        institution_name: 'Apollo Memorial Hospital',
        record_summary: {
          total_records: 1,
          categories_present: ['encounter'],
          sensitive_categories_present: []
        }
      })
    });
    assert(registerRecordRes.status === 201, 'Record registration returns 201');

    // 8. FHIR Nodes Liveness
    console.log('\n[Test 8] Checking 3 HAPI FHIR Nodes Liveness...');
    for (const port of FHIR_PORTS) {
      try {
        const fhirRes = await fetch(`http://localhost:${port}/fhir/metadata`);
        assert(fhirRes.status === 200, `HAPI FHIR Node on port ${port} is UP and responding`);
      } catch (err) {
        assert(false, `HAPI FHIR Node on port ${port} failed to respond: ${err.message}`);
      }
    }

  } catch (err) {
    console.error('Fatal error executing tests:', err);
    failed++;
  }

  console.log('\n----------------------------------------------------');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
