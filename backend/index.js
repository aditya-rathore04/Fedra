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

// Serve static frontend files (Doctor Portal, Patient App)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const client = new MongoClient(MONGO_URI);
let systemDb;
let registryDb;

// Hospital persistence clients for safe harbor emergency queries
const HOSP1_MONGO_URI = process.env.HOSP1_MONGO_URI || 'mongodb://localhost:27017/hospital1_db';
const HOSP2_MONGO_URI = process.env.HOSP2_MONGO_URI || 'mongodb://localhost:27018/hospital2_db';
const HOSP3_MONGO_URI = process.env.HOSP3_MONGO_URI || 'mongodb://localhost:27019/hospital3_db';

const hospClients = {
  'HOSP-1': new MongoClient(HOSP1_MONGO_URI, { maxPoolSize: 5 }),
  'HOSP-2': new MongoClient(HOSP2_MONGO_URI, { maxPoolSize: 5 }),
  'HOSP-3': new MongoClient(HOSP3_MONGO_URI, { maxPoolSize: 5 })
};

async function findPatientSafeHarbor(healthId) {
  const hospitalConfigs = [
    { id: 'HOSP-1', client: hospClients['HOSP-1'], dbName: 'hospital1_db', name: 'Apollo Memorial Hospital' },
    { id: 'HOSP-2', client: hospClients['HOSP-2'], dbName: 'hospital2_db', name: 'Fortis Healthcare Center' },
    { id: 'HOSP-3', client: hospClients['HOSP-3'], dbName: 'hospital3_db', name: 'Max Super Specialty Hospital' }
  ];

  for (const h of hospitalConfigs) {
    try {
      const p = await h.client.db(h.dbName).collection('patients').findOne({
        $or: [
          { health_id: healthId },
          { aliases: healthId }
        ]
      });
      if (p && (p.safe_harbor || p.demographics)) {
        return { patient: p, hospital: h };
      }
    } catch (e) {
      // Continue to next node
    }
  }
  return null;
}

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
 * In-Memory Token Cache for Contract C-02 SLA (<50ms Token Validation Latency)
 */
const tokenCache = new Map();

function cacheToken(tokenDoc) {
  if (!tokenDoc || !tokenDoc.token_id) return;
  tokenCache.set(tokenDoc.token_id, {
    ...tokenDoc,
    cached_at: Date.now()
  });
}

function invalidateToken(tokenId) {
  tokenCache.delete(tokenId);
}

function invalidateTokensForPolicy(policyId) {
  for (const [tid, token] of tokenCache.entries()) {
    if (token.policy_id === policyId || token.consent_policy_id === policyId) {
      tokenCache.delete(tid);
    }
  }
}

function updateTokensSensitiveScope(policyId, category, grant) {
  for (const [tid, token] of tokenCache.entries()) {
    if (token.policy_id === policyId || token.consent_policy_id === policyId) {
      if (!token.scope) token.scope = { general_access: true, sensitive_categories: {} };
      if (!token.scope.sensitive_categories) token.scope.sensitive_categories = {};
      token.scope.sensitive_categories[category] = !!grant;
    }
  }
}

async function getValidatedToken(tokenId) {
  if (!tokenId) return null;
  const now = new Date();

  // 1. Check in-memory cache (<1ms response)
  const cached = tokenCache.get(tokenId);
  if (cached) {
    if (cached.status === 'active' && new Date(cached.expires_at) > now) {
      return cached;
    }
    tokenCache.delete(tokenId);
    return null;
  }

  // 2. Database lookup fallback
  const tokenDoc = await systemDb.collection('access_tokens').findOne({ token_id: tokenId });
  if (tokenDoc && tokenDoc.status === 'active' && new Date(tokenDoc.expires_at) > now) {
    cacheToken(tokenDoc);
    return tokenDoc;
  }
  return null;
}

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

/**
 * Resolve reachable FHIR endpoint on localhost
 */
function resolveFhirUrl(hospitalEntry) {
  if (hospitalEntry.public_fhir_endpoint) return hospitalEntry.public_fhir_endpoint;
  const url = hospitalEntry.fhir_endpoint || '';
  if (url.includes('hospital1-fhir') || hospitalEntry.institution_id === 'HOSP-1') return 'http://localhost:8081/fhir';
  if (url.includes('hospital2-fhir') || hospitalEntry.institution_id === 'HOSP-2') return 'http://localhost:8082/fhir';
  if (url.includes('hospital3-fhir') || hospitalEntry.institution_id === 'HOSP-3') return 'http://localhost:8083/fhir';
  return url;
}

/**
 * Fetch FHIR resource with Contract C-08 timeout budget (3000ms)
 */
async function fetchFhirWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: err.name === 'AbortError' ? 504 : 500, error: err.message, timedOut: err.name === 'AbortError' };
  }
}

/**
 * Detect sensitive medical categories on FHIR resources per Indian Cohort Spec
 */
function detectSensitiveCategory(resource) {
  if (!resource) return null;

  // 1. Check FHIR security labels
  if (Array.isArray(resource.meta?.security)) {
    for (const sec of resource.meta.security) {
      if (sec.code === 'PSY') return 'psychiatric';
      if (sec.code === 'SEX') return 'reproductive';
      if (sec.code === 'ETH') return 'substance_abuse';
    }
  }

  // 2. Check clinical coding & display strings
  const textToCheck = [
    resource.code?.text,
    resource.code?.coding?.[0]?.display,
    resource.type?.[0]?.text,
    resource.type?.[0]?.coding?.[0]?.display,
    resource.text?.div,
    resource.valueString,
    resource.description,
    resource.medicationCodeableConcept?.text,
    resource.medicationCodeableConcept?.coding?.[0]?.display
  ].filter(Boolean).join(' ').toLowerCase();

  if (textToCheck.includes('adjustment disorder') || textToCheck.includes('sertraline') || textToCheck.includes('cbt') || textToCheck.includes('psycho-oncology') || textToCheck.includes('psychiatry')) {
    return 'psychiatric';
  }
  if (textToCheck.includes('family planning') || textToCheck.includes('contraception') || textToCheck.includes('sexual health') || textToCheck.includes('reproductive')) {
    return 'reproductive';
  }
  if (textToCheck.includes('alcohol') || textToCheck.includes('substance') || textToCheck.includes('rehab') || textToCheck.includes('addiction') || textToCheck.includes('lft-2019') || textToCheck.includes('recovery liver function')) {
    return 'substance_abuse';
  }
  if (textToCheck.includes('hiv') || textToCheck.includes('immunodeficiency')) {
    return 'hiv';
  }

  return null;
}

async function startServer() {
  const maxRetries = 10;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await client.connect();
      systemDb = client.db('system_db');
      registryDb = client.db('registry_db');
      console.log(`Connected to MongoDB at ${MONGO_URI}`);

      // Ensure indexes for Phase 2 Consent Service and Audit
      await systemDb.collection('consent_policies').createIndex({ health_id: 1, doctor_id: 1, status: 1 });
      await systemDb.collection('consent_policies').createIndex({ health_id: 1, status: 1 });
      try {
        await systemDb.collection('consent_policies').dropIndex('request_id_1');
      } catch (e) {}
      await systemDb.collection('consent_policies').createIndex({ request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } });
      try {
        await systemDb.collection('consent_policies').dropIndex('policy_id_1');
      } catch (e) {}
      await systemDb.collection('consent_policies').createIndex({ policy_id: 1 }, { unique: true, partialFilterExpression: { policy_id: { $type: 'string' } } });

      await systemDb.collection('access_tokens').createIndex({ token_id: 1 }, { unique: true });
      await systemDb.collection('access_tokens').createIndex({ policy_id: 1 });
      await systemDb.collection('access_tokens').createIndex({ expires_at: 1 });

      await systemDb.collection('notifications').createIndex({ recipient_id: 1, created_at: -1 });

      // Audit Service Indexes
      await systemDb.collection('audit_events').createIndex({ subject_health_id: 1, timestamp: -1 });
      await systemDb.collection('audit_events').createIndex({ 'actor.id': 1, timestamp: -1 });
      await systemDb.collection('audit_events').createIndex({ event_id: 1 }, { unique: true });
      await systemDb.collection('audit_events').createIndex({ event_type: 1, timestamp: -1 });

      // Non-blocking connection to local hospital databases for safe harbor queries
      for (const [hId, hClient] of Object.entries(hospClients)) {
        hClient.connect().catch(e => console.warn(`Hospital ${hId} Mongo connect warning: ${e.message}`));
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
    },
    cached_tokens: tokenCache.size
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
    const lower = input.toLowerCase();
    const hyphenated = lower.replace(/\./g, '-');
    const dotted = lower.replace(/-/g, '.');

    // Friendly alias maps for common Indian cohort variations
    const aliasMap = {
      'ananya.sen@test.com': 'ananya-reddy@test.com',
      'ananya-sen@test.com': 'ananya-reddy@test.com',
      'ananya.reddy@test.com': 'ananya-reddy@test.com',
      'vikram.malhotra@test.com': 'vikram-shetty@test.com',
      'vikram-malhotra@test.com': 'vikram-shetty@test.com',
      'vikram.shetty@test.com': 'vikram-shetty@test.com',
      'saraswathi.raman@test.com': 'saraswathi-nair@test.com',
      'saraswathi-raman@test.com': 'saraswathi-nair@test.com',
      'saraswathi.nair@test.com': 'saraswathi-nair@test.com',
      'krishnamurthy.rao@test.com': 'krishnamurthy-rao@test.com',
      'lakshmi.venkatesh@test.com': 'lakshmi-venkatesh@test.com',
      'kavya.pillai@test.com': 'kavya.pillai@test.com',
      'anika.pillai@test.com': 'anika-pillai@test.com'
    };

    const targetEmail = aliasMap[lower] || aliasMap[hyphenated] || aliasMap[dotted] || null;

    const queryOr = [
      { user_id: input },
      { user_id: input.toUpperCase() },
      { email: input },
      { email: lower },
      { email: hyphenated },
      { email: dotted },
      { health_id: input }
    ];

    if (targetEmail) {
      queryOr.push({ email: targetEmail });
    }

    const user = await systemDb.collection('users').findOne({ $or: queryOr });

    if (!user) {
      return res.status(401).json({ error: `User '${input}' not found in registry. Please check your credentials.` });
    }

    // Password verification
    if (user.password_hash) {
      const match = await bcrypt.compare(password || '', user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else if (password && password !== 'Fedra@2026' && password !== 'password123') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { token, expires_at } = generateToken(user);

    const institutionName = user.institution_name || (
      user.institution_id === 'HOSP-1' ? 'Apollo Memorial Hospital' :
      user.institution_id === 'HOSP-2' ? 'Fortis Healthcare Center' :
      user.institution_id === 'HOSP-3' ? 'Max Super Specialty Hospital' : null
    );

    res.json({
      token,
      expires_at,
      user_id: user.user_id,
      role: user.role,
      name: user.name || user.user_id,
      institution_id: user.institution_id || null,
      institution_name: institutionName,
      department: user.department || (user.role === 'patient' ? 'Patient' : 'General Medicine'),
      health_id: user.health_id || null,
      gender: user.gender || null,
      birth_date: user.birth_date || user.dob || null
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
      birth_date: dob || null,
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

// Safe Harbor Emergency Demographics (GET /patient/safe-harbor) — Accessible without patient consent or tokens
app.get('/patient/safe-harbor', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'hospital_admin', 'system_admin', 'admin']), async (req, res) => {
  const { health_id } = req.query;
  if (!health_id) {
    return res.status(400).json({ error: 'Query parameter health_id is required' });
  }

  try {
    const found = await findPatientSafeHarbor(health_id);
    if (found) {
      const { patient, hospital } = found;
      return res.json({
        health_id: patient.health_id,
        patient_name: patient.demographics?.name || 'Unknown Patient',
        demographics: {
          dob: patient.demographics?.dob || null,
          gender: patient.demographics?.gender || null,
          blood_type: patient.demographics?.blood_type || 'Unknown'
        },
        safe_harbor: {
          critical_allergies: patient.safe_harbor?.critical_allergies || ['No known critical drug allergies (NKDA)'],
          emergency_contact: patient.safe_harbor?.emergency_contact || null
        },
        home_institution: hospital.name,
        institution_id: hospital.id,
        access_type: 'safe_harbor',
        consent_required: false,
        retrieved_at: new Date().toISOString()
      });
    }

    // Fallback check in central users / registry
    const [patUser, regEntry] = await Promise.all([
      systemDb.collection('users').findOne({ health_id }),
      registryDb.collection('registry_entries').findOne({ health_id })
    ]);

    if (patUser || regEntry) {
      return res.json({
        health_id,
        patient_name: patUser?.name || regEntry?.patient_name || 'Patient',
        demographics: {
          dob: patUser?.birth_date || null,
          gender: patUser?.gender || null,
          blood_type: 'Unknown / Not Typed'
        },
        safe_harbor: {
          critical_allergies: ['No known critical drug allergies (NKDA)'],
          emergency_contact: null
        },
        home_institution: regEntry?.institution_name || 'Registered Clinic',
        institution_id: regEntry?.institution_id || null,
        access_type: 'safe_harbor',
        consent_required: false,
        retrieved_at: new Date().toISOString()
      });
    }

    return res.status(404).json({ error: `No safe harbor data found for Health ID '${health_id}'` });
  } catch (err) {
    console.error('Safe harbor lookup error:', err);
    res.status(500).json({ error: 'Internal server error retrieving safe harbor emergency data' });
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

// List all registered patients (Helper for discovery UI)
app.get('/patients', verifyJWT, async (req, res) => {
  try {
    const patients = await registryDb.collection('registry_entries')
      .aggregate([
        {
          $group: {
            _id: "$health_id",
            patient_name: { $first: "$patient_name" },
            institutions: { $addToSet: "$institution_name" },
            total_records: { $sum: "$record_summary.total_records" },
            all_categories: { $push: "$record_summary.categories_present" }
          }
        },
        { $sort: { _id: 1 } }
      ])
      .toArray();

    res.json({ count: patients.length, patients });
  } catch (err) {
    console.error('List patients error:', err);
    res.status(500).json({ error: 'Internal server error listing patients' });
  }
});

// ==========================================
// 4. CONSENT SERVICE (Phase 2)
// ==========================================

// Doctor requests access to a patient record (POST /consent/request)
app.post('/consent/request', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'system_admin']), async (req, res) => {
  const { health_id, purpose, institution_id } = req.body;

  if (!health_id || !purpose) {
    return res.status(400).json({ error: 'Missing required fields: health_id and purpose are required' });
  }

  try {
    // 1. Verify patient exists in registry or users
    const [registryEntry, patientUser] = await Promise.all([
      registryDb.collection('registry_entries').findOne({ health_id }),
      systemDb.collection('users').findOne({ health_id })
    ]);

    if (!registryEntry && !patientUser) {
      return res.status(404).json({ error: `Patient with Health ID '${health_id}' was not found in registry` });
    }

    const patientName = patientUser?.name || registryEntry?.patient_name || 'Patient';
    const doctorUser = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
    const doctorName = doctorUser?.name || req.user.user_id;
    const instId = institution_id || req.user.institution_id || 'HOSP-1';
    const instName = doctorUser?.institution_name || (
      instId === 'HOSP-1' ? 'Apollo Memorial Hospital' :
      instId === 'HOSP-2' ? 'Fortis Healthcare Center' :
      instId === 'HOSP-3' ? 'Max Super Specialty Hospital' : 'Hospital Clinic'
    );

    const requestId = `REQ-${crypto.randomUUID()}`;

    // 2. Insert pending policy
    const pendingPolicy = {
      request_id: requestId,
      health_id,
      patient_name: patientName,
      doctor_id: req.user.user_id,
      doctor_name: doctorName,
      institution_id: instId,
      institution_name: instName,
      status: 'pending',
      created_at: new Date(),
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
      purpose: purpose.trim()
    };

    await systemDb.collection('consent_policies').insertOne(pendingPolicy);

    // 3. Dispatch internal notification for patient
    const notification = {
      notification_id: `NOTIF-${crypto.randomUUID()}`,
      recipient_id: patientUser?.user_id || health_id,
      recipient_health_id: health_id,
      recipient_role: 'patient',
      notification_type: 'consent_request_received',
      payload: {
        request_id: requestId,
        doctor_id: req.user.user_id,
        doctor_name: doctorName,
        institution_name: instName,
        purpose: purpose.trim()
      },
      created_at: new Date(),
      read: false
    };
    await systemDb.collection('notifications').insertOne(notification);

    res.status(202).json({
      request_id: requestId,
      status: 'pending_patient_consent',
      patient_notified: true
    });
  } catch (err) {
    console.error('Consent request error:', err);
    res.status(500).json({ error: 'Internal server error processing consent request' });
  }
});

// Patient inbox of pending requests (GET /consent/pending)
app.get('/consent/pending', verifyJWT, requireRole(['patient', 'system_admin', 'admin']), async (req, res) => {
  try {
    let healthId = req.query.health_id || req.user.health_id;
    if (!healthId) {
      const patient = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      healthId = patient?.health_id;
    }

    if (!healthId) {
      return res.status(400).json({ error: 'No associated ABHA Health ID found for authenticated patient' });
    }

    const requests = await systemDb.collection('consent_policies')
      .find({ health_id: healthId, status: 'pending' })
      .sort({ created_at: -1 })
      .toArray();

    res.json({
      health_id: healthId,
      total_pending: requests.length,
      requests
    });
  } catch (err) {
    console.error('Pending consent fetch error:', err);
    res.status(500).json({ error: 'Internal server error retrieving pending consent requests' });
  }
});

// Active consent policies (GET /consent/active)
app.get('/consent/active', verifyJWT, async (req, res) => {
  try {
    const filter = { status: 'active' };
    if (req.user.role === 'patient') {
      let healthId = req.user.health_id;
      if (!healthId) {
        const patient = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
        healthId = patient?.health_id;
      }
      filter.health_id = healthId;
    } else if (req.user.role === 'doctor' || req.user.role === 'doctor_supervisor') {
      filter.doctor_id = req.user.user_id;
    }

    const policies = await systemDb.collection('consent_policies')
      .find(filter)
      .sort({ granted_at: -1 })
      .toArray();

    // Attach active token IDs if available
    const policyIds = policies.map(p => p.policy_id).filter(Boolean);
    const activeTokens = await systemDb.collection('access_tokens')
      .find({ policy_id: { $in: policyIds }, status: 'active', expires_at: { $gt: new Date() } })
      .toArray();

    const tokenMap = Object.fromEntries(activeTokens.map(t => [t.policy_id, t]));

    const enriched = policies.map(p => ({
      ...p,
      active_token: tokenMap[p.policy_id] ? {
        token_id: tokenMap[p.policy_id].token_id,
        expires_at: tokenMap[p.policy_id].expires_at,
        token_type: tokenMap[p.policy_id].token_type
      } : null
    }));

    res.json({ count: enriched.length, policies: enriched });
  } catch (err) {
    console.error('Active consent fetch error:', err);
    res.status(500).json({ error: 'Internal server error retrieving active consents' });
  }
});

// Patient grants consent (POST /consent/grant)
app.post('/consent/grant', verifyJWT, requireRole(['patient', 'system_admin']), async (req, res) => {
  const { request_id, scope } = req.body;

  if (!request_id) {
    return res.status(400).json({ error: 'request_id is required' });
  }

  try {
    const policy = await systemDb.collection('consent_policies').findOne({ request_id });
    if (!policy) {
      return res.status(404).json({ error: `Consent request '${request_id}' not found` });
    }

    if (policy.status !== 'pending') {
      return res.status(409).json({ error: `Consent request is already in status '${policy.status}'` });
    }

    const policyId = `POL-${crypto.randomUUID()}`;
    const tokenId = `TOK-${crypto.randomUUID()}`;
    const grantedAt = new Date();
    // 8-hour token validity per Contract C-01
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);

    const finalScope = {
      general_access: scope?.general_access !== false,
      sensitive_categories: {
        psychiatric: !!scope?.sensitive_categories?.psychiatric,
        reproductive: !!scope?.sensitive_categories?.reproductive,
        hiv: !!scope?.sensitive_categories?.hiv,
        substance_abuse: !!scope?.sensitive_categories?.substance_abuse
      }
    };

    // 1. Update policy
    await systemDb.collection('consent_policies').updateOne(
      { request_id },
      {
        $set: {
          policy_id: policyId,
          status: 'active',
          granted_at: grantedAt,
          scope: finalScope
        }
      }
    );

    // 2. Insert access token
    const tokenDoc = {
      token_id: tokenId,
      policy_id: policyId,
      consent_policy_id: policyId,
      health_id: policy.health_id,
      patient_name: policy.patient_name,
      doctor_id: policy.doctor_id,
      institution_id: policy.institution_id,
      token_type: 'standard',
      issued_at: grantedAt,
      expires_at: expiresAt,
      status: 'active',
      scope: finalScope
    };

    await systemDb.collection('access_tokens').insertOne(tokenDoc);

    // 3. Cache token for sub-50ms C-02 latency
    cacheToken(tokenDoc);

    // 4. Notify doctor of consent grant
    await systemDb.collection('notifications').insertOne({
      notification_id: `NOTIF-${crypto.randomUUID()}`,
      recipient_id: policy.doctor_id,
      recipient_role: 'doctor',
      notification_type: 'consent_granted',
      payload: {
        policy_id: policyId,
        token_id: tokenId,
        health_id: policy.health_id,
        patient_name: policy.patient_name,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        scope: finalScope
      },
      created_at: new Date(),
      read: false
    });

    res.status(200).json({
      policy_id: policyId,
      token_id: tokenId,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      scope: finalScope
    });
  } catch (err) {
    console.error('Consent grant error:', err);
    res.status(500).json({ error: 'Internal server error granting consent' });
  }
});

// Patient denies consent (POST /consent/deny)
app.post('/consent/deny', verifyJWT, requireRole(['patient', 'system_admin']), async (req, res) => {
  const { request_id } = req.body;
  if (!request_id) {
    return res.status(400).json({ error: 'request_id is required' });
  }

  try {
    const result = await systemDb.collection('consent_policies').updateOne(
      { request_id, status: 'pending' },
      { $set: { status: 'denied', denied_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: `Pending request '${request_id}' not found` });
    }

    res.json({ denied: true, request_id });
  } catch (err) {
    console.error('Consent deny error:', err);
    res.status(500).json({ error: 'Internal server error denying consent' });
  }
});

// Patient or Doctor revokes consent (POST /consent/revoke)
app.post('/consent/revoke', verifyJWT, requireRole(['patient', 'doctor', 'doctor_supervisor', 'system_admin']), async (req, res) => {
  const { policy_id } = req.body;
  if (!policy_id) {
    return res.status(400).json({ error: 'policy_id is required' });
  }

  try {
    const revokedAt = new Date();

    // 1. Mark policy revoked
    const policyResult = await systemDb.collection('consent_policies').findOneAndUpdate(
      { policy_id },
      { $set: { status: 'revoked', revoked_at: revokedAt } },
      { returnDocument: 'after' }
    );

    if (!policyResult) {
      return res.status(404).json({ error: `Policy '${policy_id}' not found` });
    }

    // 2. Invalidate active tokens
    const tokenResult = await systemDb.collection('access_tokens').updateMany(
      { policy_id, status: 'active' },
      { $set: { status: 'revoked', revoked_at: revokedAt } }
    );

    // 3. Clear from in-memory cache
    invalidateTokensForPolicy(policy_id);

    // 4. Notify doctor
    if (policyResult.doctor_id) {
      await systemDb.collection('notifications').insertOne({
        notification_id: `NOTIF-${crypto.randomUUID()}`,
        recipient_id: policyResult.doctor_id,
        recipient_role: 'doctor',
        notification_type: 'consent_revoked',
        payload: {
          policy_id,
          health_id: policyResult.health_id,
          patient_name: policyResult.patient_name
        },
        created_at: new Date(),
        read: false
      });
    }

    res.json({
      revoked: true,
      active_tokens_invalidated: tokenResult.modifiedCount,
      doctor_notified: true
    });
  } catch (err) {
    console.error('Consent revocation error:', err);
    res.status(500).json({ error: 'Internal server error revoking consent' });
  }
});

// Patient updates sensitive category scope (POST /consent/sensitive)
app.post('/consent/sensitive', verifyJWT, requireRole(['patient', 'system_admin']), async (req, res) => {
  const { policy_id, category, grant } = req.body;

  const validCategories = ['psychiatric', 'reproductive', 'hiv', 'substance_abuse'];
  if (!policy_id || !category || !validCategories.includes(category)) {
    return res.status(400).json({
      error: `Invalid parameters. category must be one of: ${validCategories.join(', ')}`
    });
  }

  try {
    const isGranted = Boolean(grant);

    // 1. Update policy
    const updateField = `scope.sensitive_categories.${category}`;
    const policyResult = await systemDb.collection('consent_policies').findOneAndUpdate(
      { policy_id },
      { $set: { [updateField]: isGranted, updated_at: new Date() } },
      { returnDocument: 'after' }
    );

    if (!policyResult) {
      return res.status(404).json({ error: `Policy '${policy_id}' not found` });
    }

    // 2. Update active tokens
    await systemDb.collection('access_tokens').updateMany(
      { policy_id, status: 'active' },
      { $set: { [updateField]: isGranted } }
    );

    // 3. Update in-memory cache
    updateTokensSensitiveScope(policy_id, category, isGranted);

    res.json({
      updated: true,
      category,
      access: isGranted
    });
  } catch (err) {
    console.error('Sensitive category toggle error:', err);
    res.status(500).json({ error: 'Internal server error updating sensitive category' });
  }
});

// Emergency staff triggers break-glass access (POST /consent/break-glass)
app.post('/consent/break-glass', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'system_admin']), async (req, res) => {
  const { health_id, justification, requested_duration_hrs } = req.body;

  if (!health_id) {
    return res.status(400).json({ error: 'Missing required field: health_id is mandatory for emergency access' });
  }

  if (!justification || typeof justification !== 'string' || justification.trim().length < 10) {
    return res.status(400).json({
      error: 'Valid clinical justification is mandatory for emergency break-glass access (minimum 10 characters).'
    });
  }

  try {
    // 1. Rate limiting friction: max 3 requests / hour per doctor (docs/05 §Rate Limiting)
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const recentBgCount = await systemDb.collection('audit_events').countDocuments({
      'actor.id': req.user.user_id,
      event_type: 'break_glass_triggered',
      timestamp: { $gte: oneHourAgo }
    });

    if (recentBgCount >= 3) {
      await systemDb.collection('audit_events').insertOne({
        event_id: `EVT-RL-${crypto.randomUUID()}`,
        event_type: 'rate_limit_exceeded',
        actor: { id: req.user.user_id, role: req.user.role, institution_id: req.user.institution_id },
        subject_health_id: health_id,
        timestamp: new Date(),
        metadata: { endpoint: '/consent/break-glass', limit: 3, window_hrs: 1, attempt_count: recentBgCount + 1 }
      });
      return res.status(429).json({
        error: 'Rate limit exceeded: Maximum 3 break-glass emergency declarations per hour per clinician',
        code: 429
      });
    }

    // 2. Discover patient & safe harbor details
    const [regEntry, patUser, safeHarborResult] = await Promise.all([
      registryDb.collection('registry_entries').findOne({ health_id }),
      systemDb.collection('users').findOne({ health_id }),
      findPatientSafeHarbor(health_id)
    ]);

    const patientName = safeHarborResult?.patient?.demographics?.name 
      || regEntry?.patient_name 
      || patUser?.name 
      || 'Emergency Patient';

    const emergencyContact = safeHarborResult?.patient?.safe_harbor?.emergency_contact || null;

    // 3. Issue 2-Hour Emergency Access Token (<50ms SLA)
    const defaultWindowHrs = 2;
    const requestedDuration = Number(requested_duration_hrs) || defaultWindowHrs;
    const expiresAt = new Date(Date.now() + defaultWindowHrs * 3600 * 1000);
    const tokenId = `TOK-BG-${Date.now().toString().slice(-6)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const eventId = `EVT-BG-${Date.now().toString().slice(-6)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const tokenDoc = {
      token_id: tokenId,
      health_id,
      doctor_id: req.user.user_id,
      institution_id: req.user.institution_id || 'HOSP-EMERGENCY',
      token_type: 'break_glass',
      patient_name: patientName,
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
        requested_duration_hrs: requestedDuration,
        extension_request_status: requestedDuration > 2 ? 'pending_supervisor' : 'none',
        extension_history: [],
        grace_period_started_at: null,
        reinstated_at: null
      }
    };

    await systemDb.collection('access_tokens').insertOne(tokenDoc);
    cacheToken(tokenDoc);

    // 4. Real-Time Patient & Caregiver Notification Dispatch
    const notifications = [
      {
        notification_id: `NOTIF-${crypto.randomUUID()}`,
        recipient_id: health_id,
        recipient_role: 'patient',
        notification_type: 'break_glass_triggered',
        payload: {
          doctor_id: req.user.user_id,
          doctor_name: req.user.name || req.user.user_id,
          institution_id: req.user.institution_id,
          event_id: eventId,
          justification: justification.trim(),
          window_hrs: defaultWindowHrs,
          categories_accessed: ['allergy', 'medication', 'condition', 'encounter', 'procedure', 'lab_result']
        },
        status: 'delivered',
        created_at: new Date()
      }
    ];

    if (emergencyContact) {
      notifications.push({
        notification_id: `NOTIF-CG-${crypto.randomUUID()}`,
        recipient_id: emergencyContact.phone || emergencyContact.name,
        recipient_role: 'caregiver',
        recipient_name: emergencyContact.name,
        recipient_phone: emergencyContact.phone,
        recipient_relation: emergencyContact.relation,
        notification_type: 'break_glass_caregiver_alert',
        payload: {
          patient_health_id: health_id,
          patient_name: patientName,
          doctor_id: req.user.user_id,
          doctor_name: req.user.name || req.user.user_id,
          institution_id: req.user.institution_id,
          event_id: eventId,
          justification: justification.trim(),
          window_hrs: defaultWindowHrs
        },
        channels: ['sms', 'push'],
        status: 'delivered',
        created_at: new Date()
      });
    }

    await systemDb.collection('notifications').insertMany(notifications);

    // 5. Immutable Audit Event (Contract C-04 hash chaining genesis)
    const auditEvent = {
      event_id: eventId,
      event_type: 'break_glass_triggered',
      timestamp: new Date(),
      actor: {
        id: req.user.user_id,
        role: req.user.role,
        institution_id: req.user.institution_id || 'HOSP-EMERGENCY'
      },
      subject_health_id: health_id,
      linked_event_id: '0x0000000000000000000000000000000000000000000000000000000000000000',
      metadata: {
        justification: justification.trim(),
        token_id: tokenId,
        default_window_hrs: defaultWindowHrs,
        requested_duration_hrs: requestedDuration,
        caregiver_alerted: !!emergencyContact
      },
      blockchain_tx_hash: null,
      ml_features: {
        hour_of_day: new Date().getHours(),
        day_of_week: new Date().getDay(),
        is_outside_shift_hours: (new Date().getHours() < 7 || new Date().getHours() >= 21),
        is_weekend: (new Date().getDay() === 0 || new Date().getDay() === 6),
        has_declared_clinical_rel: false,
        is_break_glass: true,
        sensitive_category_accessed: false,
        categories_accessed_count: 5,
        records_accessed_last_hour: recentBgCount,
        records_accessed_last_day: recentBgCount + 1,
        unique_patients_last_hour: 1,
        deviation_from_baseline: 0.0
      }
    };

    await systemDb.collection('audit_events').insertOne(auditEvent);

    // 6. Return standard spec response (docs/05)
    res.status(200).json({
      token_id: tokenId,
      event_id: eventId,
      token_type: 'break_glass',
      default_window_hrs: defaultWindowHrs,
      expires_at: expiresAt.toISOString(),
      extension_request_status: requestedDuration > 2 ? 'pending_supervisor' : 'none',
      patient_notified: true,
      caregiver_notified: !!emergencyContact,
      caregiver_details: emergencyContact ? {
        name: emergencyContact.name,
        phone: emergencyContact.phone,
        relation: emergencyContact.relation
      } : null
    });

  } catch (err) {
    console.error('Break-glass declaration error:', err);
    res.status(500).json({ error: 'Internal server error processing break-glass declaration' });
  }
});

// Validate access token (GET /consent/validate)
app.get('/consent/validate', async (req, res) => {
  const start = performance.now();
  const tokenId = req.headers['x-access-token'] || req.query.token_id;

  if (!tokenId) {
    return res.status(400).json({ valid: false, reason: 'missing_token_id' });
  }

  try {
    const token = await getValidatedToken(tokenId);
    const durationMs = (performance.now() - start).toFixed(2);

    if (!token) {
      return res.status(401).json({
        valid: false,
        reason: 'token_expired_or_revoked',
        latency_ms: Number(durationMs)
      });
    }

    res.json({
      valid: true,
      health_id: token.health_id,
      doctor_id: token.doctor_id,
      institution_id: token.institution_id,
      scope: token.scope,
      expires_at: Math.floor(new Date(token.expires_at).getTime() / 1000),
      token_type: token.token_type,
      latency_ms: Number(durationMs)
    });
  } catch (err) {
    console.error('Token validation error:', err);
    res.status(500).json({ valid: false, error: 'Token validation error' });
  }
});

// ==========================================
// 5. NOTIFICATION SERVICE
// ==========================================

// Internal / external notification dispatch (POST /notify)
app.post('/notify', async (req, res) => {
  const { recipient_id, recipient_role, notification_type, payload, channel } = req.body;

  if (!recipient_id || !notification_type) {
    return res.status(400).json({ error: 'recipient_id and notification_type are required' });
  }

  try {
    const doc = {
      notification_id: `NOTIF-${crypto.randomUUID()}`,
      recipient_id,
      recipient_role: recipient_role || 'patient',
      notification_type,
      payload: payload || {},
      channel: channel || ['in_app'],
      created_at: new Date(),
      read: false
    };

    await systemDb.collection('notifications').insertOne(doc);

    res.status(202).json({
      dispatched: true,
      notification_id: doc.notification_id,
      channels: doc.channel
    });
  } catch (err) {
    console.error('Notification error:', err);
    res.status(500).json({ error: 'Internal server error dispatching notification' });
  }
});

// Get user notifications (GET /notifications)
app.get('/notifications', verifyJWT, async (req, res) => {
  try {
    const user = req.user;
    const recipientIds = [user.user_id];
    if (user.health_id) recipientIds.push(user.health_id);

    // If patient, lookup health_id
    if (user.role === 'patient' && !user.health_id) {
      const patient = await systemDb.collection('users').findOne({ user_id: user.user_id });
      if (patient?.health_id) recipientIds.push(patient.health_id);
    }

    const notifications = await systemDb.collection('notifications')
      .find({ recipient_id: { $in: recipientIds } })
      .sort({ created_at: -1 })
      .limit(30)
      .toArray();

    res.json({
      count: notifications.length,
      notifications
    });
  } catch (err) {
    console.error('Notification query error:', err);
    res.status(500).json({ error: 'Internal server error retrieving notifications' });
  }
});

// ==========================================
// 6. FEDERATED CLINICAL RECORD AGGREGATOR
// ==========================================

// Doctor fetches federated records across Apollo, Fortis, Max (POST /records/fetch)
app.post('/records/fetch', verifyJWT, requireRole(['doctor', 'doctor_supervisor', 'emergency', 'system_admin']), async (req, res) => {
  const { health_id, token_id } = req.body;

  if (!health_id || !token_id) {
    return res.status(400).json({ error: 'health_id and token_id are required' });
  }

  try {
    // 1. Validate Access Token (<50ms SLA)
    const token = await getValidatedToken(token_id);
    if (!token) {
      return res.status(422).json({ error: 'Access token is expired or revoked. Please re-request consent from patient.' });
    }

    if (token.health_id !== health_id) {
      return res.status(403).json({ error: 'Access token does not match the requested patient Health ID' });
    }

    const tokenScope = token.scope || {
      general_access: true,
      sensitive_categories: {}
    };

    // 2. Discover hospital locations
    const institutions = await registryDb.collection('registry_entries').find({ health_id }).toArray();
    if (institutions.length === 0) {
      return res.status(404).json({ error: `No hospital records found in registry for ${health_id}` });
    }

    const patientName = token.patient_name || institutions[0].patient_name;
    const nodeStatuses = {};
    const categorizedRecords = {
      allergies: [],
      medications: [],
      conditions: [],
      lab_reports: [],
      encounters_procedures: []
    };
    const sensitiveOmittedCounts = {
      psychiatric: 0,
      reproductive: 0,
      hiv: 0,
      substance_abuse: 0
    };

    // 3. Parallel FHIR queries with Contract C-08 timeout budget (3000ms per node)
    const queryNode = async (inst) => {
      const fhirBase = resolveFhirUrl(inst);
      const instId = inst.institution_id;
      const instName = inst.institution_name;

      try {
        // Find patient FHIR ID
        const patRes = await fetchFhirWithTimeout(`${fhirBase}/Patient?identifier=${encodeURIComponent(health_id)}`, 3000);
        if (!patRes.ok || !patRes.data?.entry || patRes.data.entry.length === 0) {
          nodeStatuses[instId] = patRes.timedOut ? 'timeout' : 'empty';
          return;
        }

        const fhirPatientId = patRes.data.entry[0].resource.id;
        nodeStatuses[instId] = 'active';

        // Query all clinical resource types concurrently
        const [conds, meds, allergies, labs, observations, procs, encounters] = await Promise.all([
          fetchFhirWithTimeout(`${fhirBase}/Condition?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/MedicationRequest?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/AllergyIntolerance?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/DiagnosticReport?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/Observation?subject=Patient/${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/Procedure?subject=Patient/${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/Encounter?subject=Patient/${fhirPatientId}`, 3000)
        ]);

        const extractResources = (bundleRes) => {
          if (!bundleRes?.ok || !bundleRes.data?.entry) return [];
          return bundleRes.data.entry.map(e => e.resource).filter(Boolean);
        };

        const processRecord = (resource, category) => {
          const sensitiveCat = detectSensitiveCategory(resource);
          if (sensitiveCat) {
            const isGranted = (token.token_type !== 'break_glass') && Boolean(tokenScope.sensitive_categories?.[sensitiveCat]);
            if (!isGranted) {
              sensitiveOmittedCounts[sensitiveCat] = (sensitiveOmittedCounts[sensitiveCat] || 0) + 1;
              return null; // Strip sensitive record
            }
          }

          // Attending doctor / performer extraction
          const doctorName = resource.performer?.[0]?.display 
            || resource.performer?.[0]?.actor?.display
            || resource.recorder?.display 
            || resource.requester?.display 
            || resource.asserter?.display 
            || resource.participant?.[0]?.individual?.display 
            || resource.author?.[0]?.display
            || null;

          // Clinical finding, conclusion, or quantitative value
          let finding = resource.conclusion 
            || resource.valueString 
            || (resource.valueQuantity ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit || ''}`.trim() : null)
            || resource.description
            || (resource.note?.[0]?.text)
            || (resource.dosageInstruction?.[0]?.text)
            || null;

          // Standard clinical coding system & code
          const primaryCoding = (resource.code || resource.type?.[0] || resource.medicationCodeableConcept || resource.vaccineCode)?.coding?.[0] || null;
          let codeSystem = null;
          let codeValue = null;
          let codeDisplay = null;
          if (primaryCoding) {
            codeValue = primaryCoding.code || null;
            codeDisplay = primaryCoding.display || null;
            if (primaryCoding.system) {
              if (primaryCoding.system.includes('loinc')) codeSystem = 'LOINC';
              else if (primaryCoding.system.includes('snomed')) codeSystem = 'SNOMED-CT';
              else if (primaryCoding.system.includes('rxnorm')) codeSystem = 'RxNorm';
              else if (primaryCoding.system.includes('cvx')) codeSystem = 'CVX';
              else codeSystem = primaryCoding.system.split('/').pop().toUpperCase();
            }
          }

          // Format clean record object
          const item = {
            id: resource.id,
            resource_type: resource.resourceType,
            institution_id: instId,
            institution_name: instName,
            recorded_date: resource.recordedDate || resource.effectiveDateTime || resource.authoredOn || resource.performedDateTime || resource.period?.start || null,
            clinical_text: resource.code?.text || resource.code?.coding?.[0]?.display || resource.type?.[0]?.text || resource.type?.[0]?.coding?.[0]?.display || resource.description || resource.medicationCodeableConcept?.text || resource.medicationCodeableConcept?.coding?.[0]?.display || resource.valueString || 'Clinical entry',
            status: resource.clinicalStatus?.coding?.[0]?.code || resource.status || 'final',
            doctor_name: doctorName,
            finding: finding,
            code_system: codeSystem,
            code_value: codeValue,
            code_display: codeDisplay,
            is_sensitive: !!sensitiveCat,
            sensitive_category: sensitiveCat,
            raw_fhir_summary: {
              resourceType: resource.resourceType,
              id: resource.id,
              code: resource.code || resource.medicationCodeableConcept
            },
            raw_resource: resource
          };

          categorizedRecords[category].push(item);
          return item;
        };

        // Group into clinical categories
        extractResources(allergies).forEach(r => processRecord(r, 'allergies'));
        extractResources(meds).forEach(r => processRecord(r, 'medications'));
        extractResources(conds).forEach(r => processRecord(r, 'conditions'));

        // Process DiagnosticReports first
        const labResources = extractResources(labs);
        const obsResources = extractResources(observations);
        labResources.forEach(r => processRecord(r, 'lab_reports'));

        // Process Observations (deduplicate companion observations to avoid showing identical test rows)
        obsResources.forEach(obs => {
          const parentReport = categorizedRecords['lab_reports'].find(lr => 
            lr.resource_type === 'DiagnosticReport' && 
            (obs.id === `${lr.id}-observation` || (lr.recorded_date === (obs.effectiveDateTime || obs.issued) && lr.clinical_text === (obs.code?.text || obs.code?.coding?.[0]?.display)))
          );
          if (parentReport) {
            if (!parentReport.finding) {
              parentReport.finding = obs.valueString || (obs.valueQuantity ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ''}`.trim() : null);
            }
            if (!parentReport.companion_observation) {
              parentReport.companion_observation = obs;
            }
          } else {
            processRecord(obs, 'lab_reports');
          }
        });

        extractResources(procs).forEach(r => processRecord(r, 'encounters_procedures'));
        extractResources(encounters).forEach(r => processRecord(r, 'encounters_procedures'));

      } catch (nodeErr) {
        console.error(`Error querying node ${instId}:`, nodeErr);
        nodeStatuses[instId] = 'degraded';
      }
    };

    // Execute queries across all discovered hospitals simultaneously
    await Promise.allSettled(institutions.map(inst => queryNode(inst)));

    // Sort records newest first
    for (const cat of Object.keys(categorizedRecords)) {
      categorizedRecords[cat].sort((a, b) => new Date(b.recorded_date || 0) - new Date(a.recorded_date || 0));
    }

    const totalRecords = Object.values(categorizedRecords).reduce((sum, list) => sum + list.length, 0);
    const totalOmitted = Object.values(sensitiveOmittedCounts).reduce((sum, cnt) => sum + cnt, 0);

    // Contract C-03: Log access event into audit trail
    try {
      const accessEvent = {
        event_id: `EVT-ACC-${crypto.randomUUID()}`,
        event_type: 'record_access',
        timestamp: new Date(),
        actor: {
          id: req.user.user_id,
          role: req.user.role,
          institution_id: req.user.institution_id || 'HOSP-UNKNOWN'
        },
        patient: { health_id },
        subject_health_id: health_id,
        metadata: {
          token_id,
          token_type: token.token_type || 'standard',
          total_records_returned: totalRecords,
          total_sensitive_omitted: totalOmitted,
          nodes_queried: Object.keys(nodeStatuses)
        },
        ml_features: {
          hour_of_day: new Date().getHours(),
          is_outside_shift_hours: (new Date().getHours() < 7 || new Date().getHours() >= 21),
          is_weekend: (new Date().getDay() === 0 || new Date().getDay() === 6),
          is_break_glass: token.token_type === 'break_glass',
          sensitive_category_accessed: Object.values(tokenScope.sensitive_categories || {}).some(Boolean),
          categories_accessed_count: Object.keys(categorizedRecords).filter(k => categorizedRecords[k].length > 0).length,
          records_accessed_last_hour: totalRecords,
          records_accessed_last_day: totalRecords,
          unique_patients_last_hour: 1,
          deviation_from_baseline: 0.0
        }
      };
      await systemDb.collection('audit_events').insertOne(accessEvent);
    } catch (auditErr) {
      console.error('Non-blocking audit log error in records fetch:', auditErr);
    }

    res.json({
      health_id,
      patient_name: patientName,
      retrieved_at: new Date().toISOString(),
      token_id,
      node_statuses: nodeStatuses,
      records: categorizedRecords,
      total_records_returned: totalRecords,
      total_sensitive_records_omitted: totalOmitted,
      sensitive_records_omitted: sensitiveOmittedCounts,
      scope_granted: tokenScope
    });

  } catch (err) {
    console.error('Records fetch aggregation error:', err);
    res.status(500).json({ error: 'Internal server error aggregating federated records' });
  }
});

// Patient fetches their own complete cross-hospital timeline (GET /records/patient)
app.get('/records/patient', verifyJWT, requireRole(['patient']), async (req, res) => {
  try {
    let healthId = req.user.health_id;
    if (!healthId) {
      const patient = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      healthId = patient?.health_id;
    }

    if (!healthId) {
      return res.status(400).json({ error: 'No associated ABHA Health ID found for authenticated patient' });
    }

    const institutions = await registryDb.collection('registry_entries').find({ health_id: healthId }).toArray();
    const categorizedRecords = {
      allergies: [],
      medications: [],
      conditions: [],
      lab_reports: [],
      encounters_procedures: []
    };

    const queryNode = async (inst) => {
      const fhirBase = resolveFhirUrl(inst);
      const instId = inst.institution_id;
      const instName = inst.institution_name;

      try {
        const patRes = await fetchFhirWithTimeout(`${fhirBase}/Patient?identifier=${encodeURIComponent(healthId)}`, 3000);
        if (!patRes.ok || !patRes.data?.entry || patRes.data.entry.length === 0) return;
        const fhirPatientId = patRes.data.entry[0].resource.id;

        const [conds, meds, allergies, labs, observations, procs, encounters] = await Promise.all([
          fetchFhirWithTimeout(`${fhirBase}/Condition?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/MedicationRequest?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/AllergyIntolerance?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/DiagnosticReport?patient=${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/Observation?subject=Patient/${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/Procedure?subject=Patient/${fhirPatientId}`, 3000),
          fetchFhirWithTimeout(`${fhirBase}/Encounter?subject=Patient/${fhirPatientId}`, 3000)
        ]);

        const extractResources = (bundleRes) => {
          if (!bundleRes?.ok || !bundleRes.data?.entry) return [];
          return bundleRes.data.entry.map(e => e.resource).filter(Boolean);
        };

        const addRecord = (resource, category) => {
          const sensitiveCat = detectSensitiveCategory(resource);
          const doctorName = resource.performer?.[0]?.display 
            || resource.performer?.[0]?.actor?.display
            || resource.recorder?.display 
            || resource.requester?.display 
            || resource.asserter?.display 
            || resource.participant?.[0]?.individual?.display 
            || resource.author?.[0]?.display
            || null;

          let finding = resource.conclusion 
            || resource.valueString 
            || (resource.valueQuantity ? `${resource.valueQuantity.value} ${resource.valueQuantity.unit || ''}`.trim() : null)
            || resource.description
            || (resource.note?.[0]?.text)
            || (resource.dosageInstruction?.[0]?.text)
            || null;

          const primaryCoding = (resource.code || resource.type?.[0] || resource.medicationCodeableConcept || resource.vaccineCode)?.coding?.[0] || null;
          let codeSystem = null;
          let codeValue = null;
          if (primaryCoding) {
            codeValue = primaryCoding.code || null;
            if (primaryCoding.system) {
              if (primaryCoding.system.includes('loinc')) codeSystem = 'LOINC';
              else if (primaryCoding.system.includes('snomed')) codeSystem = 'SNOMED-CT';
              else if (primaryCoding.system.includes('rxnorm')) codeSystem = 'RxNorm';
              else if (primaryCoding.system.includes('cvx')) codeSystem = 'CVX';
              else codeSystem = primaryCoding.system.split('/').pop().toUpperCase();
            }
          }

          const item = {
            id: resource.id,
            resource_type: resource.resourceType,
            institution_id: instId,
            institution_name: instName,
            recorded_date: resource.recordedDate || resource.effectiveDateTime || resource.authoredOn || resource.performedDateTime || resource.period?.start || null,
            clinical_text: resource.code?.text || resource.code?.coding?.[0]?.display || resource.type?.[0]?.text || resource.type?.[0]?.coding?.[0]?.display || resource.description || resource.medicationCodeableConcept?.text || resource.medicationCodeableConcept?.coding?.[0]?.display || resource.valueString || 'Clinical record',
            status: resource.clinicalStatus?.coding?.[0]?.code || resource.status || 'final',
            doctor_name: doctorName,
            finding: finding,
            code_system: codeSystem,
            code_value: codeValue,
            is_sensitive: !!sensitiveCat,
            sensitive_category: sensitiveCat
          };
          categorizedRecords[category].push(item);
          return item;
        };

        extractResources(allergies).forEach(r => addRecord(r, 'allergies'));
        extractResources(meds).forEach(r => addRecord(r, 'medications'));
        extractResources(conds).forEach(r => addRecord(r, 'conditions'));

        const labResources = extractResources(labs);
        const obsResources = extractResources(observations);
        labResources.forEach(r => addRecord(r, 'lab_reports'));
        obsResources.forEach(obs => {
          const parentReport = categorizedRecords['lab_reports'].find(lr => 
            lr.resource_type === 'DiagnosticReport' && 
            (obs.id === `${lr.id}-observation` || (lr.recorded_date === (obs.effectiveDateTime || obs.issued) && lr.clinical_text === (obs.code?.text || obs.code?.coding?.[0]?.display)))
          );
          if (parentReport) {
            if (!parentReport.finding) {
              parentReport.finding = obs.valueString || (obs.valueQuantity ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ''}`.trim() : null);
            }
          } else {
            addRecord(obs, 'lab_reports');
          }
        });

        extractResources(procs).forEach(r => addRecord(r, 'encounters_procedures'));
        extractResources(encounters).forEach(r => addRecord(r, 'encounters_procedures'));
      } catch (err) {
        console.error(`Patient timeline query error for ${instId}:`, err);
      }
    };

    await Promise.allSettled(institutions.map(inst => queryNode(inst)));

    for (const cat of Object.keys(categorizedRecords)) {
      categorizedRecords[cat].sort((a, b) => new Date(b.recorded_date || 0) - new Date(a.recorded_date || 0));
    }

    res.json({
      health_id: healthId,
      retrieved_at: new Date().toISOString(),
      records: categorizedRecords
    });
  } catch (err) {
    console.error('Patient timeline fetch error:', err);
    res.status(500).json({ error: 'Internal server error retrieving patient timeline' });
  }
});

// ==========================================
// 7. AUDIT TRAIL SERVICE
// ==========================================

// Retrieve chronological audit trail for a patient (GET /audit/patient/:health_id)
app.get('/audit/patient/:health_id', verifyJWT, async (req, res) => {
  const { health_id } = req.params;

  if (!health_id) {
    return res.status(400).json({ error: 'health_id parameter is required' });
  }

  // Authorization: Patient can only view their own audit trail; Clinicians/Admins/Supervisors can view
  if (req.user.role === 'patient') {
    let patientHealthId = req.user.health_id;
    if (!patientHealthId) {
      const userDoc = await systemDb.collection('users').findOne({ user_id: req.user.user_id });
      patientHealthId = userDoc?.health_id;
    }
    if (patientHealthId !== health_id) {
      return res.status(403).json({ error: 'Access denied: Patients can only view their own audit events' });
    }
  }

  try {
    const events = await systemDb.collection('audit_events')
      .find({
        $or: [
          { subject_health_id: health_id },
          { 'patient.health_id': health_id }
        ]
      })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    res.json({
      health_id,
      total_events: events.length,
      retrieved_at: new Date().toISOString(),
      events
    });
  } catch (err) {
    console.error('Audit trail query error:', err);
    res.status(500).json({ error: 'Internal server error retrieving audit trail' });
  }
});

startServer();
