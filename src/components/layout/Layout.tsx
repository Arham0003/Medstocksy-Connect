import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Menu, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { RemindersBell } from './RemindersBell';
import { TodayRemindersPopup } from './TodayRemindersPopup';
import { Button } from '@/components/ui/button';
import { cn, storage } from '@/lib/utils';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import medstocksyLogo from '@/assets/brand/medstocksy.png';

const COLLAPSED_KEY = 'medcrm.sidebar.collapsed';

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    storage.get<boolean>(COLLAPSED_KEY, false)
  );
  const { pharmacyName, logoUrl } = useActivePharmacy();
  const navigate = useNavigate();

  useEffect(() => {
    storage.set(COLLAPSED_KEY, collapsed);
  }, [collapsed]);

  const toggleCollapsed = () => setCollapsed((v) => !v);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
        />
      )}

      {/* ── Mobile top bar ────────────────────────────────────────────────
          Hamburger | Logo + Pharmacy name | [Quick Rx button] | Reminders Bell
          Quick Rx = most-used action always 1-tap accessible (Fitts's Law)
      ── */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b bg-card px-3 md:hidden"
        style={{ boxShadow: '0 1px 3px hsl(220 30% 12% / 0.06)' }}
      >
        {/* Hamburger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Open menu"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Logo + name */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg"
            style={{ background: 'hsl(226 71% 55% / 0.12)', boxShadow: 'inset 0 0 0 1px hsl(226 71% 55% / 0.25)' }}
          >
            <img
              src={logoUrl || medstocksyLogo}
              alt={pharmacyName || 'Medstocksy'}
              draggable={false}
              className="h-full w-full object-contain p-0.5"
            />
          </div>
          <span className="truncate text-sm font-semibold">{pharmacyName || 'Medstocksy'}</span>
        </div>

        {/* Quick Rx — most important action, always 1 tap on mobile */}
        <Button
          size="sm"
          onClick={() => navigate('/rx')}
          className="h-8 shrink-0 gap-1.5 text-xs font-semibold"
          aria-label="Quick Rx"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          Quick Rx
        </Button>

        {/* Reminders bell — surfaced to mobile top bar */}
        <RemindersBell />
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main
        className={cn(
          'transition-[padding] duration-200 ease-out',
          collapsed ? 'md:pl-[60px]' : 'md:pl-[232px]'
        )}
      >
        <div className="mx-auto max-w-[1440px] animate-fade-in p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      {/* Reminders bell — desktop fixed top-right; rate-limit + opt-out aware */}
      <div className="hidden md:block">
        <RemindersBell />
      </div>

      {/* Today's reminders popup — auto-opens once/day when work is due */}
      <TodayRemindersPopup />
    </div>
  );
}
