# FEDRA — Tessera Transparency Log Notary Service

The **Tessera Transparency Log** is a lightweight, tamper-evident cryptographic audit notary based on RFC 6962 Merkle trees and C2SP Signed Note checkpoints.

---

## 🏛️ Architectural Context
- **Role:** High-throughput, gas-free transparency log superseding the reference Ethereum smart contract notary (Decision `D-10`).
- **Port:** `3500`
- **Origin:** `fedra.audit.log`
- **Storage:** Append-only binary Merkle leaf storage (`/data/leaves.bin`) with Ed25519 signing key persistence (`/data/ed25519.priv`).
- **Memory Limit:** `128 MB` (enforced via `docker-compose.yml`).

---

## 🔌 API Endpoints

### 1. `POST /add`
Appends a 32-byte canonical leaf hash (`canonical_hash = sha256(JCS(immutable_subset))`) into the Merkle tree.
- **Request:**
  ```json
  {
    "leaf_hash": "a3f5e1b2c4d6..."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "log_index": 0,
    "tree_size": 1,
    "root_hash": "5d2e3f...",
    "canonical_hash": "a3f5e1b2c4d6..."
  }
  ```

### 2. `GET /checkpoint`
Retrieves the latest cryptographic checkpoint signed by the log's Ed25519 private key.
- **Query params:** `?format=json` (optional)
- **Response (C2SP Signed Note format):**
  ```
  fedra.audit.log
  1
  XS4/m...

  — fedra.audit.log u3K9...
  ```

### 3. `GET /proof?index=N`
Computes and returns the RFC 6962 Merkle inclusion proof for leaf index `N`.
- **Response (200 OK):**
  ```json
  {
    "leaf_index": 0,
    "tree_size": 1,
    "leaf_hash": "a3f5e1b2c4d6...",
    "root_hash": "5d2e3f...",
    "inclusion_proof": [ ... ],
    "checkpoint": "fedra.audit.log\n1\n...",
    "origin": "fedra.audit.log",
    "public_key_hex": "..."
  }
  ```

### 4. `GET /health`
Returns service status, current tree size, and origin.
- **Response (200 OK):**
  ```json
  {
    "status": "healthy",
    "tree_size": 1,
    "origin": "fedra.audit.log",
    "public_key": "..."
  }
  ```
