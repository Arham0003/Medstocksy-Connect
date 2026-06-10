import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Subscribe to a Supabase Realtime postgres_changes channel for a specific
 * table scoped to `pharmacyId`. On any INSERT / UPDATE / DELETE event,
 * invalidates the given React Query keys so the UI refreshes automatically.
 *
 * The subscription is cleaned up when the component unmounts or when
 * pharmacyId / table changes.
 *
 * @example
 * useRealtimeInvalidate({
 *   table: 'crm_scheduled_reminders',
 *   pharmacyId,
 *   queryKeys: [['dashboard', pharmacyId], ['upcoming-reminders', pharmacyId]],
 * });
 */
export function useRealtimeInvalidate({
  table,
  pharmacyId,
  queryKeys,
}: {
  table: string;
  pharmacyId: string;
  /** Array of React Query key arrays to invalidate on any change. */
  queryKeys: (string | undefined)[][];
}) {
  const qc = useQueryClient();
  // Stable ref so we don't re-subscribe on every render
  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;

  useEffect(() => {
    if (!pharmacyId) return;

    const channelName = `rt:${table}:${pharmacyId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `pharmacy_id=eq.${pharmacyId}`,
        },
        () => {
          queryKeysRef.current.forEach((key) =>
            qc.invalidateQueries({ queryKey: key })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pharmacyId, table, qc]);
}
