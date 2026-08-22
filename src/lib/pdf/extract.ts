/**
 * PDF text extraction + field parsing — client-side, zero API cost.
 *
 * Two exports:
 *   extractTextFromPdf  — pulls raw text via pdf.js (lazy-loaded)
 *   parseBillText       — pure regex parser over that text
 *
 * Scanned PDFs (no text layer) → extractTextFromPdf returns '' and sets
 * isScanned on the ParsedBill returned by the higher-level helper.
 *
 * Processing flow:
 *   1. pdf.js loads document from ArrayBuffer
 *   2. Each page rendered to text items
 *   3. Items joined per-page, pages separated by newline
 *   4. parseBillText runs regex passes in priority order
 *   5. Caller gets ParsedBill — caller shows it in editable fields before save
 *
 * Rules carried from the spec:
 *   - Never invent a value. All regex matches must be specific enough that
 *     a false positive is very unlikely.
 *   - Never overwrite a field the user has already typed.
 *   - Total = last/bottommost total-family line, not an arbitrary subtotal.
 */

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface ParsedMedicine {
  name: string;
  quantity: number | null;
  dosage: string | null;        // e.g. "500mg"
  instructions: string | null;  // e.g. "1-0-1", "Twice daily"
}

export interface ParsedBill {
  doctorName: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  /** ISO date YYYY-MM-DD, or null if none found / ambiguous. */
  date: string | null;
  totalAmount: number | null;
  medicines: ParsedMedicine[];
  diagnosis: string | null;
  /**
   * True when pdf.js found no text — caller should show a manual-entry
   * prompt rather than autofilling empty fields.
   */
  isScanned: boolean;
}

/* ── PDF text extraction ────────────────────────────────────────────────────── */

/**
 * Extracts all text from a PDF file using pdf.js (dynamically imported).
 * Returns empty string for scanned / image-only PDFs.
 *
 * Throws on password-protected or corrupted files so the caller can surface
 * an error banner.
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  // Lazy-load pdfjs-dist to keep it out of the initial bundle.
  // ponytail: dynamic import here — pdfjs is large, only needed on PDF upload.
  const pdfjs = await import('pdfjs-dist');

  // Point the worker at the bundled worker script. Vite copies it to /assets.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — pdfjs types for workerSrc vary across versions
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).href;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  const pageLines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    let lastY: number | null = null;
    let currentLine = '';
    const lines: string[] = [];

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const textItem = item as { str: string; transform?: number[]; hasEOL?: boolean };
      const str = textItem.str;
      if (!str && !textItem.hasEOL) continue;

      const y: number | null = (textItem.transform && textItem.transform.length >= 6 && typeof textItem.transform[5] === 'number')
        ? textItem.transform[5]
        : null;

      // New line if y-coordinate changes significantly or item has EOL flag
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = str;
      } else if (textItem.hasEOL) {
        currentLine += (currentLine && str ? ' ' : '') + str;
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      } else {
        currentLine += (currentLine && str ? ' ' : '') + str;
      }
      if (y !== null) lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    if (lines.length > 0) {
      pageLines.push(lines.join('\n'));
    }
  }

  return pageLines.join('\n');
}

/* ── Field parser ───────────────────────────────────────────────────────────── */

// ── Helpers ──

/** Strip leading/trailing whitespace and normalise internal whitespace. */
function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Parse a number from a currency string — strips ₹, commas, spaces. */
function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Convert a parsed date parts to YYYY-MM-DD.
 * Accepts dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd.
 * Returns null if the date is invalid.
 */
function toIso(raw: string): string | null {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return isRealDate(raw) ? raw : null;
  }
  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/.exec(raw.trim());
  if (!m) return null;
  const d = m[1]!.padStart(2, '0');
  const mo = m[2]!.padStart(2, '0');
  let yr = m[3]!;
  if (yr.length === 2) yr = (parseInt(yr) <= 30 ? '20' : '19') + yr;
  const iso = `${yr}-${mo}-${d}`;
  return isRealDate(iso) ? iso : null;
}

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = iso.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

/** Lines that are almost certainly not medicine names. */
const SKIP_LINE = /^\s*(total|subtotal|grand\s*total|net\s*amount|amount\s*payable|amount\s*paid|gst|gstin|cgst|sgst|igst|discount|savings|round\s*off|tax|taxes|mrp|cash|change|balance|bill|invoice|date|dr\.?\s*no|reg\s*no|phone|contact|address|party|patient|customer|terms|goods|subject|get\s*well|auth|sign|products|powered|generated|received|payment\s*mode|thank|www\.|http|s\.no|sr\s*no|#|qty|rate|unit|price|amount|hsn|batch|exp|item\s*name|medicine\s*name|pharma|pharmacy)\b/i;

/** Common address/terms words to reject as medicines. */
const ADDRESS_OR_NOISE_RE = /\b(nagar|road|street|colony|extension|extn?|sector|dist|district|pin|pincode|lane|beside|near|pond|opp|opposite|floor|flat|building|house|jurisdiction|taken\s*back|included|taxes|terms|conditions|authorized|signatory)\b/i;

/** Table header line detection (e.g. "# PRODUCTS HSN BATCH EXP QTY MRP RATE...") */
const TABLE_HEADER_RE = /\b(products|item\s*desc|description|hsn|batch|exp|mrp|rate|qty|quantity|cgst|sgst|igst|amt|amount|dis%|disc)\b/i;

/** Dosage/strength pattern — must be anchored to a number + unit. */
const DOSAGE_RE = /\b\d+\.?\d*\s*(mg|ml|mcg|gm|g|iu|%|tab|caps?)\b/i;

/** Dosing instruction patterns. */
const INSTRUCTION_RE = /\b(\d[-–]\d[-–]\d|once\s*daily|twice\s*daily|thrice\s*daily|bid|tid|qid|od|bd|tds|sos|hs|ac|pc|after\s*food|before\s*food|with\s*food|at\s*bedtime|morning|afternoon|evening|night)\b/i;

/** Qty patterns: "Qty: 10", "10 tab", "10 x", "x10". */
const QTY_RE = /(?:qty|quantity|no\.?\s*of\s*(?:tabs?|caps?|units?))[:\s]*(\d+)|(\d+)\s*(?:tab(?:let)?s?|caps?(?:ule)?s?|units?|nos?|pcs?)\b|\bx\s*(\d+)|(\d+)\s*x\b/i;

/**
 * Heuristic: is this line a plausible medicine name?
 * Must contain at least one alphabetic token ≥ 3 chars that is not a dosage unit.
 */
function looksLikeMedicine(line: string): boolean {
  if (SKIP_LINE.test(line)) return false;
  if (ADDRESS_OR_NOISE_RE.test(line)) return false;
  // Must have letters (not pure number / date / code)
  if (!/[a-zA-Z]/.test(line)) return false;

  // Clean leading serial number (e.g., "1 ", "1. ", "1) ", "#1 ")
  const cleanLine = line.replace(/^\s*(?:#\s*)?\d+[\s.)-]+\s*/, '');
  if (SKIP_LINE.test(cleanLine)) return false;
  if (ADDRESS_OR_NOISE_RE.test(cleanLine)) return false;

  // Reject if line matches 3 or more table header keywords
  const headerMatches = (cleanLine.match(new RegExp(TABLE_HEADER_RE, 'gi')) ?? []).length;
  if (headerMatches >= 2) return false;

  const tokens = cleanLine.split(/\s+/);
  const alpha = tokens.filter(
    (t) => /^[a-zA-Z]/.test(t) && t.length >= 3 && !/^(mg|ml|gm|mcg|tab|cap|inj|syp|susp|oint|gel|drops?|for|and|the|with|from|bill|date|time|qty|rate|unit|batch|exp|mrp|amt|dis|disc|cgst|sgst|igst|hsn)$/i.test(t)
  );
  return alpha.length >= 1;
}

/** Extract qty from a line, return null if not found. */
function extractQty(line: string): number | null {
  const m = QTY_RE.exec(line);
  if (!m) return null;
  const val = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return Number.isFinite(val) && val > 0 && val <= 999 ? val : null;
}

/* ── Main parser ─────────────────────────────────────────────────────────────── */

/**
 * Parse raw text extracted from a bill/prescription PDF.
 * All regex passes are order-independent except total disambiguation.
 * Returns a ParsedBill with nulls for unrecognised fields.
 */
export function parseBillText(text: string): Omit<ParsedBill, 'isScanned'> {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  // ── Doctor ──────────────────────────────────────────────────────────────────
  let doctorName: string | null = null;
  for (const line of lines) {
    // "Dr. Sharma", "Dr Sharma", "Doctor: Sharma", "Consulting: Dr. X"
    const m = /(?:^|consulting[:\s]+|physician[:\s]+|prescribed\s+by[:\s]+)Dr\.?\s+([A-Za-z][A-Za-z\s.]{2,40})/i.exec(line);
    if (m) {
      doctorName = clean(m[1]!).replace(/\s+$/, '').split(/\s{3,}/)[0] ?? null;
      // Remove trailing noise like registration numbers
      doctorName = doctorName?.replace(/\s*(reg|no|mbbs|md|ms|dnb|phd|mch|dgo|dch)[.\s\d]*/i, '').trim() || null;
      break;
    }
  }

  // ── Patient / Customer ──────────────────────────────────────────────────────
  let patientName: string | null = null;
  let patientPhone: string | null = null;

  let inCustomerBlock = false;
  for (const line of lines) {
    // Party: Ray / Patient: John Doe / Customer Name: John Doe
    if (!patientName) {
      const m = /(?:^|\b)(?:party|patient|customer(?:\s*name)?|cust(?:\s*name)?)[:\s]+([A-Za-z][A-Za-z\s.]{1,40})/i.exec(line);
      if (m && !/^(name|details|address|contact|phone|mobile|gst|dr)\b/i.test(m[1]!.trim())) {
        patientName = clean(m[1]!).replace(/\s+$/, '').split(/\s{3,}/)[0] ?? null;
        inCustomerBlock = true;
      }
    }
    // If we are in or near the party/customer section, look for phone
    if (inCustomerBlock && !patientPhone) {
      const pm = /(?:contact|phone|mobile|tel)[:\s]+(\+?91[\s-]?[6-9]\d{9}|[6-9]\d{9})/i.exec(line);
      if (pm) {
        patientPhone = pm[1]!.replace(/\D/g, '').slice(-10);
      }
    }
  }

  // Fallback: look for 10-digit mobile number starting with 6-9 in non-header lines
  if (!patientPhone) {
    const nonHeaderLines = lines.slice(4); // skip top pharmacy contact
    for (const line of nonHeaderLines) {
      const pm = /(?:contact|phone|mobile|tel)[:\s]+(\+?91[\s-]?[6-9]\d{9}|[6-9]\d{9})/i.exec(line);
      if (pm) {
        patientPhone = pm[1]!.replace(/\D/g, '').slice(-10);
        break;
      }
    }
  }

  // ── Date ────────────────────────────────────────────────────────────────────
  let date: string | null = null;
  const DATE_RE = /\b(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;

  // First check if there is an explicit invoice / bill date line
  for (const line of lines) {
    if (/\b(invoice|bill\s*date|dated?|rx\s*date)\b/i.test(line) && !/\bgenerated\b/i.test(line)) {
      let m: RegExpExecArray | null;
      while ((m = DATE_RE.exec(line)) !== null) {
        const iso = toIso(m[1]!);
        if (iso) { date = iso; break; }
      }
      DATE_RE.lastIndex = 0;
      if (date) break;
    }
  }

  // Fallback to any past date excluding 'generated on' lines
  if (!date) {
    const dates: string[] = [];
    for (const line of lines) {
      if (/\bgenerated\b/i.test(line)) continue;
      let m: RegExpExecArray | null;
      while ((m = DATE_RE.exec(line)) !== null) {
        const iso = toIso(m[1]!);
        if (iso) dates.push(iso);
      }
      DATE_RE.lastIndex = 0;
    }
    if (dates.length > 0) {
      const now = new Date();
      const past = dates.filter((d) => new Date(d) <= now);
      date = past.sort().at(-1) ?? dates.sort().at(-1) ?? null;
    }
  }

  // ── Total amount ─────────────────────────────────────────────────────────────
  // Strategy: scan all lines, collect candidates, keep the LAST one.
  // Indian pharmacy bills always print grand total at the bottom.
  let totalAmount: number | null = null;
  const TOTAL_LABEL = /\b(grand\s*total|net\s*amount|amount\s*payable|amount\s*paid|total\s*amount|total\s*bill|bill\s*amount|payable|total)\b/i;
  const AMOUNT_RE = /(\d[\d,]*\.?\d*)\s*$/;
  const totalCandidates: number[] = [];
  for (const line of lines) {
    if (TOTAL_LABEL.test(line)) {
      const m = AMOUNT_RE.exec(line);
      if (m) {
        const n = parseAmount(m[1]!);
        if (n !== null && n > 0) totalCandidates.push(n);
      }
    }
  }
  // Last candidate = grand total
  totalAmount = totalCandidates.at(-1) ?? null;

  // ── Diagnosis ────────────────────────────────────────────────────────────────
  let diagnosis: string | null = null;
  for (const line of lines) {
    const m = /(?:^|\b)(?:dx|diagnosis|complaint|chief\s*complaint|indication)[:\s]+(.+)/i.exec(line);
    if (m) {
      const val = clean(m[1]!).slice(0, 240);
      if (val.length >= 2) { diagnosis = val; break; }
    }
  }

  // ── Medicines ────────────────────────────────────────────────────────────────
  const medicines: ParsedMedicine[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!looksLikeMedicine(line)) continue;

    // Strip leading index (e.g. "1 ", "1. ", "1) ", "#1 ")
    const cleanLine = line.replace(/^\s*(?:#\s*)?\d+[\s.)-]+\s*/, '');
    const tokens = cleanLine.split(/\s+/);
    const nameTokens: string[] = [];

    for (const tok of tokens) {
      // Stop at HSN code (5+ digit number), batch token, MM/YY date, or unit keyword
      if (/^\d{5,}$/.test(tok) || /^batch/i.test(tok) || /^\d{2}\/\d{2}$/.test(tok) || /^(tab|tabs|cap|caps|nos?|pcs?)$/i.test(tok)) {
        break;
      }
      // If standalone number (qty/price) and we already have name tokens, stop
      if (/^\d+\.?\d*$/.test(tok) && nameTokens.length > 0) {
        break;
      }
      nameTokens.push(tok);
    }

    const rawName = nameTokens.join(' ').trim();
    if (!rawName || rawName.length < 2) continue;

    // De-dupe
    const key = rawName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const dosage = DOSAGE_RE.exec(cleanLine)?.[0]?.trim() ?? null;
    const instructions = INSTRUCTION_RE.exec(cleanLine)?.[0]?.trim() ?? null;
    const quantity = extractQty(cleanLine);

    medicines.push({ name: rawName, quantity, dosage, instructions });
  }

  return { doctorName, patientName, patientPhone, date, totalAmount, medicines, diagnosis };
}

/**
 * High-level helper: extract text from PDF then parse it.
 * Returned `isScanned: true` when pdf has no text layer.
 */
export async function extractFromPdf(file: File): Promise<ParsedBill> {
  const text = await extractTextFromPdf(file);
  if (!text.trim()) {
    return { doctorName: null, patientName: null, patientPhone: null, date: null, totalAmount: null, medicines: [], diagnosis: null, isScanned: true };
  }
  return { ...parseBillText(text), isScanned: false };
}
