import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PharmacyProvider, usePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { Layout } from '@/components/layout/Layout';
import { Skeleton } from '@/components/ui/skeleton';

import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import AuthCallback from '@/pages/AuthCallback';
const Customers = lazy(() => import('@/pages/Customers'));
const CustomerProfile = lazy(() => import('@/pages/CustomerProfile'));
const Segments = lazy(() => import('@/pages/Segments'));
const Campaigns = lazy(() => import('@/pages/Campaigns'));
const Reminders = lazy(() => import('@/pages/Reminders'));
const Templates = lazy(() => import('@/pages/Templates'));
const Activity = lazy(() => import('@/pages/Activity'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));
const PrescriptionWorkflow = lazy(() => import('@/pages/PrescriptionWorkflow'));

function PageLoader() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-3 gap-4 pt-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

function FullScreenLoader({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">{label ?? t('common.loading')}</div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function PharmacyLoadError({ error }: { error: Error }) {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <h1 className="text-base font-semibold text-destructive">{t('error.no_pharmacy.title')}</h1>
        <p className="text-muted-foreground">{t('error.no_pharmacy.desc')}</p>
        <pre className="overflow-x-auto rounded bg-background p-3 font-mono text-xs">
          {error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('btn.reload')}
        </button>
      </div>
    </div>
  );
}

function RequirePharmacy({ children }: { children: React.ReactNode }) {
  const { loading, error, activePharmacyId, activeRole, needsPharmacy } = usePharmacy();
  if (loading) return <FullScreenLoader label="Loading your pharmacy…" />;
  if (error) return <PharmacyLoadError error={error} />;
  if (needsPharmacy) return <Navigate to="/onboarding" replace />;
  // Both id AND role must resolve before children render — otherwise
  // useActivePharmacy() throws. activeRole = null while the reconcile-effect
  // is still running (e.g. when stored activePharmacyId points to a deleted row).
  if (!activePharmacyId || !activeRole) return <FullScreenLoader label="Loading…" />;
  return <>{children}</>;
}

/**
 * Inverse of RequirePharmacy: keep users OUT of /onboarding once they
 * already have a pharmacy. Bouncing them to dashboard prevents accidental
 * second-pharmacy attempts and weird empty-form re-entries.
 */
function RedirectIfPharmacy({ children }: { children: React.ReactNode }) {
  const { loading, error, memberships } = usePharmacy();
  if (loading) return <FullScreenLoader label="Loading…" />;
  if (error) return <PharmacyLoadError error={error} />;
  if (memberships.length > 0) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppShell() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <RedirectIfPharmacy>
                <Onboarding />
              </RedirectIfPharmacy>
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <RequirePharmacy>
                <Layout />
              </RequirePharmacy>
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerProfile />} />
          <Route path="segments" element={<Segments />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="templates" element={<Templates />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
          <Route path="rx" element={<PrescriptionWorkflow />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PharmacyProvider>
        <AppShell />
      </PharmacyProvider>
    </AuthProvider>
  );
}
