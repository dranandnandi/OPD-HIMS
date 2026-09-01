# IPD Packages — amount-split caps, standard charge heads, and auto-residual breakup

Status: **implemented 2026-08-27/28** — migrations written, not yet applied to any database.
Run `supabase/tests/package_split_caps_test.sql` against a seeded clinic to verify.

---

## 1. Current state (verified in code)

### 1.1 Amount caps already exist — the *semantics* are wrong

`package_items.max_amount` is present in the schema, the resolver, the service layer and the
masters UI. It is **not** missing. What is wrong is that every cap is *all-or-nothing per
posting*.

`fn_resolve_coverage` (`supabase/migrations/20260707100016_reapply_coverage.sql`):

```sql
IF v_item.max_amount IS NOT NULL AND v_covered_amt + p_net_amount > v_item.max_amount THEN RETURN; END IF;
```

`RETURN` = not covered at all. So a ₹2,000 pathology cap with postings of ₹1,500 then ₹800
covers ₹1,500 and bills the whole ₹800 to the patient, leaving ₹500 of allowance permanently
unused.

The same all-or-nothing flaw applies to:

| Cap | Where | Today | Wanted |
|---|---|---|---|
| `package_items.max_amount` | per inclusion rule | whole charge drops out | absorb up to the limit, bill the excess |
| `package_items.max_quantity` | per inclusion rule | whole charge drops out | cover N units, bill the rest |
| `packages.per_day_bed_cap` | package level | room rent above cap fully uncovered | cover cap × days, bill the difference |
| `packages.implant_cap` | package level | implant fully uncovered | cover up to cap, bill the excess |

### 1.2 There is no package → itemised breakup at all

`generate_ipd_bill` emits exactly one line per package: `'<name> (package)'` at
`agreed_price`. `packageService.convertToItemized()` is a *different* thing — it abandons the
package price and bills the real charges, which is not what a TPA claim needs.

### 1.3 Standard charge heads are half-present

Seeded groups: `BED, CONS, INV(-PATH,-RAD), PROC(-DRESS,-MINOR,-OT), PHARM(-DRUG,-CONSUM,-IMPLANT), SUPPORT, MISC`.

Missing service codes needed for a surgical-package breakup: surgeon fee, assistant surgeon,
anaesthetist fee, OT / theatre charge, blood bank, oxygen / equipment, physiotherapy, and the
residual head itself. `PROC-OT` exists as a group with no services under it.

---

## 2. Requirements

### R1 — Cap mode radio: split by amount, or exclude the whole charge

Per inclusion rule (with a package-level default), a radio choosing:

- **Split at limit** — the package absorbs whatever allowance is left; the excess becomes a
  separate patient-payable charge.
- **Exclude whole charge** — today's behaviour: a charge that would breach the cap falls out
  entirely and the remaining allowance stays unused.

Worked example, cap ₹2,000, already consumed ₹1,500, new charge ₹6,000:

| Mode | Absorbed by package | Billed to patient |
|---|---|---|
| Split at limit | ₹500 | ₹5,500 |
| Exclude whole charge | ₹0 | ₹6,000 |

### R2 — Auto-calculating residual charge head

The package price must be presentable as an itemised claim. Components are listed at tariff;
a designated **residual charge code** always holds

```
residual = agreed_price − SUM(all other component lines)
```

and **recomputes live** every time a component is added, edited or removed. Worked example:
package ₹250,000, components (pathology ₹2,000 + room rent ₹25,000 + …) = ₹200,000, so the
residual head shows ₹50,000. Add a ₹10,000 component and the residual immediately becomes
₹40,000. The breakup therefore always totals exactly the package price.

### R3 — Seed the standard heads

Surgeon fee, assistant surgeon, anaesthetist, OT charge, nursing care, blood bank, oxygen /
equipment, physiotherapy, plus the residual head — so a breakup can be built from real service
codes rather than free text.

---

## 3. Design

### 3.1 Split-capable caps

`fn_resolve_coverage` stops returning a boolean and starts returning a **rupee amount** the
package absorbs for this posting:

```
o_covered_amount = 0            → not covered
                 = net_amount   → fully covered (today's happy path)
                 = 0 < x < net  → partial: split required
```

Headroom is `LEAST(remaining_allowance, p_net_amount)`. Quantity caps compute headroom in units
and convert at `unit_rate`; bed cap becomes `per_day_bed_cap × quantity`; implant cap likewise.
When the matched rule's `cap_mode = 'block'`, any partial result is floored to 0 — that is
exactly today's behaviour, preserved.

**Splitting mechanism.** `BEFORE INSERT` sets `covered_by_package = (covered_amount > 0)` and
stashes the amount. A new `AFTER INSERT` trigger, when `0 < covered_amount < net_amount`:

1. shrinks the parent row to the covered amount, apportioning `quantity`, `gross_amount` and
   `discount_amount` pro-rata;
2. inserts a sibling **excess row** carrying the remainder, with `split_parent_id = parent` and
   `covered_by_package = false`.

Rows with `split_parent_id IS NOT NULL` short-circuit the resolver, so there is no recursion.

Every row therefore stays cleanly covered-or-not. Nothing downstream — bill generation, the
consumption rollup, `GroupedPostings`, the PDF — has to learn about fractional coverage. This is
the main reason to split rows rather than add a `covered_amount` column that every consumer
would have to respect.

**Three split styles**, so each printed line reads correctly. Money is authoritative in all
three — the covered half is exactly the allowance, to the paisa.

| Cap | Style | Result |
|---|---|---|
| `qty_cap` | split the units | rate preserved on both halves; 2 of 3 units covered |
| `bed_cap` | split the rate | days preserved on both halves; ₹6,000/day x 4 against a ₹5,000 cap → 4 x ₹5,000 covered, 4 x ₹1,000 to the patient |
| `amount_cap`, `implant_cap` | split the money | covered half keeps the quantity (per-rule qty accounting reads it); the patient-visible excess is one readable line |

Descriptions are suffixed "(within package limit)" and "(above package limit)" so a ward clerk
seeing one lab test twice understands why.

**Hazards that must be handled (easy to get wrong):**

- `reapply_package_coverage` must **merge split children back into their parents first**
  (pending rows only; billed rows are never touched), then re-resolve. Otherwise the
  "Re-evaluate rules" button leaves stale fragments and double-counts consumption.
- Cancelling a parent must cascade `cancelled` to its split children.
- The `CHECK (net_amount = gross_amount - discount_amount)` constraint must hold on both halves
  after apportioning — round the parent, give the remainder to the child.
- `charge_postings_fill_defaults` only recomputes `gross_amount` when it is 0, so the split must
  write gross explicitly.

### 3.2 Residual as a live-computed charge head

Not a static template row — a derived line.

- `services_master.is_package_residual boolean` flags the head (seeded as `PKG-RESID`, but a
  clinic can point it at Nursing Care Charges or any head it prefers).
- `packages.residual_service_id` overrides the clinic default per package, and
  `packages.residual_label` overrides what that line **prints as** — so the head can stay a real
  charge code for MIS while the annexure reads "Nursing & Hospital Services", or whatever the
  payer expects. On an individual admission the residual line can also be renamed inline;
  recomputes never touch `description`, so the name survives every rebalance (a full rebuild
  resets it to the package default).
- The residual line in a breakup carries `is_residual = true` and its amount is **never entered
  by hand**. A trigger on the breakup-lines table recomputes it on every insert/update/delete of
  a sibling row:

```
residual.net := agreed_price − COALESCE(SUM(net) FILTER (WHERE NOT is_residual), 0)
```

  with a recursion guard so the residual's own update does not re-fire the recompute.
- The same live arithmetic runs in the masters template preview and in the admission-level
  editor, so the number the user sees while editing is the number that gets stored.

**Negative residual.** If components exceed the package price the residual goes negative. The
line renders red and the value is allowed to stand *while editing*, but generating the claim is
blocked until it is non-negative or the user explicitly accepts a negative
`'Package adjustment'` line. Silently scaling every component down is rejected: a TPA
reconciles line-by-line and shrunken tariffs read as fabrication.

### 3.3 Breakup engine

New tables:

- `package_breakup_rules(package_id, service_id | charge_group_id, mode, value, sort_order)`,
  `mode` in `('percent','fixed')` — an optional template so a package can carry a standard shape
  (Surgeon 25%, OT 15%, Anaesthesia 8%, …). A row targets **either a charge head or one
  service**: heads are the common case, because several of them (Investigations, OT Charges)
  are groups with no service of their own to point at — a service-only picker looked broken
  when you searched "investigations" and got nothing back. The residual is *not* a rule row;
  it is the flagged head and is always computed.
- `admission_package_breakup_lines(...)` — the per-admission snapshot, so a claim stays
  reproducible after tariffs change.

`fn_generate_package_breakup(p_assignment_id)`:

1. aggregate covered postings **by charge group / head** at tariff (D2);
2. apply any `fixed` / `percent` template rows;
3. write the residual head via the trigger in 3.2;
4. assert the lines sum **exactly** to `agreed_price`, `RAISE EXCEPTION` otherwise; the last
   non-residual line absorbs rounding.

Charges that were *never* covered (exclusions, cap excess from R1) are not part of the breakup —
they are already separate patient-payable itemised lines and must not be double-counted.

### 3.4 Where the break-up is printed

**As built, `generate_ipd_bill` is untouched.** Because D1 keeps the break-up off the patient
bill entirely, adding `ipd_bills.presentation` and a `'package_breakup'` line type would have
bought nothing — the break-up never needs to live on an `ipd_bill`. Instead it is its own
document: `documentService.printPackageBreakup()` renders an A4 **Claim Annexure** on the
clinic letterhead from `admission_package_breakup_lines`, ending in the residual line and
totalling the agreed price.

Nothing on the printed page marks the residual as a balancing figure — no italics, no
explanatory footnote, and the seeded head is named **Hospital & Nursing Services**, not
"Package Residual". The word "residual" lives in the `PKG-RESID` service code, the
`is_package_residual` flag and the on-screen editor only. A payer sees an ordinary head.

This is strictly less invasive than the original plan: bill generation, bill totals and the
existing bill PDF are all unchanged.

---

## 4. Schema changes

```
charge_postings      + split_parent_id uuid REFERENCES charge_postings(id) ON DELETE CASCADE
                     + split_reason text   -- amount_cap | qty_cap | bed_cap | implant_cap
                     + split_origin jsonb  -- pre-split parent, on the CHILD, for exact merge-back
package_items        + cap_mode text CHECK (cap_mode IN ('split','block'))   -- NULL = inherit
packages             + default_cap_mode text NOT NULL DEFAULT 'split'
                     + residual_service_id uuid REFERENCES services_master(id)
                     + residual_label text     -- what the residual line PRINTS as
                     + breakup_grain text NOT NULL DEFAULT 'charge_group'
services_master      + is_package_residual boolean NOT NULL DEFAULT false
                       (+ unique partial index: one residual head per clinic)
NEW package_breakup_rules(id, clinic_id, package_id, service_id, mode, value, sort_order)
NEW admission_package_breakup_lines(id, clinic_id, assignment_id, service_id, charge_group_id,
                                    charge_group_path, description, quantity, unit_rate, net,
                                    is_residual, source, sort_order)
```

Migrations, in order:

| File | Contents |
|---|---|
| `20260827000000_package_split_caps.sql` | `fn_resolve_coverage` v3 (returns a rupee amount), `fn_split_posting`, split / cancel-cascade triggers, `merge_split_postings`, `reapply_package_coverage` v2 |
| `20260827000100_standard_charge_heads.sql` | `is_package_residual` column, `seed_ipd_standard_heads()`, and a pass that seeds every existing clinic |
| `20260827000200_package_breakup.sql` | break-up tables, `fn_residual_service`, `recompute_package_residual`, residual triggers, `fn_generate_package_breakup`, RLS |

Note: `cap_mode` defaults to `'split'`, which **changes behaviour for existing packages** — this
is the intended choice (see D3), and safe here because no admissions are live.

---

## 5. Phases and file map

| Phase | Work | Files | Done |
|---|---|---|---|
| 1 | Split-capable caps: resolver returns an amount, split triggers, re-apply merge-back, cancel cascade | `20260827000000_package_split_caps.sql` | ✅ |
| 2 | Seed standard heads (surgeon, assistant, anaesthetist, OT, nursing care, blood bank, oxygen, physio, `PKG-RESID`) | `20260827000100_standard_charge_heads.sql` | ✅ |
| 3 | Cap-mode radios + clearer cap labels in masters | `components/Masters/PackagesTab.tsx` | ✅ |
| 4 | Break-up engine: tables, residual trigger, `fn_generate_package_breakup` | `20260827000200_package_breakup.sql` | ✅ |
| 5 | Break-up template card (masters) and claim annexure modal (admission) | `PackagesTab.tsx`, new `components/Packages/PackageBreakupModal.tsx`, `pages/AdmissionDetailsPage.tsx` | ✅ |
| 6 | Service layer | `services/packageService.ts`, `types/ipd.ts` | ✅ |
| 7 | Claim annexure print | `services/documentService.ts` (`printPackageBreakup`) | ✅ |
| 8 | Verification script | `supabase/tests/package_split_caps_test.sql` | ✅ |

`PackageMonitor` also gained a **Claim break-up** button, and split rows in the charge list carry
a `SPLIT` badge so a ward clerk seeing one lab test twice understands why.

### Not built

- Remaining-allowance-per-rule readout in `PackageMonitor`. The `SPLIT` badge and the
  consumed/agreed bar cover the common case; a per-rule breakdown needs its own query and was
  not part of the ask.

---

## 6. Verification

`supabase/tests/package_split_caps_test.sql` runs inside a transaction and rolls back. It needs a
clinic that has been through `seed_ipd_masters()` and `seed_ipd_standard_heads()`, plus one
patient and one profile.

```
psql "$DATABASE_URL" -f supabase/tests/package_split_caps_test.sql
```

Covered cases:

1. Amount cap ₹2,000, postings ₹1,500 then ₹6,000, `split` → ₹2,000 absorbed, ₹5,500 patient.
2. Same in `block` → ₹1,500 absorbed, ₹6,000 patient, allowance unused.
3. Quantity cap 2 units against a 3-unit charge → 2 covered, 1 billed.
4. Room rent ₹6,000/day x 4 against a ₹5,000 bed cap → ₹20,000 covered, ₹4,000 patient, both
   halves keeping 4 days.
5. Re-apply twice — consumption unchanged, exactly one split child (the merge-back path).
6. Cancelling the covered half cancels its excess half.
7. Break-up totals the agreed price; residual absorbs the balance.
8. Adding a component rebalances the residual by itself.
9. Changing the agreed price rebalances the residual.

Guarded in code but not exercised by the script: negative residual blocks printing (UI), and
billed postings are never re-split or merged (`fn_split_posting` and `merge_split_postings` both
filter on `status = 'pending'`).

---

## 7. Decisions (settled 2026-08-27)

- **D1 — Breakup scope: TPA / claim copy only.** The patient bill keeps one clean package line;
  the breakup is generated for the claim, with a print toggle. `ipd_bills.presentation` defaults
  to `'package'` and the claim path passes `'itemized_breakup'`. Totals are identical either way.
- **D2 — Breakup grain: charge group / head.** One line per head — Investigations, Room Rent,
  OT Charges, Surgeon Fee, …, Residual. Service-code grain is not built for now; if a payer ever
  demands it, add the per-package override described in §3.3.
- **D3 — `cap_mode` defaults to `'split'` for existing packages too.** Every configured cap
  starts splitting on deploy; no re-editing of existing packages. **Deploy note:** this changes
  billing behaviour for in-flight admissions, so ship it when no unbilled cap-breaching charges
  are mid-flight, or run `reapply_package_coverage` per open admission straight after the
  migration and reconcile.

### Still open

- **Q4** — Should the residual head be excluded from doctor-share / cost-centre MIS? It is a
  balancing figure, not real revenue attribution. Default assumption until told otherwise:
  **excluded** — flag it so the contracts engine skips it.
