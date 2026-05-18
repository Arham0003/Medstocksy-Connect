import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, BellOff } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { listCustomers, type CustomerWithStats } from '@/lib/api/customers';
import { initials, cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface CustomerPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (customer: CustomerWithStats) => void;
  /** When true, opted-out customers are visually disabled (default true) */
  excludeOptOuts?: boolean;
}

export function CustomerPickerDialog({
  open, onOpenChange, onPick, excludeOptOuts = true,
}: CustomerPickerDialogProps) {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customer-picker', pharmacyId, search],
    enabled: open,
    queryFn: () => listCustomers({ pharmacyId, search: search || undefined, limit: 30 }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="border-b p-5">
          <DialogTitle>{t('btn.pick_customer')}</DialogTitle>
          <DialogDescription>{t('compose.recipient')}</DialogDescription>
        </DialogHeader>

        <div className="border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('customers.search_placeholder')}
              className="pl-10"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : data?.rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t('customers.empty')}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {(data?.rows ?? []).map((c) => {
                const optedOut = !c.whatsapp_opted_in;
                const disabled = excludeOptOuts && optedOut;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => { if (!disabled) onPick(c); }}
                      disabled={disabled}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md p-2.5 text-left transition-colors',
                        disabled
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{c.phone}</div>
                      </div>
                      {optedOut && (
                        <span className="flex shrink-0 items-center gap-1 rounded bg-tag-optout-bg px-2 py-0.5 text-[10px] font-bold uppercase text-tag-optout-fg">
                          <BellOff className="h-3 w-3" />
                          {t('compose.opted_out')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
