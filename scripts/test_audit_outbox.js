/**
 * FEDRA — Phase 3 Sprint 3 Part 4 Integration Test Suite
 * Backend Outbox Worker & Proof Relay API (Contract C-09)
 *
 * Verifies:
 * 1. writeAuditEvent creates events with tessera.status: 'pending'
 * 2. GET /audit/proof/:event_id returns HTTP 200 with status: 'pending' when not yet integrated
 * 3. Outbox worker pushes canonical_hash to Tessera (/add) and updates status: 'integrated'
 * 4. GET /audit/proof/:event_id returns Contract C-09 compliant proof payload
 * 5. In-browser client verifier simulation: Ed25519 checkpoint verification and RFC 6962 Merkle proof reconstruction
 * 6. RBAC: Unauthorized patient cannot fetch another patient's proof (HTTP 403)
 * 7. Negative cases: Non-existent event (HTTP 404), unauthenticated request (HTTP 401)
 * 8. End-to-end clinical workflow integration (emergency/records access -> outbox integration -> patient proof validation)
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

const BASE_URL = 'http://localhost:3000';
const TESSERA_URL = 'http://localhost:3600';
const MONGO_URI = 'mongodb://localhost:27020';

let testPassed = 0;
let testFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    testPassed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
    testFailed++;
  }
}

// RFC 6962 Helpers for Client-Side In-Browser Verifier
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function leafHash(dataHex) {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(dataHex, 'hex')]));
}

function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function largestPowerOf2LessThan(n) {
  let k = 1;
  while (k * 2 < n) {
    k *= 2;
  }
  return k;
}

function verifyProofTopDown(leafHex, m, n, proofHex) {
  if (n === 1) {
    return leafHash(leafHex);
  }
  const k = largestPowerOf2LessThan(n);
  const p = Buffer.from(proofHex[proofHex.length - 1], 'hex');
  const rest = proofHex.slice(0, proofHex.length - 1);
  if (m < k) {
    const left = verifyProofTopDown(leafHex, m, k, rest);
    return nodeHash(left, p);
  } else {
    const right = verifyProofTopDown(leafHex, m - k, n - k, rest);
    return nodeHash(p, right);
  }
}

function verifyC2SPCheckpoint(ckptText, logPubKeyHex) {
  const separatorIdx = ckptText.indexOf('— ');
  if (separatorIdx === -1) {
    throw new Error('Malformed checkpoint: missing C2SP separator');
  }

  const noteBody = ckptText.substring(0, separatorIdx);
  const sigLine = ckptText.substring(separatorIdx);
  const sigParts = sigLine.trim().split(' ');
  const sigB64 = sigParts[sigParts.length - 1];
  const sigBytes = Buffer.from(sigB64, 'base64');

  const pubKeyBytes = Buffer.from(logPubKeyHex, 'hex');
  const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
  const spkiKey = Buffer.concat([spkiHeader, pubKeyBytes]);
  const nodePubKey = crypto.createPublicKey({ key: spkiKey, format: 'der', type: 'spki' });

  const isSigValid = crypto.verify(null, Buffer.from(noteBody, 'utf8'), nodePubKey, sigBytes);

  const lines = noteBody.trim().split('\n');
  const origin = lines[0].trim();
  const treeSize = parseInt(lines[1].trim(), 10);
  const rootHashHex = Buffer.from(lines[2].trim(), 'base64').toString('hex');

  return {
    verified: isSigValid,
    origin,
    treeSize,
    rootHashHex
  };
}

async function runTests() {
  console.log('\n============================================================');
  console.log('FEDRA PHASE 3 SPRINT 3 PART 4 INTEGRATION TEST SUITE');
  console.log('Backend Outbox Worker & Proof Relay API (Contract C-09)');
  console.log('============================================================\n');

  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const db = mongoClient.db('system_db');

  const backendModule = require('../backend/index.js');
  backendModule.setSystemDb(db);

  try {
    // ----------------------------------------------------
    // Section 1: Doctor and Patient Authentication
    // ----------------------------------------------------
    console.log('--- Section 1: Authentication & Credentials Setup ---');

    // Doctor C
    const docLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doc3@test.com', password: 'password123' })
    });
    const docLoginData = await docLoginRes.json();
    assert(docLoginRes.status === 200 && docLoginData.token, 'Doctor C login successful');
    const doctorToken = docLoginData.token;

    // Patient 1: Lakshmi Venkatesh (ABHA-4471-2298-6613)
    const pat1LoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
    });
    const pat1LoginData = await pat1LoginRes.json();
    assert(pat1LoginRes.status === 200 && pat1LoginData.token, 'Patient Lakshmi login successful');
    const patient1Token = pat1LoginData.token;
    const patient1HealthId = 'ABHA-4471-2298-6613';

    // Patient 2: Krishnamurthy Rao (ABHA-7712-4456-9081) for RBAC negative tests
    const pat2LoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'krishnamurthy-rao@test.com', password: 'password123' })
    });
    const pat2LoginData = await pat2LoginRes.json();
    assert(pat2LoginRes.status === 200 && pat2LoginData.token, 'Patient Krishnamurthy login successful');
    const patient2Token = pat2LoginData.token;

    // ----------------------------------------------------
    // Section 2: Direct Audit Event Insertion & Pending Proof State
    // ----------------------------------------------------
    console.log('\n--- Section 2: Pending Event & Pre-Integration Proof Query ---');

    const testSyntheticEventId = `EVT-TEST-OUTBOX-${Date.now().toString().slice(-4)}`;
    
    // Manually write an event via backend's writeAuditEvent to ensure contract C-04 / C-05 compliance
    const eventDoc = await backendModule.writeAuditEvent({
      event_id: testSyntheticEventId,
      event_type: 'clinical_consultation_test',
      actor: { id: 'DOC-AIIMS-003', name: 'Dr. C. Iyer' },
      subject_health_id: patient1HealthId,
      metadata: { test_purpose: 'outbox_worker_verification' }
    });

    assert(eventDoc.tessera.status === 'pending', 'writeAuditEvent creates document with tessera.status: "pending"');
    assert(eventDoc.tessera.log_index === null, 'Pending document has log_index: null');
    assert(typeof eventDoc.canonical_hash === 'string' && eventDoc.canonical_hash.length === 64, 'Canonical hash computed');

    // Call GET /audit/proof/:event_id BEFORE outbox poller runs
    const preProofRes = await fetch(`${BASE_URL}/audit/proof/${testSyntheticEventId}`, {
      headers: { 'Authorization': `Bearer ${patient1Token}` }
    });
    const preProofData = await preProofRes.json();

    assert(preProofRes.status === 200, 'GET /audit/proof/:event_id returns HTTP 200 for pending event');
    assert(preProofData.status === 'pending', 'Pre-integration response status is "pending"');
    assert(preProofData.canonical_hash === eventDoc.canonical_hash, 'Pre-integration returns canonical_hash');
    assert(preProofData.message.includes('queued'), 'Pre-integration includes informational queued message');

    // ----------------------------------------------------
    // Section 3: Outbox Poller Execution & MongoDB State Update
    // ----------------------------------------------------
    console.log('\n--- Section 3: Outbox Poller Execution & State Transition ---');

    // Execute poll cycle
    await backendModule.pollTesseraOutbox();

    // Query DB to verify updated document
    const updatedDoc = await db.collection('audit_events').findOne({ event_id: testSyntheticEventId });
    assert(updatedDoc.tessera.status === 'integrated', 'Event transitioned to tessera.status: "integrated"');
    assert(typeof updatedDoc.tessera.log_index === 'number' && updatedDoc.tessera.log_index >= 0, `Assigned log_index (${updatedDoc.tessera.log_index}) is non-negative integer`);
    assert(typeof updatedDoc.tessera.tree_size === 'number' && updatedDoc.tessera.tree_size > updatedDoc.tessera.log_index, 'Assigned tree_size is greater than log_index');
    assert(updatedDoc.tessera.integrated_at instanceof Date, 'integrated_at timestamp recorded');

    // ----------------------------------------------------
    // Section 4: Contract C-09 Proof Relay API Validation
    // ----------------------------------------------------
    console.log('\n--- Section 4: Proof Relay API (Contract C-09 Schema) ---');

    const proofRes = await fetch(`${BASE_URL}/audit/proof/${testSyntheticEventId}`, {
      headers: { 'Authorization': `Bearer ${patient1Token}` }
    });
    const proofData = await proofRes.json();

    assert(proofRes.status === 200, 'GET /audit/proof/:event_id returns HTTP 200 when integrated');
    assert(proofData.event_id === testSyntheticEventId, 'Response event_id matches');
    assert(proofData.canonical_hash === updatedDoc.canonical_hash, 'Response canonical_hash matches stored canonical_hash');
    assert(proofData.log_index === updatedDoc.tessera.log_index, 'Response log_index matches log_index');
    assert(typeof proofData.tree_size === 'number', 'Response contains integer tree_size');
    assert(Array.isArray(proofData.inclusion_proof), 'Response contains inclusion_proof array');
    assert(typeof proofData.checkpoint === 'string' && proofData.checkpoint.includes('fedra.audit.log'), 'Response contains C2SP checkpoint');
    assert(proofData.origin === 'fedra.audit.log', 'Response origin is "fedra.audit.log"');
    assert(typeof proofData.public_key === 'string' && proofData.public_key.length === 64, 'Response contains 32-byte Ed25519 public key in hex');
    assert(proofData.verified === undefined, 'Contract C-09 Invariant: Server strictly NEVER returns "verified": true');

    // ----------------------------------------------------
    // Section 5: Client-Side Cryptographic Verifier Simulation
    // ----------------------------------------------------
    console.log('\n--- Section 5: In-Browser Cryptographic Verifier Simulation ---');

    // 1. Verify Ed25519 signature on C2SP checkpoint
    const checkpointVerify = verifyC2SPCheckpoint(proofData.checkpoint, proofData.public_key);
    assert(checkpointVerify.verified === true, 'Client verifies Ed25519 signature on C2SP Checkpoint');
    assert(checkpointVerify.origin === 'fedra.audit.log', 'Checkpoint origin matches expected origin');
    assert(checkpointVerify.treeSize === proofData.tree_size, 'Checkpoint tree size matches response tree size');

    // 2. Reconstruct Merkle Root from leaf canonical hash and inclusion proof
    const reconstructedRoot = verifyProofTopDown(
      proofData.canonical_hash,
      proofData.log_index,
      proofData.tree_size,
      proofData.inclusion_proof
    );
    const reconstructedRootHex = reconstructedRoot.toString('hex');
    assert(reconstructedRootHex === checkpointVerify.rootHashHex, `Merkle path reconstruction matches checkpoint root (${reconstructedRootHex.slice(0, 16)}...)`);

    // ----------------------------------------------------
    // Section 6: RBAC & Negative Security Tests
    // ----------------------------------------------------
    console.log('\n--- Section 6: RBAC & Security Boundary Tests ---');

    // 1. Cross-patient unauthorized proof retrieval (Krishnamurthy trying to get Lakshmi's proof)
    const unauthorizedRes = await fetch(`${BASE_URL}/audit/proof/${testSyntheticEventId}`, {
      headers: { 'Authorization': `Bearer ${patient2Token}` }
    });
    assert(unauthorizedRes.status === 403, 'Cross-patient proof retrieval returns HTTP 403 Forbidden');

    // 2. Clinician / Supervisor authorized access to proof
    const docProofRes = await fetch(`${BASE_URL}/audit/proof/${testSyntheticEventId}`, {
      headers: { 'Authorization': `Bearer ${doctorToken}` }
    });
    assert(docProofRes.status === 200, 'Clinician with valid JWT can retrieve audit proof for compliance auditing');

    // 3. Unauthenticated request
    const noAuthRes = await fetch(`${BASE_URL}/audit/proof/${testSyntheticEventId}`);
    assert(noAuthRes.status === 401, 'Unauthenticated request returns HTTP 401 Unauthorized');

    // 4. Non-existent event_id
    const notFoundRes = await fetch(`${BASE_URL}/audit/proof/EVT-NON-EXISTENT-99999`, {
      headers: { 'Authorization': `Bearer ${patient1Token}` }
    });
    assert(notFoundRes.status === 404, 'Non-existent event_id returns HTTP 404 Not Found');

    // ----------------------------------------------------
    // Section 7: End-to-End Real Clinical Workflow Outbox Integration
    // ----------------------------------------------------
    console.log('\n--- Section 7: End-to-End Clinical Flow Integration ---');

    // Clear prior break-glass rate limits for clean test execution
    await db.collection('audit_events').deleteMany({
      'actor.id': docLoginData.user_id || 'DOC-AIIMS-003',
      event_type: 'break_glass_triggered'
    });

    // Declare a break-glass emergency for patient Lakshmi to generate a real-world clinical audit event
    const bgRes = await fetch(`${BASE_URL}/consent/break-glass`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${doctorToken}`
      },
      body: JSON.stringify({
        health_id: patient1HealthId,
        justification: 'Acute respiratory emergency in trauma bay requiring emergent intubation',
        requested_duration_hrs: 4
      })
    });
    const bgData = await bgRes.json();
    assert((bgRes.status === 200 || bgRes.status === 201) && bgData.token_id, `Break-glass emergency declared successfully (status: ${bgRes.status})`);

    // Retrieve patient audit events
    const auditTrailRes = await fetch(`${BASE_URL}/audit/patient/${patient1HealthId}`, {
      headers: { 'Authorization': `Bearer ${patient1Token}` }
    });
    const auditTrailData = await auditTrailRes.json();
    assert(auditTrailRes.status === 200 && auditTrailData.events.length > 0, 'Patient audit trail retrieved');

    // Find the break-glass event
    const realBgEvent = auditTrailData.events.find(e => e.event_type === 'break_glass_triggered');
    assert(realBgEvent !== undefined, 'Found real-world break_glass_triggered audit event');

    // Wait for the background outbox worker (up to 6 seconds) to integrate it automatically
    let isBgIntegrated = false;
    let bgProofData = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const checkRes = await fetch(`${BASE_URL}/audit/proof/${realBgEvent.event_id}`, {
        headers: { 'Authorization': `Bearer ${patient1Token}` }
      });
      const checkData = await checkRes.json();
      if (checkRes.status === 200 && checkData.inclusion_proof) {
        isBgIntegrated = true;
        bgProofData = checkData;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    assert(isBgIntegrated === true, 'Background outbox worker automatically integrated real clinical event');
    assert(bgProofData?.log_index >= 0, `Real event integrated at log_index ${bgProofData?.log_index}`);

    // Verify cryptographic proof for the real clinical event
    const realCheckpointVerify = verifyC2SPCheckpoint(bgProofData.checkpoint, bgProofData.public_key);
    assert(realCheckpointVerify.verified === true, 'Real event C2SP checkpoint Ed25519 signature verified');

    const realReconstructedRoot = verifyProofTopDown(
      bgProofData.canonical_hash,
      bgProofData.log_index,
      bgProofData.tree_size,
      bgProofData.inclusion_proof
    );
    assert(realReconstructedRoot.toString('hex') === realCheckpointVerify.rootHashHex, 'Real event RFC 6962 inclusion proof valid against Merkle root');

    // Clean up emergency token
    await fetch(`${BASE_URL}/consent/break-glass/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${doctorToken}`
      },
      body: JSON.stringify({ token_id: bgData.token_id, reason: 'Integration test completed cleanly' })
    });

    console.log('\n============================================================');
    console.log(`TEST SUMMARY: ${testPassed} PASSED, ${testFailed} FAILED`);
    console.log('============================================================\n');

    process.exit(testFailed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

runTests();
