import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle2, AlertTriangle, LogOut, Trash2,
  Building2, MessageCircle, User as UserIcon, ShieldAlert, Sliders, Globe,
  ImagePlus, X as XIcon, Sun, Moon, Monitor, Palette,
  Info, Mail,
} from 'lucide-react';
import { useActivePharmacy, usePharmacy } from '@/contexts/PharmacyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage, useT } from '@/contexts/LanguageContext';
import { useTheme, type Theme } from '@/contexts/ThemeContext';
import { SUPPORTED_LANGUAGES, type Lang } from '@/i18n/translations';
import { supabase, type Tables } from '@/lib/supabase';
import { validateIndianPhone, initials, cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import medstocksyLogo from '@/assets/brand/medstocksy.png';

type Pharmacy = Tables<'crm_pharmacies'>;
type SectionKey = 'general' | 'preferences' | 'whatsapp' | 'account' | 'about' | 'danger';

const SECTIONS: { key: SectionKey; icon: typeof Building2; titleKey: 'settings.section.general' | 'settings.section.preferences' | 'settings.section.whatsapp' | 'settings.section.account' | 'settings.section.about' | 'settings.section.danger'; adminOnly?: boolean }[] = [
  { key: 'general', icon: Building2, titleKey: 'settings.section.general' },
  { key: 'preferences', icon: Sliders, titleKey: 'settings.section.preferences' },
  { key: 'whatsapp', icon: MessageCircle, titleKey: 'settings.section.whatsapp' },
  { key: 'account', icon: UserIcon, titleKey: 'settings.section.account' },
  { key: 'about', icon: Info, titleKey: 'settings.section.about' },
  { key: 'danger', icon: ShieldAlert, titleKey: 'settings.section.danger', adminOnly: true },
];

export default function Settings() {
  const { pharmacyId, role } = useActivePharmacy();
  const isAdmin = role === 'admin';
  const t = useT();

  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = (searchParams.get('s') ?? 'general') as SectionKey;
  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);
  const section = visibleSections.find((s) => s.key === sectionParam)?.key ?? 'general';

  const setSection = (next: SectionKey) => {
    const p = new URLSearchParams(searchParams);
    if (next === 'general') p.delete('s'); else p.set('s', next);
    setSearchParams(p, { replace: true });
  };

  const { data: pharmacy, isLoading } = useQuery<Pharmacy>({
    queryKey: ['pharmacy', pharmacyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_pharmacies').select('*').eq('id', pharmacyId).single();
      if (error) throw error;
      return data as unknown as Pharmacy;
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs text-muted-foreground">Customer relations</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Side nav */}
        <SideNav section={section} onChange={setSection} sections={visibleSections} />

        {/* Section content */}
        <div className="min-w-0">
          {isLoading || !pharmacy ? (
            <SettingsSkeleton />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {section === 'general' && <PharmacySection pharmacy={pharmacy} canEdit={isAdmin} />}
                {section === 'preferences' && <PreferencesSection />}
                {section === 'whatsapp' && <WhatsAppSection pharmacy={pharmacy} canEdit={isAdmin} />}
                {section === 'account' && <AccountSection />}
                {section === 'about' && <AboutSection />}
                {section === 'danger' && isAdmin && <DangerZone pharmacy={pharmacy} />}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDE NAV (desktop) / horizontal scroll (mobile)
// ─────────────────────────────────────────────────────────────────────────────
function SideNav({
  section, onChange, sections,
}: {
  section: SectionKey;
  onChange: (s: SectionKey) => void;
  sections: typeof SECTIONS;
}) {
  const t = useT();
  return (
    <nav
      aria-label="Settings sections"
      className="lg:sticky lg:top-4"
    >
      {/* Mobile: horizontal scrollable */}
      <div className="flex gap-1 overflow-x-auto pb-1 lg:hidden">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          return (
            <button
              key={s.key}
              onClick={() => onChange(s.key)}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                s.key === 'danger' && active && 'border-destructive bg-destructive/10 text-destructive',
                s.key === 'danger' && !active && 'text-destructive/80'
              )}
            >
              <Icon className="h-4 w-4" />
              {t(s.titleKey)}
            </button>
          );
        })}
      </div>

      {/* Desktop: vertical stack */}
      <ul className="hidden space-y-1 lg:block">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          return (
            <li key={s.key}>
              <button
                onClick={() => onChange(s.key)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  s.key === 'danger' && active && 'bg-destructive/10 text-destructive',
                  s.key === 'danger' && !active && 'text-destructive/80'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{t(s.titleKey)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHARMACY (General)
// ─────────────────────────────────────────────────────────────────────────────
interface SectionProps { pharmacy: Pharmacy; canEdit: boolean }

function PharmacySection({ pharmacy, canEdit }: SectionProps) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(pharmacy.name);
  const [phone, setPhone] = useState(pharmacy.phone ?? '');
  const [whatsappNumber, setWhatsappNumber] = useState(pharmacy.whatsapp_number ?? '');
  const [address, setAddress] = useState(pharmacy.address ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setName(pharmacy.name);
    setPhone(pharmacy.phone ?? '');
    setWhatsappNumber(pharmacy.whatsapp_number ?? '');
    setAddress(pharmacy.address ?? '');
  }, [pharmacy]);

  const dirty =
    name !== pharmacy.name ||
    (phone || '') !== (pharmacy.phone ?? '') ||
    (whatsappNumber || '') !== (pharmacy.whatsapp_number ?? '') ||
    (address || '') !== (pharmacy.address ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = { name: name.trim() };
      if (phone.trim()) {
        const v = validateIndianPhone(phone);
        if (!v.ok) throw new Error(`${t('onb.contact_phone')}: ${v.error}`);
        patch['phone'] = v.e164;
      } else patch['phone'] = null;

      if (whatsappNumber.trim()) {
        const v = validateIndianPhone(whatsappNumber);
        if (!v.ok) throw new Error(`${t('onb.whatsapp_number')}: ${v.error}`);
        patch['whatsapp_number'] = v.e164;
      } else patch['whatsapp_number'] = null;

      patch['address'] = address.trim() || null;
      const { error } = await supabase
        .from('crm_pharmacies').update(patch as never).eq('id', pharmacy.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy', pharmacy.id] });
      qc.invalidateQueries({ queryKey: ['memberships'] });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2400);
    },
  });

  return (
    <Card className="p-6">
      <SectionHeader title={t('settings.general.heading')} description={t('settings.general.desc')} canEdit={canEdit} />

      {/* Pharmacy logo uploader */}
      <LogoUploader pharmacy={pharmacy} canEdit={canEdit} />

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>{t('onb.pharmacy_name')}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit || save.isPending} maxLength={120} />
        </div>
        <div>
          <Label>{t('onb.contact_phone')}</Label>
          <PhoneInput value={phone} onChange={(v) => { setPhone(v); if (phoneError) setPhoneError(null); }}
            onBlur={() => {
              if (!phone.trim()) { setPhoneError(null); return; }
              const v = validateIndianPhone(phone);
              setPhoneError(v.ok ? null : v.error);
            }}
            disabled={!canEdit || save.isPending} error={phoneError} />
        </div>
        <div>
          <Label>{t('onb.whatsapp_number')}</Label>
          <PhoneInput value={whatsappNumber} onChange={(v) => { setWhatsappNumber(v); if (waError) setWaError(null); }}
            onBlur={() => {
              if (!whatsappNumber.trim()) { setWaError(null); return; }
              const v = validateIndianPhone(whatsappNumber);
              setWaError(v.ok ? null : v.error);
            }}
            disabled={!canEdit || save.isPending} error={waError} />
        </div>
        <div className="md:col-span-2">
          <Label>{t('settings.general.address')} <span className="text-xs font-normal text-muted-foreground">({t('common.optional')})</span></Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canEdit || save.isPending} maxLength={240} />
        </div>
      </div>

      {canEdit && (
        <SectionFooter dirty={dirty} savedAt={savedAt} isPending={save.isPending}
          isError={save.isError} errorMsg={save.error?.message}
          onSave={() => save.mutate()}
          onReset={() => {
            setName(pharmacy.name); setPhone(pharmacy.phone ?? '');
            setWhatsappNumber(pharmacy.whatsapp_number ?? ''); setAddress(pharmacy.address ?? '');
            setPhoneError(null); setWaError(null);
          }}
        />
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCES (NEW) — language switcher
// ─────────────────────────────────────────────────────────────────────────────
function PreferencesSection() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const themeOptions: { value: Theme; icon: typeof Sun; labelKey: 'settings.prefs.theme_light' | 'settings.prefs.theme_dark' | 'settings.prefs.theme_system' }[] = [
    { value: 'light', icon: Sun, labelKey: 'settings.prefs.theme_light' },
    { value: 'dark', icon: Moon, labelKey: 'settings.prefs.theme_dark' },
    { value: 'system', icon: Monitor, labelKey: 'settings.prefs.theme_system' },
  ];

  return (
    <Card className="p-6">
      <SectionHeader
        title={t('settings.prefs.heading')}
        description={t('settings.prefs.desc')}
        canEdit
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* ── Appearance tile ── */}
        <PreferenceTile
          icon={Palette}
          label={t('settings.prefs.theme')}
          hint={
            theme === 'system'
              ? `${t('settings.prefs.theme_system_active')} ${resolvedTheme.toUpperCase()}`
              : t('settings.prefs.theme_desc')
          }
        >
          <SegmentedControl ariaLabel={t('settings.prefs.theme')}>
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const selected = theme === opt.value;
              return (
                <SegmentButton
                  key={opt.value}
                  selected={selected}
                  onClick={() => setTheme(opt.value)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(opt.labelKey)}
                </SegmentButton>
              );
            })}
          </SegmentedControl>
        </PreferenceTile>

        {/* ── Language tile ── */}
        <PreferenceTile
          icon={Globe}
          label={t('settings.prefs.language')}
          hint={t('settings.prefs.language_footer')}
        >
          <SegmentedControl ariaLabel={t('settings.prefs.language')}>
            {SUPPORTED_LANGUAGES.map((l) => {
              const selected = lang === l.code;
              return (
                <SegmentButton
                  key={l.code}
                  selected={selected}
                  onClick={() => setLang(l.code as Lang)}
                >
                  <span className={cn('font-medium', selected && 'tracking-tight')}>
                    {l.nativeLabel}
                  </span>
                  <span className="ml-1 font-mono text-[9px] uppercase tracking-wider opacity-60">
                    {l.code}
                  </span>
                </SegmentButton>
              );
            })}
          </SegmentedControl>
        </PreferenceTile>
      </div>
    </Card>
  );
}

// ─── Preference tile primitives ─────────────────────────────────────────────

function PreferenceTile({
  icon: Icon, label, hint, children,
}: {
  icon: typeof Sun; label: string; hint: string; children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </div>
        </div>
      </div>
      {children}
      <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SegmentedControl({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full rounded-lg border bg-muted/60 p-1"
    >
      {children}
    </div>
  );
}

function SegmentButton({
  selected, onClick, children,
}: {
  selected: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-all',
        selected
          // Loud active state: primary fill + white text + ring + shadow.
          ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30 ring-1 ring-primary/40'
          // Quiet inactive state: lighter than the track, no fill, dim text.
          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP
// ─────────────────────────────────────────────────────────────────────────────
function WhatsAppSection({ pharmacy, canEdit }: SectionProps) {
  const t = useT();
  const qc = useQueryClient();
  const [rate, setRate] = useState(pharmacy.rate_limit_per_hour);
  const [windowStart, setWindowStart] = useState(pharmacy.send_window_start.slice(0, 5));
  const [windowEnd, setWindowEnd] = useState(pharmacy.send_window_end.slice(0, 5));
  const [bulk, setBulk] = useState(pharmacy.bulk_approval_threshold);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setRate(pharmacy.rate_limit_per_hour);
    setWindowStart(pharmacy.send_window_start.slice(0, 5));
    setWindowEnd(pharmacy.send_window_end.slice(0, 5));
    setBulk(pharmacy.bulk_approval_threshold);
  }, [pharmacy]);

  const dirty =
    rate !== pharmacy.rate_limit_per_hour ||
    windowStart !== pharmacy.send_window_start.slice(0, 5) ||
    windowEnd !== pharmacy.send_window_end.slice(0, 5) ||
    bulk !== pharmacy.bulk_approval_threshold;

  const save = useMutation({
    mutationFn: async () => {
      if (rate < 1 || rate > 20) throw new Error('Rate limit must be between 1 and 20.');
      if (bulk < 1 || bulk > 5000) throw new Error('Bulk threshold must be between 1 and 5,000.');
      if (windowStart >= windowEnd) throw new Error('Send window end must be after start.');

      const { error } = await supabase
        .from('crm_pharmacies')
        .update({
          rate_limit_per_hour: rate,
          send_window_start: `${windowStart}:00`,
          send_window_end: `${windowEnd}:00`,
          bulk_approval_threshold: bulk,
        } as never)
        .eq('id', pharmacy.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy', pharmacy.id] });
      qc.invalidateQueries({ queryKey: ['whatsapp-health'] });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2400);
    },
  });

  return (
    <Card className="p-6">
      <SectionHeader title={t('settings.wa.heading')} description={t('settings.wa.desc')} canEdit={canEdit} />

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <Label>
            {t('settings.wa.rate_limit')}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{rate} / hour</span>
          </Label>
          <input type="range" min={1} max={20} value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            disabled={!canEdit || save.isPending}
            className="mt-2 w-full accent-primary"
          />
          <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>1</span><span>safe (10)</span><span>20</span>
          </div>
        </div>
        <div>
          <Label>{t('settings.wa.bulk_threshold')}</Label>
          <Input type="number" min={1} max={5000} className="font-mono"
            value={bulk} onChange={(e) => setBulk(Number(e.target.value) || 0)}
            disabled={!canEdit || save.isPending} />
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.wa.bulk_hint')}</p>
        </div>
        <div>
          <Label>{t('settings.wa.window_start')}</Label>
          <Input type="time" className="font-mono" value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)} disabled={!canEdit || save.isPending} />
        </div>
        <div>
          <Label>{t('settings.wa.window_end')}</Label>
          <Input type="time" className="font-mono" value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)} disabled={!canEdit || save.isPending} />
        </div>
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-md bg-yellow-500/10 p-3 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700" />
        <div className="text-yellow-800 dark:text-yellow-300">{t('settings.wa.warn')}</div>
      </div>

      {canEdit && (
        <SectionFooter dirty={dirty} savedAt={savedAt} isPending={save.isPending}
          isError={save.isError} errorMsg={save.error?.message}
          onSave={() => save.mutate()}
          onReset={() => {
            setRate(pharmacy.rate_limit_per_hour);
            setWindowStart(pharmacy.send_window_start.slice(0, 5));
            setWindowEnd(pharmacy.send_window_end.slice(0, 5));
            setBulk(pharmacy.bulk_approval_threshold);
          }}
        />
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
function AccountSection() {
  const t = useT();
  const { user, signOut } = useAuth();
  const { activeRole, memberships } = usePharmacy();
  const navigate = useNavigate();

  const onSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const fullName = (user?.user_metadata?.['full_name'] as string | undefined) ?? user?.email?.split('@')[0] ?? '';

  return (
    <Card className="p-6">
      <SectionHeader title={t('settings.account.heading')} description={t('settings.account.desc')} canEdit={false} />

      <div className="mt-5 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
          {initials(fullName || 'U')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{fullName}</div>
          <div className="truncate text-sm text-muted-foreground">{user?.email}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            {t('settings.account.role')}: <span className="font-semibold text-foreground">{activeRole}</span>
            {memberships.length > 1 && <> · {memberships.length} pharmacies</>}
          </div>
        </div>
        <Button variant="outline" onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          {t('nav.sign_out')}
        </Button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ABOUT — app info, version, support links
// ─────────────────────────────────────────────────────────────────────────────
function AboutSection() {
  const t = useT();

  return (
    <Card className="p-6">
      <SectionHeader
        title={t('settings.about.heading')}
        description={t('settings.about.desc')}
        canEdit={false}
      />

      {/* Brand banner — name, version, one-line description */}
      <div className="mt-5 flex items-center gap-4 rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/15 ring-1 ring-primary/30">
          <img
            src={medstocksyLogo}
            alt="Medstocksy"
            draggable={false}
            className="h-full w-full object-contain p-1.5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold tracking-tight">Medstocksy Connect</h3>
            <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary">
              v{__APP_VERSION__}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.about.tagline')}</p>
        </div>
      </div>

      {/* Single support action */}
      <a
        href="mailto:support@medstocksy.in"
        className="mt-4 inline-flex items-center gap-2 rounded-lg border bg-card/40 px-3 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-card"
      >
        <Mail className="h-4 w-4 text-primary" />
        {t('settings.about.support')}
      </a>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DANGER ZONE
// ─────────────────────────────────────────────────────────────────────────────
function DangerZone({ pharmacy }: { pharmacy: Pharmacy }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('crm_pharmacies').delete().eq('id', pharmacy.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['memberships'] });
      navigate('/onboarding', { replace: true });
    },
  });

  const matches = typed.trim() === pharmacy.name.trim();

  return (
    <Card className="border-destructive/40 bg-destructive/5 p-6">
      <h2 className="text-base font-semibold text-destructive">{t('settings.danger.heading')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.danger.desc')}</p>

      <AnimatePresence mode="wait">
        {!confirming ? (
          <motion.div key="trigger" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4">
            <Button variant="destructive" onClick={() => setConfirming(true)}>
              <Trash2 className="h-4 w-4" />
              {t('settings.danger.delete')}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="confirm" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 space-y-3">
            <p className="text-sm">
              {t('settings.danger.confirm_prefix')}{' '}
              <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">{pharmacy.name}</code>
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={pharmacy.name} autoFocus />
            {del.isError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {del.error?.message ?? 'Delete failed'}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => del.mutate()} disabled={!matches || del.isPending}>
                {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('settings.danger.delete_now')}
              </Button>
              <Button variant="ghost" onClick={() => { setConfirming(false); setTyped(''); }} disabled={del.isPending}>
                {t('btn.cancel')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGO UPLOADER (Pharmacy → General)
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

function LogoUploader({ pharmacy, canEdit }: SectionProps) {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = async (logoUrl: string | null) => {
    const { error: dbErr } = await supabase
      .from('crm_pharmacies')
      .update({ logo_url: logoUrl } as never)
      .eq('id', pharmacy.id);
    if (dbErr) throw new Error(dbErr.message);
    await qc.invalidateQueries({ queryKey: ['pharmacy', pharmacy.id] });
    await qc.invalidateQueries({ queryKey: ['memberships'] });
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setError(t('settings.logo.invalid_type'));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(t('settings.logo.too_large'));
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
      const path = `${pharmacy.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('crm-pharmacy-logos')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('crm-pharmacy-logos').getPublicUrl(path);
      await persist(pub.publicUrl);
    } catch (err) {
      console.error('[pharmacy logo upload]', err);
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setError(null);
    setUploading(true);
    try {
      await persist(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setUploading(false);
    }
  };

  const showFallback = !pharmacy.logo_url;
  const previewSrc = pharmacy.logo_url ?? medstocksyLogo;

  return (
    <div className="mt-5 flex items-center gap-4 rounded-xl border bg-muted/30 p-4">
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
        <img
          src={previewSrc}
          alt={pharmacy.name}
          draggable={false}
          className="h-full w-full object-contain p-1.5"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{t('settings.logo.heading')}</div>
        <div className="text-xs text-muted-foreground">
          {showFallback ? t('settings.logo.using_default') : t('settings.logo.using_custom')}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={!canEdit || uploading}
          >
            {uploading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ImagePlus className="h-3.5 w-3.5" />}
            {pharmacy.logo_url ? t('settings.logo.replace') : t('settings.logo.upload')}
          </Button>
          {pharmacy.logo_url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={!canEdit || uploading}
              className="text-destructive hover:text-destructive"
            >
              <XIcon className="h-3.5 w-3.5" />
              {t('settings.logo.remove')}
            </Button>
          )}
        </div>
        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('settings.logo.hint')}
        </p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={LOGO_TYPES.join(',')}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium">{children}</label>;
}

function PhoneInput({
  value, onChange, onBlur, disabled, error,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  error: string | null;
}) {
  return (
    <>
      <div className="flex">
        <span className="flex select-none items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-mono text-muted-foreground">
          +91
        </span>
        <Input type="tel" inputMode="numeric" className="rounded-l-none font-mono"
          value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
          disabled={disabled} maxLength={15} placeholder="98765 43210" />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}

function SectionHeader({ title, description, canEdit }: { title: string; description: string; canEdit: boolean }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {!canEdit && (
        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('common.admin_only')}
        </span>
      )}
    </div>
  );
}

function SectionFooter({
  dirty, savedAt, isPending, isError, errorMsg, onSave, onReset,
}: {
  dirty: boolean; savedAt: number | null;
  isPending: boolean; isError: boolean; errorMsg: string | undefined;
  onSave: () => void; onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-6 flex items-center justify-between border-t pt-4">
      <div className="text-xs">
        <AnimatePresence>
          {savedAt && (
            <motion.span key="saved" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('common.saved')}
            </motion.span>
          )}
          {isError && (
            <motion.span key="err" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="text-destructive">
              {errorMsg ?? 'Save failed'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onReset} disabled={!dirty || isPending}>{t('btn.reset')}</Button>
        <Button onClick={onSave} disabled={!dirty || isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? t('btn.saving') : t('btn.save')}
        </Button>
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <Card className="p-6">
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-3 w-64 animate-pulse rounded bg-muted/60" />
        <div className="grid grid-cols-2 gap-4 pt-3">
          <div className="h-10 animate-pulse rounded bg-muted/40" />
          <div className="h-10 animate-pulse rounded bg-muted/40" />
        </div>
      </div>
    </Card>
  );
}
