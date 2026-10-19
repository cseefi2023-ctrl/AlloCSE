set client_min_messages = warning;
-- =============================================================================
--  AlloCSE — remise à zéro (ATTENTION : efface toutes les demandes et réunions)
--  À utiliser seulement si une version précédente de schema.sql a déjà été
--  exécutée, avant de relancer schema.sql. Les comptes de connexion Supabase
--  (Authentication > Users) sont conservés mais devront être revalidés :
--  supprimez-les aussi pour que votre compte redevienne le premier (admin).
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists allocse_modeles_read on storage.objects;
    drop policy if exists allocse_modeles_insert on storage.objects;
    drop policy if exists allocse_modeles_update on storage.objects;
    drop policy if exists allocse_modeles_delete on storage.objects;
  end if;
end $$;

do $$
begin
  if to_regnamespace('cron') is not null and exists (select 1 from cron.job where jobname = 'allocse-notifications') then
    perform cron.unschedule('allocse-notifications');
  end if;
end $$;

drop table if exists public.notifications, public.request_notify, public.commitments, public.agenda_items,
  public.recurring_points, public.meetings, public.events, public.messages, public.request_viewers, public.requests,
  public.subject_events, public.subject_notes, public.subject_viewers, public.subjects,
  public.elus, public.settings cascade;

-- Toutes les fonctions AlloCSE du schéma public (celles des extensions ne sont pas touchées)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;
end $$;

drop schema if exists private cascade;
