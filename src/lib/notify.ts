/**
 * Reminder-notification preferences (per-device, localStorage).
 *
 * The "interval" controls how often the Today's-Reminders popup re-appears
 * after the user dismisses it, as long as reminders are still pending.
 *   0  → "Off": show once per session, never re-open after dismiss.
 *   N  → re-open N minutes after each dismiss.
 */
import { storage } from '@/lib/utils';

const NOTIFY_INTERVAL_KEY = 'medcrm.notify_interval_min';
const SNOOZE_UNTIL_KEY = 'medcrm.popup_snoozed_until';
const DEFAULT_NOTIFY_INTERVAL = 60; // minutes

/** Selectable intervals (minutes). 0 = off. */
export const NOTIFY_INTERVAL_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0,   labelKey: 'notify.interval.off' },
  { value: 15,  labelKey: 'notify.interval.15m' },
  { value: 30,  labelKey: 'notify.interval.30m' },
  { value: 60,  labelKey: 'notify.interval.1h' },
  { value: 120, labelKey: 'notify.interval.2h' },
  { value: 240, labelKey: 'notify.interval.4h' },
];

export function getNotifyInterval(): number {
  const v = storage.get<number>(NOTIFY_INTERVAL_KEY, DEFAULT_NOTIFY_INTERVAL);
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_NOTIFY_INTERVAL;
}

export function setNotifyInterval(min: number): void {
  storage.set(NOTIFY_INTERVAL_KEY, min);
  // Changing the cadence clears any active snooze so the new setting applies now.
  storage.remove(SNOOZE_UNTIL_KEY);
}

/** Timestamp (ms) before which the popup should stay hidden. */
export function getSnoozedUntil(): number {
  return storage.get<number>(SNOOZE_UNTIL_KEY, 0) ?? 0;
}

/** Snooze the popup based on the current interval setting.
 *  Off (0) → snooze for ~100 years (effectively "don't auto-reopen"). */
export function snoozePopup(): void {
  const interval = getNotifyInterval();
  const until = interval === 0
    ? Date.now() + 100 * 365 * 24 * 60 * 60 * 1000
    : Date.now() + interval * 60 * 1000;
  storage.set(SNOOZE_UNTIL_KEY, until);
}
