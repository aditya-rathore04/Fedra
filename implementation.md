# Phase 1 — Tonight's Implementation Plan

## 0. Install Prerequisites (do this first, ~15 min)

| Tool | Check if installed | Install |
|---|---|---|
| Docker Desktop | `docker --version` | docker.com/products/docker-desktop |
| Node.js (v18+) | `node --version` | nodejs.org |
| MongoDB Compass (GUI, optional but faster than CLI) | — | mongodb.com/products/compass |
| Postman (for testing APIs) | — | postman.com/downloads |

Node packages (install once you scaffold the backend folder):
```bash
npm init -y
npm install express jsonwebtoken bcrypt mongodb dotenv cors
```

---

## 1. Docker Containers (30–45 min)

Create `docker-compose.yml`:

```yaml
version: '3.8'
networks:
  mednet:
    driver: bridge

services:
  hospital1-fhir:
    image: hapiproject/hapi:latest
    container_name: hospital1-fhir
    ports: ["8081:8080"]
    networks: [mednet]

  hospital1-mongo:
    image: mongo:7
    container_name: hospital1-mongo
    ports: ["27017:27017"]
    networks: [mednet]

  hospital2-fhir:
    image: hapiproject/hapi:latest
    container_name: hospital2-fhir
    ports: ["8082:8080"]
    networks: [mednet]

  hospital2-mongo:
    image: mongo:7
    container_name: hospital2-mongo
    ports: ["27018:27017"]
    networks: [mednet]

  hospital3-fhir:
    image: hapiproject/hapi:latest
    container_name: hospital3-fhir
    ports: ["8083:8080"]
    networks: [mednet]

  hospital3-mongo:
    image: mongo:7
    container_name: hospital3-mongo
    ports: ["27019:27017"]
    networks: [mednet]

  system-mongo:
    image: mongo:7
    container_name: system-mongo
    ports: ["27020:27017"]
    networks: [mednet]
```

Run it:
```bash
docker compose up -d
docker compose ps          # confirm all 7 containers show "healthy"/"Up"
```

**Wait ~30 seconds**, then verify each FHIR node is alive:
```bash
curl http://localhost:8081/fhir/metadata
curl http://localhost:8082/fhir/metadata
curl http://localhost:8083/fhir/metadata
```
Each should return a large JSON blob starting with `"resourceType":"CapabilityStatement"`. If any fails, `docker compose logs -f hospital1-fhir` and wait longer — first boot is slow.

**✅ Checkpoint:** 7 containers running, 3 FHIR endpoints responding.

---

## 2. Load Your 30 Synthea Files (20 min)

For each of your 10 files per hospital, POST directly:

```bash
curl -X POST http://localhost:8081/fhir \
  -H "Content-Type: application/fhir+json" \
  --data-binary "@patient1.json"
```

Do this 10 times against `8081` (hospital1), 10 times against `8082` (hospital2), 10 times against `8083` (hospital3). Save the response — it returns each resource's real server-assigned ID, which you'll need for the metadata step next. A simple bash loop saves time:

```bash
for f in hospital1_files/*.json; do
  curl -X POST http://localhost:8081/fhir \
    -H "Content-Type: application/fhir+json" \
    --data-binary "@$f"
done
```

**✅ Checkpoint:** `curl http://localhost:8081/fhir/Patient` returns 10 patients.

---

## 3. Populate Metadata (system-mongo + registry) (20 min)

Open MongoDB Compass, connect to `localhost:27020` (system-mongo).

For each of your 30 patients, manually insert into `registry_db.registry_entries` (fastest tonight — skip a script):
```json
{
  "health_id": "ABHA-DEMO-001",
  "institution_id": "HOSP-1",
  "institution_name": "Hospital 1",
  "fhir_endpoint": "http://hospital1-fhir:8080/fhir",
  "record_summary": {
    "total_records": 12,
    "categories_present": ["allergy", "medication", "condition"],
    "sensitive_categories_present": []
  },
  "node_status": "active"
}
```
You can copy-paste this template 30 times, changing `health_id` and `institution_id`/`fhir_endpoint` per hospital. Doesn't need to be perfectly accurate for a demo — just realistic.

Also insert 2–3 test users into `system_db.users`:
```json
{ "user_id": "DOC-1", "role": "doctor", "email": "doc1@test.com", "name": "Dr. Test" }
{ "user_id": "PAT-1", "role": "patient", "health_id": "ABHA-DEMO-001", "name": "Test Patient" }
```

**✅ Checkpoint:** `registry_db` has 30 entries, `system_db.users` has your demo doctor/patient.

---

## 4. Identity Service + JWT (45 min)

`backend/index.js`:
```js
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const client = new MongoClient('mongodb://localhost:27020');
let systemDb, registryDb;

client.connect().then(() => {
  systemDb = client.db('system_db');
  registryDb = client.db('registry_db');
  app.listen(3000, () => console.log('Gateway on :3000'));
});

// LOGIN — no password check for tonight, just lookup by email
app.post('/auth/login', async (req, res) => {
  const user = await systemDb.collection('users').findOne({ email: req.body.email });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const token = jwt.sign(
    { user_id: user.user_id, role: user.role, institution_id: user.institution_id || null },
    process.env.JWT_SECRET,
    { expiresIn: user.role === 'doctor' ? '8h' : '24h' }
  );
  res.json({ token, role: user.role, name: user.name });
});

// MIDDLEWARE
function verifyJWT(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid/expired token' });
  }
}

// DISCOVERY — Step 5 below plugs in here
app.get('/patient/search', verifyJWT, async (req, res) => {
  if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Not permitted' });
  const entries = await registryDb.collection('registry_entries')
    .find({ health_id: req.query.health_id }).toArray();
  res.json({ health_id: req.query.health_id, institutions: entries });
});
```

`.env`:
```
JWT_SECRET=any-random-string-for-tonight
```

Run it:
```bash
node index.js
```

**Test in Postman:**
1. `POST http://localhost:3000/auth/login` body `{"email":"doc1@test.com"}` → copy the returned token
2. `GET http://localhost:3000/patient/search?health_id=ABHA-DEMO-001` with header `Authorization: Bearer <token>` → should return your 3 institutions

**✅ Checkpoint:** Login returns a token, protected search route returns institution list, request without token returns 401.

---

## 5. Discovery Frontend (30–40 min)

Skip React setup tonight — one plain HTML file is faster and demos identically.

`frontend/index.html`:
```html
<!DOCTYPE html>
<html>
<body>
  <h2>Login</h2>
  <input id="email" placeholder="email" value="doc1@test.com">
  <button onclick="login()">Login</button>
  <p id="status"></p>

  <h2>Search Patient</h2>
  <input id="healthId" placeholder="ABHA-DEMO-001">
  <button onclick="search()">Search</button>
  <table id="results" border="1"></table>

<script>
let token = '';

async function login() {
  const res = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email: document.getElementById('email').value })
  });
  const data = await res.json();
  token = data.token;
  document.getElementById('status').innerText = 'Logged in as ' + data.role;
}

async function search() {
  const id = document.getElementById('healthId').value;
  const res = await fetch(`http://localhost:3000/patient/search?health_id=${id}`, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const data = await res.json();
  document.getElementById('results').innerHTML =
    data.institutions.map(i => `<tr><td>${i.institution_name}</td><td>${i.record_summary.total_records}</td></tr>`).join('');
}
</script>
</body>
</html>
```

Open this file directly in a browser (no server needed). **✅ Checkpoint:** Login button works, search returns a table of hospitals.

---

## Time Budget

| Step | Time |
|---|---|
| Install tools | 15 min |
| Docker containers up | 30–45 min |
| Load 30 Synthea files | 20 min |
| Metadata + registry entries | 20 min |
| Identity + JWT backend | 45 min |
| Frontend | 30–40 min |
| **Total** | **~3–3.5 hrs** |

Do them **in this exact order** — each step's checkpoint is a hard dependency for the next. If you run short on time, the backend + Postman test alone (skip the HTML frontend, show Postman live) is still a legitimate, demoable Phase 1.