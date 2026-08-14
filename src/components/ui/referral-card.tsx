import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { Copy, Check, Link2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** A single row in the "How it works" list. */
export interface ReferralStep {
  icon: ReactNode;
  text: ReactNode;
}

export interface ReferralCardProps {
  /** The text to display in the top badge. */
  badgeText: string;
  /** The main title of the card. */
  title: string;
  /** A short description under the title. */
  description: string;
  /** Decorative illustration URL. Omit to render the card without one. */
  imageUrl?: string;
  /** An array of steps explaining how the referral works. */
  steps: ReferralStep[];
  /** The referral link to be copied. */
  referralLink: string;
  /** Optional additional class names for custom styling. */
  className?: string;

  /* ── Labels ──────────────────────────────────────────────────────────────
     Broken out as props (rather than hardcoded English) so callers in this
     bilingual app can pass `t('...')`. Defaults keep the component drop-in
     usable on its own. */
  howItWorksLabel?: string;
  inviteLinkLabel?: string;
  copyLabel?: string;
  copiedLabel?: string;
  /** Shown when the clipboard write fails — see `handleCopy` below. */
  copyErrorLabel?: string;
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 },
};

/**
 * Copy `text` without assuming `navigator.clipboard` exists.
 *
 * The Clipboard API is gated behind a secure context: it is `undefined` on
 * plain http:// origins other than localhost. This app's dev server binds with
 * `host: true`, so anyone testing via the LAN URL (http://192.168.x.x:5180)
 * hits exactly that case — as does any future deploy served over http. The
 * execCommand path is deprecated but remains the only fallback that works
 * there, so we try the modern API first and degrade rather than throw.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, or the document wasn't focused. Fall through.
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep it off-screen and non-disruptive: no scroll jump, no zoom on iOS.
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * A responsive and animated card component for displaying referral program
 * information. Theme-adaptive; styled with the app's shadcn CSS variables.
 */
export const ReferralCard = ({
  badgeText,
  title,
  description,
  imageUrl,
  steps,
  referralLink,
  className,
  howItWorksLabel = 'How it works:',
  inviteLinkLabel = 'Your invite link:',
  copyLabel = 'Copy Link',
  copiedLabel = 'Copied!',
  copyErrorLabel = "Couldn't copy automatically — select the link and copy it manually.",
}: ReferralCardProps) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  // Hold the reset timer so an unmount (or a rapid second click) clears it
  // instead of firing setState against a torn-down component.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(referralLink);
    setStatus(ok ? 'copied' : 'error');

    if (resetTimer.current) clearTimeout(resetTimer.current);
    // Leave the failure message up longer — it asks the user to act.
    resetTimer.current = setTimeout(() => setStatus('idle'), ok ? 2000 : 5000);
  }, [referralLink]);

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={cardVariants}
      className={cn(
        'relative w-full max-w-md overflow-hidden rounded-2xl border bg-card p-6 text-card-foreground shadow-lg sm:p-8',
        className
      )}
    >
      {/* Decorative only — hidden from assistive tech, and hidden outright on
          narrow screens where it would sit on top of the heading. */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="pointer-events-none absolute right-8 top-8 hidden h-32 w-32 opacity-80 sm:block"
        />
      )}

      <div className="relative z-10">
        <motion.div
          variants={itemVariants}
          className="mb-4 inline-block rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground"
        >
          {badgeText}
        </motion.div>

        {/* max-w leaves room for the illustration so long titles don't run under it. */}
        <motion.h2
          variants={itemVariants}
          className="mb-1 text-3xl font-bold tracking-tight sm:max-w-[calc(100%-9rem)]"
        >
          {title}
        </motion.h2>
        <motion.p
          variants={itemVariants}
          className="mb-6 text-muted-foreground sm:max-w-[calc(100%-9rem)]"
        >
          {description}
        </motion.p>

        <div className="mb-6">
          <motion.h3 variants={itemVariants} className="mb-4 font-semibold">
            {howItWorksLabel}
          </motion.h3>
          <motion.ul
            className="space-y-3"
            initial="hidden"
            animate="visible"
            transition={{ staggerChildren: 0.2, delayChildren: 0.3 }}
          >
            {steps.map((step, index) => (
              <motion.li
                key={index}
                variants={itemVariants}
                className="flex items-center gap-3"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                >
                  {step.icon}
                </span>
                <span className="text-sm text-muted-foreground">{step.text}</span>
              </motion.li>
            ))}
          </motion.ul>
        </div>

        <div>
          <motion.h3 variants={itemVariants} className="mb-2 font-semibold">
            {inviteLinkLabel}
          </motion.h3>
          <motion.div
            variants={itemVariants}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2"
          >
            <div className="flex h-10 min-w-0 flex-grow items-center gap-2 rounded-md border bg-background px-3">
              <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              {/* Selectable so the manual-copy fallback message is actionable. */}
              <p className="select-all truncate text-sm" title={referralLink}>
                {referralLink}
              </p>
            </div>
            <Button onClick={handleCopy} className="w-full shrink-0 sm:w-auto">
              <AnimatePresence mode="wait" initial={false}>
                {status === 'copied' ? (
                  <motion.span
                    key="copied"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="flex items-center gap-2"
                  >
                    <Check className="h-4 w-4" /> {copiedLabel}
                  </motion.span>
                ) : (
                  <motion.span
                    key="copy"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" /> {copyLabel}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </motion.div>

          {/* Announce both outcomes to screen readers; only the failure needs
              to stay visible, since the button itself confirms success. */}
          <div aria-live="polite" className="min-h-0">
            {status === 'error' && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                {copyErrorLabel}
              </p>
            )}
            {status === 'copied' && <span className="sr-only">{copiedLabel}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
