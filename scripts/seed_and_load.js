const fs = require('fs');
const path = require('path');
let MongoClient;
try {
  MongoClient = require('mongodb').MongoClient;
} catch (e) {
  MongoClient = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mongodb')).MongoClient;
}

const DATA_DIR = path.join(__dirname, '..', 'synthea_sample_data_fhir_latest');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020';

const HOSPITALS = [
  {
    id: 'HOSP-1',
    name: 'Apollo Memorial Hospital',
    localFhirUrl: 'http://localhost:8081/fhir',
    internalFhirUrl: 'http://hospital1-fhir:8080/fhir'
  },
  {
    id: 'HOSP-2',
    name: 'Fortis Healthcare Center',
    localFhirUrl: 'http://localhost:8082/fhir',
    internalFhirUrl: 'http://hospital2-fhir:8080/fhir'
  },
  {
    id: 'HOSP-3',
    name: 'Max Super Specialty Hospital',
    localFhirUrl: 'http://localhost:8083/fhir',
    internalFhirUrl: 'http://hospital3-fhir:8080/fhir'
  }
];

async function waitForFhir(url, maxAttempts = 30) {
  const metaUrl = `${url}/metadata`;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(metaUrl);
      if (res.ok) {
        console.log(`FHIR Server at ${url} is ready.`);
        return true;
      }
    } catch (e) {
      // Waiting
    }
    console.log(`Waiting for FHIR server at ${url} (${i}/${maxAttempts})...`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`FHIR Server at ${url} failed to respond after ${maxAttempts} attempts.`);
}

function analyzeBundle(bundle) {
  const entries = bundle.entry || [];
  let patientName = 'Unknown Patient';
  let birthDate = '';
  let gender = '';

  const categories = new Set();
  const sensitiveCategories = new Set();

  entries.forEach(e => {
    const res = e.resource;
    if (!res) return;

    if (res.resourceType === 'Patient') {
      const nameObj = res.name?.[0];
      if (nameObj) {
        const given = (nameObj.given || []).join(' ');
        const family = nameObj.family || '';
        patientName = `${given} ${family}`.trim() || patientName;
      }
      birthDate = res.birthDate || '';
      gender = res.gender || '';
    } else if (res.resourceType === 'Condition') {
      categories.add('condition');
    } else if (res.resourceType === 'MedicationRequest' || res.resourceType === 'Medication') {
      categories.add('medication');
    } else if (res.resourceType === 'AllergyIntolerance') {
      categories.add('allergy');
    } else if (res.resourceType === 'Observation') {
      categories.add('observation');
    } else if (res.resourceType === 'Procedure') {
      categories.add('procedure');
    } else if (res.resourceType === 'Immunization') {
      categories.add('immunization');
    } else if (res.resourceType === 'Encounter') {
      categories.add('encounter');
    } else if (res.resourceType === 'DiagnosticReport') {
      categories.add('diagnostic_report');
    }
  });

  return {
    patientName,
    birthDate,
    gender,
    totalRecords: entries.length,
    categories: Array.from(categories),
    sensitiveCategories: Array.from(sensitiveCategories)
  };
}

async function uploadBundle(fhirUrl, bundlePath) {
  const data = fs.readFileSync(bundlePath, 'utf-8');
  const res = await fetch(fhirUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/fhir+json'
    },
    body: data
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function main() {
  console.log('=== Federated EHR: Ingestion & Seeding Pipeline ===\n');

  // 1. Identify Files
  const allFiles = fs.readdirSync(DATA_DIR);
  const hospitalInfoFile = allFiles.find(f => f.startsWith('hospitalInformation'));
  const practitionerInfoFile = allFiles.find(f => f.startsWith('practitionerInformation'));

  const patientFiles = allFiles.filter(f => 
    f.endsWith('.json') &&
    !f.startsWith('hospitalInformation') &&
    !f.startsWith('practitionerInformation')
  ).slice(0, 30);

  console.log(`Found ${patientFiles.length} patient files for ingestion (10 per hospital).`);

  // 2. Wait for all 3 FHIR servers
  console.log('\n--- Checking FHIR Servers ---');
  for (const hosp of HOSPITALS) {
    await waitForFhir(hosp.localFhirUrl);
  }

  // 3. Preload Hospitals and Practitioners into all 3 FHIR nodes
  console.log('\n--- Pre-loading Hospital and Practitioner References ---');
  for (const hosp of HOSPITALS) {
    if (hospitalInfoFile) {
      process.stdout.write(`Preloading hospital directory into ${hosp.name}... `);
      await uploadBundle(hosp.localFhirUrl, path.join(DATA_DIR, hospitalInfoFile));
      console.log('Done.');
    }
    if (practitionerInfoFile) {
      process.stdout.write(`Preloading practitioner directory into ${hosp.name}... `);
      await uploadBundle(hosp.localFhirUrl, path.join(DATA_DIR, practitionerInfoFile));
      console.log('Done.');
    }
  }

  // 4. Connect to MongoDB
  console.log('\n--- Connecting to MongoDB (system-mongo:27020) ---');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const systemDb = client.db('system_db');
  const registryDb = client.db('registry_db');

  // Reset collections
  await systemDb.collection('users').deleteMany({});
  await registryDb.collection('registry_entries').deleteMany({});

  // 5. Seed Practitioners/Users in system_db
  console.log('\n--- Seeding Users in system_db.users ---');
  const demoUsers = [
    {
      user_id: 'DOC-1',
      role: 'doctor',
      email: 'doc1@test.com',
      name: 'Dr. Aditya Sharma',
      institution_id: 'HOSP-1',
      institution_name: 'Apollo Memorial Hospital',
      department: 'Cardiology'
    },
    {
      user_id: 'DOC-2',
      role: 'doctor',
      email: 'doc2@test.com',
      name: 'Dr. Priya Patel',
      institution_id: 'HOSP-2',
      institution_name: 'Fortis Healthcare Center',
      department: 'General Medicine'
    },
    {
      user_id: 'DOC-EMERGENCY',
      role: 'emergency',
      email: 'er@test.com',
      name: 'Dr. Rahul Verma (ER)',
      institution_id: 'HOSP-1',
      institution_name: 'Apollo Memorial Hospital',
      department: 'Emergency Care'
    }
  ];

  const registryEntries = [];

  // 6. Ingest Patient Bundles
  console.log('\n--- Ingesting Synthea Records into Hospital Nodes ---');
  for (let i = 0; i < patientFiles.length; i++) {
    const filename = patientFiles[i];
    const filePath = path.join(DATA_DIR, filename);
    const hospIndex = Math.floor(i / 10);
    const hosp = HOSPITALS[hospIndex];

    const healthId = `ABHA-DEMO-${String(i + 1).padStart(3, '0')}`;
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const bundleJson = JSON.parse(rawContent);
    const analysis = analyzeBundle(bundleJson);

    process.stdout.write(`[${i + 1}/${patientFiles.length}] Uploading ${analysis.patientName} (${healthId}) -> ${hosp.name} (:808${hospIndex + 1})... `);
    
    try {
      await uploadBundle(hosp.localFhirUrl, filePath);
      console.log('Success!');
    } catch (err) {
      console.log(`Failed: ${err.message}`);
    }

    const isAdhiRaj = (i === 0);
    const patientDisplayName = isAdhiRaj ? 'AdhiRaj' : analysis.patientName;

    const regEntry = {
      health_id: healthId,
      patient_name: patientDisplayName,
      institution_id: hosp.id,
      institution_name: hosp.name,
      fhir_endpoint: hosp.internalFhirUrl,
      public_fhir_endpoint: hosp.localFhirUrl,
      record_summary: {
        total_records: isAdhiRaj ? 4 : analysis.totalRecords,
        categories_present: isAdhiRaj ? ['encounter', 'condition', 'observation'] : analysis.categories,
        sensitive_categories_present: isAdhiRaj ? [] : analysis.sensitiveCategories
      },
      node_status: 'active',
      created_at: new Date()
    };
    registryEntries.push(regEntry);

    // Register patient user
    demoUsers.push({
      user_id: `PAT-${String(i + 1).padStart(3, '0')}`,
      role: 'patient',
      email: isAdhiRaj ? 'adhiraj@test.com' : `patient${i + 1}@test.com`,
      health_id: healthId,
      name: patientDisplayName,
      birth_date: isAdhiRaj ? '1995-04-12' : analysis.birthDate,
      gender: isAdhiRaj ? 'male' : analysis.gender
    });

    // Cross-hospital demo link for ABHA-DEMO-001 (AdhiRaj) across Hospital 2 and Hospital 3
    if (isAdhiRaj) {
      console.log(`  🔗 Adding multi-hospital federation record for ${healthId} (AdhiRaj) in ${HOSPITALS[1].name}`);
      registryEntries.push({
        health_id: healthId,
        patient_name: patientDisplayName,
        institution_id: HOSPITALS[1].id,
        institution_name: HOSPITALS[1].name,
        fhir_endpoint: HOSPITALS[1].internalFhirUrl,
        public_fhir_endpoint: HOSPITALS[1].localFhirUrl,
        record_summary: {
          total_records: 4,
          categories_present: ['encounter', 'medication', 'allergy'],
          sensitive_categories_present: []
        },
        node_status: 'active',
        created_at: new Date()
      });

      console.log(`  🔗 Adding multi-hospital federation record for ${healthId} (AdhiRaj) in ${HOSPITALS[2].name}`);
      registryEntries.push({
        health_id: healthId,
        patient_name: patientDisplayName,
        institution_id: HOSPITALS[2].id,
        institution_name: HOSPITALS[2].name,
        fhir_endpoint: HOSPITALS[2].internalFhirUrl,
        public_fhir_endpoint: HOSPITALS[2].localFhirUrl,
        record_summary: {
          total_records: 4,
          categories_present: ['encounter', 'diagnostic_report', 'immunization'],
          sensitive_categories_present: []
        },
        node_status: 'active',
        created_at: new Date()
      });
    }
  }

  await systemDb.collection('users').insertMany(demoUsers);
  await registryDb.collection('registry_entries').insertMany(registryEntries);

  console.log(`\nSuccessfully saved ${demoUsers.length} users in system_db.users`);
  console.log(`Successfully saved ${registryEntries.length} registry index records in registry_db.registry_entries`);

  await client.close();
  console.log('\n=== Ingestion & Seeding Complete! ===');
}

main().catch(err => {
  console.error('Fatal error in ingestion pipeline:', err);
  process.exit(1);
});
