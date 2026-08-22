-- Fix security_definer_view advisory
ALTER VIEW public.crm_customer_stats SET (security_invoker = true);
ALTER VIEW public.crm_my_pharmacies SET (security_invoker = true);
ALTER VIEW public.crm_whatsapp_health SET (security_invoker = true);
ALTER VIEW public.crm_customer_auto_tags SET (security_invoker = true);
ALTER VIEW public.crm_customers_enriched SET (security_invoker = true);
