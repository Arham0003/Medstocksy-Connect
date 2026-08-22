/**
 * Validation for OCR output.
 *
 * The spec is explicit (§3): "OCR output must be treated as extracted data,
 * not automatically trusted data." Nothing here silently repairs a value —
 * each field comes back with a verdict so the form can show what was read,
 * what looked wrong, and let the user fix it before saving.
 */
import type { FieldSpec } from './fields';

export type Verdict = 'ok' | 'suspect' | 'invalid';

export interface FieldResult {
  key: string;
  /** Normalised value, or null when nothing usable was extracted. */
  value: string | number | string[] | null;
  /** Exactly what the model returned, kept so the user can see the original. */
  raw: unknown;
  verdict: Verdict;
  /** Human-readable reason — shown next to the field when not 'ok'. */
  issue?: string;
}

export interface ExtractionReport {
  fields: Record<string, FieldResult>;
  /** Fields safe to auto-fill (verdict 'ok'). */
  clean: string[];
  /** Extracted but questionable — fill, but flag for review. */
  suspect: string[];
  /** Rejected outright; never written into the form. */
  invalid: string[];
  /** Arithmetic cross-check on the bill, when enough numbers were present. */
  totalsCheck?: { expected: number; stated: number; deltaPct: number; ok: boolean };
}

const MAX_FUTURE_DAYS = 1;      // a bill dated tomorrow is a typo, not history
const MAX_AGE_YEARS = 25;       // bills older than this are almost certainly misread

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  // Strip currency symbols, spaces and Indian digit grouping.
  const cleaned = raw.replace(/[₹,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function validateOne(spec: FieldSpec, raw: unknown): FieldResult {
  const base = { key: spec.key, raw };

  if (raw === null || raw === undefined || raw === '') {
    // Absent is a legitimate outcome — the spec requires leaving fields empty
    // rather than guessing. Not an error.
    return { ...base, value: null, verdict: 'ok' };
  }

  switch (spec.type) {
    case 'string': {
      const s = String(raw).trim();
      if (!s) return { ...base, value: null, verdict: 'ok' };
      // A "name" that is mostly digits is almost always a misread line item.
      const digits = (s.match(/\d/g) ?? []).length;
      if (digits > s.length / 2) {
        return { ...base, value: s, verdict: 'suspect', issue: 'Mostly digits — check this is not a line item.' };
      }
      return { ...base, value: s, verdict: 'ok' };
    }

    case 'phone': {
      const digits = String(raw).replace(/\D/g, '');
      // Indian mobiles are 10 digits starting 6-9; tolerate a 91 prefix.
      const local = digits.length > 10 ? digits.slice(-10) : digits;
      if (local.length !== 10) {
        return { ...base, value: null, verdict: 'invalid', issue: `Not a 10-digit number (read ${digits.length} digits).` };
      }
      if (!/^[6-9]/.test(local)) {
        return { ...base, value: local, verdict: 'suspect', issue: 'Indian mobiles start with 6–9.' };
      }
      return { ...base, value: local, verdict: 'ok' };
    }

    case 'integer':
    case 'number': {
      const n = parseNumber(raw);
      if (n === null) return { ...base, value: null, verdict: 'invalid', issue: 'Not a number.' };
      if (spec.type === 'integer' && !Number.isInteger(n)) {
        return { ...base, value: Math.round(n), verdict: 'suspect', issue: 'Rounded to a whole number.' };
      }
      if (spec.min !== undefined && n < spec.min) {
        return { ...base, value: null, verdict: 'invalid', issue: `Below the minimum of ${spec.min}.` };
      }
      if (spec.max !== undefined && n > spec.max) {
        return { ...base, value: null, verdict: 'invalid', issue: `Above the maximum of ${spec.max}.` };
      }
      return { ...base, value: n, verdict: 'ok' };
    }

    case 'date': {
      const s = String(raw).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return { ...base, value: null, verdict: 'invalid', issue: 'Not a YYYY-MM-DD date.' };
      const d = new Date(`${s}T00:00:00`);
      if (Number.isNaN(d.getTime())) {
        return { ...base, value: null, verdict: 'invalid', issue: 'Not a real date.' };
      }
      // Guard against a valid-looking but rolled-over date (2026-02-31 → Mar 3).
      if (d.getDate() !== Number(m[3]) || d.getMonth() + 1 !== Number(m[2])) {
        return { ...base, value: null, verdict: 'invalid', issue: 'That day does not exist in that month.' };
      }
      const now = new Date();
      const daysAhead = (d.getTime() - now.getTime()) / 86_400_000;
      if (daysAhead > MAX_FUTURE_DAYS) {
        return { ...base, value: s, verdict: 'suspect', issue: 'Dated in the future.' };
      }
      if (now.getFullYear() - d.getFullYear() > MAX_AGE_YEARS) {
        return { ...base, value: s, verdict: 'suspect', issue: 'More than 25 years old — likely misread.' };
      }
      return { ...base, value: s, verdict: 'ok' };
    }

    case 'enum': {
      const s = String(raw).trim().toLowerCase();
      if (!spec.values?.includes(s)) {
        return { ...base, value: null, verdict: 'invalid', issue: `Expected one of: ${spec.values?.join(', ')}.` };
      }
      return { ...base, value: s, verdict: 'ok' };
    }

    case 'stringList': {
      if (!Array.isArray(raw)) return { ...base, value: null, verdict: 'invalid', issue: 'Expected a list.' };
      const items = raw
        .map((v) => String(v).trim())
        .filter(Boolean)
        // Drop obvious non-medicines that bills often carry in the same column.
        .filter((v) => !/^(total|subtotal|gst|cgst|sgst|igst|discount|round\s*off|amount|qty)$/i.test(v));
      if (items.length === 0) return { ...base, value: null, verdict: 'ok' };
      return { ...base, value: items, verdict: 'ok' };
    }

    default:
      return { ...base, value: null, verdict: 'invalid', issue: 'Unsupported field type.' };
  }
}

/** Tolerance on the bill arithmetic — rounding and round-off lines are normal. */
const TOTAL_TOLERANCE_PCT = 2;

/**
 * Validate every extracted field against its spec, then cross-check the bill
 * arithmetic where the document gave us enough numbers to do so.
 */
export function validateExtraction(
  specs: FieldSpec[],
  extracted: Record<string, unknown>
): ExtractionReport {
  const fields: Record<string, FieldResult> = {};
  for (const spec of specs) {
    fields[spec.key] = validateOne(spec, extracted[spec.key]);
  }

  const clean: string[] = [];
  const suspect: string[] = [];
  const invalid: string[] = [];
  for (const r of Object.values(fields)) {
    if (r.value === null && r.verdict === 'ok') continue;   // simply absent
    if (r.verdict === 'ok') clean.push(r.key);
    else if (r.verdict === 'suspect') suspect.push(r.key);
    else invalid.push(r.key);
  }

  // Totals check: line items + tax should land near the stated grand total.
  // Only meaningful when the bill actually printed both.
  let totalsCheck: ExtractionReport['totalsCheck'];
  const stated = fields['billAmount']?.value;
  const lines = fields['lineTotal']?.value;
  const tax = fields['taxAmount']?.value;
  if (typeof stated === 'number' && typeof lines === 'number' && lines > 0) {
    const expected = lines + (typeof tax === 'number' ? tax : 0);
    const deltaPct = Math.abs((expected - stated) / stated) * 100;
    const ok = deltaPct <= TOTAL_TOLERANCE_PCT;
    totalsCheck = { expected, stated, deltaPct, ok };
    if (!ok && fields['billAmount']) {
      fields['billAmount'] = {
        ...fields['billAmount'],
        verdict: 'suspect',
        issue: `Line items + tax come to ₹${expected.toFixed(2)}, but the bill states ₹${stated.toFixed(2)}.`,
      };
      if (!suspect.includes('billAmount')) suspect.push('billAmount');
      const at = clean.indexOf('billAmount');
      if (at !== -1) clean.splice(at, 1);
    }
  }

  return { fields, clean, suspect, invalid, totalsCheck };
}
