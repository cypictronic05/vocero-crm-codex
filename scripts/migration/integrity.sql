\set ON_ERROR_STOP on
\pset pager off

-- Informe deliberadamente libre de PII y secretos. Solo estructura, conteos y
-- consistencia. Se puede ejecutar tanto en origen como en destino y comparar.
SELECT version() AS postgres_version,
       current_setting('TimeZone') AS timezone,
       pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT schemaname,
       tablename,
       ((xpath(
         '/row/c/text()',
         query_to_xml(
           format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename),
           false,
           true,
           ''
         )
       ))[1]::text)::bigint AS exact_rows
FROM pg_tables
WHERE schemaname IN ('public', 'drizzle')
ORDER BY schemaname, tablename;

SELECT count(*) AS applied_migrations,
       min(created_at) AS first_migration_epoch,
       max(created_at) AS last_migration_epoch
FROM drizzle.__drizzle_migrations;

SELECT count(*) AS foreign_keys,
       count(*) FILTER (WHERE NOT convalidated) AS unvalidated_foreign_keys
FROM pg_constraint
WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace;

SELECT
  (SELECT count(*) FROM conversation v LEFT JOIN contact c ON c.id = v.contact_id WHERE c.id IS NULL)
    AS conversations_without_contact,
  (SELECT count(*) FROM message m LEFT JOIN conversation v ON v.id = m.conversation_id WHERE v.id IS NULL)
    AS messages_without_conversation,
  (SELECT count(*) FROM message m LEFT JOIN media_asset a ON a.id = m.media_asset_id
    WHERE m.media_asset_id IS NOT NULL AND a.id IS NULL)
    AS message_media_without_asset;

SELECT count(*) AS media_total,
       count(*) FILTER (WHERE fetch_status = 'available') AS media_available,
       count(*) FILTER (WHERE storage_path IS NOT NULL) AS with_storage_path,
       count(*) FILTER (WHERE fetch_status = 'available' AND storage_path IS NULL)
         AS available_without_path
FROM media_asset;

SELECT 'account_password_hashes' AS protected_item, count(*) AS rows
FROM account WHERE password IS NOT NULL
UNION ALL
SELECT 'meta_credentials_complete', count(*)
FROM meta_credentials
WHERE token_cipher IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL
UNION ALL
SELECT 'ai_credentials_complete', count(*)
FROM ai_credentials
WHERE token_cipher IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL
UNION ALL
SELECT 'capi_settings_complete', count(*)
FROM capi_settings
WHERE token_cipher IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL
UNION ALL
SELECT 'instagram_credentials_complete', count(*)
FROM instagram_credentials
WHERE token_cipher IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL
UNION ALL
SELECT 'messenger_credentials_complete', count(*)
FROM messenger_credentials
WHERE token_cipher IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL
UNION ALL
SELECT 'zoom_credentials_complete', count(*)
FROM zoom_credentials
WHERE secret_cipher IS NOT NULL AND secret_iv IS NOT NULL AND secret_tag IS NOT NULL
UNION ALL
SELECT 'google_credentials_complete', count(*)
FROM google_credentials
WHERE client_secret_cipher IS NOT NULL
  AND client_secret_iv IS NOT NULL
  AND client_secret_tag IS NOT NULL
  AND refresh_token_cipher IS NOT NULL
  AND refresh_token_iv IS NOT NULL
  AND refresh_token_tag IS NOT NULL
ORDER BY protected_item;

SELECT count(*) FILTER (WHERE assigned_member_id IS NOT NULL) AS assigned_conversations,
       count(*) FILTER (WHERE assigned_member_id IS NULL) AS unassigned_conversations,
       count(*) FILTER (WHERE handoff_at IS NOT NULL) AS handed_off_conversations,
       count(*) FILTER (WHERE ai_enabled) AS ai_enabled_conversations,
       count(*) FILTER (WHERE is_test) AS test_conversations
FROM conversation;

SELECT status, count(*) AS members,
       count(*) FILTER (WHERE jsonb_array_length(weekly_schedule) > 0)
         AS members_with_schedule
FROM member
GROUP BY status
ORDER BY status;

SELECT status, count(*) AS dispatches
FROM dispatch
GROUP BY status
ORDER BY status;

SELECT count(*) AS agent_profiles,
       count(*) FILTER (WHERE enabled) AS enabled_agent_profiles
FROM agent_profile;
