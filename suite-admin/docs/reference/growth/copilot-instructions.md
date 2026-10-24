> Archived reference copied 18 October 2026 from `D:/app/gmb review system/project/.github/copilot-instructions.md`. Applies to its original product, not to Suite Admin. Historical implementation/deployment claims require verification. The current suite MEMORY and messaging plan take precedence for suite design. Credential-related lines may be omitted.

# Copilot Instructions for GMB Review System

## Project Overview
This is a **Clinic Management System** for managing Google My Business (GMB) reviews and patient communication. It's a React + TypeScript frontend deployed on **Netlify**, with **Supabase** for database/auth and **Deno Edge Functions** for AI generation.

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **State**: Zustand (single store at `src/store/useStore.ts` - ~2000 lines)
- **Backend**: Netlify Functions (TypeScript) + Supabase Edge Functions (Deno)
- **Database**: Supabase PostgreSQL
- **External Services**: WhatsApp API (DigitalOcean), Google Gemini AI, Neon PostgreSQL (user mapping)

### Data Flow
```
React App → Zustand Store → Supabase Client → Supabase DB
                ↓
         Netlify Functions → DigitalOcean WhatsApp Backend → Neon DB
                ↓
         Supabase Edge Functions (AI) → Google Gemini API
```

### Key Directories
- `src/store/useStore.ts` - Single Zustand store with caching, lazy loading, all business logic
- `src/services/` - API clients (Supabase, WhatsApp, AI)
- `src/pages/` - Route components (feature-specific pages)
- `netlify/functions/` - Serverless endpoints (WhatsApp proxy layer)
- `supabase/functions/` - Deno edge functions (AI generation)
- `supabase/migrations/` - Database schema migrations

## Development Workflow

### Commands
```bash
npm run dev      # Start Vite dev server
npm run build    # Build for production
npm run lint     # ESLint check
npx netlify deploy --build --prod  # Deploy to Netlify
```

### Environment Variables
Frontend (`.env` with `VITE_` prefix):
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` - Supabase connection
- `VITE_GEMINI_API_KEY` - Google Gemini (fallback, prefer edge functions)
- `VITE_PDFCO_API_KEY` - PDF generation service

Netlify Functions (set in Netlify dashboard):
- `WHATSAPP_API_BASE_URL` / `WHATSAPP_API_KEY` - WhatsApp backend
- `NEON_DATABASE_URL` - User mapping DB

Supabase Edge Functions:
- `ALLGOOGLE_KEY` - Google API key for AI generation

## Code Patterns

### Zustand Store Pattern
All data fetching goes through `useStore`. Use `lazyLoad*` methods for on-demand fetching with caching:
```typescript
const { lazyLoadReviews, reviews, isLoadingReviews } = useStore();
useEffect(() => { lazyLoadReviews(); }, []);
```

### Supabase Client
Use `executeWithRetry` wrapper from `supabaseClient.ts` for resilient DB operations:
```typescript
import { supabase, executeWithRetry } from '../services/supabaseClient';
const data = await executeWithRetry(() => supabase.from('reviews').select('*'));
```

### Netlify Functions Structure
All WhatsApp functions use shared utilities:
```typescript
import { forwardToWhatsApp, parseRequestBody, corsHeaders } from './_shared/whatsappClient';
```

### AI Generation
- **Reviews**: Use Supabase Edge Function `generate-review` (not client-side Gemini)
- **Sequences**: Can use client-side Gemini via `aiService.ts`
[Credential-related source line omitted from this reference copy.]

### Feature Flags
Routes are protected by `enabledFeatures` on User object:
```typescript
<FeatureRoute feature="reviews"><ReviewsPage /></FeatureRoute>
```
Features: `appointments`, `reviews`, `sequences`, `creatives`, `settings`

## Type Definitions
All types in `src/types/index.ts`. Key entities:
- `User` - Clinic/admin with settings, GMB link, profile types
- `Review` - Patient review with AI-generated text
- `SequenceMessage` - Scheduled WhatsApp messages
- `Appointment` - Patient appointments

## WhatsApp Integration
Frontend → `whatsappApi.ts` → Netlify Functions → DigitalOcean backend
- User IDs mapped via Neon PostgreSQL (`_shared/userLookup.ts`)
- Phone numbers auto-prefixed with `91` (India)
- QR-based authentication flow

## Database Migrations
Located in `supabase/migrations/`. Run via Supabase CLI:
```bash
supabase db push
supabase functions deploy generate-review --no-verify-jwt
```

## Common Tasks

### Adding a New Page
1. Create component in `src/pages/`
2. Add route in `App.tsx` with appropriate `ProtectedRoute`/`FeatureRoute`
3. Add navigation in `Layout.tsx`

### Adding a Netlify Function
1. Create file in `netlify/functions/`
2. Use shared utilities from `_shared/`
3. Handle CORS with `corsHeaders`
4. API routes auto-mapped: `/api/*` → `/.netlify/functions/:splat`

### Modifying Store State
Add to the Store interface and implementation in `useStore.ts`. Use caching for expensive operations.
