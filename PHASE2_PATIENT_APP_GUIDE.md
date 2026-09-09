# Phase 2 developer guide: patient mobile app (Flutter)

This guide walks the mobile developer through building the patient application for Phase 2. 

You can build and test every screen in your app right now without waiting for your teammate to finish the backend. This guide shows you how to structure your code with mock services first, then connect to the real backend with a one-line config switch.

---

## Architecture overview

The patient mobile app is a Flutter application. During Phase 2, its job is to handle consent management and display patient records.

The core flows you need to build:
1. Patient login using an ABHA ID or phone number and password, with a local 4-digit PIN unlock.
2. Consent inbox showing pending access requests from doctors with their declared purpose.
3. Consent grant and deny dialogs, including granular sensitive category check boxes.
4. Active consent policies list with an instant revoke button.
5. Unified health record timeline displaying the patient's records across all three hospital nodes.

---

## Directory setup

Create your Flutter project in a top-level directory named `patient_app`:

```bash
# From the repository root
flutter create patient_app
cd patient_app
```

Recommended internal folder structure:

```
patient_app/
├── lib/
│   ├── config/
│   │   └── api_config.dart          # Base URL and mock mode switch
│   ├── models/
│   │   ├── consent_request.dart     # Doctor request data model
│   │   ├── consent_policy.dart      # Active consent policy model
│   │   └── clinical_record.dart     # Patient clinical record model
│   ├── services/
│   │   ├── auth_service.dart        # Auth interface and implementations
│   │   ├── consent_service.dart     # Consent interface and implementations
│   │   ├── mock_data.dart           # Hardcoded JSON matching the spec
│   │   └── record_service.dart      # Clinical record fetching
│   ├── screens/
│   │   ├── login_screen.dart        # JWT auth and PIN setup
│   │   ├── inbox_screen.dart        # Pending requests list
│   │   ├── consent_detail_screen.dart # Grant/deny with sensitive toggles
│   │   ├── active_policies_screen.dart # Active access and revocation
│   │   └── timeline_screen.dart     # Cross-hospital health records
│   └── main.dart
└── pubspec.yaml
```

---

## Step 1: Set up the mock-first service layer

Because [`docs/05_api_service_design.md`](file:///c:/Users/adity/FEDRA/docs/05_api_service_design.md#L222-L373) locks all API contracts, you can build against mock data.

Create your API toggle in `lib/config/api_config.dart`:

```dart
class ApiConfig {
  // Set to true while building UI, false when testing with teammate's backend
  static const bool useMock = true;

  // On Android emulator, 10.0.2.2 points to host laptop
  static const String baseUrl = 'http://10.0.2.2:3000';

  // If testing on iOS simulator, use localhost instead:
  // static const String baseUrl = 'http://localhost:3000';
}
```

Define the consent service interface in `lib/services/consent_service.dart`:

```dart
abstract class ConsentService {
  Future<List<Map<String, dynamic>>> getPendingRequests();
  Future<Map<String, dynamic>> grantConsent(String requestId, Map<String, bool> sensitiveCategories);
  Future<bool> revokeConsent(String policyId);
  Future<bool> updateSensitiveScope(String policyId, String category, bool granted);
}
```

Create the mock implementation in `lib/services/mock_consent_service.dart`:

```dart
import 'dart:async';
import 'consent_service.dart';

class MockConsentService implements ConsentService {
  @override
  Future<List<Map<String, dynamic>>> getPendingRequests() async {
    await Future.delayed(const Duration(milliseconds: 300));
    return [
      {
        "request_id": "REQ-001",
        "doctor_name": "Dr. Arjun Nair",
        "institution_name": "Apollo Memorial Hospital",
        "purpose": "Cardiology follow-up post emergency care",
        "created_at": "2026-09-09T09:30:00Z"
      }
    ];
  }

  @override
  Future<Map<String, dynamic>> grantConsent(String requestId, Map<String, bool> sensitiveCategories) async {
    await Future.delayed(const Duration(milliseconds: 400));
    return {
      "policy_id": "POL-999",
      "token_id": "TOK-999",
      "expires_at": DateTime.now().millisecondsSinceEpoch ~/ 1000 + 86400,
      "scope": {
        "general_access": true,
        "sensitive_categories": sensitiveCategories
      }
    };
  }

  @override
  Future<bool> revokeConsent(String policyId) async {
    await Future.delayed(const Duration(milliseconds: 300));
    return true;
  }

  @override
  Future<bool> updateSensitiveScope(String policyId, String category, bool granted) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return true;
  }
}
```

---

## Step 2: Screen specifications and contracts

Every screen maps to a spec in [`docs/05_api_service_design.md`](file:///c:/Users/adity/FEDRA/docs/05_api_service_design.md).

### 1. Login and unlock screen
Target endpoint: `POST /auth/login`

Request payload:
```json
{
  "email": "priya.sharma@example.com",
  "password": "password123"
}
```

Expected response `200`:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1700028800,
  "role": "patient",
  "user_id": "PAT-DEMO-001"
}
```

Store this token in `flutter_secure_storage`. Every subsequent API call must include:
`Authorization: Bearer <token>`.

### 2. Consent request inbox
Displays doctor requests waiting for approval.

When the patient taps on a request, navigate to the detail view showing:
* Doctor full name and medical registration ID.
* Hospital or clinic name.
* Declared clinical purpose.
* Expiration period.

### 3. Grant consent dialog with sensitive category gates
When granting consent, the patient chooses general access, plus opt-in toggles for four sensitive categories defined in [`docs/01_database_schema.md`](file:///c:/Users/adity/FEDRA/docs/01_database_schema.md#L115):
* `psychiatric`
* `reproductive`
* `hiv`
* `substance_abuse`

Target endpoint: `POST /consent/grant`

Request payload:
```json
{
  "request_id": "REQ-001",
  "scope": {
    "general_access": true,
    "sensitive_categories": {
      "psychiatric": false,
      "reproductive": false,
      "hiv": false,
      "substance_abuse": false
    }
  }
}
```

Expected response `200`:
```json
{
  "policy_id": "POL-uuid",
  "token_id": "TOK-uuid",
  "expires_at": 1700028800,
  "scope": {
    "general_access": true,
    "sensitive_categories": {
      "psychiatric": false,
      "reproductive": false,
      "hiv": false,
      "substance_abuse": false
    }
  }
}
```

### 4. Active consents and revocation screen
Target endpoint: `POST /consent/revoke`

Request payload:
```json
{
  "policy_id": "POL-uuid"
}
```

Expected response `200`:
```json
{
  "revoked": true,
  "active_tokens_invalidated": 1,
  "doctor_notified": true
}
```

### 5. Unified health records timeline
Displays clinical records pulled across Apollo, Fortis, and Max hospitals.
* Categorize records into Allergies, Active Prescriptions, Conditions, and Lab Reports.
* Each card shows the hospital source name, recording doctor, date, and clinical description.

---

## Step 3: Wire up the live HTTP service

When your teammate confirms the backend endpoints are working, write `lib/services/http_consent_service.dart`:

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import 'consent_service.dart';

class HttpConsentService implements ConsentService {
  final String token;
  HttpConsentService({required this.token});

  @override
  Future<List<Map<String, dynamic>>> getPendingRequests() async {
    final response = await http.get(
      Uri.parse('${ApiConfig.baseUrl}/consent/pending'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(jsonDecode(response.body)['requests']);
    }
    throw Exception('Failed to load pending requests');
  }

  @override
  Future<Map<String, dynamic>> grantConsent(String requestId, Map<String, bool> sensitiveCategories) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/consent/grant'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'request_id': requestId,
        'scope': {
          'general_access': true,
          'sensitive_categories': sensitiveCategories,
        },
      }),
    );
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to grant consent');
  }

  @override
  Future<bool> revokeConsent(String policyId) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/consent/revoke'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'policy_id': policyId}),
    );
    return response.statusCode == 200;
  }

  @override
  Future<bool> updateSensitiveScope(String policyId, String category, bool granted) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/consent/sensitive'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'policy_id': policyId,
        'category': category,
        'grant': granted,
      }),
    );
    return response.statusCode == 200;
  }
}
```

In your main injection setup, select the service based on `ApiConfig.useMock`:

```dart
final ConsentService consentService = ApiConfig.useMock 
    ? MockConsentService() 
    : HttpConsentService(token: userAuthToken);
```

---

## Integration checklist with your teammate

1. **Verify network loopback.** If testing on an Android emulator, make sure your URL is `http://10.0.2.2:3000`. On iOS, use `http://localhost:3000`.
2. **Login check.** Use Priya Sharma credentials (`priya.sharma@example.com`) or AdhiRaj credentials (`adhiraj@example.com`) seeded by [`scripts/seed_and_load.js`](file:///c:/Users/adity/FEDRA/scripts/seed_and_load.js).
3. **Grant handshake.** Ask your teammate to trigger a doctor request. Open the app, verify it appears in your inbox, and tap Grant. Confirm your teammate receives the new `access_token`.
4. **Sensitive category test.** Grant access without psychiatric records. Verify your teammate cannot see the psychiatric condition. Then toggle psychiatric access in your app and confirm the record appears on their doctor portal.
