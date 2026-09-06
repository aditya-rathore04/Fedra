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

// List all registered patients (Helper for demo discovery UI)
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

startServer();
