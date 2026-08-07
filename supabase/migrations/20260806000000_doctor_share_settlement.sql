# AI features (authenticated — normal deploy)
supabase functions deploy ai-discharge-summary
supabase functions deploy ai-charge-capture

# IPD PDF fix (permanent-save bug fix from the PDF audit)
supabase functions deploy generate-ipd-pdf

# Patient upload portal — PUBLIC, so deploy WITHOUT JWT verification
supabase functions deploy patient-upload --no-verify-jwt