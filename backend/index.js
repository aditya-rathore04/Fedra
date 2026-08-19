const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const jwt = require('jsonwebtoken');
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

// Health Check
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

// AUTH - Login (supports Practitioner ID e.g. DOC-1 or Email)
app.post('/auth/login', async (req, res) => {
  const { email, practitioner_id, id } = req.body;
  const input = (practitioner_id || id || email || '').trim();
  
  if (!input) {
    return res.status(400).json({ error: 'Practitioner ID or Email is required' });
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
      return res.status(401).json({ error: `Practitioner '${input}' not found in registry. Please check your ID.` });
    }

    const tokenPayload = {
      user_id: user.user_id,
      role: user.role,
      name: user.name,
      institution_id: user.institution_id || null,
      institution_name: user.institution_name || (user.institution_id === 'HOSP-1' ? 'Apollo Memorial Hospital' : user.institution_id === 'HOSP-2' ? 'Fortis Healthcare Center' : 'Max Super Specialty Hospital'),
      department: user.department || 'General Medicine',
      health_id: user.health_id || null
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, {
      expiresIn: user.role === 'doctor' || user.role === 'emergency' ? '8h' : '24h'
    });

    res.json({
      token,
      user_id: user.user_id,
      role: user.role,
      name: user.name,
      institution_id: user.institution_id || null,
      institution_name: tokenPayload.institution_name,
      department: tokenPayload.department,
      health_id: user.health_id || null
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

// JWT Verification Middleware
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// PATIENT DISCOVERY - Search locations and summaries for a health_id
app.get('/patient/search', verifyJWT, async (req, res) => {
  if (req.user.role !== 'doctor' && req.user.role !== 'admin' && req.user.role !== 'emergency') {
    return res.status(403).json({ error: 'Access forbidden: Doctor role required for patient discovery' });
  }

  const { health_id } = req.query;
  if (!health_id) {
    return res.status(400).json({ error: 'Query parameter health_id is required' });
  }

  try {
    const entries = await registryDb.collection('registry_entries')
      .find({ health_id })
      .toArray();

    res.json({
      health_id,
      total_institutions: entries.length,
      institutions: entries
    });
  } catch (err) {
    console.error('Patient search error:', err);
    res.status(500).json({ error: 'Internal server error during patient discovery' });
  }
});

// LIST ALL REGISTERED PATIENTS (Helper for demo discovery UI)
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
