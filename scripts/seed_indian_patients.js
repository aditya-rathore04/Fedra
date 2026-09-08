const path = require('path');

let MongoClient;
let bcrypt;
try {
  ({ MongoClient } = require('mongodb'));
  bcrypt = require('bcrypt');
} catch (error) {
  const backendModules = path.join(__dirname, '..', 'backend', 'node_modules');
  ({ MongoClient } = require(path.join(backendModules, 'mongodb')));
  bcrypt = require(path.join(backendModules, 'bcrypt'));
}

const MONGO_SYSTEM_URI = process.env.MONGO_SYSTEM_URI || 'mongodb://localhost:27020';
const HOSP1_MONGO_URI = process.env.HOSP1_MONGO_URI || 'mongodb://localhost:27017/hospital1_db';
const HOSP2_MONGO_URI = process.env.HOSP2_MONGO_URI || 'mongodb://localhost:27018/hospital2_db';
const HOSP3_MONGO_URI = process.env.HOSP3_MONGO_URI || 'mongodb://localhost:27019/hospital3_db';
const FHIR_HOSP1_URL = process.env.FHIR_HOSP1_URL || 'http://localhost:8081/fhir';
const FHIR_HOSP2_URL = process.env.FHIR_HOSP2_URL || 'http://localhost:8082/fhir';
const FHIR_HOSP3_URL = process.env.FHIR_HOSP3_URL || 'http://localhost:8083/fhir';

const SEEDED_ABHAS = [
  'ABHA-4471-2298-6613', 'ABHA-7712-4456-9081', 'ABHA-5528-1193-4402',
  'ABHA-3390-6621-7845', 'ABHA-6604-8817-2239', 'ABHA-1147-9903-5561'
];

const HOSPITALS = {
  'HOSP-1': { id: 'HOSP-1', name: 'Apollo Memorial Hospital', dbName: 'hospital1_db', mongoUri: HOSP1_MONGO_URI, fhirUrl: FHIR_HOSP1_URL, internalFhirUrl: 'http://hospital1-fhir:8080/fhir', mrnPrefix: 'APOLLO' },
  'HOSP-2': { id: 'HOSP-2', name: 'Fortis Healthcare Center', dbName: 'hospital2_db', mongoUri: HOSP2_MONGO_URI, fhirUrl: FHIR_HOSP2_URL, internalFhirUrl: 'http://hospital2-fhir:8080/fhir', mrnPrefix: 'FORTIS' },
  'HOSP-3': { id: 'HOSP-3', name: 'Max Super Specialty Hospital', dbName: 'hospital3_db', mongoUri: HOSP3_MONGO_URI, fhirUrl: FHIR_HOSP3_URL, internalFhirUrl: 'http://hospital3-fhir:8080/fhir', mrnPrefix: 'MAX' }
};

const DOCTORS = [
  ['DOC-1', 'Dr. Aditya Sharma', 'HOSP-1', 'Cardiology', 'pract-cardio-apollo', 'MBBS, MD, DM', 'doc1@test.com'],
  ['DOC-2', 'Dr. Priya Patel', 'HOSP-2', 'General Medicine', 'pract-genmed-fortis', 'MBBS, MD', 'doc2@test.com'],
  ['DOC-3', 'Dr. Rajesh Iyer', 'HOSP-3', 'Emergency & Trauma', 'pract-er-max', 'MBBS, MS (Trauma)', 'doc3@test.com'],
  ['DOC-EMERGENCY', 'Dr. Rahul Verma', 'HOSP-1', 'Emergency Medicine', 'pract-er-apollo', 'MBBS, MEM', 'er@test.com'],
  ['DOC-ONC-01', 'Dr. Ananya Sen', 'HOSP-1', 'Surgical & Medical Oncology', 'pract-onc-apollo', 'MBBS, MS, MCh'],
  ['DOC-PSY-01', 'Dr. Shalini Mukhopadhyay', 'HOSP-1', 'Psycho-Oncology / Psychiatry', 'pract-psy-apollo', 'MBBS, MD'],
  ['DOC-ORTHO-01', 'Dr. K. S. Venkatesh', 'HOSP-1', 'Orthopedic Surgery', 'pract-ortho-apollo', 'MBBS, MS (Ortho)'],
  ['DOC-GYN-01', 'Dr. Sunita Deshmukh', 'HOSP-1', 'Obstetrics & Gynecology', 'pract-gyn-apollo', 'MBBS, DGO, DNB'],
  ['DOC-REHAB-01', 'Dr. Farooq Abdullah', 'HOSP-1', 'Addiction Medicine / Rehab', 'pract-rehab-apollo', 'MBBS, MD (Psych)'],
  ['DOC-OPHTH-01', 'Dr. Meenakshi Sundaram', 'HOSP-2', 'Ophthalmology (Day Care)', 'pract-ophth-fortis', 'MBBS, MS (Ophth)'],
  ['DOC-PED-01', 'Dr. Neha Kulkarni', 'HOSP-2', 'Pediatrics & Neonatology', 'pract-ped-fortis', 'MBBS, MD (Pediatrics)'],
  ['DOC-ORTHO-02', 'Dr. Arvind Menon', 'HOSP-3', 'Orthopedics & Sports Injury', 'pract-ortho-max', 'MBBS, MS (Ortho)']
].map(([id, name, hospitalId, department, fhirId, qualifications, email]) => ({ id, name, hospitalId, department, fhirId, qualifications, email }));

const doctorById = Object.fromEntries(DOCTORS.map(doctor => [doctor.id, doctor]));
const security = (category) => category ? [{
  system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  code: category === 'psychiatric' ? 'PSY' : category === 'reproductive' ? 'SEX' : 'ETH',
  display: category === 'psychiatric' ? 'psychiatry clinic' : category === 'reproductive' ? 'sexual health' : 'alcohol dependence'
}, {
  system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'R', display: 'Restricted'
}] : undefined;

function record(id, date, category, type, code, text, doctorId, sensitiveCategory = null) {
  return { id, date, category, type, code, text, doctorId, sensitiveCategory };
}

const KRISHNAMURTHY_HBA1C_PANELS = [
  '2013-03-15', '2013-09-15', '2014-03-15', '2014-09-15', '2015-03-15', '2015-09-15',
  '2016-03-15', '2016-09-15', '2017-03-15', '2017-09-15', '2018-03-15', '2018-09-15',
  '2019-03-15', '2019-09-15'
].map((date, index) => record(`krish-lab-hba1c-${String(index + 1).padStart(2, '0')}`, date, 'lab_result', 'DiagnosticReport', '4548-4', `Bi-annual HbA1c and lipid panel ${index + 1} (HbA1c 6.8%-7.6%)`, 'DOC-2'));

const LAKSHMI_CBT_SESSIONS = ['2023-04-28', '2023-05-26', '2023-06-23', '2023-08-04', '2023-09-29', '2023-11-10']
  .map((date, index) => record(`lakshmi-enc-cbt-${index + 1}`, date, 'encounter', 'Encounter', '386477009', `Psycho-oncology CBT counselling session ${index + 1} of 6`, 'DOC-PSY-01', 'psychiatric'));

const SARASWATHI_ANNUAL_PANELS = ['2021-03-18', '2022-03-18', '2023-03-18', '2024-03-18', '2025-03-18']
  .map((date, index) => record(`saras-lab-lipids-${2021 + index}`, date, 'lab_result', 'DiagnosticReport', '24331-1', `Annual lipid panel and ECG ${2021 + index}; LDL maintained below 70 mg/dL`, 'DOC-1'));

const VIKRAM_HISTORIC_LFT_PANELS = ['2019-03-15', '2021-04-15', '2023-05-15']
  .map(date => record(`vikram-lab-lft-${date.slice(0, 4)}`, date, 'lab_result', 'DiagnosticReport', '24325-3', 'Recovery liver function panel: SGOT, SGPT and GGT normal', 'DOC-REHAB-01', 'substance_abuse'));

const PATIENTS = [
  {
    id: 'lakshmi-venkatesh', healthId: 'ABHA-4471-2298-6613', aliases: ['ABHA-DEMO-001'], name: 'Lakshmi Venkatesh', family: 'Venkatesh', given: ['Lakshmi'], dob: '1978-03-12', gender: 'female', bloodType: 'O+', mrn: 'APOLLO-PAT-101',
    safeHarbor: { critical_allergies: ['Penicillin'], emergency_contact: { name: 'Suresh Venkatesh', phone: '+91-9845012345', relation: 'husband' } },
    locations: [{ hospitalId: 'HOSP-1', records: [
      record('lakshmi-lab-2003', '2003-08-15', 'lab_result', 'DiagnosticReport', '58410-2', 'Routine wellness CBC and lipid panel normal', 'DOC-1'),
      record('lakshmi-enc-delivery', '2005-11-20', 'encounter', 'Encounter', '177184002', 'Normal vaginal delivery', 'DOC-GYN-01'),
      record('lakshmi-lab-vitd', '2010-06-10', 'lab_result', 'DiagnosticReport', '14635-7', 'Vitamin D deficiency panel', 'DOC-1'),
      record('lakshmi-med-vitd', '2010-06-10', 'medication', 'MedicationRequest', '624647', 'Cholecalciferol 60,000 IU weekly', 'DOC-1'),
      record('lakshmi-lab-lipid', '2015-09-04', 'lab_result', 'DiagnosticReport', '24331-1', 'Routine wellness lipid panel normal', 'DOC-1'),
      record('lakshmi-lab-2020', '2020-02-18', 'lab_result', 'DiagnosticReport', '57021-8', 'Routine CBC normal; baseline mammogram advised', 'DOC-1'),
      record('lakshmi-cond-lump', '2023-01-12', 'condition', 'Condition', '307494002', 'Palpable lump of left breast', 'DOC-ONC-01'),
      record('lakshmi-img-mammogram', '2023-01-16', 'imaging', 'ImagingStudy', '24606-6', 'BI-RADS 4C suspicious mammogram', 'DOC-ONC-01'),
      record('lakshmi-lab-biopsy', '2023-02-02', 'lab_result', 'DiagnosticReport', '116741001', 'Core biopsy invasive ductal carcinoma grade 2 ER+/PR+ HER2-', 'DOC-ONC-01'),
      record('lakshmi-cond-cancer', '2023-02-08', 'condition', 'Condition', '254837009', 'Stage IIA invasive breast carcinoma', 'DOC-ONC-01'),
      record('lakshmi-med-chemo', '2023-03-01', 'medication', 'MedicationRequest', '3639', 'AC-T chemotherapy regimen', 'DOC-ONC-01'),
      record('lakshmi-cond-adj-disorder', '2023-04-14', 'condition', 'Condition', '72883008', 'Adjustment disorder with anxiety and depressed mood', 'DOC-PSY-01', 'psychiatric'),
      record('lakshmi-med-sertraline', '2023-04-18', 'medication', 'MedicationRequest', '36437', 'Sertraline 50 mg daily', 'DOC-PSY-01', 'psychiatric'),
      ...LAKSHMI_CBT_SESSIONS,
      record('lakshmi-proc-lumpectomy', '2023-09-18', 'encounter', 'Procedure', '392021009', 'Lumpectomy and sentinel node biopsy', 'DOC-ONC-01'),
      record('lakshmi-proc-radiation', '2024-01-15', 'encounter', 'Procedure', '33195004', 'Whole-breast radiation therapy 50 Gy in 25 fractions', 'DOC-ONC-01'),
      record('lakshmi-med-sertraline-stop', '2024-01-20', 'medication', 'MedicationRequest', '36437', 'Sertraline tapered and discontinued', 'DOC-PSY-01', 'psychiatric'),
      record('lakshmi-med-tamoxifen', '2024-02-05', 'medication', 'MedicationRequest', '10324', 'Tamoxifen 20 mg daily', 'DOC-ONC-01'),
      record('lakshmi-lab-ca153', '2024-08-12', 'lab_result', 'DiagnosticReport', '83082-8', 'CA 15-3 surveillance normal', 'DOC-ONC-01'),
      record('lakshmi-img-2025', '2025-02-14', 'imaging', 'ImagingStudy', '24606-6', 'Annual surveillance mammogram negative', 'DOC-ONC-01'),
      record('lakshmi-lab-2025', '2025-08-20', 'lab_result', 'DiagnosticReport', '58410-2', 'Follow-up CBC metabolic panel and CA 15-3 normal', 'DOC-ONC-01'),
      record('lakshmi-allergy-penicillin', '2023-01-12', 'allergy', 'AllergyIntolerance', '764146007', 'Penicillin severe anaphylactic reaction', 'DOC-1')
    ], summary: ['allergy', 'medication', 'condition', 'lab_result', 'imaging', 'encounter'], sensitive: ['psychiatric'], total: 21, earliest: '2003-08-15', latest: '2025-08-20' }]
  },
  {
    id: 'krishnamurthy-rao', healthId: 'ABHA-7712-4456-9081', name: 'Krishnamurthy Rao', family: 'Rao', given: ['Krishnamurthy'], dob: '1941-06-20', gender: 'male', bloodType: 'B+',
    safeHarbor: { critical_allergies: [], emergency_contact: { name: 'Suresh Rao', phone: '+91-9880023456', relation: 'son' } },
    locations: [
      { hospitalId: 'HOSP-2', mrn: 'FORTIS-PAT-202', records: [record('krish-cond-htn', '2005-03-14', 'condition', 'Condition', '59621000', 'Essential hypertension', 'DOC-2'), record('krish-med-amlodipine', '2005-03-14', 'medication', 'MedicationRequest', '17767', 'Amlodipine 5 mg daily', 'DOC-2'), record('krish-cond-diabetes', '2010-07-22', 'condition', 'Condition', '44054006', 'Type 2 diabetes mellitus', 'DOC-2'), record('krish-med-metformin', '2010-07-22', 'medication', 'MedicationRequest', '6809', 'Metformin 500 mg twice daily', 'DOC-2'), ...KRISHNAMURTHY_HBA1C_PANELS, record('krish-proc-cataract', '2014-04-18', 'encounter', 'Procedure', '110473004', 'Right eye cataract surgery', 'DOC-OPHTH-01'), record('krish-enc-hypoglycemia', '2019-11-09', 'encounter', 'Encounter', '302866003', 'Hypoglycaemia admission', 'DOC-2'), record('krish-med-metformin-reduced', '2019-11-10', 'medication', 'MedicationRequest', '6809', 'Metformin reduced after hypoglycaemia', 'DOC-2'), record('krish-lab-hba1c-2025', '2025-04-15', 'lab_result', 'DiagnosticReport', '4548-4', 'Recent HbA1c 7.1% and BP 132/82 mmHg', 'DOC-2')], summary: ['condition', 'medication', 'lab_result', 'encounter'], sensitive: [], total: 22, earliest: '2005-03-14', latest: '2025-04-15' },
      { hospitalId: 'HOSP-1', mrn: 'APOLLO-PAT-202', records: [record('krish-cond-hip-fracture', '2022-05-11', 'condition', 'Condition', '263225007', 'Displaced right femoral neck fracture', 'DOC-ORTHO-01'), record('krish-img-hip', '2022-05-11', 'imaging', 'ImagingStudy', '36879-5', 'Pelvis and hip radiograph', 'DOC-ORTHO-01'), record('krish-proc-hip', '2022-05-12', 'encounter', 'Procedure', '52734007', 'Cemented total hip arthroplasty', 'DOC-ORTHO-01'), record('krish-enc-review', '2022-08-16', 'encounter', 'Encounter', '306237005', 'Three-month hip review', 'DOC-ORTHO-01')], summary: ['condition', 'imaging', 'encounter'], sensitive: [], total: 4, earliest: '2022-05-11', latest: '2022-08-16' }
    ]
  },
  {
    id: 'saraswathi-nair', healthId: 'ABHA-5528-1193-4402', name: 'Saraswathi Nair', family: 'Nair', given: ['Saraswathi'], dob: '1962-01-15', gender: 'female', bloodType: 'A+', safeHarbor: { critical_allergies: ['Sulfa drugs'], emergency_contact: { name: 'Meera Krishnan', phone: '+91-9741134567', relation: 'daughter' } },
    locations: [
      { hospitalId: 'HOSP-1', mrn: 'APOLLO-PAT-303', records: [record('saras-cond-htn', '2012-04-10', 'condition', 'Condition', '59621000', 'Hypertension', 'DOC-1'), record('saras-med-telmisartan', '2012-04-10', 'medication', 'MedicationRequest', '316116', 'Telmisartan 40 mg daily', 'DOC-1'), record('saras-cond-angina', '2020-03-15', 'condition', 'Condition', '225566008', 'Exertional angina', 'DOC-1'), record('saras-lab-troponin', '2020-03-15', 'lab_result', 'DiagnosticReport', '6598-7', 'Troponin and lipid panel', 'DOC-1'), record('saras-img-angio', '2020-03-16', 'imaging', 'ImagingStudy', '252416005', 'Coronary angiography mid-LAD stenosis', 'DOC-1'), record('saras-proc-pci', '2020-03-18', 'encounter', 'Procedure', '415070008', 'PCI with drug-eluting stent', 'DOC-1'), record('saras-med-dapt', '2020-03-18', 'medication', 'MedicationRequest', '32968', 'Clopidogrel and atorvastatin', 'DOC-1'), ...SARASWATHI_ANNUAL_PANELS, record('saras-enc-review', '2025-06-12', 'encounter', 'Encounter', '390906007', 'Annual cardiology review', 'DOC-1')], summary: ['condition', 'medication', 'lab_result', 'imaging', 'encounter'], sensitive: [], total: 13, earliest: '2012-04-10', latest: '2025-06-12' },
      { hospitalId: 'HOSP-3', mrn: 'MAX-PAT-303', records: [record('saras-cond-wrist', '2023-09-24', 'condition', 'Condition', '62413002', 'Closed distal radius fracture', 'DOC-ORTHO-02'), record('saras-img-wrist', '2023-09-24', 'imaging', 'ImagingStudy', '36901-7', 'Wrist radiograph', 'DOC-ORTHO-02'), record('saras-proc-cast', '2023-09-24', 'encounter', 'Procedure', '417257007', 'Closed reduction and cast', 'DOC-ORTHO-02'), record('saras-enc-cast-removal', '2023-11-05', 'encounter', 'Encounter', '262332007', 'Cast removal and union review', 'DOC-ORTHO-02')], summary: ['condition', 'imaging', 'encounter'], sensitive: [], total: 4, earliest: '2023-09-24', latest: '2023-11-05' }
    ]
  },
  {
    id: 'ananya-reddy', healthId: 'ABHA-3390-6621-7845', name: 'Ananya Reddy', family: 'Reddy', given: ['Ananya'], dob: '2002-05-30', gender: 'female', bloodType: 'AB+', safeHarbor: { critical_allergies: [], emergency_contact: { name: 'Radha Reddy', phone: '+91-9900145678', relation: 'mother' } },
    locations: [
      { hospitalId: 'HOSP-2', mrn: 'FORTIS-PAT-404', records: [record('ananya-enc-birth', '2002-05-30', 'encounter', 'Encounter', '169826009', 'Term vaginal delivery', 'DOC-PED-01'), record('ananya-imm-birth', '2002-05-30', 'immunization', 'Immunization', '45', 'Birth BCG OPV-0 Hepatitis B', 'DOC-PED-01'), record('ananya-imm-primary', '2003-03-01', 'immunization', 'Immunization', '198', 'Primary UIP infant series', 'DOC-PED-01'), record('ananya-imm-mr', '2003-03-05', 'immunization', 'Immunization', '03', 'MR-1 and Vitamin A', 'DOC-PED-01'), record('ananya-imm-booster1', '2004-05-18', 'immunization', 'Immunization', '107', 'DTP booster and MR-2', 'DOC-PED-01'), record('ananya-imm-booster2', '2007-06-02', 'immunization', 'Immunization', '20', 'DTP booster 2', 'DOC-PED-01'), record('ananya-imm-tdap', '2016-03-15', 'immunization', 'Immunization', '115', 'Tdap school booster', 'DOC-PED-01'), record('ananya-cond-radius', '2016-08-20', 'condition', 'Condition', '62413002', 'Greenstick distal radius fracture', 'DOC-PED-01'), record('ananya-img-radius', '2016-08-20', 'imaging', 'ImagingStudy', '36901-7', 'Forearm radiograph', 'DOC-PED-01'), record('ananya-proc-cast', '2016-08-20', 'encounter', 'Procedure', '417257007', 'Splint and cast immobilisation', 'DOC-PED-01'), record('ananya-enc-cast-removal', '2016-10-02', 'encounter', 'Encounter', '262332007', 'Cast removal', 'DOC-PED-01')], summary: ['encounter', 'immunization', 'condition', 'imaging'], sensitive: [], total: 11, earliest: '2002-05-30', latest: '2016-10-02' },
      { hospitalId: 'HOSP-1', mrn: 'APOLLO-PAT-404', records: [record('ananya-enc-family-planning', '2024-11-14', 'encounter', 'Encounter', '408447006', 'Reproductive health and family planning consultation', 'DOC-GYN-01', 'reproductive'), record('ananya-med-ocp', '2024-11-14', 'medication', 'MedicationRequest', '748856', 'Ethinylestradiol and levonorgestrel oral contraceptive', 'DOC-GYN-01', 'reproductive'), record('ananya-lab-cbc', '2025-05-22', 'lab_result', 'DiagnosticReport', '58410-2', 'Routine adult CBC and ferritin panel', 'DOC-1')], summary: ['encounter', 'medication', 'lab_result'], sensitive: ['reproductive'], total: 3, earliest: '2024-11-14', latest: '2025-05-22' }
    ]
  },
  {
    id: 'vikram-shetty', healthId: 'ABHA-6604-8817-2239', name: 'Vikram Shetty', family: 'Shetty', given: ['Vikram'], dob: '1992-02-18', gender: 'male', bloodType: 'O-', safeHarbor: { critical_allergies: [], emergency_contact: { name: 'Priya Shetty', phone: '+91-9844256789', relation: 'sister' } },
    locations: [
      { hospitalId: 'HOSP-3', mrn: 'MAX-PAT-505', records: [record('vikram-cond-acl', '2015-09-12', 'condition', 'Condition', '444470001', 'Acute left ACL tear', 'DOC-ORTHO-02'), record('vikram-img-mri', '2015-09-14', 'imaging', 'ImagingStudy', '24725-4', 'Left knee MRI ACL rupture', 'DOC-ORTHO-02'), record('vikram-proc-acl', '2015-10-06', 'encounter', 'Procedure', '44734009', 'Arthroscopic ACL reconstruction', 'DOC-ORTHO-02'), record('vikram-enc-review', '2016-04-12', 'encounter', 'Encounter', '306237005', 'Six month post-operative review', 'DOC-ORTHO-02'), record('vikram-enc-fitness', '2021-11-20', 'encounter', 'Encounter', '185349003', 'Sports fitness examination', 'DOC-3'), record('vikram-lab-wellness', '2024-06-18', 'lab_result', 'DiagnosticReport', '24331-1', 'Corporate wellness panel normal', 'DOC-3')], summary: ['condition', 'imaging', 'encounter', 'lab_result'], sensitive: [], total: 6, earliest: '2015-09-12', latest: '2024-06-18' },
      { hospitalId: 'HOSP-1', mrn: 'APOLLO-PAT-505', records: [record('vikram-cond-aud', '2016-11-04', 'condition', 'Condition', '7200002', 'Alcohol use disorder moderate severity', 'DOC-REHAB-01', 'substance_abuse'), record('vikram-enc-rehab', '2018-01-10', 'encounter', 'Encounter', '56876005', 'Fourteen-month detoxification and rehabilitation', 'DOC-REHAB-01', 'substance_abuse'), record('vikram-cond-remission', '2018-02-10', 'condition', 'Condition', '7200002', 'Alcohol use disorder sustained remission', 'DOC-REHAB-01', 'substance_abuse'), ...VIKRAM_HISTORIC_LFT_PANELS, record('vikram-lab-lft-2025', '2025-04-18', 'lab_result', 'DiagnosticReport', '24325-3', 'Seven-year recovery liver function check normal', 'DOC-REHAB-01', 'substance_abuse')], summary: ['condition', 'encounter', 'lab_result'], sensitive: ['substance_abuse'], total: 7, earliest: '2016-11-04', latest: '2025-04-18' }
    ]
  },
  {
    id: 'anika-pillai', healthId: 'ABHA-1147-9903-5561', name: 'Anika Pillai', family: 'Pillai', given: ['Anika'], dob: '2025-01-04', gender: 'female', bloodType: 'Unknown / Not Typed', safeHarbor: { critical_allergies: [], emergency_contact: { name: 'Kavya Pillai', phone: '+91-9880367890', relation: 'mother and guardian' } },
    locations: [{ hospitalId: 'HOSP-2', mrn: 'FORTIS-PAT-606', records: [record('anika-enc-birth', '2025-01-04', 'encounter', 'Encounter', '169826009', 'Term vaginal delivery; Apgar 9/9', 'DOC-PED-01'), record('anika-imm-birth', '2025-01-04', 'immunization', 'Immunization', '45', 'BCG OPV-0 Hepatitis B-1', 'DOC-PED-01'), record('anika-imm-6week', '2025-02-15', 'immunization', 'Immunization', '198', 'Six-week UIP schedule', 'DOC-PED-01'), record('anika-imm-10week', '2025-03-15', 'immunization', 'Immunization', '198', 'Ten-week UIP schedule', 'DOC-PED-01'), record('anika-imm-14week', '2025-04-12', 'immunization', 'Immunization', '198', 'Fourteen-week UIP schedule', 'DOC-PED-01'), record('anika-vitals-5month', '2025-06-04', 'vitals', 'Observation', '29463-7', 'Weight 6.8 kg, length 64 cm, head circumference 42 cm', 'DOC-PED-01')], summary: ['encounter', 'immunization', 'vitals'], sensitive: [], total: 6, earliest: '2025-01-04', latest: '2025-06-04' }]
  }
];

function isoDate(date) { return new Date(`${date.slice(0, 10)}T00:00:00.000Z`); }

async function waitForFhir(url, maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/metadata`);
      if (response.ok) return;
    } catch (_) { /* HAPI is still starting. */ }
    console.log(`Waiting for FHIR server at ${url} (${attempt}/${maxAttempts})...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`FHIR Server at ${url} failed to respond after ${maxAttempts} attempts.`);
}

async function uploadTransaction(fhirUrl, entries) {
  const response = await fetch(fhirUrl, { method: 'POST', headers: { 'Content-Type': 'application/fhir+json' }, body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: entries }) });
  if (!response.ok) throw new Error(`Upload to ${fhirUrl} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

function practitionerEntry(doctor) {
  const name = doctor.name.replace(/^Dr\. /, '').split(' ');
  return { fullUrl: `urn:uuid:${doctor.fhirId}`, resource: { resourceType: 'Practitioner', id: doctor.fhirId, active: true, identifier: [{ system: 'https://fedra.example/doctor-id', value: doctor.id }], name: [{ use: 'official', family: name.pop(), given: name, prefix: ['Dr.'] }], qualification: [{ code: { text: doctor.qualifications } }], communication: [{ text: doctor.department }] }, request: { method: 'PUT', url: `Practitioner/${doctor.fhirId}` } };
}

function patientEntry(patient, location) {
  const hospital = HOSPITALS[location.hospitalId];
  const identifiers = [{ system: 'https://healthid.ndhm.gov.in', value: patient.healthId }]
    .concat((patient.aliases || []).map(value => ({ system: 'https://healthid.ndhm.gov.in', value })))
    .concat([{ system: `http://hospital.${hospital.mrnPrefix.toLowerCase()}.org`, value: location.mrn || patient.mrn }]);
  return { fullUrl: `urn:uuid:${patient.id}`, resource: { resourceType: 'Patient', id: patient.id, active: true, identifier: identifiers, name: [{ use: 'official', family: patient.family, given: patient.given }], gender: patient.gender, birthDate: patient.dob }, request: { method: 'PUT', url: `Patient/${patient.id}` } };
}

function clinicalResource(patient, entry) {
  const common = { id: entry.id, meta: entry.sensitiveCategory ? { security: security(entry.sensitiveCategory) } : undefined };
  const doctor = doctorById[entry.doctorId];
  const practitioner = { reference: `Practitioner/${doctor.fhirId}`, display: doctor.name };
  const codingSystem = entry.type === 'Immunization' ? 'http://hl7.org/fhir/sid/cvx'
    : entry.type === 'MedicationRequest' ? 'http://www.nlm.nih.gov/research/umls/rxnorm'
      : entry.type === 'DiagnosticReport' && entry.code === '116741001' ? 'http://snomed.info/sct'
        : entry.type === 'ImagingStudy' && entry.code === '252416005' ? 'http://snomed.info/sct'
          : entry.type === 'Condition' || entry.type === 'Encounter' || entry.type === 'Procedure' || entry.type === 'AllergyIntolerance' ? 'http://snomed.info/sct' : 'http://loinc.org';
  const code = { coding: [{ system: codingSystem, code: entry.code }], text: entry.text };
  if (entry.type === 'Condition') return { ...common, resourceType: 'Condition', clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] }, verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] }, code, subject: { reference: `Patient/${patient.id}` }, asserter: practitioner, recordedDate: `${entry.date.slice(0, 10)}T00:00:00Z` };
  if (entry.type === 'MedicationRequest') return { ...common, resourceType: 'MedicationRequest', status: entry.text.includes('discontinued') ? 'stopped' : 'active', intent: 'order', medicationCodeableConcept: code, subject: { reference: `Patient/${patient.id}` }, requester: practitioner, authoredOn: entry.date.slice(0, 10) };
  if (entry.type === 'Encounter') return { ...common, resourceType: 'Encounter', status: 'finished', class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' }, type: [code], subject: { reference: `Patient/${patient.id}` }, participant: [{ individual: practitioner }], period: { start: `${entry.date.slice(0, 10)}T09:00:00Z`, end: `${entry.date.slice(0, 10)}T10:00:00Z` } };
  if (entry.type === 'Procedure') return { ...common, resourceType: 'Procedure', status: 'completed', code, subject: { reference: `Patient/${patient.id}` }, performer: [{ actor: practitioner }], performedDateTime: `${entry.date.slice(0, 10)}T09:00:00Z` };
  if (entry.type === 'ImagingStudy') return { ...common, resourceType: 'ImagingStudy', status: 'available', subject: { reference: `Patient/${patient.id}` }, referrer: practitioner, started: `${entry.date.slice(0, 10)}T09:00:00Z`, modality: [{ system: 'http://dicom.nema.org/resources/ontology/DCM', code: 'OT', display: 'Other' }], description: entry.text };
  if (entry.type === 'Immunization') return { ...common, resourceType: 'Immunization', status: 'completed', vaccineCode: code, patient: { reference: `Patient/${patient.id}` }, performer: [{ actor: practitioner }], occurrenceDateTime: `${entry.date.slice(0, 10)}T09:00:00Z` };
  if (entry.type === 'AllergyIntolerance') return { ...common, resourceType: 'AllergyIntolerance', clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] }, code, patient: { reference: `Patient/${patient.id}` }, recorder: practitioner, recordedDate: entry.date.slice(0, 10) };
  if (entry.type === 'Observation') return { ...common, resourceType: 'Observation', status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }], code, subject: { reference: `Patient/${patient.id}` }, performer: [practitioner], effectiveDateTime: `${entry.date.slice(0, 10)}T09:00:00Z`, valueString: entry.text };
  return { ...common, resourceType: 'DiagnosticReport', status: 'final', code, subject: { reference: `Patient/${patient.id}` }, performer: [practitioner], effectiveDateTime: `${entry.date.slice(0, 10)}T09:00:00Z`, conclusion: entry.text };
}

function transactionEntry(resource) { return { fullUrl: `urn:uuid:${resource.id}`, resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` } }; }

function clinicalEntries(patient, item) {
  const resource = clinicalResource(patient, item);
  const doctor = doctorById[item.doctorId];
  const practitioner = { reference: `Practitioner/${doctor.fhirId}`, display: doctor.name };
  const companionEntries = [];
  if (item.category === 'lab_result') {
    const observationId = `${item.id}-observation`;
    const observation = { resourceType: 'Observation', id: observationId, meta: resource.meta, status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }], code: resource.code, subject: { reference: `Patient/${patient.id}` }, performer: [practitioner], effectiveDateTime: `${item.date.slice(0, 10)}T09:00:00Z`, valueString: item.text };
    resource.result = [{ reference: `Observation/${observationId}` }];
    companionEntries.push(transactionEntry(observation));
  }
  if (item.category === 'imaging') {
    const documentId = `${item.id}-document`;
    const document = { resourceType: 'DocumentReference', id: documentId, meta: resource.meta, status: 'current', type: resource.description ? { text: 'Imaging report' } : resource.code, subject: { reference: `Patient/${patient.id}` }, date: `${item.date.slice(0, 10)}T09:00:00Z`, author: [practitioner], content: [{ attachment: { contentType: 'text/plain', title: `${item.text} report`, data: Buffer.from(item.text).toString('base64') } }] };
    companionEntries.push(transactionEntry(document));
  }
  if (item.type === 'Procedure') {
    const encounterId = `${item.id}-encounter`;
    const encounter = { resourceType: 'Encounter', id: encounterId, meta: resource.meta, status: 'finished', class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' }, type: [resource.code], subject: { reference: `Patient/${patient.id}` }, participant: [{ individual: practitioner }], period: { start: `${item.date.slice(0, 10)}T09:00:00Z`, end: `${item.date.slice(0, 10)}T10:00:00Z` } };
    resource.encounter = { reference: `Encounter/${encounterId}` };
    companionEntries.push(transactionEntry(encounter));
  }
  return [transactionEntry(resource), ...companionEntries];
}

function hospitalPatientDocument(patient, location) {
  return { health_id: patient.healthId, hospital_uuid: location.hospitalId, demographics: { name: patient.name, dob: patient.dob, blood_type: patient.bloodType, gender: patient.gender }, safe_harbor: patient.safeHarbor, records: location.records.map((item, index) => {
    const doctor = doctorById[item.doctorId];
    return { record_id: `REC-${location.hospitalId.replace('-', '')}-${String(index + 1).padStart(3, '0')}`, fhir_resource_type: item.type, fhir_resource_id: item.id, category: item.category, sensitive_category: item.sensitiveCategory, created_at: isoDate(item.date), uploaded_by: { institution: location.hospitalId, doctor_id: doctor.id, doctor_name: doctor.name, department: doctor.department }, version: 1, superseded_by: null };
  }) };
}

function registryDocument(patient, location) {
  const hospital = HOSPITALS[location.hospitalId];
  return { health_id: patient.healthId, patient_name: patient.name, institution_id: hospital.id, institution_name: hospital.name, fhir_endpoint: hospital.internalFhirUrl, public_fhir_endpoint: hospital.fhirUrl, record_summary: { total_records: location.total, categories_present: location.summary, sensitive_categories_present: location.sensitive, date_range: { earliest: isoDate(location.earliest), latest: isoDate(location.latest) } }, node_status: 'active', created_at: new Date('2026-09-07T00:00:00.000Z') };
}

async function main() {
  console.log('=== FEDRA Indian Patient Cohort Seeder ===');
  const clients = [];
  try {
    // Phase 1: Check FHIR health
    console.log('\nPhase 1: Check FHIR health');
    await Promise.all(Object.values(HOSPITALS).map(async hospital => { await waitForFhir(hospital.fhirUrl); console.log(`  Ready: ${hospital.name}`); }));

    const systemClient = new MongoClient(MONGO_SYSTEM_URI); const hosp1Client = new MongoClient(HOSP1_MONGO_URI); const hosp2Client = new MongoClient(HOSP2_MONGO_URI); const hosp3Client = new MongoClient(HOSP3_MONGO_URI);
    clients.push(systemClient, hosp1Client, hosp2Client, hosp3Client);
    await Promise.all(clients.map(client => client.connect()));
    const systemDb = systemClient.db('system_db'); const registryDb = systemClient.db('registry_db');
    const hospitalDbs = { 'HOSP-1': hosp1Client.db('hospital1_db'), 'HOSP-2': hosp2Client.db('hospital2_db'), 'HOSP-3': hosp3Client.db('hospital3_db') };

    // Phase 2: Idempotent cleanup
    console.log('\nPhase 2: Idempotent cleanup');
    console.log(`  Deleting only prior cohort documents for: ${SEEDED_ABHAS.join(', ')}`);
    const cleanupResults = await Promise.all([
      registryDb.collection('registry_entries').deleteMany({ health_id: { $in: SEEDED_ABHAS } }),
      systemDb.collection('users').deleteMany({ health_id: { $in: SEEDED_ABHAS } }),
      ...Object.values(hospitalDbs).map(db => db.collection('patients').deleteMany({ health_id: { $in: SEEDED_ABHAS } }))
    ]);
    console.log(`  Removed ${cleanupResults.reduce((total, result) => total + result.deletedCount, 0)} ABHA-scoped documents.`);

    // Phase 3: Seed FHIR practitioners and patients
    console.log('\nPhase 3: Seed FHIR practitioners and patients');
    for (const hospital of Object.values(HOSPITALS)) {
      const practitioners = DOCTORS.filter(doctor => doctor.hospitalId === hospital.id).map(practitionerEntry);
      const patientEntries = PATIENTS.flatMap(patient => patient.locations.filter(location => location.hospitalId === hospital.id).flatMap(location => [patientEntry(patient, location), ...location.records.flatMap(item => clinicalEntries(patient, item))]));
      await uploadTransaction(hospital.fhirUrl, [...practitioners, ...patientEntries]);
      console.log(`  Uploaded ${practitioners.length} practitioners and ${patientEntries.length} patient/clinical resources to ${hospital.name}.`);
    }

    // Phase 4: Seed hospital Mongo databases
    console.log('\nPhase 4: Seed hospital Mongo databases');
    for (const [hospitalId, db] of Object.entries(hospitalDbs)) {
      const documents = PATIENTS.flatMap(patient => patient.locations.filter(location => location.hospitalId === hospitalId).map(location => hospitalPatientDocument(patient, location)));
      if (documents.length) await db.collection('patients').insertMany(documents);
      console.log(`  Inserted ${documents.length} patient index documents into ${db.databaseName}.patients.`);
    }

    // Phase 5: Seed central registry
    console.log('\nPhase 5: Seed central registry');
    const registryEntries = PATIENTS.flatMap(patient => patient.locations.map(location => registryDocument(patient, location)));
    await registryDb.collection('registry_entries').insertMany(registryEntries);
    console.log(`  Inserted ${registryEntries.length} registry entries.`);

    // Phase 6: Seed system users
    console.log('\nPhase 6: Seed system users');
    const passwordHash = await bcrypt.hash('password123', 10);
    const interactiveDoctors = DOCTORS.filter(doctor => doctor.email).map(doctor => ({ user_id: doctor.id, role: doctor.id === 'DOC-EMERGENCY' ? 'emergency' : 'doctor', email: doctor.email, name: doctor.name, institution_id: doctor.hospitalId, institution_name: HOSPITALS[doctor.hospitalId].name, department: doctor.department, password_hash: passwordHash, status: 'active', created_at: new Date() }));
    const patientUsers = PATIENTS.map((patient, index) => ({ user_id: `PAT-${String(index + 1).padStart(3, '0')}`, role: 'patient', email: `${patient.id}@test.com`, health_id: patient.healthId, name: patient.name, birth_date: patient.dob, gender: patient.gender, password_hash: passwordHash, status: 'active', created_at: new Date() }));
    const guardian = { user_id: 'PAT-GUARDIAN-001', role: 'patient', email: 'kavya.pillai@test.com', name: 'Kavya Pillai', health_id: 'ABHA-1147-9903-5561', guardian_for_health_id: 'ABHA-1147-9903-5561', phone: '+91-9880367890', password_hash: passwordHash, status: 'active', created_at: new Date() };
    for (const user of [...interactiveDoctors, guardian]) await systemDb.collection('users').updateOne({ user_id: user.user_id }, { $set: user }, { upsert: true });
    await systemDb.collection('users').insertMany(patientUsers);
    console.log(`  Seeded ${interactiveDoctors.length} interactive doctors, ${patientUsers.length} patient accounts, and guardian PAT-GUARDIAN-001.`);
    console.log('\n=== Indian patient cohort seeding complete ===');
  } finally { await Promise.all(clients.map(client => client.close().catch(() => {}))); }
}

main().catch(error => { console.error('Indian patient cohort seeding failed:', error); process.exit(1); });
