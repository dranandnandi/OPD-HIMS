# Clinic Templates System - Implementation Plan

## 📋 Overview

This plan outlines the implementation of a **Clinic-Specific Templates System** that allows clinics to:
1. Customize PDF templates (Visit/Prescription, Bill/Invoice)
2. Manage WhatsApp message templates (Appointment, Reminder, Visit)
3. Create reusable prescription templates for common conditions
4. Upload custom headers/footers for PDFs
5. Store generated PDFs for delivery

---

## 🗃️ Database Schema

### New Table: `clinic_templates`

```sql
CREATE TABLE public.clinic_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  
  -- Template Type
  template_type text NOT NULL CHECK (template_type IN (
    'visit_pdf',           -- Visit/Prescription PDF template
    'bill_pdf',            -- Bill/Invoice PDF template
    'whatsapp_appointment',-- WhatsApp appointment confirmation
    'whatsapp_reminder',   -- WhatsApp appointment reminder
    'whatsapp_visit',      -- WhatsApp visit summary/prescription
    'prescription_preset'  -- Reusable prescription templates
  )),
  
  -- Template Name (for prescription presets or multiple versions)
  name text NOT NULL DEFAULT 'Default',
  
  -- HTML Content (for PDF templates - stored as raw HTML from CKEditor)
  html_content text,
  
  -- Text Content (for WhatsApp templates - plain text with placeholders)
  text_content text,
  
  -- JSON Data (for prescription presets - medicine list, dosages, etc.)
  -- Structure: { medicines: [...], advice: [...], followUpDays: number }
  preset_data jsonb,
  
  -- Header/Footer URLs for PDF templates
  header_url text,
  footer_url text,
  
  -- Branding CSS (optional custom styles)
  custom_css text,
  
  -- Is this the active/default template?
  is_active boolean DEFAULT true,
  
  -- Metadata
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  
  CONSTRAINT clinic_templates_pkey PRIMARY KEY (id),
  -- Ensure unique active template per type per clinic
  CONSTRAINT clinic_templates_unique_active 
    UNIQUE (clinic_id, template_type, name)
);

-- Create index for faster lookups
CREATE INDEX idx_clinic_templates_clinic_type 
ON public.clinic_templates(clinic_id, template_type);

-- Enable RLS
ALTER TABLE public.clinic_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their clinic's templates
CREATE POLICY "Users can view their clinic templates" 
ON public.clinic_templates FOR SELECT 
USING (
  clinic_id IN (
    SELECT clinicId FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can manage their clinic templates" 
ON public.clinic_templates FOR ALL 
USING (
  clinic_id IN (
    SELECT clinicId FROM public.profiles WHERE id = auth.uid()
  )
);
```

### New Storage Bucket: `clinic-pdfs`

```sql
-- Create bucket for storing generated PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('clinic-pdfs', 'clinic-pdfs', true);

-- Storage policy for the bucket
CREATE POLICY "Clinic PDF access" ON storage.objects
FOR ALL USING (bucket_id = 'clinic-pdfs');
```

---

## 📄 Template Placeholders

### Visit/Prescription PDF Template Placeholders:
```
{{clinic.name}}           - Clinic name
{{clinic.address}}        - Clinic address
{{clinic.phone}}          - Clinic phone
{{clinic.logo}}           - Logo URL

{{patient.name}}          - Patient name
{{patient.age}}           - Patient age
{{patient.gender}}        - Patient gender
{{patient.phone}}         - Patient phone

{{visit.date}}            - Visit date
{{visit.chiefComplaint}}  - Chief complaint
{{visit.diagnosis}}       - Diagnoses list
{{visit.prescriptions}}   - Prescriptions table (auto-generated)
{{visit.advice}}          - Advice list
{{visit.adviceRegional}}  - Regional language advice
{{visit.followUpDate}}    - Follow-up date

{{doctor.name}}           - Doctor name
{{doctor.specialization}} - Doctor specialization
{{doctor.signature}}      - Signature image
```

### Bill PDF Template Placeholders:
```
{{clinic.*}}              - Same as above
{{patient.*}}             - Same as above

{{bill.number}}           - Bill number
{{bill.date}}             - Bill date
{{bill.items}}            - Bill items table
{{bill.subtotal}}         - Subtotal
{{bill.discount}}         - Discount
{{bill.tax}}              - Tax
{{bill.total}}            - Total amount
{{bill.paid}}             - Paid amount
{{bill.balance}}          - Balance amount
{{bill.status}}           - Payment status
```

### WhatsApp Template Placeholders:
```
{{patient.name}}          - Patient name
{{appointment.date}}      - Appointment date
{{appointment.time}}      - Appointment time
{{doctor.name}}           - Doctor name
{{clinic.name}}           - Clinic name
{{pdf.url}}               - PDF URL (for visit/bill)
```

---

## 🎨 Prescription Preset Data Structure

For reusable prescription templates (e.g., "Cold & Fever", "Chest Pain"):

```typescript
interface PrescriptionPreset {
  name: string;           // e.g., "Cold & Fever Treatment"
  condition: string;      // e.g., "Upper Respiratory Infection"
  
  medicines: Array<{
    medicine: string;     // Medicine name
    dosage: string;       // e.g., "500mg"
    frequency: string;    // e.g., "BD"
    duration: string;     // e.g., "5 days"
    instructions: string; // e.g., "after food"
  }>;
  
  advice: string[];       // List of advice
  followUpDays?: number;  // Suggested follow-up days
  
  tags?: string[];        // For searching/filtering
}

// Example:
{
  "name": "Common Cold Treatment",
  "condition": "Upper Respiratory Tract Infection",
  "medicines": [
    {
      "medicine": "Paracetamol",
      "dosage": "500mg",
      "frequency": "TDS",
      "duration": "3 days",
      "instructions": "after food"
    },
    {
      "medicine": "Cetirizine",
      "dosage": "10mg",
      "frequency": "OD",
      "duration": "5 days",
      "instructions": "at night"
    }
  ],
  "advice": [
    "Drink plenty of fluids",
    "Rest adequately",
    "Avoid cold drinks"
  ],
  "followUpDays": 3,
  "tags": ["cold", "fever", "viral"]
}
```

---

## 🖥️ UI Components

### 1. Templates Settings Page (`/settings/templates`)

```
╭─────────────────────────────────────────────────────────────────╮
│ 📋 Clinic Templates                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [PDF Templates] [WhatsApp Templates] [Prescription Presets]     │
│                                                                   │
│  ┌─── PDF Templates ────────────────────────────────────────────┐│
│  │                                                               ││
│  │  Visit/Prescription PDF    [Edit] [Preview] [Reset Default]  ││
│  │  Bill/Invoice PDF          [Edit] [Preview] [Reset Default]  ││
│  │                                                               ││
│  │  Header Image: [Upload] [Current: clinic_header.png]          ││
│  │  Footer Image: [Upload] [Current: None]                       ││
│  │                                                               ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌─── WhatsApp Templates ───────────────────────────────────────┐│
│  │                                                               ││
│  │  Appointment Confirmation  [Edit]                             ││
│  │  Appointment Reminder      [Edit]                             ││
│  │  Visit Summary             [Edit]                             ││
│  │                                                               ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌─── Prescription Presets ─────────────────────────────────────┐│
│  │                                                               ││
│  │  [+ Add New Preset]                                           ││
│  │                                                               ││
│  │  🏥 Common Cold          [Edit] [Delete] [Use]                ││
│  │  🫁 Chest Pain           [Edit] [Delete] [Use]                ││
│  │  🤧 Allergic Rhinitis    [Edit] [Delete] [Use]                ││
│  │                                                               ││
│  └───────────────────────────────────────────────────────────────┘│
╰─────────────────────────────────────────────────────────────────╯
```

### 2. CKEditor HTML Editor Modal

```
╭─────────────────────────────────────────────────────────────────╮
│ Edit Visit PDF Template                              [X] Close   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [B] [I] [U] [H1] [H2] [Table] [Image] [{{}} Placeholder]    │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │                                                             │ │
│  │  <CKEditor Content Area>                                    │ │
│  │                                                             │ │
│  │  {{clinic.logo}}                                            │ │
│  │  <h1>{{clinic.name}}</h1>                                   │ │
│  │  <p>{{clinic.address}}</p>                                  │ │
│  │  ...                                                        │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Available Placeholders:                                          │
│  [{{patient.name}}] [{{visit.date}}] [{{prescriptions}}] ...     │
│                                                                   │
│  [Cancel] [Preview] [Save Template]                              │
╰─────────────────────────────────────────────────────────────────╯
```

### 3. Prescription Preset in EMR Form

In the EMR Form, add a preset selector:

```
╭─────────────────────────────────────────────────────────────────╮
│ 💊 Prescriptions                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Quick Apply: [Select Preset ▼]                                  │
│               ├─ 🏥 Common Cold                                  │
│               ├─ 🫁 Chest Pain                                   │
│               └─ 🤧 Allergic Rhinitis                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Medicine: Paracetamol  Dosage: 500mg  Freq: TDS  Dur: 3d   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ...                                                              │
╰─────────────────────────────────────────────────────────────────╯
```

---

## 🔄 PDF Generation Flow (Updated)

```
1. User clicks "Generate PDF" for Visit/Bill
              ↓
2. Frontend calls: POST /functions/v1/generate-pdf-from-html
   Body: { type: 'visit', data: { visit, patient, doctor, clinicSettings } }
              ↓
3. Edge Function:
   a. Fetch clinic's custom template from clinic_templates table
   b. If no custom template, use default hardcoded template
   c. Replace all {{placeholders}} with actual data
   d. Inject header/footer images if configured
   e. Send HTML to PDF.co API
              ↓
4. PDF.co returns temporary URL
              ↓
5. Edge Function:
   a. Download PDF from PDF.co
   b. Upload to Supabase Storage (clinic-pdfs bucket)
   c. Generate public URL
   d. Store URL in visit/bill record (optional)
              ↓
6. Return public URL to frontend
              ↓
7. Frontend opens PDF / Sends via WhatsApp
```

---

## 📁 File Structure

```
src/
├── components/
│   └── Settings/
│       ├── TemplatesPage.tsx         # Main templates settings page
│       ├── PDFTemplateEditor.tsx     # CKEditor for PDF templates
│       ├── WhatsAppTemplateEditor.tsx# Text editor for WhatsApp
│       └── PrescriptionPresetModal.tsx# Preset CRUD modal
│
├── services/
│   └── templateService.ts            # CRUD for clinic_templates
│
supabase/
├── functions/
│   └── generate-pdf-from-html/
│       └── index.ts                  # Updated to use clinic templates
│
├── migrations/
│   └── 20241229_add_clinic_templates.sql
```

---

## 🛠️ Implementation Phases

### Phase 1: Database & Storage (Current Request Scope)
- [ ] Create `clinic_templates` table migration
- [ ] Create `clinic-pdfs` storage bucket
- [ ] Add default template data

### Phase 2: Backend - PDF Generation Update
- [ ] Update `generate-pdf-from-html` to fetch clinic template
- [ ] Implement placeholder replacement engine
- [ ] Store generated PDFs to storage bucket
- [ ] Return permanent public URL

### Phase 3: Frontend - Templates UI
- [ ] Create Templates Settings Page
- [ ] Integrate CKEditor for HTML editing
- [ ] Implement template preview functionality
- [ ] Header/Footer upload UI

### Phase 4: Prescription Presets
- [ ] Preset CRUD UI
- [ ] Integrate preset selector in EMR Form
- [ ] Apply preset (fill prescriptions + advice)

### Phase 5: WhatsApp Templates
- [ ] WhatsApp template editor UI
- [ ] Update WhatsApp sending to use custom templates

---

## 🔒 Security Considerations

1. **RLS Policies**: Templates are clinic-scoped
2. **Storage Access**: PDFs are public but use UUID-based paths
3. **Sanitization**: Sanitize HTML content from CKEditor before storing
4. **Validation**: Validate placeholders before saving templates

---

## 📦 Dependencies to Add

```json
{
  "@ckeditor/ckeditor5-react": "^6.x",
  "@ckeditor/ckeditor5-build-classic": "^40.x"
}
```

Or use a free alternative like **React-Quill** or **TinyMCE**.

---

## 📝 Default Templates

Store default templates that clinics can customize:

1. **Visit PDF**: Current hardcoded HTML in generate-pdf-from-html
2. **Bill PDF**: Current hardcoded HTML for bills
3. **WhatsApp Appointment**: "Dear {{patient.name}}, your appointment with Dr. {{doctor.name}} is confirmed for {{appointment.date}} at {{appointment.time}}. - {{clinic.name}}"
4. **WhatsApp Reminder**: "Reminder: You have an appointment tomorrow at {{appointment.time}} with Dr. {{doctor.name}}. - {{clinic.name}}"
5. **WhatsApp Visit**: "Dear {{patient.name}}, your prescription is ready. Download here: {{pdf.url}} - {{clinic.name}}"
