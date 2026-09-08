/**
 * FEDRA — Indian Patient Cohort & Multi-Hospital Seeding Verification Suite
 * Tests Level 1 (FHIR), Level 2 (MongoDB), Level 3 (Gateway & RBAC), and Sign-Off Checklist
 * Usage: node scripts/test_indian_patients.js
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
const HOSP1_MONGO_URI = process.env.HOSP1_MONGO_URI || 'mongodb://localhost:27017/hospital1_db';
const HOSP2_MONGO_URI = process.env.HOSP2_MONGO_URI || 'mongodb://localhost:27018/hospital2_db';
const HOSP3_MONGO_URI = process.env.HOSP3_MONGO_URI || 'mongodb://localhost:27019/hospital3_db';

const FHIR_URLS = {
  'HOSP-1': process.env.FHIR_HOSP1_URL || 'http://localhost:8081/fhir',
  'HOSP-2': process.env.FHIR_HOSP2_URL || 'http://localhost:8082/fhir',
  'HOSP-3': process.env.FHIR_HOSP3_URL || 'http://localhost:8083/fhir'
};

const SEEDED_ABHAS = [
  'ABHA-4471-2298-6613', 'ABHA-7712-4456-9081', 'ABHA-5528-1193-4402',
  'ABHA-3390-6621-7845', 'ABHA-6604-8817-2239', 'ABHA-1147-9903-5561'
];

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  FEDRA — Indian Patient Cohort & Multi-Hospital Test Suite');
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

  // Connect to MongoDB databases
  const sysClient = new MongoClient(MONGO_SYSTEM_URI);
  const h1Client = new MongoClient(HOSP1_MONGO_URI);
  const h2Client = new MongoClient(HOSP2_MONGO_URI);
  const h3Client = new MongoClient(HOSP3_MONGO_URI);

  try {
    await Promise.all([
      sysClient.connect(),
      h1Client.connect(),
      h2Client.connect(),
      h3Client.connect()
    ]);
    const systemDb = sysClient.db('system_db');
    const registryDb = sysClient.db('registry_db');
    const hosp1Db = h1Client.db('hospital1_db');
    const hosp2Db = h2Client.db('hospital2_db');
    const hosp3Db = h3Client.db('hospital3_db');

    // =================================================================
    // LEVEL 1: FHIR NODE VERIFICATION (Direct HAPI REST Calls)
    // =================================================================
    console.log('[Level 1] Verifying HAPI FHIR Nodes & Resources...');

    // 1.1 Node metadata ping (ports 8081, 8082, 8083)
    for (const [hospId, url] of Object.entries(FHIR_URLS)) {
      try {
        const metaRes = await fetch(`${url}/metadata`);
        assert(metaRes.status === 200, `FHIR Node ${hospId} (${url}) responds HTTP 200 on /metadata`);
      } catch (err) {
        assert(false, `FHIR Node ${hospId} (${url}) unreachable: ${err.message}`);
      }
    }

    // 1.2 Verify All 12 Practitioners across designated hospitals
    const PRACTITIONERS = [
      { id: 'pract-cardio-apollo', hosp: 'HOSP-1', name: 'Sharma' },
      { id: 'pract-er-apollo', hosp: 'HOSP-1', name: 'Verma' },
      { id: 'pract-onc-apollo', hosp: 'HOSP-1', name: 'Sen' },
      { id: 'pract-psy-apollo', hosp: 'HOSP-1', name: 'Mukhopadhyay' },
      { id: 'pract-ortho-apollo', hosp: 'HOSP-1', name: 'Venkatesh' },
      { id: 'pract-gyn-apollo', hosp: 'HOSP-1', name: 'Deshmukh' },
      { id: 'pract-rehab-apollo', hosp: 'HOSP-1', name: 'Abdullah' },
      { id: 'pract-genmed-fortis', hosp: 'HOSP-2', name: 'Patel' },
      { id: 'pract-ophth-fortis', hosp: 'HOSP-2', name: 'Sundaram' },
      { id: 'pract-ped-fortis', hosp: 'HOSP-2', name: 'Kulkarni' },
      { id: 'pract-er-max', hosp: 'HOSP-3', name: 'Iyer' },
      { id: 'pract-ortho-max', hosp: 'HOSP-3', name: 'Menon' }
    ];

    let allDocsPass = true;
    for (const doc of PRACTITIONERS) {
      const docRes = await fetch(`${FHIR_URLS[doc.hosp]}/Practitioner/${doc.id}`);
      if (docRes.ok) {
        const body = await docRes.text();
        if (!body.includes(doc.name)) allDocsPass = false;
      } else {
        allDocsPass = false;
      }
    }
    assert(allDocsPass, 'All 12 Practitioners seeded on their respective FHIR servers (Apollo, Fortis, Max)');

    // 1.3 Verify All 6 Patients seeded into FHIR with official ABHA
    const PATIENT_FHIR_CHECKS = [
      { hosp: 'HOSP-1', abha: 'ABHA-4471-2298-6613', expectedName: 'Lakshmi', id: 'lakshmi-venkatesh' },
      { hosp: 'HOSP-2', abha: 'ABHA-7712-4456-9081', expectedName: 'Krishnamurthy', id: 'krishnamurthy-rao' },
      { hosp: 'HOSP-1', abha: 'ABHA-7712-4456-9081', expectedName: 'Krishnamurthy', id: 'krishnamurthy-rao' },
      { hosp: 'HOSP-1', abha: 'ABHA-5528-1193-4402', expectedName: 'Saraswathi', id: 'saraswathi-nair' },
      { hosp: 'HOSP-3', abha: 'ABHA-5528-1193-4402', expectedName: 'Saraswathi', id: 'saraswathi-nair' },
      { hosp: 'HOSP-2', abha: 'ABHA-3390-6621-7845', expectedName: 'Ananya', id: 'ananya-reddy' },
      { hosp: 'HOSP-1', abha: 'ABHA-3390-6621-7845', expectedName: 'Ananya', id: 'ananya-reddy' },
      { hosp: 'HOSP-3', abha: 'ABHA-6604-8817-2239', expectedName: 'Vikram', id: 'vikram-shetty' },
      { hosp: 'HOSP-1', abha: 'ABHA-6604-8817-2239', expectedName: 'Vikram', id: 'vikram-shetty' },
      { hosp: 'HOSP-2', abha: 'ABHA-1147-9903-5561', expectedName: 'Anika', id: 'anika-pillai' }
    ];

    let allPtsPass = true;
    for (const pat of PATIENT_FHIR_CHECKS) {
      const res = await fetch(`${FHIR_URLS[pat.hosp]}/Patient?identifier=https://healthid.ndhm.gov.in|${pat.abha}`);
      const data = await res.json();
      if (data.total !== 1 || !JSON.stringify(data).includes(pat.expectedName)) {
        allPtsPass = false;
      }
    }
    assert(allPtsPass, 'All 6 Indian patients retrievable across 10 hospital locations by official ABHA');

    // 1.4 Dual Identifier lookup (ABHA-4471-2298-6613 and ABHA-DEMO-001 both resolve to Lakshmi on Apollo)
    const dualRes = await fetch(`${FHIR_URLS['HOSP-1']}/Patient?identifier=https://healthid.ndhm.gov.in|ABHA-DEMO-001`);
    const dualData = await dualRes.json();
    assert(
      dualData.total === 1 && dualData.entry?.[0]?.resource?.id === 'lakshmi-venkatesh',
      'Dual identifier lookup works (ABHA-DEMO-001 resolves to Lakshmi Venkatesh on Apollo)'
    );

    // 1.5 Sensitive FHIR Resources Security Labels (PSY, SEX, ETH with R)
    const psychRes = await fetch(`${FHIR_URLS['HOSP-1']}/Condition/lakshmi-cond-adj-disorder`);
    const psychData = await psychRes.json();
    const psychSec = psychData.meta?.security || [];
    const hasPsyTag = psychSec.some(s => s.code === 'PSY') && psychSec.some(s => s.code === 'R');
    assert(hasPsyTag, 'Lakshmi adjustment disorder tagged with FHIR security: PSY / Restricted');

    const reproRes = await fetch(`${FHIR_URLS['HOSP-1']}/Encounter/ananya-enc-family-planning`);
    const reproData = await reproRes.json();
    const reproSec = reproData.meta?.security || [];
    const hasSexTag = reproSec.some(s => s.code === 'SEX') && reproSec.some(s => s.code === 'R');
    assert(hasSexTag, 'Ananya family planning encounter tagged with FHIR security: SEX / Restricted');

    const audRes = await fetch(`${FHIR_URLS['HOSP-1']}/Condition/vikram-cond-aud`);
    const audData = await audRes.json();
    const audSec = audData.meta?.security || [];
    const hasEthTag = audSec.some(s => s.code === 'ETH') && audSec.some(s => s.code === 'R');
    assert(hasEthTag, 'Vikram alcohol use disorder tagged with FHIR security: ETH / Restricted');

    // 1.6 Mandatory Data Gaps Invariant
    const lakshmiFortisRes = await fetch(`${FHIR_URLS['HOSP-2']}/Patient?identifier=https://healthid.ndhm.gov.in|ABHA-4471-2298-6613`);
    const lakshmiFortis = await lakshmiFortisRes.json();
    assert(lakshmiFortis.total === 0, 'Data Gap Invariant: Lakshmi has zero records at Fortis (HOSP-2)');

    const lakshmiMaxRes = await fetch(`${FHIR_URLS['HOSP-3']}/Patient?identifier=https://healthid.ndhm.gov.in|ABHA-4471-2298-6613`);
    const lakshmiMax = await lakshmiMaxRes.json();
    assert(lakshmiMax.total === 0, 'Data Gap Invariant: Lakshmi has zero records at Max (HOSP-3)');

    // =================================================================
    // LEVEL 2: MONGODB CONTAINERS VERIFICATION
    // =================================================================
    console.log('\n[Level 2] Verifying MongoDB Containers & Collections...');

    // 2.1 Central Registry Entries count for Indian cohort
    const regCount = await registryDb.collection('registry_entries').countDocuments({
      health_id: { $in: SEEDED_ABHAS }
    });
    assert(regCount === 10, `registry_db.registry_entries contains exactly 10 Indian cohort entries (got ${regCount})`);

    // 2.2 Sensitive category flags in Central Registry
    const lakshmiReg = await registryDb.collection('registry_entries').findOne({
      health_id: 'ABHA-4471-2298-6613', institution_id: 'HOSP-1'
    });
    assert(
      JSON.stringify(lakshmiReg?.record_summary?.sensitive_categories_present) === JSON.stringify(['psychiatric']),
      'Lakshmi Central Registry flags sensitive_categories_present: ["psychiatric"]'
    );

    const ananyaApolloReg = await registryDb.collection('registry_entries').findOne({
      health_id: 'ABHA-3390-6621-7845', institution_id: 'HOSP-1'
    });
    assert(
      JSON.stringify(ananyaApolloReg?.record_summary?.sensitive_categories_present) === JSON.stringify(['reproductive']),
      'Ananya Central Registry flags sensitive_categories_present: ["reproductive"] at Apollo'
    );

    const vikramApolloReg = await registryDb.collection('registry_entries').findOne({
      health_id: 'ABHA-6604-8817-2239', institution_id: 'HOSP-1'
    });
    assert(
      JSON.stringify(vikramApolloReg?.record_summary?.sensitive_categories_present) === JSON.stringify(['substance_abuse']),
      'Vikram Central Registry flags sensitive_categories_present: ["substance_abuse"] at Apollo'
    );

    // 2.3 System DB Users Verification
    const docUsers = await systemDb.collection('users').find({
      user_id: { $in: ['DOC-1', 'DOC-2', 'DOC-3', 'DOC-EMERGENCY'] }
    }).toArray();
    assert(docUsers.length === 4, `All 4 interactive clinical doctors exist in system_db.users (got ${docUsers.length})`);

    const patientUsers = await systemDb.collection('users').find({
      health_id: { $in: SEEDED_ABHAS }
    }).toArray();
    assert(patientUsers.length >= 6, `All 6 Indian patients registered in system_db.users (got ${patientUsers.length})`);

    const guardian = await systemDb.collection('users').findOne({ user_id: 'PAT-GUARDIAN-001' });
    assert(
      guardian && guardian.guardian_for_health_id === 'ABHA-1147-9903-5561',
      'Infant guardian PAT-GUARDIAN-001 exists with guardian_for_health_id'
    );

    // 2.4 Local Hospital MongoDB Patient Document Counts
    const h1Count = await hosp1Db.collection('patients').countDocuments({ health_id: { $in: SEEDED_ABHAS } });
    const h2Count = await hosp2Db.collection('patients').countDocuments({ health_id: { $in: SEEDED_ABHAS } });
    const h3Count = await hosp3Db.collection('patients').countDocuments({ health_id: { $in: SEEDED_ABHAS } });
    assert(h1Count === 5, `hospital1_db contains 5 Indian patients (got ${h1Count})`);
    assert(h2Count === 3, `hospital2_db contains 3 Indian patients (got ${h2Count})`);
    assert(h3Count === 2, `hospital3_db contains 2 Indian patients (got ${h3Count})`);

    // 2.5 Safe Harbor Emergency Data
    const lakshmiHosp1 = await hosp1Db.collection('patients').findOne({ health_id: 'ABHA-4471-2298-6613' });
    assert(
      lakshmiHosp1?.safe_harbor?.critical_allergies?.includes('Penicillin') &&
      lakshmiHosp1?.safe_harbor?.emergency_contact?.name === 'Suresh Venkatesh',
      'Lakshmi safe harbor data: Penicillin critical allergy and husband Suresh Venkatesh contact'
    );

    const saraswathiHosp1 = await hosp1Db.collection('patients').findOne({ health_id: 'ABHA-5528-1193-4402' });
    assert(
      saraswathiHosp1?.safe_harbor?.critical_allergies?.includes('Sulfa drugs') &&
      saraswathiHosp1?.safe_harbor?.emergency_contact?.name === 'Meera Krishnan',
      'Saraswathi safe harbor data: Sulfa drugs allergy and daughter Meera Krishnan contact'
    );

    // =================================================================
    // LEVEL 3: GATEWAY DISCOVERY & RBAC VERIFICATION (:3000)
    // =================================================================
    console.log('\n[Level 3] Verifying Gateway Discovery Service & RBAC (:3000)...');

    // 3.1 Doctor B (Dr. Priya Patel at Fortis) Login & Contract C-01 Token Claims
    const doc2LoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doc2@test.com', password: 'password123' })
    });
    const doc2Login = await doc2LoginRes.json();
    assert(doc2LoginRes.status === 200, 'Doctor B (doc2@test.com) login succeeds with 200');
    assert(!!doc2Login.token, 'Bearer token received for Doctor B');

    const doc2Payload = decodeJwtPayload(doc2Login.token);
    assert(doc2Payload.user_id === 'DOC-2', 'Contract C-01: JWT user_id is DOC-2');
    assert(doc2Payload.role === 'doctor', 'Contract C-01: JWT role is doctor');
    assert(doc2Payload.institution_id === 'HOSP-2', 'Contract C-01: JWT institution_id is HOSP-2');
    const doc2Lifetime = (doc2Payload.expires_at - doc2Payload.issued_at) / 3600;
    assert(doc2Lifetime === 8, `Contract C-01: Doctor token lifetime is strictly 8 hours (got ${doc2Lifetime}h)`);

    // 3.2 Emergency Doctor Login (2h Lifetime)
    const erLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'er@test.com', password: 'password123' })
    });
    const erLogin = await erLoginRes.json();
    assert(erLoginRes.status === 200, 'Emergency doctor (er@test.com) login succeeds');
    const erPayload = decodeJwtPayload(erLogin.token);
    const erLifetime = (erPayload.expires_at - erPayload.issued_at) / 3600;
    assert(erLifetime === 2, `Contract C-01: Emergency token lifetime is strictly 2 hours (got ${erLifetime}h)`);

    // 3.3 Patient Login (24h Lifetime)
    const patLoginRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
    });
    const patLogin = await patLoginRes.json();
    assert(patLoginRes.status === 200, 'Patient Lakshmi login succeeds');
    const patPayload = decodeJwtPayload(patLogin.token);
    const patLifetime = (patPayload.expires_at - patPayload.issued_at) / 3600;
    assert(patLifetime === 24, `Contract C-01: Patient token lifetime is strictly 24 hours (got ${patLifetime}h)`);

    // 3.4 Gateway RBAC Boundaries (401 & 403)
    const unauthRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-4471-2298-6613`);
    assert(unauthRes.status === 401, 'RBAC: Unauthenticated search rejected with 401');

    const patientForbiddenRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-4471-2298-6613`, {
      headers: { 'Authorization': `Bearer ${patLogin.token}` }
    });
    assert(patientForbiddenRes.status === 403, 'RBAC: Patient role forbidden from discovery query (403)');

    // 3.5 Patient A (Lakshmi) Discovery Query via Doctor Token
    const lakshmiSearchRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-4471-2298-6613`, {
      headers: { 'Authorization': `Bearer ${doc2Login.token}` }
    });
    const lakshmiSearch = await lakshmiSearchRes.json();
    assert(lakshmiSearchRes.status === 200, 'Doctor B search for Lakshmi returns 200');
    assert(lakshmiSearch.patient_name === 'Lakshmi Venkatesh', 'Discovery returns patient_name: Lakshmi Venkatesh');
    assert(lakshmiSearch.total_institutions === 1, 'Lakshmi discovered at exactly 1 institution (Apollo)');
    assert(
      lakshmiSearch.institutions[0].institution_id === 'HOSP-1' &&
      lakshmiSearch.institutions[0].record_summary.total_records === 21,
      'Apollo node returns exactly 21 records summary'
    );
    assert(
      JSON.stringify(lakshmiSearch.institutions[0].record_summary.sensitive_categories_present) === JSON.stringify(['psychiatric']),
      'Apollo node exposes sensitive flag: ["psychiatric"]'
    );
    assert(
      lakshmiSearch.institutions[0].records === undefined,
      'Discovery Privacy Invariant: raw clinical records are NOT exposed in discovery response'
    );

    // 3.6 Multi-Hospital Patient (Krishnamurthy Rao) Discovery Query
    const krishSearchRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=ABHA-7712-4456-9081`, {
      headers: { 'Authorization': `Bearer ${doc2Login.token}` }
    });
    const krishSearch = await krishSearchRes.json();
    assert(krishSearchRes.status === 200, 'Search for Krishnamurthy returns 200');
    assert(krishSearch.total_institutions === 2, 'Krishnamurthy discovered at exactly 2 institutions (Fortis & Apollo)');
    const krishHospIds = krishSearch.institutions.map(i => i.institution_id).sort();
    assert(JSON.stringify(krishHospIds) === JSON.stringify(['HOSP-1', 'HOSP-2']), 'Institutions match HOSP-1 and HOSP-2');

    // 3.7 Verify Remaining Cohort Discovery Queries
    const remainingCohorts = [
      { abha: 'ABHA-5528-1193-4402', name: 'Saraswathi Nair', instCount: 2, sens: [] },
      { abha: 'ABHA-3390-6621-7845', name: 'Ananya Reddy', instCount: 2, sens: ['reproductive'] },
      { abha: 'ABHA-6604-8817-2239', name: 'Vikram Shetty', instCount: 2, sens: ['substance_abuse'] },
      { abha: 'ABHA-1147-9903-5561', name: 'Anika Pillai', instCount: 1, sens: [] }
    ];

    let allRemainingPass = true;
    for (const c of remainingCohorts) {
      const sRes = await fetch(`${GATEWAY_URL}/patient/search?health_id=${c.abha}`, {
        headers: { 'Authorization': `Bearer ${doc2Login.token}` }
      });
      const sData = await sRes.json();
      if (sRes.status !== 200 || sData.total_institutions !== c.instCount) {
        allRemainingPass = false;
      }
      if (c.sens.length > 0) {
        const hasSens = sData.institutions.some(i => JSON.stringify(i.record_summary.sensitive_categories_present) === JSON.stringify(c.sens));
        if (!hasSens) allRemainingPass = false;
      }
    }
    assert(allRemainingPass, 'Discovery searches for Saraswathi, Ananya, Vikram, and Anika match spec');

  } catch (err) {
    console.error('Fatal error during test execution:', err);
    failed++;
  } finally {
    await Promise.all([
      sysClient.close().catch(() => {}),
      h1Client.close().catch(() => {}),
      h2Client.close().catch(() => {}),
      h3Client.close().catch(() => {})
    ]);
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('----------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests();
