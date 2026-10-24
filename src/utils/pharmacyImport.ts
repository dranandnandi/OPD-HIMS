import type { ImportPage, InvoiceData } from '../types/pharmacyImport';

// Ignore OCR spacing around separators, but retain suffixes and digits: different
// bill numbers must still be explicitly reviewed, never silently merged.
export function normalizeInvoiceNumber(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s*([/\-])\s*/g, '$1');
}

export function invoiceHeaderReview(pages: ImportPage[], header: { supplierId: string; supplierGstin?: string | null; invoiceNumber: string; invoiceDate: string }) {
  const fields = ['invoiceNumber', 'invoiceDate', 'supplierGstin', 'supplierName'] as const;
  const values = fields.map(field => ({ field, values: [...new Set(pages.flatMap(p => {
    const value = p.data?.invoiceInfo[field];
    if (!value) return [];
    return [field === 'invoiceNumber' ? normalizeInvoiceNumber(value) : value.trim().toLowerCase()];
  }))] }));
  return {
    conflicts: values.filter(v => v.values.length > 1).map(v => v.field),
    // A confirmation applies only to these source pages and this selected header.
    // Editing the header or adding/retrying a page requires confirmation again.
    signature: JSON.stringify({ header, pages: pages.map(p => ({ key: p.key, status: p.status, header: p.data?.invoiceInfo })) }),
  };
}

export function mergeInvoicePages(pages: ImportPage[]): InvoiceData {
  const merged: InvoiceData = { invoiceInfo: { supplierName: null, invoiceNumber: null, invoiceDate: null, totalAmount: null }, medicines: [], warnings: [] };
  for (const page of pages) {
    if (page.status !== 'complete' || !page.data) continue;
    for (const [key, value] of Object.entries(page.data.invoiceInfo)) {
      if (value == null || value === '') continue;
      const previous = (merged.invoiceInfo as Record<string, unknown>)[key];
      const same = key === 'invoiceNumber'
        ? normalizeInvoiceNumber(String(previous ?? '')) === normalizeInvoiceNumber(String(value))
        : String(previous).trim().toLowerCase() === String(value).trim().toLowerCase();
      if (previous != null && !same) {
        merged.warnings!.push(`${page.fileName} page ${page.page}: conflicting ${key} (${previous} / ${value}). Verify this belongs to the same bill.`);
      } else (merged.invoiceInfo as Record<string, unknown>)[key] = value;
    }
    merged.medicines.push(...page.data.medicines.map((line, index) => ({ ...line, sourceKey: `${page.key}:${index}`, sourceFile: page.fileName, sourcePage: page.page })));
    merged.warnings!.push(...(page.data.warnings || []).map(w => `${page.fileName} page ${page.page}: ${w}`));
  }
  return merged;
}

export function possibleDuplicateLines(lines: Array<{ medicineName: string; batchNumber?: string | null; quantity: number; unitCostPrice: number; serialNumber?: string | null }>) {
  const seen = new Set<string>();
  return lines.flatMap((line, index) => {
    const key = [line.medicineName.trim().toLowerCase(), line.batchNumber || '', line.quantity, line.unitCostPrice, line.serialNumber || ''].join('|');
    const duplicate = seen.has(key);
    seen.add(key);
    return duplicate ? [index + 1] : [];
  });
}
