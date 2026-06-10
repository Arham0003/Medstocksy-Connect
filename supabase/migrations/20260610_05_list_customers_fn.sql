-- ═══════════════════════════════════════════════════════════════════════
-- Migration: crm_list_customers RPC
-- Server-side segment filtering + FTS search + correct pagination.
-- Fixes the client-side filter bug that broke pagination accuracy.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION crm_list_customers(
  p_pharmacy_id uuid,
  p_segment     text    DEFAULT 'all',
  p_search      text    DEFAULT NULL,
  p_sort        text    DEFAULT 'newest',
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  -- Count total matching rows (for correct pagination display)
  SELECT count(*)
  INTO   v_total
  FROM   crm_customers_enriched e
  WHERE  e.pharmacy_id = p_pharmacy_id
    AND  (
           p_segment = 'all'
        OR (p_segment = 'optout'    AND e.whatsapp_opted_in = false)
        OR (p_segment = 'chronic'   AND EXISTS (
              SELECT 1 FROM crm_tags t
              WHERE t.customer_id = e.id AND t.tag_key = 'chronic'
           ))
        OR e.auto_tags_json ? p_segment
         )
    AND  (
           p_search IS NULL
        OR e.fts @@ plainto_tsquery('simple', p_search)
        OR e.phone ILIKE '%' || p_search || '%'  -- phone prefix still uses trgm
         );

  -- Fetch page of rows
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO   v_rows
  FROM  (
    SELECT to_jsonb(e.*) AS row_data
    FROM   crm_customers_enriched e
    WHERE  e.pharmacy_id = p_pharmacy_id
      AND  (
             p_segment = 'all'
          OR (p_segment = 'optout'    AND e.whatsapp_opted_in = false)
          OR (p_segment = 'chronic'   AND EXISTS (
                SELECT 1 FROM crm_tags t
                WHERE t.customer_id = e.id AND t.tag_key = 'chronic'
             ))
          OR e.auto_tags_json ? p_segment
           )
      AND  (
             p_search IS NULL
          OR e.fts @@ plainto_tsquery('simple', p_search)
          OR e.phone ILIKE '%' || p_search || '%'
           )
    ORDER BY
      CASE WHEN p_sort = 'newest'       THEN e.created_at        END DESC NULLS LAST,
      CASE WHEN p_sort = 'oldest'       THEN e.created_at        END ASC  NULLS LAST,
      CASE WHEN p_sort = 'name'         THEN e.name              END ASC  NULLS LAST,
      CASE WHEN p_sort = 'recent_visit' THEN e.last_visit_at     END DESC NULLS LAST,
      CASE WHEN p_sort = 'top_spend'    THEN e.lifetime_value    END DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'total', v_total,
    'rows',  v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crm_list_customers(uuid, text, text, text, integer, integer) TO authenticated;
