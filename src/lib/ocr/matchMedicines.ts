/**
 * Match OCR'd medicine names against what this pharmacy has dispensed before.
 *
 * Per the spec (§3 Product Matching): account for OCR errors, spelling
 * variations, spacing and punctuation; never auto-overwrite on uncertain data;
 * surface low-confidence matches for the user to confirm.
 *
 * The "product catalogue" here is the distinct medicine names already in
 * crm_prescription_medicines for the pharmacy. This app has no inventory table
 * of its own — stock lives in the separate Medstocksy Inventory product — so
 * prescribing history is the authoritative in-app list.
 */
import { supabase } from '@/lib/supabase';

export interface MedicineMatch {
  /** Exactly what OCR read. */
  extracted: string;
  /** Best known medicine name, or null when nothing came close. */
  match: string | null;
  /** 0–1. */
  score: number;
  /** How the caller should treat it. */
  confidence: 'high' | 'low' | 'none';
}

/** Above this we treat the known spelling as correct. */
const HIGH = 0.86;
/** Below this there is no usable match at all. */
const FLOOR = 0.6;

/**
 * Fold the character confusions a scanner actually makes, plus packaging noise.
 * Deliberately lossy — this string is only ever used for comparison, never
 * shown to anyone or saved.
 */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,/\\()\-_+]/g, ' ')
    // Common OCR glyph confusions, folded to one representative character.
    .replace(/[0o]/g, '0')
    .replace(/[1li|]/g, '1')
    .replace(/[5s]/g, '5')
    .replace(/[8b]/g, '8')
    .replace(/[2z]/g, '2')
    // Dosage units differ by transcriber; strip them so "500mg" ≈ "500 mg".
    .replace(/\b(mg|ml|gm|g|mcg|iu|tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup|inj|injection)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein, iterative with a single row — inputs here are short. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

/**
 * Blend whole-string similarity with token overlap.
 *
 * Edit distance alone misjudges reordering ("Amoxicillin 500" vs "500
 * Amoxicillin"); token overlap alone misjudges single-token names with a typo
 * ("Crocin" vs "Crosin"). Taking the max of the two handles both, since a
 * genuine match scores well on at least one.
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const longer = Math.max(a.length, b.length);
  const editScore = 1 - editDistance(a, b) / longer;

  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const tokenScore = shared === 0 ? 0 : (2 * shared) / (ta.size + tb.size);

  return Math.max(editScore, tokenScore);
}

/**
 * Load the distinct medicine names this pharmacy has used.
 *
 * RLS on crm_prescription_medicines is enforced through its parent
 * prescription, so this only ever returns the caller's own tenant data.
 */
export async function loadKnownMedicines(pharmacyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('crm_prescription_medicines')
    .select('medicine_name, prescription:crm_prescriptions!inner(pharmacy_id)')
    .eq('prescription.pharmacy_id', pharmacyId)
    .limit(2000);

  if (error) {
    console.warn('[ocr] could not load medicine history:', error.message);
    return [];
  }

  const seen = new Set<string>();
  for (const row of (data ?? []) as unknown as { medicine_name: string }[]) {
    const name = row.medicine_name?.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * Match each extracted name against the known list.
 *
 * Returns suggestions only. The caller keeps the OCR text as the value and
 * offers the match — the spec forbids silently replacing an extracted name
 * with an uncertain guess.
 */
export function matchMedicines(extracted: string[], known: string[]): MedicineMatch[] {
  if (known.length === 0) {
    return extracted.map((e) => ({ extracted: e, match: null, score: 0, confidence: 'none' as const }));
  }

  // Normalise the catalogue once rather than per candidate.
  const index = known.map((name) => ({ name, norm: normalise(name) }));

  return extracted.map((raw) => {
    const norm = normalise(raw);
    let best: { name: string; score: number } | undefined;

    for (const entry of index) {
      const score = similarity(norm, entry.norm);
      if (best === undefined || score > best.score) best = { name: entry.name, score };
    }

    if (best === undefined || best.score < FLOOR) {
      return { extracted: raw, match: null, score: best?.score ?? 0, confidence: 'none' as const };
    }
    return {
      extracted: raw,
      match: best.name,
      score: best.score,
      confidence: best.score >= HIGH ? ('high' as const) : ('low' as const),
    };
  });
}
