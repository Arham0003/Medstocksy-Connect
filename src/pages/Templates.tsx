import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Image as ImageIcon } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase, type Tables } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateDialog } from '@/components/crm/TemplateDialog';
import { TEMPLATE_KINDS, deduplicateTemplates } from '@/lib/crm/templates';
import { SUPPORTED_LANGUAGES } from '@/i18n/translations';

type Template = Tables<'crm_templates'>;

export default function Templates() {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  const { data, isLoading } = useQuery<Template[]>({
    queryKey: ['templates', pharmacyId],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('crm_templates')
        .select('*')
        .or(`pharmacy_id.is.null,pharmacy_id.eq.${pharmacyId}`)
        .order('is_built_in', { ascending: false });
      if (error) throw error;
      return deduplicateTemplates(rows ?? []) as Template[];
    },
  });

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (tpl: Template) => { setEditing(tpl); setDialogOpen(true); };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{t('nav.section.crm')}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{t('templates.title')}</h1>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> {t('btn.add')}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72" />)
        ) : (
          (data ?? []).map((tpl, i) => (
            <motion.div
              key={tpl.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <button
                type="button"
                onClick={() => openEdit(tpl)}
                className="block w-full text-left"
              >
                <Card className="overflow-hidden p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-popover">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                      TEMPLATE_KINDS[tpl.kind]?.color ?? TEMPLATE_KINDS.custom.color
                    )}>
                      {TEMPLATE_KINDS[tpl.kind]?.label ?? TEMPLATE_KINDS.custom.label}
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {tpl.is_built_in ? t('templates.tag_prebuilt') : t('templates.tag_custom')}
                    </span>
                    {tpl.image_url && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground" title="Has image">
                        <ImageIcon className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-lg font-bold">{tpl.name}</h3>
                  {tpl.image_url && (
                    <img
                      src={tpl.image_url}
                      alt=""
                      className="mt-3 h-32 w-full rounded-md border object-cover"
                    />
                  )}
                  <div
                    className={cn(
                      'mt-3 line-clamp-5 whitespace-pre-wrap rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed dark:bg-emerald-950/30',
                      tpl.language === 'hi' && 'font-["Noto_Sans_Devanagari",Inter,system-ui]'
                    )}
                  >
                    {tpl.body}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tpl.variables.map((v: string) => (
                      <span
                        key={v}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {`{${v}}`}
                      </span>
                    ))}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      {SUPPORTED_LANGUAGES.find(l => l.code === tpl.language)?.label ?? tpl.language}
                    </span>
                  </div>
                </Card>
              </button>
            </motion.div>
          ))
        )}
      </div>

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editing}
      />
    </div>
  );
}
