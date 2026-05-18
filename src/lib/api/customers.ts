import { supabase } from '@/lib/supabase';
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

export async function listCustomers(opts: {
  pharmacyId: string;
  search?: string;
  segment?: 'new' | 'repeat' | 'inactive' | 'high_value' | 'chronic' | 'optout' | 'all';
  sort?: CustomerSort;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CustomerWithStats[]; total: number }> {
  const { pharmacyId, search, segment = 'all', sort = 'newest', limit = 25, offset = 0 } = opts;
  // Server-side sorts go through .order(); 'recent_visit' / 'top_spend' use
  // crm_customer_stats which lives in a separate view, so we sort those
  // client-side after the fetch.
  let query = supabase
    .from('crm_customers')
    .select('*', { count: 'exact' })
    .eq('pharmacy_id', pharmacyId)
    .range(offset, offset + limit - 1);
  if (sort === 'newest')      query = query.order('created_at', { ascending: false });
  else if (sort === 'oldest') query = query.order('created_at', { ascending: true });
  else if (sort === 'name')   query = query.order('name', { ascending: true });
  else                        query = query.order('created_at', { ascending: false });

  if (search) {
    // ILIKE on name OR phone — RLS already restricts to pharmacy
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  if (segment === 'optout') {
    query = query.eq('whatsapp_opted_in', false);
  }

  const { data: rawData, count, error } = await query;
  if (error) throw error;
  const data = (rawData ?? []) as unknown as Customer[];

  const customerIds = data.map((c) => c.id);
  if (customerIds.length === 0) return { rows: [], total: count ?? 0 };

  // Stats + auto-tags in two parallel calls
  const [statsRes, autoTagsRes] = await Promise.all([
    supabase.from('crm_customer_stats').select('*').in('customer_id', customerIds),
    supabase.from('crm_customer_auto_tags').select('*').in('customer_id', customerIds),
  ]);

  if (statsRes.error) throw statsRes.error;
  if (autoTagsRes.error) throw autoTagsRes.error;

  const statsRows = (statsRes.data ?? []) as unknown as CustomerStats[];
  const tagRows = (autoTagsRes.data ?? []) as unknown as { customer_id: string; tag: string }[];

  const statsMap = new Map(statsRows.map((s) => [s.customer_id, s]));
  const tagsMap = new Map<string, TagKey[]>();
  for (const row of tagRows) {
    const tagKey = SEGMENT_TO_TAG[row.tag];
    if (!tagKey) continue;
    const list = tagsMap.get(row.customer_id) ?? [];
    list.push(tagKey);
    tagsMap.set(row.customer_id, list);
  }

  let rows: CustomerWithStats[] = data
    .map((c) => ({
      ...c,
      stats: statsMap.get(c.id) ?? null,
      auto_tags: tagsMap.get(c.id) ?? [],
    }))
    .filter((c) => {
      if (segment === 'all' || segment === 'optout') return true;
      if (segment === 'chronic') return false; // chronic is manual tag (TODO: join crm_tags)
      return c.auto_tags.includes(SEGMENT_TO_TAG[segment]!);
    });

  // Client-side sorts that depend on the stats view.
  if (sort === 'recent_visit') {
    rows = rows.slice().sort((a, b) => {
      const av = a.stats?.last_visit_at ?? '';
      const bv = b.stats?.last_visit_at ?? '';
      return bv.localeCompare(av);
    });
  } else if (sort === 'top_spend') {
    rows = rows.slice().sort((a, b) =>
      (b.stats?.lifetime_value ?? 0) - (a.stats?.lifetime_value ?? 0)
    );
  }

  return { rows, total: count ?? 0 };
}

/** Find an existing PRIMARY customer for the given phone, scoped to this
 *  pharmacy. Returns null if none — used by the create-customer dialog to
 *  resolve duplicate-phone collisions into a "family member" workflow. */
export async function findPrimaryByPhone(
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

/** List family members for a primary customer. */
export async function listFamilyMembers(primaryId: string): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('crm_customers')
    .select('*')
    .eq('family_of_id', primaryId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown) as Customer[];
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
