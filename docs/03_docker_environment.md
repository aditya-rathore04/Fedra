# Docker Environment
## Container Architecture for Local Development and Demo

> **File:** `03_docker_environment.md`
> **Status:** Complete — `docker-compose.yml` ready to run
> **Containers:** 11 total (3 hospital nodes × 2 + 5 system containers)

---

## Why Docker

The system simulates a federated network — three independent hospitals, each with its own infrastructure. Docker provides:

- **Isolation** — each hospital node runs in its own container, unaware of the others, matching the real-world architecture
- **Repeatability** — one command resets the entire demo environment to a clean known state
- **Port separation** — each HAPI FHIR instance exposed on a different host port, exactly as separate servers would be

---

## Container Map

| Container Name | Image | Host Port | Internal Port | Role |
|---|---|---|---|---|
| `hospital1-fhir` | `hapiproject/hapi:latest` | `8081` | `8080` | Hospital 1 FHIR server |
| `hospital1-mongo` | `mongo:7` | `27017` | `27017` | Hospital 1 record metadata |
| `hospital2-fhir` | `hapiproject/hapi:latest` | `8082` | `8080` | Hospital 2 FHIR server |
| `hospital2-mongo` | `mongo:7` | `27018` | `27017` | Hospital 2 record metadata |
| `hospital3-fhir` | `hapiproject/hapi:latest` | `8083` | `8080` | Hospital 3 FHIR server |
| `hospital3-mongo` | `mongo:7` | `27019` | `27017` | Hospital 3 record metadata |
| `system-mongo` | `mongo:7` | `27020` | `27017` | Registry, consent, audit DBs |
| `ganache` | `trufflesuite/ganache:latest` | `8545` | `8545` | Local Ethereum network |
| `ml-service` | Custom (Dockerfile) | `8000` | `8000` | FastAPI ML scoring service |
| `api-gateway` | Custom (Dockerfile) | `3000` | `3000` | Node.js backend + gateway |

**Network:** All containers on shared Docker bridge network `mednet`. Containers reference each other by container name, not by localhost port.

---

## `docker-compose.yml`

```yaml
version: '3.8'

networks:
  mednet:
    driver: bridge

# ─── Hospital Node 1 — Mysore General ───────────────────────────────

services:

  hospital1-fhir:
    image: hapiproject/hapi:latest
    container_name: hospital1-fhir
    ports:
      - "8081:8080"
    environment:
      - hapi.fhir.fhir_version=R4
      - hapi.fhir.server_address=http://hospital1-fhir:8080/fhir
    networks:
      - mednet
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/fhir/metadata"]
      interval: 30s
      timeout: 10s
      retries: 5

  hospital1-mongo:
    image: mongo:7
    container_name: hospital1-mongo
    ports:
      - "27017:27017"
    volumes:
      - hospital1-data:/data/db
    networks:
      - mednet

# ─── Hospital Node 2 — Bangalore Central ────────────────────────────

  hospital2-fhir:
    image: hapiproject/hapi:latest
    container_name: hospital2-fhir
    ports:
      - "8082:8080"
    environment:
      - hapi.fhir.fhir_version=R4
      - hapi.fhir.server_address=http://hospital2-fhir:8080/fhir
    networks:
      - mednet
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/fhir/metadata"]
      interval: 30s
      timeout: 10s
      retries: 5

  hospital2-mongo:
    image: mongo:7
    container_name: hospital2-mongo
    ports:
      - "27018:27017"
    volumes:
      - hospital2-data:/data/db
    networks:
      - mednet

# ─── Hospital Node 3 — Chennai Metro ────────────────────────────────

  hospital3-fhir:
    image: hapiproject/hapi:latest
    container_name: hospital3-fhir
    ports:
      - "8083:8080"
    environment:
      - hapi.fhir.fhir_version=R4
      - hapi.fhir.server_address=http://hospital3-fhir:8080/fhir
    networks:
      - mednet
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/fhir/metadata"]
      interval: 30s
      timeout: 10s
      retries: 5

  hospital3-mongo:
    image: mongo:7
    container_name: hospital3-mongo
    ports:
      - "27019:27017"
    volumes:
      - hospital3-data:/data/db
    networks:
      - mednet

# ─── System Containers ───────────────────────────────────────────────

  system-mongo:
    image: mongo:7
    container_name: system-mongo
    ports:
      - "27020:27017"
    volumes:
      - system-data:/data/db
    networks:
      - mednet

  ganache:
    image: trufflesuite/ganache:latest
    container_name: ganache
    ports:
      - "8545:8545"
    command: >
      --accounts 10
      --deterministic
      --mnemonic "test test test test test test test test test test test junk"
    networks:
      - mednet

  ml-service:
    build:
      context: ./ml-service
      dockerfile: Dockerfile
    container_name: ml-service
    ports:
      - "8000:8000"
    volumes:
      - ./ml-service/models:/app/models
    networks:
      - mednet

  api-gateway:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: api-gateway
    ports:
      - "3000:3000"
    environment:
      - SYSTEM_MONGO_URI=mongodb://system-mongo:27017/system_db
      - HOSPITAL1_FHIR=http://hospital1-fhir:8080/fhir
      - HOSPITAL2_FHIR=http://hospital2-fhir:8080/fhir
      - HOSPITAL3_FHIR=http://hospital3-fhir:8080/fhir
      - HOSPITAL1_MONGO=mongodb://hospital1-mongo:27017/hospital1_db
      - HOSPITAL2_MONGO=mongodb://hospital2-mongo:27017/hospital2_db
      - HOSPITAL3_MONGO=mongodb://hospital3-mongo:27017/hospital3_db
      - BLOCKCHAIN_RPC=http://ganache:8545
      - ML_SERVICE_URL=http://ml-service:8000
      - JWT_SECRET=your-secret-here
      - CONTRACT_ADDRESS=0x_deployed_address_here
    depends_on:
      - system-mongo
      - hospital1-mongo
      - hospital2-mongo
      - hospital3-mongo
      - hospital1-fhir
      - hospital2-fhir
      - hospital3-fhir
      - ganache
      - ml-service
    networks:
      - mednet

# ─── Volumes ─────────────────────────────────────────────────────────

volumes:
  hospital1-data:
  hospital2-data:
  hospital3-data:
  system-data:
```

---

## Key Design Notes

### The `--deterministic` Flag on Ganache

This is critical. It generates the same wallet addresses every time using the same mnemonic. Without it, every restart produces new wallet addresses, which invalidates the deployed contract address and breaks the backend's wallet configuration.

### Container Name vs Localhost

Inside the Docker network, containers address each other by name:
- `hospital1-fhir` not `localhost:8081`
- `system-mongo` not `localhost:27020`

Outside Docker (your browser, Flutter app, seed scripts):
- `localhost:8081`, `localhost:8082`, `localhost:8083` for FHIR
- `localhost:27020` for system MongoDB
- `localhost:3000` for API gateway
- `localhost:8545` for Ganache

The `fhir_endpoint` stored in the Discovery Registry uses the internal Docker name because the backend reads it at runtime from inside the network.

### HAPI FHIR Startup Time

HAPI FHIR takes approximately 20–30 seconds to start. The `healthcheck` configuration handles this. The seed script should wait for all three FHIR nodes to be healthy before attempting to load data.

---

## Common Commands

```bash
# Start all containers (detached)
docker compose up -d

# Check status of all containers
docker compose ps

# View logs from a specific container
docker compose logs -f hospital1-fhir
docker compose logs -f api-gateway
docker compose logs -f ganache

# Stop all containers (keeps data in volumes)
docker compose down

# Full wipe — stops containers and deletes all volume data
docker compose down -v

# Restart a single container
docker compose restart hospital1-fhir
```

---

## Demo Reset Script

```bash
#!/bin/bash
# scripts/reset-demo.sh
# Wipes everything and reseeds to clean demo state

set -e

echo "==> Stopping all containers and wiping volumes..."
docker compose down -v

echo "==> Starting fresh environment..."
docker compose up -d

echo "==> Waiting for HAPI FHIR nodes to be ready..."
sleep 35

echo "==> Checking health of FHIR nodes..."
curl -sf http://localhost:8081/fhir/metadata > /dev/null && echo "Hospital 1 FHIR: ready"
curl -sf http://localhost:8082/fhir/metadata > /dev/null && echo "Hospital 2 FHIR: ready"
curl -sf http://localhost:8083/fhir/metadata > /dev/null && echo "Hospital 3 FHIR: ready"

echo "==> Seeding patient data..."
node scripts/seed.js

echo "==> Deploying smart contract to Ganache..."
cd blockchain && npx hardhat run scripts/deploy.js --network ganache
cd ..

echo "==> Demo environment ready."
echo "    Doctor portal: http://localhost:3001"
echo "    API gateway:   http://localhost:3000"
echo "    Ganache:       http://localhost:8545"
```

---

## Project Folder Structure

```
project/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── gateway/
│   │   │   └── index.js
│   │   ├── services/
│   │   │   ├── identity.js
│   │   │   ├── discovery.js
│   │   │   ├── consent.js
│   │   │   ├── notification.js
│   │   │   └── audit.js
│   │   └── index.js
│   └── package.json
├── ml-service/
│   ├── Dockerfile
│   ├── main.py
│   ├── models/
│   │   ├── isolation_forest.pkl
│   │   └── lstm_autoencoder.h5
│   └── requirements.txt
├── blockchain/
│   ├── contracts/
│   │   └── MedicalAuditLog.sol
│   ├── scripts/
│   │   └── deploy.js
│   └── hardhat.config.js
├── frontend/
├── patient-app/
└── scripts/
    ├── seed.js
    └── reset-demo.sh
```

---

*Environment version 1.0 — all containers specified and ready*
*HAPI FHIR version: latest (R4 compliant)*
*MongoDB version: 7*
*Ganache version: latest (deterministic mode)*
