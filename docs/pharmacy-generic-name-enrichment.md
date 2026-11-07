# Pharmacy generic-name enrichment

Implemented on `/pharmacy/medicines` and the Medicines tab in master data management.

## Workflow

1. **Fill with Claude (10)** selects the next ten active SKUs whose `generic_name` is empty or repeats the brand/product label, ignoring case, punctuation, spacing and common dosage-form labels. Previously verified names remain protected. The current name/brand/strength/form/manufacturer/generic value must not already have a completed Claude lookup. This uses the entire loaded medicine list, independently of the visible table filters.
2. The authenticated `lookup-generic-names` server function loads actual SKU fields from the caller's clinic and calls Claude with web search. It stores complete ingredient arrays, per-ingredient strengths and source URLs in review candidates; the medicine master is not changed. The default is `claude-sonnet-5-5` and the model is configurable.
3. Show source product, manufacturer, pack, every ingredient/strength and links to retrieved sources. Old community catalogue candidates are no longer prefilled because their two composition fields can truncate combination medicines. They can be rechecked once with Claude. Ambiguous or unsupported results remain empty for manual pack review.
4. A pharmacist edits or accepts each name and checks its verification box. **Save verified** changes only confirmed SKUs, up to ten in one transaction.
5. The database checks the clinic, access permission, unchanged input snapshot and generic-name eligibility again while holding a row lock. It replaces only empty or copied-brand values after verification; existing distinct generic names and previously verified names remain protected. The original value is retained in `previous_generic_name`. Verification records the authenticated pharmacist and time.
6. Pending reviews can be reopened. Unmatched results are remembered and can be reviewed manually from the pack. Changing a lookup input allows a fresh lookup; network/provider failures do not count as completed attempts. Each completed SKU is stored separately, preserving partial progress if a larger batch times out.

## Deployment

- Apply `20261026160000_pharmacy_generic_name_reviews.sql`, `20261026180000_pharmacy_generic_name_cleanup.sql`, then `20261026190000_pharmacy_generic_name_claude.sql`. Existing deployments need only migrations not already applied. The third migration permits one replacement of unverified community results with Claude results, while preserving confirmed values.
- Deploy the Supabase function: `supabase functions deploy lookup-generic-names`. It verifies the user through Auth and uses the caller's token for all clinic reads and review writes. No service-role credential is used.
- Configure the server secret `ANTHROPIC_API_KEY` (the existing invoice-parser key can be reused). The Anthropic workspace must enable web search. API and search use are billed by Anthropic.
- Optional: `PHARMACY_GENERIC_CLAUDE_MODEL=claude-opus-5-5` selects Opus; the default is `claude-sonnet-5-5`. Keys are never sent to the frontend. Missing keys return an explicit configuration error, without a silent fallback to incomplete catalogue data.
- Build and deploy the frontend normally. The former automatic community catalogue prebuild hook has been removed; Claude lookup does not depend on those static files.
- `npm run prepare:medicine-reference` remains available for explicit prototype/data evaluation. Generated reference files are excluded from Git. The source licence is included when those files are generated.

## Web evidence and combination medicines

The server restricts search to `1mg.com`, `apollopharmacy.in` and `lupin.com`. It rejects answers without an actual search, sources not present in retrieved results, absent citations, ingredient/strength pairs not present in the cited evidence, visibly truncated ingredient lists, incomplete API responses and failed search tools. This is evidence validation, not a guarantee of clinical correctness; pharmacist verification remains mandatory.

The prompt distinguishes brand variants from strengths, including AKURIT-3 and AKURIT-4. Incoming invoice fields can be wrong: the reported stock record `AKURIT 3MG TAB` has `3mg` stored as strength. A source-backed result keeps the per-ingredient strengths and flags a stored strength that does not match them. It does not silently modify the stock name, strength or dosage form.

AKURIT-3's full composition is listed as Rifampicin 150 mg, Isoniazid 75 mg and Ethambutol 275 mg by both sources below. The initial community reference has incomplete Akurit compositions and does not contain an exact AKURIT-3 record.

- https://www.1mg.com/drugs/akurit-3-tablet-151117
- https://www.apollopharmacy.in/medicine/akurit-3-kit-tablet
- Claude model reference: https://platform.claude.com/docs/en/models/overview
- Web tool and citation protocol: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool

## Archived community prototype reference

- Repository: https://github.com/junioralive/Indian-Medicine-Dataset
- Revision: `7c06a889dc949d3b6a9be28c448f4aa1e7a2848f` (2026-06-27).
- Included: 246,068 active allopathic records with nonempty composition, split into 685 small files by the first two alphanumeric brand characters. Only the needed files are fetched on demand.
- Fields: source ID, product name, manufacturer, pack description and original composition from `short_composition1` / `short_composition2`.
- The repository carries an MIT licence. Upstream collection provenance, completeness of multi-ingredient compositions, and refresh guarantees are not established by its README. Pharmacist verification against the physical pack is required.
- Matching uses name normalization and conservative spelling similarity within the fetched prefixes; known strength, dosage form, release suffix and named combination variants constrain candidates. Scores rank candidates; they are not clinical confidence estimates.
- There is no unrestricted LLM generation and no inference of missing ingredients. When the catalogue is incomplete, the pharmacist must enter the full composition from the pack.

## Production provider evaluation — 26 October 2026

This evaluates published documentation. No vendor account was created, no purchase made, no vendor contacted, and no authenticated coverage benchmark was possible without credentials.

| Criterion | MIMS/CIMS Integrated | DrugSetu |
| --- | --- | --- |
| Published India coverage | India explicitly listed among supported regions | India-specific catalogue and brand/salt/company search advertised |
| Integration | API for healthcare systems; product information and clinical decision support | REST API example using `X-API-Key`; developer account and sandbox access advertised |
| Data governance evidence | Published editorial process and clinical modules | Advertises manufacturer-origin data and review workflows, but the manufacturer dashboard is also labelled not yet released |
| Current limitations | Public documentation does not provide a testable India catalogue endpoint, full schema, price or caching terms | Early-access language; some functions such as barcode/SKU matching are upcoming. Published marketing counts have not been independently verified |
| Production decision | First candidate for a licensed clinical catalogue trial | Alternative candidate for a medicine master lookup trial, subject to evidence of source provenance and actual SKU coverage |

Sources:

- https://cds.mims.com/mims-integrated/ — India region, API integration, editorial process and product modules.
- https://cds.mims.com/ — India CIMS deployment testimonial and sales contact.
- https://drugsetu.com/ — composition search, example API, sandbox access, early-access status and upcoming features.

### Trial acceptance requirements

Use at least 100 representative clinic SKUs, including Indian brands, fixed-dose combinations, brand suffixes, SR/ER variants, paediatric liquids, injections and misspellings. Measure exact product coverage, correct full composition, ambiguous matches and no matches separately. Do not count a similar brand as an exact match.

Before selecting a provider, obtain its India schema and sandbox credentials; stable product/ingredient identifiers; per-ingredient strengths and units; manufacturer and dosage form; withdrawal/update handling; permission to persist pharmacist-confirmed names and provenance; caching and redistribution terms; and commercial pricing/SLA. Do not add guessed endpoints or response mappings to production code.

The lookup and review layers are separate (`genericNameService` and `GenericNameFill`), so a licensed backend provider can replace community retrieval while retaining pharmacist review and the database save guards. Vendor keys must stay in a server-side integration.

## Checks

`node --test tests/pharmacy-generic-names.test.mjs` exercises matching distinctions and the real migration against an isolated PostgreSQL engine, including verification, repeated lookups, no-match history, changed records, tenant isolation, permissions and the ten-SKU cap. It does not access production data.

`npm run test:pharmacy:generic-names` also runs mocked Claude/API tests covering all three AKURIT-3 ingredients, cited evidence, absent/incorrect strengths, omitted ingredients, invented URLs, auth/clinic isolation, cache reuse and truncated responses. No live Anthropic call is made by these tests.

The cleanup regression uses a real PostgreSQL dosage-form enum. The original RPC's `coalesce(med.dosage_form, '')` raises `22P02` (empty string is not a valid enum label), corresponding to a PostgREST HTTP 400. The forward migration casts `dosage_form::text` before coalescing. It also verifies copied-brand cleanup, preservation of the old generic value before approval, changed-value protection, and compatibility with the earlier five-field request snapshot. Browser errors now include the database code, details and hint.

The two reported examples, `ACIVIR 400 DT` and `AKILOS 100MG TAB`, both qualify for copied-brand cleanup and retrieve matching catalogue products from the pinned reference. Duplicate release suffixes in the medicine name and brand field are deduplicated during matching.

A lookup smoke check against the generated source returned candidates for 9 of 10 sample brand queries (Dolo, Augmentin 625 Duo, Dolo 650, Pan 40, Crocin 650, Nexpro RD 40, Azithral 500, Telma 40, Glycomet 500 and Calpol 500). Crocin 650 returned no candidate. This checks retrieval only; it is not a clinical accuracy estimate or a representative coverage benchmark, and it does not evaluate the paid vendors.
