# Data Privacy and Security Agreement

**Effective Date:** 2026-02-03 **Parties:**

1. **Doctorpreneur Academy (Software Provider)**, operating the OPD Management
   Module ("Provider").
2. **The Customer / End User Organization** ("User").

This Data Privacy and Security Agreement ("Agreement") governs the processing
and protection of personal data within the Provider's OPD Management Module
application and infrastructure, which utilizes Supabase as a managed backend
platform and integrates WhatsApp for prescription delivery.

**Note:** This is a non-legal template. Both parties should have legal counsel
review and adapt it for specific jurisdictions, industry regulations (e.g.,
HIPAA, GDPR, DISHA), and use cases.

---

## 1. Definitions

- **"Personal Data"** means any information relating to an identified or
  identifiable natural person (e.g., patient, doctor, staff) processed by the
  Provider on behalf of the User.
- **"Services"** means the software and related services provided by the
  Provider, including the Supabase-managed backend, web/mobile applications, and
  optional integrations like WhatsApp.
- **"Applicable Law"** means all data protection and privacy laws and
  regulations that apply to the processing of Personal Data (e.g., GDPR, HIPAA,
  Indian IT Act/DPDP Act, local health data laws).
- **"Subprocessors"** means third parties engaged by the Provider to assist in
  providing the Services, including Supabase (backend) and cloud infrastructure
  providers (e.g., AWS).
- **"WhatsApp Content"** means messages, prescriptions, attachments, images, and
  metadata transmitted via WhatsApp channels initiated by the User.
- **"Platform"** refers to the Provider's OPD Management application suite.

## 2. Roles and Responsibilities

### 2.1 Controller vs. Processor

- **User as Controller:** The User determines the purposes and means of
  processing Personal Data within the app (e.g., managing patient records,
  issuing prescriptions). In this capacity, the User is the "Controller" (or
  "Data Fiduciary") and the Provider is the "Processor" (or "Data Processor").
- **Joint Controllership:** If the Provider processes data for its own purposes
  (e.g., platform usage analytics regarding feature popularity), the Provider
  acts as a Controller for that specific limited data.

### 2.2 User Responsibilities

- **Lawful Basis:** User warrants that all Personal Data entered into the
  Services is collected and processed lawfully.
- **Consents:** User is solely responsible for obtaining all necessary consents
  from data subjects (patients) for storing their medical data and for
  communicating via third-party channels like WhatsApp.
- **Access Management:** User must configure access permissions (e.g., staff
  roles) appropriately and enforce least-privilege principles within their
  organization. User is responsible for the security of their credentials.
- **Accuracy:** User is responsible for the accuracy and quality of the data
  entered.

### 2.3 Provider Responsibilities

- **Processing Instructions:** Provider will process Personal Data solely to
  deliver the Services, in accordance with the User's documented instructions
  (via app usage) and this Agreement.
- **Security:** Provider will maintain appropriate technical and organizational
  measures (TOMs) as outlined in Section 6.
- **Confidentiality:** Provider ensures that personnel authorized to process
  Personal Data are committed to confidentiality.

## 3. Data Scope and Purpose

### 3.1 Types of Personal Data

- **Identity Data:** Names, email addresses, phone numbers, ages/DOBs, gender.
- **Health Data:** Medical history, symptoms, diagnoses, prescriptions, lab
  results, clinical notes, vital signs.
- **Operational Data:** Appointments, billing/invoices, staff details, audit
  logs.
- **Credentials:** Encrypted passwords (managed by Auth provider),
  authentication tokens.

### 3.2 Purpose of Processing

- To provide, maintain, secure, support, and improve the OPD Management Module
  Services.
- To enable features such as appointment scheduling, patient record management,
  biological data tracking, billing, and report generation.
- To facilitate optional delivery of prescriptions and reports via WhatsApp if
  enabled by the User.
- To comply with legal obligations.

## 4. Data Residency and Subprocessors

### 4.1 Supabase

- **Role:** Backend-as-a-Service Provider (Database, Auth, Storage, Realtime).
- **Security:** Supabase provides platform-level security including managed
  backups, TLS encryption in transit, and encryption at rest.
- **Region:** [Insert AWS Region, e.g., ap-south-1 (Mumbai)] (User should
  confirm the configured region).

### 4.2 WhatsApp (Meta)

- **Role:** Message Delivery Service (Optional).
- **Infrastructure:** Messages and attachments sent via WhatsApp are transmitted
  through Meta’s infrastructure and any selected Business Solution Provider
  (BSP).
- **Terms:** Processing by WhatsApp is subject to Meta's Terms of Service and
  Privacy Policy.

### 4.3 Disclosure and Updates

- Provider maintains a list of subprocessors. Provider will notify User of
  material changes to this list. User may object to new subprocessors on
  reasonable data protection grounds.

## 5. WhatsApp Integration: Risks and Responsibilities

### 5.1 User Acknowledgment

- **Not a secure EMR:** User acknowledges that WhatsApp is a consumer messaging
  platform and is **not** designed as a secure medical record system. Sending
  PHI (Protected Health Information) via WhatsApp carries inherent privacy
  risks.
- **Consent:** User warrants they have obtained explicit consent from the
  patient to receive medical documents (prescriptions/reports) via WhatsApp.

### 5.2 Provider Limitations

- **Transport Only:** Provider facilitates the generation and API transmission
  of the message/document.
- **No Control:** Once data leaves the Provider's infrastructure (i.e., is
  handed off to the WhatsApp API), the Provider has **no control** over onward
  processing, retention, or security by Meta (WhatsApp) or the recipient's
  device.
- **Liability:** Provider is not responsible for:
  - Misdelivery due to incorrect phone numbers provided by the User.
  - Security breaches on the recipient's device (e.g., malware, unauthorized
    access).
  - Screenshotting, forwarding, or saving of data by the recipient.
  - Outages or policy actions by WhatsApp/Meta.

### 5.3 Recommended Controls for User

- Verify patient phone numbers before sending.
- Use "view once" or expiring link features if available.
- Limit sending sensitive diagnoses directly in the message body.

## 6. Security Measures (Technical & Organizational)

### 6.1 Access Control & Row-Level Security (RLS)

- **Database Security:** Provider utilizes Postgres Row-Level Security (RLS) on
  all user-facing tables.
- **Policy Enforcement:** Data access is restricted based on authenticated
  identity (Supabase Auth) and verified JWT claims. Users can only access data
  belonging to their specific clinic/organization.
- **Credential Safety:** Service-role keys are never embedded in client
  applications. API secrets are managed via secure environment variables.

### 6.2 Encryption

- **In Transit:** All data transmission between the client and server is
  encrypted via TLS (Transport Layer Security).
- **At Rest:** Data stored in the database and object storage is encrypted at
  rest by the cloud provider.
- **Application-Level:** Sensitive fields (like passwords) are hashed.

### 6.3 Logging and Auditing

- **Audit Trails:** Critical tables have triggers to capture audit logs (Subject
  ID, Action, Timestamp) of changes.
- **Logs:** System logs and security events are retained in accordance with the
  retention policy.

### 6.4 Backups and Recovery

- **Managed Backups:** Point-in-time recovery (PITR) or daily backups are
  enabled via Supabase (tier-dependent).
- **Integrity:** Provider periodically verifies the ability to restore from
  backups.

### 6.5 Secure Development

- **Edge Functions:** Server-side logic runs in isolated Deno Edge Functions.
- **Secrets:** Credentials are not hardcoded but accessed via a secrets manager.

## 7. Data Subject Rights (DSRs)

- Provider will assist the User in responding to requests from data subjects
  (e.g., Right to Access, Rectification, Deletion, Portability) by providing
  features within the Software to search, export, update, or delete records.
- User is responsible for verifying the identity of the requestor and the legal
  validity of the request.

## 8. Incident Response and Breach Notification

- **Notification:** Provider will notify the User without undue delay upon
  confirming a Personal Data Breach within the Provider's systems. Notification
  will describe the nature of the breach, likely consequences, and remediation
  measures.
- **User Duty:** User is responsible for notifying affected data subjects and
  regulatory authorities as required by Applicable Law.

## 9. Retention and Deletion

- **Term:** Personal Data is retained for the duration of the User's active
  subscription.
- **Deletion:** Upon termination of the Agreement or User's written instruction,
  Provider will delete User's Personal Data from production systems within
  [Insert Timeframe, e.g., 30 days], retaining only backup copies which will
  degrade over time in accordance with backup cycles, or data required for
  legal/financial compliance.

## 10. Liability and Indemnification

### 10.1 WhatsApp Carve-out

To the maximum extent permitted by law, Provider is **not liable** for:

- Loss, interception, or unauthorized access to WhatsApp Content occurring after
  transmission to the WhatsApp API.
- Privacy violations arising from User's failure to obtain valid consent or
  User's entry of incorrect recipient data.

### 10.2 Indemnity

User agrees to indemnify and hold Provider harmless against any claims, damages,
or fines arising from:

- User's processing of Personal Data in violation of Applicable Laws (e.g., lack
  of consent).
- User's misuse of the WhatsApp integration for transmitting prohibited
  sensitive content.

## 11. General Provisions

- **Governing Law:** This Agreement is governed by the laws of [Insert
  Jurisdiction, e.g., India].
- **Dispute Resolution:** Any disputes arising shall be subject to the exclusive
  jurisdiction of the courts in [Insert City/State].
- **Updates:** Provider may update security measures to reflect technical
  progress. Material reductions in security will not be made without notice.

---

**Annex A: Technical Implementation Summary (Supabase)**

- **Authentication:** Supabase Auth with JWT claims for tenant isolation.
- **Database:** Postgres with RLS policies enabled for
  SELECT/INSERT/UPDATE/DELETE.
- **Storage:** Private S3-compatible buckets; access via short-lived signed URLs
  triggered by authenticated requests.
- **Edge Functions:** Server-side logic for sensitive operations (e.g., WhatsApp
  API calls), keeping API keys secret.
- **Realtime:** Channel authorization policies restrict data stream access to
  authorized users only.
