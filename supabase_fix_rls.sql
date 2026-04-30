-- ============================================================
-- VoceViva — Setup completo DB (idempotente, re-run sicuro)
-- Progetto: ezycobgovadcgvnyqcew
-- ============================================================
-- SOLUZIONE errore 42710:
--   L'event trigger Supabase tenta di ri-aggiungere notes a
--   supabase_realtime dopo OGNI ALTER TABLE notes.
--   Se notes e' gia' nella publication => 42710.
--   FIX: DROP notes dalla publication PRIMA dell'ALTER TABLE.
--   L'event trigger scatta una volta sola (finds notes absent => ADD OK).
--   NON serve ALTER PUBLICATION ... ADD TABLE manuale.
-- ============================================================

-- --------------------------------------------------------------
-- STEP 1: notes — una sola ALTER TABLE combinata
-- --------------------------------------------------------------
ALTER PUBLICATION supabase_realtime DROP TABLE public.notes;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ENABLE ROW LEVEL SECURITY;
-- ^^ event trigger scatta UNA volta, ri-aggiunge notes alla publication

-- --------------------------------------------------------------
-- STEP 2: altre tabelle (non sono in supabase_realtime => safe)
-- --------------------------------------------------------------
ALTER TABLE public.vv_user_profile
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vv_interactions
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------
-- STEP 3: Sanifica valori mode
-- --------------------------------------------------------------
UPDATE public.notes SET mode = 'write'
WHERE mode IS NULL OR mode NOT IN ('rec', 'write', 'rec+write', 'AI', 'report');

-- --------------------------------------------------------------
-- STEP 4: notes — policy
-- --------------------------------------------------------------
DROP POLICY IF EXISTS "anon_all_notes"    ON public.notes;
DROP POLICY IF EXISTS "anon_select_notes" ON public.notes;
DROP POLICY IF EXISTS "anon_insert_notes" ON public.notes;
DROP POLICY IF EXISTS "anon_update_notes" ON public.notes;
DROP POLICY IF EXISTS "anon_delete_notes" ON public.notes;
DROP POLICY IF EXISTS "own_select_notes"  ON public.notes;
DROP POLICY IF EXISTS "own_insert_notes"  ON public.notes;
DROP POLICY IF EXISTS "own_update_notes"  ON public.notes;
DROP POLICY IF EXISTS "own_delete_notes"  ON public.notes;

CREATE POLICY "own_select_notes" ON public.notes FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);
CREATE POLICY "own_insert_notes" ON public.notes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "own_update_notes" ON public.notes FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "own_delete_notes" ON public.notes FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

-- --------------------------------------------------------------
-- STEP 5: vv_user_profile — policy
-- --------------------------------------------------------------
DROP POLICY IF EXISTS "anon_all_vv_user_profile"    ON public.vv_user_profile;
DROP POLICY IF EXISTS "anon_select_vv_user_profile" ON public.vv_user_profile;
DROP POLICY IF EXISTS "anon_insert_vv_user_profile" ON public.vv_user_profile;
DROP POLICY IF EXISTS "anon_update_vv_user_profile" ON public.vv_user_profile;
DROP POLICY IF EXISTS "anon_delete_vv_user_profile" ON public.vv_user_profile;
DROP POLICY IF EXISTS "own_select_vv_user_profile"  ON public.vv_user_profile;
DROP POLICY IF EXISTS "own_insert_vv_user_profile"  ON public.vv_user_profile;
DROP POLICY IF EXISTS "own_update_vv_user_profile"  ON public.vv_user_profile;
DROP POLICY IF EXISTS "own_delete_vv_user_profile"  ON public.vv_user_profile;

CREATE POLICY "own_select_vv_user_profile" ON public.vv_user_profile FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);
CREATE POLICY "own_insert_vv_user_profile" ON public.vv_user_profile FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "own_update_vv_user_profile" ON public.vv_user_profile FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "own_delete_vv_user_profile" ON public.vv_user_profile FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

-- --------------------------------------------------------------
-- STEP 6: vv_interactions — policy
-- --------------------------------------------------------------
DROP POLICY IF EXISTS "anon_all_vv_interactions"    ON public.vv_interactions;
DROP POLICY IF EXISTS "anon_select_vv_interactions" ON public.vv_interactions;
DROP POLICY IF EXISTS "anon_insert_vv_interactions" ON public.vv_interactions;
DROP POLICY IF EXISTS "anon_update_vv_interactions" ON public.vv_interactions;
DROP POLICY IF EXISTS "anon_delete_vv_interactions" ON public.vv_interactions;
DROP POLICY IF EXISTS "own_select_vv_interactions"  ON public.vv_interactions;
DROP POLICY IF EXISTS "own_insert_vv_interactions"  ON public.vv_interactions;
DROP POLICY IF EXISTS "own_update_vv_interactions"  ON public.vv_interactions;
DROP POLICY IF EXISTS "own_delete_vv_interactions"  ON public.vv_interactions;

CREATE POLICY "own_select_vv_interactions" ON public.vv_interactions FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);
CREATE POLICY "own_insert_vv_interactions" ON public.vv_interactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "own_update_vv_interactions" ON public.vv_interactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "own_delete_vv_interactions" ON public.vv_interactions FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

-- --------------------------------------------------------------
-- STEP 7: Funzione migrazione dati storici ('default' => uid reale)
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vv_migrate_default(new_uid TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF new_uid IS DISTINCT FROM auth.uid()::text THEN RETURN false; END IF;
  UPDATE public.notes           SET user_id = new_uid WHERE user_id IS NULL OR user_id = 'default';
  UPDATE public.vv_user_profile SET user_id = new_uid WHERE user_id = 'default';
  UPDATE public.vv_interactions SET user_id = new_uid WHERE user_id = 'default';
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vv_migrate_default(TEXT) TO authenticated;

-- --------------------------------------------------------------
-- Verifica finale
-- --------------------------------------------------------------
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('notes', 'vv_user_profile', 'vv_interactions');
