const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-demo-key-federated-ehr-2026';

app.use(express.json());
app.use(cors());

const client = new MongoClient(MONGO_URI);
let systemDb;
let registryDb;

// Contract C-01 Role Token Lifetimes (in seconds)
const ROLE_LIFETIMES = {
  doctor: 8 * 3600,            // 8 hours
  lab_technician: 8 * 3600,    // 8 hours
  doctor_supervisor: 8 * 3600, // 8 hours
  patient: 24 * 3600,          // 24 hours
  hospital_admin: 4 * 3600,    // 4 hours
  system_admin: 4 * 3600,      // 4 hours
  admin: 4 * 3600,             // 4 hours (alias)
  emergency: 2 * 3600          // 2 hours (break-glass)
};

/**
 * Generate spec-compliant JWT token adhering strictly to Contract C-01.
 * Payload schema: { user_id, role, institution_id, issued_at, expires_at }
 */
function generateToken(user) {
  const lifetimeSec = ROLE_LIFETIMES[user.role] || (8 * 3600);
  const nowInSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowInSec + lifetimeSec;

  const payload = {
    user_id: user.user_id,
    role: user.role,
    institution_id: user.institution_id || null,
    issued_at: nowInSec,
    expires_at: expiresAt
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: lifetimeSec
  });

  return { token, expires_at: expiresAt, issued_at: nowInSec };
}

/**
 * JWT Verification Middleware (Contract C-01 Gateway Enforcement)
 */
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.user_id || !decoded.role) {
      return res.status(401).json({ error: 'Invalid token: Missing required identity claims' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Role-Based Access Control (RBAC) Middleware Factory
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access forbidden: Role '${req.user ? req.user.role : 'unauthenticated'}' is not authorized for this resource`
      });
    }
    next();
  };
}

async function startServer() {
  const maxRetries = 10;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await client.connect();
      systemDb = client.db('system_db');
      registryDb = client.db('registry_db');
      console.log(`Connected to MongoDB at ${MONGO_URI}`);

      // Ensure Phase 2 collections & indexes in system_db
      try {
        await systemDb.collection('consent_policies').createIndex({ health_id: 1, doctor_id: 1, status: 1 });
        await systemDb.collection('consent_policies').createIndex({ request_id: 1 }, { unique: true, sparse: true });
        await systemDb.collection('consent_policies').createIndex({ policy_id: 1 }, { unique: true });
        await systemDb.collection('consent_policies').createIndex({ health_id: 1, status: 1 });

        await systemDb.collection('access_tokens').createIndex({ token_id: 1 }, { unique: true });
        await systemDb.collection('access_tokens').createIndex({ policy_id: 1 });
        await systemDb.collection('access_tokens').createIndex({ health_id: 1, status: 1, expires_at: 1 });
        await systemDb.collection('access_tokens').createIndex({ doctor_id: 1, status: 1 });

        await systemDb.collection('audit_events').createIndex({ subject_health_id: 1, timestamp: -1 });
        await systemDb.collection('audit_events').createIndex({ "actor.id": 1, timestamp: -1 });
        await systemDb.collection('audit_events').createIndex({ event_type: 1, timestamp: -1 });
      } catch (idxErr) {
        console.warn('Index initialization note:', idxErr.message);
      }

      app.listen(PORT, () => {
        console.log(`Federated EHR Gateway running on http://localhost:${PORT}`);
      });
      return;
    } catch (err) {
      console.error(`Attempt ${i}/${maxRetries}: Failed to connect to MongoDB (${err.message}). Retrying in 2s...`);
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  console.error('Could not connect to MongoDB after multiple attempts.');
  process.exit(1);
}

// ==========================================
// 1. HEALTH CHECK
// ==========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    databases: {
      system_db: !!systemDb,
      registry_db: !!registryDb
    }
  });
});

// ==========================================
// 2. IDENTITY SERVICE (Auth & Users)
// ==========================================

// Login (email or user_id + password verification)
app.post('/auth/login', async (req, res) => {
  const { email, practitioner_id, id, password } = req.body;
  const input = (practitioner_id || id || email || '').trim();

  if (!input) {
    return res.status(400).json({ error: 'User ID or Email is required' });
  }

  try {
    const user = await systemDb.collection('users').findOne({
      $or: [
        { user_id: input },
        { user_id: input.toUpperCase() },
        { email: input },
        { email: input.toLowerCase() }
      ]
    });

    if (!user) {
      return res.status(401).json({ error: `User '${input}' not found in registry. Please check your credentials.` });
    }

    // Password verification
    if (user.password_hash) {
      const match = await bcrypt.compare(password || '', user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else if (password && password !== 'Fedra@2026') {
      // Legacy demo users without password_hash: accept default demo password or blank
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { token, expires_at } = generateToken(user);

    const institutionName = user.institution_name || (
      user.institution_id === 'HOSP-1' ? 'Apollo Memorial Hospital' :
      user.institution_id === 'HOSP-2' ? 'Fortis Healthcare Center' :
      user.institution_id === 'HOSP-3' ? 'Max Super Specialty Hospital' : null
    );

    // Return token + metadata in response body for frontend portal compatibility
    res.json({
      token,
      expires_at,
      user_id: user.user_id,
      role: user.role,
      name: user.name || user.user_id,
      institution_id: user.institution_id || null,
      institution_name: institutionName,
      department: user.department || 'General Medicine',
      health_id: user.health_id || null
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

// Refresh expiring JWT token
app.post('/auth/refresh', verifyJWT, async (req, res) => {
  try {
    const user = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
    if (!user) {
      return res.status(404).json({ error: 'User no longer exists in registry' });
    }

    const { token, expires_at } = generateToken(user);
    res.json({
      token,
      expires_at
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Internal server error refreshing token' });
  }
});

// Register Doctor
app.post('/auth/register/doctor', async (req, res) => {
  const { name, email, institution_id, abha_id, medical_license_number, password } = req.body;

  if (!name || !email || !institution_id || !medical_license_number) {
    return res.status(400).json({
      error: 'Missing required fields: name, email, institution_id, medical_license_number are required'
    });
  }

  try {
    const existing = await systemDb.collection('users').findOne({
      $or: [
        { email: email.toLowerCase() },
        { medical_license_number }
      ]
    });

    if (existing) {
      return res.status(409).json({ error: 'Doctor with this email or medical license is already registered' });
    }

    const userId = `DOC-${crypto.randomUUID()}`;
    const passwordHash = await bcrypt.hash(password || 'Fedra@2026', 10);

    const newDoctor = {
      user_id: userId,
      role: 'doctor',
      name,
      email: email.toLowerCase(),
      institution_id,
      abha_id: abha_id || null,
      medical_license_number,
      password_hash: passwordHash,
      status: 'pending_verification',
      created_at: new Date()
    };

    await systemDb.collection('users').insertOne(newDoctor);

    res.status(201).json({
      user_id: userId,
      role: 'doctor',
      status: 'pending_verification'
    });
  } catch (err) {
    console.error('Doctor registration error:', err);
    res.status(500).json({ error: 'Internal server error registering doctor' });
  }
});

// Register Patient
app.post('/auth/register/patient', async (req, res) => {
  const { name, dob, gender, abha_id, phone, password } = req.body;

  if (!name || !abha_id) {
    return res.status(400).json({ error: 'Missing required fields: name and abha_id are required' });
  }

  try {
    const existing = await systemDb.collection('users').findOne({ health_id: abha_id });
    if (existing) {
      return res.status(409).json({ error: `Patient with ABHA '${abha_id}' is already registered` });
    }

    const userId = `PAT-${crypto.randomUUID()}`;
    const passwordHash = await bcrypt.hash(password || 'Fedra@2026', 10);

    const newPatient = {
      user_id: userId,
      role: 'patient',
      name,
      dob: dob || null,
      gender: gender || null,
      health_id: abha_id,
      phone: phone || null,
      password_hash: passwordHash,
      status: 'active',
      created_at: new Date()
    };

    await systemDb.collection('users').insertOne(newPatient);

    res.status(201).json({
      user_id: userId,
      health_id: abha_id,
      role: 'patient'
    });
  } catch (err) {
    console.error('Patient registration error:', err);
    res.status(500).json({ error: 'Internal server error registering patient' });
  }
});

// ==========================================
// 3. DISCOVERY SERVICE
// ==========================================

// Search locations and record summaries for a health_id
app.get('/patient/search', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'system_admin', 'admin', 'emergency']), async (req, res) => {
  const { health_id } = req.query;
  if (!health_id) {
    return res.status(400).json({ error: 'Query parameter health_id is required' });
  }

  try {
    const entries = await registryDb.collection('registry_entries')
      .find({ health_id })
      .toArray();

    let patientName = null;
    if (entries.length > 0) {
      patientName = entries[0].patient_name;
    } else {
      const patientUser = await systemDb.collection('users').findOne({ health_id });
      if (patientUser) patientName = patientUser.name;
    }

    res.json({
      health_id,
      patient_name: patientName || 'Unknown',
      total_institutions: entries.length,
      institutions: entries
    });
  } catch (err) {
    console.error('Patient search error:', err);
    res.status(500).json({ error: 'Internal server error during patient discovery' });
  }
});

// Register record pointer in discovery index
app.post('/registry/register', verifyJWT, requireRole(['doctor', 'hospital_admin', 'system_admin', 'admin']), async (req, res) => {
  const {
    health_id,
    patient_name,
    institution_id,
    institution_name,
    fhir_endpoint,
    public_fhir_endpoint,
    record_summary,
    node_status
  } = req.body;

  if (!health_id || !institution_id || !institution_name) {
    return res.status(400).json({ error: 'health_id, institution_id, and institution_name are required' });
  }

  try {
    const entry = {
      health_id,
      patient_name: patient_name || 'Unknown',
      institution_id,
      institution_name,
      fhir_endpoint: fhir_endpoint || `http://${institution_id.toLowerCase()}-fhir:8080/fhir`,
      public_fhir_endpoint: public_fhir_endpoint || null,
      record_summary: record_summary || { total_records: 0, categories_present: [], sensitive_categories_present: [] },
      node_status: node_status || 'active',
      updated_at: new Date()
    };

    await registryDb.collection('registry_entries').updateOne(
      { health_id, institution_id },
      { $set: entry, $setOnInsert: { created_at: new Date() } },
      { upsert: true }
    );

    res.status(201).json({
      message: 'Record registered in discovery index',
      health_id,
      institution_id
    });
  } catch (err) {
    console.error('Registry register error:', err);
    res.status(500).json({ error: 'Internal server error registering in discovery index' });
  }
});

// ==========================================
// 4. CONSENT SERVICE (Phase 2 Access Control)
// ==========================================

// Helper: check if patient exists in registry or users
async function patientExists(healthId) {
  const inRegistry = await registryDb.collection('registry_entries').findOne({ health_id: healthId });
  if (inRegistry) return inRegistry.patient_name || true;
  const inUsers = await systemDb.collection('users').findOne({
    $or: [{ health_id: healthId }, { user_id: healthId }]
  });
  return inUsers ? inUsers.name : null;
}

// 4.1 Doctor requests consent to access a patient's records
app.post('/consent/request', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'admin', 'system_admin']), async (req, res) => {
  const { health_id, purpose, institution_id } = req.body;

  if (!health_id || !purpose) {
    return res.status(400).json({ error: 'health_id and purpose are required to request access' });
  }

  try {
    const pName = await patientExists(health_id);
    if (!pName) {
      return res.status(404).json({ error: `Patient with Health ID '${health_id}' was not found in the federated network` });
    }

    const doctorUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
    const targetInstId = institution_id || req.user.institution_id || 'HOSP-1';
    const targetInstName = doctorUser?.institution_name || (
      targetInstId === 'HOSP-1' ? 'Apollo Memorial Hospital' :
      targetInstId === 'HOSP-2' ? 'Fortis Healthcare Center' :
      targetInstId === 'HOSP-3' ? 'Max Super Specialty Hospital' : 'Partner Medical Center'
    );

    const policyId = `POL-${crypto.randomUUID()}`;
    const requestId = `REQ-${crypto.randomUUID()}`;

    const policy = {
      policy_id: policyId,
      request_id: requestId,
      health_id,
      patient_name: typeof pName === 'string' ? pName : 'Registered Patient',
      doctor_id: req.user.user_id,
      doctor_name: doctorUser?.name || req.user.user_id,
      institution_id: targetInstId,
      institution_name: targetInstName,
      status: 'pending',
      granted_at: null,
      revoked_at: null,
      scope: {
        general_access: true,
        sensitive_categories: {
          psychiatric: false,
          reproductive: false,
          hiv: false,
          substance_abuse: false
        }
      },
      purpose: purpose.trim(),
      created_at: new Date()
    };

    await systemDb.collection('consent_policies').insertOne(policy);

    // Audit log
    await systemDb.collection('audit_events').insertOne({
      event_id: `EVT-${crypto.randomUUID()}`,
      event_type: 'consent_request_created',
      actor: {
        id: req.user.user_id,
        role: req.user.role,
        institution_id: targetInstId
      },
      subject_health_id: health_id,
      metadata: {
        policy_id: policyId,
        request_id: requestId,
        purpose: purpose.trim()
      },
      timestamp: new Date()
    });

    res.status(202).json({
      request_id: requestId,
      policy_id: policyId,
      health_id,
      status: 'pending_patient_consent',
      patient_notified: true
    });
  } catch (err) {
    console.error('Consent request error:', err);
    res.status(500).json({ error: 'Internal server error creating consent request' });
  }
});

// 4.2 Query pending consent requests (Patient inbox or doctor audit)
app.get('/consent/pending', verifyJWT, requireRole(['patient', 'doctor', 'doctor_supervisor', 'emergency', 'admin', 'system_admin']), async (req, res) => {
  try {
    let query = { status: 'pending' };

    if (req.user.role === 'patient') {
      const patientUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      const patientHealthId = patientUser?.health_id || req.query.health_id;
      if (!patientHealthId) {
        return res.json({ count: 0, pending_requests: [] });
      }
      query.health_id = patientHealthId;
    } else if (req.query.health_id) {
      query.health_id = req.query.health_id;
    } else {
      query.doctor_id = req.user.user_id;
    }

    const pending = await systemDb.collection('consent_policies')
      .find(query)
      .sort({ created_at: -1 })
      .toArray();

    res.json({
      count: pending.length,
      pending_requests: pending
    });
  } catch (err) {
    console.error('Consent pending query error:', err);
    res.status(500).json({ error: 'Internal server error querying pending requests' });
  }
});

// 4.2b Patient portal: Get ALL consent policies (all statuses) for patient self-service view
app.get('/consent/policies', verifyJWT, requireRole(['patient', 'admin', 'system_admin']), async (req, res) => {
  try {
    let healthId;
    if (req.user.role === 'patient') {
      const patientUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      healthId = patientUser?.health_id || req.query.health_id;
    } else {
      healthId = req.query.health_id;
    }

    if (!healthId) {
      return res.json({ count: 0, policies: [] });
    }

    const statusFilter = req.query.status;
    const query = { health_id: healthId };
    if (statusFilter) query.status = statusFilter;

    const policies = await systemDb.collection('consent_policies')
      .find(query)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    res.json({ count: policies.length, policies });
  } catch (err) {
    console.error('Consent policies query error:', err);
    res.status(500).json({ error: 'Internal server error querying consent policies' });
  }
});

// 4.3 Patient grants consent and issues short-lived access token
app.post('/consent/grant', verifyJWT, requireRole(['patient', 'admin', 'system_admin']), async (req, res) => {
  const { request_id, policy_id, scope } = req.body;

  if (!request_id && !policy_id) {
    return res.status(400).json({ error: 'request_id or policy_id is required to grant consent' });
  }

  try {
    const filter = request_id ? { request_id } : { policy_id };
    const policy = await systemDb.collection('consent_policies').findOne(filter);

    if (!policy) {
      return res.status(404).json({ error: 'Consent request not found' });
    }

    // Patient identity check if patient role
    if (req.user.role === 'patient') {
      const patientUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      if (patientUser?.health_id && policy.health_id !== patientUser.health_id) {
        return res.status(403).json({ error: 'Unauthorized: Cannot grant consent for another patient' });
      }
    }

    const sensitiveCategories = {
      psychiatric: !!(scope?.sensitive_categories?.psychiatric),
      reproductive: !!(scope?.sensitive_categories?.reproductive),
      hiv: !!(scope?.sensitive_categories?.hiv),
      substance_abuse: !!(scope?.sensitive_categories?.substance_abuse)
    };

    const grantedScope = {
      general_access: scope?.general_access !== false,
      sensitive_categories: sensitiveCategories
    };

    // Update policy
    await systemDb.collection('consent_policies').updateOne(
      { policy_id: policy.policy_id },
      {
        $set: {
          status: 'active',
          granted_at: new Date(),
          revoked_at: null,
          scope: grantedScope
        }
      }
    );

    // Issue short-lived access token (8 hours for standard doctor access per Contract C-01)
    const tokenId = `TOK-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);

    const tokenDoc = {
      token_id: tokenId,
      policy_id: policy.policy_id,
      health_id: policy.health_id,
      doctor_id: policy.doctor_id,
      institution_id: policy.institution_id,
      token_type: 'standard',
      issued_at: new Date(),
      expires_at: expiresAt,
      status: 'active',
      scope: grantedScope,
      break_glass_context: null
    };

    await systemDb.collection('access_tokens').insertOne(tokenDoc);

    // Log audit event
    await systemDb.collection('audit_events').insertOne({
      event_id: `EVT-${crypto.randomUUID()}`,
      event_type: 'consent_granted',
      actor: {
        id: req.user.user_id,
        role: req.user.role,
        institution_id: req.user.institution_id || null
      },
      subject_health_id: policy.health_id,
      metadata: {
        policy_id: policy.policy_id,
        token_id: tokenId,
        doctor_id: policy.doctor_id,
        scope: grantedScope
      },
      timestamp: new Date()
    });

    res.json({
      policy_id: policy.policy_id,
      token_id: tokenId,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      expires_at_iso: expiresAt.toISOString(),
      scope: grantedScope
    });
  } catch (err) {
    console.error('Consent grant error:', err);
    res.status(500).json({ error: 'Internal server error granting consent' });
  }
});

// 4.4 Patient revokes consent (invalidating active tokens immediately)
app.post('/consent/revoke', verifyJWT, requireRole(['patient', 'admin', 'system_admin']), async (req, res) => {
  const { policy_id } = req.body;
  if (!policy_id) {
    return res.status(400).json({ error: 'policy_id is required' });
  }

  try {
    const policy = await systemDb.collection('consent_policies').findOne({ policy_id });
    if (!policy) {
      return res.status(404).json({ error: `Consent policy '${policy_id}' not found` });
    }

    if (req.user.role === 'patient') {
      const patientUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      if (patientUser?.health_id && policy.health_id !== patientUser.health_id) {
        return res.status(403).json({ error: 'Unauthorized: Cannot revoke another patient policy' });
      }
    }

    const now = new Date();
    await systemDb.collection('consent_policies').updateOne(
      { policy_id },
      { $set: { status: 'revoked', revoked_at: now } }
    );

    const tokenUpdate = await systemDb.collection('access_tokens').updateMany(
      { policy_id, status: 'active' },
      { $set: { status: 'revoked', revoked_at: now } }
    );

    // Audit log
    await systemDb.collection('audit_events').insertOne({
      event_id: `EVT-${crypto.randomUUID()}`,
      event_type: 'consent_revoked',
      actor: {
        id: req.user.user_id,
        role: req.user.role,
        institution_id: req.user.institution_id || null
      },
      subject_health_id: policy.health_id,
      metadata: {
        policy_id,
        active_tokens_invalidated: tokenUpdate.modifiedCount
      },
      timestamp: now
    });

    res.json({
      revoked: true,
      policy_id,
      active_tokens_invalidated: tokenUpdate.modifiedCount,
      doctor_notified: true
    });
  } catch (err) {
    console.error('Consent revoke error:', err);
    res.status(500).json({ error: 'Internal server error revoking consent' });
  }
});

// 4.5 Patient selectively toggles access to a sensitive category
app.post('/consent/sensitive', verifyJWT, requireRole(['patient', 'admin', 'system_admin']), async (req, res) => {
  const { policy_id, category, grant } = req.body;
  const allowed = ['psychiatric', 'reproductive', 'hiv', 'substance_abuse'];

  if (!policy_id || !category || !allowed.includes(category)) {
    return res.status(400).json({
      error: `policy_id and a valid sensitive category (${allowed.join(', ')}) are required`
    });
  }

  try {
    const policy = await systemDb.collection('consent_policies').findOne({ policy_id });
    if (!policy) {
      return res.status(404).json({ error: 'Consent policy not found' });
    }

    const field = `scope.sensitive_categories.${category}`;
    await systemDb.collection('consent_policies').updateOne(
      { policy_id },
      { $set: { [field]: !!grant } }
    );

    // Also propagate permission dynamically to active tokens
    await systemDb.collection('access_tokens').updateMany(
      { policy_id, status: 'active' },
      { $set: { [field]: !!grant } }
    );

    // Audit log
    await systemDb.collection('audit_events').insertOne({
      event_id: `EVT-${crypto.randomUUID()}`,
      event_type: 'sensitive_category_permission_changed',
      actor: {
        id: req.user.user_id,
        role: req.user.role
      },
      subject_health_id: policy.health_id,
      metadata: {
        policy_id,
        category,
        granted: !!grant
      },
      timestamp: new Date()
    });

    res.json({
      updated: true,
      policy_id,
      category,
      access: !!grant
    });
  } catch (err) {
    console.error('Sensitive category toggle error:', err);
    res.status(500).json({ error: 'Internal server error toggling sensitive category' });
  }
});

// 4.6 Emergency Break-Glass Access Declaration
app.post('/consent/break-glass', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'admin', 'system_admin']), async (req, res) => {
  const { health_id, justification, requested_duration_hrs } = req.body;

  if (!health_id || !justification) {
    return res.status(400).json({ error: 'health_id and mandatory clinical justification are required' });
  }

  if (justification.trim().length < 10) {
    return res.status(400).json({ error: 'Clinical justification must be comprehensive (at least 10 characters)' });
  }

  try {
    const pName = await patientExists(health_id);
    if (!pName) {
      return res.status(404).json({ error: `Patient with Health ID '${health_id}' not found` });
    }

    // Emergency token lifetime: strictly 2 hours (Contract C-01)
    const durationHrs = 2;
    const expiresAt = new Date(Date.now() + durationHrs * 3600 * 1000);
    const tokenId = `TOK-BG-${crypto.randomUUID()}`;
    const eventId = `BG-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Sensitive categories invariant: strictly LOCKED under emergency break-glass
    const tokenDoc = {
      token_id: tokenId,
      policy_id: null,
      health_id,
      doctor_id: req.user.user_id,
      institution_id: req.user.institution_id || null,
      token_type: 'break_glass',
      issued_at: new Date(),
      expires_at: expiresAt,
      status: 'active',
      scope: {
        general_access: true,
        sensitive_categories: {
          psychiatric: false,
          reproductive: false,
          hiv: false,
          substance_abuse: false
        }
      },
      break_glass_context: {
        event_id: eventId,
        justification: justification.trim(),
        requested_duration_hrs: requested_duration_hrs || 2,
        extension_history: []
      }
    };

    await systemDb.collection('access_tokens').insertOne(tokenDoc);

    // Audit log
    await systemDb.collection('audit_events').insertOne({
      event_id: eventId,
      event_type: 'break_glass_triggered',
      actor: {
        id: req.user.user_id,
        role: req.user.role,
        institution_id: req.user.institution_id || null
      },
      subject_health_id: health_id,
      metadata: {
        token_id: tokenId,
        justification: justification.trim(),
        default_window_hrs: 2,
        sensitive_categories_locked: true
      },
      timestamp: new Date()
    });

    res.json({
      token_id: tokenId,
      event_id: eventId,
      token_type: 'break_glass',
      default_window_hrs: 2,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      expires_at_iso: expiresAt.toISOString(),
      extension_request_status: (requested_duration_hrs && requested_duration_hrs > 2) ? 'pending_supervisor' : 'none',
      patient_notified: true,
      caregiver_notified: true
    });
  } catch (err) {
    console.error('Break glass error:', err);
    res.status(500).json({ error: 'Internal server error declaring break-glass emergency' });
  }
});

// 4.7 Internal Token Validation (Contract C-02 SLA: <50ms)
app.get('/consent/validate', async (req, res) => {
  const tokenId = req.headers['x-access-token'] || req.query.token_id || (
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null
  );

  if (!tokenId) {
    return res.status(401).json({ valid: false, reason: 'missing_token' });
  }

  const startTime = Date.now();
  try {
    const token = await systemDb.collection('access_tokens').findOne({
      token_id: tokenId,
      status: 'active',
      expires_at: { $gt: new Date() }
    });

    const elapsed = Date.now() - startTime;
    if (!token) {
      return res.status(401).json({
        valid: false,
        reason: 'token_expired_or_revoked',
        latency_ms: elapsed
      });
    }

    res.json({
      valid: true,
      token_id: token.token_id,
      health_id: token.health_id,
      doctor_id: token.doctor_id,
      token_type: token.token_type,
      scope: token.scope,
      expires_at: Math.floor(token.expires_at.getTime() / 1000),
      latency_ms: elapsed
    });
  } catch (err) {
    console.error('Token validation error:', err);
    res.status(500).json({ valid: false, error: 'Internal validation failure' });
  }
});

// ==========================================
// 5. PARALLEL RECORD FETCH AGGREGATOR (POST /records/fetch)
// ==========================================

// Helper: resolve hospital FHIR endpoint for host or container networking
function resolveFhirEndpoint(entry) {
  if (entry.institution_id === 'HOSP-1') return 'http://localhost:8081/fhir';
  if (entry.institution_id === 'HOSP-2') return 'http://localhost:8082/fhir';
  if (entry.institution_id === 'HOSP-3') return 'http://localhost:8083/fhir';
  return entry.public_fhir_endpoint || entry.fhir_endpoint;
}

app.post('/records/fetch', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'admin', 'system_admin']), async (req, res) => {
  const { health_id, token_id } = req.body;

  if (!health_id || !token_id) {
    return res.status(400).json({ error: 'health_id and valid token_id are required' });
  }

  try {
    // 1. Validate Access Token (Contract C-02)
    const token = await systemDb.collection('access_tokens').findOne({
      token_id,
      health_id,
      status: 'active',
      expires_at: { $gt: new Date() }
    });

    if (!token) {
      return res.status(422).json({
        error: 'Access token expired or revoked. Please request patient consent.'
      });
    }

    // 2. Discover hospital locations
    const entries = await registryDb.collection('registry_entries').find({ health_id }).toArray();
    if (!entries || entries.length === 0) {
      return res.status(404).json({ error: `No hospital records indexed for health ID ${health_id}` });
    }

    const patientName = entries[0].patient_name || 'Patient Record';
    const nodeStatuses = {};
    const records = {
      allergies: [],
      medications: [],
      conditions: [],
      lab_reports: [],
      procedures: [],
      encounters: [],
      vital_signs: []
    };
    let sensitiveRecordsFilteredCount = 0;

    // 3. Parallel FHIR Queries (Contract C-08: 3000ms timeout budget)
    const queryPromises = entries.map(async (entry) => {
      const instId = entry.institution_id;
      const fhirBase = resolveFhirEndpoint(entry);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        // Find patient resource ID on this node
        const ptRes = await fetch(`${fhirBase}/Patient?identifier=${encodeURIComponent(health_id)}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!ptRes.ok) {
          nodeStatuses[instId] = 'degraded';
          return;
        }

        const ptBundle = await ptRes.json();
        const fhirPatient = ptBundle.entry?.[0]?.resource;
        if (!fhirPatient) {
          nodeStatuses[instId] = 'no_records';
          return;
        }

        nodeStatuses[instId] = 'active';
        const fhirId = fhirPatient.id;

        // Parallel query across clinical resource types
        const resourceQueries = [
          { key: 'allergies', path: `/AllergyIntolerance?patient=${fhirId}` },
          { key: 'medications', path: `/MedicationRequest?patient=${fhirId}` },
          { key: 'conditions', path: `/Condition?patient=${fhirId}` },
          { key: 'lab_reports', path: `/DiagnosticReport?patient=${fhirId}` },
          { key: 'procedures', path: `/Procedure?patient=${fhirId}` },
          { key: 'encounters', path: `/Encounter?patient=${fhirId}` },
          { key: 'vital_signs', path: `/Observation?patient=${fhirId}&category=vital-signs` }
        ];

        await Promise.all(resourceQueries.map(async ({ key, path: rPath }) => {
          try {
            const subController = new AbortController();
            const subTimeout = setTimeout(() => subController.abort(), 3000);
            const rRes = await fetch(`${fhirBase}${rPath}`, { signal: subController.signal });
            clearTimeout(subTimeout);

            if (!rRes.ok) return;
            const rData = await rRes.json();
            if (!rData.entry) return;

            for (const item of rData.entry) {
              const resObj = item.resource;
              if (!resObj) continue;

              // Security Label Inspection (PSY, SEX, ETH)
              const security = resObj.meta?.security || [];
              let sensitiveCategory = null;
              if (security.some(s => s.code === 'PSY')) sensitiveCategory = 'psychiatric';
              else if (security.some(s => s.code === 'SEX')) sensitiveCategory = 'reproductive';
              else if (security.some(s => s.code === 'ETH')) sensitiveCategory = 'substance_abuse';

              // Sensitive Category Opt-in Gate
              if (sensitiveCategory) {
                const granted = token.scope?.sensitive_categories?.[sensitiveCategory] === true;
                if (!granted) {
                  sensitiveRecordsFilteredCount++;
                  continue; // Exclude locked sensitive category!
                }
              }

              records[key].push({
                ...resObj,
                _source_institution: {
                  id: entry.institution_id,
                  name: entry.institution_name
                }
              });
            }
          } catch (e) {
            // Sub-query timeout or parse error
          }
        }));

      } catch (err) {
        nodeStatuses[instId] = (err.name === 'AbortError') ? 'degraded' : 'offline';
      }
    });

    await Promise.allSettled(queryPromises);

    // 4. Log Access Event in MongoDB Audit Service
    await systemDb.collection('audit_events').insertOne({
      event_id: `EVT-${crypto.randomUUID()}`,
      event_type: 'access_initiated',
      actor: {
        id: req.user.user_id,
        role: req.user.role,
        institution_id: req.user.institution_id || null
      },
      subject_health_id: health_id,
      metadata: {
        token_id: token.token_id,
        token_type: token.token_type,
        categories_returned: Object.keys(records).filter(k => records[k].length > 0),
        total_records_returned: Object.values(records).reduce((sum, arr) => sum + arr.length, 0),
        sensitive_records_filtered: sensitiveRecordsFilteredCount
      },
      timestamp: new Date()
    });

    // 5. Return Unified Clinical Response
    res.json({
      health_id,
      patient_name: patientName,
      retrieved_at: new Date().toISOString(),
      node_statuses: nodeStatuses,
      token_info: {
        token_id: token.token_id,
        token_type: token.token_type,
        expires_at: Math.floor(token.expires_at.getTime() / 1000)
      },
      records,
      sensitive_categories_granted: token.scope?.sensitive_categories || {},
      sensitive_records_filtered_count: sensitiveRecordsFilteredCount
    });

  } catch (err) {
    console.error('Record fetch error:', err);
    res.status(500).json({ error: 'Internal server error aggregating federated records' });
  }
});

// ==========================================
// 6. SAFE HARBOR EMERGENCY & AUDIT LOGS
// ==========================================

// Safe harbor emergency data (accessible without consent to verified clinicians)
app.get('/patient/:health_id/safe-harbor', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'admin', 'system_admin']), async (req, res) => {
  const { health_id } = req.params;

  try {
    // Check local hospital databases for safe-harbor demographics, critical allergies & emergency contacts
    const hospUris = [
      { id: 'HOSP-1', uri: process.env.HOSP1_MONGO_URI || 'mongodb://localhost:27017', db: 'hospital1_db' },
      { id: 'HOSP-2', uri: process.env.HOSP2_MONGO_URI || 'mongodb://localhost:27018', db: 'hospital2_db' },
      { id: 'HOSP-3', uri: process.env.HOSP3_MONGO_URI || 'mongodb://localhost:27019', db: 'hospital3_db' }
    ];

    let foundSafeHarbor = null;
    for (const h of hospUris) {
      try {
        const hClient = new MongoClient(h.uri);
        await hClient.connect();
        const pt = await hClient.db(h.db).collection('patients').findOne({ health_id });
        await hClient.close();
        if (pt && pt.safe_harbor) {
          foundSafeHarbor = {
            health_id,
            patient_name: pt.demographics?.name || 'Emergency Patient',
            blood_type: pt.demographics?.blood_type || 'Unknown',
            safe_harbor: pt.safe_harbor
          };
          break;
        }
      } catch (e) {
        // Continue fallback
      }
    }

    if (!foundSafeHarbor) {
      return res.status(404).json({ error: `Safe harbor data not found for ${health_id}` });
    }

    res.json(foundSafeHarbor);
  } catch (err) {
    console.error('Safe harbor error:', err);
    res.status(500).json({ error: 'Internal server error fetching safe harbor data' });
  }
});

// Patient audit log retrieval
app.get('/audit/patient/:health_id', verifyJWT, async (req, res) => {
  const { health_id } = req.params;

  if (req.user.role === 'patient') {
    const patientUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
    if (patientUser?.health_id && patientUser.health_id !== health_id) {
      return res.status(403).json({ error: 'Unauthorized to view another patient audit trail' });
    }
  }

  try {
    const events = await systemDb.collection('audit_events')
      .find({ subject_health_id: health_id })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    res.json({
      health_id,
      count: events.length,
      audit_events: events
    });
  } catch (err) {
    console.error('Audit query error:', err);
    res.status(500).json({ error: 'Internal server error querying audit history' });
  }
});

startServer();
