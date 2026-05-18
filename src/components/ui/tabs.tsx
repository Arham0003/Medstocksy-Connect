import { createContext, useContext, useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TabsContextValue {
  value: string;
  onValueChange: (next: string) => void;
  groupId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs.* must be used inside <Tabs>');
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (next: string) => void;
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  const groupId = useId();
  return (
    <TabsContext.Provider value={{ value, onValueChange, groupId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-1 overflow-x-auto border-b',
        className
      )}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function TabsTrigger({ value, disabled, className, children }: TabsTriggerProps) {
  const { value: active, onValueChange, groupId } = useTabs();
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`${groupId}-panel-${value}`}
      id={`${groupId}-tab-${value}`}
      disabled={disabled}
      onClick={() => onValueChange(value)}
      className={cn(
        'relative px-3 py-2.5 text-sm font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        className
      )}
    >
      {children}
      {selected && (
        <motion.span
          layoutId={`tabs-underline-${groupId}`}
          className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary"
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </button>
  );
}

export function TabsContent({
  value, className, children,
}: { value: string; className?: string; children: ReactNode }) {
  const { value: active, groupId } = useTabs();
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${groupId}-panel-${value}`}
      aria-labelledby={`${groupId}-tab-${value}`}
      className={cn('animate-fade-in pt-6', className)}
    >
      {children}
    </div>
  );
}
