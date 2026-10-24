/**
 * test_tessera_service.js
 * Verification Suite for Part 3: Tessera Transparency Log Service
 *
 * Verifies:
 * 1. Tessera container health and origin configuration.
 * 2. POST /add leaf hash append and tree_size increments.
 * 3. GET /checkpoint C2SP Signed Note format and Ed25519 signature validity.
 * 4. GET /proof RFC 6962 inclusion proof reconstruction against the signed root hash.
 * 5. Multi-leaf inclusion proof verification across diverse indices.
 */

const crypto = require('crypto');

const TESSERA_URL = process.env.TESSERA_URL || 'http://localhost:3600';

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

// RFC 6962 helpers for client-side root reconstruction
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

async function request(endpoint, options = {}) {
  const url = `${TESSERA_URL}${endpoint}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  return { status: res.status, ok: res.ok, data, rawText: text };
}

async function runTests() {
  console.log('===============================================================');
  console.log('FEDRA Part 3: Tessera Transparency Log Service Verification');
  console.log('===============================================================\n');

  // Test 1: Container Health Check
  console.log('[Step 1] Checking Service Health & Public Key...');
  const healthRes = await request('/health');
  check('Tessera container is UP (HTTP 200)', healthRes.status === 200);
  check('Health reports status: healthy', healthRes.data?.status === 'healthy');
  check('Origin matches configured origin: fedra.audit.log', healthRes.data?.origin === 'fedra.audit.log');
  check('Log exposes Ed25519 public key hex', typeof healthRes.data?.public_key === 'string' && healthRes.data.public_key.length === 64);
  const logPubKeyHex = healthRes.data?.public_key;

  // Test 2: PubKey Endpoint
  const pubkeyRes = await request('/pubkey');
  check('GET /pubkey responds HTTP 200', pubkeyRes.status === 200);
  check('Public key matches between /health and /pubkey', pubkeyRes.data?.public_key_hex === logPubKeyHex);

  // Test 3: Append First Leaf (POST /add)
  console.log('\n[Step 2] Appending Leaves (POST /add)...');
  const sampleLeaf1 = crypto.createHash('sha256').update('FEDRA-TEST-EVENT-001', 'utf8').digest('hex');
  const addRes1 = await request('/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaf_hash: sampleLeaf1 })
  });

  check('POST /add returns HTTP 200', addRes1.status === 200);
  check('Returns non-negative log_index', typeof addRes1.data?.log_index === 'number');
  check('Returns positive tree_size', addRes1.data?.tree_size > 0);
  check('Returns 64-char root_hash hex', typeof addRes1.data?.root_hash === 'string' && addRes1.data.root_hash.length === 64);
  const initialIndex = addRes1.data?.log_index;

  // Append 3 more sample leaves
  const sampleLeaves = [
    crypto.createHash('sha256').update('FEDRA-TEST-EVENT-002', 'utf8').digest('hex'),
    crypto.createHash('sha256').update('FEDRA-TEST-EVENT-003', 'utf8').digest('hex'),
    crypto.createHash('sha256').update('FEDRA-TEST-EVENT-004', 'utf8').digest('hex')
  ];

  for (let i = 0; i < sampleLeaves.length; i++) {
    const addRes = await request('/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaf_hash: sampleLeaves[i] })
    });
    check(`Append leaf ${i + 2} returns sequential index ${initialIndex + i + 1}`, addRes.data?.log_index === initialIndex + i + 1);
  }

  // Test 4: Checkpoint Verification (C2SP Signed Note & Ed25519 Signature)
  console.log('\n[Step 3] Verifying C2SP Checkpoint & Ed25519 Signature...');
  const ckptTextRes = await request('/checkpoint');
  check('GET /checkpoint (text/plain) responds HTTP 200', ckptTextRes.status === 200);
  const ckptText = ckptTextRes.rawText;
  check('Checkpoint starts with origin header fedra.audit.log', ckptText.startsWith('fedra.audit.log\n'));
  check('Checkpoint contains C2SP signature separator ("— fedra.audit.log ")', ckptText.includes('— fedra.audit.log '));

  // Parse C2SP Note and verify Ed25519 signature
  const separatorIdx = ckptText.indexOf('— ');
  const noteBody = ckptText.substring(0, separatorIdx);
  const sigLine = ckptText.substring(separatorIdx);
  const sigParts = sigLine.trim().split(' ');
  const sigB64 = sigParts[sigParts.length - 1];
  const sigBytes = Buffer.from(sigB64, 'base64');

  // Construct Node.js Ed25519 SPKI public key from 32-byte raw pubkey
  const pubKeyBytes = Buffer.from(logPubKeyHex, 'hex');
  const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
  const spkiKey = Buffer.concat([spkiHeader, pubKeyBytes]);
  const nodePubKey = crypto.createPublicKey({ key: spkiKey, format: 'der', type: 'spki' });

  const isSigValid = crypto.verify(null, Buffer.from(noteBody, 'utf8'), nodePubKey, sigBytes);
  check('C2SP Signed Note Ed25519 signature is CRYPTOGRAPHICALLY VALID', isSigValid === true);

  // Check JSON format of checkpoint
  const ckptJsonRes = await request('/checkpoint?format=json');
  check('GET /checkpoint?format=json responds HTTP 200', ckptJsonRes.status === 200);
  check('JSON checkpoint includes tree_size, root_hash, and raw checkpoint note', 
    typeof ckptJsonRes.data?.tree_size === 'number' &&
    typeof ckptJsonRes.data?.root_hash === 'string' &&
    typeof ckptJsonRes.data?.checkpoint === 'string'
  );

  // Test 5: Merkle Inclusion Proof (GET /proof?index=N)
  console.log('\n[Step 4] Verifying RFC 6962 Merkle Inclusion Proofs...');
  const latestTreeSize = ckptJsonRes.data?.tree_size;
  const currentRootHex = ckptJsonRes.data?.root_hash;

  for (let idx = 0; idx < latestTreeSize; idx++) {
    const proofRes = await request(`/proof?index=${idx}`);
    check(`GET /proof?index=${idx} responds HTTP 200`, proofRes.status === 200);
    check(`Proof for index ${idx} contains inclusion_proof array`, Array.isArray(proofRes.data?.inclusion_proof));

    const proofLeafHex = proofRes.data?.leaf_hash;
    const proofArray = proofRes.data?.inclusion_proof;
    const reconstructedRoot = verifyProofTopDown(proofLeafHex, idx, latestTreeSize, proofArray).toString('hex');

    check(`RFC 6962 Merkle path for index ${idx} reconstructs exact root hash (${reconstructedRoot.slice(0, 12)}...)`, 
      reconstructedRoot === currentRootHex
    );
  }

  // Test 6: Out of bounds proof rejection
  const invalidProofRes = await request(`/proof?index=${latestTreeSize + 99}`);
  check('Out-of-bounds index returns HTTP 400 Bad Request', invalidProofRes.status === 400);

  console.log('\n===============================================================');
  console.log(`PART 3 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running Tessera tests:', err);
  process.exit(1);
});
