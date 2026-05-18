/**
 * Auto-generate this file from your Supabase project after applying the
 * migration. Run from the project root:
 *
 *   npx supabase login
 *   npx supabase gen types typescript --project-id <YOUR-PROJECT-REF> > src/types/database.ts
 *
 * Until you run that, this hand-typed shim covers the tables we actually use.
 * It is type-correct against `supabase/migrations/20260507_medcrm.sql`.
 */

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type MemberRole = 'admin' | 'manager' | 'staff';
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'bounced';
export type MessageDirection = 'outbound' | 'inbound';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
export type ReminderStatus = 'pending' | 'sent' | 'cancelled' | 'converted' | 'failed';
export type TemplateKind = 'thank_you' | 'refill_reminder' | 'offer' | 'custom' | 'win_back' | 'out_of_stock';

export interface Database {
  public: {
    Tables: {
      crm_pharmacies: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          phone: string | null;
          address: string | null;
          whatsapp_number: string | null;
          logo_url: string | null;
          send_window_start: string;
          send_window_end: string;
          rate_limit_per_hour: number;
          bulk_approval_threshold: number;
          created_at: string;
          updated_at: string;
        };
        Insert: { name: string; owner_id?: string; phone?: string; address?: string; whatsapp_number?: string; logo_url?: string | null };
        Update: Partial<Database['public']['Tables']['crm_pharmacies']['Insert']>;
      };
      crm_members: {
        Row: { id: string; pharmacy_id: string; user_id: string; role: MemberRole; invited_by: string | null; joined_at: string };
        Insert: { pharmacy_id: string; user_id: string; role?: MemberRole };
        Update: { role?: MemberRole };
      };
      crm_customers: {
        Row: {
          id: string; pharmacy_id: string; family_of_id: string | null;
          name: string; phone: string;
          age: number | null; gender: 'male' | 'female' | 'other' | null; address: string | null; notes: string | null;
          whatsapp_opted_in: boolean; whatsapp_opted_out_at: string | null; whatsapp_opted_out_reason: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          pharmacy_id: string; name: string; phone: string;
          family_of_id?: string | null;
          age?: number; gender?: 'male'|'female'|'other'; address?: string; notes?: string;
        };
        Update: Partial<Database['public']['Tables']['crm_customers']['Insert']>;
      };
      crm_customer_sales: {
        Row: { id: string; customer_id: string; sale_id: string; pharmacy_id: string; bill_amount: number; sold_at: string; medicines: Json; attachment_url: string | null; created_at: string };
        Insert: { customer_id: string; sale_id: string; pharmacy_id: string; bill_amount?: number; sold_at?: string; medicines?: Json; attachment_url?: string | null };
        Update: Partial<Database['public']['Tables']['crm_customer_sales']['Insert']>;
      };
      crm_tags: {
        Row: { id: string; pharmacy_id: string; customer_id: string; tag_key: string; added_by: string | null; created_at: string };
        Insert: { pharmacy_id: string; customer_id: string; tag_key: string };
        Update: { tag_key?: string };
      };
      crm_templates: {
        Row: {
          id: string; pharmacy_id: string | null; kind: TemplateKind; name: string; body: string;
          variables: string[]; whatsapp_template_name: string | null; whatsapp_status: string;
          is_built_in: boolean; language: 'en' | 'hi'; image_url: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          pharmacy_id?: string | null; kind: TemplateKind; name: string; body: string;
          variables?: string[]; language?: 'en' | 'hi'; image_url?: string | null;
        };
        Update: Partial<Database['public']['Tables']['crm_templates']['Insert']>;
      };
      crm_reminder_rules: {
        Row: {
          id: string; pharmacy_id: string; medicine_label: string; category_match: string[];
          refill_cycle_days: number; reminder_offset_days: number; template_id: string;
          send_time: string; is_active: boolean; created_at: string; updated_at: string;
        };
        Insert: { pharmacy_id: string; medicine_label: string; refill_cycle_days: number; template_id: string; reminder_offset_days?: number; send_time?: string };
        Update: Partial<Database['public']['Tables']['crm_reminder_rules']['Insert']>;
      };
      crm_scheduled_reminders: {
        Row: {
          id: string; pharmacy_id: string; customer_id: string; rule_id: string | null;
          template_id: string; variables: Json; scheduled_for: string; status: ReminderStatus;
          message_id: string | null; created_at: string; sent_at: string | null;
        };
        Insert: { pharmacy_id: string; customer_id: string; template_id: string; scheduled_for: string; rule_id?: string; variables?: Json };
        Update: Partial<Database['public']['Tables']['crm_scheduled_reminders']['Insert']>;
      };
      crm_campaigns: {
        Row: {
          id: string; pharmacy_id: string; created_by: string; name: string; segment_key: string;
          template_id: string; variables: Json; status: CampaignStatus; scheduled_for: string | null;
          total_recipients: number; sent_count: number; delivered_count: number; failed_count: number; reply_count: number;
          approved_at: string | null; approved_by: string | null; created_at: string; updated_at: string;
        };
        Insert: { pharmacy_id: string; name: string; segment_key: string; template_id: string; created_by?: string; scheduled_for?: string };
        Update: Partial<Database['public']['Tables']['crm_campaigns']['Insert']>;
      };
      crm_campaign_recipients: {
        Row: { id: string; campaign_id: string; customer_id: string; status: MessageStatus; message_id: string | null; sent_at: string | null };
        Insert: { campaign_id: string; customer_id: string };
        Update: { status?: MessageStatus; message_id?: string };
      };
      crm_messages: {
        Row: {
          id: string; pharmacy_id: string; customer_id: string | null;
          template_id: string | null; campaign_id: string | null; reminder_id: string | null;
          direction: MessageDirection; status: MessageStatus; body: string; variables: Json;
          to_phone: string; from_phone: string | null; whatsapp_message_id: string | null;
          error_code: string | null; error_message: string | null;
          sent_at: string | null; delivered_at: string | null; read_at: string | null; failed_at: string | null;
          triggered_by: string | null; created_at: string;
        };
        Insert: { pharmacy_id: string; body: string; to_phone: string; customer_id?: string; template_id?: string };
        Update: Partial<Database['public']['Tables']['crm_messages']['Insert']>;
      };
      crm_visit_notes: {
        Row: {
          id: string; pharmacy_id: string; customer_id: string;
          note: string; medicines: string[]; added_by: string | null; created_at: string;
        };
        Insert: { pharmacy_id: string; customer_id: string; note: string; medicines?: string[] };
        Update: { note?: string; medicines?: string[] };
      };
      crm_prescriptions: {
        Row: {
          id: string; pharmacy_id: string; customer_id: string;
          doctor_name: string | null; prescription_date: string;
          follow_up_date: string | null;
          diagnosis: string | null; notes: string | null;
          attachment_url: string | null;
          total_cost: number | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          pharmacy_id: string; customer_id: string;
          doctor_name?: string | null; prescription_date?: string;
          follow_up_date?: string | null;
          diagnosis?: string | null; notes?: string | null;
          attachment_url?: string | null;
          total_cost?: number | null;
        };
        Update: Partial<Database['public']['Tables']['crm_prescriptions']['Insert']>;
      };
      crm_prescription_medicines: {
        Row: {
          id: string; prescription_id: string; position: number;
          medicine_name: string;
          form: string | null;
          strength: string | null;
          dosage: string | null;
          route: string | null;
          frequency: string;
          quantity: number | null;
          duration_days: number | null; refill_interval_days: number | null;
          instructions: string | null;
          substitution_allowed: boolean;
          medicine_notes: string | null;
        };
        Insert: {
          prescription_id: string; medicine_name: string; position?: number;
          form?: string | null;
          strength?: string | null;
          dosage?: string | null;
          route?: string | null;
          frequency?: string;
          quantity?: number | null;
          duration_days?: number | null; refill_interval_days?: number | null;
          instructions?: string | null;
          substitution_allowed?: boolean;
          medicine_notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['crm_prescription_medicines']['Insert']>;
      };
      crm_prescription_refills: {
        Row: {
          id: string; pharmacy_id: string; prescription_id: string;
          medicine_id: string; customer_id: string;
          refilled_at: string; quantity_dispensed: number | null;
          bill_amount: number | null; notes: string | null;
          served_by: string | null; created_at: string;
        };
        Insert: {
          pharmacy_id: string; prescription_id: string;
          medicine_id: string; customer_id: string;
          refilled_at?: string; quantity_dispensed?: number | null;
          bill_amount?: number | null; notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['crm_prescription_refills']['Insert']>;
      };
      crm_send_log: { Row: { id: string; pharmacy_id: string; message_id: string | null; sent_at: string }; Insert: { pharmacy_id: string }; Update: never };
      crm_audit_log: {
        Row: {
          id: number; pharmacy_id: string; user_id: string | null; table_name: string;
          row_id: string | null; action: 'INSERT' | 'UPDATE' | 'DELETE'; old_data: Json | null; new_data: Json | null;
          ip_address: string | null; created_at: string;
        };
        Insert: never; Update: never;
      };
    };
    Views: {
      crm_my_pharmacies: { Row: { pharmacy_id: string; role: MemberRole; pharmacy_name: string; pharmacy_logo_url: string | null } };
      crm_customer_stats: {
        Row: { customer_id: string; pharmacy_id: string; visit_count: number; lifetime_value: number; last_visit_at: string | null; avg_days_between_visits: number | null };
      };
      crm_customer_auto_tags: { Row: { customer_id: string; pharmacy_id: string; tag: string } };
      crm_whatsapp_health: {
        Row: {
          pharmacy_id: string; rate_limit_per_hour: number; sends_last_hour: number;
          bounce_rate_24h: number | null; opt_outs_30d: number; total_customers: number;
          send_window_start: string; send_window_end: string;
        };
      };
    };
    Functions: {
      crm_is_member: { Args: { p_pharmacy_id: string }; Returns: boolean };
      crm_my_role: { Args: { p_pharmacy_id: string }; Returns: MemberRole };
      crm_can_send_now: { Args: { p_pharmacy_id: string }; Returns: boolean };
    };
    Enums: {
      crm_member_role: MemberRole;
      crm_message_status: MessageStatus;
      crm_message_direction: MessageDirection;
      crm_campaign_status: CampaignStatus;
      crm_reminder_status: ReminderStatus;
      crm_template_kind: TemplateKind;
    };
  };
}
