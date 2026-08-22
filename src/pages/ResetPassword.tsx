import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import medstocksyLogo from '@/assets/brand/medstocksy.png';

export default function ResetPassword() {
  const t = useT();
  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // 1. Check if URL hash or search params have error parameters
      const hash = window.location.hash;
      const search = window.location.search;
      const params = new URLSearchParams(search);
      const code = params.get('code');

      if (hash.includes('error=') || hash.includes('error_code=') || search.includes('error=')) {
        await supabase.auth.signOut().catch(() => {});
        if (mounted) {
          setHasValidSession(false);
          setCheckingSession(false);
        }
        return;
      }

      // 2. If PKCE auth code is present in URL, exchange it
      if (code) {
        const { data, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr || !data.session) {
          await supabase.auth.signOut().catch(() => {});
          if (mounted) {
            setHasValidSession(false);
            setCheckingSession(false);
          }
          return;
        }
      }

      // 3. Check existing session
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        if (mounted) {
          setHasValidSession(true);
          setCheckingSession(false);
        }
        return;
      }

      // 4. Check user directly
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (!userErr && userData?.user) {
        if (mounted) {
          setHasValidSession(true);
          setCheckingSession(false);
        }
        return;
      }

      // If hash contains recovery parameters, allow onAuthStateChange to finish parsing
      if (hash.includes('access_token') || hash.includes('type=recovery') || code) {
        return;
      }

      if (mounted) {
        setHasValidSession(false);
        setCheckingSession(false);
      }
    }

    init();

    // Safety timeout: if session is still indeterminate after 4s, stop loading
    const safetyTimer = setTimeout(() => {
      if (!mounted) return;
      supabase.auth.getUser().then(({ data, error }) => {
        if (!mounted) return;
        setHasValidSession(!error && !!data?.user);
        setCheckingSession(false);
      });
    }, 4000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN') || (session && event === 'USER_UPDATED')) {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (!userErr && userData?.user) {
          setHasValidSession(true);
        } else {
          setHasValidSession(false);
        }
        setCheckingSession(false);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t('login.password_min'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('reset.error_mismatch'));
      return;
    }

    setPending(true);
    const { error: err } = await updatePassword(password);
    setPending(false);

    if (err) {
      // ponytail: Stale token or deleted user -> clear local storage and show expired link screen
      if (/sub claim|not exist|invalid jwt|jwt expired|user not found/i.test(err)) {
        await supabase.auth.signOut().catch(() => {});
        setHasValidSession(false);
        return;
      }
      setError(err);
      return;
    }

    setSuccess(true);
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <div
        className="relative hidden flex-col justify-between p-12 lg:flex"
        style={{ background: 'hsl(var(--sidebar-bg))' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl"
            style={{ background: 'hsl(226 71% 55% / 0.15)', boxShadow: 'inset 0 0 0 1px hsl(226 71% 55% / 0.3)' }}
          >
            <img
              src={medstocksyLogo}
              alt="Medstocksy Connect"
              draggable={false}
              className="h-full w-full object-contain p-1"
            />
          </div>
          <span className="text-[15px] font-bold" style={{ color: 'hsl(var(--sidebar-fg-active))' }}>
            Medstocksy Connect
          </span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-5"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'hsl(152 69% 45%)' }}>
            {t('login.eyebrow')}
          </p>
          <h1 className="text-[3.25rem] font-bold leading-[1.08] tracking-tight" style={{ color: 'hsl(var(--sidebar-fg-active))' }}>
            Secure
            <br />
            <span style={{ color: 'hsl(226 71% 65%)' }}>Account Access.</span>
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed" style={{ color: 'hsl(var(--sidebar-fg))' }}>
            {t('login.tagline')}
          </p>
        </motion.div>

        <div className="text-xs text-muted-foreground/60">
          © {new Date().getFullYear()} Medstocksy. All rights reserved.
        </div>
      </div>

      {/* Main Form Content */}
      <div className="flex flex-col items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <AnimatePresence mode="wait">
            {checkingSession ? (
              <motion.div
                key="loader"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center gap-3 py-12"
              >
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
              </motion.div>
            ) : !hasValidSession ? (
              /* Invalid or expired recovery token */
              <motion.div
                key="invalid"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="space-y-6 text-center"
              >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">{t('reset.invalid_link_title')}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('reset.invalid_link_desc')}
                </p>
              </div>
              <Button
                size="lg"
                className="w-full h-11 font-semibold"
                onClick={() => navigate('/login', { state: { initialMode: 'forgot' } })}
              >
                {t('reset.request_new_link')}
              </Button>
              <div>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('login.back_to_login')}
                </Link>
              </div>
            </motion.div>
          ) : success ? (
            /* Success confirmation */
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6 text-center"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">{t('reset.success_title')}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('reset.success_desc')}
                </p>
              </div>
              <Button
                size="lg"
                className="w-full h-11 font-semibold"
                onClick={() => navigate('/', { replace: true })}
              >
                {t('reset.go_to_login')}
              </Button>
            </motion.div>
          ) : (
            /* Reset password form */
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="space-y-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                  <KeyRound className="h-5 w-5" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight">{t('reset.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('reset.subtitle')}</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    {t('reset.new_password')}
                  </label>
                  <Input
                    type="password"
                    placeholder="min. 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                    className="h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    {t('reset.confirm_password')}
                  </label>
                  <Input
                    type="password"
                    placeholder="repeat new password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={pending}
                    className="h-11"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
                    <span className="mt-0.5 shrink-0">⚠</span>
                    {error}
                  </div>
                )}

                <Button type="submit" size="lg" className="w-full h-11 text-sm font-semibold" disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {pending ? t('reset.updating') : t('reset.submit')}
                </Button>
              </form>

              <div className="text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('login.back_to_login')}
                </Link>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
