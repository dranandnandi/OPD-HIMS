# M4 — National Healthcare Providers Registry (NHPR)

Written 2026-08-27, correcting a misidentification that had persisted since
2026-08-20.

## What M4 actually is

**M4 is NHPR integration — not NHCX claims.** Earlier documents in this folder
said "M4 = National Health Claims Exchange"; that was wrong, and every plan
built on it (defer until cashless/insurance is commercially justified, reuse
`billingService`) was reasoning about the wrong milestone.

NHPR is the national registry of:

- **Healthcare professionals** — across Modern Medicine, Dentistry, Ayurveda,
  Unani, Siddha, Sowa-Rigpa, Homeopathy, and Nurse practitioners.
- **Health facilities** — hospitals, clinics, diagnostic labs, imaging centres,
  pharmacies, blood banks.

Integrating M4 means a clinic can **register professionals and facilities from
inside this application**, instead of being sent to the NHA portal.

## We are already partly in M4

The HFR facility APIs are M4's facility half, and they are already documented
here from `abdm guidlines/HFR_Documentation_SBX_Updated_08_04_2026...pdf`:

- `m2-prerequisites.md` §10 — onboarding sequence, the HPR-ID prerequisite,
  `MutipleHRPAddUpdateServices` bridge linkage, the 15-character `hipName` rule.
- `20260826000000_clinic_hfr_identity.sql` — `hfr_facility_id`, `abdm_hip_id`
  and friends on `clinic_settings`.

What we do **not** hold is the **HPID / HPR professional-registration** API
documentation. That is the missing half.

## Prerequisites, and why they are the long pole

1. **M1, M2 and M3 must be complete first.** M4 cannot start early.
2. **NHA must assign two roles to our client ID:** `HPID` and `HFR`. Neither is
   enabled by default, and this is a request to NHA, not a setting.
3. **Security audit report plus VAPT report** must be submitted.
4. **A video recording of the implemented workflow** goes to NHA.
5. **Functional testing with the NHPR team**, arranged by writing to
   `abdm.texp1@nha.gov.in` and `facility.abdm@nha.gov.in`.

Points 3–5 are calendar time, not engineering time. The security audit and VAPT
in particular should be scheduled long before M4 code is ready, because they
gate M4 and are procured externally.

## Where the documentation lives

`https://hspsbx.abdm.gov.in/home` → **Resource Center → API Documentation**
(registration steps and the portal walkthrough).

Test cases: `https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=TestCases`

**To fetch:** the HPID/HPR professional-registration API spec, and the M4 test
cases in the same form as the M1 sheet
(`m1-functional-test-coverage.md` shows how much that changes a plan).

## The HPR ID — needed *now*, not at M4

This is worth separating from the rest, because it blocks facility onboarding
today rather than at M4:

> Create an **HPR ID (HPID)** at `https://hspsbx.abdm.gov.in/` using **Aadhaar
> or Driving Licence**, with role **Facility Manager**, then set a password and
> generate an **HPR token**. The token is passed as `x-hprid-auth` on the HFR
> facility APIs.

So the HFR facility APIs authenticate as a **named person**, not as the
integrator. Sample from the HFR doc shows an HPR id in ABHA-like format:
`71-2325-3152-8712`.

### Can it use the same mobile / Aadhaar as an existing ABHA?

**Yes — HPR and ABHA are different registries, and one person legitimately holds
both.** Creating an HPR ID does not consume, conflict with, or replace an ABHA
on the same Aadhaar or the same mobile number. A practising doctor is expected
to have an ABHA as a patient *and* an HPR ID as a professional.

Two things that genuinely matter more than the number reuse:

1. **It must be the real professional's own identity.** An HPR ID is a
   professional credential — it asserts that a named, qualified person practises
   medicine. It should be created by the doctor it describes, with their own
   Aadhaar, not with a shared or convenience identity.
2. **Sandbox and production are separate.** Create sandbox HPR IDs at
   `hspsbx.abdm.gov.in`; production is `nhpr.abdm.gov.in`. FAQ Q22 warns
   explicitly against mixing them.

**Not verified, because we do not hold the HPR API doc:** whether one Aadhaar
may hold more than one HPR ID (e.g. one per role or per system of medicine).
Assume one per person until NHA's HPR documentation says otherwise — and if a
second is ever needed, that is a question for NHA, not something to discover by
trying.


---

## Registered identities — as at 2026-08-27

From the HFR "To Whom It May Concern" verification form
(`abdm guidlines/new document/copy of form.pdf`, digitally signed 2026-08-26,
reason "HFR Facility Registration"):

| Field | Value |
|---|---|
| Facility ID | `IN2410002622` |
| Facility name **as registered in HFR** | **`Meditrust Clinics`** |
| State / District | Gujarat / Ahmedabad |
| Ownership / Type | Private / Clinic-Dispensary |
| Submitted | 26-08-2026 |
| **Healthcare Professional ID (HPR ID)** | **`71-6118-7122-5361`** |
| Applicant | Priyadarshi Anand, 9909249725, ajpriyadarshi@gmail.com |

**The HPR ID prerequisite is already satisfied** — it did not need creating. It
is the credential the HFR facility APIs take as `x-hprid-auth`.

### Two traps in that form

1. **The HFR facility name is `Meditrust Clinics`**, but `clinic_settings.clinic_name`
   says `Meditrust Clinic Shela`. The bridge-linkage API
   (`MutipleHRPAddUpdateServices`) takes `facilityName` and matches it against
   the HFR record — **send the HFR spelling, not ours**.
2. **`hipName` is capped at 15 characters.** `Meditrust Clinics` is 17, so it
   cannot be used verbatim. `Meditrust Shela` is exactly 15; `Meditrust` is 9.

### Status

The form is a request that NHA "verify that the health facility actually exists
and give approval to that effect so that the facility can be **validated for
existence** on the portal". So the facility is **submitted, not yet validated**.

Software Linkage — and therefore the HIP ID — most likely cannot complete until
that validation lands. The provisional `abdm_hip_id = IN2410002622` currently in
`clinic_settings` stays provisional until the portal confirms it.

---

## Software Linkage completed — 2026-09-01

Linkage did **not** wait for facility validation. The facility still shows as
*submitted*, yet the Software Linkage form accepted the bridge and ABDM minted
the HIP ID. The 2026-08-27 assumption that linkage was gated on validation was
wrong — worth remembering, because it cost a week of treating M2 as blocked.

### Registered HIP details, as ABDM now holds them

| Field | Value |
|---|---|
| Bridge ID | `SBXID_027467` |
| Bridge name | Anpro Solutions pvt ltd |
| Callback URL | `https://clinic.anprohealthtech.com/functions/v1/abdm-callback` |
| **HIP ID** | **`IN2410002622`** — confirmed, no longer provisional |
| HIP Name | `Meditrust Clinics` |
| Type | HIP |

Two things this settles:

1. **HIP ID equals the HFR facility ID** for this facility. The provisional
   value we had been carrying in `clinic_settings.abdm_hip_id` was correct.
   Do not assume this holds for every facility — it is one observation.
2. **The registered callback is the BASE only**, as FAQ Q30 requires. ABDM
   appends its own path. Confirmed visually on the portal, not just intended.

### The 15-character hipName rule does not hold on the portal

`Meditrust Clinics` is **17 characters** and the portal accepted it. The 15-char
cap in the HFR API documentation (§10, `MutipleHRPAddUpdateServices`) is either
specific to the API route or simply unenforced on the portal.

Consequence: `20260826000000_clinic_hfr_identity.sql` constrained
`abdm_hip_name` to `^[A-Za-z0-9 ]{1,15}$`, which **rejects the value ABDM itself
holds**. `20260901000000_hip_name_length.sql` raises it to 50.

The planning note in earlier docs to use `Meditrust Shela` is therefore moot —
and would have been actively wrong, since the column must mirror ABDM's record
rather than our preferred spelling. What patients see in the ABHA app is
`Meditrust Clinics`.

### Still open

- The facility remains **submitted, not validated**. Unclear what validation
  gates now that linkage has passed — ask NHA rather than assume.
- The portal offers **Manage QR** against this HIP. That QR is ABDM's own
  rendering of the scan-and-share payload and should settle the
  `hipId`/`hipid` casing question recorded as gotcha #5 in
  `session-log-2026-08-26.md`. Decode it and compare against what
  `scanAndShareService.ts` emits before trusting our version.
