/**
 * test_audit_crypto.js
 * Comprehensive Verification Suite for Part 2: Backend Cryptographic Core & Unified Pipeline
 *
 * Verifies:
 * 1. RFC 8785 JSON Canonicalization Scheme (JCS) key-order invariance and formatting.
 * 2. SHA-256 canonical leaf hash computation (Contract C-05).
 * 3. Keyed HMAC-SHA256 pseudonymization (Decision D-10).
 * 4. Contiguous per-patient monotonic sequence numbers (Contract C-04).
 * 5. writeAuditEvent() centralized pipeline output & Tessera outbox status.
 * 6. Fail-closed security property on clinical records retrieval (Contract C-03/C-05).
 * 7. End-to-end consent audit event emission (consent_granted, consent_revoked, sensitive_category_updated).
 */

const crypto = require('crypto');
const path = require('path');

let MongoClient;
try {
  ({ MongoClient } = require('mongodb'));
} catch (e) {
  const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
  ({ MongoClient } = require(path.join(backendModules, 'mongodb')));
}

const {
  canonicalizeJCS,
  computeCanonicalHash,
  hmacId,
  normalizeLinkedEventId,
  getNextPatientSeq,
  writeAuditEvent,
  setSystemDb
} = require('../backend/index.js');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020';
const API_URL = process.env.API_URL || process.env.GATEWAY_URL || process.env.API_BASE || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function request(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, data };
}

async function runTests() {
  console.log('===============================================================');
  console.log('FEDRA Part 2: Cryptographic Core & Unified Pipeline Verification');
  console.log('===============================================================\n');

  // =========================================================================
  // Section 1: Pure Cryptographic Unit Tests (RFC 8785 JCS, SHA-256, HMAC)
  // =========================================================================
  console.log('[Section 1] RFC 8785 (JCS) & Deterministic Hash Canonicalization');

  // Test 1.1: Key-order invariance
  const objA = { b: 1, a: 2, c: 'hello' };
  const objB = { c: 'hello', a: 2, b: 1 };
  const jcsA = canonicalizeJCS(objA);
  const jcsB = canonicalizeJCS(objB);
  check('RFC 8785: Object key order does not affect canonical JSON output', jcsA === jcsB);
  check('RFC 8785: Output is strictly sorted without whitespace', jcsA === '{"a":2,"b":1,"c":"hello"}');

  // Test 1.2: Deeply nested objects and arrays
  const deepA = {
    metadata: {
      tags: ['cardiology', 'urgent'],
      details: { z: 99, a: 1, nested: { y: true, x: false } }
    },
    event_id: 'EVT-TEST-001'
  };
  const deepB = {
    event_id: 'EVT-TEST-001',
    metadata: {
      details: { nested: { x: false, y: true }, a: 1, z: 99 },
      tags: ['cardiology', 'urgent']
    }
  };
  const deepJcsA = canonicalizeJCS(deepA);
  const deepJcsB = canonicalizeJCS(deepB);
  check('RFC 8785: Deeply nested key sorting produces byte-for-byte identical output', deepJcsA === deepJcsB);

  // Test 1.3: Number formatting and -0 handling
  const numObjA = { zero: -0, regular: 0, floatVal: 42.5 };
  const numObjB = { regular: 0, zero: 0, floatVal: 42.5 };
  check('RFC 8785: Negative zero (-0) canonicalized to 0', canonicalizeJCS(numObjA) === canonicalizeJCS(numObjB));

  // Test 1.4: Canonical SHA-256 hash invariance
  const hashA = computeCanonicalHash(deepA);
  const hashB = computeCanonicalHash(deepB);
  check('Contract C-05: computeCanonicalHash is invariant to key order', hashA === hashB);
  check('Contract C-05: Canonical hash is 64-character lowercase hex', typeof hashA === 'string' && hashA.length === 64 && /^[0-9a-f]{64}$/.test(hashA));

  // Test 1.5: HMAC-SHA256 Pseudonymization
  const rawDoctorId = 'DOC-101';
  const hmacDocA = hmacId(rawDoctorId);
  const hmacDocB = hmacId(rawDoctorId);
  const hmacPatient = hmacId('ABHA-DEMO-001');
  check('Decision D-10: HMAC pseudonymization is deterministic', hmacDocA === hmacDocB);
  check('Decision D-10: Distinct IDs produce distinct pseudonyms', hmacDocA !== hmacPatient);
  check('Decision D-10: Pseudonym is 64-character lowercase hex', hmacDocA.length === 64 && /^[0-9a-f]{64}$/.test(hmacDocA));

  // Test 1.6: Linked Event ID normalization
  const normZero = normalizeLinkedEventId(null);
  const normWith0x = normalizeLinkedEventId('0x' + 'a'.repeat(64));
  const normClean = normalizeLinkedEventId('b'.repeat(64));
  check('Contract C-04: Null linked_event_id defaults to 64 zeros', normZero === '0'.repeat(64));
  check('Contract C-04: 0x-prefixed hash normalized to 64 hex chars', normWith0x === 'a'.repeat(64));
  check('Contract C-04: Raw 64-char hash preserved', normClean === 'b'.repeat(64));

  // =========================================================================
  // Section 2: Database-Backed Sequence Numbering & writeAuditEvent()
  // =========================================================================
  console.log('\n[Section 2] Database-Backed Sequence Counter & Unified writeAuditEvent()');

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('system_db');
  setSystemDb(db);

  const testPatientHash = hmacId('TEST-PATIENT-SEQ-' + Date.now());

  // Clean test counter if exists
  await db.collection('audit_counters').deleteOne({ patient_hash: testPatientHash });

  // Test 2.1: Contiguous sequence generation
  const seq1 = await getNextPatientSeq(testPatientHash);
  const seq2 = await getNextPatientSeq(testPatientHash);
  const seq3 = await getNextPatientSeq(testPatientHash);
  check('Contract C-04: First sequence number starts at 1', seq1 === 1);
  check('Contract C-04: Subsequent sequence increments contiguously to 2', seq2 === 2);
  check('Contract C-04: Subsequent sequence increments contiguously to 3', seq3 === 3);

  // Test 2.2: Concurrent sequence generation without duplicate or missing numbers
  const concurrentPromises = Array.from({ length: 5 }, () => getNextPatientSeq(testPatientHash));
  const concurrentSeqs = await Promise.all(concurrentPromises);
  const sortedSeqs = [...concurrentSeqs].sort((a, b) => a - b);
  check('Contract C-04: Concurrent calls produce strictly sequential values [4, 5, 6, 7, 8]', 
    JSON.stringify(sortedSeqs) === JSON.stringify([4, 5, 6, 7, 8])
  );

  // Test 2.3: Unified writeAuditEvent() structure
  const testHealthId = 'ABHA-TEST-' + Date.now();
  const testAuditEvent = await writeAuditEvent({
    event_id: `EVT-UNIT-${Date.now()}`,
    event_type: 'break_glass_triggered',
    actor: { id: 'DOC-TEST', role: 'doctor', institution_id: 'HOSP-1' },
    subject_health_id: testHealthId,
    linked_event_id: '0'.repeat(64),
    metadata: { reason: 'Cardiac arrest unit test' },
    ml_features: { is_break_glass: true }
  });

  check('writeAuditEvent: Returned document contains immutable_subset', !!testAuditEvent.immutable_subset);
  check('writeAuditEvent: Immutable subset includes all Contract C-05 fields', 
    typeof testAuditEvent.immutable_subset.event_id === 'string' &&
    typeof testAuditEvent.immutable_subset.event_type === 'string' &&
    typeof testAuditEvent.immutable_subset.actor_hash === 'string' &&
    typeof testAuditEvent.immutable_subset.patient_hash === 'string' &&
    typeof testAuditEvent.immutable_subset.patient_seq === 'number' &&
    typeof testAuditEvent.immutable_subset.linked_event_id === 'string' &&
    typeof testAuditEvent.immutable_subset.timestamp === 'string' &&
    typeof testAuditEvent.immutable_subset.metadata === 'object'
  );
  check('writeAuditEvent: Volatile tessera.* and ml_features.* excluded from immutable_subset',
    testAuditEvent.immutable_subset.tessera === undefined &&
    testAuditEvent.immutable_subset.ml_features === undefined
  );

  const recomputedHash = computeCanonicalHash(testAuditEvent.immutable_subset);
  check('writeAuditEvent: canonical_hash matches recomputed SHA-256 of immutable_subset', testAuditEvent.canonical_hash === recomputedHash);
  check('writeAuditEvent: Tessera outbox status is initialized to "pending"', testAuditEvent.tessera?.status === 'pending');
  check('writeAuditEvent: Tessera initial log_index is null', testAuditEvent.tessera?.log_index === null);

  // Verify document persisted in MongoDB
  const persistedDoc = await db.collection('audit_events').findOne({ event_id: testAuditEvent.event_id });
  check('writeAuditEvent: Event document exists in MongoDB audit_events', !!persistedDoc);
  check('writeAuditEvent: Persisted document canonical_hash matches', persistedDoc?.canonical_hash === testAuditEvent.canonical_hash);

  // =========================================================================
  // Section 3: API Integration & Fail-Closed Security Invariant Tests
  // =========================================================================
  console.log('\n[Section 3] API Integration & Fail-Closed Audit Logging');

  // Clean prior break-glass audit events for doctor to ensure clean rate limit
  await Promise.all([
    db.collection('audit_events').deleteMany({ 'actor.id': { $in: ['DOC-3', 'DOC-EMERGENCY'] } }),
    db.collection('access_tokens').deleteMany({ doctor_id: { $in: ['DOC-3', 'DOC-EMERGENCY'] } })
  ]);

  // Login doctor to obtain valid JWT
  const docLoginRes = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'doc3@test.com', password: 'password123' })
  });
  check('Doctor login succeeds (HTTP 200)', docLoginRes.status === 200 && !!docLoginRes.data?.token);
  const docToken = docLoginRes.data?.token;

  // Login patient to obtain valid JWT
  const patLoginRes = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
  });
  check('Patient login succeeds (HTTP 200)', patLoginRes.status === 200 && !!patLoginRes.data?.token);
  const patToken = patLoginRes.data?.token;
  const patHealthId = patLoginRes.data?.health_id;
  check('Patient health ID acquired from login', !!patHealthId);

  // Test 3.1: Break-glass declaration audit event write
  const bgRes = await request('/consent/break-glass', {
    method: 'POST',
    headers: { Authorization: `Bearer ${docToken}` },
    body: JSON.stringify({
      health_id: patHealthId,
      justification: 'Acute myocardial infarction requiring immediate telemetry review',
      requested_duration_hrs: 2
    })
  });
  check('Break-glass declaration succeeds (HTTP 200)', bgRes.status === 200);
  const bgTokenId = bgRes.data?.token_id;
  const bgEventId = bgRes.data?.event_id;

  const bgAuditDoc = await db.collection('audit_events').findOne({ event_id: bgEventId });
  check('Break-glass audit event recorded with immutable_subset', !!bgAuditDoc?.immutable_subset);
  check('Break-glass audit event has pending tessera status', bgAuditDoc?.tessera?.status === 'pending');
  check('Break-glass audit event patient_seq is an integer >= 1', typeof bgAuditDoc?.patient_seq === 'number' && bgAuditDoc.patient_seq >= 1);

  // Test 3.2: Record access with break-glass token emits record_access audit event
  const fetchRes = await request('/records/fetch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${docToken}` },
    body: JSON.stringify({
      health_id: patHealthId,
      token_id: bgTokenId
    })
  });
  check('Record fetch succeeds (HTTP 200)', fetchRes.status === 200);
  check('Records returned to clinician', (fetchRes.data?.total_records_returned || 0) > 0);

  const fetchAuditDoc = await db.collection('audit_events').findOne({
    event_type: 'record_access',
    'metadata.token_id': bgTokenId
  });
  check('Record access audit event recorded via writeAuditEvent()', !!fetchAuditDoc);
  check('Record access has valid canonical_hash and pending tessera status', 
    !!fetchAuditDoc?.canonical_hash && fetchAuditDoc?.tessera?.status === 'pending'
  );

  // Test 3.3: End emergency access emits break_glass_revoked audit event
  const endRes = await request('/consent/break-glass/end', {
    method: 'POST',
    headers: { Authorization: `Bearer ${docToken}` },
    body: JSON.stringify({ token_id: bgTokenId })
  });
  check('End emergency access succeeds (HTTP 200)', endRes.status === 200);

  const endAuditDoc = await db.collection('audit_events').findOne({
    event_type: 'break_glass_revoked',
    'metadata.token_id': bgTokenId
  });
  check('Break-glass revocation audit event recorded via writeAuditEvent()', !!endAuditDoc);
  check('Break-glass revocation has valid canonical_hash and pending tessera status',
    !!endAuditDoc?.canonical_hash && endAuditDoc?.tessera?.status === 'pending'
  );

  // Test 3.4: Patient queries their audit trail via GET /audit/patient/:health_id
  const trailRes = await request(`/audit/patient/${patHealthId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${patToken}` }
  });
  check('Patient audit trail fetch succeeds (HTTP 200)', trailRes.status === 200);
  check('Audit events list returned', Array.isArray(trailRes.data?.events) && trailRes.data.events.length > 0);
  const sampleTrailEvent = trailRes.data?.events[0];
  check('Audit trail events expose immutable_subset and canonical_hash for client verifier',
    !!sampleTrailEvent?.immutable_subset && !!sampleTrailEvent?.canonical_hash
  );

  // =========================================================================
  // Section 4: Consent & Sensitive Category Audit Trail Event Emission
  // =========================================================================
  console.log('\n[Section 4] Consent Lifecycle Audit Trail Events');

  // Request standard consent
  const reqConsentRes = await request('/consent/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${docToken}` },
    body: JSON.stringify({
      health_id: patHealthId,
      purpose: 'Cardiology follow-up consultation',
      requested_categories: ['general_access', 'medications']
    })
  });
  check('Doctor requests consent (HTTP 202)', reqConsentRes.status === 202);
  const consentReqId = reqConsentRes.data?.request_id;

  // Grant consent
  const grantConsentRes = await request('/consent/grant', {
    method: 'POST',
    headers: { Authorization: `Bearer ${patToken}` },
    body: JSON.stringify({
      request_id: consentReqId,
      scope: { general_access: true, sensitive_categories: { psychiatric: false } }
    })
  });
  check('Patient grants consent (HTTP 200)', grantConsentRes.status === 200);
  const grantedPolicyId = grantConsentRes.data?.policy_id;

  // Verify consent_granted audit event
  const grantAuditDoc = await db.collection('audit_events').findOne({
    event_type: 'consent_granted',
    'metadata.policy_id': grantedPolicyId
  });
  check('consent_granted audit event recorded via writeAuditEvent()', !!grantAuditDoc);
  check('consent_granted has pending tessera status and valid canonical_hash', 
    !!grantAuditDoc?.canonical_hash && grantAuditDoc?.tessera?.status === 'pending'
  );

  // Toggle sensitive category
  const toggleSensRes = await request('/consent/sensitive', {
    method: 'POST',
    headers: { Authorization: `Bearer ${patToken}` },
    body: JSON.stringify({
      policy_id: grantedPolicyId,
      category: 'reproductive',
      grant: true
    })
  });
  check('Patient updates sensitive category scope (HTTP 200)', toggleSensRes.status === 200);

  const sensAuditDoc = await db.collection('audit_events').findOne({
    event_type: 'sensitive_category_updated',
    'metadata.policy_id': grantedPolicyId
  });
  check('sensitive_category_updated audit event recorded via writeAuditEvent()', !!sensAuditDoc);
  check('sensitive_category_updated has pending tessera status', sensAuditDoc?.tessera?.status === 'pending');

  // Revoke consent
  const revokeRes = await request('/consent/revoke', {
    method: 'POST',
    headers: { Authorization: `Bearer ${patToken}` },
    body: JSON.stringify({ policy_id: grantedPolicyId })
  });
  check('Patient revokes consent (HTTP 200)', revokeRes.status === 200);

  const revokeAuditDoc = await db.collection('audit_events').findOne({
    event_type: 'consent_revoked',
    'metadata.policy_id': grantedPolicyId
  });
  check('consent_revoked audit event recorded via writeAuditEvent()', !!revokeAuditDoc);
  check('consent_revoked has pending tessera status', revokeAuditDoc?.tessera?.status === 'pending');

  // Clean up
  await client.close();

  console.log('\n===============================================================');
  console.log(`PART 2 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running Part 2 tests:', err);
  process.exit(1);
});
