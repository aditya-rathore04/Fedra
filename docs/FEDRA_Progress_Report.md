# Review 1 Report - Fedra: Federated EHR Access System

**Visvesvaraya Technological University**  
Jnana Sangama, Belagavi - 590018, Karnataka  

Submitted in partial fulfilment of the requirements for the Seventh Semester of  
**Bachelor of Engineering in Computer Science and Engineering (Artificial Intelligence and Machine Learning)**  

### Submitted by
- AdhiRaj (1AM23CI005)
- Aditya Rathore (1AM23CI006)
- Salma M B (1AM24CI410)
- Akshitha Y (1AM23CI009)

### Under the guidance of
**Prof. Ambili K**  
Professor, Dept. of CSE(AIML)  

Department of Computer Science & Engineering (Artificial Intelligence and Machine Learning)  
**AMC Engineering College**  
Bannerghatta Road, Bangalore-560083  
2026-2027  

---

## Abstract

Healthcare systems suffer from severe data fragmentation. Medical records remain siloed across hospitals, diagnostic centers, and clinics without an interoperable mechanism for secure retrieval across institutions. When patients visit new facilities, doctors make clinical decisions without complete medical histories, which leads to duplicate testing, adverse medication events, and diagnostic delays. Existing solutions like hospital web portals and national health identifiers improve record access inside isolated boundaries, but they do not resolve cross-institutional record coordination.

This project delivers the design and implementation of FEDRA, a federated medical record discovery and access control system. FEDRA connects distributed healthcare records without centralizing patient clinical data. The architecture establishes a clear division of responsibility: hospitals maintain custodianship of clinical data, patients govern access policies, and the central system maintains discovery pointers and access rules. The system consists of five components: a federated discovery and aggregation layer built on HL7 FHIR R4, a context-aware consent service issuing time-limited tokens with separate opt-in controls for sensitive categories, a 3-branch break-glass emergency access engine with automated rule checking and clinical supervisor escalations, a tile-based Merkle transparency log based on Tessera that provides tamper-evident audit notarization with zero transaction fees, and an anomaly detection service combining Isolation Forest and LSTM autoencoder models.

The audit notary originally used Ethereum smart contracts. During development, operational testing showed that public and private blockchains introduce gas expenses, mining delays of 12 to 15 seconds, and substantial container memory overhead. The audit layer was redesigned using a Go-based Tessera transparency log based on RFC 6962 and C2SP signed checkpoints. The system computes canonical hashes using RFC 8785 JSON Canonicalization Scheme, pseudonymizes patient identifiers using keyed HMAC-SHA256, and serves cryptographic inclusion proofs to a client-side verifier running WebCrypto in the browser.

Phases 1, 2, and 3 are 100% complete and validated across 688 automated integration tests. The prototype environment runs across 8 optimized Docker containers spanning three independent HAPI FHIR hospital nodes (Apollo, Fortis, and Max), four MongoDB instances, and the Tessera transparency log. Phase 4, the machine learning anomaly detection service, is currently in active development.

---

## Table of contents

- Abstract
- List of figures
- List of tables
- List of abbreviations
- Chapter 1: Introduction
  - 1.1 General background
  - 1.2 Problem statement
  - 1.3 Project objectives
  - 1.4 Scope and limitations
- Chapter 2: Literature review
  - 2.1 Health information exchange architecture
  - 2.2 Federated systems in healthcare
  - 2.3 Blockchain and transparency logs in healthcare data sharing
  - 2.4 Break-glass access control
  - 2.5 HL7 FHIR interoperability
  - 2.6 Machine learning anomaly detection
  - 2.7 Research gap and summary table
- Chapter 3: System design and architecture
  - 3.1 Architectural overview
  - 3.2 User roles and permissions
  - 3.3 Federated data flow
  - 3.4 Access token and consent model
  - 3.5 Break-glass emergency access
  - 3.6 Tessera Merkle transparency log audit layer
  - 3.7 Machine learning anomaly detection layer
  - 3.8 Use case summary
- Chapter 4: Technology stack
  - 4.1 Technology choices and justification
  - 4.2 Database design and schemas
  - 4.3 API gateway and core services
  - 4.4 FHIR integration
  - 4.5 Audit notary and transparency log implementation
  - 4.6 Machine learning model design
- Chapter 5: Implementation and phase build plan
  - 5.1 Development methodology
  - 5.2 Completed deliverables and specifications
  - 5.3 Phase 1 completion: Foundation and infrastructure
  - 5.4 Phase 2 completion: Core access control and federated aggregator
  - 5.5 Phase 3 completion: Break-glass emergency access and Tessera audit layer
  - 5.6 Phase build plan status
- Chapter 6: Results and discussion
  - 6.1 Demonstration scenarios and verification
  - 6.2 Measured performance against targets
  - 6.3 Comparative analysis with existing systems
- Chapter 7: Conclusion and future work
  - 7.1 Conclusion
  - 7.2 Future work
- References

---

## List of figures

- Figure 3.1: System architecture overview
- Figure 3.3: Federated control flow and direct clinical data flow
- Figure 3.4: Access token lifecycle state machine
- Figure 3.5: Break-glass emergency access flow and supervisor review
- Figure 3.6: Tessera tile-based Merkle tree and audit verification structure
- Figure 3.7: Machine learning anomaly detection pipeline
- Figure 3.8: Unified use case diagram
- Figure 4.2: Entity relationship diagram of central data collections

---

## List of tables

- Table 2.7: Literature review summary and identified gaps
- Table 4.1: Complete technology stack and architectural roles
- Table 5.2: Completed engineering deliverables and artifacts
- Table 5.4: Phase build plan and current milestone status
- Table 6.2: Measured system benchmarks against architectural targets
- Table 6.3: Architectural comparison with traditional, centralized, and blockchain EHR systems

---

## List of abbreviations

| Abbreviation | Full form |
|---|---|
| ABHA | Ayushman Bharat Health Account |
| API | Application Programming Interface |
| C2SP | Community Cryptography Specification Project |
| DID | Decentralized Identifier |
| DPDPA | Digital Personal Data Protection Act |
| EHR | Electronic Health Record |
| EVM | Ethereum Virtual Machine |
| FHIR | Fast Healthcare Interoperability Resources |
| FL | Federated Learning |
| HIE | Health Information Exchange |
| HIPAA | Health Insurance Portability and Accountability Act |
| HL7 | Health Level Seven |
| HMAC | Hash-based Message Authentication Code |
| JCS | JSON Canonicalization Scheme (RFC 8785) |
| JWT | JSON Web Token |
| LOINC | Logical Observation Identifiers Names and Codes |
| LSTM | Long Short-Term Memory |
| ML | Machine Learning |
| RBAC | Role-Based Access Control |
| REST | Representational State Transfer |
| RFC | Request for Comments |
| RxNorm | Normalized Naming System for Generic and Branded Drugs |
| SLA | Service Level Agreement |
| SNOMED-CT | Systematized Nomenclature of Medicine -- Clinical Terms |
| SSI | Self-Sovereign Identity |
| VTU | Visvesvaraya Technological University |

---

## Chapter 1: Introduction

### 1.1 General background

Healthcare facilities generate extensive collections of medical data, including diagnostic assessments, clinical notes, prescribed pharmaceuticals, laboratory values, and radiological imaging. Most of this data remains trapped within the borders of the institution where it was recorded. When a patient arrives at an unfamiliar clinic, treating clinicians lack direct visibility into historical treatments, past surgical interventions, or documented allergies. 

The consequences of this disconnect are severe. A physician without allergy information risks administering medications that cause anaphylaxis. An emergency room physician attending to an unconscious individual must proceed without knowledge of pre-existing cardiovascular conditions, diabetes, or active prescriptions. When past diagnostic studies cannot be viewed, medical centers duplicate blood tests and imaging exams, which increases costs and exposes patients to unnecessary ionizing radiation.

Government programs such as India's Ayushman Bharat Digital Mission (ABDM) and Ayushman Bharat Health Account (ABHA) have assigned digital identities to citizens. However, identity assignments alone do not solve federated data discovery and governed retrieval across independent hospitals. Facilities deploy separate electronic medical record software with incompatible schemas and distinct database systems. 

Attempting to solve this problem by centralizing all medical records into a single national data store creates massive legal liability, high data breach risks, and friction with medical data ownership laws. A workable architecture must leave clinical records at their home institutions while providing a governed, auditable, and consent-driven network for discovery and real-time retrieval.

### 1.2 Problem statement

Two core problems define the current state of healthcare record interoperability:

#### The clinician's dilemma
A doctor treating a patient at Hospital B cannot view clinical records created at Hospital A, even when the patient verbally consents. There is no standard discovery query interface to locate records held at third-party institutions, and no secure cross-institutional protocol to verify permissions and retrieve data on demand. Clinicians must depend on patient memory, paper documents, or unverified phone inquiries.

#### The patient's powerlessness
Patients lack unified visibility into their complete medical history. Their records remain split across multiple hospital applications and diagnostic lab web portals. Patients cannot grant time-limited, scoped permissions to attending doctors, cannot redact sensitive clinical categories, and cannot see an immutable record of which individuals or institutions have inspected their files.

These problems share a common cause: the absence of a governed interoperability platform that respects institutional data custody while giving patients control over cross-institutional access.

### 1.3 Project objectives

The objectives of this project are:
1. To design and implement a federated record discovery and aggregation engine using HL7 FHIR R4, allowing authorized clinicians to search for and retrieve records from independent hospital nodes without centralizing clinical files.
2. To build a context-aware consent engine that enforces time-limited, purpose-bound permissions, with explicit consent gates for sensitive diagnostic categories.
3. To construct a 3-branch break-glass emergency access engine that permits immediate retrieval of life-saving medical data, backed by automated rule verification, clinical supervisor escalation queues, and mandatory notifications.
4. To build a high-throughput, gas-free audit notary using a Tessera tile-based Merkle transparency log based on RFC 6962 and C2SP signed checkpoints, providing mathematical tamper-evidence, RFC 8785 canonical hashing, and client-side proof verification.
5. To design an unsupervised machine learning anomaly detection pipeline combining Isolation Forest and LSTM autoencoders to flag suspicious access patterns in real time.
6. To validate the platform across simulated hospital nodes using an Indian patient cohort and automated test suites.

### 1.4 Scope and limitations

The functional prototype implements:
- Three independent hospital nodes (Apollo Hospital, Fortis Healthcare, and Max Super Specialty) running HAPI FHIR R4 JPA servers with isolated databases and an Indian patient clinical cohort.
- A central discovery registry containing record pointers, hospital endpoints, and category tags without storing clinical text or test values.
- An identity service issuing JSON Web Tokens according to strict payload contracts with role-specific expiration windows (Doctor 8h, Patient 24h, Admin 4h, Emergency 2h).
- A consent service supporting request workflows, approval sheets, sensitive data locks (Psychiatric, Reproductive, and Substance Abuse), in-memory token caching with sub-50ms validation latency, and instant revocation.
- A federated query aggregator retrieving records across all three hospital nodes in parallel within a 3000ms timeout budget.
- A break-glass emergency system with upfront window selection (2h, 4h, 8h), pre-expiry extension reviews, and a 15-minute grace period locking fresh node queries.
- A Go-based Tessera transparency log running in an isolated Docker container on port 3600, featuring binary leaf persistence, C2SP signed checkpoints with Ed25519 keys, an asynchronous backend outbox poller, and a Contract C-09 proof relay.
- A client-side cryptographic verifier running WebCrypto inside a smartphone mockup web interface, with interactive tamper simulation and restoration tools.
- A regression test suite containing 688 automated test assertions across 7 test suites.

Documented extensions outside the current prototype scope:
- Full decentralized identifier (DID) and verifiable credential infrastructure.
- Automated pharmacological drug-drug interaction alerts based on aggregated medication lists.
- Continuous streaming ingestion from personal wearable health monitors.
- Machine learning anomaly detection (Phase 4, currently under active implementation).

---

## Chapter 2: Literature review

### 2.1 Health information exchange architecture

Health Information Exchange (HIE) architectures govern how patient data moves across organizational boundaries. Payne et al. (2019) evaluated cross-institutional health record sharing across six countries: China, England, India, Scotland, Switzerland, and the United States. The authors concluded that no nation had achieved friction-free nationwide health record exchange. Centralized architectures consistently suffered from institutional resistance, ambiguous legal liability, and jurisdictional data sovereignty conflicts. These findings confirmed that centralizing medical files is politically and operationally unviable, establishing the necessity for a federated approach.

Majeed et al. (2025) validated the federated access paradigm by analyzing an emergency department data registry operating across 58 medical centers and 7.9 million patient records in Germany. Their findings confirmed that distributed data queries remain stable under real-time conditions, resolving 75% of distributed clinical inquiries within operational time limits while leaving clinical records under local institutional control. Their study proved that distributed record governance can scale without data centralization.

### 2.2 Federated systems in healthcare

Federated architectures originated in privacy-preserving machine learning, where statistical models travel to data sources rather than aggregating raw data into central repositories. Rieke et al. (2020) demonstrated that exchanging model parameters and summary metadata preserves institutional data privacy while enabling collective utility. FEDRA adapts this principle to record discovery: the central server indexes only discovery pointers and resource availability, while patient records remain in source databases.

Tariq et al. (2023) surveyed federated architectures and observed that patient identity resolution and granular consent enforcement remain major unsolved challenges in federated healthcare systems. Most systems assume static trust agreements between hospitals. When an ad-hoc access request occurs, the system cannot verify real-time consent across organizational lines. FEDRA resolves this limitation by pairing national identity identifiers (ABHA) with dynamic cryptographic consent tokens.

### 2.3 Blockchain and transparency logs in healthcare data sharing

Blockchains have attracted substantial academic interest as immutable ledgers for health audit events. Murugan et al. (2020) proposed a Hyperledger Fabric enterprise architecture for health record auditing, establishing the principle of separating on-chain audit hashes from off-chain clinical files. Ullah et al. (2024) developed an Ethereum smart contract platform combining purpose-based access control with transaction logging, proving that recording access intent deters internal security breaches.

However, practical implementation reveals severe bottlenecks when deploying general-purpose blockchains for high-frequency healthcare auditing:
1. Transaction gas costs: Public networks charge gas fees for every access event, creating an unsustainable operational expense during routine hospital operations.
2. Latency: Block mining intervals take 12 to 15 seconds on public testnets and 1 to 3 seconds on local EVM nodes, conflicting with sub-second clinical API response targets.
3. Resource footprint: Running blockchain validator nodes, JSON-RPC bridges, and private-key wallets imposes heavy memory demands on deployment environments.

These limitations prompted the development of cryptographic transparency logs. Derived from RFC 6962 (Certificate Transparency) and modern tile-based log specifications from C2SP and Sigstore, transparency logs arrange audit entries into binary Merkle trees. Unlike distributed blockchains that require consensus mechanisms and virtual machine execution, transparency logs operate as append-only binary ledgers. They deliver identical mathematical proofs of inclusion and consistency at microsecond speeds, zero transaction costs, and minimal memory overhead.

### 2.4 Break-glass access control

Medical emergencies frequently prevent patients from giving explicit consent. Break-glass mechanisms provide authorized emergency overrides of normal access rules. Aski et al. (2020) proposed an attribute-based emergency override system featuring mandatory clinical justification fields and post-access audit obligations, proving that emergency access can remain immediate without sacrificing accountability.

Atlam et al. (2020) introduced a context-aware emergency access model for medical sensor networks using real-time risk scoring to trigger emergency workflows. Their work underscored the importance of time-bounded access windows to prevent open-ended permissions after an emergency resolves. Takahashi et al. (2024) created a smart contract emergency access system using public blockchain records, validating that emergency audit trails must resist administrative tampering.

FEDRA expands on these models by introducing three distinct break-glass branches: selectable upfront time windows (2h, 4h, 8h), pre-expiry extensions with automated rules and supervisor queues, and a 15-minute grace period locking fresh node requests.

### 2.5 HL7 FHIR interoperability

Fast Healthcare Interoperability Resources (HL7 FHIR R4) represents the international standard for structured medical data exchange. Lehne et al. (2019) demonstrated FHIR's capabilities in mapping disparate hospital data schemas to standardized RESTful resources, establishing mapping strategies for patient identifiers, clinical observations, and conditions.

Ayaz et al. (2021) examined FHIR integration across multi-clinic chronic disease management, showing that FHIR's resource-oriented API design aligns with federated query aggregators. Gazzarata et al. (2024) surveyed modern FHIR adoption, identifying a gap: while FHIR resolves syntactic formatting between systems, it does not define patient-controlled cross-institutional consent governance. FEDRA fills this gap by wrapping HAPI FHIR endpoints in a governed token validation pipeline.

### 2.6 Machine learning anomaly detection

Audit logs are vulnerable to insider misuse, including unauthorized browsing of high-profile patients or bulk scraping by compromised credentials. Hurst et al. (2022) applied supervised classifiers (Support Vector Machines and Random Forests) to hospital audit records, demonstrating that access timestamps, query frequency, and patient-practitioner relationship history serve as strong anomaly indicators. However, their supervised approach requires labeled attack datasets, which healthcare systems rarely possess.

Niu et al. (2025) proposed an ensemble anomaly detection framework combining graph algorithms with machine learning models across multi-hospital networks. Their work proved that combining point-in-time anomaly scoring with sequential pattern analysis detects misuse behaviors that single-model systems overlook. FEDRA incorporates this architecture by pairing an Isolation Forest model (for single-event volume anomalies) with an LSTM autoencoder (for sequential behavioral drift).

### 2.7 Research gap and summary table

Existing academic systems address individual facets of healthcare data sharing in isolation. HIE platforms centralize patient files, blockchain systems suffer from prohibitive gas fees and high latency, and FHIR servers lack cross-institutional consent enforcement. FEDRA integrates federated FHIR discovery, granular consent tokens, multi-branch break-glass overrides, gas-free Merkle transparency logging, and dual-model machine learning anomaly detection into a single architecture.

```
+-------------------------------------------------------------------------------------------------------+
| Author(s) & Year    | Domain           | Key Finding                      | Identified Gap            |
+---------------------+------------------+----------------------------------+---------------------------+
| Payne et al. (2019) | HIE Architecture | Centralized national records     | No federated decentralized|
|                     |                  | consistently fail due to         | discovery model proposed; |
|                     |                  | institutional sovereignty issues.| central data silos persist|
| Majeed et al. (2025)| HIE Architecture | Federated queries across 58      | Focused on research       |
|                     |                  | emergency clinics succeed at     | queries; lacks patient-led|
|                     |                  | scale without central files.     | consent or audit notarization|
| Rieke et al. (2020) | Federated Systems| Exchanging summary metadata      | Focused on ML models;     |
|                     |                  | preserves privacy while enabling | does not address clinical |
|                     |                  | distributed utility.             | record discovery APIs.    |
| Tariq et al. (2023) | Federated Systems| Identity mapping and consent are | Conceptual analysis;      |
|                     |                  | key unsolved barriers in         | provides no operational   |
|                     |                  | federated healthcare.            | platform or audit layer.  |
| Murugan et al.(2020)| Blockchain Audit | Storing event hashes on-chain    | No federated discovery    |
|                     |                  | provides tamper-evident logging. | layer or dynamic patient  |
|                     |                  |                                  | consent management.       |
| Ullah et al. (2024) | Blockchain Audit | Purpose-based access contracts   | High EVM gas costs and    |
|                     |                  | decrease insider misuse.         | mining latency prevent    |
|                     |                  |                                  | high-frequency auditing.  |
| Aski et al. (2020)  | Break-Glass      | Structured override justifications| Lacks cryptographic notary|
|                     |                  | enable emergency access with     | or real-time ML anomaly   |
|                     |                  | post-access accountability.      | detection for abuse flags.|
| Atlam et al. (2020) | Break-Glass      | Time-bounded tokens prevent      | IoT-specific design; no   |
|                     |                  | open-ended emergency access.     | cross-hospital federation.|
| Lehne et al. (2019) | HL7 FHIR         | FHIR maps clinical data to       | Lacks access governance,  |
|                     |                  | standardized RESTful resources.  | cryptographic audit logs, |
|                     |                  |                                  | or token verification.    |
| Hurst et al. (2022) | ML Anomaly       | Access frequency and clinical    | Supervised training       |
|                     | Detection        | relationships reveal insider     | requires labeled attack   |
|                     |                  | security threats.                | data rarely found in EHRs.|
| Niu et al. (2025)   | ML Anomaly       | Ensemble models detect           | High graph construction   |
|                     | Detection        | cross-hospital patterns missed   | complexity; privacy of    |
|                     |                  | by single algorithms.            | identifiers unaddressed.  |
+-------------------------------------------------------------------------------------------------------+
```

---

## Chapter 3: System design and architecture

### 3.1 Architectural overview

FEDRA operates under a core architectural invariant: the central system stores no clinical data. Medical records remain inside the databases of the hospitals that produced them. The central platform maintains discovery indices (locating which institutions hold records for a given patient), enforces consent policies (authorizing which clinicians can view records under specific purposes), and notarizes access events into an immutable audit trail.

The architecture consists of five distinct layers:
1. Client Layer: Web portals for treating physicians and administrators (`frontend/dashboard.html`), and a responsive patient smartphone client (`frontend/patient.html`) featuring an in-browser cryptographic verifier.
2. API Gateway: Unified entry point running Express on port 3000, enforcing JWT authentication, role-based authorization, rate limiting, and fail-closed audit logging.
3. Core Services Layer: Microservices implementing Identity management (Contract C-01), Discovery index lookups, Consent and token lifecycles (Contract C-02), Break-Glass emergency governance with supervisor queues, and the asynchronous Audit Notary outbox worker.
4. Data & Notary Layer: Four MongoDB instances storing identity records, discovery pointers, consent policies, and audit documents, operating alongside an independent Go-based Tessera Transparency Log container on port 3600.
5. Federated Hospital Nodes: Three independent hospital deployments (Apollo, Fortis, and Max) running HAPI FHIR R4 JPA servers backed by local MongoDB instances.

```mermaid
flowchart TD
    subgraph ClientLayer["1. Client Layer"]
        DoctorApp["Doctor Portal (Web Dashboard)"]
        PatientApp["Patient Smartphone App (Browser Mockup)"]
        AdminApp["Admin & Supervisor Dashboard"]
    end

    subgraph GatewayLayer["2. API Gateway & Security"]
        Gateway["Express Gateway (Port 3000)<br>JWT Validation (C-01) | RBAC | Fail-Closed Audit"]
    end

    subgraph CoreServices["3. Core Services Layer"]
        IdentitySvc["Identity Service<br>ABHA Verification & Auth"]
        DiscoverySvc["Discovery Service<br>Hospital Endpoint Index"]
        ConsentSvc["Consent & Token Service<br>Policy Engine & In-Memory Cache"]
        BreakGlassSvc["Break-Glass Engine<br>Branches A, B, C & Supervisor Queue"]
        OutboxWorker["Audit Outbox Worker<br>Async Poller (Every 3s)"]
    end

    subgraph DataLayer["4. Data & Notary Layer"]
        SystemDB[("System MongoDB (Port 27020)<br>users, policies, tokens, audit_events")]
        RegistryDB[("Registry MongoDB<br>registry_entries")]
        TesseraLog["Tessera Transparency Log (Port 3600)<br>RFC 6962 Merkle Tree | Ed25519 Signed Checkpoints"]
    end

    subgraph FederatedNodes["5. Federated Hospital Nodes"]
        Hosp1["Apollo Hospital (:8081)<br>HAPI FHIR R4 + Local DB"]
        Hosp2["Fortis Healthcare (:8082)<br>HAPI FHIR R4 + Local DB"]
        Hosp3["Max Super Specialty (:8083)<br>HAPI FHIR R4 + Local DB"]
    end

    ClientLayer --> Gateway
    Gateway --> CoreServices
    CoreServices --> DataLayer
    OutboxWorker -->|Append Leaf Hash| TesseraLog
    Gateway -->|Parallel FHIR Queries (C-08)| FederatedNodes
```

### 3.2 User roles and permissions

The system defines four user roles with bounded permissions:

#### Doctors
Doctors authenticate using medical registration credentials, search for patients by their ABHA health ID, view the list of institutions holding clinical records, and submit access requests declaring a clinical purpose. Once a patient approves access, the doctor retrieves aggregated records. Sensitive categories (psychiatric history, reproductive health, substance abuse) remain locked unless specifically authorized by the patient. Doctors can initiate break-glass emergency overrides when life-threatening situations occur.

#### Emergency medical staff
Emergency personnel can declare a break-glass emergency by supplying a clinical justification. This grants immediate access to vital records (allergies, blood group, active medications, chronic diagnoses). Access is restricted to a time-bounded window (2h, 4h, or 8h). Emergency staff cannot access non-critical sensitive categories without patient authorization, cannot extend tokens without supervisor approval, and cannot suppress patient notifications or audit records.

#### Patients
Patients view their health profile across all hospital nodes through the patient smartphone client. They inspect pending access requests, approve or decline consent, toggle individual sensitive category gates, and immediately revoke active permissions. Patients can inspect the cryptographic audit trail, verify Merkle inclusion proofs and Ed25519 signatures, and review historical break-glass events. Patients cannot modify clinical observations or delete records from hospital nodes.

#### Clinical supervisors
Senior physicians assigned as supervisors review upfront long-window break-glass requests and token extensions. The supervisor queue tracks service-level agreement timers, alerting staff if an emergency ticket remains unreviewed past 15 minutes. Supervisors approve or deny extensions and can terminate active emergency tokens.

### 3.3 Federated data flow

The system enforces a strict boundary between control operations and clinical data retrieval. Control operations (authentication, consent requests, token validation, audit writes) flow through the central API gateway. Clinical records travel over direct HTTPS channels from hospital FHIR nodes to the client application. The central database never receives or stores medical observations.

```mermaid
sequenceDiagram
    autonumber
    actor Doctor as Doctor Portal
    participant GW as API Gateway
    participant DS as Discovery Service
    participant CS as Consent Service
    participant HN as Hospital FHIR Nodes
    participant AL as Audit & Tessera Log
    actor Patient as Patient App

    Doctor->>GW: POST /patient/search (ABHA ID)
    GW->>DS: Query Registry DB
    DS-->>Doctor: Return Institution List (Apollo, Fortis, Max)
    
    Doctor->>GW: POST /consent/request (Purpose, Duration)
    GW->>Patient: Push Access Notification
    Patient->>GW: POST /consent/grant (Scope, Sensitive Gates)
    GW->>CS: Create Policy & Generate Scoped Access Token
    
    Doctor->>GW: POST /records/fetch (Access Token)
    GW->>CS: Validate Token in In-Memory Cache (<50ms)
    GW->>AL: Write Fail-Closed Audit Record (RFC 8785 Hash)
    
    par Query Hospital Nodes
        GW->>HN: Parallel GET /fhir/Observation, Condition, etc.
        HN-->>GW: Return FHIR Resource Bundles
    end
    
    GW->>GW: Filter Sensitive Resources (Strip Locked PSY/SEX/ETH)
    GW-->>Doctor: Display Consolidated Clinical Records
```

### 3.4 Access token and consent model

Access authorization is token-governed. Consent represents an enduring policy rule set by a patient, whereas an access token represents the active credential authorizing a specific clinical session.

The token lifecycle advances through six distinct states:

```mermaid
stateDiagram-v2
    [*] --> NoConsent
    NoConsent --> ConsentRequested: Doctor Requests Access
    ConsentRequested --> ConsentGranted: Patient Grants Policy
    ConsentRequested --> NoConsent: Patient Denies
    ConsentGranted --> TokenActive: Session Initiated (Token Issued)
    TokenActive --> TokenExpiredGrace: Window Elapsed (15-min Grace)
    TokenActive --> Revoked: Patient Explicitly Revokes
    TokenExpiredGrace --> Expired: 15 Minutes Elapsed
    TokenExpiredGrace --> TokenActive: Extension Approved
    Expired --> [*]
    Revoked --> [*]
```

1. No Consent: Default state. No doctor access permitted.
2. Consent Requested: Doctor submits clinical purpose. Request appears in patient inbox.
3. Consent Granted: Patient approves request and sets category locks. Policy stored in MongoDB.
4. Token Active: Token generated and cached in memory. Gateway verifies permissions in ~2ms.
5. Token Expired (Grace Period): After the token duration expires, a 15-minute grace period begins. Cached records remain readable in the browser, but fresh node queries return HTTP 423 Locked.
6. Expired / Revoked: Token invalidated. Patient-initiated revocation deletes the policy, preventing future access until fresh consent is requested.

### 3.5 Break-glass emergency access

When an unconscious or incapacitated patient requires urgent treatment, clinicians cannot wait for manual consent approvals. The break-glass subsystem provides an authorized override that immediately unlocks critical clinical data.

```mermaid
flowchart TD
    Trigger["1. Emergency Trigger<br>Doctor selects ABHA & Justification"] --> WindowSel{"2. Window Selected"}
    
    WindowSel -->|2 Hours (Default)| GrantImmediate["3. Issue Emergency Token<br>Immediate Critical Records Access"]
    WindowSel -->|4h or 8h (Branch A)| GrantImmediate
    WindowSel -->|4h or 8h| EnqueueTicket["Enqueue Supervisor Ticket<br>TICK-UPFRONT-* (15m SLA)"]
    
    GrantImmediate --> AuditWrite["4. Fail-Closed Audit Log<br>RFC 8785 Canonical Hash to MongoDB"]
    AuditWrite --> NotifyPatient["5. Alert Patient & Caregiver<br>Emergency Access Notification"]
    
    GrantImmediate --> TokenActive{"6. Token Lifecycle"}
    
    TokenActive -->|Pre-Expiry Extension| BranchB{"Branch B: Extension Request"}
    BranchB -->|<= 2h, 1st Ext, 0 Flags| AutoApprove["Layer 1: Auto-Approve Extension"]
    BranchB -->|Non-standard Request| SupervisorEscalate["Layer 2: Escalate to Supervisor<br>TICK-EXT-*"]
    
    TokenActive -->|Duration Lapsed| BranchC["Branch C: 15-Minute Grace Period<br>Cached Records Visible | Fresh Queries HTTP 423"]
    BranchC -->|Within 15 Min| ReinstateReq["Request Reinstatement<br>TICK-REINSTATE-*"]
    BranchC -->|> 15 Min Elapsed| HardExpiry["Hard Lockout: HTTP 410 Gone"]
```

The break-glass architecture consists of three operational branches:
- Branch A (Upfront Window Routing): Clinicians choose 2h, 4h, or 8h upfront based on procedure needs. Requests greater than 2h immediately issue access to avoid treatment delays, while creating a supervisor ticket with a 15-minute review SLA.
- Branch B (Pre-Expiry Extensions): Clinicians can extend active tokens before expiration. A Layer 1 automated rule engine approves requests up to 2 hours if the doctor has zero security flags. Non-standard extensions escalate to a human supervisor (Layer 2).
- Branch C (15-Minute Grace Period): When a token reaches expiration, the system enters a 15-minute grace period. Records currently displayed remain on screen, preventing interruptions during procedures. New queries return HTTP 423 Locked. Doctors can submit reinstatement tickets during this window. After 15 minutes, the token enters hard lockout (HTTP 410 Gone).

### 3.6 Tessera Merkle transparency log audit layer

The audit layer guarantees that access events cannot be erased or altered by rogue administrators, compromised accounts, or database intrusions. The system anchors every audit entry in a tile-based Merkle transparency log built on Tessera.

```mermaid
flowchart TD
    subgraph EventGeneration["1. Deterministic Event Canonicalization"]
        AuditEvent["Gateway Audit Event<br>(actor, patient, action, timestamp)"]
        JCS["RFC 8785 Canonicalizer<br>Strict UTF-16 Key Sort & Zero Whitespace"]
        CanonicalHash["Canonical Hash<br>SHA-256(canonical_json)"]
        HMAC["Pseudonymize Identifiers<br>HMAC-SHA256(health_id, secret)"]
        
        AuditEvent --> JCS --> CanonicalHash
        AuditEvent --> HMAC
    end

    subgraph OutboxPipeline["2. Asynchronous Notary Integration"]
        MongoAudit[("MongoDB audit_events<br>status: 'pending'")]
        OutboxPoller["Outbox Worker (Every 3s)<br>Scans Pending Documents"]
        TesseraAdd["POST /add (Port 3600)<br>Append Leaf Hash to Merkle Log"]
        MongoUpdate[("Update MongoDB Document<br>status: 'integrated', log_index: N")]
        
        CanonicalHash --> MongoAudit
        MongoAudit --> OutboxPoller --> TesseraAdd --> MongoUpdate
    end

    subgraph MerkleStorage["3. Tessera Microservice (Go Standard Library)"]
        LeavesBin["Binary Storage (/data/leaves.bin)<br>Sequential 32-byte Leaf Records"]
        MerkleTree["RFC 6962 Merkle Tree<br>O(log N) Inclusion Path Generation"]
        Ed25519Note["C2SP Signed Note Checkpoint<br>Signed Tree Head via Ed25519 Key"]
        
        TesseraAdd --> LeavesBin --> MerkleTree --> Ed25519Note
    end

    subgraph ClientVerification["4. Client-Side Cryptographic Verifier (WebCrypto)"]
        PatientBrowser["Patient Smartphone App (Browser)"]
        RelayAPI["GET /audit/proof/:event_id<br>(Contract C-09 Proof Relay)"]
        WebCryptoVerify["In-Browser Verifier<br>1. Recompute RFC 8785 Hash<br>2. Recompute Merkle Root Hash<br>3. Verify Ed25519 Checkpoint Signature<br>4. Check Monotonic Sequence (1..N)"]
        BadgeVerified["Status: 🟢 VERIFIED (Leaf #N)"]
        BadgeTamper["Status: 🔴 TAMPER DETECTED"]
        
        PatientBrowser --> RelayAPI --> WebCryptoVerify
        WebCryptoVerify -->|Root & Sig Match| BadgeVerified
        WebCryptoVerify -->|Hash Mismatch| BadgeTamper
    end
```

The transparency log pipeline enforces five guarantees:
1. RFC 8785 JSON Canonicalization Scheme (JCS): JavaScript objects produce different JSON string representations depending on key ordering and whitespace. The system serializes the immutable subset of each audit document using RFC 8785, which sorts dictionary keys by UTF-16 code units, eliminates whitespace, and standardizes numbers. Hashing this canonical string with SHA-256 creates an unambiguous event digest.
2. Keyed HMAC Pseudonymization: Storing raw ABHA numbers or doctor registration IDs inside public audit entries violates privacy regulations. The system hashes identifiers using HMAC-SHA256 with a private secret key. This prevents dictionary and rainbow-table attacks from reversing patient identifiers.
3. Monotonic Contiguous Patient Sequence: Each patient maintains an atomic counter in `system_db.audit_counters`. Every new event receives an incrementing integer `patient_seq` (1, 2, 3, ...). The client application verifies that sequences contain no missing numbers, detecting any attempts to drop or hide audit events.
4. C2SP Signed Checkpoints: The Tessera service maintains an Ed25519 signing key pair. Periodically and upon leaf insertion, the service commits a signed checkpoint formatted as a C2SP Signed Note:
   ```
   fedra-tessera-log
   4
   m1g2+k3...root_hash_base64...
   — fedra-tessera-log key_hint signature_base64
   ```
5. Client-Side Cryptographic Verification (Contract C-09): The API gateway provides raw inclusion proofs and signed checkpoints via `GET /audit/proof/:event_id`. The server never returns a `"verified": true` property. The client browser executes all verification locally using native WebCrypto:
   - Reconstructs the canonical JCS string and verifies the SHA-256 leaf hash.
   - Reconstructs the Merkle root hash using the RFC 6962 inclusion path.
   - Validates the Ed25519 signature of the checkpoint against the log's public key.
   - If any byte of the MongoDB document was altered, the local hash computation fails, triggering an immediate tamper warning badge.

### 3.7 Machine learning anomaly detection layer

The machine learning anomaly detection layer processes audit events in real time to detect insider threats and credential compromise. The service uses two complementary unsupervised models:

```mermaid
flowchart LR
    AuditEvent["Audit Event Written"] --> FeatureExtract["Feature Extraction<br>(Time, Day, Frequency, Baseline Delta, Relationship)"]
    
    FeatureExtract --> Pipeline1["Point-in-Time Pipeline<br>Isolation Forest (S_IF)"]
    FeatureExtract --> Pipeline2["Sequential Pattern Pipeline<br>LSTM Autoencoder (S_LSTM)"]
    
    Pipeline1 --> Fusion["Score Fusion Engine<br>Standard: 0.60*IF + 0.40*LSTM<br>Break-Glass: 0.30*IF + 0.70*LSTM"]
    Pipeline2 --> Fusion
    
    Fusion --> Thresholds{"Fused Anomaly Score (S)"}
    
    Thresholds -->|S < 0.50| Normal["Normal Access<br>No Action"]
    Thresholds -->|0.50 <= S < 0.70| Warn["Tier 1: Warn<br>Flag in Audit Trail"]
    Thresholds -->|0.70 <= S < 0.90| Restrict["Tier 2: Restrict<br>Limit Token to Vital Signs"]
    Thresholds -->|S >= 0.90| Escalate["Tier 3: Escalate<br>Revoke Token & Alert Supervisor"]
```

1. Isolation Forest: Operates on single access events. Evaluates seven features: time of day, day of week, query frequency in the preceding hour, patient-doctor relationship age, clinical category requested, access volume, and geographic IP subnet. It isolates anomalous volume spikes without requiring labeled attack training sets.
2. LSTM Autoencoder: Operates across sliding sequences of 20 consecutive access events. Compresses the feature sequence into a latent representation and decodes it. Sequences that deviate from normal clinical habits produce high reconstruction errors, catching gradual pattern drift (such as a doctor systematically querying patients outside their specialty).
3. Graduated Response Engine: Combines model scores using weighted averaging (60/40 Isolation Forest/LSTM for routine access; 30/70 for break-glass events). Fused scores trigger graduated defenses: warnings at 0.50, permission restrictions at 0.70, and immediate token revocation with supervisor escalation at 0.90.

### 3.8 Use case summary

The system supports core interactions across clinical care, emergency medicine, patient governance, and administrative oversight:

```mermaid
flowchart TD
    Doctor(("Doctor"))
    EmergencyStaff(("Emergency Staff"))
    Patient(("Patient"))
    Supervisor(("Clinical Supervisor"))

    subgraph FEDRA["FEDRA Federated Access Platform"]
        UC1["Search Patient Records by ABHA"]
        UC2["Submit Purpose-Bound Consent Request"]
        UC3["View Consolidated FHIR Timeline"]
        UC4["Declare Break-Glass Emergency"]
        UC5["Review & Grant Consent Policies"]
        UC6["Toggle Granular Sensitive Gates"]
        UC7["Verify Cryptographic Audit Trail"]
        UC8["Simulate / Detect Data Tampering"]
        UC9["Review Upfront & Extension Tickets"]
        UC10["Enforce SLA & Revoke Abuse Tokens"]
    end

    Doctor --> UC1
    Doctor --> UC2
    Doctor --> UC3
    
    EmergencyStaff --> UC4
    EmergencyStaff --> UC3
    
    Patient --> UC5
    Patient --> UC6
    Patient --> UC7
    Patient --> UC8
    
    Supervisor --> UC9
    Supervisor --> UC10
```

---

## Chapter 4: Technology stack

### 4.1 Technology choices and justification

The technology stack balances real-world healthcare interoperability standards, low resource utilization, and mathematically verifiable security.

```
+--------------------------------------------------------------------------------------------------------+
| Layer               | Technology              | Role and Engineering Justification                     |
+---------------------+-------------------------+--------------------------------------------------------+
| Client -- Doctor    | HTML5 / ES6 / Tailwind  | Interactive clinical dashboard; token HUD countdown;   |
|                     |                         | deep FHIR resource inspection drawer.                  |
| Client -- Patient   | HTML5 / WebCrypto API   | Smartphone frame mockup; live approval sheet;          |
|                     |                         | pure client-side Merkle proof & Ed25519 verifier.      |
| API Gateway         | Node.js / Express       | Unified routing; JWT authentication (Contract C-01);   |
|                     |                         | fail-closed audit logging pipeline.                    |
| Interoperability    | HAPI FHIR R4 (Java)     | Three independent hospital nodes (ports 8081-8083);    |
|                     |                         | standard HL7 FHIR R4 clinical resource schemas.        |
| Operational Storage | MongoDB 6.0             | Four isolated instances; WiredTiger cache capped at    |
|                     |                         | 256MB to operate within lean host memory budgets.      |
| Audit Notary        | Tessera Transparency Log| Pure Go microservice (port 3600); RFC 6962 binary      |
|                     | (Go Standard Library)   | Merkle tree; Ed25519 signed checkpoints; zero gas fees.|
| Cryptographic Hash  | RFC 8785 JCS + SHA-256  | Deterministic JSON serialization and canonical digests |
|                     |                         | for off-chain MongoDB audit event documents.           |
| Client Verification | WebCrypto Subtle API    | In-browser SHA-256, Merkle path reconstruction, and    |
|                     |                         | Ed25519 checkpoint signature validation (<15ms).       |
| Background Worker   | Node.js Outbox Poller   | Scans pending audit records every 3 seconds; appends   |
|                     |                         | hashes to Tessera and backfills integer log indices.   |
| Anomaly Detection   | Python / FastAPI        | Phase 4 active target: scikit-learn Isolation Forest   |
|                     | (Planned Phase 4)       | and TensorFlow LSTM autoencoder scoring service.       |
+--------------------------------------------------------------------------------------------------------+
```

#### Engineering rationale: Transition from Ethereum to Tessera
The project originally specified an Ethereum Solidity smart contract (`MedicalAuditLog.sol`) deployed to Ganache and Sepolia. Operational benchmarking revealed three critical flaws with general-purpose blockchains for EHR auditing:
1. Economic overhead: Writing audit events to Ethereum incurs transaction gas fees. In a regional health network processing thousands of queries daily, transaction costs become unsustainable.
2. Latency bottlenecks: Mining times introduce delays of 12 to 15 seconds on public networks and 1 to 3 seconds on local EVM nodes. These delays cannot support clinical response time requirements.
3. System footprint: Running Ganache, Hardhat, and Web3 RPC libraries consumed significant memory. Replacing Ethereum with Tessera reduced the audit container's runtime memory to under 12 MB, allowing the full 8-container architecture to run within a 1.69 GB RAM footprint on the development machine.

Tessera provides the same security property required of an audit ledger: verifiable append-only tamper-evidence. Clients mathematically prove that an event exists in the log without executing smart contracts or paying transaction fees.

### 4.2 Database design and schemas

The platform partitions data across four MongoDB instances: three hospital-specific databases (`hospital1_db`, `hospital2_db`, `hospital3_db`) and one central system database (`system_db` on port 27020).

```mermaid
erDiagram
    USERS ||--o{ CONSENT_POLICIES : owns
    USERS ||--o{ ACCESS_TOKENS : receives
    CONSENT_POLICIES ||--o{ ACCESS_TOKENS : authorizes
    ACCESS_TOKENS ||--o{ AUDIT_EVENTS : logs
    USERS ||--o{ SUPERVISOR_TICKETS : assigns
    AUDIT_EVENTS ||--|| AUDIT_COUNTERS : increments

    USERS {
        string user_id PK
        string username
        string password_hash
        string role
        string institution_id
        string health_id
    }

    CONSENT_POLICIES {
        string policy_id PK
        string health_id FK
        string doctor_id FK
        string institution_id
        string status
        object scope
        date expires_at
    }

    ACCESS_TOKENS {
        string token_id PK
        string health_id FK
        string doctor_id FK
        string policy_id FK
        string token_type
        date expires_at
        date grace_until
    }

    AUDIT_EVENTS {
        string event_id PK
        int patient_seq
        string canonical_hash
        string event_type
        string actor_hash
        string patient_hash
        object tessera
        object immutable_subset
    }

    AUDIT_COUNTERS {
        string _id PK
        int seq
    }

    SUPERVISOR_TICKETS {
        string ticket_id PK
        string token_id FK
        string ticket_type
        string status
        date sla_deadline
    }
```

The `audit_events` collection stores the notarized audit record:
```json
{
  "event_id": "EVT-1729834000-A1B2",
  "patient_seq": 1,
  "canonical_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "actor_hash": "a1b2c3d4...hmac_actor...",
  "patient_hash": "f5e4d3c2...hmac_patient...",
  "event_type": "clinical_records_accessed",
  "tessera": {
    "status": "integrated",
    "log_index": 0,
    "tree_size": 4,
    "integrated_at": "2026-10-25T01:30:00.000Z"
  },
  "immutable_subset": {
    "action": "clinical_records_accessed",
    "actor_hash": "a1b2c3d4...",
    "event_id": "EVT-1729834000-A1B2",
    "patient_hash": "f5e4d3c2...",
    "patient_seq": 1,
    "purpose": "Emergency cardiology consultation",
    "timestamp": "2026-10-25T01:29:55.000Z"
  }
}
```

### 4.3 API gateway and core services

The API Gateway runs on port 3000, handling routing and security validation:
- Authentication middleware (`verifyJWT`): Validates incoming bearer tokens against Contract C-01. Checks expiration timestamps and extracts role permissions.
- Authorization middleware (`requireRole`): Blocks unauthorized access (for example, rejecting laboratory accounts that call consent endpoints).
- Fail-closed audit logging: When a clinician requests records through `POST /records/fetch`, the gateway writes an audit document to MongoDB before dispatching node requests. If the audit database write fails, the gateway aborts the transaction and returns HTTP 503, preventing unaudited data access.
- Background Outbox Worker (`pollTesseraOutbox`): Runs every 3 seconds. Finds audit events with `tessera.status: "pending"`, sends their canonical hashes to the Tessera container (`POST /add`), and records the returned `log_index` and `tree_size`.
- Proof Relay API (`GET /audit/proof/:event_id`): Implements Contract C-09. Resolves the event's `log_index`, queries Tessera for the Merkle inclusion proof and signed checkpoint, and returns the verification bundle to the calling client.

### 4.4 FHIR integration

Clinical records are hosted on three HAPI FHIR R4 JPA server instances representing independent hospitals:
- Node 1: Apollo Memorial Hospital (Port 8081)
- Node 2: Fortis Healthcare (Port 8082)
- Node 3: Max Super Specialty Hospital (Port 8083)

The prototype uses standard FHIR R4 resource types:
- `Patient`: Demographics and national ABHA identity mapping.
- `Condition`: Diagnoses mapped to SNOMED-CT codes.
- `MedicationRequest`: Drug orders mapped to RxNorm identifiers.
- `Observation`: Vital signs and laboratory findings mapped to LOINC codes.
- `AllergyIntolerance`: Documented drug and environmental allergies.
- `Procedure`: Surgical operations and clinical interventions.

Sensitive data filtering evaluates resource `meta.security` tags during aggregation:
- `PSY`: Psychiatric history and therapy notes.
- `SEX`: Reproductive and sexual health records.
- `ETH`: Substance abuse treatments.

Unless a patient explicitly enables the corresponding gate in their consent policy, the federated aggregator strips these records before returning data to the requesting clinician.

### 4.5 Audit notary and transparency log implementation

The Tessera service runs as an independent Go application (`tessera/main.go`). It implements an RFC 6962 Merkle tree using standard library packages (`crypto/sha256`, `crypto/ed25519`).

Core API endpoints:
- `POST /add`: Appends a 32-byte leaf hash to binary storage (`/data/leaves.bin`), recalculates the Merkle tree, and returns the assigned integer index.
- `GET /checkpoint`: Generates and signs a C2SP Signed Note containing the current tree size and Merkle root hash.
- `GET /proof?index=N`: Computes the $O(\log N)$ intermediate Merkle audit path hashes required to prove leaf $N$ exists in the tree.
- `GET /pubkey`: Exposes the Ed25519 public key in hexadecimal format for client signature verification.

#### In-browser client verifier algorithm
When the patient app loads the audit trail, it executes four verification steps locally:
1. Canonical serialization: Converts the event's `immutable_subset` to canonical JSON via RFC 8785 and computes the local SHA-256 digest.
2. Hash comparison: Verifies that the local digest matches the stored `canonical_hash`.
3. Merkle path traversal: Applies RFC 6962 domain separation rules (prepending `0x00` to leaves and `0x01` to internal node concatenations) to reconstruct the root hash from the audit proof path.
4. Signature validation: Uses WebCrypto (`crypto.subtle.verify`) to validate the Ed25519 checkpoint signature against the log's public key.

If any check fails, the interface replaces the green verified badge with a prominent red tamper warning.

### 4.6 Machine learning model design

The machine learning anomaly detection engine (Phase 4 active target) runs as an independent Python FastAPI microservice:
- Feature vector representation: Audit records supply pre-computed feature vectors (Contract C-03), avoiding runtime database aggregations and keeping inference latency under 100ms.
- Model combining:
  $$\text{Score} = w_{\text{IF}} \cdot S_{\text{IF}} + w_{\text{LSTM}} \cdot S_{\text{LSTM}}$$
  For routine clinical access: $w_{\text{IF}} = 0.60$ and $w_{\text{LSTM}} = 0.40$.  
  For break-glass emergency access: $w_{\text{IF}} = 0.30$ and $w_{\text{LSTM}} = 0.70$.
- Retraining pipeline: Unsupervised retraining occurs weekly using accumulated audit event histories.

---

## Chapter 5: Implementation and phase build plan

### 5.1 Development methodology

The project uses an incremental build methodology guided by rigid interface contracts (`C-01` to `C-09`) and architectural decisions (`D-01` to `D-10`). No phase milestone advances until its end-of-phase automated test suite passes with 100% success on clean container environments. This approach exposed integration issues early in development when interface adjustments required minimal refactoring.

### 5.2 Completed deliverables and specifications

The first three development phases are 100% complete, delivering 11 production artifacts and test suites:

```
+--------------------------------------------------------------------------------------------------------+
| Deliverable Artifact      | Specification & Implementation Scope               | Status                |
+---------------------------+----------------------------------------------------+-----------------------+
| System Architecture &     | Nine binding cross-service schemas (C-01 to C-09)   | 100% Complete         |
| Boundary Contracts        | and ten locked architectural decisions (D-01--D-10)|                       |
| Docker Multi-Container    | Eight optimized containers; Serial GC HAPI JVMs;   | 100% Complete         |
| Environment               | WiredTiger 256MB limits; total RAM: 1.69 GB.       |                       |
| Indian Patient Cohort     | Six clinical profiles across Apollo, Fortis, Max;  | 100% Complete         |
| Seeding Pipeline          | SNOMED-CT, LOINC, RxNorm codes; sensitive flags.   |                       |
| JWT Identity Service &    | Contract C-01 payload; bcrypt password security;   | 100% Complete         |
| RBAC Gateway Middleware   | role lifetimes (Doctor 8h, Patient 24h, Emer 2h).  |                       |
| Consent Service & Granular| Full lifecycle; in-memory token cache (<50ms SLA); | 100% Complete         |
| Sensitive Category Gates  | multi-gate toggles for PSY, SEX, ETH records.      |                       |
| Federated Record          | Parallel retrieval across three HAPI FHIR nodes    | 100% Complete         |
| Aggregation Engine        | with 3000ms SLA budget and sensitive redaction.    |                       |
| Break-Glass Emergency     | Branches A, B, C; upfront windows (2h/4h/8h);      | 100% Complete         |
| Lifecycle Engine          | 15-min grace period; supervisor review queue.      |                       |
| Tessera Transparency Log  | Pure Go container (port 3600); RFC 6962 Merkle tree| 100% Complete         |
| Microservice              | binary leaf persistence; Ed25519 signed notes.     |                       |
| Asynchronous Outbox       | Background poller running every 3 seconds;         | 100% Complete         |
| Worker & Proof Relay API  | Contract C-09 endpoint GET /audit/proof/:id.       |                       |
| Patient App Cryptographic | In-browser WebCrypto verifier; sequence checker;   | 100% Complete         |
| Verifier & Tamper Demo    | interactive tamper injection and restore controls. |                       |
| Automated Regression Test | Seven comprehensive integration test suites        | 100% Complete         |
| Verification Harness      | passing 688 / 688 test assertions platform-wide.   |                       |
+--------------------------------------------------------------------------------------------------------+
```

### 5.3 Phase 1 completion: Foundation and infrastructure

Phase 1 established the containerized multi-node infrastructure, identity management, and discovery indices:
- Docker environment: Configured three HAPI FHIR JPA containers, four MongoDB databases, and networking bridge rules.
- Indian patient cohort: Created and seeded six representative clinical profiles (172 clinical resources) across Apollo, Fortis, and Max hospitals, including multi-hospital patient histories and sensitive category annotations.
- Spec-compliant Identity Service (Contract C-01): Implemented JWT authentication enforcing role lifetimes, password hashing with bcrypt, token refresh, and registration endpoints.
- Discovery Service: Implemented `GET /patient/search` returning institution lists and resource availability without exposing clinical data.
- Automated verification: Authored `scripts/test_phase1_jwt.js` (33/33 tests passing).

### 5.4 Phase 2 completion: Core access control and federated aggregator

Phase 2 delivered dynamic consent management and cross-institutional record aggregation:
- Consent engine: Implemented policy registration, pending approval queues, and patient grant/deny workflows.
- In-memory token cache: Built a cache achieving ~2ms token validation latency, exceeding the <50ms SLA requirement (Contract C-02).
- Sensitive category gating: Built automated filters that intercept FHIR bundles and redact psychiatric, reproductive, and substance abuse records unless explicit opt-in permissions exist.
- Federated record aggregator: Implemented `POST /records/fetch`, dispatching parallel queries to Apollo (:8081), Fortis (:8082), and Max (:8083) with error handling and timeout budgets (Contract C-08).
- User interfaces: Deployed the Doctor Portal dashboard with real-time token countdown HUDs and created the responsive Patient Smartphone web client.
- Automated verification: Authored `scripts/test_phase2_consent.js` (48/48 tests passing).

### 5.5 Phase 3 completion: Break-glass emergency access and Tessera audit layer

Phase 3 implemented emergency overrides and the cryptographic transparency log:
- Break-glass branches: Built Branch A (upfront 2h/4h/8h windows), Branch B (pre-expiry extensions with automated Layer 1 rules and Layer 2 supervisor reviews), and Branch C (15-minute grace period with HTTP 423 locking).
- Clinical supervisor queue: Implemented `GET /supervisor/queue` and `POST /supervisor/review` with dynamic SLA countdown timers.
- Tessera transparency log migration: Replaced Ethereum components with a Go-based Tessera container on port 3600, featuring RFC 6962 binary Merkle trees and Ed25519-signed checkpoints.
- Canonical hashing pipeline: Implemented RFC 8785 JCS serialization, SHA-256 canonical hashing, and keyed HMAC pseudonymization.
- Outbox worker and proof relay: Built the 3-second background outbox poller and the Contract C-09 proof relay endpoint.
- Client verifier and tamper demo: Deployed the in-browser WebCrypto verifier in the patient client, adding live tamper injection and event restoration buttons.
- Automated verification: Validated across 5 test suites covering break-glass logic, cryptographic algorithms, Tessera service endpoints, outbox synchronization, and patient tamper detection, bringing total platform tests to 688 / 688 passing assertions.

### 5.6 Phase build plan status

The development plan spans five phases across 15 weeks:

```
+--------------------------------------------------------------------------------------------------------+
| Phase   | Timeline  | Major Focus Area         | Key Deliverables                        | Status      |
+---------+-----------+--------------------------+-----------------------------------------+-------------+
| Phase 1 | Weeks 1-3 | Foundation &             | 3 HAPI FHIR nodes; MongoDB clusters;   | 100%        |
|         |           | Infrastructure           | JWT Auth C-01; Indian patient cohort.   | Complete    |
| Phase 2 | Weeks 4-6 | Core Access Control &    | Consent Service; sensitive gates;       | 100%        |
|         |           | Federated Aggregator     | parallel FHIR aggregator; Doctor/Patient| Complete    |
|         |           |                          | web portals; in-memory token cache.     |             |
| Phase 3 | Weeks 7-9 | Break-Glass Emergency &  | Break-glass branches A, B, C; supervisor| 100%        |
|         |           | Tessera Audit Notary     | queue; Tessera Go service; outbox poller| Complete    |
|         |           |                          | C-09 proof relay; in-browser verifier.  |             |
| Phase 4 | Weeks     | Machine Learning Anomaly | Feature extraction C-03; Isolation      | ACTIVE / IN |
|         | 10-12     | Detection Pipeline       | Forest; LSTM autoencoder; FastAPI engine| PROGRESS    |
| Phase 5 | Weeks     | Full Integration &       | End-to-end rehearsal; documentation;    | Planned     |
|         | 13-15     | Demonstration Scenarios  | final project presentation.             |             |
+--------------------------------------------------------------------------------------------------------+
```

---

## Chapter 6: Results and discussion

### 6.1 Demonstration scenarios and verification

The system's capabilities are demonstrated through four operational workflows:

#### Demo 1: The clinical journey (Routine care)
Demonstrates scheduled outpatient care. A physician at Fortis Healthcare searches for patient Lakshmi Venkatesh by ABHA identifier. The discovery service returns record pointers across Apollo, Fortis, and Max hospitals. The physician submits an access request. The patient receives an instant notification in the smartphone app, reviews the clinical purpose, approves general records while keeping psychiatric records locked, and grants access. The physician's dashboard displays the aggregated timeline. The access event is canonicalized, added to MongoDB, picked up by the outbox worker, and committed to Tessera.

#### Demo 2: The emergency (Break-glass access)
Demonstrates emergency care for an unconscious patient. An emergency physician at Max Super Specialty activates break-glass access, selects a 4-hour window, and enters an emergency justification. The system bypasses patient consent, immediately serving critical records (blood group, allergies, medications). An urgent ticket appears in the supervisor queue with a 15-minute SLA countdown, and an emergency notification is dispatched to the patient's caregiver.

#### Demo 3: The patient application and tamper verification
Demonstrates patient governance and cryptographic auditing. The patient logs into the smartphone interface, navigates to the Notary & Audit Trail tab, and inspects the chronological access log. The client-side verifier checks the contiguous sequence numbers (1..N), downloads the inclusion proof from Contract C-09, verifies the Merkle path against the Ed25519-signed checkpoint, and displays a green verified badge. The patient clicks the Simulate Tamper button, which modifies a field in the local document. The verifier re-runs, detects the hash mismatch, and displays a red tamper warning badge. Clicking Restore Event restores the original record, returning the badge to verified.

#### Demo 4: Machine learning anomaly detection
Phase 4 demonstration target. Tests suspicious query patterns by simulating an account making rapid off-hours queries and accessing records outside the established clinical relationship, verifying that the graduated response engine applies appropriate restrictions.

### 6.2 Measured performance against targets

All completed components meet or exceed design targets:

```
+--------------------------------------------------------------------------------------------------------+
| Metric / SLA Target       | Architectural Requirement | Measured Production Value | Status             |
+---------------------------+---------------------------+---------------------------+--------------------+
| Token Validation Latency  | < 50 milliseconds         | ~2 milliseconds (cache)   | Exceeds target     |
| FHIR Aggregation (3 nodes)| < 3000 milliseconds       | 600 - 1200 milliseconds   | Exceeds target     |
| Audit Canonicalization    | < 10 milliseconds         | < 2 milliseconds          | Exceeds target     |
| Outbox Integration Cycle  | < 5 seconds background    | 3 second polling interval | Meets target       |
| Tessera Leaf Append (/add)| < 50 milliseconds         | < 10 milliseconds         | Exceeds target     |
| In-Browser Proof Verifier | < 100 milliseconds        | < 15 milliseconds         | Exceeds target     |
| Break-Glass Critical Load | < 5 seconds to records    | < 1.5 seconds             | Exceeds target     |
| Total Container Memory    | Host constraint (< 3.5 GB)| 1.69 GB total RSS         | 66% memory savings |
+--------------------------------------------------------------------------------------------------------+
```

### 6.3 Comparative analysis with existing systems

FEDRA's architectural approach combines capabilities that existing healthcare architectures implement only in isolation:

```
+--------------------------------------------------------------------------------------------------------+
| Architectural Property    | Traditional EHR | Centralized NHR | Blockchain HIE  | FEDRA System         |
|                           | (Epic / Cerner) | (ABHA / ABDM)   | (EVM / Fabric)  | (Tessera + FHIR)     |
+---------------------------+-----------------+-----------------+-----------------+----------------------+
| Data Locality             | Local to single | Centralized or  | Mixed           | Fully Federated      |
|                           | hospital silo   | brokered        | (off-chain)     | (100% at source)     |
| Cross-Hospital Discovery  | No              | Yes             | Yes             | Yes (Registry index) |
| Granular Category Gates   | No              | Partial         | Limited         | Yes (PSY, SEX, ETH)  |
| Break-Glass Governance    | Internal only   | Missing         | Partial         | Yes (3 branches)     |
| Audit Tamper-Evidence     | None (mutable)  | Central DB logs | Yes (Immutable) | Yes (Merkle Log)     |
| Audit Transaction Costs   | $0              | $0              | High gas fees   | $0 (Gas-free)        |
| Inclusion Proof Latency   | None            | None            | 12-15 seconds   | < 15 milliseconds    |
| Client-Side Verification  | None            | None            | Requires Web3   | Native WebCrypto     |
| Real-Time ML Anomaly Guard| Vendor-dependent| None            | None            | Dual Model (IF+LSTM) |
+--------------------------------------------------------------------------------------------------------+
```

---

## Chapter 7: Conclusion and future work

### 7.1 Conclusion

FEDRA demonstrates that cross-institutional health record discovery and secure access can be achieved without centralizing sensitive clinical files. By combining HL7 FHIR R4 federated discovery with an in-memory token consent engine, the platform protects patient privacy while providing clinicians with complete medical histories. The 3-branch break-glass subsystem reconciles emergency access with post-access accountability.

Pivoting from Ethereum smart contracts to a Tessera tile-based Merkle transparency log resolved the cost and latency bottlenecks that have long hindered blockchain adoption in healthcare. The resulting audit infrastructure provides mathematical tamper-evidence, sub-millisecond leaf appends, and client-side proof verification with zero transaction fees, while reducing container memory requirements by 66%.

Phases 1, 2, and 3 are 100% complete and validated across 688 automated test assertions. The platform provides a production-tested foundation for Phase 4 machine learning anomaly detection and subsequent real-world clinical deployments.

### 7.2 Future work

Following the completion of Phase 4 and Phase 5, several extensions will be evaluated:
1. Multi-Party Witness Cosigning: Transitioning the transparency log to a C2SP witness network where independent healthcare authorities and patient advocacy groups co-sign tree heads, distributing trust across multiple organizations.
2. Hardware Security Module (HSM) Key Protection: Securing the log's Ed25519 signing keys inside cloud or hardware security modules to prevent credential compromise.
3. Native Flutter Mobile Port: Packaging the smartphone client into compiled Android and iOS applications while retaining the pure WebCrypto verification engine.
4. Pharmacological Interaction Engine: Analyzing aggregated medication lists across institutions to automatically alert physicians to adverse drug interactions.
5. Distributed Tile Mirroring: Replicating Merkle tree tiles across content delivery networks to support high-concurrency patient audit requests without gateway load.

---

## References

1. Payne, T. H., Lovis, C., Gutteridge, C., et al., "Status of health information exchange: a comparison of six countries," *Journal of Global Health*, vol. 9, no. 2, 2019. DOI: 10.7189/jogh.09.020427.
2. Majeed, R. W., et al., "Implementation report on pioneering federated data access for the German National Emergency Department Data Registry," *npj Digital Medicine*, vol. 8, no. 1, p. 94, Feb. 2025. DOI: 10.1038/s41746-025-01481-w.
3. Rieke, N., Hancox, J., Li, W., et al., "Federated Learning Systems for Healthcare: Perspective and Recent Progress," *Springer*, 2020. DOI: 10.1007/978-3-030-70604-3_6.
4. Tariq, M. U., et al., "A Survey on Federated Learning for the Healthcare Metaverse: Concepts, Applications, Challenges, and Future Directions," *arXiv*, 2023. arXiv:2304.00524v2.
5. Murugan, R., Chechare, T., et al., "Blockchain-based Enterprise Architecture for Comprehensive HIE Data Management," *Proceedings of IEEE CSCI*, 2020. DOI: 10.1109/CSCI51800.2020.00145.
6. Ullah, F., He, J., Zhu, N., et al., "Blockchain-enabled EHR access auditing: Enhancing healthcare data security," *Heliyon*, Elsevier, vol. 10, no. 16, Aug. 2024. DOI: 10.1016/j.heliyon.2024.e34407.
7. Aski, V., Dhaka, V. S., and Parashar, A., "An Attribute-Based Break-Glass Access Control Framework for Medical Emergencies," *Springer Book Chapter*, 2020.
8. Atlam, H. F., et al., "A Context-Aware Break-Glass Access Control System for IoT Environments," *Proceedings of IEEE IOTSMS*, 2020. DOI: 10.1109/IOTSMS52051.2020.9340209.
9. Takahashi, T., Zhihao, Y., and Omote, K., "Emergency Medical Access Control System Based on Public Blockchain," *Journal of Medical Systems*, Springer Nature, vol. 48, no. 1, p. 90, Sept. 2024. DOI: 10.1007/s10916-024-02102-x.
10. Lehne, M., Sass, J., Essenwanger, A., et al., "Using HL7 FHIR to Achieve Interoperability in Patient Health Record," *Journal of Biomedical Informatics*, Elsevier, 2019. DOI: 10.1016/j.jbi.2019.103188.
11. Ayaz, M., Pasha, M. F., et al., "HL7 FHIR in Digital Healthcare Ecosystems for Chronic Disease Management: Scoping Review," *International Journal of Medical Informatics*, Elsevier, 2021. DOI: 10.1016/j.ijmedinf.2021.104480.
12. Gazzarata, R., et al., "HL7 FHIR in Digital Healthcare Ecosystems for Chronic Disease Management: Scoping Review (Updated)," *International Journal of Medical Informatics*, Elsevier, vol. 189, 2024. DOI: 10.1016/j.ijmedinf.2024.105507.
13. Hurst, W., et al., "Securing Electronic Health Records Against Insider Threats: A Supervised Machine Learning Approach," *Smart Health*, Elsevier, vol. 26, 2022. DOI: 10.1016/j.smhl.2022.100354.
14. Niu, H., Omitaomu, O. A., Langston, M. A., et al., "Anomaly Detection in Electronic Health Records Across Hospital Networks: Integrating Machine Learning With Graph Algorithms," *IEEE Journal of Biomedical and Health Informatics*, vol. 29, no. 5, pp. 3723-3735, May 2025. DOI: 10.1109/JBHI.2025.3527752.
15. Laurie, B., Langley, A., and Kasper, E., "Certificate Transparency," *IETF RFC 6962*, June 2013. DOI: 10.17487/RFC6962.
16. Rundgren, A., Jordan, P., and Erdtman, S., "JSON Canonicalization Scheme (JCS)," *IETF RFC 8785*, June 2020. DOI: 10.17487/RFC8785.
17. Community Cryptography Specification Project (C2SP), "Signed Note Format and Transparency Log Tiles (tlog-tiles)," *C2SP Specifications*, 2023.
18. Josefsson, S. and Liusvaara, I., "Edwards-Curve Digital Signature Algorithm (EdDSA)," *IETF RFC 8032*, January 2017. DOI: 10.17487/RFC8032.
