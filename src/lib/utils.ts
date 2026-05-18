import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** ₹1,234.56 — locale-aware INR formatter */
export function formatINR(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

/** "2 days ago" / "Today" / "Just now" */
export function relativeTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 24 * 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true });
  return formatDistanceToNow(d, { addSuffix: true });
}

/** 7 May 2026 · 2:34 PM */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'd MMM yyyy · h:mm a');
}

/** Validate Indian phone in E.164 form (+91XXXXXXXXXX) */
export function validateIndianPhone(input: string): { ok: true; e164: string } | { ok: false; error: string } {
  const cleaned = input.replace(/[\s\-()]/g, '');
  // already E.164
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) return { ok: true, e164: cleaned };
  // 10-digit
  if (/^[6-9]\d{9}$/.test(cleaned)) return { ok: true, e164: '+91' + cleaned };
  // 91XXXXXXXXXX
  if (/^91[6-9]\d{9}$/.test(cleaned)) return { ok: true, e164: '+' + cleaned };
  return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };
}

/** Stable initials from a name */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Safe localStorage with JSON serialisation */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / SSR */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* */ }
  },
};

/** Render template body with variables: "Hi {name}" + { name: "Priya" } → "Hi Priya" */
export function renderTemplate(body: string, vars: Record<string, string | number | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}
