/**
 * Bill / prescription scan access.
 *
 * `crm-bill-attachments` is a PRIVATE bucket (migration 20260814_01). It used
 * to be public, which meant every uploaded prescription scan — patient name,
 * phone, doctor, diagnosis — was readable by anyone holding the URL, with no
 * authentication. Reads now go through short-lived signed URLs.
 *
 * Two shapes exist in `attachment_url` and both must keep working:
 *   • legacy rows — a full public URL saved before the bucket was locked down
 *     (…/storage/v1/object/public/crm-bill-attachments/<pharmacy>/<file>)
 *   • new rows    — the bare object path (<pharmacy>/<file>)
 *
 * `toObjectPath` normalises either form, so no data migration is needed and
 * old rows start resolving through the signed path automatically.
 */
import { supabase } from '@/lib/supabase';

export const BILL_BUCKET = 'crm-bill-attachments';

/** How long a generated link stays valid. Long enough to open and read a
 *  scan, short enough that a leaked URL is not a standing exposure. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

/**
 * Reduce a stored `attachment_url` to a storage object path.
 * Returns null when the value is empty or points somewhere unrecognised —
 * callers should then render no attachment rather than a broken link.
 */
export function toObjectPath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  const value = urlOrPath.trim();
  if (!value) return null;

  // Already a bare path.
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    return value.replace(/^\/+/, '');
  }

  // Legacy full URL. Supabase serves these as
  //   /storage/v1/object/public/<bucket>/<path>
  // and signed ones as
  //   /storage/v1/object/sign/<bucket>/<path>
  const marker = `/${BILL_BUCKET}/`;
  const at = value.indexOf(marker);
  if (at === -1) return null;

  // Drop any query string (signed URLs carry ?token=…).
  const tail = value.slice(at + marker.length);
  const path = tail.split('?')[0] ?? '';
  return path ? decodeURIComponent(path) : null;
}

/**
 * Mint a temporary URL for a stored attachment.
 * Returns null if the caller is not entitled to the object — the storage RLS
 * policy scopes access to the pharmacy that owns the leading path segment, so
 * another pharmacy's scan simply fails to sign rather than leaking.
 */
export async function signedBillUrl(
  urlOrPath: string | null | undefined
): Promise<string | null> {
  const path = toObjectPath(urlOrPath);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(BILL_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.warn('[attachments] could not sign', path, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
