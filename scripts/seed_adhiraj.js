const fs = require('fs');
const path = require('path');
let MongoClient;
try {
  MongoClient = require('mongodb').MongoClient;
} catch (e) {
  MongoClient = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mongodb')).MongoClient;
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27020';

const ADHIRAJ_ID = 'adhiraj-patient-001';
const HEALTH_ID = 'ABHA-DEMO-001';
const PATIENT_NAME = 'AdhiRaj';

// 1. Apollo Hospital (HOSP-1) FHIR Bundle for AdhiRaj
const apolloBundle = {
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    {
      fullUrl: `urn:uuid:${ADHIRAJ_ID}`,
      resource: {
        resourceType: 'Patient',
        id: ADHIRAJ_ID,
        identifier: [
          { system: 'https://healthid.ndhm.gov.in', value: HEALTH_ID },
          { system: 'http://hospital.apollo.org', value: 'APOLLO-PAT-101' }
        ],
        active: true,
        name: [{ use: 'official', family: 'AdhiRaj', given: ['AdhiRaj'] }],
        gender: 'male',
        birthDate: '1995-04-12'
      },
      request: { method: 'PUT', url: `Patient/${ADHIRAJ_ID}` }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-enc-apollo',
      resource: {
        resourceType: 'Encounter',
        id: 'adhiraj-enc-apollo',
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` },
        period: { start: '2026-01-15T09:30:00Z', end: '2026-01-15T10:15:00Z' }
      },
      request: { method: 'PUT', url: 'Encounter/adhiraj-enc-apollo' }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-cond-apollo',
      resource: {
        resourceType: 'Condition',
        id: 'adhiraj-cond-apollo',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
        code: { coding: [{ system: 'http://snomed.info/sct', code: '195967001', display: 'Mild Seasonal Asthma' }], text: 'Mild Seasonal Asthma' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` }
      },
      request: { method: 'PUT', url: 'Condition/adhiraj-cond-apollo' }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-obs-apollo',
      resource: {
        resourceType: 'Observation',
        id: 'adhiraj-obs-apollo',
        status: 'final',
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }], text: 'Blood Pressure: 120/80 mmHg' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` }
      },
      request: { method: 'PUT', url: 'Observation/adhiraj-obs-apollo' }
    }
  ]
};

// 2. Fortis Healthcare (HOSP-2) FHIR Bundle for AdhiRaj
const fortisBundle = {
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    {
      fullUrl: `urn:uuid:${ADHIRAJ_ID}`,
      resource: {
        resourceType: 'Patient',
        id: ADHIRAJ_ID,
        identifier: [
          { system: 'https://healthid.ndhm.gov.in', value: HEALTH_ID },
          { system: 'http://hospital.fortis.org', value: 'FORTIS-PAT-202' }
        ],
        active: true,
        name: [{ use: 'official', family: 'AdhiRaj', given: ['AdhiRaj'] }],
        gender: 'male',
        birthDate: '1995-04-12'
      },
      request: { method: 'PUT', url: `Patient/${ADHIRAJ_ID}` }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-enc-fortis',
      resource: {
        resourceType: 'Encounter',
        id: 'adhiraj-enc-fortis',
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` },
        period: { start: '2026-02-10T14:00:00Z', end: '2026-02-10T14:45:00Z' }
      },
      request: { method: 'PUT', url: 'Encounter/adhiraj-enc-fortis' }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-med-fortis',
      resource: {
        resourceType: 'MedicationRequest',
        id: 'adhiraj-med-fortis',
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: { coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '746815', display: 'Cetirizine Hydrochloride 10 MG' }], text: 'Cetirizine 10mg Oral Tablet' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` }
      },
      request: { method: 'PUT', url: 'MedicationRequest/adhiraj-med-fortis' }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-all-fortis',
      resource: {
        resourceType: 'AllergyIntolerance',
        id: 'adhiraj-all-fortis',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
        code: { coding: [{ system: 'http://snomed.info/sct', code: '764146007', display: 'Penicillin Allergy' }], text: 'Penicillin' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` }
      },
      request: { method: 'PUT', url: 'AllergyIntolerance/adhiraj-all-fortis' }
    }
  ]
};

// 3. Max Hospital (HOSP-3) FHIR Bundle for AdhiRaj
const maxBundle = {
  resourceType: 'Bundle',
  type: 'transaction',
  entry: [
    {
      fullUrl: `urn:uuid:${ADHIRAJ_ID}`,
      resource: {
        resourceType: 'Patient',
        id: ADHIRAJ_ID,
        identifier: [
          { system: 'https://healthid.ndhm.gov.in', value: HEALTH_ID },
          { system: 'http://hospital.max.org', value: 'MAX-PAT-303' }
        ],
        active: true,
        name: [{ use: 'official', family: 'AdhiRaj', given: ['AdhiRaj'] }],
        gender: 'male',
        birthDate: '1995-04-12'
      },
      request: { method: 'PUT', url: `Patient/${ADHIRAJ_ID}` }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-enc-max',
      resource: {
        resourceType: 'Encounter',
        id: 'adhiraj-enc-max',
        status: 'finished',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` },
        period: { start: '2026-03-01T11:00:00Z', end: '2026-03-01T11:30:00Z' }
      },
      request: { method: 'PUT', url: 'Encounter/adhiraj-enc-max' }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-diag-max',
      resource: {
        resourceType: 'DiagnosticReport',
        id: 'adhiraj-diag-max',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'Complete Blood Count (CBC)' }], text: 'Complete Blood Count - Normal' },
        subject: { reference: `Patient/${ADHIRAJ_ID}` }
      },
      request: { method: 'PUT', url: 'DiagnosticReport/adhiraj-diag-max' }
    },
    {
      fullUrl: 'urn:uuid:adhiraj-imm-max',
      resource: {
        resourceType: 'Immunization',
        id: 'adhiraj-imm-max',
        status: 'completed',
        vaccineCode: { coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '207', display: 'COVID-19 Vaccine (mRNA)' }], text: 'COVID-19 mRNA Vaccine' },
        patient: { reference: `Patient/${ADHIRAJ_ID}` }
      },
      request: { method: 'PUT', url: 'Immunization/adhiraj-imm-max' }
    }
  ]
};

async function uploadToFhir(url, bundle) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify(bundle)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload to ${url} failed (${res.status}): ${text.slice(0, 150)}`);
  }
  return await res.json();
}

async function seedAdhiRaj() {
  console.log(`=== Seeding Demo Patient: ${PATIENT_NAME} (${HEALTH_ID}) ===\n`);

  // 1. Upload to 3 FHIR nodes
  console.log('1. Uploading AdhiRaj records to Apollo Memorial Hospital (:8081)...');
  await uploadToFhir('http://localhost:8081/fhir', apolloBundle);
  console.log('   ✓ Apollo FHIR records loaded.');

  console.log('2. Uploading AdhiRaj records to Fortis Healthcare Center (:8082)...');
  await uploadToFhir('http://localhost:8082/fhir', fortisBundle);
  console.log('   ✓ Fortis FHIR records loaded.');

  console.log('3. Uploading AdhiRaj records to Max Super Specialty Hospital (:8083)...');
  await uploadToFhir('http://localhost:8083/fhir', maxBundle);
  console.log('   ✓ Max FHIR records loaded.');

  // 2. Register in MongoDB system-mongo
  console.log('\n4. Connecting to MongoDB (system-mongo:27020)...');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const registryDb = client.db('registry_db');
  const systemDb = client.db('system_db');

  // Remove existing entries for ABHA-DEMO-001
  await registryDb.collection('registry_entries').deleteMany({ health_id: HEALTH_ID });
  await systemDb.collection('users').deleteMany({ health_id: HEALTH_ID });

  // Add AdhiRaj registry entries for all 3 hospitals
  const adhirajEntries = [
    {
      health_id: HEALTH_ID,
      patient_name: PATIENT_NAME,
      institution_id: 'HOSP-1',
      institution_name: 'Apollo Memorial Hospital',
      fhir_endpoint: 'http://hospital1-fhir:8080/fhir',
      public_fhir_endpoint: 'http://localhost:8081/fhir',
      record_summary: {
        total_records: 4,
        categories_present: ['encounter', 'condition', 'observation'],
        sensitive_categories_present: []
      },
      node_status: 'active',
      created_at: new Date()
    },
    {
      health_id: HEALTH_ID,
      patient_name: PATIENT_NAME,
      institution_id: 'HOSP-2',
      institution_name: 'Fortis Healthcare Center',
      fhir_endpoint: 'http://hospital2-fhir:8080/fhir',
      public_fhir_endpoint: 'http://localhost:8082/fhir',
      record_summary: {
        total_records: 4,
        categories_present: ['encounter', 'medication', 'allergy'],
        sensitive_categories_present: []
      },
      node_status: 'active',
      created_at: new Date()
    },
    {
      health_id: HEALTH_ID,
      patient_name: PATIENT_NAME,
      institution_id: 'HOSP-3',
      institution_name: 'Max Super Specialty Hospital',
      fhir_endpoint: 'http://hospital3-fhir:8080/fhir',
      public_fhir_endpoint: 'http://localhost:8083/fhir',
      record_summary: {
        total_records: 4,
        categories_present: ['encounter', 'diagnostic_report', 'immunization'],
        sensitive_categories_present: []
      },
      node_status: 'active',
      created_at: new Date()
    }
  ];

  await registryDb.collection('registry_entries').insertMany(adhirajEntries);

  // Add Patient User Account
  await systemDb.collection('users').insertOne({
    user_id: 'PAT-001',
    role: 'patient',
    email: 'adhiraj@test.com',
    health_id: HEALTH_ID,
    name: PATIENT_NAME,
    birth_date: '1995-04-12',
    gender: 'male'
  });

  console.log(`   ✓ Successfully registered AdhiRaj across all 3 hospitals in registry_db!`);
  await client.close();
  console.log('\n=== AdhiRaj Seeding Complete! ===');
}

seedAdhiRaj().catch(err => {
  console.error('Error seeding AdhiRaj:', err.message);
  process.exit(1);
});
