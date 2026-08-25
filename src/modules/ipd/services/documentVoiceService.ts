import { supabase } from '../utils/supabase';
import { docTypeLabel } from './documentService';
import type { ComposeSubject } from './documentSubject';

// ---------------------------------------------------------------------------
// Voice dictation for IPD documents.
//
// A document is edited as one HTML blob, so before the doctor speaks we read
// its headings back out as a list of *fields*. That list is what gives the
// model its context — it can only write into sections the document actually
// has — and it is also what the review panel offers as re-routing targets.
// Applying an accepted dictation rewrites the same HTML in place, which the
// editor then saves as the draft.
// ---------------------------------------------------------------------------

/** One writable section of a document, derived from a heading in its HTML */
export interface DocumentField {
  /** stable within a document: slugged heading text, suffixed when repeated */
  id: string;
  /** heading text as it appears in the document */
  label: string;
  /** plain-text of everything under the heading, up to the next heading */
  currentText: string;
}

export interface DictatedSection {
  /** a DocumentField id, or 'new' for a section the document does not have yet */
  fieldId: string;
  /** heading to create — only meaningful when fieldId is 'new' */
  heading: string;
  text: string;
  mode: 'replace' | 'append';
  /**
   * Ready-made block HTML to write instead of `text` — used for generated
   * tables (the estimate's cost breakup) that must not be escaped. `text`
   * still carries a plain-text version for the review panel.
   */
  html?: string;
}

export interface DocumentDictationResult {
  transcript: string;
  sections: DictatedSection[];
  additionalNotes: string | null;
  privacyRedactions: number;
}

export interface DocumentVoiceContext {
  docType: string;
  docTypeLabel: string;
  documentNumber: string | null;
  patientName: string;
  age: number | string | null;
  gender: string | null;
  admissionNumber: string;
  wardBed: string;
  admittedOn: string;
  dischargedOn: string | null;
  doctorName: string;
  diagnosis: string;
  reasonForAdmission: string;
  allergies: string[];
  fields: Array<{ id: string; label: string; currentText: string }>;
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Nodes that are page furniture rather than content — signature blocks etc. */
const TRAILING_TAGS = new Set(['BR', 'HR', 'TABLE']);

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

const parseDoc = (html: string): Document =>
  new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');

/**
 * Read a document's headings back out as writable fields. The leading title
 * heading (which just repeats the document type) is skipped — it is not a
 * place anything can be dictated into.
 */
export function extractDocumentFields(html: string, docType?: string): DocumentField[] {
  const doc = parseDoc(html);
  const title = docType ? docTypeLabel(docType).toLowerCase() : null;
  const fields: DocumentField[] = [];
  const used = new Map<string, number>();
  let current: DocumentField | null = null;

  Array.from(doc.body.children).forEach((el) => {
    if (HEADING_TAGS.has(el.tagName)) {
      const label = (el.textContent ?? '').trim();
      if (!label) {
        current = null;
        return;
      }
      // the template's own title line is not a dictation target
      if (title && label.toLowerCase() === title) {
        current = null;
        return;
      }
      const base = slug(label);
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      current = { id: seen === 1 ? base : `${base}-${seen}`, label, currentText: '' };
      fields.push(current);
      return;
    }
    if (!current) return;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) current.currentText += (current.currentText ? '\n' : '') + text;
  });

  return fields;
}

/** Everything the model needs to route a dictation into this document */
export function buildDocumentContext(
  subject: ComposeSubject,
  doc: { doc_type: string; document_number: string | null },
  fields: DocumentField[]
): DocumentVoiceContext {
  return {
    docType: doc.doc_type,
    docTypeLabel: docTypeLabel(doc.doc_type),
    documentNumber: doc.document_number,
    patientName: subject.patientName,
    age: subject.age,
    gender: subject.gender,
    admissionNumber: subject.admissionNumber ?? '',
    wardBed: subject.wardBed,
    admittedOn: subject.admittedOn ?? '',
    dischargedOn: subject.dischargedOn,
    doctorName: subject.doctorName,
    diagnosis: subject.diagnosis,
    reasonForAdmission: subject.reasonForAdmission,
    allergies: subject.allergies,
    fields: fields.map((f) => ({ id: f.id, label: f.label, currentText: f.currentText })),
  };
}

// ---------------------------------------------------------------------------
// HTML rewriting
// ---------------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Dictated prose → block nodes. Lines starting "- " or "• " become one list;
 * everything else becomes a paragraph, so the result drops straight into the
 * WYSIWYG editor.
 */
function textToNodes(doc: Document, text: string): Element[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const nodes: Element[] = [];
  let list: HTMLUListElement | null = null;

  lines.forEach((line) => {
    if (/^[-•*]\s+/.test(line)) {
      let ul = list;
      if (!ul) {
        ul = doc.createElement('ul');
        ul.setAttribute('style', 'margin:4px 0;padding-left:18px');
        nodes.push(ul);
        list = ul;
      }
      const li = doc.createElement('li');
      li.innerHTML = escapeHtml(line.replace(/^[-•*]\s+/, ''));
      ul.appendChild(li);
      return;
    }
    list = null;
    const p = doc.createElement('p');
    p.innerHTML = escapeHtml(line);
    nodes.push(p);
  });

  return nodes;
}

/** Generated block HTML → nodes, kept as-is (no escaping) */
function htmlToNodes(doc: Document, html: string): Element[] {
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  return Array.from(holder.children);
}

/** The nodes belonging to a heading — everything up to the next heading */
function sectionBody(heading: Element): Element[] {
  const body: Element[] = [];
  let el = heading.nextElementSibling;
  while (el && !HEADING_TAGS.has(el.tagName)) {
    body.push(el);
    el = el.nextElementSibling;
  }
  return body;
}

/** True for a placeholder body the template left behind (empty <p>, "[…]") */
const isPlaceholderNode = (el: Element): boolean => {
  const text = (el.textContent ?? '').trim();
  return el.tagName === 'P' && (text === '' || /^\[.*\]$/.test(text));
};

/**
 * The run of nodes at the very end of the document that is page furniture —
 * the spacer breaks and the signature table. Dictated content must never land
 * inside it, and a "replace" must never delete it, even though the DOM counts
 * it as part of the last heading's section.
 */
function trailingFurniture(body: HTMLElement): Element[] {
  const nodes: Element[] = [];
  let el = body.lastElementChild;
  while (el && (TRAILING_TAGS.has(el.tagName) || isPlaceholderNode(el))) {
    nodes.unshift(el);
    el = el.previousElementSibling;
  }
  return nodes;
}

/**
 * Write accepted sections back into the document HTML.
 * Returns the new HTML plus the labels that were actually touched.
 */
export function applyDictationToHtml(
  html: string,
  sections: DictatedSection[],
  docType?: string
): { html: string; applied: string[] } {
  if (sections.length === 0) return { html, applied: [] };

  const doc = parseDoc(html);
  const applied: string[] = [];
  const furnitureNodes = trailingFurniture(doc.body);
  const furniture = new Set<Element>(furnitureNodes);
  // everything new goes above the signature block, never below it
  const anchor: Element | null = furnitureNodes[0] ?? null;
  const insertBeforeFurniture = (node: Element) =>
    anchor ? doc.body.insertBefore(node, anchor) : doc.body.appendChild(node);

  // rebuild the id → heading map with the same rules extractDocumentFields uses
  const headings = new Map<string, Element>();
  const used = new Map<string, number>();
  const title = docType ? docTypeLabel(docType).toLowerCase() : null;
  Array.from(doc.body.children).forEach((el) => {
    if (!HEADING_TAGS.has(el.tagName)) return;
    const label = (el.textContent ?? '').trim();
    if (!label || (title && label.toLowerCase() === title)) return;
    const base = slug(label);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    headings.set(seen === 1 ? base : `${base}-${seen}`, el);
  });

  sections.forEach((section) => {
    const text = section.text.trim();
    if (!text && !section.html) return;
    const nodes = section.html
      ? htmlToNodes(doc, section.html)
      : textToNodes(doc, text);
    if (nodes.length === 0) return;

    const heading = headings.get(section.fieldId);

    if (!heading) {
      // a section the document does not have — add it before the signature block
      const label = section.heading.trim() || 'Additional Notes';
      const newHeading = doc.createElement('h3');
      newHeading.textContent = label;
      insertBeforeFurniture(newHeading);
      nodes.forEach(insertBeforeFurniture);
      // keep it addressable if two dictated sections share the new heading
      const base = slug(label);
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      headings.set(seen === 1 ? base : `${base}-${seen}`, newHeading);
      applied.push(label);
      return;
    }

    // the last section technically owns the signature block — leave it alone
    const body = sectionBody(heading).filter((el) => !furniture.has(el));
    // an untouched template placeholder is overwritten even on "append"
    const onlyPlaceholder = body.length > 0 && body.every(isPlaceholderNode);

    if (section.mode === 'replace' || onlyPlaceholder) {
      body.forEach((el) => el.remove());
    }
    let after: Node =
      section.mode === 'replace' || onlyPlaceholder || body.length === 0
        ? heading
        : body[body.length - 1];
    nodes.forEach((node) => {
      after.parentNode?.insertBefore(node, after.nextSibling);
      after = node;
    });
    applied.push((heading.textContent ?? '').trim());
  });

  return { html: doc.body.innerHTML, applied };
}

/**
 * Delete whole sections — heading and body — from the document. Used when a
 * generated draft decides a head does not apply to this case (OT charges and
 * implants on a purely medical admission) so they don't print as empty rows.
 * The trailing signature block is never touched, even though the DOM counts
 * it as part of the last heading's section.
 */
export function removeSectionsFromHtml(
  html: string,
  fieldIds: string[],
  docType?: string
): { html: string; removed: string[] } {
  if (fieldIds.length === 0) return { html, removed: [] };

  const doc = parseDoc(html);
  const furniture = new Set<Element>(trailingFurniture(doc.body));
  const wanted = new Set(fieldIds);
  const removed: string[] = [];

  const used = new Map<string, number>();
  const title = docType ? docTypeLabel(docType).toLowerCase() : null;

  Array.from(doc.body.children).forEach((el) => {
    if (!HEADING_TAGS.has(el.tagName)) return;
    const label = (el.textContent ?? '').trim();
    if (!label || (title && label.toLowerCase() === title)) return;
    const base = slug(label);
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    const id = seen === 1 ? base : `${base}-${seen}`;
    if (!wanted.has(id)) return;

    sectionBody(el).forEach((node) => {
      if (!furniture.has(node)) node.remove();
    });
    el.remove();
    removed.push(label);
  });

  return { html: doc.body.innerHTML, removed };
}

// ---------------------------------------------------------------------------

export const documentVoiceService = {
  extractDocumentFields,
  buildDocumentContext,
  applyDictationToHtml,
  removeSectionsFromHtml,

  /** Send audio (or typed text) + the document's field list to the scribe */
  async dictate(params: {
    audioBase64?: string;
    mimeType?: string;
    textInput?: string;
    context: DocumentVoiceContext;
  }): Promise<DocumentDictationResult> {
    const { data, error } = await supabase.functions.invoke('dictate-ipd-document', {
      body: {
        audioBase64: params.audioBase64,
        mimeType: params.mimeType ?? 'audio/webm',
        textInput: params.textInput,
        documentContext: params.context,
      },
    });
    if (error) throw new Error(error.message ?? 'Document dictation failed');
    if (data?.error) throw new Error(data.details ?? data.error);

    const knownIds = new Set(params.context.fields.map((f) => f.id));
    const sections: DictatedSection[] = (Array.isArray(data?.sections) ? data.sections : [])
      .map((s: Record<string, unknown>) => ({
        fieldId: knownIds.has(String(s?.fieldId)) ? String(s.fieldId) : 'new',
        heading: String(s?.heading ?? '').trim(),
        text: String(s?.text ?? '').trim(),
        mode: s?.mode === 'replace' ? 'replace' : 'append',
      }))
      .filter((s: DictatedSection) => s.text.length > 0);

    return {
      transcript: String(data?.transcript ?? ''),
      sections,
      additionalNotes: data?.additionalNotes ? String(data.additionalNotes) : null,
      privacyRedactions: Number(data?.privacyRedactions) || 0,
    };
  },
};
