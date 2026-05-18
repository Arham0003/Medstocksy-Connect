/**
 * Auto-translate template bodies between English and Hindi.
 *
 * Uses the free MyMemory API (no API key required, no auth):
 *   https://mymemory.translated.net/doc/spec.php
 *
 * Limits:
 *   • 500 chars per request (we chunk by sentence if longer)
 *   • 50,000 chars/day from a single IP
 *
 * Variable placeholders like {name}, {medicine} are NEVER sent to the
 * translator — we split the body on `{...}` tokens and only translate the
 * literal text segments between them. Variables are then re-joined verbatim,
 * so they can't get lowercased, transliterated, or otherwise mangled.
 */

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const MAX_CHUNK = 480; // Safety margin under the 500-char limit

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
}

const VAR_RE = /\{[A-Za-z0-9_]+\}/g;

export async function translateText(
  text: string,
  from: 'en' | 'hi',
  to: 'en' | 'hi'
): Promise<string> {
  if (from === to) return text;
  if (!text.trim()) return text;

  // 1. Split into alternating literal/variable segments.
  //    e.g. "Hi {name}, refill {medicine}!" →
  //         ["Hi ", "{name}", ", refill ", "{medicine}", "!"]
  const segments = splitOnVariables(text);

  // 2. Translate each literal segment; pass variables through untouched.
  //    Sequential to avoid hitting MyMemory's rate limit.
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.kind === 'var' || !seg.value.trim()) {
      out.push(seg.value);
      continue;
    }
    out.push(await translateLiteral(seg.value, from, to));
  }

  return out.join('');
}

type Segment = { kind: 'text' | 'var'; value: string };

/** Split a string into a list of literal-text and {variable} segments. */
function splitOnVariables(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  // Re-create the regex each call so lastIndex starts fresh.
  const re = new RegExp(VAR_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, m.index) });
    }
    segments.push({ kind: 'var', value: m[0] });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}

/**
 * Translate one piece of literal text. Splits long inputs into ≤480-char
 * chunks at sentence boundaries, then re-joins. Whitespace at the edges of
 * the original is preserved so words don't fuse with adjacent variables.
 */
async function translateLiteral(text: string, from: 'en' | 'hi', to: 'en' | 'hi'): Promise<string> {
  const leading = text.match(/^\s+/)?.[0] ?? '';
  const trailing = text.match(/\s+$/)?.[0] ?? '';
  const core = text.slice(leading.length, text.length - trailing.length);
  if (!core) return text;

  const chunks = splitIntoChunks(core, MAX_CHUNK);
  const translated: string[] = [];
  for (const chunk of chunks) {
    const url = `${ENDPOINT}?q=${encodeURIComponent(chunk)}&langpair=${from}|${to}&de=medstocksy@example.com`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Translation API returned HTTP ${res.status}`);
    const json = (await res.json()) as MyMemoryResponse;
    const out = json.responseData?.translatedText;
    if (!out || typeof out !== 'string') {
      throw new Error(json.responseDetails || 'Translation API returned no text.');
    }
    translated.push(out);
  }

  return leading + translated.join(' ') + trailing;
}

/**
 * Split a string into chunks ≤ maxLen, preferring sentence boundaries
 * (periods, danda ।, exclamation, question marks) then whitespace.
 */
function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('. ', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf('। ', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf('? ', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf('! ', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    out.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1);
  }
  if (remaining.trim()) out.push(remaining.trim());
  return out;
}
