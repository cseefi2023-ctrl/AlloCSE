-- =============================================================================
--  AlloCSE — mise à jour d'une base existante : espaces, données de l'espace
--  (vider / exemple / export / import) et mode démonstration.
--  À exécuter UNE fois dans le SQL Editor d'une base installée avec une version
--  précédente de schema.sql. Les demandes, comptes et réglages sont conservés.
--  Une nouvelle installation n'en a pas besoin : schema.sql contient déjà tout.
-- =============================================================================

do $$
begin
  if to_regclass('public.commitments') is null or to_regprocedure('public.create_elu_request(jsonb)') is null then
    raise exception 'Base trop ancienne pour cette mise à jour : exécutez reset.sql puis schema.sql (cela efface les données).';
  end if;
end $$;

alter table public.settings add column if not exists is_demo boolean not null default false;
alter table public.settings add column if not exists demo_reset_at timestamptz;

create or replace function private.touch_updated_at() returns trigger language plpgsql as $$
begin
  -- Une date fixée explicitement (import, exemple) est conservée
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.public_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'app_name', s.app_name, 'organisation', s.organisation, 'contact', s.contact,
    'tracking_prefix', s.tracking_prefix, 'categories', to_jsonb(s.categories), 'demo', s.is_demo,
    'elus', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'mandate', e.mandate)
                                       order by e.full_name)
                      from elus e where e.is_active), '[]'::jsonb))
  from settings s where s.id = 1
$$;


-- -----------------------------------------------------------------------------
--  Données de l'espace (administrateurs) : repartir de zéro, exporter, importer,
--  charger l'exemple fourni. Les comptes élus, les réglages et les modèles Word
--  ne sont jamais touchés.
-- -----------------------------------------------------------------------------

create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
end $$;

create or replace function private.is_space_empty() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from requests) and not exists (select 1 from meetings)
     and not exists (select 1 from recurring_points)
$$;

create or replace function private.wipe_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate public.commitments, public.agenda_items, public.recurring_points, public.meetings, public.events,
    public.messages, public.request_viewers, public.requests restart identity;
end $$;

create or replace function public.admin_data_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'requests', (select count(*) from requests), 'meetings', (select count(*) from meetings),
    'commitments', (select count(*) from commitments), 'empty', private.is_space_empty(),
    'is_demo', (select is_demo from settings where id = 1));
end $$;

-- Repartir de zéro : efface demandes, réunions, engagements (confirmation : « EFFACER »)
create or replace function public.admin_wipe_data(p_confirm text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  if coalesce(upper(trim(p_confirm)), '') <> 'EFFACER' then
    raise exception 'Tapez EFFACER pour confirmer.' using errcode = '22023';
  end if;
  perform private.wipe_data();
  return public.admin_data_summary();
end $$;

-- ---------- Exemple fourni : un CSE fictif, avec des dates relatives à aujourd'hui ----------

-- Il y a n jours, à h heures (heure de Paris)
create or replace function private.ago(n int, h int default 10) returns timestamptz language sql stable as $$
  select ((private.today() - n)::timestamp + make_interval(hours => h)) at time zone 'Europe/Paris'
$$;

-- Les écritures faites « maintenant » (now() est fixe dans une transaction) sont datées à ts
create or replace function private.stamp(ts timestamptz) returns void
language sql security definer set search_path = public as $$
  update events set created_at = ts where created_at = now();
  update messages set created_at = ts where created_at = now();
  update commitments set created_at = ts where created_at = now();
$$;

create or replace function private.sample_request(
  k text, temp text, cat text, subj text, descr text, who text, service text, anon boolean, n int,
  prio text default 'normale', s_start date default null, vis boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  insert into requests (tracking_code, kind, temporality, category, subject, description, anonymous,
                        requester_name, requester_service, priority, situation_start, visible_to_all, created_at, updated_at)
  values (private.new_tracking_code(), k, temp, cat, subj, descr, anon, who, service, prio, s_start, vis,
          private.ago(n), private.ago(n))
  returning id into rid;
  insert into events (request_id, label, created_at)
  values (rid, case when k = 'signalement' then 'Signalement déposé' else 'Demande déposée' end, private.ago(n));
  return rid;
end $$;

create or replace function private.sample_meeting(n int, st text) returns meetings
language plpgsql security definer set search_path = public as $$
declare m meetings; d date := private.today() - n; mo text;
begin
  mo := private.month_name(extract(month from d)::int);
  insert into meetings (title, kind, meeting_date, status, created_at)
  values ('CSE ordinaire ' || case when left(mo, 1) in ('a', 'o') then 'd’' else 'de ' end || mo || ' ' || extract(year from d)::int,
          'ordinaire', d, st, private.ago(n + 20))
  returning * into m;
  return m;
end $$;

create or replace function private.sample_fixed_points(m meetings) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; pos int := 0;
begin
  for e in select * from jsonb_array_elements((select odj_fixed_points -> 'debut' from settings where id = 1)) loop
    pos := pos + 1;
    insert into agenda_items (meeting_id, title, wording, position, discussed)
    values (m.id, coalesce(e ->> 'titre', e #>> '{}'), e ->> 'formulation', pos, m.status = 'tenue');
  end loop;
  return pos;
end $$;

-- main : l'élu qui suit les sujets ; other : un second élu (facultatif)
create or replace function private.load_sample(main uuid, other uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t date := private.today();
  fontaine bigint; cheques bigint; cheques2 bigint; samedi bigint; parking bigint; transport bigint; chauffage bigint; nao bigint;
  m1 meetings; m2 meetings; rp bigint; pos int; num text; main_name text;
begin
  select full_name into main_name from elus where id = main;

  -- Demandes et signalements des salariés
  fontaine := private.sample_request('signalement', 'actuel', 'Santé, sécurité (SSCT)', 'Fontaine à eau balisée en zone B',
    'La fontaine à eau de la zone B est balisée et hors service depuis plus d’une semaine. Il faut traverser tout l’atelier pour boire.',
    'Paul Martin', 'Atelier usinage', false, 40, 'haute', t - 48);
  parking := private.sample_request('demande', null, 'Restauration, locaux, parking', 'Places de parking visiteurs occupées',
    'Les places visiteurs sont prises par des véhicules du personnel : les livreurs se garent sur la voie pompiers.',
    'Karim Benali', 'Maintenance', false, 33);
  cheques := private.sample_request('demande', null, 'Activités sociales et culturelles', 'Quand arrivent les chèques cadeaux cette année ?',
    'L’an dernier ils étaient arrivés début décembre. Avez-vous une date pour cette année ?', null, null, true, 20);
  cheques2 := private.sample_request('demande', null, 'Activités sociales et culturelles', 'Chèques cadeaux de fin d’année',
    'Les chèques cadeaux seront-ils reconduits cette année, et pour quel montant ?', 'Sophie Leroy', 'Logistique', false, 12);
  transport := private.sample_request('demande', null, 'Rémunération, primes, avantages', 'Prime de transport pour les intérimaires',
    'Les intérimaires ont-ils droit à la prime de transport comme les salariés ? Je préfère que seuls quelques élus lisent ma demande.',
    'Julie Moreau', 'Production', false, 4, 'normale', null, false);
  samedi := private.sample_request('signalement', 'a_venir', 'Organisation du travail / horaires', 'Travail le samedi demandé sans information du CSE',
    'Notre chef d’équipe nous a demandé de venir travailler samedi prochain. Le CSE a-t-il été informé ?', null, null, true, 3, 'haute', t + 5);
  chauffage := private.sample_request('signalement', 'actuel', 'Conditions de travail', 'Chauffage en panne dans le vestiaire hommes',
    'Le chauffage du vestiaire hommes ne fonctionne plus depuis lundi.', 'Thomas Girard', 'Atelier montage', false, 2, 'haute', t - 2);
  insert into request_viewers (request_id, elu_id) select transport, x from unnest(array[coalesce(other, main)]) x where x is not null;

  -- Question préparée par un élu
  insert into requests (tracking_code, kind, category, subject, description, requester_name, requester_service,
                        origin, created_by, assignee_id, status, created_at, updated_at)
  values (private.new_tracking_code(), 'demande', 'Rémunération, primes, avantages', 'Calendrier des NAO',
          'Demander à la direction le calendrier des négociations annuelles obligatoires et la liste des thèmes abordés.',
          coalesce(main_name, 'Élu CSE'), 'Élu CSE', 'elu', main, main, 'en_cours', private.ago(8), private.ago(8))
  returning id into nao;
  insert into events (request_id, label, created_at)
  values (nao, 'Question saisie par ' || coalesce(main_name, 'un élu') || ' (élu)', private.ago(8));

  -- Tri : sujets, prise en charge, demande associée
  update requests set assignee_id = main where id in (fontaine, parking, cheques) and main is not null;
  perform private.set_status(fontaine, 'en_cours'); perform private.assign_number(fontaine); perform private.stamp(private.ago(39));
  perform private.set_status(parking, 'en_cours'); perform private.assign_number(parking); perform private.stamp(private.ago(31));
  perform private.set_status(cheques, 'en_cours'); num := private.assign_number(cheques); perform private.stamp(private.ago(18));
  update requests set parent_id = cheques where id = cheques2;
  perform private.add_event(cheques2, 'Associée au sujet n° ' || num || ', déjà soulevé par d''autres salariés');
  perform private.set_status(cheques2, 'en_cours'); perform private.stamp(private.ago(11));
  perform private.assign_number(nao); perform private.stamp(private.ago(8, 11));

  -- Réunion passée (tenue) : points fixes, deux sujets traités, point récurrent
  m1 := private.sample_meeting(25, 'tenue');
  pos := private.sample_fixed_points(m1);
  insert into recurring_points (title, wording, kind, start_date)
  values ('Point sur la mutuelle', 'Suivi du contrat santé : cotisations, réclamations, évolutions.', 'ordinaire', m1.meeting_date)
  returning id into rp;
  perform private.inscribe(m1, fontaine, pos + 1, null);
  perform private.inscribe(m1, parking, pos + 2, null);
  perform private.stamp(private.ago(28));
  insert into agenda_items (meeting_id, recurring_id, title, wording, position, discussed, outcome)
  values (m1.id, rp, 'Point sur la mutuelle', 'Suivi du contrat santé : cotisations, réclamations, évolutions.', pos + 3, true,
          'Pas d’évolution des cotisations au 1er janvier.');
  update agenda_items set discussed = true, outcome = 'La direction a commandé une nouvelle fontaine, installation prévue sous trois semaines.'
  where meeting_id = m1.id and request_id = fontaine;
  update agenda_items set discussed = true, outcome = 'Marquage au sol des places visiteurs et rappel des règles par note de service.'
  where meeting_id = m1.id and request_id = parking;
  insert into messages (request_id, author_type, author_id, body, is_answer)
  values (fontaine, 'elu', main, 'Réponse suite à la réunion du ' || private.fr_date(m1.meeting_date) ||
          E' :\n\nLa direction a commandé une nouvelle fontaine, installation prévue sous trois semaines.', true),
         (parking, 'elu', main, 'Réponse suite à la réunion du ' || private.fr_date(m1.meeting_date) ||
          E' :\n\nMarquage au sol des places visiteurs et rappel des règles par note de service.', true);
  perform private.add_event(fontaine, 'Traitée en réunion du ' || private.fr_date(m1.meeting_date) || ' — réponse apportée');
  perform private.add_event(parking, 'Traitée en réunion du ' || private.fr_date(m1.meeting_date) || ' — réponse apportée');
  perform private.set_status(fontaine, 'repondue'); perform private.set_status(parking, 'repondue');
  -- Engagements de la direction : un en retard, un tenu
  insert into commitments (request_id, text, due_date, meeting_id, created_by)
  values (fontaine, 'Installer une nouvelle fontaine à eau en zone B', t - 4, m1.id, main),
         (parking, 'Marquage au sol des places visiteurs', t - 12, m1.id, main);
  perform private.add_event(fontaine, 'Engagement de la direction, délai au ' || private.fr_date(t - 4) || ' : Installer une nouvelle fontaine à eau en zone B');
  perform private.add_event(parking, 'Engagement de la direction, délai au ' || private.fr_date(t - 12) || ' : Marquage au sol des places visiteurs');
  perform private.stamp(private.ago(25, 16));
  update commitments set status = 'tenu', closed_at = private.ago(11) where request_id = parking;
  perform private.add_event(parking, 'Engagement de la direction tenu');
  perform private.stamp(private.ago(11, 15));

  -- Prochaine réunion (planifiée) : points fixes, sujets inscrits, point récurrent repris
  m2 := private.sample_meeting(-10, 'planifiee');
  pos := private.sample_fixed_points(m2);
  perform private.inscribe(m2, cheques, pos + 1, null);
  perform private.inscribe(m2, nao, pos + 2, null);
  insert into agenda_items (meeting_id, recurring_id, title, wording, position)
  values (m2.id, rp, 'Point sur la mutuelle', 'Suivi du contrat santé : cotisations, réclamations, évolutions.', pos + 3);
  perform private.stamp(private.ago(1));

  -- Dernière activité de chaque demande
  update requests r set updated_at = x.last
  from (select q.id, coalesce((select max(e.created_at) from events e where e.request_id = q.id), q.created_at) last
        from requests q) x
  where x.id = r.id and r.updated_at is distinct from x.last;
end $$;

-- Charger l'exemple fourni dans un espace vide
create or replace function public.admin_load_sample() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare other uuid;
begin
  perform private.require_admin();
  if not private.is_space_empty() then
    raise exception 'L''espace contient déjà des données : videz-le d''abord.' using errcode = '22023';
  end if;
  select id into other from elus where is_active and id <> auth.uid() order by validated_at nulls last, created_at limit 1;
  perform private.load_sample(auth.uid(), other);
  return public.admin_data_summary();
end $$;

-- ---------- Export / import d'un jeu de données (fichier .json) ----------

create or replace function private.email_of(uid uuid) returns text language sql stable security definer set search_path = public as $$
  select email from elus where id = uid
$$;
create or replace function private.elu_by_email(mail text) returns uuid language sql stable security definer set search_path = public as $$
  select id from elus where email = lower(mail)
$$;

-- Tout le contenu de l'espace ; les élus sont désignés par leur e-mail
create or replace function public.admin_export_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'format', 'allocse', 'version', 1, 'exported_at', now(),
    'organisation', (select organisation from settings where id = 1),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) - 'assignee_id' - 'created_by' || jsonb_build_object(
                   'assignee_email', private.email_of(r.assignee_id), 'created_by_email', private.email_of(r.created_by),
                   'viewer_emails', (select coalesce(jsonb_agg(private.email_of(v.elu_id)), '[]') from request_viewers v where v.request_id = r.id))
                   order by r.id) from requests r), '[]'),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) - 'author_id' || jsonb_build_object('author_email', private.email_of(m.author_id))
                   order by m.id) from messages m), '[]'),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'elu_id' || jsonb_build_object('elu_email', private.email_of(e.elu_id))
                   order by e.id) from events e), '[]'),
    'meetings', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from meetings m), '[]'),
    'recurring_points', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from recurring_points p), '[]'),
    'agenda_items', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from agenda_items a), '[]'),
    'commitments', coalesce((select jsonb_agg(to_jsonb(c) - 'created_by' || jsonb_build_object('created_by_email', private.email_of(c.created_by))
                   order by c.id) from commitments c), '[]'));
end $$;

-- Import dans un espace vide. p_shift : décale toutes les dates de l'écart entre l'export et aujourd'hui
create or replace function public.admin_import_data(p jsonb, p_shift boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  delta interval := '0';
  days int := 0;
  x jsonb;
  r requests; m meetings; rp recurring_points; a agenda_items; c commitments; msg messages; ev events;
  viewers uuid[];
begin
  perform private.require_admin();
  if coalesce(p ->> 'format', '') <> 'allocse' then
    raise exception 'Ce fichier n''est pas un export AlloCSE.' using errcode = '22023';
  end if;
  if not private.is_space_empty() then
    raise exception 'L''espace contient déjà des données : videz-le d''abord.' using errcode = '22023';
  end if;
  if p_shift and p ->> 'exported_at' is not null then
    days := private.today() - ((p ->> 'exported_at')::timestamptz at time zone 'Europe/Paris')::date;
    delta := make_interval(days => days);
  end if;

  for x in select * from jsonb_array_elements(coalesce(p -> 'meetings', '[]')) loop
    m := jsonb_populate_record(null::meetings, x);
    m.meeting_date := m.meeting_date + days; m.created_at := m.created_at + delta;
    insert into meetings overriding system value select (m).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'recurring_points', '[]')) loop
    rp := jsonb_populate_record(null::recurring_points, x);
    rp.start_date := rp.start_date + days; rp.end_date := rp.end_date + days; rp.created_at := rp.created_at + delta;
    insert into recurring_points overriding system value select (rp).*;
  end loop;
  -- Demandes : d'abord sans lien de sujet, puis les associations
  for x in select * from jsonb_array_elements(coalesce(p -> 'requests', '[]')) loop
    r := jsonb_populate_record(null::requests, x);
    r.parent_id := null;
    r.assignee_id := private.elu_by_email(x ->> 'assignee_email');
    r.created_by := private.elu_by_email(x ->> 'created_by_email');
    r.created_at := r.created_at + delta; r.updated_at := r.updated_at + delta;
    r.situation_start := r.situation_start + days; r.situation_end := r.situation_end + days; r.due_date := r.due_date + days;
    insert into requests overriding system value select (r).*;
    if not r.visible_to_all then
      select array_agg(distinct u) into viewers from (
        select private.elu_by_email(e) u from jsonb_array_elements_text(coalesce(x -> 'viewer_emails', '[]')) e) s where u is not null;
      -- Aucun élu destinataire retrouvé : l'administrateur qui importe la reçoit, pour qu'elle ne soit pas perdue
      insert into request_viewers (request_id, elu_id) select r.id, unnest(coalesce(viewers, array[auth.uid()]));
    end if;
  end loop;
  update requests q set parent_id = (j.v ->> 'parent_id')::bigint
  from jsonb_array_elements(coalesce(p -> 'requests', '[]')) j(v)
  where q.id = (j.v ->> 'id')::bigint and j.v ->> 'parent_id' is not null;
  for x in select * from jsonb_array_elements(coalesce(p -> 'messages', '[]')) loop
    msg := jsonb_populate_record(null::messages, x);
    msg.author_id := private.elu_by_email(x ->> 'author_email'); msg.created_at := msg.created_at + delta;
    insert into messages overriding system value select (msg).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'events', '[]')) loop
    ev := jsonb_populate_record(null::events, x);
    ev.elu_id := private.elu_by_email(x ->> 'elu_email'); ev.created_at := ev.created_at + delta;
    insert into events overriding system value select (ev).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'agenda_items', '[]')) loop
    a := jsonb_populate_record(null::agenda_items, x);
    insert into agenda_items overriding system value select (a).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'commitments', '[]')) loop
    c := jsonb_populate_record(null::commitments, x);
    c.created_by := private.elu_by_email(x ->> 'created_by_email');
    c.due_date := c.due_date + days; c.created_at := c.created_at + delta; c.closed_at := c.closed_at + delta;
    insert into commitments overriding system value select (c).*;
  end loop;

  -- Les compteurs reprennent après les identifiants importés
  perform setval(pg_get_serial_sequence('public.requests', 'id'), (select coalesce(max(id), 0) + 1 from requests), false);
  perform setval(pg_get_serial_sequence('public.messages', 'id'), (select coalesce(max(id), 0) + 1 from messages), false);
  perform setval(pg_get_serial_sequence('public.events', 'id'), (select coalesce(max(id), 0) + 1 from events), false);
  perform setval(pg_get_serial_sequence('public.meetings', 'id'), (select coalesce(max(id), 0) + 1 from meetings), false);
  perform setval(pg_get_serial_sequence('public.recurring_points', 'id'), (select coalesce(max(id), 0) + 1 from recurring_points), false);
  perform setval(pg_get_serial_sequence('public.agenda_items', 'id'), (select coalesce(max(id), 0) + 1 from agenda_items), false);
  perform setval(pg_get_serial_sequence('public.commitments', 'id'), (select coalesce(max(id), 0) + 1 from commitments), false);
  return public.admin_data_summary();
end $$;


grant execute on function public.admin_data_summary(), public.admin_wipe_data(text), public.admin_load_sample(),
  public.admin_export_data(), public.admin_import_data(jsonb, boolean) to authenticated;
revoke execute on function public.admin_data_summary(), public.admin_wipe_data(text), public.admin_load_sample(),
  public.admin_export_data(), public.admin_import_data(jsonb, boolean) from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.request_summary(public.requests), private.elu_json(uuid),
  private.subject_number_of(public.requests) to authenticated;
