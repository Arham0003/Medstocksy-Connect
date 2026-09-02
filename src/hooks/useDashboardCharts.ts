import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useActivePharmacy } from '@/contexts/PharmacyContext';

export interface RefillTimelineItem {
  date: string;
  dayLabel: string;
  reminders: number;
  refills: number;
}

export interface CohortItem {
  segment: 'chronic' | 'repeat' | 'new' | 'high_value' | 'inactive';
  label: string;
  count: number;
  fill: string;
}

export interface DashboardChartsData {
  timeline: RefillTimelineItem[];
  cohorts: CohortItem[];
  overallConversionRate: number;
  totalReminders: number;
  totalRefills: number;
  chronicPercentage: number;
  totalCustomers: number;
}

export function useDashboardCharts() {
  const { pharmacyId } = useActivePharmacy();

  return useQuery<DashboardChartsData>({
    queryKey: ['dashboard-charts-metrics', pharmacyId],
    enabled: !!pharmacyId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      // ── 1. Calculate 6 days + today date window ─────────────────────────
      const now = new Date();
      const startDate = new Date();
      startDate.setDate(now.getDate() - 5);
      startDate.setHours(0, 0, 0, 0);

      // Generate date keys for the 6-day window
      const dateBuckets: Record<string, { date: string; dayLabel: string; reminders: number; refills: number }> = {};
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const dayLabel = `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
        dateBuckets[iso] = {
          date: iso,
          dayLabel,
          reminders: 0,
          refills: 0,
        };
      }

      // ── 2. Parallel queries for reminders, refills, and cohorts ─────────
      const [
        remindersRes,
        refillsRes,
        autoTagsRes,
        chronicTagsRes,
        totalCustRes,
      ] = await Promise.all([
        // Reminders sent in date window
        supabase
          .from('crm_scheduled_reminders')
          .select('sent_at, status')
          .eq('pharmacy_id', pharmacyId)
          .in('status', ['sent', 'converted'])
          .gte('sent_at', startDate.toISOString()),

        // Refills recorded in date window
        supabase
          .from('crm_prescription_refills')
          .select('refilled_at')
          .eq('pharmacy_id', pharmacyId)
          .gte('refilled_at', startDate.toISOString()),

        // Auto tags for segments
        supabase
          .from('crm_customer_auto_tags')
          .select('tag, customer_id')
          .eq('pharmacy_id', pharmacyId),

        // Chronic manual tags
        supabase
          .from('crm_tags')
          .select('customer_id')
          .eq('pharmacy_id', pharmacyId)
          .eq('tag_key', 'chronic'),

        // Total customers count
        supabase
          .from('crm_customers')
          .select('id', { count: 'exact', head: true })
          .eq('pharmacy_id', pharmacyId),
      ]);

      // Aggregate reminders by day
      const remindersList = (remindersRes.data ?? []) as { sent_at: string | null; status: string }[];
      for (const r of remindersList) {
        if (r.sent_at) {
          const key = r.sent_at.slice(0, 10);
          if (dateBuckets[key]) {
            dateBuckets[key].reminders += 1;
          }
        }
      }

      // Aggregate refills by day
      const refillsList = (refillsRes.data ?? []) as { refilled_at: string }[];
      for (const rf of refillsList) {
        if (rf.refilled_at) {
          const key = rf.refilled_at.slice(0, 10);
          if (dateBuckets[key]) {
            dateBuckets[key].refills += 1;
          }
        }
      }

      const timeline = Object.values(dateBuckets);
      const totalReminders = timeline.reduce((acc, curr) => acc + curr.reminders, 0);
      const totalRefills = timeline.reduce((acc, curr) => acc + curr.refills, 0);
      const overallConversionRate = totalReminders > 0 ? Math.round((totalRefills / totalReminders) * 100) : 0;

      // ── 3. Aggregate Cohort Counts ──────────────────────────────────────
      const totalCustomers = totalCustRes.count ?? 0;
      const uniqueChronicIds = new Set(
        ((chronicTagsRes.data ?? []) as { customer_id: string }[]).map((r) => r.customer_id)
      );

      const segmentCounts: Record<'chronic' | 'repeat' | 'new' | 'high_value' | 'inactive', number> = {
        chronic: uniqueChronicIds.size,
        repeat: 0,
        new: 0,
        high_value: 0,
        inactive: 0,
      };

      const autoTagsList = (autoTagsRes.data ?? []) as { tag: string; customer_id: string }[];
      for (const row of autoTagsList) {
        if (row.tag === 'Repeat') segmentCounts.repeat += 1;
        else if (row.tag === 'New') segmentCounts.new += 1;
        else if (row.tag === 'High Value') segmentCounts.high_value += 1;
        else if (row.tag === 'Inactive') segmentCounts.inactive += 1;
      }

      const cohorts: CohortItem[] = [
        {
          segment: 'chronic',
          label: 'Chronic Care',
          count: segmentCounts.chronic,
          fill: 'var(--color-chronic)',
        },
        {
          segment: 'repeat',
          label: 'Repeat Patients',
          count: segmentCounts.repeat,
          fill: 'var(--color-repeat)',
        },
        {
          segment: 'new',
          label: 'New Patients',
          count: segmentCounts.new,
          fill: 'var(--color-new)',
        },
        {
          segment: 'high_value',
          label: 'High Value',
          count: segmentCounts.high_value,
          fill: 'var(--color-high_value)',
        },
        {
          segment: 'inactive',
          label: 'Inactive / At-Risk',
          count: segmentCounts.inactive,
          fill: 'var(--color-inactive)',
        },
      ];

      const chronicPercentage = totalCustomers > 0
        ? Math.round((segmentCounts.chronic / totalCustomers) * 100)
        : 0;

      return {
        timeline,
        cohorts,
        overallConversionRate,
        totalReminders,
        totalRefills,
        chronicPercentage,
        totalCustomers,
      };
    },
  });
}
