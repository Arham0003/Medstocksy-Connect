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

const PROMPT = `
  You are a medical billing data extractor.
  Analyze the provided document (a bill or prescription image) and extract the specified fields.
  If a value for a specific field cannot be found or is not applicable, use null for that field.

  INSTRUCTIONS FOR MEDICINES:
  - Include ONLY the medicine names (e.g. "Crocin 500mg").
  - DO NOT include doses, frequency, or duration (remove "daily", "twice", "1-0-1", etc.).
  - If it's a bill, extract medicines purchased. If it's a prescription, extract prescribed medicines.

  INSTRUCTIONS FOR BILL AMOUNT:
  - Look for total amount, grand total, or net amount.
  - Return as a plain number only.
`;

export interface ExtractedBillData {
  name?: string;
  phone?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  billAmount?: number;
  billDate?: string;
  medicines?: string[];
  doctor?: string;
  diagnosis?: string;
}

/** Thrown when the key itself is the problem, so the UI can point the user at
 *  Settings instead of showing a raw provider error. */
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
  mimeType: string
): Promise<ExtractedBillData> {
  if (!apiKey) {
    throw new GeminiAuthError('No Gemini API key set. Add one in Settings → AI.');
  }

  // Loaded on demand — see the note at the top of this file.
  const { GoogleGenAI, Type } = await import('@google/genai');

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      name:       { type: Type.STRING,  description: 'Patient full name',                                  nullable: true },
      phone:      { type: Type.STRING,  description: 'Patient phone number without +91 country code',      nullable: true },
      age:        { type: Type.NUMBER,  description: 'Patient age as a number',                            nullable: true },
      gender:     { type: Type.STRING,  description: 'Patient gender: male, female, or other',             nullable: true },
      billAmount: { type: Type.NUMBER,  description: 'Total bill amount as a number (no currency symbols)', nullable: true },
      billDate:   { type: Type.STRING,  description: 'Bill date in YYYY-MM-DD format',                     nullable: true },
      medicines: {
        type: Type.ARRAY,
        description: 'List of medicine names only — no dosage, frequency, or duration',
        items: { type: Type.STRING },
        nullable: true,
      },
      doctor:    { type: Type.STRING, description: 'Doctor name',            nullable: true },
      diagnosis: { type: Type.STRING, description: 'Diagnosis or condition', nullable: true },
    },
  };

  const base64Data = await toBase64(fileBlob);
  const ai = new GoogleGenAI({ apiKey });

  let lastError = '';

  for (const model of FREE_TIER_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { text: PROMPT },
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

      return JSON.parse(text) as ExtractedBillData;
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
