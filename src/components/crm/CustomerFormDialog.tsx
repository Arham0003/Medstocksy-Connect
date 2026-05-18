import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Users, ExternalLink } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import {
  createCustomer, updateCustomer, DuplicatePhoneError, type Customer,
} from '@/lib/api/customers';
import { validateIndianPhone, initials } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Mode = 'create' | 'edit';

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  customer?: Customer | null;
  onCreated?: (c: Customer) => void;
  onUpdated?: (c: Customer) => void;
}

type Gender = 'male' | 'female' | 'other';

export function CustomerFormDialog({
  open, onOpenChange, mode = 'create', customer, onCreated, onUpdated,
}: CustomerFormDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const { pharmacyId } = useActivePharmacy();
  const qc = useQueryClient();

  const isEdit = mode === 'edit' && !!customer;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [address, setAddress] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  /** When set, the form is in "phone collision" mode and shows the resolver UI. */
  const [collision, setCollision] = useState<Customer | null>(null);

  useEffect(() => {
    if (!open) return;
    if (isEdit && customer) {
      setName(customer.name);
      setPhone(customer.phone.startsWith('+91') ? customer.phone.slice(3) : customer.phone);
      setAge(customer.age != null ? String(customer.age) : '');
      setGender((customer.gender as Gender | null) ?? '');
      setAddress(customer.address ?? '');
    } else {
      setName(''); setPhone(''); setAge(''); setGender(''); setAddress('');
    }
    setPhoneError(null);
    setCollision(null);
  }, [open, isEdit, customer]);

  /** Shared form-to-insert helper. familyOfId set ⇒ skip the dedup check. */
  const buildPayload = (familyOfId: string | null = null) => {
    const v = validateIndianPhone(phone);
    if (!v.ok) throw new Error(v.error);
    const ageNum = age.trim() ? Number(age) : undefined;
    if (age.trim() && (Number.isNaN(ageNum) || ageNum! < 0 || ageNum! > 130)) {
      throw new Error('Age must be a number between 0 and 130.');
    }
    return {
      pharmacy_id: pharmacyId,
      name: name.trim(),
      phone: v.e164,
      family_of_id: familyOfId,
      ...(ageNum != null ? { age: ageNum } : {}),
      ...(gender ? { gender } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    };
  };

  const create = useMutation<Customer, Error>({
    mutationFn: () => createCustomer(buildPayload()),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-counts'] });
      onOpenChange(false);
      onCreated?.(c);
    },
    onError: (err) => {
      if (err instanceof DuplicatePhoneError) {
        setCollision(err.existing);
      }
    },
  });

  /** Re-insert with family_of_id set to the existing primary. */
  const addAsFamily = useMutation<Customer, Error>({
    mutationFn: () => {
      if (!collision) throw new Error('No primary customer to attach to.');
      return createCustomer(buildPayload(collision.id));
    },
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-counts'] });
      onOpenChange(false);
      onCreated?.(c);
    },
  });

  const update = useMutation<Customer, Error>({
    mutationFn: async () => {
      if (!customer) throw new Error('No customer to update.');
      const v = validateIndianPhone(phone);
      if (!v.ok) throw new Error(v.error);
      const ageNum = age.trim() ? Number(age) : undefined;
      if (age.trim() && (Number.isNaN(ageNum) || ageNum! < 0 || ageNum! > 130)) {
        throw new Error('Age must be a number between 0 and 130.');
      }
      return updateCustomer(customer.id, {
        name: name.trim(),
        phone: v.e164,
        age: ageNum,
        gender: gender || null,
        address: address.trim() || null,
      });
    },
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['customers'] });
      await qc.invalidateQueries({ queryKey: ['customer', customer?.id] });
      onOpenChange(false);
      onUpdated?.(c);
    },
  });

  const mut = isEdit ? update : create;
  const canSubmit = !!name.trim() && !!phone.trim() && !phoneError && !mut.isPending && !addAsFamily.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!mut.isPending && !addAsFamily.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('cust.edit_title') : t('btn.add_customer')}</DialogTitle>
          <DialogDescription>{isEdit ? t('cust.edit_desc') : t('cust.new_desc')}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit && !collision) mut.mutate(); }}
          className="space-y-3"
        >
          {/* Row 1: Name + Phone */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('cust.name')} <span className="text-destructive">*</span>
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={120} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('cust.phone')} <span className="text-destructive">*</span>
              </label>
              <div className="flex">
                <span className="flex select-none items-center rounded-l-md border border-r-0 bg-muted px-2.5 text-sm font-mono text-muted-foreground">+91</span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  className="rounded-l-none font-mono"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError(null);
                    if (collision) setCollision(null);
                  }}
                  onBlur={() => {
                    if (!phone.trim()) { setPhoneError(null); return; }
                    const v = validateIndianPhone(phone);
                    setPhoneError(v.ok ? null : v.error);
                  }}
                  maxLength={15}
                  placeholder="98765 43210"
                  required
                />
              </div>
              {phoneError && <p className="mt-1 text-xs text-destructive">{phoneError}</p>}
            </div>
          </div>

          {/* Row 2: Age + Gender + Address */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_2fr]">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('cust.age')}</label>
              <Input type="number" inputMode="numeric" min={0} max={130}
                className="font-mono" value={age} onChange={(e) => setAge(e.target.value)} placeholder="—" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('cust.gender')}</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | '')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">—</option>
                <option value="male">{t('cust.gender.male')}</option>
                <option value="female">{t('cust.gender.female')}</option>
                <option value="other">{t('cust.gender.other')}</option>
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="mb-1 block text-sm font-medium">{t('cust.address')}</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop no., street, city"
                maxLength={240}
              />
            </div>
          </div>

          {/* Phone-collision resolver — shown after a duplicate save attempt. */}
          {collision && (
            <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                <Users className="h-4 w-4" />
                {t('cust.phone_in_use')}
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-background p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {initials(collision.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{collision.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{collision.phone}</div>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t('cust.family_explain').replace('{name}', collision.name)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/customers/${collision.id}`);
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                  {t('cust.open_existing')}
                </Button>
                <Button
                  type="button"
                  onClick={() => addAsFamily.mutate()}
                  disabled={addAsFamily.isPending || !name.trim()}
                >
                  {addAsFamily.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Users className="h-4 w-4" />
                  {t('cust.add_as_family').replace('{name}', collision.name)}
                </Button>
              </div>
              {addAsFamily.isError && (
                <p className="mt-2 text-xs text-destructive">
                  {addAsFamily.error?.message ?? t('common.unknown')}
                </p>
              )}
            </div>
          )}

          {mut.isError && !(mut.error instanceof DuplicatePhoneError) && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {mut.error?.message ?? t('common.unknown')}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending || addAsFamily.isPending}>
              {t('btn.cancel')}
            </Button>
            {!collision && (
              <Button type="submit" disabled={!canSubmit}>
                {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {mut.isPending
                  ? (isEdit ? t('btn.saving') : t('btn.creating'))
                  : (isEdit ? t('btn.update_customer') : t('btn.create_customer'))}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
