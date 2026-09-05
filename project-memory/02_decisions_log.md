# Architectural Decisions Log

All architectural decisions in this document are **LOCKED** based on specifications in `docs/`.
They cannot be modified or bypassed without explicit team consensus.

---

## Decision Index

| ID | Title | Source | Status |
|---|---|---|---|
| `D-01` | Asynchronous Blockchain Logging | `docs/00`, `docs/02` | **LOCKED** |
| `D-02` | Pseudonymous Hashed Identifiers On-Chain | `docs/02` | **LOCKED** |
| `D-03` | Off-Chain Data in MongoDB, Proofs On-Chain | `docs/01`, `docs/02` | **LOCKED** |
| `D-04` | Deterministic Ganache Mnemonic for Development | `docs/02`, `docs/03` | **LOCKED** |
| `D-05` | Dual-Model Anomaly Detection (IF + LSTM) | `docs/04` | **LOCKED** |
| `D-06` | Three-Tier Graduated Response Framework | `docs/04` | **LOCKED** |
| `D-07` | 15-Minute Break-Glass Grace Period & Extension Chains | `docs/00`, `docs/02` | **LOCKED** |
| `D-08` | Pre-Computed ML Features in MongoDB `audit_events` | `docs/01`, `docs/04` | **LOCKED** |
| `D-09` | Zero Direct Hospital-to-Hospital Communication | `docs/00` | **LOCKED** |

---

## Detailed Decisions

### `D-01`: Asynchronous Blockchain Logging
- **Decision:** The Audit Service logs events to the Ethereum smart contract asynchronously via a background task/queue. It never blocks the clinical HTTP response loop.
- **Why:** On-chain mining latency (even 1–3s locally, ~12s on testnet) would degrade doctor clinical workflows and breach the <50ms token/search SLA.
- **Source:** `docs/02_smart_contract.md §Design Decisions`, `docs/project_build_phases.md §Risks`
- **What would reopen it:** A hard regulatory compliance mandate requiring synchronous receipt proof before clinical data display.

### `D-02`: Pseudonymous Hashed Identifiers On-Chain
- **Decision:** All actor IDs (`keccak256(actor.id)`) and patient IDs (`keccak256(health_id)`) are stored strictly as 32-byte hashes on-chain. No raw identifiers or plain-text health information are ever written to the smart contract.
- **Why:** Public/consortium blockchains are permanent and transparent; raw health or practitioner IDs violate HIPAA and GDPR privacy principles.
- **Source:** `docs/02_smart_contract.md §Why Actor and Patient IDs Are Hashed`
- **What would reopen it:** Migration to a zero-knowledge proof circuit (e.g. zk-SNARKs) where proof of validity replaces hash mapping.

### `D-03`: Off-Chain Data in MongoDB, Proofs On-Chain
- **Decision:** MongoDB (`audit_events`) stores the complete human-readable document. The blockchain stores only `metadataHash = keccak256(JSON.stringify(mongoDocument))`, serving strictly as an immutable notary stamp.
- **Why:** High gas costs, storage limits, and search inability on EVM make full clinical event storage infeasible on-chain.
- **Source:** `docs/02_smart_contract.md §What Goes On-Chain vs Off-Chain`
- **What would reopen it:** Decentralized IPFS content-addressed storage integration replacing MongoDB.

### `D-04`: Deterministic Ganache Mnemonic for Development
- **Decision:** Ganache must run using a fixed 12-word mnemonic (`myth like bonus scare over problem client lizard pioneer submit female collect`) with fixed port `8545` and Network ID `5777`.
- **Why:** Ensures contract addresses, deployer wallets, and demo actor balances remain constant across all 4 team members' machines and automated test scripts.
- **Source:** `docs/02_smart_contract.md`, `docs/03_docker_environment.md`
- **What would reopen it:** Deployment to Sepolia/Polygon testnets for pre-production testing.

### `D-05`: Dual-Model Anomaly Detection (IF + LSTM)
- **Decision:** Use Isolation Forest for point-in-time volume anomalies (unsupervised, no labeled misuse required) and LSTM Autoencoder for sequential break-glass misuse patterns across 20-event rolling windows.
- **Why:** Single models fail on hybrid threats: Isolation Forest cannot evaluate temporal sequences; LSTM suffers from cold-start and excessive inference complexity on simple volume spikes.
- **Source:** `docs/04_ml_model_design.md §The Two Detection Problems`
- **What would reopen it:** Benchmarks showing a unified Graph Neural Network (GNN) achieves lower latency and superior detection.

### `D-06`: Three-Tier Graduated Response Framework
- **Decision:** Score thresholds are fixed at 0.5 (Warn), 0.7 (Restrict permissions to vital signs only), and 0.9 (Escalate / Revoke active token and alert supervisor).
- **Why:** Prevents binary "allow or crash" disruptions in critical medical environments where false positives could halt urgent patient care.
- **Source:** `docs/04_ml_model_design.md §Threshold Calibration`
- **What would reopen it:** Clinical feedback requiring specialty-specific thresholds (e.g., higher tolerances in Emergency departments).

### `D-07`: 15-Minute Break-Glass Grace Period & Extension Chains
- **Decision:** When a 2-hour break-glass emergency token expires, a 15-minute grace period initiates where doctors can request a 1-hour extension. Every extension must link back to the originating event via `linked_event_id` forming an on-chain audit chain.
- **Why:** Emergency operations or surgeries cannot have hard lockouts mid-procedure, but all extensions must be accountable and linked.
- **Source:** `docs/00_system_architecture.md`, `docs/02_smart_contract.md`
- **What would reopen it:** Institutional policy capping emergency access at an absolute fixed duration with zero extensions.

### `D-08`: Pre-Computed ML Features in MongoDB `audit_events`
- **Decision:** Feature engineering values (e.g. `records_accessed_last_hour`, `deviation_from_baseline`) are calculated and written into `audit_events.ml_features` at write time.
- **Why:** Real-time ML inference scoring must complete in <100ms. Computing historical aggregations across thousands of rows at scoring time violates this SLA.
- **Source:** `docs/01_database_schema.md §audit_events`, `docs/04_ml_model_design.md`
- **What would reopen it:** A streaming Redis cache infrastructure maintaining real-time rolling counters outside MongoDB.

### `D-09`: Zero Direct Hospital-to-Hospital Communication
- **Decision:** Hospital nodes never speak directly to one another. All discovery, consent token validation, and record aggregation are coordinated through the centralized API Gateway and Consent Service.
- **Why:** Peer-to-peer hospital meshes require $O(N^2)$ firewalls, dynamic TLS peering, and complex distributed trust; the federated gateway architecture provides centralized policy enforcement with decentralized record storage.
- **Source:** `docs/00_system_architecture.md §System Architecture`
- **What would reopen it:** Architecture pivot to pure peer-to-peer decentralized networks.
