import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Layers, Megaphone, BellRing, FileText, Activity,
  Settings, ArrowLeftRight, LogOut, ChevronsLeft, ChevronsRight,
  ChevronDown, ShieldCheck, ClipboardList,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { usePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { Button } from '@/components/ui/button';
import medstocksyLogo from '@/assets/brand/medstocksy.png';

interface NavLinkSpec {
  to: string;
  labelKey: TranslationKey;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const links: NavLinkSpec[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/rx', labelKey: 'nav.rx_workflow', icon: ClipboardList },
  { to: '/customers', labelKey: 'nav.customers', icon: Users },
  { to: '/segments', labelKey: 'nav.segments', icon: Layers },
  { to: '/campaigns', labelKey: 'nav.campaigns', icon: Megaphone },
  { to: '/reminders', labelKey: 'nav.reminders', icon: BellRing },
  { to: '/templates', labelKey: 'nav.templates', icon: FileText },
  { to: '/activity', labelKey: 'nav.activity', icon: Activity },
];

const inventoryUrl = import.meta.env.VITE_INVENTORY_APP_URL ?? 'https://app.medstocksy.in';

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawer open state — controlled by Layout */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ collapsed, onToggleCollapsed, mobileOpen, onMobileClose }: AppSidebarProps) {
  const t = useT();
  const { user, signOut } = useAuth();
  const { memberships, activePharmacyId, setActivePharmacy } = usePharmacy();
  const active = memberships.find((m) => m.pharmacyId === activePharmacyId);

  // Mobile = full-width drawer (always expanded labels). Desktop = collapsible.
  const widthClass = collapsed ? 'md:w-16' : 'md:w-64';
  const showLabels = !collapsed; // desktop label visibility

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-gradient-to-b from-background to-muted/40',
        'transition-[width,transform] duration-200 ease-out',
        widthClass,
        // Mobile: drawer pattern (full 256px when open, hidden when closed)
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      {/* ─── COMBINED HEADER (pharmacy as primary identity) ─── */}
      <div className={cn(
        'border-b bg-gradient-to-br from-primary/5 via-transparent to-transparent',
        collapsed ? 'md:p-2' : 'p-3'
      )}>
        <div className={cn(
          'group flex items-center gap-3',
          collapsed && 'md:justify-center md:gap-0'
        )}>
          {/* Logo tile — custom pharmacy logo if uploaded, else Medstocksy default. */}
          <div
            className={cn(
              'relative flex shrink-0 items-center justify-center rounded-xl',
              'bg-gradient-to-br from-primary/15 to-primary/5 text-primary',
              'ring-1 ring-primary/20',
              collapsed ? 'h-9 w-9' : 'h-10 w-10'
            )}
            title={active ? `${active.pharmacyName} · ${active.role}` : undefined}
          >
            <img
              src={active?.logoUrl || medstocksyLogo}
              alt={active?.pharmacyName ?? 'Medstocksy'}
              draggable={false}
              className="h-full w-full rounded-xl object-contain p-1"
            />
            {/*
              Brand watermark — bundled at build time from src/assets/brand/medstocksy.png.
              This is hard-coded into the source and intentionally NOT exposed in any
              Settings UI, so end-users cannot change it. Customize the big tile via
              Settings → General → Pharmacy logo; this corner badge stays locked.
            */}
            <img
              src={medstocksyLogo}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 select-none object-contain drop-shadow-sm"
            />
          </div>

          {showLabels && (
            <div className="min-w-0 flex-1">
              {/* Pharmacy name — switcher when user has >1, plain text otherwise */}
              {memberships.length > 1 ? (
                <div className="relative -ml-1 flex items-center">
                  <select
                    value={activePharmacyId ?? ''}
                    onChange={(e) => setActivePharmacy(e.target.value)}
                    aria-label={t('nav.active_pharmacy')}
                    className="w-full cursor-pointer truncate rounded bg-transparent pl-1 pr-5 text-[15px] font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {memberships.map((m) => (
                      <option key={m.pharmacyId} value={m.pharmacyId}>
                        {m.pharmacyName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground" />
                </div>
              ) : (
                <div className="truncate text-[15px] font-bold tracking-tight">
                  {active?.pharmacyName ?? 'Medstocksy'}
                </div>
              )}

              {/* Role pill replaces the old "Customer Relations" tagline */}
              <div className="mt-0.5">
                {active
                  ? <RoleBadge role={active.role} />
                  : (
                    <span className="truncate text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t('app.tagline')}
                    </span>
                  )
                }
              </div>
            </div>
          )}

          {showLabels && (
            <button
              onClick={onToggleCollapsed}
              aria-label={t('nav.collapse')}
              title={t('nav.collapse')}
              className="ml-auto hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* When collapsed, the expand toggle sits below the combined header */}
      {collapsed && (
        <button
          onClick={onToggleCollapsed}
          aria-label={t('nav.expand')}
          title={t('nav.expand')}
          className="hidden h-8 w-full items-center justify-center border-b text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      {/* ─── PRIMARY NAV ─── */}
      <nav
        className={cn('flex-1 overflow-y-auto', collapsed ? 'md:p-2' : 'p-2')}
        aria-label="Primary"
      >
        <ul className="space-y-1">
          {links.map((link) => {
            const Icon = link.icon;
            const label = t(link.labelKey);
            return (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  onClick={onMobileClose}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors',
                      collapsed ? 'md:h-10 md:w-12 md:justify-center md:gap-0 md:px-0 md:py-0' : 'px-3 py-2.5',
                      // mobile is always expanded
                      'px-3 py-2.5',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 h-6 w-1 rounded-r bg-primary" aria-hidden />
                      )}
                      <Icon className="h-4 w-4 shrink-0" />
                      {/* Label on mobile always; desktop only when expanded */}
                      <span className={cn(collapsed && 'md:hidden')}>{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>

        <div className="my-3 border-t" />

        <ul className="space-y-1">
          <li>
            <a
              href={inventoryUrl}
              title={collapsed ? t('nav.inventory_app') : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                collapsed ? 'md:h-10 md:w-12 md:justify-center md:gap-0 md:px-0' : 'px-3 py-2.5',
                'px-3 py-2.5'
              )}
            >
              <ArrowLeftRight className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed && 'md:hidden')}>{t('nav.inventory_app')}</span>
            </a>
          </li>
          <li>
            <NavLink
              to="/settings"
              onClick={onMobileClose}
              title={collapsed ? t('nav.settings') : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors',
                  collapsed ? 'md:h-10 md:w-12 md:justify-center md:gap-0 md:px-0' : 'px-3 py-2.5',
                  'px-3 py-2.5',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed && 'md:hidden')}>{t('nav.settings')}</span>
            </NavLink>
          </li>
        </ul>
      </nav>

      {/* ─── USER FOOTER ─── */}
      <div className={cn('border-t', collapsed ? 'md:p-2' : 'p-3')}>
        {showLabels ? (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials(user?.user_metadata?.['full_name'] ?? user?.email ?? 'U')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {user?.user_metadata?.['full_name'] ?? user?.email?.split('@')[0]}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut()}
              aria-label={t('nav.sign_out')}
              className="h-8 w-8"
              title={t('nav.sign_out')}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          // Collapsed: stacked avatar + sign-out
          <div className="hidden flex-col items-center gap-1 md:flex">
            <div
              title={user?.email ?? ''}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {initials(user?.user_metadata?.['full_name'] ?? user?.email ?? 'U')}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut()}
              aria-label={t('nav.sign_out')}
              className="h-8 w-8"
              title={t('nav.sign_out')}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Colored role pill: admin = primary, manager = amber, staff = neutral. */
function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'admin'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : role === 'manager'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : 'border-muted-foreground/20 bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider',
        tone
      )}
    >
      {role === 'admin' && <ShieldCheck className="h-2.5 w-2.5" />}
      {role}
    </span>
  );
}
