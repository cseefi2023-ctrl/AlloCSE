-- AlloCSE 3.4 : « À trier » inclut les demandes sans sujet déjà en cours d'échange (pas encore répondues)

create or replace function public.search_requests(p jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(private.request_summary(r) order by r.updated_at desc, r.id desc), '[]'::jsonb)
  from (
    select * from requests r
    where (p -> 'status' is null or jsonb_typeof(p -> 'status') <> 'array' or jsonb_array_length(p -> 'status') = 0
           or r.status in (select jsonb_array_elements_text(p -> 'status')))
      and (not coalesce((p ->> 'open_only')::boolean, false) or r.status <> 'close')
      -- À trier : pas de sujet et pas encore de réponse (même si un élu a déjà échangé avec le salarié)
      and (not coalesce((p ->> 'to_triage')::boolean, false) or (r.subject_id is null and r.status in ('nouvelle', 'en_cours')))
      and (not coalesce((p ->> 'without_subject')::boolean, false) or r.subject_id is null)
      and (nullif(p ->> 'kind', '') is null or r.kind = p ->> 'kind')
      and (not coalesce((p ->> 'mine')::boolean, false) or r.assignee_id = auth.uid())
      and (nullif(trim(p ->> 'q'), '') is null or
           r.subject ilike '%' || trim(p ->> 'q') || '%' or r.description ilike '%' || trim(p ->> 'q') || '%' or
           r.tracking_code ilike '%' || trim(p ->> 'q') || '%' or r.category ilike '%' || trim(p ->> 'q') || '%')
    order by r.updated_at desc, r.id desc
    limit 500
  ) r
$$;

create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare nxt meetings;
begin
  perform private.require_elu();
  select * into nxt from meetings where status = 'planifiee' and meeting_date >= private.today()
  order by meeting_date limit 1;
  return jsonb_build_object(
    'by_status', (select jsonb_object_agg(st, (select count(*) from requests r
                                               where r.status = st and public.can_see_request(r.id)))
                  from unnest(array['nouvelle', 'en_cours', 'inscrite_odj', 'repondue', 'close']) st),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (
                  select r.kind, count(*) n from requests r
                  where r.status <> 'close' and public.can_see_request(r.id) group by r.kind) x), '{}'::jsonb),
    'subjects_by_status', (select jsonb_object_agg(st, (select count(*) from subjects s
                                                         where s.status = st and public.can_see_subject(s.id)))
                           from unnest(array['ouvert', 'inscrit_odj', 'repondu', 'clos']) st),
    'mine', (select count(*) from subjects s where s.assignee_id = auth.uid() and s.status <> 'clos'
             and public.can_see_subject(s.id)),
    'to_triage', (select count(*) from requests r where r.subject_id is null and r.status in ('nouvelle', 'en_cours')
                  and public.can_see_request(r.id)),
    'commitments_late', (select count(*) from commitments c where c.status = 'en_attente'
                         and c.due_date < private.today() and public.can_see_subject(c.subject_id)),
    'next_meeting', case when nxt.id is null then null else private.meeting_summary(nxt) end);
end $$;

create or replace function public.preparation() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare kinds jsonb := '[]'::jsonb; used bigint[] := '{}'; k text; nxt meetings;
begin
  perform private.require_elu();
  foreach k in array array['ordinaire', 'extraordinaire'] loop
    select * into nxt from meetings where kind = k and status = 'planifiee' and meeting_date >= private.today()
    order by meeting_date, id limit 1;
    if nxt.id is not null then used := used || nxt.id; end if;
    kinds := kinds || jsonb_build_array(jsonb_build_object(
      'kind', k, 'next', case when nxt.id is null then null else private.meeting_prep(nxt) end,
      'suggestion', private.suggest_meeting(k)));
  end loop;
  return jsonb_build_object(
    'kinds', kinds,
    'others', coalesce((select jsonb_agg(private.meeting_prep(m) order by m.meeting_date, m.id) from meetings m
                        where m.status = 'planifiee' and m.meeting_date >= private.today() and not m.id = any (used)),
                       '[]'::jsonb),
    'to_triage', (select count(*) from requests r where r.subject_id is null and r.status in ('nouvelle', 'en_cours')
                  and public.can_see_request(r.id)),
    'pending', jsonb_array_length(private.proposal() -> 'items'));
end $$;
