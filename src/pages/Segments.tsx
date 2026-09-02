import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Send, ArrowRight, X, Search, Filter, ChevronDown, ChevronUp,
  UserCheck, TrendingDown, Crown, RotateCcw, Pill, ShieldOff, SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
import { listCustomers } from '@/lib/api/customers';
import { cn, formatINR, relativeTime, initials } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag, type TagKey } from '@/components/ui/tag';
import { CampaignDialog } from '@/components/crm/CampaignDialog';

type SegmentKey = 'new' | 'repeat' | 'high_value' | 'inactive' | 'chronic' | 'optout';

// ─── Segment metadata (rich version) ───────────────────────────────────────
interface SegmentDef {
  key: SegmentKey;
  icon: React.ElementType;
  label: string;
  desc: string;
  criteria: string;
  typicalPct: string;
  useCase: string;
  help: string;
  accentBg: string;
  accentFg: string;
  borderColor: string;
  iconBg: string;
  canSend: boolean;
}

const SEGMENT_DEFS: SegmentDef[] = [
  {
    key: 'new',
    icon: UserCheck,
    label: 'New Customers',
    desc: 'First purchase in last 7 days',
    criteria: 'First purchase ≤ 7 days ago',
    typicalPct: '5–10%',
    useCase: 'Welcome campaigns',
    help: 'Best for: welcome flow',
    accentBg: 'bg-tag-new-bg',
    accentFg: 'text-tag-new-fg',
    borderColor: 'border-tag-new-bg',
    iconBg: 'bg-tag-new-bg',
    canSend: true,
  },
  {
    key: 'repeat',
    icon: RotateCcw,
    label: 'Repeat Customers',
    desc: '2 or more purchases',
    criteria: 'Purchase count ≥ 2',
    typicalPct: '30–40%',
    useCase: 'Loyalty offers',
    help: 'Best for: loyalty offers',
    accentBg: 'bg-tag-repeat-bg',
    accentFg: 'text-tag-repeat-fg',
    borderColor: 'border-tag-repeat-bg',
    iconBg: 'bg-tag-repeat-bg',
    canSend: true,
  },
  {
    key: 'inactive',
    icon: TrendingDown,
    label: 'Inactive',
    desc: 'No purchase in 30+ days',
    criteria: 'Last visit > 30 days ago',
    typicalPct: '15–20%',
    useCase: 'Win-back campaigns',
    help: 'Best for: win-back',
    accentBg: 'bg-tag-inactive-bg',
    accentFg: 'text-tag-inactive-fg',
    borderColor: 'border-tag-inactive-bg',
    iconBg: 'bg-tag-inactive-bg',
    canSend: true,
  },
  {
    key: 'high_value',
    icon: Crown,
    label: 'High Spenders',
    desc: 'Lifetime spend > ₹10,000',
    criteria: 'Lifetime value > ₹10,000',
    typicalPct: '10–15%',
    useCase: 'Premium offers',
    help: 'Best for: premium offers',
    accentBg: 'bg-tag-high-bg',
    accentFg: 'text-tag-high-fg',
    borderColor: 'border-tag-high-bg',
    iconBg: 'bg-tag-high-bg',
    canSend: true,
  },
  {
    key: 'chronic',
    icon: Pill,
    label: 'Chronic Patients',
    desc: 'Long-term medication buyers',
    criteria: 'Manually tagged "Chronic"',
    typicalPct: 'Varies',
    useCase: 'Regular refill reminders',
    help: 'Best for: refill reminders',
    accentBg: 'bg-tag-chronic-bg',
    accentFg: 'text-tag-chronic-fg',
    borderColor: 'border-tag-chronic-bg',
    iconBg: 'bg-tag-chronic-bg',
    canSend: true,
  },
  {
    key: 'optout',
    icon: ShieldOff,
    label: 'Opted Out',
    desc: 'Excluded from all sends',
    criteria: 'WhatsApp opted out',
    typicalPct: '<5% target',
    useCase: 'Compliance tracking',
    help: 'Compliance protection',
    accentBg: 'bg-tag-optout-bg',
    accentFg: 'text-tag-optout-fg',
    borderColor: 'border-tag-optout-bg',
    iconBg: 'bg-tag-optout-bg',
    canSend: false,
  },
];

// ─── Customer drawer ────────────────────────────────────────────────────────
interface CustomerDrawerProps {
  segmentKey: SegmentKey;
  segmentLabel: string;
  pharmacyId: string;
  onClose: () => void;
}

function CustomerDrawer({ segmentKey, segmentLabel, pharmacyId, onClose }: CustomerDrawerProps) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['segment-customers', pharmacyId, segmentKey, search],
    queryFn: () =>
      listCustomers({ pharmacyId, segment: segmentKey, search: search || undefined, limit: 50 }),
    enabled: !!pharmacyId,
  });

  const rows = data?.rows ?? [];

  return (
    <>
      {/* Backdrop */}
      <motion.button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />

      {/* Panel */}
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`${segmentLabel} customers`}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-xl sm:w-[520px] top-14 md:top-0"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Segment
            </div>
            <div className="mt-0.5 text-lg font-bold">{segmentLabel}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="border-b px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="pl-9"
            />
          </div>
        </div>

        {/* Count badge */}
        <div className="flex items-center gap-2 border-b bg-muted/30 px-6 py-2.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {isLoading ? '…' : `${data?.total ?? 0} customers`}
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-6 py-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Users className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No customers in this segment</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {search ? 'Try a different search term' : 'Customers are auto-assigned based on activity'}
              </p>
            </div>
          ) : (
            rows.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.015 }}
              >
                <Link
                  to={`/customers/${c.id}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {initials(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                      <div className="flex gap-1">
                        {c.auto_tags.slice(0, 2).map((tag: TagKey) => (
                          <Tag key={tag} tag={tag} />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="font-mono text-xs text-muted-foreground">{c.phone}</span>
                      {c.stats?.last_visit_at && (
                        <span className="text-xs text-muted-foreground">
                          {relativeTime(c.stats.last_visit_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {c.stats && (
                      <div className="font-mono text-sm font-medium">
                        {formatINR(c.stats.lifetime_value)}
                      </div>
                    )}
                    <ArrowRight className="ml-auto mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              </motion.div>
            ))
          )}
        </div>
      </motion.aside>
    </>
  );
}

// ─── Custom filter builder ──────────────────────────────────────────────────
interface CustomFilter {
  lastVisitMin: string; // days ago min
  lastVisitMax: string; // days ago max
  spendMin: string;
  spendMax: string;
  ageMin: string;
  ageMax: string;
  gender: '' | 'Male' | 'Female' | 'Other';
  tags: TagKey[];
}

const EMPTY_FILTER: CustomFilter = {
  lastVisitMin: '',
  lastVisitMax: '',
  spendMin: '',
  spendMax: '',
  ageMin: '',
  ageMax: '',
  gender: '',
  tags: [],
};

const TAG_OPTIONS: { key: TagKey; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'high_value', label: 'High Value' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'chronic', label: 'Chronic' },
  { key: 'optout', label: 'Opt-out' },
];

function hasFilter(f: CustomFilter) {
  return !!(
    f.lastVisitMin || f.lastVisitMax || f.spendMin || f.spendMax ||
    f.ageMin || f.ageMax || f.gender || f.tags.length
  );
}

interface CustomFilterBuilderProps {
  pharmacyId: string;
  onStartCampaign: (segKey: string) => void;
}

function CustomFilterBuilder({ pharmacyId, onStartCampaign }: CustomFilterBuilderProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<CustomFilter>(EMPTY_FILTER);

  const active = hasFilter(filter);

  // Live count — queries crm_customers + crm_customer_stats + auto_tags
  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: ['custom-segment-preview', pharmacyId, filter],
    enabled: open && active,
    queryFn: async () => {
      // Fetch all customers for this pharmacy (limit 200 for preview)
      const { data: customers, error } = await supabase
        .from('crm_customers')
        .select('id, age, gender, whatsapp_opted_in')
        .eq('pharmacy_id', pharmacyId)
        .limit(200);
      if (error) throw error;
      const ids = (customers ?? []).map((c: { id: string }) => c.id);
      if (ids.length === 0) return { count: 0, samples: [] };

      // Fetch stats
      const [statsRes, autoTagsRes] = await Promise.all([
        supabase.from('crm_customer_stats').select('*').in('customer_id', ids),
        supabase.from('crm_customer_auto_tags').select('*').in('customer_id', ids),
      ]);

      const statsMap = new Map(
        ((statsRes.data ?? []) as Array<{ customer_id: string; lifetime_value: number; last_visit_at: string | null; visit_count: number }>)
          .map((s) => [s.customer_id, s])
      );
      const tagsMap = new Map<string, string[]>();
      for (const row of (autoTagsRes.data ?? []) as Array<{ customer_id: string; tag: string }>) {
        const list = tagsMap.get(row.customer_id) ?? [];
        list.push(row.tag);
        tagsMap.set(row.customer_id, list);
      }

      // Also fetch manual tags (chronic)
      const manualRes = await supabase
        .from('crm_tags')
        .select('customer_id, tag_key')
        .in('customer_id', ids);
      for (const row of (manualRes.data ?? []) as Array<{ customer_id: string; tag_key: string }>) {
        const list = tagsMap.get(row.customer_id) ?? [];
        if (!list.includes(row.tag_key)) list.push(row.tag_key);
        tagsMap.set(row.customer_id, list);
      }

      for (const c of (customers ?? []) as Array<{ id: string; whatsapp_opted_in: boolean }>) {
        if (!c.whatsapp_opted_in) {
          const list = tagsMap.get(c.id) ?? [];
          if (!list.includes('optout')) list.push('optout');
          tagsMap.set(c.id, list);
        }
      }

      const now = Date.now();
      const MS_PER_DAY = 86_400_000;

      const matched = (customers ?? []).filter((c: { id: string; age: number | null; gender: string | null; whatsapp_opted_in: boolean }) => {
        const stats = statsMap.get(c.id);
        const tags = tagsMap.get(c.id) ?? [];

        // Last visit filters (days ago)
        if (filter.lastVisitMin || filter.lastVisitMax) {
          const lastVisit = stats?.last_visit_at ? new Date(stats.last_visit_at).getTime() : null;
          const daysAgo = lastVisit ? (now - lastVisit) / MS_PER_DAY : null;
          if (filter.lastVisitMin && daysAgo !== null && daysAgo < Number(filter.lastVisitMin)) return false;
          if (filter.lastVisitMax && (daysAgo === null || daysAgo > Number(filter.lastVisitMax))) return false;
        }

        // Spend filters
        const ltv = stats?.lifetime_value ?? 0;
        if (filter.spendMin && ltv < Number(filter.spendMin)) return false;
        if (filter.spendMax && ltv > Number(filter.spendMax)) return false;

        // Age filters
        if (filter.ageMin && (c.age == null || c.age < Number(filter.ageMin))) return false;
        if (filter.ageMax && (c.age == null || c.age > Number(filter.ageMax))) return false;

        // Gender
        if (filter.gender && c.gender !== filter.gender) return false;

        // Tags (customer must have ALL selected tags)
        if (filter.tags.length > 0) {
          if (!filter.tags.every((t) => tags.includes(t))) return false;
        }

        return true;
      });

      // Fetch names for sample
      const sampleIds = matched.slice(0, 3).map((c: { id: string }) => c.id);
      let samples: { id: string; name: string; phone: string }[] = [];
      if (sampleIds.length > 0) {
        const { data: names } = await supabase
          .from('crm_customers')
          .select('id, name, phone')
          .in('id', sampleIds);
        samples = (names ?? []) as { id: string; name: string; phone: string }[];
      }

      return { count: matched.length, samples };
    },
  });

  const toggleTag = (tag: TagKey) => {
    setFilter((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));
  };

  const reset = () => setFilter(EMPTY_FILTER);

  return (
    <Card className="overflow-hidden">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-accent/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Custom Filter Builder</span>
              {active && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                  Active
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Build a one-off segment by combining last visit, spend, age, gender, and tags
            </p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Filter form */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t px-6 py-5 space-y-5">
              {/* Last visit */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Visit (days ago)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Min days ago</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 7"
                      value={filter.lastVisitMin}
                      onChange={(e) => setFilter((f) => ({ ...f, lastVisitMin: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Max days ago</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 90"
                      value={filter.lastVisitMax}
                      onChange={(e) => setFilter((f) => ({ ...f, lastVisitMax: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Spend */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Spend (₹)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Min spend</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 5000"
                      value={filter.spendMin}
                      onChange={(e) => setFilter((f) => ({ ...f, spendMin: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Max spend</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 50000"
                      value={filter.spendMax}
                      onChange={(e) => setFilter((f) => ({ ...f, spendMax: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Age + Gender */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Age Range
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Min"
                      value={filter.ageMin}
                      onChange={(e) => setFilter((f) => ({ ...f, ageMin: e.target.value }))}
                    />
                    <Input
                      type="number"
                      min="0"
                      placeholder="Max"
                      value={filter.ageMax}
                      onChange={(e) => setFilter((f) => ({ ...f, ageMax: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Gender
                  </label>
                  <select
                    value={filter.gender}
                    onChange={(e) => setFilter((f) => ({ ...f, gender: e.target.value as CustomFilter['gender'] }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Any</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Has Tags (all selected)
                </label>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => toggleTag(opt.key)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                        filter.tags.includes(opt.key)
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview + actions */}
              {active && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border bg-muted/40 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Segment Preview
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="font-mono text-3xl font-bold">
                          {previewLoading ? '…' : (previewData?.count ?? 0)}
                        </span>
                        <span className="text-sm text-muted-foreground">customers match</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reset}
                      className="shrink-0"
                    >
                      <Filter className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </div>
                  {previewData && previewData.samples.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Sample:</div>
                      {previewData.samples.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                          <span className="text-sm font-medium">{s.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{s.phone}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4">
                    <Button
                      onClick={() => onStartCampaign('all')}
                      disabled={!previewData || previewData.count === 0}
                      className="w-full"
                    >
                      <Send className="h-4 w-4" />
                      Send Campaign to This Group
                    </Button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─── Segment card ───────────────────────────────────────────────────────────
interface SegmentCardProps {
  def: SegmentDef;
  count: number | undefined;
  totalCustomers: number;
  isLoading: boolean;
  index: number;
  onViewCustomers: (key: SegmentKey) => void;
  onSendCampaign: (key: SegmentKey) => void;
}

function SegmentCard({
  def, count, totalCustomers, isLoading, index,
  onViewCustomers, onSendCampaign,
}: SegmentCardProps) {
  const Icon = def.icon;
  const pct = count != null && totalCustomers > 0
    ? Math.round((count / totalCustomers) * 100)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="group relative overflow-hidden transition-shadow hover:shadow-md">
        {/* Accent top stripe */}
        <div className={cn('h-1 w-full', def.accentBg)} />

        <div className="p-5">
          {/* Icon + badge */}
          <div className="flex items-start justify-between">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', def.iconBg)}>
              <Icon className={cn('h-5 w-5', def.accentFg)} />
            </div>
            {pct !== null && (
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                def.accentBg, def.accentFg
              )}>
                {pct}% of total
              </span>
            )}
          </div>

          {/* Label + desc */}
          <div className="mt-3">
            <h3 className="font-bold">{def.label}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{def.desc}</p>
          </div>

          {/* Big count */}
          <div className="mt-4">
            {isLoading ? (
              <Skeleton className="h-10 w-20" />
            ) : (
              <div className="font-mono text-4xl font-bold tracking-tight">{count ?? 0}</div>
            )}
            <div className="mt-0.5 text-xs text-muted-foreground">customers</div>
          </div>

          {/* Meta info */}
          <div className="mt-4 space-y-1.5 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Criteria</span>
              <span className="font-medium">{def.criteria}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Typical share</span>
              <span className="font-medium">{def.typicalPct}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Use case</span>
              <span className="font-medium text-primary">{def.useCase}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onViewCustomers(def.key)}
            >
              <Users className="h-3.5 w-3.5" />
              View Customers
            </Button>
            {def.canSend && (
              <Button
                size="sm"
                className="flex-1"
                disabled={!count}
                onClick={() => onSendCampaign(def.key)}
              >
                <Send className="h-3.5 w-3.5" />
                Campaign
              </Button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function Segments() {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const [drawerSegment, setDrawerSegment] = useState<SegmentKey | null>(null);
  const [campaignSegment, setCampaignSegment] = useState<string | null>(null);
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);

  // Segment counts
  const { data: counts, isLoading } = useQuery<Record<SegmentKey | 'total', number>>({
    queryKey: ['segment-counts', pharmacyId],
    queryFn: async () => {
      const [autoTags, optOuts, totalCustomers] = await Promise.all([
        supabase
          .from('crm_customer_auto_tags')
          .select('tag, customer_id')
          .eq('pharmacy_id', pharmacyId),
        supabase
          .from('crm_customers')
          .select('id', { count: 'exact', head: true })
          .eq('pharmacy_id', pharmacyId)
          .eq('whatsapp_opted_in', false),
        supabase
          .from('crm_customers')
          .select('id', { count: 'exact', head: true })
          .eq('pharmacy_id', pharmacyId),
      ]);

      // Chronic: manual tags
      const chronicRes = await supabase
        .from('crm_tags')
        .select('customer_id')
        .eq('pharmacy_id', pharmacyId)
        .eq('tag_key', 'chronic');
      const uniqueChronicIds = new Set(
        ((chronicRes.data ?? []) as { customer_id: string }[]).map((r) => r.customer_id)
      );

      const counter: Record<SegmentKey | 'total', number> = {
        new: 0, repeat: 0, high_value: 0, inactive: 0, chronic: 0, optout: 0, total: 0,
      };

      // Deduplicate per customer per tag type
      const seen = new Map<string, Set<string>>();
      for (const row of (autoTags.data ?? []) as { tag: string; customer_id: string }[]) {
        if (!(row.tag in counter)) continue;
        const key = row.tag as SegmentKey;
        if (!seen.has(key)) seen.set(key, new Set());
        if (!seen.get(key)!.has(row.customer_id)) {
          seen.get(key)!.add(row.customer_id);
          counter[key] += 1;
        }
      }

      counter.chronic = uniqueChronicIds.size;
      counter.optout = optOuts.count ?? 0;
      counter.total = totalCustomers.count ?? 0;
      return counter;
    },
  });

  const openCampaign = (segKey: string) => {
    setCampaignSegment(segKey);
    setCampaignDialogOpen(true);
  };

  const drawerDef = drawerSegment ? SEGMENT_DEFS.find((d) => d.key === drawerSegment) : null;

  // Summary stats
  const totalCustomers = counts?.total ?? 0;
  const activeSegments = SEGMENT_DEFS.filter((d) => d.key !== 'optout' && (counts?.[d.key] ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('nav.section.crm')}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{t('segments.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('segments.subtitle')}</p>
      </header>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: 'Total Customers',
            value: isLoading ? null : totalCustomers,
            icon: Users,
          },
          {
            label: 'Active Segments',
            value: isLoading ? null : activeSegments,
            icon: Filter,
          },
          {
            label: 'Sendable Customers',
            value: isLoading ? null : (totalCustomers - (counts?.optout ?? 0)),
            icon: Send,
          },
          {
            label: 'Opt-out Rate',
            value: isLoading ? null : (
              totalCustomers > 0
                ? `${Math.round(((counts?.optout ?? 0) / totalCustomers) * 100)}%`
                : '0%'
            ),
            icon: ShieldOff,
          },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            <div className="mt-1 font-mono text-2xl font-bold">
              {value === null ? <Skeleton className="h-7 w-16" /> : value}
            </div>
          </Card>
        ))}
      </div>

      {/* Segment cards */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Pre-built Segments
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SEGMENT_DEFS.map((def, i) => (
            <SegmentCard
              key={def.key}
              def={def}
              count={counts?.[def.key]}
              totalCustomers={totalCustomers}
              isLoading={isLoading}
              index={i}
              onViewCustomers={(key) => { window.scrollTo({ top: 0, behavior: 'smooth' }); setDrawerSegment(key); }}
              onSendCampaign={(key) => openCampaign(key)}
            />
          ))}
        </div>
      </div>

      {/* Custom filter builder */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Custom Segment
        </h2>
        <CustomFilterBuilder
          pharmacyId={pharmacyId}
          onStartCampaign={openCampaign}
        />
      </div>

      {/* Customer drawer */}
      <AnimatePresence>
        {drawerSegment && drawerDef && (
          <CustomerDrawer
            key={drawerSegment}
            segmentKey={drawerSegment}
            segmentLabel={drawerDef.label}
            pharmacyId={pharmacyId}
            onClose={() => setDrawerSegment(null)}
          />
        )}
      </AnimatePresence>

      {/* Campaign dialog — pre-filled segment */}
      <CampaignDialog
        open={campaignDialogOpen}
        onOpenChange={(v) => {
          setCampaignDialogOpen(v);
          if (!v) setCampaignSegment(null);
        }}
        campaign={null}
        initialSegmentKey={campaignSegment ?? undefined}
      />
    </div>
  );
}
