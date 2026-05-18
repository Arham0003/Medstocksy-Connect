import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RateMeterProps {
  current: number;
  cap: number;
  windowOk?: boolean;
  windowStart?: string; // "09:00:00"
  windowEnd?: string;   // "20:00:00"
  compact?: boolean;
}

/** Theme rule §5.7 — surface as ambient UI, not an error state. */
export function RateMeter({ current, cap, windowOk = true, windowStart, windowEnd, compact }: RateMeterProps) {
  const pct = Math.min(100, (current / cap) * 100);
  const tone =
    current >= cap ? 'danger' : current >= cap * 0.8 ? 'warning' : 'ok';

  const trackBg = 'bg-muted';
  const fillCls = tone === 'danger' ? 'bg-destructive' : tone === 'warning' ? 'bg-yellow-500' : 'bg-emerald-500';
  const labelCls = tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-yellow-700' : 'text-emerald-700';

  return (
    <div className={cn('w-full', compact ? 'space-y-1' : 'space-y-2')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>Sends this hour</span>
        </div>
        <div className={cn('font-mono text-sm font-semibold', labelCls)}>
          <span className="num">{current}</span> / <span className="num">{cap}</span>
        </div>
      </div>

      <div className={cn('h-1.5 w-full overflow-hidden rounded-full', trackBg)}>
        <motion.div
          className={cn('h-full rounded-full', fillCls)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {!compact && windowStart && windowEnd && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Send window {windowStart.slice(0, 5)} – {windowEnd.slice(0, 5)} IST</span>
          <span className={windowOk ? 'text-emerald-700' : 'text-destructive'}>
            {windowOk ? '✓ within window' : '✗ outside window'}
          </span>
        </div>
      )}
    </div>
  );
}
