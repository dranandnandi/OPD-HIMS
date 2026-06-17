# OPD Management App for Indian Clinics

A comprehensive OPD (Outpatient Department) management application specifically designed for Indian clinics, featuring AI-powered case paper processing with Google Vision AI and Google Gemini.

## Applications

This repository contains two applications:

### 🏥 Main OPD Management System
The full-featured clinic management system with AI-powered case paper processing, comprehensive patient management, billing, pharmacy, and analytics.

### 📅 Appointment Portal (`appointment-portal/`)
A streamlined web application for managing clinic waiting sequences and appointment display settings. Features include:
- Waiting sequence configuration and management
- Display settings for patient information screens
- User management for doctors and staff
- WhatsApp integration for automated messaging
- Real-time queue status and token management

## Features

### 🏥 Core Medical Features (Main App)
- **Patient Registration & Management** - Complete patient demographics, search, and visit history
- **AI-Powered Case Paper Upload** - Photo capture with Google Vision AI OCR
- **Medical NLP Processing** - Google Gemini extracts symptoms, vitals, diagnosis, prescriptions, and advice
- **Auto-fill EMR Forms** - Structured forms pre-populated with AI-extracted data
- **Prescription Generation** - PDF printing and WhatsApp sharing
- **Follow-up Management** - Automated scheduling with SMS reminders
- **Patient Timeline** - Comprehensive visit history with search and filtering
- **Analytics Dashboard** - Indian clinic-specific metrics and trends

### 📅 Appointment Portal Features
- **Appointment Management** - Calendar view, booking, and status tracking
- **Patient Directory** - Searchable patient list with contact info and visit history
- **Analytics Dashboard** - Appointment statistics, wait times, and patient satisfaction
- **Settings Management** - Profile, clinic info, users, WhatsApp, and notifications
- **WhatsApp Integration** - Automated messaging and review requests

### 🔧 Technical Features
- **Mobile-First Design** - Fully responsive with touch-optimized interfaces
- **Secure API Integration** - Server-side processing with Supabase Edge Functions
- **Real-time Processing** - Live OCR and NLP processing with progress indicators
- **Indian Context** - Rupee currency, Indian phone formats, local medical terminology

## AI Integration

### Google Vision AI (OCR)
- Extracts raw text from handwritten case papers
- Handles various handwriting styles and document layouts
- Processes images securely on the server side

### Google Gemini (Medical NLP)
- Specialized prompts for Indian medical terminology
- Extracts structured medical data from raw text
- Handles Hindi/regional language terms mixed with English
- Recognizes Indian drug names and prescription formats

## Setup Instructions

### Prerequisites
- Node.js 18+ and npm
- Supabase account for Edge Functions
- Google Cloud Project with Vision API enabled
- Google AI Studio account for Gemini API

### Installation

1. **Clone and install dependencies:**
```bash
npm install
```

#### For Appointment Portal Only
If you only need the appointment portal:
```bash
cd appointment-portal
npm install
npm run dev  # Runs on port 5174
```

#### For Main OPD System
For the full OPD management system, continue with the main directory.

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory with your Supabase credentials and WhatsApp settings:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   VITE_WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app
   VITE_WHATSAPP_API_MODE=netlify-functions
   VITE_WHATSAPP_WS_ENABLED=true
   VITE_WHATSAPP_WS_URL=wss://lionfish-app-nmodi.ondigitalocean.app/ws
   VITE_WHATSAPP_WS_DEBUG=false
   ```
   On Netlify (server-side only) also set:
   - `WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app`
   - `WHATSAPP_API_KEY=<secure-api-key>`
   
   You can find these values in your Supabase dashboard:
   - Go to your Supabase project dashboard
   - Navigate to Settings > API
   - Copy the "Project URL" for VITE_SUPABASE_URL
   - Copy the "anon public" key for VITE_SUPABASE_ANON_KEY

3. **Set up Database:**
   - Run the migration file in your Supabase SQL editor:
   - Copy the contents of `supabase/migrations/create_patients_and_visits_tables.sql`
   - Execute it in your Supabase project's SQL editor

4. **Deploy Edge Functions:**
   - The functions are automatically deployed when you run the app
   - `supabase/functions/vision-ocr/` - Handles Google Vision AI OCR
   - `supabase/functions/gemini-nlp/` - Handles Google Gemini medical NLP

5. **Start the development server:**
```bash
npm run dev
```

## WhatsApp Integration

- Netlify proxy functions live under `netlify/functions/*` and forward requests to the shared DigitalOcean WhatsApp backend.
- Shared helper `netlify/functions/_shared/whatsappClient.ts` wraps CORS, env lookups, and the `X-API-Key` forwarding contract.
- Frontend code (coming next) calls these functions via `/api/whatsapp-*` endpoints exposed by Netlify locally (`netlify dev`) or on production builds.
- Ensure the Netlify site connected to this repo has the WhatsApp env variables configured before deploying so QR/login and messaging succeed.

## Usage

### Case Paper Processing Workflow

1. **Upload Image** - Take photo or select image of handwritten case paper
2. **AI Processing** - 
   - Advanced OCR extracts raw text from the image
   - AI analyzes the text and extracts medical entities
3. **Review Results** - Verify extracted data before proceeding
4. **EMR Creation** - Auto-populated form with extracted data, editable by doctor
5. **Save & Share** - Save to patient record, print prescription, send via WhatsApp

### Key Components

- **`src/services/ocrService.ts`** - Main AI processing service
- **`src/components/CaseUpload/`** - Image upload and processing UI
- **`src/components/CaseUpload/EMRForm.tsx`** - Auto-filled EMR form
- **`supabase/functions/`** - Secure server-side API endpoints

## Security

- API keys and service account credentials are stored server-side
- All AI processing happens through secure Edge Functions
- No sensitive data exposed to client-side code
- CORS properly configured for secure API access

## Indian Medical Context

The app is specifically designed for Indian clinics with:
- Support for Indian medical terminology and drug names using specialized AI models
- Recognition of prescription formats common in Indian clinics
- Handling of dosage frequencies (OD, BD, TID, QID, PRN)
- Indian measurement units and currency (₹)
- Mixed Hindi/English medical terms

## Production Deployment

For production deployment:
1. Move API keys to environment variables
2. Set up proper authentication and authorization
3. Configure database for persistent storage
4. Implement proper error handling and logging
5. Add rate limiting and usage monitoring

## Support

This application demonstrates the integration of advanced AI technologies for medical document processing. The AI models are configured with specialized prompts for accurate medical data extraction in the Indian healthcare context.