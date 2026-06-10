import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Layers, Megaphone, BellRing, FileText, Activity,
  Settings, ArrowLeftRight, LogOut, ChevronsLeft, ChevronsRight,
  ChevronDown, ShieldCheck, ClipboardList, X as XIcon,
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

/** CRM group — primary pharmacy workflows */
const crmLinks: NavLinkSpec[] = [
  { to: '/',           labelKey: 'nav.dashboard',   icon: LayoutDashboard, end: true },
  { to: '/rx',         labelKey: 'nav.rx_workflow',  icon: ClipboardList },
  { to: '/customers',  labelKey: 'nav.customers',    icon: Users },
  { to: '/segments',   labelKey: 'nav.segments',     icon: Layers },
];

/** Comms group — messaging + automation */
const commsLinks: NavLinkSpec[] = [
  { to: '/campaigns',  labelKey: 'nav.campaigns',    icon: Megaphone },
  { to: '/reminders',  labelKey: 'nav.reminders',    icon: BellRing },
  { to: '/templates',  labelKey: 'nav.templates',    icon: FileText },
];

/** Misc — activity log */
const miscLinks: NavLinkSpec[] = [
  { to: '/activity',   labelKey: 'nav.activity',     icon: Activity },
];

const inventoryUrl = import.meta.env.VITE_INVENTORY_APP_URL ?? 'https://app.medstocksy.in';

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ collapsed, onToggleCollapsed, mobileOpen, onMobileClose }: AppSidebarProps) {
  const t = useT();
  const { user, signOut } = useAuth();
  const { memberships, activePharmacyId, setActivePharmacy } = usePharmacy();
  const active = memberships.find((m) => m.pharmacyId === activePharmacyId);

  const widthClass = collapsed ? 'md:w-[60px]' : 'md:w-[232px]';

  return (
    <aside
      data-sidebar
      data-collapsed={collapsed}
      className={cn(
        // Dark always — sidebar-bg token applies via [data-sidebar] in CSS
        'fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col',
        'transition-[width,transform] duration-200 ease-out',
        widthClass,
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
      style={{ background: 'hsl(var(--sidebar-bg))' }}
    >
      {/* ─── HEADER — pharmacy identity ─── */}
      <div
        className={cn(
          'shrink-0 border-b',
          collapsed ? 'md:p-2 p-3' : 'p-3'
        )}
        style={{ borderColor: 'hsl(var(--sidebar-border))', background: 'hsl(var(--sidebar-header-bg))' }}
      >
        <div className={cn('flex items-center gap-2.5', collapsed && 'md:justify-center md:gap-0')}>
          {/* Logo tile */}
          <div
            className={cn(
              'relative shrink-0 flex items-center justify-center rounded-xl',
              'ring-1',
              collapsed ? 'h-9 w-9' : 'h-10 w-10'
            )}
            style={{
              background: 'hsl(226 71% 55% / 0.15)',
              boxShadow: 'inset 0 0 0 1px hsl(226 71% 55% / 0.3)',
            }}
            title={active ? `${active.pharmacyName} · ${active.role}` : undefined}
          >
            <img
              src={active?.logoUrl || medstocksyLogo}
              alt={active?.pharmacyName ?? 'Medstocksy'}
              draggable={false}
              className="h-full w-full rounded-xl object-contain p-1"
            />
            {/* Brand watermark — locked, not exposed in Settings */}
            <img
              src={medstocksyLogo}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 select-none object-contain drop-shadow-sm"
            />
          </div>

          {/* Pharmacy name + role badge — hidden on desktop when collapsed */}
          <div className={cn('min-w-0 flex-1', collapsed && 'md:hidden')}>
            {memberships.length > 1 ? (
              <div className="relative -ml-1 flex items-center">
                <select
                  value={activePharmacyId ?? ''}
                  onChange={(e) => setActivePharmacy(e.target.value)}
                  aria-label={t('nav.active_pharmacy')}
                  className="w-full cursor-pointer truncate rounded bg-transparent pl-1 pr-5 text-[14px] font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  style={{ color: 'hsl(var(--sidebar-fg-active))' }}
                >
                  {memberships.map((m) => (
                    <option key={m.pharmacyId} value={m.pharmacyId} style={{ color: '#111' }}>
                      {m.pharmacyName}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 opacity-50" style={{ color: 'hsl(var(--sidebar-fg))' }} />
              </div>
            ) : (
              <div className="truncate text-[14px] font-bold tracking-tight" style={{ color: 'hsl(var(--sidebar-fg-active))' }}>
                {active?.pharmacyName ?? 'Medstocksy'}
              </div>
            )}
            <div className="mt-1">
              {active
                ? <RoleBadge role={active.role} />
                : <span className="text-[10px] font-semibold uppercase tracking-widest opacity-50" style={{ color: 'hsl(var(--sidebar-fg))' }}>{t('app.tagline')}</span>
              }
            </div>
          </div>

          {/* Desktop collapse toggle — hidden on mobile + when collapsed */}
          <button
            onClick={onToggleCollapsed}
            aria-label={t('nav.collapse')}
            title={t('nav.collapse')}
            className={cn(
              'ml-auto hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors md:flex',
              collapsed && 'md:hidden'
            )}
            style={{ color: 'hsl(var(--sidebar-fg) / 0.6)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(var(--sidebar-hover-bg))')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>

          {/* Mobile close button */}
          <button
            onClick={onMobileClose}
            aria-label={t('nav.collapse')}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors md:hidden"
            style={{ color: 'hsl(var(--sidebar-fg) / 0.6)' }}
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Collapsed expand toggle */}
      {collapsed && (
        <button
          onClick={onToggleCollapsed}
          aria-label={t('nav.expand')}
          title={t('nav.expand')}
          className="hidden h-9 w-full shrink-0 items-center justify-center border-b transition-colors md:flex"
          style={{ borderColor: 'hsl(var(--sidebar-border))', color: 'hsl(var(--sidebar-fg) / 0.5)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'hsl(var(--sidebar-hover-bg))')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      {/* ─── PRIMARY NAV ─── */}
      <nav
        className={cn('flex-1 overflow-y-auto py-2', collapsed ? 'md:px-1.5' : 'px-2')}
        aria-label="Primary"
      >
        {/* CRM Group */}
        {!collapsed && <p className="nav-group-label">CRM</p>}
        <ul className="space-y-0.5">
          {crmLinks.map((link) => <NavItem key={link.to} link={link} collapsed={collapsed} onMobileClose={onMobileClose} t={t} />)}
        </ul>

        {/* Comms Group */}
        {!collapsed && <p className="nav-group-label mt-3">Comms</p>}
        {collapsed && <div className="my-3 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }} />}
        <ul className="space-y-0.5">
          {commsLinks.map((link) => <NavItem key={link.to} link={link} collapsed={collapsed} onMobileClose={onMobileClose} t={t} />)}
        </ul>

        {/* Misc group */}
        {!collapsed && <p className="nav-group-label mt-3">More</p>}
        {collapsed && <div className="my-3 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }} />}
        <ul className="space-y-0.5">
          {miscLinks.map((link) => <NavItem key={link.to} link={link} collapsed={collapsed} onMobileClose={onMobileClose} t={t} />)}
        </ul>

        {/* Divider before secondary links */}
        <div className="my-3 border-t" style={{ borderColor: 'hsl(var(--sidebar-border))' }} />

        {/* Secondary nav */}
        <ul className="space-y-0.5">
          {/* Inventory app link */}
          <li>
            <a
              href={inventoryUrl}
              title={collapsed ? t('nav.inventory_app') : undefined}
              className={cn(
                'sidebar-nav-item group',
                collapsed ? 'md:justify-center md:px-0' : ''
              )}
            >
              <ArrowLeftRight className="h-4 w-4 shrink-0 opacity-80" />
              <span className={cn('truncate', collapsed && 'md:hidden')}>{t('nav.inventory_app')}</span>
            </a>
          </li>
          {/* Settings */}
          <li>
            <NavLink
              to="/settings"
              onClick={onMobileClose}
              title={collapsed ? t('nav.settings') : undefined}
              className={({ isActive }) =>
                cn(
                  'sidebar-nav-item',
                  collapsed ? 'md:justify-center md:px-0' : '',
                  isActive ? 'active' : ''
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0 opacity-80" />
              <span className={cn('truncate', collapsed && 'md:hidden')}>{t('nav.settings')}</span>
            </NavLink>
          </li>
        </ul>
      </nav>

      {/* ─── USER FOOTER ─── */}
      <div
        className={cn('shrink-0 border-t', collapsed ? 'md:p-2' : 'p-2.5')}
        style={{ borderColor: 'hsl(var(--sidebar-border))' }}
      >
        {/* Expanded — mobile always + desktop-expanded */}
        <div className={cn('flex items-center gap-2.5 rounded-lg p-2 transition-colors', collapsed && 'md:hidden')}
          style={{ background: 'hsl(var(--sidebar-hover-bg))' }}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{ background: 'hsl(226 71% 55% / 0.25)', color: 'hsl(226 71% 72%)' }}
          >
            {initials(user?.user_metadata?.['full_name'] ?? user?.email ?? 'U')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: 'hsl(var(--sidebar-fg-active))' }}>
              {user?.user_metadata?.['full_name'] ?? user?.email?.split('@')[0]}
            </div>
            <div className="truncate text-[11px]" style={{ color: 'hsl(var(--sidebar-fg) / 0.65)' }}>{user?.email}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut()}
            aria-label={t('nav.sign_out')}
            className="h-8 w-8 shrink-0 hover:bg-white/10"
            title={t('nav.sign_out')}
            style={{ color: 'hsl(var(--sidebar-fg) / 0.7)' }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        {/* Collapsed stack — desktop-collapsed only */}
        <div className={cn('hidden flex-col items-center gap-1.5', collapsed ? 'md:flex' : 'md:hidden')}>
          <div
            title={user?.email ?? ''}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
            style={{ background: 'hsl(226 71% 55% / 0.25)', color: 'hsl(226 71% 72%)' }}
          >
            {initials(user?.user_metadata?.['full_name'] ?? user?.email ?? 'U')}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut()}
            aria-label={t('nav.sign_out')}
            className="h-8 w-8 hover:bg-white/10"
            title={t('nav.sign_out')}
            style={{ color: 'hsl(var(--sidebar-fg) / 0.7)' }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

/* ── Reusable nav item ─────────────────────────────────────────────────────── */
function NavItem({
  link, collapsed, onMobileClose, t,
}: {
  link: NavLinkSpec;
  collapsed: boolean;
  onMobileClose: () => void;
  t: (k: Parameters<typeof useT extends () => infer R ? R : never>[0]) => string;
}) {
  const Icon = link.icon;
  const label = t(link.labelKey);
  return (
    <li>
      <NavLink
        to={link.to}
        end={link.end}
        onClick={onMobileClose}
        title={collapsed ? label : undefined}
        aria-current={undefined} /* set by NavLink isActive */
        className={({ isActive }) =>
          cn(
            'sidebar-nav-item',
            collapsed ? 'md:justify-center md:gap-0 md:px-0' : '',
            isActive ? 'active' : ''
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon
              className={cn('h-4 w-4 shrink-0', isActive ? 'opacity-100' : 'opacity-75')}
              strokeWidth={isActive ? 2.5 : 2}
            />
            <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

/** Colored role pill: admin = indigo, manager = amber, staff = neutral. */
function RoleBadge({ role }: { role: string }) {
  const styles =
    role === 'admin'
      ? { background: 'hsl(226 71% 55% / 0.25)', color: 'hsl(226 71% 72%)', border: '1px solid hsl(226 71% 55% / 0.3)' }
      : role === 'manager'
        ? { background: 'hsl(38 95% 48% / 0.2)', color: 'hsl(38 95% 65%)', border: '1px solid hsl(38 95% 48% / 0.3)' }
        : { background: 'hsl(215 25% 65% / 0.15)', color: 'hsl(215 25% 65%)', border: '1px solid hsl(215 25% 65% / 0.2)' };

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider"
      style={styles}
    >
      {role === 'admin' && <ShieldCheck className="h-2.5 w-2.5" />}
      {role}
    </span>
  );
}
