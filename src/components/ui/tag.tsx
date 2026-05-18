import { cn } from '@/lib/utils';

export type TagKey = 'new' | 'repeat' | 'high_value' | 'inactive' | 'chronic' | 'optout';

const tagStyles: Record<TagKey, string> = {
  new: 'bg-tag-new-bg text-tag-new-fg',
  repeat: 'bg-tag-repeat-bg text-tag-repeat-fg',
  high_value: 'bg-tag-high-bg text-tag-high-fg',
  inactive: 'bg-tag-inactive-bg text-tag-inactive-fg',
  chronic: 'bg-tag-chronic-bg text-tag-chronic-fg',
  optout: 'bg-tag-optout-bg text-tag-optout-fg',
};

const tagLabels: Record<TagKey, string> = {
  new: 'New',
  repeat: 'Repeat',
  high_value: 'High Value',
  inactive: 'Inactive',
  chronic: 'Chronic',
  optout: 'Opt-out',
};

interface TagProps {
  tag: TagKey;
  className?: string;
}

/**
 * The 6 approved tag colours. Adding a 7th = product approval (theme rule).
 * Use `<Tag tag="repeat" />` consistently across the app.
 */
export function Tag({ tag, className }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
        tagStyles[tag],
        className
      )}
    >
      {tagLabels[tag]}
    </span>
  );
}
