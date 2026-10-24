/**
 * Stocked unit vs dispense unit.
 *
 * What the pharmacy buys, stocks and prices is a pack — a strip, a bottle, a
 * vial — and that pack carries the MRP. What goes over the counter is often a
 * part of it: 5 tablets out of a strip of 10. So one stocked unit of a strip
 * of 10 at MRP 100 can be sold as 5 tablets for 50, with GST backed out of
 * the 50 exactly as it would be for half a strip.
 *
 * Stock is therefore held in stocked units and may be fractional (2.5 strips
 * = two strips and a half-strip loose). The quantity the pharmacist types is
 * in dispense units; everything else is derived from it here so the counter,
 * the invoice and the stock report cannot disagree.
 */

import { round2 } from './gst';

/** Entered dispense quantities and displayed counts use 3 decimals. */
export const round3 = (n: number): number => Math.round((Number(n) || 0) * 1000) / 1000;

/** Stock fractions need more precision than entered tablet/ml quantities. */
export const roundStock = (n: number): number => Number((Number(n) || 0).toFixed(12));

export interface PackSpec {
  /** Dispense units in one stocked unit. 1 when the pack IS the unit. */
  packSize: number;
  /** Label of the stocked unit: Strip, Bottle, Vial. */
  stockUnit: string;
  /** Label of the dispense unit: Tablet, Capsule, ml. */
  dispenseUnit: string;
  /** May a pack be broken open, or does this SKU only leave whole? */
  allowLooseSale: boolean;
  /** True when the two units differ and part packs are allowed. */
  looseCapable: boolean;
}

export interface PackSource {
  name?: string | null;
  packSize?: number | null;
  stockUnit?: string | null;
  dispenseUnit?: string | null;
  allowLooseSale?: boolean | null;
  dosageForm?: string | null;
}

/** Sensible dispense-unit label when the master does not state one. */
const defaultDispenseUnit = (dosageForm?: string | null, name?: string | null): string => {
  switch ((dosageForm || '').toLowerCase()) {
    case 'tablet': return 'Tablet';
    case 'capsule': return 'Capsule';
    case 'syrup':
    case 'suspension':
    case 'drops': return 'ml';
    case 'injection': return 'Vial';
    case 'cream':
    case 'ointment': return 'gm';
    default:
      // Imported masters can have form "other" even when the supplier name
      // explicitly identifies tablets/capsules. Do not infer a packaging type.
      if (/\bTAB(?:LET)?S?\b/i.test(name || '')) return 'Tablet';
      if (/\bCAP(?:SULE)?S?\b/i.test(name || '')) return 'Capsule';
      return 'Unit';
  }
};

/** Read the pack rules off a medicine, filling in defaults. */
export const packSpec = (m?: PackSource | null): PackSpec => {
  const packSize = Math.max(0.001, Number(m?.packSize) || 1);
  const allowLooseSale = m?.allowLooseSale ?? true;
  return {
    packSize,
    stockUnit: (m?.stockUnit || '').trim() || 'Pack',
    dispenseUnit: (m?.dispenseUnit || '').trim() || defaultDispenseUnit(m?.dosageForm, m?.name),
    allowLooseSale,
    looseCapable: packSize > 1 && allowLooseSale
  };
};

/** Dispense units -> stocked units. 5 tablets of a strip of 10 = 0.5. */
export const toStockUnits = (dispenseQty: number, packSize: number): number =>
  roundStock((Number(dispenseQty) || 0) / Math.max(0.001, packSize));

/** Stocked units -> dispense units. 0.5 strips of 10 = 5 tablets. */
export const toDispenseUnits = (stockQty: number, packSize: number): number =>
  round3((Number(stockQty) || 0) * Math.max(0.001, packSize));

/**
 * Rate per billed unit: the per-tablet rate on a loose sale, the pack MRP
 * otherwise. Kept at paise precision, so a 1/3 pack sells at 33.33 rather
 * than at a third of a rounded stocked-unit quantity.
 */
export const unitRate = (packMrp: number, packSize: number, sellLoose: boolean): number =>
  sellLoose ? round2((Number(packMrp) || 0) / Math.max(0.001, packSize)) : round2(Number(packMrp) || 0);

/** Quantities print without the column's trailing zeros: "2", "0.5", "2.25". */
export const fmtQty = (n: number | null | undefined): string => String(round3(Number(n) || 0));

/**
 * Stock on hand read out the way a pharmacist counts it: whole packs plus
 * the loose remainder. 2.5 strips of 10 -> "2 Strip + 5 Tablet".
 */
export const stockBreakdown = (stockQty: number, spec: PackSpec): string => {
  const qty = roundStock(stockQty);
  if (spec.packSize <= 1) return `${fmtQty(qty)} ${spec.stockUnit}`;
  const whole = Math.floor(qty + 1e-9);
  const loose = round3(toDispenseUnits(qty - whole, spec.packSize));
  if (loose <= 0) return `${whole} ${spec.stockUnit}`;
  if (whole <= 0) return `${fmtQty(loose)} ${spec.dispenseUnit}`;
  return `${whole} ${spec.stockUnit} + ${fmtQty(loose)} ${spec.dispenseUnit}`;
};

/**
 * Pull a pack size out of the free text a distributor prints in the pack
 * column: "1x10", "1*10", "10'S", "15 TAB", "100ML" all state the loose count
 * inside one stocked unit. In an "AxB" form B is the count per pack and A is
 * how many packs the carton holds, so B wins. Returns undefined when there is
 * no number to read, which leaves the master's own pack size alone.
 */
export const parsePackSize = (text?: string | null): number | undefined => {
  const t = (text || '').trim();
  if (!t) return undefined;
  const pair = t.match(/(\d+(?:\.\d+)?)\s*[x*×]\s*(\d+(?:\.\d+)?)/i);
  const n = pair ? Number(pair[2]) : Number((t.match(/\d+(?:\.\d+)?/) || [])[0]);
  return Number.isFinite(n) && n > 0 ? round3(n) : undefined;
};

/**
 * How many dispense units one eMAR administration is, read off the order's
 * free-text dose. "2 tab" is two tablets, "1/2 tab" half of one, "10 ml" ten
 * millilitres of a syrup. Strengths are not counts: "500 mg" is ONE tablet of
 * 500 mg, so mass/IU tokens always mean 1. Anything unparseable, absurd, or
 * in a unit that does not match the SKU falls back to 1 — under-deducting a
 * dose is recoverable from the ledger, inventing a 500-unit dose is not.
 */
export const parseDoseUnits = (dose: string | null | undefined, spec: PackSpec): number => {
  const t = (dose || '').trim().toLowerCase();
  if (!t) return 1;

  // Leading amount: "2", "2.5", "1/2", "1 1/2".
  // Fractions first, or "1/2" greedily matches just the "1".
  const m = t.match(/^(\d+(?:\.\d+)?\s+\d+\/\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*([a-z]+)?/);
  if (!m) return 1;

  let count: number;
  const frac = m[1].match(/(\d+)\s*\/\s*(\d+)/);
  if (frac) {
    const whole = m[1].match(/^(\d+(?:\.\d+)?)\s+\d+\//);
    count = (whole ? Number(whole[1]) : 0) + Number(frac[1]) / Number(frac[2]);
  } else {
    count = Number(m[1]);
  }
  if (!Number.isFinite(count) || count <= 0) return 1;

  const token = m[2] || '';
  // A strength, not a count.
  if (/^(mg|mcg|ug|g|gm|gram|grams|iu|meq|mmol|%)/.test(token)) return 1;

  const countable = /^(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|drop|drops|puff|puffs|unit|units|amp|amps|ampoule|ampoules|vial|vials|sachet|sachets|spray|sprays|patch|patches|supp|suppository|inj|injection|shot|dose|doses)/;
  const unitLabel = spec.dispenseUnit.toLowerCase();

  if (token) {
    // "ml" (or the SKU's own label) counts only when that IS the dispense unit.
    const matchesSkuUnit = token === unitLabel || token === `${unitLabel}s`
      || (/^ml|^millil/.test(token) && unitLabel === 'ml');
    if (!countable.test(token) && !matchesSkuUnit) return 1;
  } else if (count > 10 || !Number.isInteger(count * 2)) {
    // A bare number is only trusted as a count when it looks like one:
    // "2" or "1.5" yes, "500" or "0.3" no.
    return 1;
  }

  // Even an explicit unit is distrusted beyond a plausible single dose.
  if (count > 50) return 1;
  return round3(count);
};
