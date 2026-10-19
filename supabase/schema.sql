-- =============================================================================
--  AlloCSE — schéma Supabase (version 2 : sujets, préparation, récurrents, Gantt, Word)
--  À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
--  (Base déjà créée avec une version précédente : exécuter d'abord reset.sql.)
--
--  Toutes les règles d'accès vivent ici (Row Level Security + fonctions) :
--  la clé publique visible dans la page web ne permet RIEN d'autre que
--  déposer une demande, la suivre avec son numéro et lire la configuration.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
--  Tables
-- -----------------------------------------------------------------------------

create table public.settings (
  id              int primary key default 1 check (id = 1),
  app_name        text not null default 'AlloCSE',
  organisation    text not null default 'EFI Automotive',
  contact         text default 'CSE-EFI@efiautomotive.com',
  tracking_prefix text not null default 'AC' check (tracking_prefix ~ '^[A-Z]{1,4}$'),
  subject_prefix  text not null default 'S' check (subject_prefix ~ '^[A-Z]{1,4}$'),
  categories      text[] not null default array[
    'Conditions de travail',
    'Santé, sécurité (SSCT)',
    'Organisation du travail / horaires',
    'Rémunération, primes, avantages',
    'Formation, carrière',
    'Activités sociales et culturelles',
    'Restauration, locaux, parking',
    'Autre'],
  -- Poids utilisés pour proposer l'ordre du jour
  odj_weights     jsonb not null default
    '{"haute": 30, "normale": 10, "basse": 0, "par_jour": 1, "signalement_actuel": 15, "max_points": 15}',
  -- Formulation proposée pour un point de l'ordre du jour.
  -- Variables : {sujet}, {categorie}, {code}, {periode}. Jamais l'identité du demandeur.
  odj_wordings    jsonb not null default jsonb_build_object(
    'demande', 'Le CSE demande à la direction de faire le point sur : {sujet}. Quelles suites entend-elle y donner ?',
    'signalement_actuel', 'Le CSE signale une situation en cours{periode} : {sujet}. Quelles mesures la direction a-t-elle prises ou envisage-t-elle pour y remédier, et dans quel délai ?',
    'signalement_a_venir', 'Le CSE alerte la direction sur une situation à venir{periode} : {sujet}. Quelles mesures de prévention sont prévues ?'),
  -- Points ajoutés par « Générer l'ordre du jour » (une ligne de formulation = un point Word)
  odj_fixed_points jsonb not null default jsonb_build_object(
    'debut', jsonb_build_array(
      jsonb_build_object('titre', 'Approbation des PV précédents',
                         'formulation', 'Approbation des PV des réunions ordinaires des mois précédents.'),
      jsonb_build_object('titre', 'Organisation entreprise',
                         'formulation', E'HSE\nSituation économique et charge de travail\nPoint performance Usine Beynost\nRessources Humaines (effectifs, HS, absentéisme, intérim)')),
    'fin', '[]'::jsonb),
  -- Documents Word (ordre du jour, trame du PV)
  word_settings   jsonb not null default jsonb_build_object(
    'heure_et_lieu', 'à 9h en salle Le Puy',
    'titre_reportes', 'Questions des PV précédents / Sans réponse, En attente ou En complément',
    'titre_questions', 'Questions CSE',
    'sous_titre_categorie', 'Questions {categorie} :',
    'sous_titre_autres', 'Point divers CSE :'),
  -- Base de démonstration (voir demo.sql) : remise à zéro autorisée, comptes de démo
  is_demo         boolean not null default false,
  demo_reset_at   timestamptz
);
insert into public.settings default values;

create table public.elus (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text not null check (char_length(full_name) between 2 and 120),
  mandate      text check (char_length(mandate) <= 120),
  role         text not null default 'elu' check (role in ('elu', 'admin')),
  is_active    boolean not null default false,   -- validé par un administrateur
  validated_at timestamptz,                      -- null = jamais validé (inscription en attente)
  created_at   timestamptz not null default now()
);

create table public.requests (
  id                bigint generated always as identity primary key,
  tracking_code     text not null unique,
  kind              text not null default 'demande' check (kind in ('demande', 'signalement')),
  temporality       text check (temporality in ('actuel', 'a_venir')),
  situation_start   date,                         -- signalement : période, si connue
  situation_end     date,
  category          text not null,
  subject           text not null check (char_length(subject) between 3 and 200),
  description       text not null check (char_length(description) between 5 and 10000),
  anonymous         boolean not null default false,
  requester_name    text check (char_length(requester_name) <= 120),
  requester_email   text check (char_length(requester_email) <= 190),
  requester_service text check (char_length(requester_service) <= 120),
  status            text not null default 'nouvelle'
                    check (status in ('nouvelle', 'en_cours', 'inscrite_odj', 'repondue', 'close')),
  priority          text not null default 'normale' check (priority in ('basse', 'normale', 'haute')),
  visible_to_all    boolean not null default true,
  assignee_id       uuid references public.elus (id) on delete set null,
  due_date          date,                         -- échéance fixée par les élus
  -- Tri : numéro de sujet attribué quand la demande devient un sujet,
  -- ou rattachement à un sujet existant (elle prend alors le numéro de celui-ci)
  subject_number    text unique,
  parent_id         bigint references public.requests (id) on delete set null,
  -- Saisie par un salarié (formulaire public) ou par un élu (question préparée par le CSE)
  origin            text not null default 'salarie' check (origin in ('salarie', 'elu')),
  created_by        uuid references public.elus (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (situation_end is null or situation_start is null or situation_end >= situation_start)
);
create index requests_status_idx on public.requests (status);
create index requests_parent_idx on public.requests (parent_id);

-- Élus autorisés par le demandeur quand visible_to_all = false
create table public.request_viewers (
  request_id  bigint not null references public.requests (id) on delete cascade,
  elu_id      uuid not null references public.elus (id) on delete cascade,
  primary key (request_id, elu_id)
);
create index request_viewers_elu_idx on public.request_viewers (elu_id);

create table public.messages (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.requests (id) on delete cascade,
  author_type text not null check (author_type in ('salarie', 'elu')),
  author_id   uuid references public.elus (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 10000),
  internal    boolean not null default false,   -- note interne aux élus
  is_answer   boolean not null default false,   -- réponse officielle au salarié
  created_at  timestamptz not null default now()
);
create index messages_request_idx on public.messages (request_id);

-- Historique (fil de suivi)
create table public.events (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.requests (id) on delete cascade,
  label       text not null,
  public      boolean not null default true,    -- visible par le salarié
  elu_id      uuid references public.elus (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index events_request_idx on public.events (request_id);

-- Engagements de la direction : réponse avec un délai, suivie jusqu'à ce qu'elle soit tenue
create table public.commitments (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references public.requests (id) on delete cascade,
  text        text not null check (char_length(text) between 3 and 2000),
  due_date    date not null,
  status      text not null default 'en_attente' check (status in ('en_attente', 'tenu', 'non_tenu')),
  meeting_id  bigint,                               -- réunion où l'engagement a été pris (facultatif)
  public      boolean not null default true,        -- visible par le salarié
  created_by  uuid references public.elus (id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index commitments_request_idx on public.commitments (request_id);

create table public.meetings (
  id            bigint generated always as identity primary key,
  title         text not null check (char_length(title) between 3 and 200),
  kind          text not null default 'ordinaire' check (kind in ('ordinaire', 'extraordinaire', 'autre')),
  meeting_date  date not null,
  status        text not null default 'planifiee' check (status in ('planifiee', 'tenue', 'annulee')),
  notes         text,
  created_at    timestamptz not null default now()
);

alter table public.commitments add constraint commitments_meeting_fk
  foreign key (meeting_id) references public.meetings (id) on delete set null;

-- Point libre répété sur les réunions suivantes du même type
create table public.recurring_points (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) <= 200),
  wording     text,
  kind        text not null default 'ordinaire' check (kind in ('ordinaire', 'extraordinaire', 'autre')),
  start_date  date not null,                    -- première réunion où il apparaît
  every       int not null default 1 check (every between 1 and 12),  -- 1 = chaque réunion
  months      int[],                            -- mois concernés ; null = tous
  end_date    date,                             -- plus repris après cette date
  created_at  timestamptz not null default now()
);

create table public.agenda_items (
  id           bigint generated always as identity primary key,
  meeting_id   bigint not null references public.meetings (id) on delete cascade,
  request_id   bigint references public.requests (id) on delete set null,
  title        text check (char_length(title) <= 200),   -- uniquement pour un point libre
  wording      text,                                     -- formulation à l'ordre du jour
  position     int not null default 0,
  outcome      text,                                     -- relevé de décision
  discussed    boolean not null default false,
  recurring_id bigint references public.recurring_points (id) on delete set null,
  unique (meeting_id, request_id)
);
create index agenda_items_meeting_idx on public.agenda_items (meeting_id);
create index agenda_items_request_idx on public.agenda_items (request_id);

-- -----------------------------------------------------------------------------
--  Droits : fonctions d'aide
-- -----------------------------------------------------------------------------

create function public.is_active_elu() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from elus where id = auth.uid() and is_active)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from elus where id = auth.uid() and is_active and role = 'admin')
$$;

-- Le choix du salarié s'impose à tous, administrateurs compris.
create function public.can_see_request(rid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_elu() and exists (
    select 1 from requests r
    where r.id = rid
      and (r.visible_to_all
           or exists (select 1 from request_viewers v where v.request_id = r.id and v.elu_id = auth.uid())))
$$;

create function private.require_elu() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_elu() then
    raise exception 'Accès réservé aux élus dont le compte a été validé.' using errcode = '42501';
  end if;
end $$;

create function private.require_visible(rid bigint) returns public.requests
language plpgsql stable security definer set search_path = public as $$
declare r public.requests;
begin
  perform private.require_elu();
  if rid is null or not public.can_see_request(rid) then
    -- Même message que « inexistante » : on ne révèle pas l'existence de la demande
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;
  select * into r from requests where id = rid;
  return r;
end $$;

-- -----------------------------------------------------------------------------
--  Utilitaires
-- -----------------------------------------------------------------------------

create function private.status_label(s text) returns text language sql immutable as $$
  select case s
    when 'nouvelle' then 'Nouvelle'
    when 'en_cours' then 'En cours d''étude'
    when 'inscrite_odj' then 'Inscrite à l''ordre du jour'
    when 'repondue' then 'Réponse apportée'
    when 'close' then 'Clôturée' end
$$;

create function private.fr_date(d date) returns text language sql immutable as $$
  select to_char(d, 'DD/MM/YYYY')
$$;

create function private.month_name(m int) returns text language sql immutable as $$
  select (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                'septembre', 'octobre', 'novembre', 'décembre'])[m]
$$;

create function private.today() returns date language sql stable as $$
  select (now() at time zone 'Europe/Paris')::date
$$;

create function private.add_event(rid bigint, lbl text, is_public boolean default true) returns void
language sql security definer set search_path = public as $$
  insert into events (request_id, label, public, elu_id) values (rid, lbl, is_public, auth.uid());
$$;

create function private.set_status(rid bigint, new_status text) returns void
language plpgsql security definer set search_path = public as $$
declare old_status text;
begin
  select status into old_status from requests where id = rid for update;
  if old_status is distinct from new_status then
    update requests set status = new_status where id = rid;
    perform private.add_event(rid, 'Statut : ' || private.status_label(new_status));
  end if;
end $$;

-- Les demandes associées suivent le statut de leur sujet
create function private.propagate_status(rid bigint, new_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c bigint;
begin
  for c in select id from requests where parent_id = rid order by id loop
    perform private.set_status(c, new_status);
  end loop;
end $$;

create function private.subject_number_of(r public.requests) returns text
language sql stable security definer set search_path = public as $$
  select case when r.parent_id is null then r.subject_number
              else (select p.subject_number from requests p where p.id = r.parent_id) end
$$;

-- Attribue un numéro de sujet (S-2026-001) à une demande qui devient un sujet
create function private.assign_number(rid bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  cur text;
  prefix text;
  last int;
begin
  select subject_number into cur from requests where id = rid;
  if cur is not null then return cur; end if;
  perform pg_advisory_xact_lock(4243);
  select subject_prefix || '-' || extract(year from private.today())::int || '-' into prefix
  from settings where id = 1;
  select coalesce(max(substr(subject_number, length(prefix) + 1)::int), 0) into last
  from requests where subject_number like prefix || '%' and substr(subject_number, length(prefix) + 1) ~ '^\d+$';
  cur := prefix || lpad((last + 1)::text, 3, '0');
  update requests set subject_number = cur where id = rid;
  perform private.add_event(rid, 'Sujet n° ' || cur);
  return cur;
end $$;

-- Transmet une réponse officielle aux salariés des demandes associées au sujet
create function private.answer_linked(rid bigint, body text, do_close boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c record; num text;
begin
  select subject_number into num from requests where id = rid;
  for c in select id from requests where parent_id = rid and status <> 'close' order by id loop
    insert into messages (request_id, author_type, author_id, body, is_answer)
    values (c.id, 'elu', auth.uid(), body, true);
    perform private.add_event(c.id, 'Réponse du CSE sur le sujet n° ' || coalesce(num, '?'));
    perform private.set_status(c.id, case when do_close then 'close' else 'repondue' end);
    update requests set updated_at = now() where id = c.id;
  end loop;
end $$;

-- « depuis le 12/09/2026 », « du 12/09/2026 au 30/09/2026 »… ou '' si inconnue
create function private.period_label(r public.requests) returns text language sql immutable as $$
  select case
    when r.situation_start is not null and r.situation_end is not null
      then 'du ' || private.fr_date(r.situation_start) || ' au ' || private.fr_date(r.situation_end)
    when r.situation_start is not null and r.temporality = 'a_venir'
      then 'à partir du ' || private.fr_date(r.situation_start)
    when r.situation_start is not null then 'depuis le ' || private.fr_date(r.situation_start)
    when r.situation_end is not null then 'jusqu’au ' || private.fr_date(r.situation_end)
    else '' end
$$;

-- Formulation proposée pour inscrire la demande à l'ordre du jour.
-- N'utilise que le sujet et la catégorie : jamais l'identité du demandeur.
create function private.suggest_wording(r public.requests) returns text
language plpgsql stable security definer set search_path = public as $$
declare tpl text; per text;
begin
  select odj_wordings ->> (case when r.kind = 'signalement'
                                then case when r.temporality = 'a_venir' then 'signalement_a_venir'
                                          else 'signalement_actuel' end
                                else 'demande' end)
  into tpl from settings where id = 1;
  per := private.period_label(r);
  tpl := coalesce(tpl, '{sujet}');
  tpl := replace(tpl, '{sujet}', regexp_replace(trim(r.subject), '\.+$', ''));
  tpl := replace(tpl, '{categorie}', r.category);
  tpl := replace(tpl, '{code}', r.tracking_code);
  tpl := replace(tpl, '{periode}', case when per = '' then '' else ' ' || per end);
  return trim(regexp_replace(tpl, '\{[a-z_]+\}', '', 'g'));
end $$;

-- Numéro de suivi non devinable, ex. AC-2026-7KQ4-X9M2 (~40 bits d'aléa).
create function private.new_tracking_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b bytea := uuid_send(gen_random_uuid());
  idx int[] := array[0, 1, 2, 3, 4, 5, 9, 10];  -- octets purement aléatoires d'un UUID v4
  s text := '';
  i int;
  prefix text;
begin
  select tracking_prefix into prefix from settings where id = 1;
  foreach i in array idx loop
    s := s || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return prefix || '-' || extract(year from private.today())::int || '-'
         || substr(s, 1, 4) || '-' || substr(s, 5, 4);
end $$;

-- Tolère les saisies approximatives : minuscules, espaces, tirets oubliés
create function private.normalize_code(code text) returns text
language plpgsql stable security definer set search_path = public as $$
declare c text; prefix text; rest text;
begin
  c := upper(regexp_replace(coalesce(code, ''), '\s', '', 'g'));
  c := replace(c, '_', '-');
  if position('-' in c) = 0 then
    select tracking_prefix into prefix from settings where id = 1;
    rest := case when left(c, length(prefix)) = prefix then substr(c, length(prefix) + 1) else c end;
    if length(rest) = 12 then
      c := prefix || '-' || substr(rest, 1, 4) || '-' || substr(rest, 5, 4) || '-' || substr(rest, 9, 4);
    end if;
  end if;
  return c;
end $$;

create function private.touch_updated_at() returns trigger language plpgsql as $$
begin
  -- Une date fixée explicitement (import, exemple) est conservée
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger requests_updated_at before update on public.requests
  for each row execute function private.touch_updated_at();

-- Chaque compte créé (inscription) devient une fiche élu « en attente ».
-- Le tout premier compte devient administrateur, déjà validé.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_one boolean;
begin
  perform pg_advisory_xact_lock(4242);
  select not exists (select 1 from elus) into first_one;
  insert into elus (id, email, full_name, mandate, role, is_active, validated_at)
  values (
    new.id, lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'mandate'), ''),
    case when first_one then 'admin' else 'elu' end,
    first_one,
    case when first_one then now() end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
--  Représentations JSON (mêmes formes que l'API de la version serveur)
-- -----------------------------------------------------------------------------

create function private.elu_json(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'mandate', e.mandate) from elus e where e.id = uid
$$;

create function private.request_summary(r public.requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'tracking_code', r.tracking_code, 'kind', r.kind, 'temporality', r.temporality,
    'situation_start', r.situation_start, 'situation_end', r.situation_end,
    'category', r.category, 'subject', r.subject, 'status', r.status, 'priority', r.priority,
    'anonymous', r.anonymous, 'requester_name', r.requester_name, 'visible_to_all', r.visible_to_all,
    'assignee', private.elu_json(r.assignee_id), 'due_date', r.due_date,
    'number', private.subject_number_of(r), 'parent_id', r.parent_id, 'origin', r.origin,
    'linked_count', (select count(*) from requests c where c.parent_id = r.id),
    'created_at', r.created_at, 'updated_at', r.updated_at)
$$;

create function private.meeting_summary(m public.meetings) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'meeting_date', m.meeting_date,
                            'status', m.status,
                            'item_count', (select count(*) from agenda_items a where a.meeting_id = m.id))
$$;

create function private.commitment_json(c public.commitments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'request_id', c.request_id, 'text', c.text, 'due_date', c.due_date,
    'status', c.status, 'public', c.public, 'created_at', c.created_at, 'closed_at', c.closed_at,
    'late', c.status = 'en_attente' and c.due_date < private.today(),
    'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'meeting_date', m.meeting_date)
                from meetings m where m.id = c.meeting_id),
    'created_by', private.elu_json(c.created_by))
$$;

-- Engagements d'un sujet : ceux de la demande et, pour une demande associée, ceux de son sujet
create function private.commitments_of(rid bigint, only_public boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.commitment_json(c) order by c.due_date, c.id), '[]'::jsonb)
  from commitments c
  where (c.request_id = rid or c.request_id = (select parent_id from requests where id = rid))
    and (not only_public or c.public)
$$;

create function private.request_detail(rid bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r requests; p requests;
begin
  r := private.require_visible(rid);
  select * into p from requests where id = r.parent_id;
  return private.request_summary(r) || jsonb_build_object(
    'parent', case when p.id is not null and public.can_see_request(p.id) then private.request_summary(p) end,
    'linked', coalesce((select jsonb_agg(private.request_summary(c) order by c.id)
                        from requests c where c.parent_id = r.id and public.can_see_request(c.id)), '[]'::jsonb),
    'linked_hidden', (select count(*) from requests c where c.parent_id = r.id and not public.can_see_request(c.id)),
    'description', r.description,
    'created_by', private.elu_json(r.created_by),
    'commitments', private.commitments_of(r.id),
    -- Anonyme : aucune donnée d'identité
    'requester_email', case when r.anonymous then null else r.requester_email end,
    'requester_service', r.requester_service,
    'viewers', coalesce((select jsonb_agg(private.elu_json(v.elu_id) order by e.full_name)
                         from request_viewers v join elus e on e.id = v.elu_id where v.request_id = r.id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', m.id, 'author_type', m.author_type, 'author', private.elu_json(m.author_id),
                            'body', m.body, 'internal', m.internal, 'is_answer', m.is_answer, 'created_at', m.created_at)
                            order by m.created_at, m.id)
                          from messages m where m.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', ev.id, 'label', ev.label, 'public', ev.public, 'created_at', ev.created_at,
                          'user', private.elu_json(ev.elu_id)) order by ev.created_at, ev.id)
                        from events ev where ev.request_id = r.id), '[]'::jsonb),
    'agenda', coalesce((select jsonb_agg(jsonb_build_object(
                          'meeting_id', mt.id, 'meeting_title', mt.title, 'meeting_date', mt.meeting_date,
                          'discussed', a.discussed, 'outcome', a.outcome) order by mt.meeting_date)
                        from agenda_items a join meetings mt on mt.id = a.meeting_id where a.request_id = r.id), '[]'::jsonb));
end $$;

create function private.recurrence_json(rp_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('every', rp.every, 'months', to_jsonb(coalesce(rp.months, '{}'::int[])),
                            'end_date', rp.end_date)
  from recurring_points rp where rp.id = rp_id
$$;

create function private.item_json(a public.agenda_items) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r requests;
begin
  if a.request_id is not null then
    select * into r from requests where id = a.request_id;
    if not public.can_see_request(r.id) then
      -- L'élu voit qu'un point existe, jamais son contenu
      return jsonb_build_object('id', a.id, 'position', a.position, 'restricted', true,
        'title', 'Point à accès restreint (choix du demandeur)', 'request_id', null, 'tracking_code', null,
        'kind', null, 'temporality', null, 'category', null, 'status', null, 'number', null,
        'linked_count', 0, 'recurring', false, 'recurrence', null, 'wording', null,
        'suggested_wording', null, 'outcome', null, 'discussed', a.discussed);
    end if;
    return jsonb_build_object('id', a.id, 'position', a.position, 'restricted', false, 'title', r.subject,
      'request_id', r.id, 'tracking_code', r.tracking_code, 'kind', r.kind, 'temporality', r.temporality,
      'category', r.category, 'status', r.status, 'number', private.subject_number_of(r),
      'linked_count', (select count(*) from requests c where c.parent_id = r.id),
      'recurring', false, 'recurrence', null, 'wording', a.wording,
      'suggested_wording', private.suggest_wording(r), 'outcome', a.outcome, 'discussed', a.discussed);
  end if;
  return jsonb_build_object('id', a.id, 'position', a.position, 'restricted', false, 'title', a.title,
    'request_id', null, 'tracking_code', null, 'kind', null, 'temporality', null, 'category', null,
    'status', null, 'number', null, 'linked_count', 0,
    'recurring', a.recurring_id is not null, 'recurrence', private.recurrence_json(a.recurring_id),
    'wording', a.wording, 'suggested_wording', null, 'outcome', a.outcome, 'discussed', a.discussed);
end $$;

create function private.meeting_detail(mid bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m meetings;
begin
  perform private.require_elu();
  select * into m from meetings where id = mid;
  if m.id is null then raise exception 'Réunion introuvable.' using errcode = 'P0002'; end if;
  return private.meeting_summary(m) || jsonb_build_object('notes', m.notes,
    'items', coalesce((select jsonb_agg(private.item_json(a) order by a.position, a.id)
                       from agenda_items a where a.meeting_id = m.id), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
--  Row Level Security
-- -----------------------------------------------------------------------------

alter table public.settings         enable row level security;
alter table public.elus             enable row level security;
alter table public.requests         enable row level security;
alter table public.request_viewers  enable row level security;
alter table public.messages         enable row level security;
alter table public.events           enable row level security;
alter table public.meetings         enable row level security;
alter table public.recurring_points enable row level security;
alter table public.agenda_items     enable row level security;
alter table public.commitments      enable row level security;

-- Les salariés lisent la configuration via public_config() uniquement
create policy settings_read  on public.settings for select to authenticated using (public.is_active_elu());
create policy settings_admin on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Un élu en attente ne voit que sa propre fiche
create policy elus_read on public.elus for select to authenticated
  using (public.is_active_elu() or id = auth.uid());

create policy requests_read on public.requests for select to authenticated
  using (public.can_see_request(id));
create policy viewers_read on public.request_viewers for select to authenticated
  using (public.can_see_request(request_id));
create policy messages_read on public.messages for select to authenticated
  using (public.can_see_request(request_id));
create policy events_read on public.events for select to authenticated
  using (public.can_see_request(request_id));
create policy meetings_read on public.meetings for select to authenticated using (public.is_active_elu());
create policy commitments_read on public.commitments for select to authenticated
  using (public.can_see_request(request_id));
-- agenda_items, recurring_points : aucune politique, accès uniquement via les fonctions
-- (les points à accès restreint y sont masqués). Écritures : uniquement via les fonctions.

revoke all on all tables in schema public from anon, authenticated;
grant select on public.settings, public.elus, public.requests, public.request_viewers, public.messages,
  public.events, public.meetings, public.commitments to authenticated;
grant update (organisation, contact, categories, odj_weights, odj_wordings, odj_fixed_points, word_settings)
  on public.settings to authenticated;

-- -----------------------------------------------------------------------------
--  Salariés (sans compte)
-- -----------------------------------------------------------------------------

create function public.public_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'app_name', s.app_name, 'organisation', s.organisation, 'contact', s.contact,
    'tracking_prefix', s.tracking_prefix, 'categories', to_jsonb(s.categories), 'demo', s.is_demo,
    'elus', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'mandate', e.mandate)
                                       order by e.full_name)
                      from elus e where e.is_active), '[]'::jsonb))
  from settings s where s.id = 1
$$;

create function private.public_view(rid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tracking_code', r.tracking_code, 'kind', r.kind, 'temporality', r.temporality,
    'situation_start', r.situation_start, 'situation_end', r.situation_end,
    'category', r.category, 'subject', r.subject, 'description', r.description,
    'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at,
    'visible_to_all', r.visible_to_all,
    'viewers', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name) order by e.full_name)
                         from request_viewers v join elus e on e.id = v.elu_id where v.request_id = r.id), '[]'::jsonb),
    'commitments', coalesce((select jsonb_agg(jsonb_build_object('text', x ->> 'text', 'due_date', x -> 'due_date',
                                                                 'status', x ->> 'status') order by x ->> 'due_date')
                             from jsonb_array_elements(private.commitments_of(r.id, true)) x), '[]'::jsonb),
    -- Le salarié ne voit ni les notes internes ni les événements internes
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'label', ev.label, 'public', true,
                                                            'created_at', ev.created_at) order by ev.created_at, ev.id)
                        from events ev where ev.request_id = r.id and ev.public), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', m.id, 'author_type', m.author_type, 'body', m.body, 'internal', false,
                            'is_answer', m.is_answer, 'created_at', m.created_at,
                            'author', case when e.id is null then null else jsonb_build_object('full_name', e.full_name) end)
                            order by m.created_at, m.id)
                          from messages m left join elus e on e.id = m.author_id
                          where m.request_id = r.id and not m.internal), '[]'::jsonb))
  from requests r where r.id = rid
$$;

-- Dépôt : p = { kind, temporality, situation_start, situation_end, category, subject, description,
--               anonymous, requester_name, requester_email, requester_service, visible_to_all, viewer_ids }
create function public.submit_request(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  rid bigint;
  code text;
  viewers uuid[];
  attempts int := 0;
  k text := coalesce(p ->> 'kind', 'demande');
  anon boolean := coalesce((p ->> 'anonymous')::boolean, false);
  vis boolean := coalesce((p ->> 'visible_to_all')::boolean, true);
  s_start date;
  s_end date;
  email text := nullif(lower(trim(p ->> 'requester_email')), '');
begin
  if k not in ('demande', 'signalement') then
    raise exception 'Type de demande invalide.' using errcode = '22023';
  end if;
  if not exists (select 1 from settings where id = 1 and (p ->> 'category') = any (categories)) then
    raise exception 'Choisissez un thème dans la liste.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'subject', ''))) < 3 then
    raise exception 'Donnez un objet d''au moins 3 caractères.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'description', ''))) < 5 then
    raise exception 'Décrivez la situation en quelques mots.' using errcode = '22023';
  end if;
  if email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'L''adresse e-mail ne semble pas valide.' using errcode = '22023';
  end if;
  if k = 'signalement' then
    s_start := nullif(p ->> 'situation_start', '')::date;
    s_end := nullif(p ->> 'situation_end', '')::date;
    if s_start is not null and s_end is not null and s_end < s_start then
      raise exception 'La fin de la situation ne peut pas précéder son début.' using errcode = '22023';
    end if;
  end if;
  if not vis then
    select array_agg(e.id) into viewers from elus e
    where e.is_active and e.id::text in (select jsonb_array_elements_text(coalesce(p -> 'viewer_ids', '[]'::jsonb)));
    if viewers is null then
      raise exception 'Choisissez au moins un élu pouvant voir la demande.' using errcode = '22023';
    end if;
  end if;

  loop
    attempts := attempts + 1;
    code := private.new_tracking_code();
    begin
      insert into requests (tracking_code, kind, temporality, situation_start, situation_end, category, subject,
                            description, anonymous, requester_name, requester_email, requester_service, visible_to_all)
      values (code, k,
              case when k = 'signalement' then coalesce(nullif(p ->> 'temporality', ''), 'actuel') end,
              s_start, s_end, p ->> 'category', trim(p ->> 'subject'), trim(p ->> 'description'), anon,
              -- Anonyme : aucune donnée d'identité n'est enregistrée
              case when anon then null else nullif(trim(p ->> 'requester_name'), '') end,
              case when anon then null else email end,
              case when anon then null else nullif(trim(p ->> 'requester_service'), '') end,
              vis)
      returning id into rid;
      exit;
    exception when unique_violation then
      if attempts >= 5 then raise; end if;
    end;
  end loop;

  if viewers is not null then
    insert into request_viewers (request_id, elu_id) select rid, unnest(viewers);
  end if;
  insert into events (request_id, label)
  values (rid, case when k = 'signalement' then 'Signalement déposé' else 'Demande déposée' end);
  return jsonb_build_object('tracking_code', code,
    'message', 'Conservez précieusement ce numéro : il est le seul moyen de suivre votre demande et de lire la réponse du CSE.');
end $$;

create function public.track_request(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select private.public_view(id) from requests where tracking_code = private.normalize_code(p_code)
$$;

create function public.add_public_message(p_code text, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r requests;
begin
  select * into r from requests where tracking_code = private.normalize_code(p_code);
  if r.id is null then
    raise exception 'Aucune demande ne correspond à ce numéro de suivi.' using errcode = 'P0002';
  end if;
  if r.status = 'close' then
    raise exception 'Cette demande est clôturée. Déposez une nouvelle demande si besoin.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Le message est vide.' using errcode = '22023';
  end if;
  insert into messages (request_id, author_type, body) values (r.id, 'salarie', trim(p_body));
  insert into events (request_id, label) values (r.id, 'Complément apporté par le salarié');
  if r.status = 'repondue' then
    perform private.set_status(r.id, 'en_cours');
  end if;
  update requests set updated_at = now() where id = r.id;
  return private.public_view(r.id);
end $$;

-- -----------------------------------------------------------------------------
--  Élus — demandes
-- -----------------------------------------------------------------------------

-- Filtres : { status: [..], kind, q, mine, open_only, to_triage }. Droits de l'élu (RLS).
create function public.search_requests(p jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(private.request_summary(r) order by r.updated_at desc, r.id desc), '[]'::jsonb)
  from (
    select * from requests r
    where (p -> 'status' is null or jsonb_typeof(p -> 'status') <> 'array' or jsonb_array_length(p -> 'status') = 0
           or r.status in (select jsonb_array_elements_text(p -> 'status')))
      and (not coalesce((p ->> 'open_only')::boolean, false) or r.status <> 'close')
      and (not coalesce((p ->> 'to_triage')::boolean, false)
           or (r.subject_number is null and r.parent_id is null and r.status <> 'close'))
      and (nullif(p ->> 'kind', '') is null or r.kind = p ->> 'kind')
      and (not coalesce((p ->> 'mine')::boolean, false) or r.assignee_id = auth.uid())
      and (nullif(trim(p ->> 'q'), '') is null or
           r.subject ilike '%' || trim(p ->> 'q') || '%' or r.description ilike '%' || trim(p ->> 'q') || '%' or
           r.tracking_code ilike '%' || trim(p ->> 'q') || '%' or r.category ilike '%' || trim(p ->> 'q') || '%' or
           coalesce(r.subject_number, '') ilike '%' || trim(p ->> 'q') || '%')
    order by r.updated_at desc, r.id desc
    limit 500
  ) r
$$;

create function public.get_request(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select private.request_detail(p_id)
$$;

create function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare nxt meetings;
begin
  perform private.require_elu();
  select * into nxt from meetings where status = 'planifiee' and meeting_date >= private.today()
  order by meeting_date limit 1;
  return jsonb_build_object(
    'by_status', (select jsonb_object_agg(s, (select count(*) from requests r
                                              where r.status = s and public.can_see_request(r.id)))
                  from unnest(array['nouvelle', 'en_cours', 'inscrite_odj', 'repondue', 'close']) s),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (
                  select r.kind, count(*) n from requests r
                  where r.status <> 'close' and public.can_see_request(r.id) group by r.kind) x), '{}'::jsonb),
    'mine', (select count(*) from requests r where r.assignee_id = auth.uid() and r.status <> 'close'
             and public.can_see_request(r.id)),
    'to_triage', (select count(*) from requests r where r.subject_number is null and r.parent_id is null
                  and r.status <> 'close' and public.can_see_request(r.id)),
    'commitments_late', (select count(*) from commitments c where c.status = 'en_attente'
                         and c.due_date < private.today() and public.can_see_request(c.request_id)),
    'next_meeting', case when nxt.id is null then null else private.meeting_summary(nxt) end);
end $$;

-- Diagramme de Gantt : sujets ouverts (et répondus si demandé), passages à l'ODJ, réunions
create function public.timeline(p_include_answered boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'request', private.request_summary(r),
        'meetings', coalesce((select jsonb_agg(jsonb_build_object(
                       'meeting_id', m.id, 'title', m.title, 'meeting_date', m.meeting_date,
                       'status', m.status, 'discussed', a.discussed) order by m.meeting_date)
                     from agenda_items a join meetings m on m.id = a.meeting_id where a.request_id = r.id), '[]'::jsonb),
        'answered_at', (select max(mm.created_at) from messages mm where mm.request_id = r.id and mm.is_answer),
        'commitments', private.commitments_of(r.id))
        order by r.created_at)
      from requests r
      where r.parent_id is null and public.can_see_request(r.id)
        and (r.status in ('nouvelle', 'en_cours', 'inscrite_odj') or (p_include_answered and r.status = 'repondue')
             -- un sujet répondu reste suivi tant que la direction n'a pas tenu son engagement
             or exists (select 1 from commitments c where c.request_id = r.id and c.status = 'en_attente'))
    ), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(private.meeting_summary(m) order by m.meeting_date)
                          from meetings m where m.status <> 'annulee'), '[]'::jsonb));
end $$;

-- p : { status, priority, category, assignee_id, take_charge,
--       due_date, situation_start, situation_end (clé présente avec null = effacer) }
create function public.update_request(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests;
  a elus;
  assignee uuid := nullif(p ->> 'assignee_id', '')::uuid;
  new_due date;
  s_start date;
  s_end date;
  per text;
begin
  r := private.require_visible(p_id);
  if coalesce((p ->> 'take_charge')::boolean, false) then assignee := auth.uid(); end if;

  if assignee is not null and assignee is distinct from r.assignee_id then
    select * into a from elus where id = assignee and is_active;
    if a.id is null then
      raise exception 'Élu introuvable.' using errcode = 'P0002';
    end if;
    if not r.visible_to_all and not exists (select 1 from request_viewers where request_id = r.id and elu_id = a.id) then
      raise exception 'Le demandeur n''a pas autorisé cet élu à voir la demande.' using errcode = '42501';
    end if;
    update requests set assignee_id = a.id where id = r.id;
    perform private.add_event(r.id, 'Prise en charge par ' || a.full_name, false);
    if r.status = 'nouvelle' then perform private.set_status(r.id, 'en_cours'); end if;
  end if;

  if nullif(p ->> 'priority', '') is not null and p ->> 'priority' <> r.priority then
    update requests set priority = p ->> 'priority' where id = r.id;
    perform private.add_event(r.id, 'Priorité : ' || (p ->> 'priority'), false);
  end if;
  if nullif(p ->> 'category', '') is not null and p ->> 'category' <> r.category then
    update requests set category = p ->> 'category' where id = r.id;
    perform private.add_event(r.id, 'Catégorie : ' || (p ->> 'category'), false);
  end if;
  if p ? 'due_date' then
    new_due := nullif(p ->> 'due_date', '')::date;
    if new_due is distinct from r.due_date then
      update requests set due_date = new_due where id = r.id;
      perform private.add_event(r.id, case when new_due is null then 'Échéance retirée'
                                           else 'Échéance : ' || private.fr_date(new_due) end, false);
    end if;
  end if;
  if r.kind = 'signalement' and (p ? 'situation_start' or p ? 'situation_end') then
    s_start := case when p ? 'situation_start' then nullif(p ->> 'situation_start', '')::date else r.situation_start end;
    s_end := case when p ? 'situation_end' then nullif(p ->> 'situation_end', '')::date else r.situation_end end;
    if s_start is not null and s_end is not null and s_end < s_start then
      raise exception 'La fin de la situation ne peut pas précéder son début.' using errcode = '22023';
    end if;
    if s_start is distinct from r.situation_start or s_end is distinct from r.situation_end then
      update requests set situation_start = s_start, situation_end = s_end where id = r.id returning * into r;
      per := private.period_label(r);
      perform private.add_event(r.id, 'Période de la situation : ' || coalesce(nullif(per, ''), 'non renseignée'));
    end if;
  end if;
  if nullif(p ->> 'status', '') is not null then
    select status into r.status from requests where id = r.id;
    if p ->> 'status' <> r.status then
      perform private.set_status(r.id, p ->> 'status');
      perform private.propagate_status(r.id, p ->> 'status');
    end if;
  end if;
  return private.request_detail(p_id);
end $$;

-- Réponse possible à tout moment, même si la demande ne passe jamais à l'ordre du jour.
-- p : { body, internal, is_answer, close, also_linked (vrai par défaut) }
create function public.add_message(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests;
  me elus;
  body text := trim(coalesce(p ->> 'body', ''));
  is_internal boolean := coalesce((p ->> 'internal')::boolean, false);
  is_ans boolean := coalesce((p ->> 'is_answer')::boolean, false);
  do_close boolean := coalesce((p ->> 'close')::boolean, false);
begin
  r := private.require_visible(p_id);
  select * into me from elus where id = auth.uid();
  if char_length(body) = 0 then
    raise exception 'Le message est vide.' using errcode = '22023';
  end if;
  if is_internal and is_ans then
    raise exception 'Une réponse au salarié ne peut pas être une note interne.' using errcode = '22023';
  end if;
  if r.status = 'close' and not is_internal then
    raise exception 'Demande clôturée : rouvrez-la avant de répondre.' using errcode = '22023';
  end if;

  insert into messages (request_id, author_type, author_id, body, internal, is_answer)
  values (r.id, 'elu', me.id, body, is_internal, is_ans);

  if is_internal then
    perform private.add_event(r.id, 'Note interne ajoutée', false);
  elsif is_ans then
    perform private.add_event(r.id, 'Réponse du CSE (par ' || me.full_name || ')');
    perform private.set_status(r.id, case when do_close then 'close' else 'repondue' end);
    if coalesce((p ->> 'also_linked')::boolean, true) then
      perform private.answer_linked(r.id, body, do_close);
    end if;
  else
    perform private.add_event(r.id, 'Message du CSE');
    if r.status = 'nouvelle' then perform private.set_status(r.id, 'en_cours'); end if;
  end if;
  update requests set updated_at = now() where id = r.id;
  return private.request_detail(p_id);
end $$;

-- Une demande associée n'a plus sa place propre à l'ordre du jour : son sujet y passe
create function private.release_from_planned(rid bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select ai.id from agenda_items ai join meetings m on m.id = ai.meeting_id
           where ai.request_id = rid and m.status = 'planifiee' and not ai.discussed loop
    delete from agenda_items where id = a.id;
    perform private.add_event(rid, 'Retirée de l''ordre du jour (traitée avec son sujet)', false);
  end loop;
end $$;

-- Décision de tri : nouveau sujet (p_parent_id null), ou association à un sujet existant
create function public.triage(p_id bigint, p_parent_id bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests;
  par requests;
  num text;
  c record;
  target text;
begin
  r := private.require_visible(p_id);
  if p_parent_id is null then
    if r.parent_id is not null then
      perform private.add_event(r.id, 'Dissociée du sujet n° ' ||
        coalesce((select subject_number from requests where id = r.parent_id), '?'));
      update requests set parent_id = null where id = r.id;
    end if;
    perform private.assign_number(r.id);
    if r.status = 'nouvelle' then perform private.set_status(r.id, 'en_cours'); end if;
  else
    par := private.require_visible(p_parent_id);
    if par.parent_id is not null then  -- on associe toujours au sujet principal
      par := private.require_visible(par.parent_id);
    end if;
    if par.id = r.id then
      raise exception 'Une demande ne peut pas être associée à elle-même.' using errcode = '22023';
    end if;
    num := private.assign_number(par.id);
    for c in select id from requests where parent_id = r.id loop  -- ses propres demandes associées suivent
      update requests set parent_id = par.id where id = c.id;
      perform private.add_event(c.id, 'Associée au sujet n° ' || num);
    end loop;
    update requests set parent_id = par.id, subject_number = null where id = r.id;
    perform private.release_from_planned(r.id);
    perform private.add_event(r.id, 'Associée au sujet n° ' || num || ', déjà soulevé par d''autres salariés');
    perform private.add_event(par.id, case when r.visible_to_all then 'Demande ' || r.tracking_code || ' associée à ce sujet'
                                           else 'Une demande à accès restreint a été associée à ce sujet' end, false);
    select status into par.status from requests where id = par.id;
    target := case when par.status in ('en_cours', 'inscrite_odj') then par.status else 'en_cours' end;
    if r.status in ('nouvelle', 'en_cours', 'inscrite_odj') then
      perform private.set_status(r.id, target);
    end if;
  end if;
  return private.request_detail(p_id);
end $$;

-- Dissocier une demande de son sujet : elle redevient « à trier »
create function public.untriage(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r requests;
begin
  r := private.require_visible(p_id);
  if r.parent_id is null then
    raise exception 'Cette demande n''est associée à aucun sujet.' using errcode = '22023';
  end if;
  perform private.add_event(r.id, 'Dissociée du sujet n° ' ||
    coalesce((select subject_number from requests where id = r.parent_id), '?'));
  update requests set parent_id = null where id = r.id;
  return private.request_detail(p_id);
end $$;

-- Question ou signalement préparé par un élu (pour une prochaine réunion, par exemple)
-- p : { kind, temporality, situation_start, situation_end, category, subject, description,
--       visible_to_all, viewer_ids, take_charge (vrai par défaut) }
create function public.create_elu_request(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me elus;
  rid bigint;
  code text;
  attempts int := 0;
  k text := coalesce(p ->> 'kind', 'demande');
  vis boolean := coalesce((p ->> 'visible_to_all')::boolean, true);
  viewers uuid[];
  s_start date;
  s_end date;
begin
  perform private.require_elu();
  select * into me from elus where id = auth.uid();
  if k not in ('demande', 'signalement') then
    raise exception 'Type invalide.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'category', ''))) = 0 then
    raise exception 'Choisissez un thème.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'subject', ''))) < 3 then
    raise exception 'Donnez un objet d''au moins 3 caractères.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'description', ''))) < 5 then
    raise exception 'Décrivez la question en quelques mots.' using errcode = '22023';
  end if;
  if k = 'signalement' then
    s_start := nullif(p ->> 'situation_start', '')::date;
    s_end := nullif(p ->> 'situation_end', '')::date;
    if s_start is not null and s_end is not null and s_end < s_start then
      raise exception 'La fin de la situation ne peut pas précéder son début.' using errcode = '22023';
    end if;
  end if;
  if not vis then
    select array_agg(e.id) into viewers from elus e
    where e.is_active and e.id::text in (select jsonb_array_elements_text(coalesce(p -> 'viewer_ids', '[]'::jsonb)));
    viewers := array(select distinct x from unnest(coalesce(viewers, '{}') || me.id) x);  -- l'auteur la voit toujours
  end if;

  loop
    attempts := attempts + 1;
    code := private.new_tracking_code();
    begin
      insert into requests (tracking_code, kind, temporality, situation_start, situation_end, category, subject,
                            description, anonymous, requester_name, requester_service, visible_to_all, origin, created_by)
      values (code, k, case when k = 'signalement' then coalesce(nullif(p ->> 'temporality', ''), 'actuel') end,
              s_start, s_end, trim(p ->> 'category'), trim(p ->> 'subject'), trim(p ->> 'description'), false,
              me.full_name, coalesce(me.mandate, 'Élu CSE'), vis, 'elu', me.id)
      returning id into rid;
      exit;
    exception when unique_violation then
      if attempts >= 5 then raise; end if;
    end;
  end loop;
  if viewers is not null then
    insert into request_viewers (request_id, elu_id) select rid, unnest(viewers);
  end if;
  perform private.add_event(rid, case when k = 'signalement' then 'Signalement saisi par ' else 'Question saisie par ' end
                                 || me.full_name || ' (élu)');
  if coalesce((p ->> 'take_charge')::boolean, true) then
    update requests set assignee_id = me.id, status = 'en_cours' where id = rid;
  end if;
  return private.request_detail(rid);
end $$;

-- Engagement de la direction sur un sujet : p = { text, due_date, meeting_id, public }
create function public.add_commitment(p_request_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r requests; d date; txt text := trim(coalesce(p ->> 'text', '')); pub boolean := coalesce((p ->> 'public')::boolean, true);
begin
  r := private.require_visible(p_request_id);
  if r.parent_id is not null then  -- l'engagement porte sur le sujet principal
    r := private.require_visible(r.parent_id);
  end if;
  d := nullif(p ->> 'due_date', '')::date;
  if d is null then raise exception 'Indiquez le délai annoncé par la direction.' using errcode = '22023'; end if;
  if char_length(txt) < 3 then raise exception 'Décrivez ce que la direction s''est engagée à faire.' using errcode = '22023'; end if;
  insert into commitments (request_id, text, due_date, meeting_id, public, created_by)
  values (r.id, left(txt, 2000), d, nullif(p ->> 'meeting_id', '')::bigint, pub, auth.uid());
  perform private.add_event(r.id, 'Engagement de la direction, délai au ' || private.fr_date(d) || ' : ' || left(txt, 200), pub);
  update requests set updated_at = now() where id = r.id;
  return private.request_detail(p_request_id);
end $$;

-- p = { status: en_attente | tenu | non_tenu, due_date (report), text }
create function public.update_commitment(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c commitments; d date;
begin
  perform private.require_elu();
  select * into c from commitments where id = p_id;
  if c.id is null or not public.can_see_request(c.request_id) then
    raise exception 'Engagement introuvable.' using errcode = 'P0002';
  end if;
  if nullif(trim(p ->> 'text'), '') is not null and trim(p ->> 'text') <> c.text then
    update commitments set text = left(trim(p ->> 'text'), 2000) where id = c.id;
  end if;
  d := nullif(p ->> 'due_date', '')::date;
  if d is not null and d <> c.due_date then
    update commitments set due_date = d where id = c.id;
    perform private.add_event(c.request_id, 'Délai de l''engagement reporté au ' || private.fr_date(d), c.public);
  end if;
  if nullif(p ->> 'status', '') is not null and p ->> 'status' <> c.status then
    update commitments set status = p ->> 'status',
      closed_at = case when p ->> 'status' = 'en_attente' then null else now() end where id = c.id;
    perform private.add_event(c.request_id, case p ->> 'status'
      when 'tenu' then 'Engagement de la direction tenu'
      when 'non_tenu' then 'Engagement de la direction non tenu'
      else 'Engagement de la direction de nouveau en attente' end, c.public);
  end if;
  update requests set updated_at = now() where id = c.request_id;
  return private.request_detail(c.request_id);
end $$;

create function public.delete_commitment(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c commitments;
begin
  perform private.require_elu();
  select * into c from commitments where id = p_id;
  if c.id is null or not public.can_see_request(c.request_id) then
    raise exception 'Engagement introuvable.' using errcode = 'P0002';
  end if;
  delete from commitments where id = c.id;
  perform private.add_event(c.request_id, 'Engagement de la direction retiré', false);
  return private.request_detail(c.request_id);
end $$;

-- -----------------------------------------------------------------------------
--  Élus — points récurrents
-- -----------------------------------------------------------------------------

-- Vrai si la récurrence de rp retient la réunion m
create function private.applies(rp public.recurring_points, m public.meetings) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare eligible bigint[]; pos int;
begin
  if m.kind <> rp.kind or m.meeting_date < rp.start_date
     or (rp.end_date is not null and m.meeting_date > rp.end_date)
     or (rp.months is not null and cardinality(rp.months) > 0
         and not extract(month from m.meeting_date)::int = any (rp.months)) then
    return false;
  end if;
  if coalesce(rp.every, 1) <= 1 then return true; end if;
  -- Une réunion sur N : rang parmi les réunions retenues depuis le début de la répétition
  select array_agg(o.id order by o.meeting_date, o.id) into eligible
  from meetings o
  where o.kind = rp.kind and o.status <> 'annulee'
    and o.meeting_date >= rp.start_date and o.meeting_date <= m.meeting_date
    and (rp.months is null or cardinality(rp.months) = 0 or extract(month from o.meeting_date)::int = any (rp.months));
  pos := array_position(eligible, m.id);
  return pos is not null and (pos - 1) % rp.every = 0;
end $$;

create function private.apply_rule(rp_id bigint, rule jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ev int; mo int[];
begin
  rule := coalesce(nullif(rule, 'null'::jsonb), '{}'::jsonb);
  ev := coalesce(nullif(rule ->> 'every', '')::int, 1);
  if ev < 1 or ev > 12 then
    raise exception 'Récurrence invalide : entre 1 et 12 réunions.' using errcode = '22023';
  end if;
  select array_agg(distinct x::int order by x::int) into mo
  from jsonb_array_elements_text(coalesce(nullif(rule -> 'months', 'null'::jsonb), '[]'::jsonb)) x;
  if exists (select 1 from unnest(mo) x where x < 1 or x > 12) then
    raise exception 'Mois invalide.' using errcode = '22023';
  end if;
  update recurring_points set every = ev, months = mo, end_date = nullif(rule ->> 'end_date', '')::date
  where id = rp_id;
end $$;

create function private.add_occurrence(rp public.recurring_points, mid bigint) returns void
language sql security definer set search_path = public as $$
  insert into agenda_items (meeting_id, recurring_id, title, wording, position)
  values (mid, rp.id, rp.title, rp.wording,
          (select coalesce(max(position), 0) + 1 from agenda_items where meeting_id = mid));
$$;

-- Met les réunions planifiées après m en accord avec la récurrence
create function private.refresh_recurring(rp_id bigint, m public.meetings) returns void
language plpgsql security definer set search_path = public as $$
declare rp recurring_points; other meetings; occ agenda_items; wanted boolean;
begin
  select * into rp from recurring_points where id = rp_id;
  for other in select * from meetings where kind = m.kind and status = 'planifiee' and meeting_date > m.meeting_date
               order by meeting_date, id loop
    select * into occ from agenda_items where meeting_id = other.id and recurring_id = rp.id limit 1;
    wanted := private.applies(rp, other);
    if wanted and occ.id is null then
      perform private.add_occurrence(rp, other.id);
    elsif not wanted and occ.id is not null and not occ.discussed then
      delete from agenda_items where id = occ.id;
    end if;
  end loop;
end $$;

create function private.start_recurring(m public.meetings, item_id bigint, rule jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it agenda_items; rp_id bigint;
begin
  select * into it from agenda_items where id = item_id;
  insert into recurring_points (title, wording, kind, start_date)
  values (it.title, it.wording, m.kind, m.meeting_date) returning id into rp_id;
  perform private.apply_rule(rp_id, rule);
  update agenda_items set recurring_id = rp_id where id = item_id;
  perform private.refresh_recurring(rp_id, m);
end $$;

-- Arrête la répétition : retiré des réunions planifiées suivantes, conservé ailleurs
create function private.stop_recurring(m public.meetings, rp_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from agenda_items a using meetings o
  where a.meeting_id = o.id and a.recurring_id = rp_id and not a.discussed
    and o.kind = m.kind and o.status = 'planifiee' and o.meeting_date > m.meeting_date;
  update agenda_items set recurring_id = null where recurring_id = rp_id;
  delete from recurring_points where id = rp_id;
end $$;

-- Reporte un nouvel intitulé ou une nouvelle formulation sur les réunions suivantes
create function private.sync_recurring(m public.meetings, it public.agenda_items, old_title text, old_wording text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if it.recurring_id is null or (it.title is not distinct from old_title and it.wording is not distinct from old_wording) then
    return;
  end if;
  update recurring_points set title = it.title, wording = it.wording where id = it.recurring_id;
  update agenda_items a set title = it.title, wording = it.wording
  from meetings o
  where a.meeting_id = o.id and a.recurring_id = it.recurring_id and not a.discussed
    and o.kind = m.kind and o.status = 'planifiee' and o.meeting_date > m.meeting_date
    and a.title is not distinct from old_title and a.wording is not distinct from old_wording;  -- non retouchée
end $$;

-- -----------------------------------------------------------------------------
--  Élus — réunions et ordre du jour
-- -----------------------------------------------------------------------------

create function public.list_meetings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  return coalesce((select jsonb_agg(private.meeting_summary(m) order by m.meeting_date desc, m.id desc)
                   from meetings m), '[]'::jsonb);
end $$;

-- p : { title, kind, meeting_date, notes }. Reprend les points récurrents qui s'appliquent.
create function public.create_meeting(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare m meetings; rp recurring_points; pos int := 0;
begin
  perform private.require_elu();
  if char_length(trim(coalesce(p ->> 'title', ''))) < 3 then
    raise exception 'Donnez un intitulé d''au moins 3 caractères.' using errcode = '22023';
  end if;
  if nullif(p ->> 'meeting_date', '') is null then
    raise exception 'Indiquez la date de la réunion.' using errcode = '22023';
  end if;
  insert into meetings (title, kind, meeting_date, notes)
  values (trim(p ->> 'title'), coalesce(nullif(p ->> 'kind', ''), 'ordinaire'), (p ->> 'meeting_date')::date,
          nullif(trim(p ->> 'notes'), ''))
  returning * into m;
  for rp in select * from recurring_points where kind = m.kind and start_date <= m.meeting_date order by id loop
    if private.applies(rp, m) then
      pos := pos + 1;
      insert into agenda_items (meeting_id, recurring_id, title, wording, position)
      values (m.id, rp.id, rp.title, rp.wording, pos);
    end if;
  end loop;
  return private.meeting_detail(m.id);
end $$;

create function public.get_meeting(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select private.meeting_detail(p_id)
$$;

create function public.update_meeting(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_elu();
  update meetings set
    title = coalesce(nullif(trim(p ->> 'title'), ''), title),
    kind = coalesce(nullif(p ->> 'kind', ''), kind),
    meeting_date = coalesce(nullif(p ->> 'meeting_date', '')::date, meeting_date),
    status = coalesce(nullif(p ->> 'status', ''), status),
    notes = case when p ? 'notes' then nullif(trim(p ->> 'notes'), '') else notes end
  where id = p_id;
  if not found then raise exception 'Réunion introuvable.' using errcode = 'P0002'; end if;
  return private.meeting_detail(p_id);
end $$;

create function private.on_other_planned_agenda(rid bigint, except_item bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
                 where a.request_id = rid and m.status = 'planifiee' and a.id <> except_item)
$$;

create function private.release_item(a public.agenda_items) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if a.request_id is null or a.discussed then return; end if;
  perform private.add_event(a.request_id, 'Retirée de l''ordre du jour');
  select status into st from requests where id = a.request_id;
  if st = 'inscrite_odj' and not private.on_other_planned_agenda(a.request_id, a.id) then
    perform private.set_status(a.request_id, 'en_cours');
    perform private.propagate_status(a.request_id, 'en_cours');
  end if;
end $$;

create function public.delete_meeting(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare a agenda_items;
begin
  perform private.require_elu();
  for a in select * from agenda_items where meeting_id = p_id loop
    perform private.release_item(a);
  end loop;
  delete from meetings where id = p_id;
end $$;

-- Demandes ouvertes, non inscrites à une réunion planifiée, classées par pertinence
create function private.proposal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w jsonb; total int; items jsonb;
begin
  select odj_weights into w from settings where id = 1;
  with pending as (
    select r.* from requests r
    where r.status in ('nouvelle', 'en_cours', 'inscrite_odj') and r.parent_id is null
      and not exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
                      where a.request_id = r.id and m.status = 'planifiee')
      and public.can_see_request(r.id)
  ), scored as (
    select p.id, p.created_at, p.priority, p.kind, p.temporality, p.status, p.subject_number, d.days, nc.n,
      coalesce((w ->> p.priority)::int, 0)
        + d.days * coalesce((w ->> 'par_jour')::int, 1)
        + case when p.kind = 'signalement' and p.temporality = 'actuel'
               then coalesce((w ->> 'signalement_actuel')::int, 15) else 0 end as score
    from pending p
    cross join lateral (select greatest(private.today() - (p.created_at at time zone 'Europe/Paris')::date, 0) as days) d
    cross join lateral (select count(*) as n from requests c where c.parent_id = p.id) nc
  ), top as (
    select * from scored order by score desc, created_at limit coalesce((w ->> 'max_points')::int, 15)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'request', private.request_summary(rq),
      'score', t.score,
      'wording', private.suggest_wording(rq),
      'reasons', to_jsonb(array_remove(array[
          case when t.priority = 'haute' then 'Priorité haute' end,
          case when t.days >= 7 then 'En attente depuis ' || t.days || ' jours' end,
          case when t.kind = 'signalement' and t.temporality = 'actuel' then 'Signalement d''une situation actuelle' end,
          case when t.status = 'nouvelle' then 'Pas encore prise en charge' end,
          case when t.status = 'inscrite_odj' then 'Déjà passée en réunion, toujours sans réponse' end,
          case when t.n > 0 then 'Soulevé par ' || (t.n + 1) || ' salariés' end,
          case when t.subject_number is null then 'À trier : recevra un numéro de sujet' end], null)))
      order by t.score desc, t.created_at), '[]'::jsonb)
  into items from top t join requests rq on rq.id = t.id;

  select count(*) into total from requests r
  where r.status in ('nouvelle', 'en_cours', 'inscrite_odj') and r.parent_id is null
    and not exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
                    where a.request_id = r.id and m.status = 'planifiee')
    and not public.can_see_request(r.id);
  return jsonb_build_object('items', items, 'hidden_pending', total);
end $$;

create function public.propose_agenda(p_meeting_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  if not exists (select 1 from meetings where id = p_meeting_id) then
    raise exception 'Réunion introuvable.' using errcode = 'P0002';
  end if;
  return private.proposal();
end $$;

-- Préparation : prochaine réunion de chaque type (ou une date proposée), autres réunions
create function private.meeting_prep(m public.meetings) returns jsonb
language sql stable security definer set search_path = public as $$
  select private.meeting_summary(m) || jsonb_build_object(
    'request_points', (select count(*) from agenda_items a where a.meeting_id = m.id and a.request_id is not null),
    'missing_wording', (select count(*) from agenda_items a where a.meeting_id = m.id and a.request_id is not null
                        and nullif(trim(a.wording), '') is null))
$$;

create function private.suggest_meeting(k text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare last meetings; d date; today date := private.today(); mo text;
begin
  if k = 'ordinaire' then
    select * into last from meetings where kind = 'ordinaire' and status <> 'annulee'
    order by meeting_date desc, id desc limit 1;
    if last.id is not null then
      -- Un mois après la dernière plénière, le même jour de la semaine
      d := (last.meeting_date + interval '1 month')::date;
      d := d + (((((extract(isodow from last.meeting_date)::int - extract(isodow from d)::int) + 3) % 7) + 7) % 7 - 3);
      while d <= today loop
        d := (d + interval '1 month')::date;
      end loop;
    else
      d := today + 14;
    end if;
    mo := private.month_name(extract(month from d)::int);
    return jsonb_build_object('title', 'CSE ordinaire ' || case when left(mo, 1) in ('a', 'o') then 'd’' else 'de ' end
                                       || mo || ' ' || extract(year from d)::int,
                              'meeting_date', d);
  end if;
  d := today + 7;
  return jsonb_build_object('title', case k when 'extraordinaire' then 'CSE extraordinaire' else 'Réunion CSE' end
                                     || ' du ' || private.fr_date(d), 'meeting_date', d);
end $$;

create function public.preparation() returns jsonb
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
    'to_triage', (select count(*) from requests r where r.subject_number is null and r.parent_id is null
                  and r.status <> 'close' and public.can_see_request(r.id)),
    'pending', jsonb_array_length(private.proposal() -> 'items'));
end $$;

-- Inscrit une demande à l'ODJ (avec la formulation proposée si aucune n'est fournie)
create function private.inscribe(m public.meetings, rid bigint, pos int, p_wording text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare r requests; item_id bigint; c record;
begin
  perform private.assign_number(rid);  -- inscrire à l'ODJ vaut décision : c'est un sujet
  select * into r from requests where id = rid;
  insert into agenda_items (meeting_id, request_id, wording, position)
  values (m.id, r.id, coalesce(nullif(trim(p_wording), ''), private.suggest_wording(r)), pos)
  returning id into item_id;
  for c in select id, status from requests where id = rid or parent_id = rid order by id loop
    perform private.add_event(c.id, 'Inscrite à l''ordre du jour de la réunion du ' || private.fr_date(m.meeting_date));
    if c.status in ('nouvelle', 'en_cours', 'repondue') then
      perform private.set_status(c.id, 'inscrite_odj');
    end if;
  end loop;
  return item_id;
end $$;

create function private.require_editable(mid bigint) returns public.meetings
language plpgsql stable security definer set search_path = public as $$
declare m meetings;
begin
  perform private.require_elu();
  select * into m from meetings where id = mid;
  if m.id is null then raise exception 'Réunion introuvable.' using errcode = 'P0002'; end if;
  if m.status <> 'planifiee' then
    raise exception 'On ne peut plus modifier l''ordre du jour d''une réunion tenue ou annulée.' using errcode = '22023';
  end if;
  return m;
end $$;

-- p : { request_id } ou { title, wording, recurring, recurrence: { every, months, end_date } }
create function public.add_agenda_item(p_meeting_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m meetings;
  r requests;
  pos int;
  item_id bigint;
  rid bigint := nullif(p ->> 'request_id', '')::bigint;
  rule jsonb := nullif(p -> 'recurrence', 'null'::jsonb);
begin
  m := private.require_editable(p_meeting_id);
  select coalesce(max(position), 0) + 1 into pos from agenda_items where meeting_id = m.id;
  if rid is not null then
    r := private.require_visible(rid);
    if exists (select 1 from agenda_items where meeting_id = m.id and request_id = r.id) then
      raise exception 'Cette demande est déjà à l''ordre du jour.' using errcode = '23505';
    end if;
    if r.status = 'close' then raise exception 'Demande clôturée.' using errcode = '22023'; end if;
    if r.parent_id is not null then
      raise exception 'Demande associée au sujet n° % : inscrivez ce sujet à l''ordre du jour.',
        (select subject_number from requests where id = r.parent_id) using errcode = '22023';
    end if;
    perform private.inscribe(m, r.id, pos, p ->> 'wording');
  else
    if char_length(trim(coalesce(p ->> 'title', ''))) = 0 then
      raise exception 'Indiquez une demande ou un intitulé de point.' using errcode = '22023';
    end if;
    insert into agenda_items (meeting_id, title, wording, position)
    values (m.id, left(trim(p ->> 'title'), 200), nullif(trim(p ->> 'wording'), ''), pos)
    returning id into item_id;
    if coalesce((p ->> 'recurring')::boolean, false) or rule is not null then
      perform private.start_recurring(m, item_id, rule);
    end if;
  end if;
  return private.meeting_detail(m.id);
end $$;

-- Génère l'ordre du jour : points fixes d'ouverture, demandes proposées, points fixes de clôture.
-- Les points déjà présents sont conservés ; relancer ne duplique rien.
create function public.generate_agenda(p_meeting_id bigint, p_include_fixed boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m meetings;
  fixed jsonb;
  head bigint[] := '{}';
  tail bigint[] := '{}';
  middle bigint[];
  prop jsonb;
  entry jsonb;
  part text;
  t text;
  w text;
  found_id bigint;
  pi jsonb;
  new_id bigint;
  i int;
begin
  m := private.require_editable(p_meeting_id);
  if m.kind <> 'ordinaire' then
    raise exception 'La génération automatique concerne les réunions ordinaires (plénières) : ajoutez les points d''une réunion extraordinaire un par un.'
      using errcode = '22023';
  end if;
  select case when p_include_fixed then odj_fixed_points else '{}'::jsonb end into fixed from settings where id = 1;
  prop := private.proposal();  -- calculée avant d'inscrire quoi que ce soit

  foreach part in array array['debut', 'fin'] loop
    for entry in select * from jsonb_array_elements(coalesce(fixed -> part, '[]'::jsonb)) loop
      -- Un point fixe : un intitulé, ou { titre, formulation }
      if jsonb_typeof(entry) = 'object' then
        t := trim(entry ->> 'titre'); w := nullif(trim(entry ->> 'formulation'), '');
      else
        t := trim(entry #>> '{}'); w := null;
      end if;
      continue when coalesce(t, '') = '';
      select id into found_id from agenda_items
      where meeting_id = m.id and request_id is null and lower(trim(title)) = lower(t)
      order by id limit 1;
      if found_id is null then
        insert into agenda_items (meeting_id, title, wording, position) values (m.id, left(t, 200), w, 0)
        returning id into found_id;
      end if;
      if part = 'debut' then head := head || found_id; else tail := tail || found_id; end if;
    end loop;
  end loop;

  select coalesce(array_agg(id order by position, id), '{}') into middle
  from agenda_items where meeting_id = m.id and not (id = any (head || tail));
  for pi in select * from jsonb_array_elements(prop -> 'items') loop
    new_id := private.inscribe(m, (pi -> 'request' ->> 'id')::bigint, 0, pi ->> 'wording');
    middle := middle || new_id;
  end loop;

  i := 0;
  update agenda_items a set position = o.pos
  from unnest(head || middle || tail) with ordinality as o(id, pos)
  where a.id = o.id;
  return private.meeting_detail(m.id);
end $$;

create function private.get_item(p_item_id bigint) returns public.agenda_items
language plpgsql stable security definer set search_path = public as $$
declare a agenda_items;
begin
  perform private.require_elu();
  select * into a from agenda_items where id = p_item_id;
  if a.id is null then raise exception 'Point introuvable.' using errcode = 'P0002'; end if;
  if a.request_id is not null and not public.can_see_request(a.request_id) then
    raise exception 'Le demandeur n''a pas autorisé l''accès à ce point.' using errcode = '42501';
  end if;
  return a;
end $$;

-- p : { title, wording, outcome, discussed, send_as_answer, recurring, recurrence }
create function public.update_agenda_item(p_item_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  a agenda_items;
  m meetings;
  old_title text;
  old_wording text;
  rule jsonb := nullif(p -> 'recurrence', 'null'::jsonb);
  rec text := p ->> 'recurring';
  body text;
begin
  a := private.get_item(p_item_id);
  select * into m from meetings where id = a.meeting_id;
  old_title := a.title; old_wording := a.wording;
  if a.request_id is null and nullif(trim(p ->> 'title'), '') is not null then
    update agenda_items set title = left(trim(p ->> 'title'), 200) where id = a.id;
  end if;
  if p ? 'wording' and jsonb_typeof(p -> 'wording') <> 'null' then
    update agenda_items set wording = nullif(trim(p ->> 'wording'), '') where id = a.id;
  end if;
  if p ? 'outcome' and jsonb_typeof(p -> 'outcome') <> 'null' then
    update agenda_items set outcome = nullif(trim(p ->> 'outcome'), '') where id = a.id;
  end if;
  if nullif(p ->> 'discussed', '') is not null then
    update agenda_items set discussed = (p ->> 'discussed')::boolean where id = a.id;
  end if;
  select * into a from agenda_items where id = a.id;

  if a.request_id is null then
    if rec = 'false' then
      if a.recurring_id is not null then perform private.stop_recurring(m, a.recurring_id); end if;
    elsif a.recurring_id is null then
      if rec = 'true' or rule is not null then
        perform private.require_editable(m.id);
        perform private.start_recurring(m, a.id, rule);
      end if;
    else
      perform private.sync_recurring(m, a, old_title, old_wording);
      if rule is not null then
        perform private.apply_rule(a.recurring_id, rule);
        perform private.refresh_recurring(a.recurring_id, m);
      end if;
    end if;
  end if;

  if a.request_id is not null and coalesce((p ->> 'send_as_answer')::boolean, false) then
    if a.outcome is null then
      raise exception 'Saisissez d''abord le relevé de décision.' using errcode = '22023';
    end if;
    body := 'Réponse suite à la réunion du ' || private.fr_date(m.meeting_date) || E' :\n\n' || a.outcome;
    insert into messages (request_id, author_type, author_id, body, is_answer)
    values (a.request_id, 'elu', auth.uid(), body, true);
    perform private.add_event(a.request_id, 'Traitée en réunion du ' || private.fr_date(m.meeting_date) || ' — réponse apportée');
    update agenda_items set discussed = true where id = a.id;
    perform private.set_status(a.request_id, 'repondue');
    update requests set updated_at = now() where id = a.request_id;
    perform private.answer_linked(a.request_id, body, false);
  end if;
  return private.meeting_detail(m.id);
end $$;

-- Retire le point de cette réunion ; p_stop_recurring arrête aussi la répétition
create function public.remove_agenda_item(p_item_id bigint, p_stop_recurring boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a agenda_items; m meetings;
begin
  a := private.get_item(p_item_id);
  select * into m from meetings where id = a.meeting_id;
  if p_stop_recurring and a.recurring_id is not null then
    perform private.stop_recurring(m, a.recurring_id);
  end if;
  perform private.release_item(a);
  delete from agenda_items where id = a.id;
  return private.meeting_detail(m.id);
end $$;

create function public.reorder_agenda(p_meeting_id bigint, p_item_ids bigint[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare existing bigint[];
begin
  perform private.require_elu();
  select array_agg(id order by id) into existing from agenda_items where meeting_id = p_meeting_id;
  if existing is distinct from (select array_agg(x order by x) from unnest(p_item_ids) x) then
    raise exception 'La liste doit contenir tous les points de la réunion.' using errcode = '22023';
  end if;
  update agenda_items a set position = o.pos
  from unnest(p_item_ids) with ordinality as o(id, pos)
  where a.id = o.id;
  return private.meeting_detail(p_meeting_id);
end $$;

-- Données des documents Word (ODJ, trame du PV), mis en forme dans le navigateur
create function public.meeting_word_data(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m meetings; s settings;
begin
  perform private.require_elu();
  select * into m from meetings where id = p_id;
  if m.id is null then raise exception 'Réunion introuvable.' using errcode = 'P0002'; end if;
  select * into s from settings where id = 1;
  return jsonb_build_object(
    'meeting', private.meeting_detail(p_id),
    -- Demandes déjà passées à une réunion tenue antérieure : « questions des PV précédents »
    'held_before', coalesce((select jsonb_agg(distinct a.request_id) from agenda_items a join meetings o on o.id = a.meeting_id
                             where o.status = 'tenue' and o.id <> m.id and o.meeting_date <= m.meeting_date
                               and a.request_id is not null), '[]'::jsonb),
    'categories', to_jsonb(s.categories),
    'word', s.word_settings);
end $$;

-- -----------------------------------------------------------------------------
--  Comptes élus
-- -----------------------------------------------------------------------------

create function public.update_my_profile(p_full_name text, p_mandate text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Indiquez votre nom.' using errcode = '22023';
  end if;
  update elus set full_name = trim(p_full_name), mandate = nullif(trim(p_mandate), '') where id = auth.uid();
end $$;

create function public.admin_update_elu(
  p_id uuid, p_full_name text default null, p_mandate text default null,
  p_role text default null, p_is_active boolean default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if p_id = auth.uid() and (p_is_active is false or p_role = 'elu') then
    raise exception 'Vous ne pouvez pas vous retirer vos propres droits.' using errcode = '22023';
  end if;
  update elus set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    mandate   = case when p_mandate is null then mandate else nullif(trim(p_mandate), '') end,
    role      = coalesce(p_role, role),
    is_active = coalesce(p_is_active, is_active),
    validated_at = case when p_is_active and validated_at is null then now() else validated_at end
  where id = p_id;
  if not found then raise exception 'Compte introuvable.' using errcode = 'P0002'; end if;
end $$;

-- -----------------------------------------------------------------------------
--  Modèles Word privés (stockage Supabase : lisibles par les élus validés,
--  modifiables par les administrateurs). Les modèles contiennent des noms :
--  ils ne doivent jamais être publiés sur GitHub.
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('modeles', 'modeles', false)
    on conflict (id) do nothing;
    execute $p$create policy allocse_modeles_read on storage.objects for select to authenticated
      using (bucket_id = 'modeles' and public.is_active_elu())$p$;
    execute $p$create policy allocse_modeles_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'modeles' and public.is_admin())$p$;
    execute $p$create policy allocse_modeles_update on storage.objects for update to authenticated
      using (bucket_id = 'modeles' and public.is_admin())$p$;
    execute $p$create policy allocse_modeles_delete on storage.objects for delete to authenticated
      using (bucket_id = 'modeles' and public.is_admin())$p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
--  Données de l'espace (administrateurs) : repartir de zéro, exporter, importer,
--  charger l'exemple fourni. Les comptes élus, les réglages et les modèles Word
--  ne sont jamais touchés.
-- -----------------------------------------------------------------------------

create function private.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
end $$;

create function private.is_space_empty() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from requests) and not exists (select 1 from meetings)
     and not exists (select 1 from recurring_points)
$$;

create function private.wipe_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate public.commitments, public.agenda_items, public.recurring_points, public.meetings, public.events,
    public.messages, public.request_viewers, public.requests restart identity;
end $$;

create function public.admin_data_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'requests', (select count(*) from requests), 'meetings', (select count(*) from meetings),
    'commitments', (select count(*) from commitments), 'empty', private.is_space_empty(),
    'is_demo', (select is_demo from settings where id = 1));
end $$;

-- Repartir de zéro : efface demandes, réunions, engagements (confirmation : « EFFACER »)
create function public.admin_wipe_data(p_confirm text) returns jsonb
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
create function private.ago(n int, h int default 10) returns timestamptz language sql stable as $$
  select ((private.today() - n)::timestamp + make_interval(hours => h)) at time zone 'Europe/Paris'
$$;

-- Les écritures faites « maintenant » (now() est fixe dans une transaction) sont datées à ts
create function private.stamp(ts timestamptz) returns void
language sql security definer set search_path = public as $$
  update events set created_at = ts where created_at = now();
  update messages set created_at = ts where created_at = now();
  update commitments set created_at = ts where created_at = now();
$$;

create function private.sample_request(
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

create function private.sample_meeting(n int, st text) returns meetings
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

create function private.sample_fixed_points(m meetings) returns int
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
create function private.load_sample(main uuid, other uuid default null) returns void
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
create function public.admin_load_sample() returns jsonb
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

create function private.email_of(uid uuid) returns text language sql stable security definer set search_path = public as $$
  select email from elus where id = uid
$$;
create function private.elu_by_email(mail text) returns uuid language sql stable security definer set search_path = public as $$
  select id from elus where email = lower(mail)
$$;

-- Tout le contenu de l'espace ; les élus sont désignés par leur e-mail
create function public.admin_export_data() returns jsonb
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
create function public.admin_import_data(p jsonb, p_shift boolean default true) returns jsonb
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

-- -----------------------------------------------------------------------------
--  Droits d'exécution des fonctions
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Salariés (sans compte) et élus
grant execute on function public.public_config(), public.track_request(text),
  public.add_public_message(text, text), public.submit_request(jsonb)
  to anon, authenticated;

-- Élus connectés (chaque fonction vérifie en plus que le compte est validé)
grant execute on function
  public.is_active_elu(), public.is_admin(), public.can_see_request(bigint),
  public.search_requests(jsonb), public.get_request(bigint), public.dashboard_stats(),
  public.timeline(boolean), public.update_request(bigint, jsonb), public.add_message(bigint, jsonb),
  public.triage(bigint, bigint), public.untriage(bigint), public.create_elu_request(jsonb),
  public.add_commitment(bigint, jsonb), public.update_commitment(bigint, jsonb), public.delete_commitment(bigint),
  public.list_meetings(), public.create_meeting(jsonb), public.get_meeting(bigint),
  public.update_meeting(bigint, jsonb), public.delete_meeting(bigint), public.preparation(),
  public.propose_agenda(bigint), public.add_agenda_item(bigint, jsonb),
  public.generate_agenda(bigint, boolean), public.update_agenda_item(bigint, jsonb),
  public.remove_agenda_item(bigint, boolean), public.reorder_agenda(bigint, bigint[]),
  public.meeting_word_data(bigint), public.update_my_profile(text, text),
  public.admin_update_elu(uuid, text, text, text, boolean),
  public.admin_data_summary(), public.admin_wipe_data(text), public.admin_load_sample(),
  public.admin_export_data(), public.admin_import_data(jsonb, boolean)
  to authenticated;

-- search_requests s'exécute avec les droits de l'élu : il appelle ces aides internes
grant usage on schema private to authenticated;
grant execute on function private.request_summary(public.requests), private.elu_json(uuid),
  private.subject_number_of(public.requests) to authenticated;

-- Les fonctions créées plus tard ne seront pas exécutables par défaut
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
