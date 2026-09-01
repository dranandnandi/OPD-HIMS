import { supabase } from '../utils/supabase';
import { docTypeLabel } from './documentService';
import { DocumentField } from './documentVoiceService';
import { ComposeSubject, subjectFromAdmission } from './documentSubject';
import type { ServiceMaster } from '../types/ipd';

export type { ComposeSubject, TariffTarget } from './documentSubject';
export { subjectFromAdmission } from './documentSubject';

// ---------------------------------------------------------------------------
// "Write with AI" for IPD documents.
//
// The clinician types a brief ("typhoid fever, 5 days, conservative") and the
// AI drafts the document's own sections. For an estimate it also returns a
// costed line list — but it only ever picks *which* services and *how many*;
// every rupee figure for a catalog line comes from this clinic's rate card,
// resolved for the admitted bed class, and every total is computed here. The
// model is never asked to do arithmetic on money.
// ---------------------------------------------------------------------------

/** Doc types that get the costing engine rather than prose alone */
const COSTED_DOC_TYPES = new Set(['estimate']);

export const isCostedDocType = (docType: string): boolean => COSTED_DOC_TYPES.has(docType);

export interface EstimateLine {
  label: string;
  /** set when the line is priced from the clinic's own catalog */
  serviceCode: string | null;
  category: string;
  unitRate: number;
  quantity: number;
  /** true → the line recurs every day of stay */
  perDay: boolean;
  note: string;
  /** true → unitRate is the model's approximation, not a tariff rate */
  estimated: boolean;
}

export interface AiComposeResult {
  sections: Array<{ fieldId: string; heading: string; text: string; mode: 'replace' | 'append' }>;
  removeSections: Array<{ fieldId: string; reason: string }>;
  estimate: {
    stayDays: number;
    lines: EstimateLine[];
    assumptions: string;
    excluded: string[];
  } | null;
  summary: string;
}

/** What the clinic charges per patient-day today, by service type */
export interface DailyBenchmark {
  text: string;
  perDayTotal: number;
  sampleAdmissions: number;
}

// ---------------------------------------------------------------------------
// Tariff snapshot
// ---------------------------------------------------------------------------

/** Order the catalog so the heads an estimate always needs come first, and
    cap it — a clinic with a 2,000-line master would otherwise blow the prompt */
const TYPE_PRIORITY: Record<string, number> = {
  bed: 0, nursing: 1, consultation: 2, procedure: 3, surgery: 4,
  lab: 5, imaging: 6, equipment: 7, consumable: 8, implant: 9,
  pharmacy: 10, misc: 11,
};
const CATALOG_LIMIT = 220;

// The shared Database type carries no Functions map, so supabase.rpc() types
// its args as never. Cast once here rather than widening the app-wide client.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export interface TariffSnapshot {
  bedClass: {
    name: string;
    code: string | null;
    dailyRent: number | null;
    roomRentCode: string | null;
    nursingRate: number | null;
    nursingCode: string | null;
  };
  payer: string | null;
  benchmark: DailyBenchmark | null;
  catalog: Array<{ code: string; name: string; type: string; unit: string; rate: number }>;
}

/**
 * Every rate the estimate may quote, already resolved for the bed class being
 * quoted (explicit class rate → class multiplier → base price).
 */
export async function buildTariffSnapshot(subject: ComposeSubject): Promise<TariffSnapshot> {
  const { clinicId, tariff } = subject;

  const [{ data: services }, benchmark] = await Promise.all([
    supabase
      .from('services_master')
      .select('id, service_code, name, service_type, unit, base_price')
      .eq('clinic_id', clinicId)
      .eq('is_active', true),
    loadBenchmark(clinicId, tariff.bedTypeId),
  ]);

  const rows = (services ?? []) as Array<
    Pick<ServiceMaster, 'id' | 'service_code' | 'name' | 'service_type' | 'unit' | 'base_price'>
  >;

  const ranked = [...rows].sort((a, b) => {
    const pa = TYPE_PRIORITY[a.service_type] ?? 99;
    const pb = TYPE_PRIORITY[b.service_type] ?? 99;
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
  });

  // Keep the quoted class's own room-rent / nursing services even if the
  // catalog cap would otherwise cut them.
  const mustKeep = new Set(
    [tariff.roomRentServiceId, tariff.nursingServiceId].filter(Boolean) as string[]
  );
  const chosen = [
    ...ranked.filter((s) => mustKeep.has(s.id)),
    ...ranked.filter((s) => !mustKeep.has(s.id)).slice(0, CATALOG_LIMIT - mustKeep.size),
  ];

  const rates = await resolveRates(
    chosen.map((s) => s.id),
    tariff.tariffPlanId,
    tariff.bedTypeId
  );

  const catalog = chosen
    .map((s) => ({
      code: s.service_code,
      name: s.name,
      type: s.service_type,
      unit: s.unit || 'each',
      rate: rates.get(s.id) ?? (Number(s.base_price) || 0),
    }))
    .filter((c) => c.rate > 0);

  const byId = new Map(chosen.map((s) => [s.id, s]));
  const roomRent = tariff.roomRentServiceId ? byId.get(tariff.roomRentServiceId) : undefined;
  const nursing = tariff.nursingServiceId ? byId.get(tariff.nursingServiceId) : undefined;

  return {
    bedClass: {
      name: tariff.bedClassLabel,
      code: tariff.bedTypeCode,
      dailyRent: roomRent ? rates.get(roomRent.id) ?? null : null,
      roomRentCode: roomRent?.service_code ?? null,
      nursingRate: nursing ? rates.get(nursing.id) ?? null : null,
      nursingCode: nursing?.service_code ?? null,
    },
    payer: tariff.payerName,
    benchmark,
    catalog,
  };
}

/** One round trip for the whole catalog — the per-service RPC is unusable here */
async function resolveRates(
  serviceIds: string[],
  tariffPlanId: string | null,
  bedTypeId: string | null
): Promise<Map<string, number>> {
  if (serviceIds.length === 0) return new Map();
  const { data, error } = await rpc('resolve_tariff_rates_bulk', {
    p_service_ids: serviceIds,
    p_tariff_plan_id: tariffPlanId,
    p_bed_type_id: bedTypeId,
  });
  // Missing migration / RLS hiccup must not kill the feature — base prices
  // are then used, which the caller already has.
  if (error) return new Map();
  return new Map(
    ((data ?? []) as Array<{ service_id: string; rate: number }>).map((r) => [
      r.service_id,
      Number(r.rate) || 0,
    ])
  );
}

const CURRENCY = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** The clinic's own per-patient-day billing, phrased for the prompt */
async function loadBenchmark(
  clinicId: string,
  bedTypeId: string | null
): Promise<DailyBenchmark | null> {
  const { data, error } = await rpc('ipd_daily_charge_benchmark', {
    p_clinic_id: clinicId,
    p_bed_type_id: bedTypeId,
    p_admissions: 40,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const rows = data as Array<{
    service_type: string; per_day_avg: number; sample_admissions: number;
  }>;
  const total = rows.reduce((sum, r) => sum + (Number(r.per_day_avg) || 0), 0);
  if (total <= 0) return null;

  const breakdown = rows
    .filter((r) => Number(r.per_day_avg) > 0)
    .map((r) => `${r.service_type} ${CURRENCY(Number(r.per_day_avg))}`)
    .join(', ');

  return {
    perDayTotal: total,
    sampleAdmissions: Number(rows[0].sample_admissions) || 0,
    text:
      `${CURRENCY(total)} per patient-day on average across the last ${rows[0].sample_admissions} `
      + `comparable admissions (${breakdown}). Aim within ±25% of this unless the case is clearly heavier.`,
  };
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

export const lineAmount = (line: EstimateLine, stayDays: number): number =>
  line.unitRate * line.quantity * (line.perDay ? Math.max(1, stayDays) : 1);

export const estimateTotal = (lines: EstimateLine[], stayDays: number): number =>
  lines.reduce((sum, l) => sum + lineAmount(l, stayDays), 0);

const CATEGORY_LABEL: Record<string, string> = {
  bed: 'Bed / room rent', nursing: 'Nursing', consultation: 'Consultation',
  lab: 'Laboratory', imaging: 'Radiology & imaging', procedure: 'Procedures',
  surgery: 'Surgery / OT', pharmacy: 'Pharmacy & IV fluids',
  consumable: 'Consumables & disposables', implant: 'Implants',
  equipment: 'Equipment', misc: 'Other charges',
};

const CATEGORY_ORDER = [
  'bed', 'nursing', 'consultation', 'lab', 'imaging', 'procedure',
  'surgery', 'implant', 'pharmacy', 'consumable', 'equipment', 'misc',
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TD = 'padding:4px 6px;border:1px solid #ccc';
const TH = `${TD};text-align:left;background:#f1f5f9`;

export type EstimateDetail = 'detailed' | 'broad';

/** One rolled-up head of a broad estimate */
export interface EstimateHead {
  category: string;
  label: string;
  basis: string;
  amount: number;
  items: EstimateLine[];
}

const pricedOnly = (lines: EstimateLine[]) =>
  lines.filter((l) => l.unitRate > 0 && l.quantity > 0);

const headOf = (line: EstimateLine) =>
  CATEGORY_ORDER.includes(line.category) ? line.category : 'misc';

/** "CBC ×2, LFT ×2, KFT +2 more" — what sits inside a rolled-up head */
const itemsPhrase = (items: EstimateLine[], max = 3): string => {
  const names = items.map((l) => `${l.label}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`);
  const rest = names.length - max;
  return rest > 0 ? `${names.slice(0, max).join(', ')} +${rest} more` : names.join(', ');
};

/**
 * Itemised lines → one row per head, which is how most families and TPAs want
 * to read a quote: stay, nursing, doctor, investigations, medicines. Nothing
 * about the money changes — every line is still priced off the clinic's rate
 * card and only the printing is collapsed.
 */
export function rollUpToHeads(lines: EstimateLine[], stayDays: number): EstimateHead[] {
  const days = Math.max(1, stayDays);
  const buckets = new Map<string, EstimateLine[]>();
  for (const line of pricedOnly(lines)) {
    const cat = headOf(line);
    buckets.set(cat, [...(buckets.get(cat) ?? []), line]);
  }

  return CATEGORY_ORDER.filter((cat) => buckets.has(cat)).map((cat) => {
    const items = buckets.get(cat)!;
    const daily = items.filter((l) => l.perDay);
    const oneOff = items.filter((l) => !l.perDay);

    // A head can hold both kinds — "₹650/day × 4 day(s) + Admission fee"
    const basis: string[] = [];
    if (daily.length > 0) {
      const perDay = daily.reduce((sum, l) => sum + l.unitRate * l.quantity, 0);
      basis.push(`${CURRENCY(perDay)}/day × ${days} day(s)`);
    }
    if (oneOff.length > 0) basis.push(itemsPhrase(oneOff));

    return {
      category: cat,
      label: CATEGORY_LABEL[cat] ?? cat,
      basis: basis.join(' + '),
      amount: items.reduce((sum, l) => sum + lineAmount(l, days), 0),
      items,
    };
  });
}

/** Every line printed under its head, with the per-day arithmetic spelled out */
function detailedRowsHtml(priced: EstimateLine[], stayDays: number): string {
  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: priced.filter((l) => l.category === cat),
  })).filter((g) => g.items.length > 0);
  // anything with an unknown category still has to print
  const known = new Set(CATEGORY_ORDER);
  const rest = priced.filter((l) => !known.has(l.category));
  if (rest.length > 0) groups.push({ cat: 'misc', items: rest });

  return groups
    .map(({ cat, items }) => {
      const head = `<tr><td colspan="3" style="${TD};background:#f8fafc"><b>${esc(
        CATEGORY_LABEL[cat] ?? cat
      )}</b></td></tr>`;
      const body = items
        .map((l) => {
          const basis = l.perDay
            ? `${CURRENCY(l.unitRate)} × ${l.quantity} /day × ${stayDays} day(s)`
            : `${CURRENCY(l.unitRate)} × ${l.quantity}`;
          const note = [l.note, l.estimated ? 'approx.' : null].filter(Boolean).join(' · ');
          return `<tr>
        <td style="${TD}">${esc(l.label)}${note ? ` <i style="color:#64748b">(${esc(note)})</i>` : ''}</td>
        <td style="${TD}">${esc(basis)}</td>
        <td style="${TD};text-align:right">${CURRENCY(lineAmount(l, stayDays))}</td>
      </tr>`;
        })
        .join('');
      return head + body;
    })
    .join('');
}

/** One row per head — the broad quote */
function broadRowsHtml(priced: EstimateLine[], stayDays: number): string {
  return rollUpToHeads(priced, stayDays)
    .map(
      (h) => `<tr>
        <td style="${TD}"><b>${esc(h.label)}</b></td>
        <td style="${TD};color:#475569">${esc(h.basis)}</td>
        <td style="${TD};text-align:right">${CURRENCY(h.amount)}</td>
      </tr>`
    )
    .join('');
}

/**
 * The costed lines → the table that goes into "Estimated Cost Breakup".
 * `detail: 'broad'` prints one row per head (stay, nursing, doctor,
 * investigations, medicines…); the default prints every line under its head.
 */
export function buildCostTableHtml(
  lines: EstimateLine[],
  stayDays: number,
  opts: { excluded?: string[]; detail?: EstimateDetail } = {}
): string {
  const priced = pricedOnly(lines);
  if (priced.length === 0) return '<p>[Cost breakup]</p>';

  const rows =
    opts.detail === 'broad'
      ? broadRowsHtml(priced, stayDays)
      : detailedRowsHtml(priced, stayDays);

  const total = estimateTotal(priced, stayDays);
  const excluded = (opts.excluded ?? []).filter(Boolean);

  return `<table style="width:100%;font-size:12.5px;border-collapse:collapse">
  <tr>
    <th style="${TH}">Head</th>
    <th style="${TH}">Basis</th>
    <th style="${TH};text-align:right">Amount</th>
  </tr>
  ${rows}
  <tr>
    <td style="${TD}" colspan="2"><b>Estimated total for ${stayDays} day(s)</b></td>
    <td style="${TD};text-align:right"><b>${CURRENCY(total)}</b></td>
  </tr>
</table>
<p style="font-size:12px;color:#475569;margin:6px 0 0">
  Approximately <b>${CURRENCY(total / Math.max(1, stayDays))} per day</b>.
</p>${
    excluded.length > 0
      ? `
<p style="font-size:12px;color:#475569;margin:4px 0 0"><b>Not included:</b> ${esc(
          excluded.join(', ')
        )}.</p>`
      : ''
  }`;
}

// ---------------------------------------------------------------------------

export const documentAiService = {
  buildTariffSnapshot,
  buildCostTableHtml,
  rollUpToHeads,
  lineAmount,
  estimateTotal,
  isCostedDocType,
  subjectFromAdmission,

  /** Draft the open document from a one-line brief */
  async compose(params: {
    subject: ComposeSubject;
    docType: string;
    documentNumber: string | null;
    fields: DocumentField[];
    instruction: string;
    /** pre-built snapshot; omit and it is fetched when the doc type needs one */
    tariff?: TariffSnapshot | null;
  }): Promise<AiComposeResult> {
    const { subject, docType, documentNumber, fields, instruction } = params;
    if (fields.length === 0) {
      throw new Error('This document has no headings to write into — add a section heading first');
    }

    const tariff =
      params.tariff !== undefined && params.tariff !== null
        ? params.tariff
        : isCostedDocType(docType)
          ? await buildTariffSnapshot(subject)
          : null;

    const { data, error } = await supabase.functions.invoke('ai-document-assist', {
      body: {
        instruction,
        document: {
          docType,
          docTypeLabel: docTypeLabel(docType),
          documentNumber,
          fields: fields.map((f) => ({ id: f.id, label: f.label, currentText: f.currentText })),
        },
        patient: {
          name: subject.patientName,
          age: subject.age,
          gender: subject.gender,
          admissionNumber: subject.admissionNumber,
          wardBed: subject.wardBed,
          admittedOn: subject.admittedOn,
          dischargedOn: subject.dischargedOn,
          doctorName: subject.doctorName,
          diagnosis: subject.diagnosis,
          reasonForAdmission: subject.reasonForAdmission,
          allergies: subject.allergies,
        },
        tariff,
      },
    });
    if (error) throw new Error(error.message ?? 'AI document assist failed');
    if (data?.error) throw new Error(data.error);

    const knownIds = new Set(fields.map((f) => f.id));
    return {
      sections: ((data?.sections ?? []) as Array<Record<string, unknown>>)
        .map((s) => ({
          fieldId: knownIds.has(String(s?.fieldId)) ? String(s.fieldId) : 'new',
          heading: String(s?.heading ?? '').trim(),
          text: String(s?.text ?? '').trim(),
          mode: s?.mode === 'replace' ? ('replace' as const) : ('append' as const),
        }))
        .filter((s) => s.text.length > 0),
      removeSections: ((data?.removeSections ?? []) as Array<Record<string, unknown>>)
        .map((r) => ({ fieldId: String(r?.fieldId ?? ''), reason: String(r?.reason ?? '') }))
        .filter((r) => knownIds.has(r.fieldId)),
      estimate: data?.estimate
        ? {
            stayDays: Math.max(1, Number(data.estimate.stayDays) || 1),
            lines: ((data.estimate.lines ?? []) as Array<Record<string, unknown>>).map((l) => ({
              label: String(l?.label ?? ''),
              serviceCode: l?.serviceCode ? String(l.serviceCode) : null,
              category: String(l?.category ?? 'misc'),
              unitRate: Number(l?.unitRate) || 0,
              quantity: Number(l?.quantity) || 1,
              perDay: Boolean(l?.perDay),
              note: String(l?.note ?? ''),
              estimated: Boolean(l?.estimated),
            })),
            assumptions: String(data.estimate.assumptions ?? ''),
            excluded: ((data.estimate.excluded ?? []) as unknown[]).map(String),
          }
        : null,
      summary: String(data?.summary ?? ''),
    };
  },
};
