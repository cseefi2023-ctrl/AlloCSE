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

drop table if exists public.notifications, public.request_notify, public.commitments, public.agenda_items, public.recurring_points, public.meetings, public.events,
  public.messages, public.request_viewers, public.requests, public.elus, public.settings cascade;

drop function if exists public.is_active_elu, public.is_admin, public.can_see_request,
  public.public_config, public.submit_request, public.track_request, public.add_public_message,
  public.search_requests, public.get_request, public.dashboard_stats, public.timeline,
  public.update_request, public.add_message, public.triage, public.untriage,
  public.list_meetings, public.create_meeting, public.get_meeting, public.update_meeting,
  public.delete_meeting, public.preparation, public.propose_agenda, public.add_agenda_item,
  public.generate_agenda, public.update_agenda_item, public.remove_agenda_item, public.reorder_agenda,
  public.meeting_word_data, public.update_my_profile, public.admin_update_elu,
  public.create_elu_request, public.add_commitment, public.update_commitment, public.delete_commitment,
  public.admin_data_summary, public.admin_wipe_data, public.admin_load_sample, public.admin_export_data,
  public.admin_import_data, public.demo_reset, public.admin_notification_status, public.admin_send_test_mail cascade;

drop schema if exists private cascade;
