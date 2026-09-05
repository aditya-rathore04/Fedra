# Known Pitfalls and Technical Quirks

A compilation of critical failure modes, non-obvious runtime behaviors, and proven workarounds across the Fedra stack.

---

## 1. HAPI FHIR Slow Startup Latency
- **Symptom:** Scripts or backend fail with `ECONNREFUSED` immediately after `docker compose up -d`.
- **Cause:** HAPI FHIR containers are Java Spring Boot applications that take 25–45 seconds to initialize H2/JPA stores and generate their `CapabilityStatement`.
- **Mitigation:** Always poll `http://localhost:808X/fhir/metadata` with retries before running seeding or ingestion scripts (as implemented in `scripts/seed_and_load.js:waitForFhir`).

## 2. Docker Container Networking vs Host Localhost
- **Symptom:** Backend services running inside containers cannot connect to `localhost:8081` or `localhost:27020`.
- **Cause:** `localhost` inside a Docker container refers to that container itself, not the host.
- **Rule:**
  - When backend runs on the **host machine** (e.g. `node backend/index.js`): connect via host ports (`localhost:8081`, `localhost:27020`).
  - When backend runs **in Docker**: connect via service names on network `mednet` (`http://hospital1-fhir:8080/fhir`, `mongodb://system-mongo:27017`).
  - The registry schema intentionally stores both `fhir_endpoint` (internal container URL) and `public_fhir_endpoint` (host-accessible URL).

## 3. Deterministic Ganache Mnemonic Requirement
- **Symptom:** Smart contract deployed in one session cannot be reached or authorized in another session; address mismatches occur.
- **Cause:** Launching Ganache without a fixed mnemonic generates random accounts on every restart.
- **Rule:** Ganache must always use the fixed 12-word seed phrase:
  `myth like bonus scare over problem client lizard pioneer submit female collect`
  Contract deployment address must match across backend Hardhat config and frontend web3 providers.

## 4. Multi-Database MongoDB Connection Pooling
- **Symptom:** `MongoServerSelectionError: connection pool exhausted` during concurrent federated searches.
- **Cause:** The system uses 4 distinct MongoDB instances (3 hospital DBs + 1 central registry). Creating new `MongoClient` instances per request rapidly exhausts sockets.
- **Rule:** Maintain single, persistent client instances per target URI with connection pool size capped (e.g. `maxPoolSize: 20`).

## 5. LSTM Cold-Start Problem (<20 Events)
- **Symptom:** ML Service throws tensor dimension errors or outputs erratic anomaly scores for new doctors.
- **Cause:** The LSTM Autoencoder requires a sequence of 20 historical events to form an inference window matrix $\mathbb{R}^{20 \times 12}$.
- **Rule (C-06):** If an actor has fewer than 20 recorded events in `audit_events`, the pipeline must gracefully fall back to 100% Isolation Forest scoring ($w_{\text{IF}} = 1.0, w_{\text{LSTM}} = 0.0$) until the 20-event threshold is reached.

## 6. On-Chain Tamper Verification Hash Discrepancy
- **Symptom:** Verifying an unmodified MongoDB document against on-chain `metadataHash` fails with a hash mismatch.
- **Cause:** Standard `JSON.stringify(doc)` does not guarantee key ordering across platforms or language runtimes (e.g. Python vs Node.js vs Solidity).
- **Rule (C-05):** Always use a canonical JSON serializer that alphabetizes keys before computing `keccak256`. Do not include Mongo internal fields like `_id` or volatile timestamps unless explicitly part of the signed payload.

## 7. Mobile Push Notification Sandbox Limitations
- **Symptom:** Patient app fails to receive consent requests during local evaluation.
- **Cause:** Google APNs / FCM push notifications require external internet egress and valid developer certificates that may not be available during offline campus evaluations.
- **Rule:** Implement an in-app polling or WebSocket fallback banner in the Flutter app so demos function 100% reliably in offline local networks.
