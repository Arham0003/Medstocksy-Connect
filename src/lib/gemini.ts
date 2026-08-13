/**
 * Bill / prescription extraction via Google Gemini.
 *
 * The API key is supplied per call, not read from import.meta.env. A Vite env
 * var would be inlined into the production bundle and shipped to every
 * browser — one shared key, publicly readable, with no way for a pharmacy to
 * rotate its own. Instead each device stores its own key (see lib/aiKey.ts)
 * and passes it in.
 */
/**
 * NOTE ON THE MISSING TOP-LEVEL IMPORT
 *
 * `@google/genai` is ~350 kB in the bundle. Importing it here statically put
 * it into every chunk that touches this module — which made the Settings page
 * chunk 430 kB, larger than the entire main bundle, purely so an admin could
 * paste an API key. OCR is optional and rarely used, so the SDK is pulled in
 * with a dynamic import() at call time instead. Everything module-scoped in
 * here must therefore stay free of `@google/genai` types and values.
 */

import type { FieldSpec } from '@/lib/ocr/fields';

/** The SDK's `Type` enum, typed structurally so this module needs no value
 *  import from @google/genai (which would defeat the lazy load). */
type GenAiType = Record<'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'ARRAY', unknown>;

/**
 * Tried in order; the loop falls through on quota (429) and unknown-model
 * (404) errors. Ordered newest-first — Google retires older Gemini models on
 * a rolling basis, so an unavailable entry degrades to the next rather than
 * breaking extraction outright. Worth re-checking against
 * https://ai.google.dev/gemini-api/docs/models when quota errors get common.
 */
const FREE_TIER_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

/**
 * Build the model's response schema from the target form's FieldSpecs.
 *
 * This is the spec's "dynamic field mapping": the form declares what it needs,
 * this turns that into the extraction contract. Adding a field to a form adds
 * it to extraction with no second list to maintain.
 *
 * `Type` is imported dynamically alongside the SDK, so it arrives as a param.
 */
function buildSchema(fields: FieldSpec[], Type: GenAiType): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const f of fields) {
    switch (f.type) {
      case 'number':
        properties[f.key] = { type: Type.NUMBER, description: f.describe, nullable: true };
        break;
      case 'integer':
        properties[f.key] = { type: Type.INTEGER, description: f.describe, nullable: true };
        break;
      case 'stringList':
        properties[f.key] = {
          type: Type.ARRAY, description: f.describe,
          items: { type: Type.STRING }, nullable: true,
        };
        break;
      case 'enum':
        properties[f.key] = {
          type: Type.STRING, nullable: true,
          description: `${f.describe}. Must be exactly one of: ${f.values?.join(', ')}.`,
        };
        break;
      case 'date':
        properties[f.key] = {
          type: Type.STRING, nullable: true,
          description: `${f.describe}. Format strictly as YYYY-MM-DD.`,
        };
        break;
      default:
        properties[f.key] = { type: Type.STRING, description: f.describe, nullable: true };
    }
  }

  return { type: Type.OBJECT, properties };
}

/**
 * The instruction half of the contract. The schema says what shape to return;
 * this says how to decide what goes in it — above all, that "not present on the
 * document" must come back as null rather than a plausible guess.
 */
function buildPrompt(fields: FieldSpec[]): string {
  const list = fields.map((f) => `- ${f.key}: ${f.describe}`).join('\n');
  return `You are extracting structured data from a photographed or scanned
Indian pharmacy document (a sales bill, invoice, or handwritten prescription).

Extract ONLY these fields:
${list}

Rules:
- If a value is not present on the document, or you cannot read it with
  confidence, return null for that field. Never guess, infer, or invent.
- Do not carry values over from one field to another.
- Transcribe what is printed. Do not correct spellings, expand abbreviations,
  or normalise brand names.
- Numbers must be plain digits with no currency symbol, thousands separator or
  unit suffix.
- Return null rather than an empty string, empty array, or a placeholder.`;
}

export class GeminiAuthError extends Error {}

async function toBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Extract patient / bill fields from a scanned bill or prescription.
 * Everything returned is a suggestion — the caller must show it in editable
 * fields, never save it straight to a patient record.
 */
export async function extractBillData(
  apiKey: string,
  fileBlob: Blob,
  mimeType: string,
  fields: FieldSpec[]
): Promise<Record<string, unknown>> {
  if (!apiKey) {
    throw new GeminiAuthError('No Gemini API key set. Add one in Settings → AI.');
  }

  // Loaded on demand — see the note at the top of this file.
  const { GoogleGenAI, Type } = await import('@google/genai');
  const responseSchema = buildSchema(fields, Type);
  const prompt = buildPrompt(fields);


  const base64Data = await toBase64(fileBlob);
  const ai = new GoogleGenAI({ apiKey });

  let lastError = '';

  for (const model of FREE_TIER_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data, mimeType } },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const text = response.text;
      if (!text) throw new Error('The AI returned an empty response.');

      return JSON.parse(text) as Record<string, unknown>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

      // Bad or unauthorised key — every model will fail the same way, so stop.
      if (/401|403|API[_ ]?key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
        throw new GeminiAuthError(
          'That Gemini API key was rejected. Check it in Settings → AI.'
        );
      }

      // Quota or retired model — try the next one.
      if (/429|RESOURCE_EXHAUSTED|quota|404|not found/i.test(msg)) continue;

      throw new Error(msg || 'Extraction failed.');
    }
  }

  throw new Error(
    `All Gemini models are unavailable or over quota. Try again in a minute, ` +
    `or enter the details manually. (${lastError})`
  );
}
