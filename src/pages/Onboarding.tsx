import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { validateIndianPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface CreatedPharmacy { id: string; name: string }

const PG_UNIQUE_VIOLATION = '23505';

/**
 * First-run setup — create the pharmacy this user owns.
 * Each email can own exactly one pharmacy (DB UNIQUE on owner_id).
 */
export default function Onboarding() {
  const t = useT();
  const { user } = useAuth();
  const { setActivePharmacy } = usePharmacy();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);

  const create = useMutation<CreatedPharmacy, Error>({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated. Please sign in again.');

      // Validate phone numbers if entered.
      let phoneE164: string | undefined;
      if (phone.trim()) {
        const v = validateIndianPhone(phone);
        if (!v.ok) throw new Error(`Contact phone: ${v.error}`);
        phoneE164 = v.e164;
      }

      let waE164: string | undefined;
      if (whatsappNumber.trim()) {
        const v = validateIndianPhone(whatsappNumber);
        if (!v.ok) throw new Error(`WhatsApp number: ${v.error}`);
        waE164 = v.e164;
      }

      const payload: Record<string, unknown> = { name: name.trim(), owner_id: user.id };
      if (phoneE164) payload['phone'] = phoneE164;
      if (waE164) payload['whatsapp_number'] = waE164;

      const { data, error } = await supabase
        .from('crm_pharmacies')
        .insert(payload as never)
        .select('id, name')
        .single();

      if (error) {
        console.error('[onboarding] insert failed', { error, payload });

        // Friendly translations for the most likely Postgres errors.
        if (error.code === PG_UNIQUE_VIOLATION) {
          throw new Error(
            'You already have a pharmacy on this account. Each email can manage one. Refresh the page to continue.'
          );
        }
        if (error.code === '42501') {
          throw new Error(
            'Permission denied — your session may be stale. Try signing out and back in.'
          );
        }

        const detail = [error.message, error.details, error.hint, error.code].filter(Boolean).join(' · ');
        throw new Error(detail || 'Could not create pharmacy.');
      }
      return data as unknown as CreatedPharmacy;
    },
    onSuccess: async (pharmacy) => {
      qc.setQueryData(['memberships', user?.id], [
        { pharmacyId: pharmacy.id, pharmacyName: pharmacy.name, role: 'admin' as const },
      ]);
      await qc.invalidateQueries({ queryKey: ['memberships'] });
      setActivePharmacy(pharmacy.id);
      // Tiny delay so the success state is visible before nav.
      await new Promise((r) => setTimeout(r, 350));
      navigate('/', { replace: true });
    },
  });

  const validateOnBlur = (
    value: string,
    setError: (msg: string | null) => void
  ) => {
    if (!value.trim()) { setError(null); return; }
    const v = validateIndianPhone(value);
    setError(v.ok ? null : v.error);
  };

  const canSubmit =
    !!name.trim() &&
    !phoneError &&
    !waError &&
    !create.isPending &&
    !create.isSuccess;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-muted/20 to-primary/5 p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg"
      >
        <Card className="overflow-hidden border-2 p-8">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {t('onb.first_time')}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('onb.title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('onb.subtitle')}
              <br />
              <span className="text-xs">
                {t('common.signed_in_as')} <span className="font-medium text-foreground">{user?.email}</span>
              </span>
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSubmit) return;
              create.mutate();
            }}
            className="space-y-4"
          >
            {/* Pharmacy name */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('onb.pharmacy_name')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. MedPlus, Sec 14 Lucknow"
                required
                autoFocus
                maxLength={120}
              />
            </div>

            {/* Contact phone */}
            <div>
              <label className="mb-1 block text-sm font-medium">{t('onb.contact_phone')}</label>
              <div className="flex">
                <span className="flex select-none items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-mono text-muted-foreground">
                  +91
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  className="rounded-l-none font-mono"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError(null);
                  }}
                  onBlur={() => validateOnBlur(phone, setPhoneError)}
                  placeholder="98765 43210"
                  maxLength={15}
                />
              </div>
              {phoneError && <p className="mt-1 text-xs text-destructive">{phoneError}</p>}
            </div>

            {/* WhatsApp number */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('onb.whatsapp_number')}{' '}
                <span className="text-xs font-normal text-muted-foreground">({t('common.optional')})</span>
              </label>
              <div className="flex">
                <span className="flex select-none items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-mono text-muted-foreground">
                  +91
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  className="rounded-l-none font-mono"
                  value={whatsappNumber}
                  onChange={(e) => {
                    setWhatsappNumber(e.target.value);
                    if (waError) setWaError(null);
                  }}
                  onBlur={() => validateOnBlur(whatsappNumber, setWaError)}
                  placeholder="Same as contact unless different"
                  maxLength={15}
                />
              </div>
              {waError ? (
                <p className="mt-1 text-xs text-destructive">{waError}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t('onb.whatsapp_hint')}</p>
              )}
            </div>

            {create.isError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-md bg-destructive/10 px-4 py-3 text-sm"
              >
                <div className="font-medium text-destructive">{t('onb.error_title')}</div>
                <div className="mt-1 text-xs text-destructive/90">
                  {String(create.error?.message ?? t('common.unknown'))}
                </div>
              </motion.div>
            )}

            {create.isSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t('onb.success')}
              </motion.div>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={!canSubmit}
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {create.isPending ? t('btn.creating') : create.isSuccess ? t('onb.created') : t('onb.create')}
            </Button>

            <p className="pt-2 text-center text-xs text-muted-foreground">{t('onb.footer')}</p>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
