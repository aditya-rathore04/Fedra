# Smart Contract
## MedicalAuditLog.sol — Ethereum Blockchain Audit Layer

> **File:** `02_smart_contract.md`
> **Status:** Written — ready for deployment
> **Network:** Ganache (local) → Sepolia testnet (pre-production)
> **Language:** Solidity ^0.8.19
> **Tooling:** Hardhat

---

## Design Decisions

### What Goes On-Chain vs Off-Chain

| On-Chain | Off-Chain (MongoDB `audit_events`) |
|---|---|
| Cryptographic proof an event happened | Full human-readable record |
| Hashed actor ID, hashed patient ID | Raw actor ID, patient health ID |
| Event type string | Full metadata, justification text, categories |
| Linked event ID for chain reconstruction | Token ID, institution details |
| `metadataHash` — keccak256 of MongoDB document | The document itself |
| Block timestamp | ISODate timestamp |

**The blockchain is the notary stamp. MongoDB is the filing cabinet.**

Tamper detection works by re-hashing the MongoDB document and comparing against the stored `metadataHash` on-chain. If someone modified the MongoDB record, the hashes will not match.

### Why Actor and Patient IDs Are Hashed

Storing raw health IDs or doctor IDs on a public or semi-public blockchain is a privacy violation. `keccak256(actor_id)` is stored instead. The backend holds the mapping between raw IDs and hashes. The chain holds only the proof.

---

## The Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MedicalAuditLog
 * @notice Immutable audit trail for all access events in the
 *         Federated Medical Record Discovery and Secure Access System.
 * @dev Only the authorizedWriter (backend wallet) can log events.
 *      All sensitive identifiers are stored as keccak256 hashes.
 */
contract MedicalAuditLog {

    // ─── Structs ────────────────────────────────────────────────

    struct AuditEntry {
        bytes32 eventId;        // keccak256(event_id from MongoDB)
        bytes32 actorHash;      // keccak256(actor.id) — never raw IDs on-chain
        bytes32 patientHash;    // keccak256(health_id)
        string  eventType;      // human-readable event type label
        bytes32 linkedEventId;  // links break-glass extensions to their trigger
        uint256 timestamp;      // block.timestamp at time of logging
        bytes32 metadataHash;   // keccak256(JSON.stringify(mongoDocument))
    }

    // ─── Storage ────────────────────────────────────────────────

    // eventId => AuditEntry
    mapping(bytes32 => AuditEntry) public entries;

    // patientHash => ordered list of eventIds
    // Enables full event chain reconstruction per patient
    mapping(bytes32 => bytes32[]) public patientEventChain;

    // Only the system backend wallet can write
    address public authorizedWriter;

    // ─── Events ─────────────────────────────────────────────────

    event AuditEventLogged(
        bytes32 indexed eventId,
        bytes32 indexed patientHash,
        string  eventType,
        uint256 timestamp
    );

    // ─── Constructor ────────────────────────────────────────────

    constructor() {
        authorizedWriter = msg.sender;
    }

    // ─── Modifiers ──────────────────────────────────────────────

    modifier onlyAuthorized() {
        require(msg.sender == authorizedWriter, "Unauthorized: not the backend writer");
        _;
    }

    // ─── Write ──────────────────────────────────────────────────

    /**
     * @notice Log a new audit event on-chain.
     * @param eventId       keccak256 of the MongoDB event_id
     * @param actorHash     keccak256 of the actor's user ID
     * @param patientHash   keccak256 of the patient's health ID
     * @param eventType     Human-readable event type string
     * @param linkedEventId keccak256 of linked event (ZeroHash if none)
     * @param metadataHash  keccak256 of the full serialized MongoDB document
     */
    function logEvent(
        bytes32 eventId,
        bytes32 actorHash,
        bytes32 patientHash,
        string  calldata eventType,
        bytes32 linkedEventId,
        bytes32 metadataHash
    ) external onlyAuthorized {

        // Prevent duplicate logging of the same event
        require(entries[eventId].timestamp == 0, "Event already logged");

        entries[eventId] = AuditEntry({
            eventId:       eventId,
            actorHash:     actorHash,
            patientHash:   patientHash,
            eventType:     eventType,
            linkedEventId: linkedEventId,
            timestamp:     block.timestamp,
            metadataHash:  metadataHash
        });

        patientEventChain[patientHash].push(eventId);

        emit AuditEventLogged(eventId, patientHash, eventType, block.timestamp);
    }

    // ─── Read ───────────────────────────────────────────────────

    /**
     * @notice Verify a MongoDB audit record has not been tampered with.
     * @param eventId              The event to verify
     * @param claimedMetadataHash  keccak256 of the current MongoDB document
     * @return true if the document matches what was logged on-chain
     */
    function verifyEntry(
        bytes32 eventId,
        bytes32 claimedMetadataHash
    ) external view returns (bool) {
        return entries[eventId].metadataHash == claimedMetadataHash;
    }

    /**
     * @notice Get the full ordered event chain for a patient.
     * @param patientHash  keccak256 of the patient's health ID
     * @return Array of eventIds in the order they were logged
     */
    function getPatientChain(
        bytes32 patientHash
    ) external view returns (bytes32[] memory) {
        return patientEventChain[patientHash];
    }

    /**
     * @notice Get a single audit entry by event ID.
     * @param eventId  The event to retrieve
     * @return The full AuditEntry struct
     */
    function getEntry(
        bytes32 eventId
    ) external view returns (AuditEntry memory) {
        return entries[eventId];
    }
}
```

---

## Backend Integration (Ethers.js)

### Writing an Event

```javascript
const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider("http://localhost:8545"); // Ganache
const wallet   = new ethers.Wallet(process.env.BACKEND_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

async function logAuditEvent(mongoDocument) {

  // Hash sensitive identifiers — never put raw IDs on-chain
  const actorHash    = ethers.keccak256(ethers.toUtf8Bytes(mongoDocument.actor.id));
  const patientHash  = ethers.keccak256(ethers.toUtf8Bytes(mongoDocument.subject_health_id));
  const eventId      = ethers.keccak256(ethers.toUtf8Bytes(mongoDocument.event_id));
  const linkedId     = mongoDocument.linked_event_id
    ? ethers.keccak256(ethers.toUtf8Bytes(mongoDocument.linked_event_id))
    : ethers.ZeroHash;

  // Hash the full MongoDB document — enables tamper detection
  const metadataHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(mongoDocument))
  );

  // Submit transaction asynchronously — does not block the main request
  const tx = await contract.logEvent(
    eventId,
    actorHash,
    patientHash,
    mongoDocument.event_type,
    linkedId,
    metadataHash
  );

  // Wait for confirmation, then backfill tx hash in MongoDB
  const receipt = await tx.wait();
  await AuditEvents.updateOne(
    { event_id: mongoDocument.event_id },
    { $set: { blockchain_tx_hash: receipt.hash } }
  );

  return receipt.hash;
}
```

### Verifying a Record (Patient App)

```javascript
async function verifyAuditEntry(mongoDocument) {
  const eventId         = ethers.keccak256(ethers.toUtf8Bytes(mongoDocument.event_id));
  const claimedHash     = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(mongoDocument)));
  const isVerified      = await contract.verifyEntry(eventId, claimedHash);
  return isVerified;
  // true  → "Verified — record matches blockchain"
  // false → "Warning — record may have been modified"
}
```

---

## Break-Glass Event Chain Structure

A complete break-glass event with extension and reinstatement produces this linked chain on-chain:

```
[BG-TRIGGER]   eventId: BG-20241120-0042  linkedEventId: ZeroHash
      ↓
[BG-EXT-REQ]   eventId: EXT-001           linkedEventId: BG-20241120-0042
      ↓
[BG-EXT-AUTH]  eventId: AUTH-001          linkedEventId: BG-20241120-0042
      ↓
[BG-EXPIRE]    eventId: EXP-001           linkedEventId: BG-20241120-0042
      ↓
[BG-REINSTAT]  eventId: RST-001           linkedEventId: BG-20241120-0042
```

All five entries point back to the original trigger via `linkedEventId`. `getPatientChain()` returns all five in sequence.

---

## Hardhat Deployment Script

```javascript
// scripts/deploy.js
const hre = require("hardhat");

async function main() {
  const MedicalAuditLog = await hre.ethers.getContractFactory("MedicalAuditLog");
  const contract = await MedicalAuditLog.deploy();
  await contract.waitForDeployment();

  console.log("MedicalAuditLog deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

```javascript
// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.19",
  networks: {
    ganache: {
      url: "http://127.0.0.1:8545",
      accounts: [process.env.BACKEND_PRIVATE_KEY]
    }
  }
};
```

**Deploy command:**
```bash
npx hardhat run scripts/deploy.js --network ganache
```

---

## Gas Optimization Notes

| Optimization | Status | Notes |
|---|---|---|
| Store hashes (bytes32) not strings | Applied | All IDs are hashed — fixed 32-byte cost |
| `eventType` as string | Known tradeoff | Readable in demo — production would use uint8 enum |
| Batch logging | Not applied | Single events for prototype — batch is a production optimization |
| `indexed` on key fields | Applied | `eventId` and `patientHash` indexed for log filtering |

---

*Contract version 1.0 — ready for Ganache deployment*
*Audited by: internal review*
*Production upgrade path: Hyperledger Fabric for permissioned healthcare network*
