/**
 * FEDRA — Phase 3 Sprint 2 Automated Verification Suite
 * Tests Break-Glass Lifecycle Branches, 15-Minute Grace Period & Supervisor Engine:
 * 1. Branch A: Upfront Long-Window Routing (>2h requested -> 2h issued + supervisor ticket)
 * 2. Branch B: Layer 1 Automated Rule Engine (<=2h, 1st extension, 0 flags -> instant auto-approval + C-04 hash chain)
 * 3. Branch B: Layer 2 Supervisor Escalation (>2h extension -> enqueued in supervisor_tickets with 15m SLA)
 * 4. Branch C: 15-Minute Grace Period (Decision D-07 -> GET /consent/validate in_grace_period, POST /records/fetch HTTP 423 Locked)
 * 5. Branch C: Grace Period Reinstatement (POST /consent/break-glass/reinstate -> enqueued in supervisor_tickets)
 * 6. Branch C: Post-Grace Expiry (Elapsed >15m -> HTTP 410 Gone on reinstatement attempt)
 * 7. Supervisor Review Service:
 *    - RBAC enforcement (Supervisors/Admins allowed, regular doctors HTTP 403)
 *    - GET /supervisor/queue with dynamic sla_remaining_sec
 *    - POST /supervisor/review (approve -> restores active token + C-04 audit event; deny -> marks denied)
 * 8. Reinstated Token Clinical Access: POST /records/fetch succeeds after supervisor approval
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

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

let MongoClient;
try {
  ({ MongoClient } = require('mongodb'));
} catch (e) {
  const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
  ({ MongoClient } = require(path.join(backendModules, 'mongodb')));
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020';

async function getDbClient() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  return client;
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
  console.log('  FEDRA — Phase 3 Sprint 2 Break-Glass Lifecycle & Supervisor Test');
  console.log('================================================================\n');

  let dbClient = null;

  try {
    dbClient = await getDbClient();
    const systemDb = dbClient.db('system_db');

    // Clean prior sprint 2 test artifacts for idempotent execution
    await Promise.all([
      systemDb.collection('supervisor_tickets').deleteMany({ doctor_id: { $in: ['DOC-EMERGENCY', 'DOC-3', 'DOC-TEST-S2'] } }),
      systemDb.collection('audit_events').deleteMany({ 'actor.id': { $in: ['DOC-EMERGENCY', 'DOC-3', 'DOC-SUP-01', 'DOC-TEST-S2'] } }),
      systemDb.collection('access_tokens').deleteMany({ doctor_id: { $in: ['DOC-EMERGENCY', 'DOC-3', 'DOC-TEST-S2'] } })
    ]);

    // ---------------------------------------------------------
    // Step 0: Authenticate Personas
    // ---------------------------------------------------------
    console.log('[Step 0] Authenticating Personas...');

    // Emergency Clinician: Dr. Rahul Verma at Apollo (HOSP-1)
    const erLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'er@test.com', password: 'password123' })
    });
    check('Emergency Doctor login succeeds (200)', erLogin.status === 200);
    const erToken = erLogin.data?.token;

    // Doctor C: Dr. Rajesh Iyer at Max (HOSP-3)
    const doc3Login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'doc3@test.com', password: 'password123' })
    });
    check('Doctor C (Dr. Rajesh Iyer) login succeeds (200)', doc3Login.status === 200);
    const doc3Token = doc3Login.data?.token;

    // Clinical Supervisor: Dr. K. S. Venkatesh (HOSP-1)
    const supLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'supervisor@test.com', password: 'password123' })
    });
    check('Clinical Supervisor (supervisor@test.com) login succeeds (200)', supLogin.status === 200);
    const supToken = supLogin.data?.token;
    check('Supervisor has role doctor_supervisor', supLogin.data?.role === 'doctor_supervisor');

    // Patient A: Lakshmi Venkatesh
    const patALogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'lakshmi-venkatesh@test.com', password: 'password123' })
    });
    check('Patient A login succeeds (200)', patALogin.status === 200);
    const patAAbha = patALogin.data?.health_id;

    // ---------------------------------------------------------
    // Step 1: Branch A — Upfront Long-Window Routing (>2 Hours)
    // ---------------------------------------------------------
    console.log('\n[Step 1] Branch A — Upfront Long-Window Routing (>2h requested)...');
    
    // ER Clinician requests 8-hour emergency window upfront for complex surgery
    const upfrontRes = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${erToken}` },
      body: JSON.stringify({
        health_id: patAAbha,
        justification: 'Emergency polytrauma with active intracranial hemorrhage requiring urgent decompressive craniectomy and 8-hour monitoring window.',
        requested_duration_hrs: 8
      })
    });

    check('Upfront break-glass declaration succeeds (HTTP 200)', upfrontRes.status === 200);
    check('Standard 2-hour window issued immediately (default_window_hrs: 2)', upfrontRes.data?.default_window_hrs === 2);
    check('extension_request_status is pending_supervisor', upfrontRes.data?.extension_request_status === 'pending_supervisor');
    check('ticket_id generated and returned in response', typeof upfrontRes.data?.ticket_id === 'string' && upfrontRes.data.ticket_id.startsWith('TICK-UPFRONT-'));

    const upfrontTokenId = upfrontRes.data?.token_id;
    const upfrontTicketId = upfrontRes.data?.ticket_id;

    // Verify upfront ticket in MongoDB
    const upfrontTicketDoc = await systemDb.collection('supervisor_tickets').findOne({ ticket_id: upfrontTicketId });
    check('Upfront ticket exists in system_db.supervisor_tickets', !!upfrontTicketDoc);
    check('Upfront ticket status is pending_supervisor', upfrontTicketDoc?.status === 'pending_supervisor');
    check('Requested hours in ticket is 6 (8h requested - 2h granted)', upfrontTicketDoc?.requested_hours === 6);
    check('Ticket SLA timestamp exists', !!upfrontTicketDoc?.sla_expires_at);

    // ---------------------------------------------------------
    // Step 2: Branch B — Layer 1 Automated Rule Engine Auto-Approval
    // ---------------------------------------------------------
    console.log('\n[Step 2] Branch B — Layer 1 Automated Rule Engine Auto-Approval...');

    // Dr. Rajesh Iyer issues a standard 2-hour emergency token for Vikram Shetty
    const patBAbha = 'ABHA-7781-9023-4412';
    const bg2Res = await request('/consent/break-glass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        health_id: patBAbha,
        justification: 'Severe crushing chest pain and ST-elevation myocardial infarction requiring emergency primary PCI.',
        requested_duration_hrs: 2
      })
    });
    check('Standard 2-hour emergency declaration succeeds (HTTP 200)', bg2Res.status === 200);
    const standardTokenId = bg2Res.data?.token_id;
    const initialEventId = bg2Res.data?.event_id;

    // Dr. Rajesh Iyer requests routine +1 hour extension on active token (qualifies for Layer 1 auto-approval)
    const extend1Res = await request('/consent/break-glass/extend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        token_id: standardTokenId,
        additional_hours: 1,
        justification: 'Stent deployment completed; requiring 1-hour active intra-arterial monitoring in cardiac cath lab.'
      })
    });

    check('Layer 1 extension request succeeds (HTTP 200)', extend1Res.status === 200);
    check('Status is auto_approved', extend1Res.data?.status === 'auto_approved');
    check('Hours extended is 1', extend1Res.data?.hours_extended === 1);
    check('Contract C-04 linked_event_id is valid hex format', typeof extend1Res.data?.linked_event_id === 'string' && extend1Res.data.linked_event_id.startsWith('0x'));

    // Verify Contract C-04 hash chaining: keccak256 or sha256 of initialEventId
    const expectedHash = '0x' + crypto.createHash('sha256').update(initialEventId).digest('hex');
    check('Contract C-04 linked_event_id chains deterministically to preceding declaration event', extend1Res.data?.linked_event_id === expectedHash);

    // Verify token expiry in DB extended by 1 hour
    const tokenInDb = await systemDb.collection('access_tokens').findOne({ token_id: standardTokenId });
    check('Token extension_history recorded in DB', tokenInDb?.break_glass_context?.extension_history?.length === 1);
    check('Extension record marked approved_by automated_rule_engine', tokenInDb?.break_glass_context?.extension_history?.[0]?.approved_by === 'automated_rule_engine');

    // ---------------------------------------------------------
    // Step 3: Branch B — Layer 2 Supervisor Escalation on Non-Standard Extension
    // ---------------------------------------------------------
    console.log('\n[Step 3] Branch B — Layer 2 Supervisor Escalation (>2h extension)...');

    // Dr. Rajesh Iyer requests +4 hour extension (exceeds Layer 1 limit of 2h)
    const extend2Res = await request('/consent/break-glass/extend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        token_id: standardTokenId,
        additional_hours: 4,
        justification: 'Post-PCI cardiac tamponade developed requiring emergency pericardial window and prolonged hemodynamic monitoring.'
      })
    });

    check('Layer 2 escalation returns HTTP 202 Accepted', extend2Res.status === 202);
    check('Status is pending_supervisor', extend2Res.data?.status === 'pending_supervisor');
    check('ticket_id returned starts with TICK-EXT-', typeof extend2Res.data?.ticket_id === 'string' && extend2Res.data.ticket_id.startsWith('TICK-EXT-'));
    check('SLA window is 15 minutes', extend2Res.data?.sla_minutes === 15);

    const escalatedTicketId = extend2Res.data?.ticket_id;
    const escalatedDoc = await systemDb.collection('supervisor_tickets').findOne({ ticket_id: escalatedTicketId });
    check('Escalated ticket recorded in system_db.supervisor_tickets', !!escalatedDoc);
    check('Ticket type is pre_expiry_extension', escalatedDoc?.ticket_type === 'pre_expiry_extension');

    // ---------------------------------------------------------
    // Step 4: Branch C — 15-Minute Grace Period Enforcement (Decision D-07)
    // ---------------------------------------------------------
    console.log('\n[Step 4] Branch C — 15-Minute Grace Period Enforcement (Decision D-07)...');

    // Create a synthetic expired break-glass token that expired 5 minutes ago (within 15-minute grace period)
    const graceTokenId = `TOK-BG-GRACE-${Date.now().toString().slice(-4)}`;
    const graceEventId = `EVT-BG-GRACE-${Date.now().toString().slice(-4)}`;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    await systemDb.collection('access_tokens').insertOne({
      token_id: graceTokenId,
      health_id: patAAbha,
      doctor_id: 'DOC-3',
      institution_id: 'HOSP-3',
      token_type: 'break_glass',
      patient_name: 'Lakshmi Venkatesh',
      issued_at: new Date(Date.now() - 125 * 60 * 1000),
      expires_at: fiveMinutesAgo,
      status: 'active',
      scope: {
        general_access: true,
        sensitive_categories: { psychiatric: false, reproductive: false, hiv: false, substance_abuse: false }
      },
      break_glass_context: {
        event_id: graceEventId,
        justification: 'Grace period test token',
        requested_duration_hrs: 2,
        extension_request_status: 'none',
        extension_history: []
      }
    });

    // Verify GET /consent/validate reports grace period
    const valGraceRes = await request('/consent/validate', {
      headers: { 'X-Access-Token': graceTokenId }
    });
    check('Validate endpoint returns HTTP 200 during grace period', valGraceRes.status === 200);
    check('valid is false during grace period', valGraceRes.data?.valid === false);
    check('in_grace_period flag is true (Decision D-07)', valGraceRes.data?.in_grace_period === true);
    check('grace_period_remaining_sec is positive (~600s)', valGraceRes.data?.grace_period_remaining_sec > 500 && valGraceRes.data?.grace_period_remaining_sec < 700);

    // Verify POST /records/fetch returns HTTP 423 Locked (Decision D-07)
    const fetchLockedRes = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        health_id: patAAbha,
        token_id: graceTokenId
      })
    });
    check('Fresh node queries blocked with HTTP 423 Locked during grace period', fetchLockedRes.status === 423);
    check('HTTP 423 body includes in_grace_period: true', fetchLockedRes.data?.in_grace_period === true);
    check('HTTP 423 body includes grace_period_remaining_sec', typeof fetchLockedRes.data?.grace_period_remaining_sec === 'number');

    // ---------------------------------------------------------
    // Step 5: Branch C — Reinstatement Request during Grace Period
    // ---------------------------------------------------------
    console.log('\n[Step 5] Branch C — Reinstatement Request during Grace Period...');

    const reinstateRes = await request('/consent/break-glass/reinstate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        token_id: graceTokenId,
        justification: 'Patient entered sudden cardiogenic shock during observation. Immediate record retrieval required.',
        requested_hours: 2
      })
    });

    check('Reinstatement request returns HTTP 202 Accepted', reinstateRes.status === 202);
    check('Reinstatement ticket returned with TICK-REINSTATE- prefix', typeof reinstateRes.data?.ticket_id === 'string' && reinstateRes.data.ticket_id.startsWith('TICK-REINSTATE-'));
    check('Status is pending_supervisor', reinstateRes.data?.status === 'pending_supervisor');

    const reinstateTicketId = reinstateRes.data?.ticket_id;
    const reinstateDoc = await systemDb.collection('supervisor_tickets').findOne({ ticket_id: reinstateTicketId });
    check('Reinstatement ticket stored with ticket_type: grace_reinstatement', reinstateDoc?.ticket_type === 'grace_reinstatement');

    // ---------------------------------------------------------
    // Step 6: Branch C — Post-Grace Expiry (Elapsed >15m)
    // ---------------------------------------------------------
    console.log('\n[Step 6] Branch C — Post-Grace Expiry (Elapsed >15m)...');

    // Create a synthetic token expired 25 minutes ago (>15m grace window)
    const deadTokenId = `TOK-BG-DEAD-${Date.now().toString().slice(-4)}`;
    const twentyFiveMinutesAgo = new Date(Date.now() - 25 * 60 * 1000);

    await systemDb.collection('access_tokens').insertOne({
      token_id: deadTokenId,
      health_id: patAAbha,
      doctor_id: 'DOC-3',
      institution_id: 'HOSP-3',
      token_type: 'break_glass',
      patient_name: 'Lakshmi Venkatesh',
      issued_at: new Date(Date.now() - 145 * 60 * 1000),
      expires_at: twentyFiveMinutesAgo,
      status: 'active',
      scope: { general_access: true, sensitive_categories: {} }
    });

    // Validate returns 401
    const deadValRes = await request('/consent/validate', {
      headers: { 'X-Access-Token': deadTokenId }
    });
    check('Fully expired token beyond grace period returns HTTP 401', deadValRes.status === 401);

    // Reinstatement returns HTTP 410 Gone
    const deadReinstateRes = await request('/consent/break-glass/reinstate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        token_id: deadTokenId,
        justification: 'Attempting to reinstate token past grace window',
        requested_hours: 2
      })
    });
    check('Reinstatement attempt past 15-minute grace period returns HTTP 410 Gone', deadReinstateRes.status === 410);

    // ---------------------------------------------------------
    // Step 7: Supervisor Service (Queue & Review RBAC)
    // ---------------------------------------------------------
    console.log('\n[Step 7] Supervisor Service (Queue & Review)...');

    // Test RBAC: Non-supervisor doctor calling /supervisor/queue -> HTTP 403
    const forbiddenQueueRes = await request('/supervisor/queue', {
      headers: { Authorization: `Bearer ${doc3Token}` }
    });
    check('Non-supervisor clinician blocked from supervisor queue (HTTP 403)', forbiddenQueueRes.status === 403);

    // Supervisor calling /supervisor/queue -> HTTP 200 with dynamic SLA
    const supQueueRes = await request('/supervisor/queue', {
      headers: { Authorization: `Bearer ${supToken}` }
    });
    check('Supervisor accesses queue successfully (HTTP 200)', supQueueRes.status === 200);
    check('Queue contains pending tickets', supQueueRes.data?.count >= 2);
    check('Tickets contain dynamic sla_remaining_sec', typeof supQueueRes.data?.tickets?.[0]?.sla_remaining_sec === 'number');
    check('sla_breached flag is present and boolean', typeof supQueueRes.data?.tickets?.[0]?.sla_breached === 'boolean');

    // Supervisor Approves Reinstatement Ticket
    console.log('\n[Step 8] Supervisor Approval & Reinstatement Verification...');
    const approveRes = await request('/supervisor/review', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supToken}` },
      body: JSON.stringify({
        ticket_id: reinstateTicketId,
        decision: 'approved',
        supervisor_notes: 'Reviewed clinical emergency documentation. Immediate reinstatement authorized.'
      })
    });

    check('Supervisor review approval succeeds (HTTP 200)', approveRes.status === 200);
    check('Ticket status updated to approved', approveRes.data?.status === 'approved');
    check('Contract C-04 linked_event_id present in supervisor review', typeof approveRes.data?.linked_event_id === 'string' && approveRes.data.linked_event_id.startsWith('0x'));

    // Verify token is restored to active in MongoDB
    const reinstatedTokenDoc = await systemDb.collection('access_tokens').findOne({ token_id: graceTokenId });
    check('Reinstated token status is active in DB', reinstatedTokenDoc?.status === 'active');
    check('Reinstated token expires_at is in the future', new Date(reinstatedTokenDoc?.expires_at) > new Date());
    check('Reinstated timestamp recorded', !!reinstatedTokenDoc?.break_glass_context?.reinstated_at);

    // Verify chained audit event in DB
    const chainedAuditEvent = await systemDb.collection('audit_events').findOne({
      event_type: 'supervisor_break_glass_approved',
      'metadata.ticket_id': reinstateTicketId
    });
    check('Chained audit event supervisor_break_glass_approved recorded in DB', !!chainedAuditEvent);
    check('Chained audit event actor is supervisor', chainedAuditEvent?.actor?.id === 'DOC-SUP-01');

    // Verify Clinical Records Fetch with Reinstated Token (Locks Released!)
    console.log('\n[Step 9] Fetching Records with Reinstated Token...');
    const reinstatedFetchRes = await request('/records/fetch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${doc3Token}` },
      body: JSON.stringify({
        health_id: patAAbha,
        token_id: graceTokenId
      })
    });

    check('Reinstated token fetch succeeds (HTTP 200, HTTP 423 lock cleared)', reinstatedFetchRes.status === 200);
    check('Clinical records returned across nodes', reinstatedFetchRes.data?.total_records_returned > 0);
    check('Sensitive psychiatric records remain locked down under reinstated token', (reinstatedFetchRes.data?.sensitive_records_omitted?.psychiatric || 0) > 0);

    // Supervisor Denies Escalated Ticket
    console.log('\n[Step 10] Supervisor Denial Verification...');
    const denyRes = await request('/supervisor/review', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supToken}` },
      body: JSON.stringify({
        ticket_id: escalatedTicketId,
        decision: 'denied',
        supervisor_notes: 'Patient stabilized. Prolonged emergency access not indicated; please submit standard consent request.'
      })
    });

    check('Supervisor review denial succeeds (HTTP 200)', denyRes.status === 200);
    check('Ticket status updated to denied', denyRes.data?.status === 'denied');

    const deniedTicketDoc = await systemDb.collection('supervisor_tickets').findOne({ ticket_id: escalatedTicketId });
    check('Denied ticket status saved in DB', deniedTicketDoc?.status === 'denied');

    const denyAuditEvent = await systemDb.collection('audit_events').findOne({
      event_type: 'supervisor_break_glass_denied',
      'metadata.ticket_id': escalatedTicketId
    });
    check('Audit event supervisor_break_glass_denied recorded in DB', !!denyAuditEvent);

  } catch (err) {
    console.error('\nUNEXPECTED TEST EXCEPTION:', err);
    failed++;
  } finally {
    if (dbClient) {
      await dbClient.close().catch(() => {});
    }
  }

  // ---------------------------------------------------------
  // Summary Report
  // ---------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  PHASE 3 SPRINT 2 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
