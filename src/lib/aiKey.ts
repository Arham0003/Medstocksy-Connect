/**
 * Per-device storage for the pharmacy's Google Gemini API key.
 *
 * Deliberately localStorage rather than a column on crm_pharmacies: RLS is
 * row-level, so any member who can read the pharmacy row could read a key
 * stored there — including `staff`, who have no business holding billing
 * credentials for a third-party account. Keeping it on the device means the
 * blast radius of a leak is one browser, and the owner can rotate without a
 * schema change.
 *
 * Trade-off, stated plainly: each device must be set up once, and the key is
 * readable by anyone with access to that browser profile. A server-side proxy
 * would be strictly better and is the natural next step if OCR becomes core.
 */
import { storage } from '@/lib/utils';

const GEMINI_KEY = 'medcrm.gemini_api_key';

export function getGeminiKey(): string {
  return storage.get<string>(GEMINI_KEY, '') ?? '';
}

export function setGeminiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) storage.set(GEMINI_KEY, trimmed);
  else storage.remove(GEMINI_KEY);
}

export function hasGeminiKey(): boolean {
  return getGeminiKey().length > 0;
}

/** Mask for display — never render the raw key back into the DOM. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(12)}${key.slice(-4)}`;
}
