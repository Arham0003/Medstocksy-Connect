/**
 * Campaign report — manual / wa.me flow, no paid WhatsApp API.
 *
 * Shows every customer in the campaign's segment with a Send button.
 * We do NOT track delivery status — without the paid API, any status
 * stored is unreliable. The Send button is always available so staff
 * can re-open WhatsApp for any customer at any time.
 *
 * ponytail: no recipient DB query, no status tracking, no logManualSend here —
 * the send dialog already recorded those rows. This view is read-only: just
 * show the segment customers and let staff tap Send if they need to retry.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, AlertTriangle, MessageSquare } from 'lucide-react';
import { supabase, type Tables } from '@/lib/supabase';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { openWhatsAppCompose } from '@/lib/api/messages';
import { resolveSegmentCustomers, fetchCustomerCampaignVars } from '@/lib/api/campaigns';
import { renderTemplate } from '@/lib/utils';

type Campaign = Tables<'crm_campaigns'>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

export function CampaignAnalyticsDialog({ open, onOpenChange, campaign }: Props) {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const [opening, setOpening] = useState<string | null>(null); // customer_id being opened in WA

  // Segment customers — the target list for this campaign
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['campaign-segment-customers', campaign?.id, campaign?.segment_key],
    enabled: open && !!campaign,
    queryFn: () => resolveSegmentCustomers(pharmacyId, campaign!.segment_key),
  });

  // Template for composing the message on Send
  const { data: template } = useQuery({
    queryKey: ['campaign-template', campaign?.template_id],
    enabled: open && !!campaign?.template_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_templates').select('*').eq('id', campaign!.template_id).maybeSingle();
      if (error) throw new Error(error.message);
      return data as Tables<'crm_templates'> | null;
    },
  });

  const openForCustomer = async (customerId: string, name: string, phone: string) => {
    if (!template) return;
    setOpening(customerId);
    try {
      const vars = await fetchCustomerCampaignVars(pharmacyId, customerId, name);
      const body = renderTemplate(template.body, vars);
      openWhatsAppCompose({ phone, body, imageUrl: template.image_url });
    } finally {
      setOpening(null);
    }
  };

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign.name}</DialogTitle>
          <DialogDescription>{t('campaigns.analytics.desc')}</DialogDescription>
        </DialogHeader>

        {/* 14-day deletion warning */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('campaigns.analytics.auto_delete_warn')}</span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : customers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('campaigns.analytics.empty')}
          </p>
        ) : (
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t('campaigns.analytics.recipients')} ({customers.length})
            </h4>
            <div className="max-h-96 overflow-y-auto rounded-lg border divide-y">
              {customers.map((c) => {
                const isOpening = opening === c.id;
                return (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{c.phone}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={isOpening || !template || !c.phone}
                      onClick={() => openForCustomer(c.id, c.name, c.phone)}
                    >
                      {isOpening
                        ? <MessageSquare className="h-3 w-3 animate-pulse" />
                        : <Send className="h-3 w-3" />
                      }
                      <span className="ml-1">{t('campaigns.analytics.retry_send')}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
