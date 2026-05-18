import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ImagePlus, X as XIcon, Trash2, Languages } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase, type Tables } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { translateText } from '@/lib/translate';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { TemplateKind } from '@/types/database';
import { TEMPLATE_KINDS, VARIABLE_CHIPS } from '@/lib/crm/templates';
import { SUPPORTED_LANGUAGES } from '@/i18n/translations';

type Template = Tables<'crm_templates'>;
type TplLang = 'en' | 'hi';

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog opens in edit mode pre-filled with this template */
  template?: Template | null;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const KIND_OPTIONS = Object.entries(TEMPLATE_KINDS).map(([value, meta]) => ({
  value: value as TemplateKind,
  key: meta.key,
}));

/** Extract {variables} from template body so they're stored on the row. */
function extractVariables(body: string): string[] {
  const matches = body.match(/\{(\w+)\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
}

export function TemplateDialog({ open, onOpenChange, template }: TemplateDialogProps) {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const qc = useQueryClient();
  const isEdit = !!template;
  const isBuiltIn = !!template?.is_built_in;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<TemplateKind>('custom');
  const [language, setLanguage] = useState<TplLang>('en');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /** Insert {key} at the textarea's caret (or append if not focused). */
  const insertVariable = (key: string) => {
    if (isBuiltIn) return;
    const token = `{${key}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  // Hydrate from template on open
  useEffect(() => {
    if (!open) return;
    if (isEdit && template) {
      setName(template.name);
      setKind(template.kind);
      setLanguage((template.language as TplLang) ?? 'en');
      setBody(template.body);
      setImageUrl(template.image_url ?? null);
    } else {
      setName('');
      setKind('custom');
      setLanguage('en');
      setBody('');
      setImageUrl(null);
    }
    setImageError(null);
  }, [open, isEdit, template]);

  const handleTranslate = async () => {
    if (!body.trim() || translating || isBuiltIn) return;
    setTranslateError(null);
    setTranslating(true);
    try {
      const target: TplLang = language === 'en' ? 'hi' : 'en';
      const translated = await translateText(body, language, target);
      setBody(translated);
      setLanguage(target);
    } catch (err) {
      console.error('[translate]', err);
      setTranslateError(err instanceof Error ? err.message : t('tpl.translate_error'));
    } finally {
      setTranslating(false);
    }
  };

  const handleFile = async (file: File) => {
    setImageError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setImageError(t('tpl.image_invalid_type'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t('tpl.image_too_large'));
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
      const path = `${pharmacyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('crm-template-images')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('crm-template-images').getPublicUrl(path);
      setImageUrl(pub.publicUrl);
    } catch (err) {
      console.error('[template upload]', err);
      setImageError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeImage = () => {
    setImageUrl(null);
    setImageError(null);
  };

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      if (isBuiltIn) throw new Error('Cannot edit built-in templates.');
      if (!name.trim()) throw new Error('Template name is required.');
      if (!body.trim()) throw new Error('Message body is required.');
      if (body.length > 1024) throw new Error('Message body is too long (max 1024 chars).');

      const variables = extractVariables(body);
      const payload = {
        pharmacy_id: pharmacyId,
        kind,
        name: name.trim(),
        body: body.trim(),
        variables,
        language,
        image_url: imageUrl,
      };

      if (isEdit && template) {
        const { error } = await supabase
          .from('crm_templates')
          .update(payload as never)
          .eq('id', template.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('crm_templates')
          .insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['templates'] });
      onOpenChange(false);
    },
  });

  const remove = useMutation<void, Error>({
    mutationFn: async () => {
      if (!template || isBuiltIn) return;
      if (!window.confirm(t('tpl.confirm_delete'))) throw new Error('cancelled');
      const { error } = await supabase.from('crm_templates').delete().eq('id', template.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['templates'] });
      onOpenChange(false);
    },
  });

  const canSubmit = !!name.trim() && !!body.trim() && !save.isPending && !uploading && !isBuiltIn;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending && !uploading) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('tpl.edit') : t('tpl.new')}</DialogTitle>
          <DialogDescription>{t('tpl.new_desc')}</DialogDescription>
        </DialogHeader>

        {isBuiltIn && (
          <div className="rounded-md bg-yellow-500/10 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-300">
            {t('tpl.builtin_locked')}
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) save.mutate(); }}
          className="space-y-3"
        >
          {/* Row 1: Name + Type + Language (compact) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('tpl.name')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Diwali offer"'
                required
                autoFocus
                maxLength={80}
                disabled={isBuiltIn}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('tpl.kind')}</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as TemplateKind)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44"
                disabled={isBuiltIn}
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.key)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('tpl.language')}</label>
              <div className="flex h-10 rounded-md border bg-muted/40 p-0.5">
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <button
                    key={lng.code}
                    type="button"
                    onClick={() => !isBuiltIn && setLanguage(lng.code)}
                    disabled={isBuiltIn}
                    className={cn(
                      'flex h-full min-w-[3rem] items-center justify-center rounded px-3 text-sm font-medium transition-colors',
                      language === lng.code
                        ? 'bg-background text-foreground shadow-card'
                        : 'text-muted-foreground hover:text-foreground',
                      isBuiltIn && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    {lng.nativeLabel}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Body editor */}
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-sm font-medium">
                {t('tpl.body')} <span className="text-destructive">*</span>
              </label>
              <Button
                type="button"
                size="sm"
                onClick={handleTranslate}
                disabled={!body.trim() || translating || isBuiltIn}
                title={t('tpl.translate_hint')}
                className="h-8 gap-1.5"
              >
                {translating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Languages className="h-3.5 w-3.5" />
                )}
                {translating
                  ? t('tpl.translating')
                  : (language === 'en' ? t('tpl.translate_to_hi') : t('tpl.translate_to_en'))}
              </Button>
            </div>

            {/* Quick-insert variable chips */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {VARIABLE_CHIPS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => insertVariable(key)}
                  disabled={isBuiltIn}
                  className={cn(
                    'rounded-md border border-input bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors',
                    'hover:border-primary/40 hover:bg-primary/10 hover:text-primary',
                    'disabled:cursor-not-allowed disabled:opacity-60'
                  )}
                  title={`Insert {${key}} at cursor`}
                >
                  {`{${key}}`}
                </button>
              ))}
            </div>

            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={language === 'hi' ? t('tpl.body_placeholder_hi') : t('tpl.body_placeholder_en')}
              maxLength={1024}
              required
              lang={language}
              disabled={isBuiltIn}
              className={cn(
                'block h-36 w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-60',
                language === 'hi' && 'font-["Noto_Sans_Devanagari",Inter,system-ui]'
              )}
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('tpl.variables_hint')}</span>
              <span className="font-mono text-muted-foreground">{body.length} / 1024</span>
            </div>
            {translateError && (
              <p className="mt-1 text-xs text-destructive">{translateError}</p>
            )}
          </div>

          {/* Image upload */}
          <div>
            <label className="mb-1 block text-sm font-medium">{t('tpl.image')}</label>
            <p className="mb-2 text-xs text-muted-foreground">{t('tpl.image_hint')}</p>
            {imageUrl ? (
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <img
                  src={imageUrl}
                  alt="template attachment"
                  className="h-20 w-20 shrink-0 rounded-md border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="break-all font-mono text-[11px] text-muted-foreground">
                    {imageUrl.split('/').pop()}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={removeImage}
                    disabled={uploading || isBuiltIn}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                    {t('tpl.remove_image')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || isBuiltIn}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? t('tpl.uploading') : t('tpl.upload_image')}
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {imageError && <p className="mt-1 text-xs text-destructive">{imageError}</p>}
          </div>

          {save.isError && save.error.message !== 'cancelled' && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {save.error.message}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2 pt-2 sm:flex-nowrap">
            {isEdit && !isBuiltIn && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive sm:mr-auto"
                onClick={() => remove.mutate()}
                disabled={save.isPending || remove.isPending}
              >
                {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Trash2 className="h-4 w-4" />
                {t('btn.delete')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending || uploading}>
              {t('btn.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {save.isPending ? t('btn.saving') : (isEdit ? t('btn.save') : t('btn.create'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
