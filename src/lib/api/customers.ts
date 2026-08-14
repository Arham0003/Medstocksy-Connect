import { supabase, rpc } from '@/lib/supabase';
import type { Tables, Inserts } from '@/lib/supabase';
import type { TagKey } from '@/components/ui/tag';

export type Customer = Tables<'crm_customers'>;
export type CustomerStats = {
  customer_id: string;
  visit_count: number;
  lifetime_value: number;
  last_visit_at: string | null;
  avg_days_between_visits: number | null;
};

export type CustomerWithStats = Customer & {
  stats: CustomerStats | null;
  auto_tags: TagKey[];
};

const SEGMENT_TO_TAG: Record<string, TagKey> = {
  new: 'new',
  repeat: 'repeat',
  high_value: 'high_value',
  inactive: 'inactive',
};

export type CustomerSort = 'newest' | 'oldest' | 'name' | 'recent_visit' | 'top_spend';

/** One row of `crm_customers_enriched` as returned by the RPC: every
 *  crm_customers column, plus the flattened stats columns and auto-tags. */
type EnrichedRow = Customer & {
  visit_count: number | null;
  lifetime_value: number | null;
  last_visit_at: string | null;
  avg_days_between_visits: number | null;
  auto_tags_json: string[] | null;
  /** Generated tsvector on the table — never used client-side. */
  fts?: unknown;
};

export async function listCustomers(opts: {
  pharmacyId: string;
  search?: string;
  segment?: 'new' | 'repeat' | 'inactive' | 'high_value' | 'chronic' | 'optout' | 'all';
  sort?: CustomerSort;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CustomerWithStats[]; total: number }> {
  const { pharmacyId, search, segment = 'all', sort = 'newest', limit = 25, offset = 0 } = opts;

  // Filtering, sorting and pagination all happen in `crm_list_customers`
  // (migration 20260610_05). Doing it here instead of client-side fixes two
  // things: the `chronic` segment (a manual crm_tags row, which the old
  // client filter had no way to see and so always returned empty), and
  // `recent_visit`/`top_spend`, which used to sort only the current page and
  // therefore produced the wrong order past the first 25 rows.
  const { data, error } = await rpc<{ total: number; rows: EnrichedRow[] }>(
    'crm_list_customers',
    {
      p_pharmacy_id: pharmacyId,
      p_segment: segment,
      p_search: search?.trim() || null,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
    }
  );
  if (error) throw new Error(error.message);

  const rows = (data?.rows ?? []).map((row): CustomerWithStats => {
    const { auto_tags_json, visit_count, lifetime_value, last_visit_at,
            avg_days_between_visits, fts: _fts, ...customer } = row;

    return {
      ...(customer as Customer),
      // crm_customer_stats is LEFT JOINed, so every stat column is null until
      // the customer has at least one sale. Keep `stats: null` in that case
      // rather than an object of nulls — callers already branch on it.
      stats: visit_count === null
        ? null
        : {
            customer_id: row.id,
            visit_count,
            lifetime_value: lifetime_value ?? 0,
            last_visit_at,
            avg_days_between_visits,
          },
      auto_tags: (auto_tags_json ?? [])
        .map((tag) => SEGMENT_TO_TAG[tag])
        .filter((tag): tag is TagKey => Boolean(tag)),
    };
  });

  return { rows, total: data?.total ?? 0 };
}

/** Find an existing PRIMARY customer for the given phone, scoped to this
 *  pharmacy. Returns null if none — used by createCustomer below to resolve
 *  duplicate-phone collisions into a "family member" workflow. */
async function findPrimaryByPhone(
  pharmacyId: string, phoneE164: string
): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('crm_customers')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .eq('phone', phoneE164)
    .is('family_of_id', null)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Customer | null) ?? null;
}

export async function getCustomer(id: string): Promise<CustomerWithStats | null> {
  const { data: rawData, error } = await supabase
    .from('crm_customers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const data = rawData as unknown as Customer | null;
  if (!data) return null;

  const [statsRes, tagsRes] = await Promise.all([
    supabase.from('crm_customer_stats').select('*').eq('customer_id', id).maybeSingle(),
    supabase.from('crm_customer_auto_tags').select('tag').eq('customer_id', id),
  ]);

  const tagRows = (tagsRes.data ?? []) as unknown as { tag: string }[];

  return {
    ...data,
    stats: (statsRes.data as unknown as CustomerStats | null) ?? null,
    auto_tags: tagRows
      .map((t) => SEGMENT_TO_TAG[t.tag])
      .filter((t): t is TagKey => Boolean(t)),
  };
}

/** Error thrown when a customer insert collides with the primary-phone
 *  unique index. Carries the existing primary so the UI can offer
 *  "Open profile" or "Add as family member". */
export class DuplicatePhoneError extends Error {
  existing: Customer;
  constructor(existing: Customer) {
    super(`Phone ${existing.phone} is already in use by ${existing.name}.`);
    this.name = 'DuplicatePhoneError';
    this.existing = existing;
  }
}

export async function createCustomer(payload: Inserts<'crm_customers'>): Promise<Customer> {
  const { data, error } = await supabase
    .from('crm_customers')
    .insert(payload as never)
    .select()
    .single();
  if (error) {
    // 23505 = unique_violation. Only fires when family_of_id is null and the
    // phone collides with an existing primary. Surface the existing row so
    // the dialog can pivot to family-member mode.
    if (error.code === '23505' && !payload.family_of_id) {
      const existing = await findPrimaryByPhone(payload.pharmacy_id, payload.phone);
      if (existing) throw new DuplicatePhoneError(existing);
    }
    throw error;
  }
  return data as unknown as Customer;
}

export async function setOptOut(customerId: string, reason?: string): Promise<void> {
  const { error } = await supabase
    .from('crm_customers')
    .update({
      whatsapp_opted_in: false,
      whatsapp_opted_out_at: new Date().toISOString(),
      whatsapp_opted_out_reason: reason ?? null,
    } as never)
    .eq('id', customerId);
  if (error) throw error;
}

/** Record a quick sale (no inventory-app link). Generates a synthetic
 *  sale_id locally so the row satisfies the cross-domain UUID column. */
export async function recordSale(args: {
  pharmacyId: string;
  customerId: string;
  billAmount: number;
  soldAt?: string;
  medicines?: { name: string; qty?: number }[];
  attachmentUrl?: string | null;
}): Promise<void> {
  const sale_id = crypto.randomUUID();
  const { error } = await supabase
    .from('crm_customer_sales')
    .insert({
      pharmacy_id: args.pharmacyId,
      customer_id: args.customerId,
      sale_id,
      bill_amount: args.billAmount,
      sold_at: args.soldAt ?? new Date().toISOString(),
      medicines: (args.medicines ?? []) as never,
      attachment_url: args.attachmentUrl ?? null,
    } as never);
  if (error) throw new Error(error.message);
}

/** Re-activate a customer who had previously opted out. */
export async function setOptIn(customerId: string): Promise<void> {
  const { error } = await supabase
    .from('crm_customers')
    .update({
      whatsapp_opted_in: true,
      whatsapp_opted_out_at: null,
      whatsapp_opted_out_reason: null,
    } as never)
    .eq('id', customerId);
  if (error) throw error;
}

export async function updateCustomer(
  id: string,
  patch: Partial<Pick<Customer, 'name' | 'phone' | 'age' | 'gender' | 'address' | 'notes'>>
): Promise<Customer> {
  const { data, error } = await supabase
    .from('crm_customers')
    .update(patch as never)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Customer;
}

/** Add a manual tag to a customer (e.g. 'chronic'). Idempotent via UNIQUE constraint. */
export async function addTag(pharmacyId: string, customerId: string, tagKey: string): Promise<void> {
  const { error } = await supabase
    .from('crm_tags')
    .insert({ pharmacy_id: pharmacyId, customer_id: customerId, tag_key: tagKey } as never);
  // Ignore unique-violation: tag already exists for this customer.
  if (error && error.code !== '23505') throw error;
}

export async function removeTag(customerId: string, tagKey: string): Promise<void> {
  const { error } = await supabase
    .from('crm_tags')
    .delete()
    .eq('customer_id', customerId)
    .eq('tag_key', tagKey);
  if (error) throw error;
}

export async function listManualTags(customerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('crm_tags')
    .select('tag_key')
    .eq('customer_id', customerId);
  if (error) throw error;
  return ((data ?? []) as unknown as { tag_key: string }[]).map((r) => r.tag_key);
}

export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await supabase
    .from('crm_customers')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

