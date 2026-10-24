-- =============================================================================
--  AlloCSE — schéma Supabase (version 4 : sujets du CSE, demandes, réunions, votes, prêts de matériel,
--  Gantt, Word, e-mails)
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
  demo_reset_at   timestamptz,
  -- E-mails aux salariés (voir « E-mails aux salariés ») : adresse d'expédition validée chez Brevo,
  -- adresse de l'appli pour le lien « Voir ma demande »
  mail_from       text check (char_length(mail_from) <= 190),
  app_url         text check (char_length(app_url) <= 300)
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
  can_vote     boolean not null default true,    -- vote dans les votes en ligne (réglé par un administrateur)
  created_at   timestamptz not null default now()
);

-- Sujet du CSE : ce que les élus suivent et portent devant la direction.
-- Il regroupe des demandes de salariés (zéro, une ou plusieurs) et vit sa propre vie :
-- passages à l'ordre du jour, engagements de la direction, notes, historique.
create table public.subjects (
  id              bigint generated always as identity primary key,
  number          text not null unique,                 -- S-2026-001
  title           text not null check (char_length(title) between 3 and 200),
  description     text check (char_length(description) <= 10000),
  category        text not null,
  kind            text not null default 'demande' check (kind in ('demande', 'signalement')),  -- question / alerte
  temporality     text check (temporality in ('actuel', 'a_venir')),
  situation_start date,
  situation_end   date,
  status          text not null default 'ouvert' check (status in ('ouvert', 'inscrit_odj', 'repondu', 'clos')),
  priority        text not null default 'normale' check (priority in ('basse', 'normale', 'haute')),
  assignee_id     uuid references public.elus (id) on delete set null,
  due_date        date,
  visible_to_all  boolean not null default true,
  created_by      uuid references public.elus (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (situation_end is null or situation_start is null or situation_end >= situation_start)
);
create index subjects_status_idx on public.subjects (status);

-- Sujet à accès restreint (créé à partir d'une demande restreinte, ou par choix des élus)
create table public.subject_viewers (
  subject_id  bigint not null references public.subjects (id) on delete cascade,
  elu_id      uuid not null references public.elus (id) on delete cascade,
  primary key (subject_id, elu_id)
);

-- Notes internes des élus sur un sujet
create table public.subject_notes (
  id          bigint generated always as identity primary key,
  subject_id  bigint not null references public.subjects (id) on delete cascade,
  author_id   uuid references public.elus (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 10000),
  is_answer   boolean not null default false,   -- réponse transmise aux salariés du sujet
  created_at  timestamptz not null default now()
);
create index subject_notes_subject_idx on public.subject_notes (subject_id);

-- Historique du sujet (interne aux élus)
create table public.subject_events (
  id          bigint generated always as identity primary key,
  subject_id  bigint not null references public.subjects (id) on delete cascade,
  label       text not null,
  elu_id      uuid references public.elus (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index subject_events_subject_idx on public.subject_events (subject_id);

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
  -- Sujet du CSE auquel la demande est rattachée (aucun : réponse directe ou à trier)
  subject_id        bigint references public.subjects (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (situation_end is null or situation_start is null or situation_end >= situation_start)
);
create index requests_status_idx on public.requests (status);
create index requests_subject_idx on public.requests (subject_id);

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

-- Engagements de la direction sur un sujet : réponse avec un délai, suivie jusqu'à ce qu'elle soit tenue
create table public.commitments (
  id          bigint generated always as identity primary key,
  subject_id  bigint not null references public.subjects (id) on delete cascade,
  text        text not null check (char_length(text) between 3 and 2000),
  due_date    date not null,
  status      text not null default 'en_attente' check (status in ('en_attente', 'tenu', 'non_tenu')),
  meeting_id  bigint,                               -- réunion où l'engagement a été pris (facultatif)
  public      boolean not null default true,        -- visible par les salariés du sujet
  created_by  uuid references public.elus (id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index commitments_subject_idx on public.commitments (subject_id);

-- Adresse où prévenir le salarié : table à part, illisible depuis l'appli (même par les élus),
-- pour qu'une demande anonyme le reste
create table public.request_notify (
  request_id bigint primary key references public.requests (id) on delete cascade,
  email      text not null check (char_length(email) <= 190)
);

create table public.notifications (
  id            bigint generated always as identity primary key,
  request_id    bigint references public.requests (id) on delete cascade,  -- null : e-mail de test
  to_email      text not null,
  answered      boolean not null default false,   -- réponse du CSE
  asked         boolean not null default false,   -- message du CSE (précisions attendues)
  closed        boolean not null default false,   -- demande clôturée
  test          boolean not null default false,
  state         text not null default 'en_attente' check (state in ('en_attente', 'envoi', 'envoyee', 'echec')),
  attempts      int not null default 0,
  net_id        bigint,
  error         text,
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  sent_at       timestamptz
);
-- Une seule notification en attente par demande : les événements rapprochés partent dans un seul e-mail
create unique index notifications_pending_idx on public.notifications (request_id)
  where state = 'en_attente' and request_id is not null;

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
  subject_id   bigint references public.subjects (id) on delete set null,
  title        text check (char_length(title) <= 200),   -- uniquement pour un point libre
  wording      text,                                     -- formulation à l'ordre du jour
  position     int not null default 0,
  outcome      text,                                     -- relevé de décision
  discussed    boolean not null default false,
  recurring_id bigint references public.recurring_points (id) on delete set null,
  unique (meeting_id, subject_id)
);
create index agenda_items_meeting_idx on public.agenda_items (meeting_id);
create index agenda_items_subject_idx on public.agenda_items (subject_id);

-- Votes du CSE : en séance (un élu note le résultat) ou en ligne (chaque élu vote dans l'appli)
create table public.votes (
  id             bigint generated always as identity primary key,
  title          text not null check (char_length(title) between 3 and 300),
  description    text check (char_length(description) <= 10000),
  mode           text not null check (mode in ('seance', 'en_ligne')),
  -- Réponses proposées ; « Pour, Contre, Abstention » donne un résultat adopté / rejeté
  options        text[] not null default array['Pour', 'Contre', 'Abstention']
                 check (array_length(options, 1) between 2 and 8),
  secret         boolean not null default false,          -- bulletin secret
  meeting_id     bigint references public.meetings (id) on delete set null,
  agenda_item_id bigint references public.agenda_items (id) on delete set null,
  deadline       timestamptz,                             -- en ligne : plus de vote après cette date
  tally          int[],                                   -- en séance : nombre de voix par réponse
  status         text not null default 'ouvert' check (status in ('ouvert', 'clos')),
  closed_at      timestamptz,
  created_by     uuid references public.elus (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index votes_meeting_idx on public.votes (meeting_id);

-- Bulletins des votes en ligne. Vote à bulletin secret : le bulletin ne garde que la participation,
-- le choix est compté dans vote_secret_tally sans lien avec l'élu (et ne peut plus être changé).
create table public.vote_ballots (
  vote_id   bigint not null references public.votes (id) on delete cascade,
  elu_id    uuid not null references public.elus (id) on delete cascade,
  choice    smallint,                                     -- rang de la réponse (0 = première) ; null si secret
  voted_at  timestamptz not null default now(),
  primary key (vote_id, elu_id)
);
create table public.vote_secret_tally (
  vote_id  bigint not null references public.votes (id) on delete cascade,
  choice   smallint not null,
  n        int not null default 0,
  primary key (vote_id, choice)
);

-- Matériel que le CSE prête aux salariés, et les prêts (réservés, sortis, rendus)
create table public.equipment (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 2 and 120),
  description text check (char_length(description) <= 2000),
  quantity    int not null default 1 check (quantity between 1 and 999),
  deposit     numeric(8,2) check (deposit >= 0),          -- caution demandée, en euros
  location    text check (char_length(location) <= 200),  -- où il est rangé
  active      boolean not null default true,              -- false : retiré du prêt
  created_at  timestamptz not null default now()
);

create table public.loans (
  id               bigint generated always as identity primary key,
  equipment_id     bigint not null references public.equipment (id) on delete restrict,
  quantity         int not null default 1 check (quantity between 1 and 999),
  borrower_name    text not null check (char_length(borrower_name) between 2 and 120),
  borrower_service text check (char_length(borrower_service) <= 120),
  borrower_contact text check (char_length(borrower_contact) <= 190),
  start_date       date not null,
  due_date         date not null,
  status           text not null default 'reserve' check (status in ('reserve', 'sorti', 'rendu', 'annule')),
  deposit          numeric(8,2) check (deposit >= 0),
  deposit_received boolean not null default false,
  deposit_returned boolean not null default false,
  returned_on      date,
  return_state     text check (return_state in ('bon', 'abime', 'incomplet')),
  notes            text check (char_length(notes) <= 2000),
  created_by       uuid references public.elus (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (due_date >= start_date)
);
create index loans_equipment_idx on public.loans (equipment_id);

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

create function public.can_see_subject(sid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_elu() and exists (
    select 1 from subjects s
    where s.id = sid
      and (s.visible_to_all
           or exists (select 1 from subject_viewers v where v.subject_id = s.id and v.elu_id = auth.uid())))
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

create function private.require_subject(sid bigint) returns public.subjects
language plpgsql stable security definer set search_path = public as $$
declare s public.subjects;
begin
  perform private.require_elu();
  if sid is null or not public.can_see_subject(sid) then
    raise exception 'Sujet introuvable.' using errcode = 'P0002';
  end if;
  select * into s from subjects where id = sid;
  return s;
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

create function private.subject_status_label(s text) returns text language sql immutable as $$
  select case s
    when 'ouvert' then 'En cours'
    when 'inscrit_odj' then 'Inscrit à l''ordre du jour'
    when 'repondu' then 'Réponse apportée'
    when 'clos' then 'Clos' end
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

create function private.subject_event(sid bigint, lbl text) returns void
language sql security definer set search_path = public as $$
  insert into subject_events (subject_id, label, elu_id) values (sid, lbl, auth.uid());
  update subjects set updated_at = now() where id = sid;
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

-- Statut d'un sujet ; les demandes encore ouvertes qui y sont rattachées suivent
create function private.set_subject_status(sid bigint, new_status text) returns void
language plpgsql security definer set search_path = public as $$
declare old_status text; c record; target text;
begin
  select status into old_status from subjects where id = sid for update;
  if old_status is not distinct from new_status then return; end if;
  update subjects set status = new_status, updated_at = now() where id = sid;
  perform private.subject_event(sid, 'Statut : ' || private.subject_status_label(new_status));
  target := case new_status when 'ouvert' then 'en_cours' when 'inscrit_odj' then 'inscrite_odj'
                            when 'clos' then 'close' end;
  if target is null then return; end if;  -- « répondu » : chaque demande reçoit la réponse elle-même
  for c in select id, status from requests where subject_id = sid order by id loop
    if c.status <> 'close' or new_status = 'ouvert' then
      perform private.set_status(c.id, target);
    end if;
  end loop;
end $$;

-- Numéro de sujet : S-2026-001
create function private.new_subject_number() returns text
language plpgsql security definer set search_path = public as $$
declare prefix text; last int;
begin
  perform pg_advisory_xact_lock(4243);
  select subject_prefix || '-' || extract(year from private.today())::int || '-' into prefix
  from settings where id = 1;
  select coalesce(max(substr(number, length(prefix) + 1)::int), 0) into last
  from subjects where number like prefix || '%' and substr(number, length(prefix) + 1) ~ '^\d+$';
  return prefix || lpad((last + 1)::text, 3, '0');
end $$;

-- « depuis le 12/09/2026 », « du 12/09/2026 au 30/09/2026 »… ou '' si inconnue
create function private.period_text(temporality text, s_start date, s_end date) returns text
language sql immutable as $$
  select case
    when s_start is not null and s_end is not null
      then 'du ' || private.fr_date(s_start) || ' au ' || private.fr_date(s_end)
    when s_start is not null and temporality = 'a_venir' then 'à partir du ' || private.fr_date(s_start)
    when s_start is not null then 'depuis le ' || private.fr_date(s_start)
    when s_end is not null then 'jusqu’au ' || private.fr_date(s_end)
    else '' end
$$;

create function private.period_label(r public.requests) returns text language sql immutable as $$
  select private.period_text(r.temporality, r.situation_start, r.situation_end)
$$;

-- Formulation proposée pour inscrire le sujet à l'ordre du jour : jamais l'identité d'un demandeur
create function private.suggest_wording(s public.subjects) returns text
language plpgsql stable security definer set search_path = public as $$
declare tpl text; per text;
begin
  select odj_wordings ->> (case when s.kind = 'signalement'
                                then case when s.temporality = 'a_venir' then 'signalement_a_venir'
                                          else 'signalement_actuel' end
                                else 'demande' end)
  into tpl from settings where id = 1;
  per := private.period_text(s.temporality, s.situation_start, s.situation_end);
  tpl := coalesce(tpl, '{sujet}');
  tpl := replace(tpl, '{sujet}', regexp_replace(trim(s.title), '\.+$', ''));
  tpl := replace(tpl, '{categorie}', s.category);
  tpl := replace(tpl, '{code}', s.number);
  tpl := replace(tpl, '{periode}', case when per = '' then '' else ' ' || per end);
  return trim(regexp_replace(tpl, '\{[a-z_]+\}', '', 'g'));
end $$;

-- Réponse officielle du CSE sur un sujet : chaque salarié concerné la reçoit sur sa demande
create function private.answer_subject(sid bigint, body text, do_close boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare c record; num text; n int := 0;
begin
  select number into num from subjects where id = sid;
  insert into subject_notes (subject_id, author_id, body, is_answer) values (sid, auth.uid(), body, true);
  for c in select id from requests where subject_id = sid and status <> 'close' order by id loop
    insert into messages (request_id, author_type, author_id, body, is_answer)
    values (c.id, 'elu', auth.uid(), body, true);
    perform private.add_event(c.id, 'Réponse du CSE sur le sujet n° ' || num);
    perform private.set_status(c.id, case when do_close then 'close' else 'repondue' end);
    update requests set updated_at = now() where id = c.id;
    n := n + 1;
  end loop;
  if do_close then
    perform private.set_subject_status(sid, 'clos');
  else
    perform private.set_subject_status(sid, 'repondu');
  end if;
  perform private.subject_event(sid, 'Réponse transmise à ' || n || ' salarié' || case when n > 1 then 's' else '' end);
  return n;
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

create function private.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin
  -- Une date fixée explicitement (import, exemple) est conservée
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger requests_updated_at before update on public.requests
  for each row execute function private.touch_updated_at();
create trigger subjects_updated_at before update on public.subjects
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
--  Représentations JSON
-- -----------------------------------------------------------------------------

create function private.elu_json(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'mandate', e.mandate) from elus e where e.id = uid
$$;

-- Référence au sujet d'une demande ; un sujet que l'élu ne peut pas voir n'est désigné que par son numéro
create function private.subject_ref(sid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when s.id is null then null
              when public.can_see_subject(s.id)
                then jsonb_build_object('id', s.id, 'number', s.number, 'title', s.title, 'status', s.status,
                                        'restricted', false)
              else jsonb_build_object('id', null, 'number', s.number, 'title', null, 'status', s.status,
                                      'restricted', true) end
  from (select sid as wanted) w left join subjects s on s.id = w.wanted
$$;

create function private.request_summary(r public.requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'tracking_code', r.tracking_code, 'kind', r.kind, 'temporality', r.temporality,
    'situation_start', r.situation_start, 'situation_end', r.situation_end,
    'category', r.category, 'subject', r.subject, 'status', r.status, 'priority', r.priority,
    'anonymous', r.anonymous, 'requester_name', r.requester_name, 'visible_to_all', r.visible_to_all,
    'assignee', private.elu_json(r.assignee_id), 'due_date', r.due_date,
    'subject_ref', private.subject_ref(r.subject_id),
    'created_at', r.created_at, 'updated_at', r.updated_at)
$$;

create function private.subject_summary(s public.subjects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'number', s.number, 'title', s.title, 'kind', s.kind, 'temporality', s.temporality,
    'situation_start', s.situation_start, 'situation_end', s.situation_end, 'category', s.category,
    'status', s.status, 'priority', s.priority, 'assignee', private.elu_json(s.assignee_id),
    'due_date', s.due_date, 'visible_to_all', s.visible_to_all, 'created_by', private.elu_json(s.created_by),
    'request_count', (select count(*) from requests r where r.subject_id = s.id),
    'first_request_at', (select min(r.created_at) from requests r where r.subject_id = s.id),
    'next_meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'meeting_date', m.meeting_date)
                     from agenda_items a join meetings m on m.id = a.meeting_id
                     where a.subject_id = s.id and m.status = 'planifiee' order by m.meeting_date limit 1),
    'commitments_pending', (select count(*) from commitments c where c.subject_id = s.id and c.status = 'en_attente'),
    'commitments_late', (select count(*) from commitments c where c.subject_id = s.id and c.status = 'en_attente'
                         and c.due_date < private.today()),
    'created_at', s.created_at, 'updated_at', s.updated_at)
$$;

create function private.meeting_summary(m public.meetings) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'title', m.title, 'kind', m.kind, 'meeting_date', m.meeting_date,
                            'status', m.status,
                            'item_count', (select count(*) from agenda_items a where a.meeting_id = m.id))
$$;

create function private.commitment_json(c public.commitments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'subject_id', c.subject_id, 'text', c.text, 'due_date', c.due_date,
    'status', c.status, 'public', c.public, 'created_at', c.created_at, 'closed_at', c.closed_at,
    'late', c.status = 'en_attente' and c.due_date < private.today(),
    'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'meeting_date', m.meeting_date)
                from meetings m where m.id = c.meeting_id),
    'created_by', private.elu_json(c.created_by))
$$;

create function private.commitments_of(sid bigint, only_public boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(private.commitment_json(c) order by c.due_date, c.id), '[]'::jsonb)
  from commitments c
  where sid is not null and c.subject_id = sid and (not only_public or c.public)
$$;

-- Passages d'un sujet en réunion
create function private.subject_agenda(sid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', a.id, 'meeting_id', mt.id, 'meeting_title', mt.title, 'meeting_date', mt.meeting_date,
           'meeting_status', mt.status, 'discussed', a.discussed, 'outcome', a.outcome) order by mt.meeting_date), '[]'::jsonb)
  from agenda_items a join meetings mt on mt.id = a.meeting_id
  where sid is not null and a.subject_id = sid
$$;

create function private.request_detail(rid bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r requests; subj_visible boolean;
begin
  r := private.require_visible(rid);
  subj_visible := r.subject_id is not null and public.can_see_subject(r.subject_id);
  return private.request_summary(r) || jsonb_build_object(
    'description', r.description,
    -- Anonyme : aucune donnée d'identité
    'requester_email', case when r.anonymous then null else r.requester_email end,
    'requester_service', r.requester_service,
    'notify', exists (select 1 from request_notify n where n.request_id = r.id),
    'commitments', case when subj_visible then private.commitments_of(r.subject_id) else '[]'::jsonb end,
    'agenda', case when subj_visible then private.subject_agenda(r.subject_id) else '[]'::jsonb end,
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
                        from events ev where ev.request_id = r.id), '[]'::jsonb));
end $$;

create function private.subject_detail(sid bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s subjects;
begin
  s := private.require_subject(sid);
  return private.subject_summary(s) || jsonb_build_object(
    'description', s.description,
    'viewers', coalesce((select jsonb_agg(private.elu_json(v.elu_id) order by e.full_name)
                         from subject_viewers v join elus e on e.id = v.elu_id where v.subject_id = s.id), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(private.request_summary(r) order by r.created_at, r.id)
                          from requests r where r.subject_id = s.id and public.can_see_request(r.id)), '[]'::jsonb),
    'requests_hidden', (select count(*) from requests r where r.subject_id = s.id and not public.can_see_request(r.id)),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'author', private.elu_json(n.author_id),
                         'body', n.body, 'is_answer', n.is_answer, 'created_at', n.created_at) order by n.created_at, n.id)
                       from subject_notes n where n.subject_id = s.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'label', ev.label,
                          'user', private.elu_json(ev.elu_id), 'created_at', ev.created_at) order by ev.created_at, ev.id)
                        from subject_events ev where ev.subject_id = s.id), '[]'::jsonb),
    'agenda', private.subject_agenda(s.id),
    'commitments', private.commitments_of(s.id));
end $$;

create function private.recurrence_json(rp_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('every', rp.every, 'months', to_jsonb(coalesce(rp.months, '{}'::int[])),
                            'end_date', rp.end_date)
  from recurring_points rp where rp.id = rp_id
$$;

create function private.item_json(a public.agenda_items) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s subjects;
begin
  if a.subject_id is not null then
    select * into s from subjects where id = a.subject_id;
    if not public.can_see_subject(s.id) then
      -- L'élu voit qu'un point existe, jamais son contenu
      return jsonb_build_object('id', a.id, 'position', a.position, 'restricted', true,
        'title', 'Point à accès restreint', 'subject_id', null, 'number', null,
        'kind', null, 'temporality', null, 'category', null, 'status', null,
        'request_count', 0, 'recurring', false, 'recurrence', null, 'wording', null,
        'suggested_wording', null, 'outcome', null, 'discussed', a.discussed);
    end if;
    return jsonb_build_object('id', a.id, 'position', a.position, 'restricted', false, 'title', s.title,
      'subject_id', s.id, 'number', s.number, 'kind', s.kind, 'temporality', s.temporality,
      'category', s.category, 'status', s.status,
      'request_count', (select count(*) from requests r where r.subject_id = s.id),
      'recurring', false, 'recurrence', null, 'wording', a.wording,
      'suggested_wording', private.suggest_wording(s), 'outcome', a.outcome, 'discussed', a.discussed);
  end if;
  return jsonb_build_object('id', a.id, 'position', a.position, 'restricted', false, 'title', a.title,
    'subject_id', null, 'number', null, 'kind', null, 'temporality', null, 'category', null,
    'status', null, 'request_count', 0,
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
                       from agenda_items a where a.meeting_id = m.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_agg(private.vote_json(v) order by v.created_at, v.id)
                       from votes v where v.meeting_id = m.id), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
--  Row Level Security
-- -----------------------------------------------------------------------------

alter table public.settings         enable row level security;
alter table public.elus             enable row level security;
alter table public.subjects         enable row level security;
alter table public.subject_viewers  enable row level security;
alter table public.subject_notes    enable row level security;
alter table public.subject_events   enable row level security;
alter table public.requests         enable row level security;
alter table public.request_viewers  enable row level security;
alter table public.messages         enable row level security;
alter table public.events           enable row level security;
alter table public.meetings         enable row level security;
alter table public.recurring_points enable row level security;
alter table public.agenda_items     enable row level security;
alter table public.commitments      enable row level security;
alter table public.votes            enable row level security;
alter table public.vote_ballots     enable row level security;
alter table public.vote_secret_tally enable row level security;
alter table public.equipment        enable row level security;
alter table public.loans            enable row level security;

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
-- Sujets, notes, engagements, ordre du jour, points récurrents, votes, prêts : aucune politique,
-- accès uniquement via les fonctions (qui masquent les sujets à accès restreint et le secret des votes).

revoke all on all tables in schema public from anon, authenticated;
grant select on public.settings, public.elus, public.requests, public.request_viewers, public.messages,
  public.events, public.meetings to authenticated;
grant update (organisation, contact, categories, odj_weights, odj_wordings, odj_fixed_points, word_settings,
  mail_from, app_url) on public.settings to authenticated;

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
    'notify', exists (select 1 from request_notify n where n.request_id = r.id),
    'viewers', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name) order by e.full_name)
                         from request_viewers v join elus e on e.id = v.elu_id where v.request_id = r.id), '[]'::jsonb),
    'commitments', coalesce((select jsonb_agg(jsonb_build_object('text', x ->> 'text', 'due_date', x -> 'due_date',
                                                                 'status', x ->> 'status') order by x ->> 'due_date')
                             from jsonb_array_elements(private.commitments_of(r.subject_id, true)) x), '[]'::jsonb),
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
  notify boolean := coalesce((p ->> 'notify')::boolean, false);
  notify_to text;
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
  -- Être prévenu par e-mail : adresse saisie pour l'occasion (même anonyme), sinon celle du demandeur
  if notify then
    notify_to := coalesce(nullif(lower(trim(p ->> 'notify_email')), ''), case when not anon then email end);
    if notify_to is null then
      raise exception 'Indiquez votre adresse e-mail pour être prévenu.' using errcode = '22023';
    end if;
    if notify_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(notify_to) > 190 then
      raise exception 'L''adresse e-mail ne semble pas valide.' using errcode = '22023';
    end if;
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
  if notify_to is not null then
    insert into request_notify (request_id, email) values (rid, notify_to);
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
--  Élus — demandes des salariés
-- -----------------------------------------------------------------------------

-- Filtres : { status: [..], kind, q, mine, open_only, to_triage, subject_id }. Droits de l'élu (RLS).
create function public.search_requests(p jsonb default '{}') returns jsonb
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
    -- Votes en ligne qui attendent la voix de l'élu ; votes en séance dont le résultat reste à noter
    'votes_to_cast', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'deadline', v.deadline)
                                                order by v.deadline nulls last, v.id)
                               from votes v
                               where v.mode = 'en_ligne' and not private.vote_closed(v)
                                 and exists (select 1 from elus e where e.id = auth.uid() and e.can_vote)
                                 and not exists (select 1 from vote_ballots b where b.vote_id = v.id and b.elu_id = auth.uid())),
                              '[]'::jsonb),
    'votes_to_record', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'meeting_title', m.title,
                                                                     'meeting_date', m.meeting_date) order by m.meeting_date, v.id)
                                 from votes v join meetings m on m.id = v.meeting_id
                                 where v.mode = 'seance' and v.tally is null and m.meeting_date <= private.today()
                                   and m.status <> 'annulee'), '[]'::jsonb),
    -- Prêts de matériel : en retard, et réservations à remettre au salarié
    'loans_late', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'equipment', e.name, 'quantity', l.quantity,
                                                                'borrower_name', l.borrower_name, 'due_date', l.due_date)
                                             order by l.due_date, l.id)
                            from loans l join equipment e on e.id = l.equipment_id
                            where l.status = 'sorti' and l.due_date < private.today()), '[]'::jsonb),
    'loans_to_hand', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'equipment', e.name, 'quantity', l.quantity,
                                                                   'borrower_name', l.borrower_name, 'start_date', l.start_date)
                                                order by l.start_date, l.id)
                               from loans l join equipment e on e.id = l.equipment_id
                               where l.status = 'reserve' and l.start_date <= private.today()), '[]'::jsonb),
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
        'subject', private.subject_summary(s),
        'meetings', coalesce((select jsonb_agg(jsonb_build_object(
                       'meeting_id', m.id, 'title', m.title, 'meeting_date', m.meeting_date,
                       'status', m.status, 'discussed', a.discussed) order by m.meeting_date)
                     from agenda_items a join meetings m on m.id = a.meeting_id where a.subject_id = s.id), '[]'::jsonb),
        'answered_at', (select max(n.created_at) from subject_notes n where n.subject_id = s.id and n.is_answer),
        'commitments', private.commitments_of(s.id))
        order by s.created_at)
      from subjects s
      where public.can_see_subject(s.id)
        and (s.status in ('ouvert', 'inscrit_odj') or (p_include_answered and s.status = 'repondu')
             -- un sujet répondu reste suivi tant que la direction n'a pas tenu son engagement
             or exists (select 1 from commitments c where c.subject_id = s.id and c.status = 'en_attente'))
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
    end if;
  end if;
  return private.request_detail(p_id);
end $$;

-- Réponse directe au salarié, à tout moment, avec ou sans sujet.
-- p : { body, internal, is_answer, close }
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
  else
    perform private.add_event(r.id, 'Message du CSE');
    if r.status = 'nouvelle' then perform private.set_status(r.id, 'en_cours'); end if;
  end if;
  update requests set updated_at = now() where id = r.id;
  return private.request_detail(p_id);
end $$;

-- Rattache une demande à un sujet (ou la détache si p_subject_id est null)
create function private.attach_request(r public.requests, s public.subjects) returns void
language plpgsql security definer set search_path = public as $$
declare old_number text;
begin
  if r.subject_id is not distinct from s.id then return; end if;
  if r.subject_id is not null then
    select number into old_number from subjects where id = r.subject_id;
    perform private.subject_event(r.subject_id, case when r.visible_to_all then 'Demande ' || r.tracking_code || ' détachée'
                                                     else 'Une demande à accès restreint a été détachée' end);
  end if;
  update requests set subject_id = s.id where id = r.id;
  perform private.add_event(r.id, 'Rattachée au sujet n° ' || s.number || ' suivi par le CSE');
  perform private.subject_event(s.id, case when r.visible_to_all then 'Demande ' || r.tracking_code || ' rattachée'
                                           else 'Une demande à accès restreint a été rattachée' end);
  if r.status in ('nouvelle', 'en_cours', 'inscrite_odj') then
    perform private.set_status(r.id, case when s.status = 'inscrit_odj' then 'inscrite_odj' else 'en_cours' end);
  end if;
end $$;

create function public.link_request(p_request_id bigint, p_subject_id bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r requests; s subjects;
begin
  r := private.require_visible(p_request_id);
  if p_subject_id is null then
    if r.subject_id is null then
      raise exception 'Cette demande n''est rattachée à aucun sujet.' using errcode = '22023';
    end if;
    perform private.subject_event(r.subject_id, case when r.visible_to_all then 'Demande ' || r.tracking_code || ' détachée'
                                                     else 'Une demande à accès restreint a été détachée' end);
    perform private.add_event(r.id, 'Détachée de son sujet', false);
    update requests set subject_id = null where id = r.id;
  else
    s := private.require_subject(p_subject_id);
    if s.status = 'clos' then
      raise exception 'Ce sujet est clos : rouvrez-le avant d''y rattacher une demande.' using errcode = '22023';
    end if;
    perform private.attach_request(r, s);
  end if;
  return private.request_detail(p_request_id);
end $$;

-- -----------------------------------------------------------------------------
--  Élus — sujets du CSE
-- -----------------------------------------------------------------------------

-- Filtres : { status: [..], q, mine, open_only }
create function public.search_subjects(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  return coalesce((
    select jsonb_agg(private.subject_summary(s) order by s.updated_at desc, s.id desc)
    from subjects s
    where public.can_see_subject(s.id)
      and (p -> 'status' is null or jsonb_typeof(p -> 'status') <> 'array' or jsonb_array_length(p -> 'status') = 0
           or s.status in (select jsonb_array_elements_text(p -> 'status')))
      and (not coalesce((p ->> 'open_only')::boolean, false) or s.status <> 'clos')
      and (not coalesce((p ->> 'mine')::boolean, false) or s.assignee_id = auth.uid())
      and (nullif(trim(p ->> 'q'), '') is null or
           s.title ilike '%' || trim(p ->> 'q') || '%' or coalesce(s.description, '') ilike '%' || trim(p ->> 'q') || '%' or
           s.number ilike '%' || trim(p ->> 'q') || '%' or s.category ilike '%' || trim(p ->> 'q') || '%')), '[]'::jsonb);
end $$;

create function public.get_subject(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select private.subject_detail(p_id)
$$;

-- Nouveau sujet : de zéro, ou à partir de demandes de salariés.
-- p : { title, kind, temporality, situation_start, situation_end, category, description, priority,
--       take_charge (vrai par défaut), visible_to_all, viewer_ids, request_ids, meeting_id }
-- Un sujet créé avec une demande à accès restreint est réservé aux élus choisis par ce salarié.
create function public.create_subject(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  me elus;
  s subjects;
  r requests;
  m meetings;
  k text := coalesce(nullif(p ->> 'kind', ''), 'demande');
  vis boolean := coalesce((p ->> 'visible_to_all')::boolean, true);
  viewers uuid[];
  restricted_viewers uuid[];
  rid bigint;
  s_start date := nullif(p ->> 'situation_start', '')::date;
  s_end date := nullif(p ->> 'situation_end', '')::date;
  pos int;
begin
  perform private.require_elu();
  select * into me from elus where id = auth.uid();
  if k not in ('demande', 'signalement') then
    raise exception 'Type invalide.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'title', ''))) < 3 then
    raise exception 'Donnez un intitulé d''au moins 3 caractères.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p ->> 'category', ''))) = 0 then
    raise exception 'Choisissez un thème.' using errcode = '22023';
  end if;
  if k = 'demande' then s_start := null; s_end := null; end if;
  if s_start is not null and s_end is not null and s_end < s_start then
    raise exception 'La fin de la situation ne peut pas précéder son début.' using errcode = '22023';
  end if;

  -- Demandes à rattacher : visibles par l'élu ; celles à accès restreint restreignent le sujet
  for rid in select (jsonb_array_elements_text(coalesce(p -> 'request_ids', '[]'::jsonb)))::bigint loop
    r := private.require_visible(rid);
    if not r.visible_to_all then
      restricted_viewers := case when restricted_viewers is null
        then array(select elu_id from request_viewers where request_id = r.id)
        else array(select x from unnest(restricted_viewers) x
                   where x in (select elu_id from request_viewers where request_id = r.id)) end;
    end if;
  end loop;
  if not vis then
    select array_agg(e.id) into viewers from elus e
    where e.is_active and e.id::text in (select jsonb_array_elements_text(coalesce(p -> 'viewer_ids', '[]'::jsonb)));
    viewers := array(select distinct x from unnest(coalesce(viewers, '{}') || me.id) x);  -- l'auteur le voit toujours
  end if;
  if restricted_viewers is not null then
    vis := false;
    viewers := case when viewers is null then restricted_viewers
                    else array(select x from unnest(viewers) x where x = any (restricted_viewers)) end;
  end if;

  insert into subjects (number, title, description, category, kind, temporality, situation_start, situation_end,
                        priority, visible_to_all, created_by, assignee_id)
  values (private.new_subject_number(), left(trim(p ->> 'title'), 200), nullif(trim(p ->> 'description'), ''),
          trim(p ->> 'category'), k, case when k = 'signalement' then coalesce(nullif(p ->> 'temporality', ''), 'actuel') end,
          s_start, s_end, coalesce(nullif(p ->> 'priority', ''), 'normale'), vis, me.id,
          case when coalesce((p ->> 'take_charge')::boolean, true) then me.id end)
  returning * into s;
  if viewers is not null then
    insert into subject_viewers (subject_id, elu_id) select s.id, unnest(viewers);
  end if;
  perform private.subject_event(s.id, 'Sujet créé par ' || me.full_name);

  for rid in select (jsonb_array_elements_text(coalesce(p -> 'request_ids', '[]'::jsonb)))::bigint loop
    select * into r from requests where id = rid;
    perform private.attach_request(r, s);
  end loop;

  if nullif(p ->> 'meeting_id', '') is not null then
    m := private.require_editable((p ->> 'meeting_id')::bigint);
    select coalesce(max(position), 0) + 1 into pos from agenda_items where meeting_id = m.id;
    perform private.inscribe(m, s.id, pos, null);
  end if;
  return private.subject_detail(s.id);
end $$;

-- p : { title, description, category, kind, temporality, situation_start, situation_end, priority,
--       assignee_id, take_charge, due_date, status (ouvert | clos) }
create function public.update_subject(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s subjects;
  a elus;
  assignee uuid := nullif(p ->> 'assignee_id', '')::uuid;
  new_due date;
  s_start date;
  s_end date;
begin
  s := private.require_subject(p_id);
  if coalesce((p ->> 'take_charge')::boolean, false) then assignee := auth.uid(); end if;
  if assignee is not null and assignee is distinct from s.assignee_id then
    select * into a from elus where id = assignee and is_active;
    if a.id is null then raise exception 'Élu introuvable.' using errcode = 'P0002'; end if;
    if not s.visible_to_all and not exists (select 1 from subject_viewers where subject_id = s.id and elu_id = a.id) then
      raise exception 'Cet élu n''a pas accès à ce sujet.' using errcode = '42501';
    end if;
    update subjects set assignee_id = a.id where id = s.id;
    perform private.subject_event(s.id, 'Suivi par ' || a.full_name);
  end if;
  if nullif(trim(p ->> 'title'), '') is not null and trim(p ->> 'title') <> s.title then
    if char_length(trim(p ->> 'title')) < 3 then
      raise exception 'Donnez un intitulé d''au moins 3 caractères.' using errcode = '22023';
    end if;
    update subjects set title = left(trim(p ->> 'title'), 200) where id = s.id;
    perform private.subject_event(s.id, 'Intitulé modifié');
  end if;
  if p ? 'description' and nullif(trim(p ->> 'description'), '') is distinct from s.description then
    update subjects set description = nullif(trim(p ->> 'description'), '') where id = s.id;
    perform private.subject_event(s.id, 'Description mise à jour');
  end if;
  if nullif(p ->> 'category', '') is not null and p ->> 'category' <> s.category then
    update subjects set category = p ->> 'category' where id = s.id;
    perform private.subject_event(s.id, 'Thème : ' || (p ->> 'category'));
  end if;
  if nullif(p ->> 'kind', '') in ('demande', 'signalement') and p ->> 'kind' <> s.kind then
    update subjects set kind = p ->> 'kind',
      temporality = case when p ->> 'kind' = 'signalement' then coalesce(temporality, 'actuel') end,
      situation_start = case when p ->> 'kind' = 'signalement' then situation_start end,
      situation_end = case when p ->> 'kind' = 'signalement' then situation_end end
    where id = s.id returning * into s;
  end if;
  if s.kind = 'signalement' and nullif(p ->> 'temporality', '') in ('actuel', 'a_venir') then
    update subjects set temporality = p ->> 'temporality' where id = s.id returning * into s;
  end if;
  if nullif(p ->> 'priority', '') is not null and p ->> 'priority' <> s.priority then
    update subjects set priority = p ->> 'priority' where id = s.id;
    perform private.subject_event(s.id, 'Priorité : ' || (p ->> 'priority'));
  end if;
  if p ? 'due_date' then
    new_due := nullif(p ->> 'due_date', '')::date;
    if new_due is distinct from s.due_date then
      update subjects set due_date = new_due where id = s.id;
      perform private.subject_event(s.id, case when new_due is null then 'Échéance retirée'
                                               else 'Échéance : ' || private.fr_date(new_due) end);
    end if;
  end if;
  if s.kind = 'signalement' and (p ? 'situation_start' or p ? 'situation_end') then
    s_start := case when p ? 'situation_start' then nullif(p ->> 'situation_start', '')::date else s.situation_start end;
    s_end := case when p ? 'situation_end' then nullif(p ->> 'situation_end', '')::date else s.situation_end end;
    if s_start is not null and s_end is not null and s_end < s_start then
      raise exception 'La fin de la situation ne peut pas précéder son début.' using errcode = '22023';
    end if;
    if s_start is distinct from s.situation_start or s_end is distinct from s.situation_end then
      update subjects set situation_start = s_start, situation_end = s_end where id = s.id returning * into s;
      perform private.subject_event(s.id, 'Période : ' ||
        coalesce(nullif(private.period_text(s.temporality, s_start, s_end), ''), 'non renseignée'));
    end if;
  end if;
  if nullif(p ->> 'status', '') in ('ouvert', 'clos', 'repondu') then
    perform private.set_subject_status(s.id, p ->> 'status');
  end if;
  return private.subject_detail(p_id);
end $$;

-- p : { request_ids: [..] } : rattache des demandes à ce sujet
create function public.add_subject_requests(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s subjects; r requests; rid bigint;
begin
  s := private.require_subject(p_id);
  if s.status = 'clos' then
    raise exception 'Ce sujet est clos : rouvrez-le avant d''y rattacher une demande.' using errcode = '22023';
  end if;
  for rid in select (jsonb_array_elements_text(coalesce(p -> 'request_ids', '[]'::jsonb)))::bigint loop
    r := private.require_visible(rid);
    perform private.attach_request(r, s);
  end loop;
  return private.subject_detail(p_id);
end $$;

-- Note interne (p.answer = false) ou réponse aux salariés du sujet (p.answer = true, p.close)
create function public.add_subject_note(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s subjects; body text := trim(coalesce(p ->> 'body', ''));
begin
  s := private.require_subject(p_id);
  if char_length(body) = 0 then raise exception 'Le message est vide.' using errcode = '22023'; end if;
  if coalesce((p ->> 'answer')::boolean, false) then
    if s.status = 'clos' then
      raise exception 'Sujet clos : rouvrez-le avant de répondre.' using errcode = '22023';
    end if;
    perform private.answer_subject(s.id, body, coalesce((p ->> 'close')::boolean, false));
  else
    insert into subject_notes (subject_id, author_id, body) values (s.id, auth.uid(), body);
    update subjects set updated_at = now() where id = s.id;
  end if;
  return private.subject_detail(p_id);
end $$;

-- Fusion : le sujet p_id disparaît, tout passe dans p_into (demandes, engagements, notes, réunions)
create function public.merge_subjects(p_id bigint, p_into bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare src subjects; dst subjects; a agenda_items; r record;
begin
  src := private.require_subject(p_id);
  dst := private.require_subject(p_into);
  if src.id = dst.id then
    raise exception 'Choisissez un autre sujet.' using errcode = '22023';
  end if;
  for r in select * from requests where subject_id = src.id order by id loop
    update requests set subject_id = dst.id where id = r.id;
    perform private.add_event(r.id, 'Rattachée au sujet n° ' || dst.number || ' suivi par le CSE');
    if r.status in ('nouvelle', 'en_cours', 'inscrite_odj') then
      perform private.set_status(r.id, case when dst.status = 'inscrit_odj' then 'inscrite_odj' else 'en_cours' end);
    end if;
  end loop;
  for a in select * from agenda_items where subject_id = src.id loop
    if exists (select 1 from agenda_items where meeting_id = a.meeting_id and subject_id = dst.id) then
      update agenda_items set outcome = nullif(concat_ws(E'\n', outcome, a.outcome), '')
      where meeting_id = a.meeting_id and subject_id = dst.id and a.outcome is not null;
      delete from agenda_items where id = a.id;
    else
      update agenda_items set subject_id = dst.id where id = a.id;
    end if;
  end loop;
  update commitments set subject_id = dst.id where subject_id = src.id;
  update subject_notes set subject_id = dst.id where subject_id = src.id;
  insert into subject_notes (subject_id, author_id, body)
  select dst.id, auth.uid(), 'Description du sujet n° ' || src.number || E' (fusionné) :\n' || src.description
  where nullif(trim(src.description), '') is not null;
  update subject_events set subject_id = dst.id where subject_id = src.id;
  perform private.subject_event(dst.id, 'Sujet n° ' || src.number || ' « ' || src.title || ' » fusionné dans ce sujet');
  if dst.status = 'clos' and exists (select 1 from requests where subject_id = dst.id and status <> 'close') then
    perform private.set_subject_status(dst.id, 'ouvert');
  end if;
  select status into dst.status from subjects where id = dst.id;
  if dst.status = 'ouvert' and exists (select 1 from agenda_items ai join meetings mt on mt.id = ai.meeting_id
                                       where ai.subject_id = dst.id and mt.status = 'planifiee') then
    perform private.set_subject_status(dst.id, 'inscrit_odj');
  end if;
  delete from subjects where id = src.id;
  return private.subject_detail(dst.id);
end $$;

-- Supprimer un sujet : ses demandes redeviennent sans sujet ; impossible s'il est passé en réunion tenue
create function public.delete_subject(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s subjects; r record;
begin
  s := private.require_subject(p_id);
  if exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
             where a.subject_id = s.id and m.status = 'tenue') then
    raise exception 'Ce sujet est passé en réunion : clôturez-le plutôt que de le supprimer.' using errcode = '22023';
  end if;
  for r in select * from requests where subject_id = s.id loop
    perform private.add_event(r.id, 'Détachée de son sujet', false);
    if r.status = 'inscrite_odj' then perform private.set_status(r.id, 'en_cours'); end if;
  end loop;
  update requests set subject_id = null where subject_id = s.id;
  delete from subjects where id = s.id;
end $$;

-- Engagement de la direction sur un sujet : p = { text, due_date, meeting_id, public }
create function public.add_commitment(p_subject_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s subjects; d date; txt text := trim(coalesce(p ->> 'text', '')); pub boolean := coalesce((p ->> 'public')::boolean, true);
  r record;
begin
  s := private.require_subject(p_subject_id);
  d := nullif(p ->> 'due_date', '')::date;
  if d is null then raise exception 'Indiquez le délai annoncé par la direction.' using errcode = '22023'; end if;
  if char_length(txt) < 3 then raise exception 'Décrivez ce que la direction s''est engagée à faire.' using errcode = '22023'; end if;
  insert into commitments (subject_id, text, due_date, meeting_id, public, created_by)
  values (s.id, left(txt, 2000), d, nullif(p ->> 'meeting_id', '')::bigint, pub, auth.uid());
  perform private.subject_event(s.id, 'Engagement de la direction, délai au ' || private.fr_date(d) || ' : ' || left(txt, 200));
  for r in select id from requests where subject_id = s.id loop
    perform private.add_event(r.id, 'Engagement de la direction, délai au ' || private.fr_date(d) || ' : ' || left(txt, 200), pub);
  end loop;
  return private.subject_detail(s.id);
end $$;

-- p = { status: en_attente | tenu | non_tenu, due_date (report), text }
create function public.update_commitment(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c commitments; d date; lbl text; r record;
begin
  perform private.require_elu();
  select * into c from commitments where id = p_id;
  if c.id is null or not public.can_see_subject(c.subject_id) then
    raise exception 'Engagement introuvable.' using errcode = 'P0002';
  end if;
  if nullif(trim(p ->> 'text'), '') is not null and trim(p ->> 'text') <> c.text then
    update commitments set text = left(trim(p ->> 'text'), 2000) where id = c.id;
  end if;
  d := nullif(p ->> 'due_date', '')::date;
  if d is not null and d <> c.due_date then
    update commitments set due_date = d where id = c.id;
    lbl := 'Délai de l''engagement reporté au ' || private.fr_date(d);
  end if;
  if nullif(p ->> 'status', '') is not null and p ->> 'status' <> c.status then
    update commitments set status = p ->> 'status',
      closed_at = case when p ->> 'status' = 'en_attente' then null else now() end where id = c.id;
    lbl := case p ->> 'status'
      when 'tenu' then 'Engagement de la direction tenu'
      when 'non_tenu' then 'Engagement de la direction non tenu'
      else 'Engagement de la direction de nouveau en attente' end;
  end if;
  if lbl is not null then
    perform private.subject_event(c.subject_id, lbl);
    for r in select id from requests where subject_id = c.subject_id loop
      perform private.add_event(r.id, lbl, c.public);
    end loop;
  end if;
  return private.subject_detail(c.subject_id);
end $$;

create function public.delete_commitment(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c commitments;
begin
  perform private.require_elu();
  select * into c from commitments where id = p_id;
  if c.id is null or not public.can_see_subject(c.subject_id) then
    raise exception 'Engagement introuvable.' using errcode = 'P0002';
  end if;
  delete from commitments where id = c.id;
  perform private.subject_event(c.subject_id, 'Engagement de la direction retiré');
  return private.subject_detail(c.subject_id);
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

create function private.on_other_planned_agenda(sid bigint, except_item bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
                 where a.subject_id = sid and m.status = 'planifiee' and a.id <> except_item)
$$;

create function private.release_item(a public.agenda_items) returns void
language plpgsql security definer set search_path = public as $$
declare st text; r record;
begin
  if a.subject_id is null or a.discussed then return; end if;
  perform private.subject_event(a.subject_id, 'Retiré de l''ordre du jour');
  for r in select id from requests where subject_id = a.subject_id and status <> 'close' loop
    perform private.add_event(r.id, 'Retirée de l''ordre du jour');
  end loop;
  select status into st from subjects where id = a.subject_id;
  if st = 'inscrit_odj' and not private.on_other_planned_agenda(a.subject_id, a.id) then
    perform private.set_subject_status(a.subject_id, 'ouvert');
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

-- Sujets en cours, non inscrits à une réunion planifiée, classés par pertinence
create function private.proposal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w jsonb; total int; items jsonb;
begin
  select odj_weights into w from settings where id = 1;
  with pending as (
    select s.* from subjects s
    where s.status in ('ouvert', 'inscrit_odj')
      and not exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
                      where a.subject_id = s.id and m.status = 'planifiee')
      and public.can_see_subject(s.id)
  ), scored as (
    select p.id, p.created_at, p.priority, p.kind, p.temporality, p.status, d.days, nc.n,
      coalesce((w ->> p.priority)::int, 0)
        + d.days * coalesce((w ->> 'par_jour')::int, 1)
        + greatest(nc.n - 1, 0) * 5
        + case when p.kind = 'signalement' and p.temporality = 'actuel'
               then coalesce((w ->> 'signalement_actuel')::int, 15) else 0 end as score
    from pending p
    cross join lateral (select count(*) as n, min(r.created_at) as first_at from requests r where r.subject_id = p.id) nc
    cross join lateral (select greatest(private.today() - (least(p.created_at, coalesce(nc.first_at, p.created_at))
                                                          at time zone 'Europe/Paris')::date, 0) as days) d
  ), top as (
    select * from scored order by score desc, created_at limit coalesce((w ->> 'max_points')::int, 15)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'subject', private.subject_summary(sj),
      'score', t.score,
      'wording', private.suggest_wording(sj),
      'reasons', to_jsonb(array_remove(array[
          case when t.priority = 'haute' then 'Priorité haute' end,
          case when t.days >= 7 then 'En attente depuis ' || t.days || ' jours' end,
          case when t.kind = 'signalement' and t.temporality = 'actuel' then 'Situation actuelle' end,
          case when t.status = 'inscrit_odj' then 'Déjà passé en réunion, toujours sans réponse' end,
          case when t.n > 1 then 'Soulevé par ' || t.n || ' salariés' end,
          case when t.n = 0 then 'Question des élus' end], null)))
      order by t.score desc, t.created_at), '[]'::jsonb)
  into items from top t join subjects sj on sj.id = t.id;

  select count(*) into total from subjects s
  where s.status in ('ouvert', 'inscrit_odj')
    and not exists (select 1 from agenda_items a join meetings m on m.id = a.meeting_id
                    where a.subject_id = s.id and m.status = 'planifiee')
    and not public.can_see_subject(s.id);
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
    'request_points', (select count(*) from agenda_items a where a.meeting_id = m.id and a.subject_id is not null),
    'missing_wording', (select count(*) from agenda_items a where a.meeting_id = m.id and a.subject_id is not null
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
    'to_triage', (select count(*) from requests r where r.subject_id is null and r.status in ('nouvelle', 'en_cours')
                  and public.can_see_request(r.id)),
    'pending', jsonb_array_length(private.proposal() -> 'items'));
end $$;

-- Inscrit un sujet à l'ODJ (avec la formulation proposée si aucune n'est fournie)
create function private.inscribe(m public.meetings, sid bigint, pos int, p_wording text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare s subjects; item_id bigint; c record;
begin
  select * into s from subjects where id = sid;
  insert into agenda_items (meeting_id, subject_id, wording, position)
  values (m.id, s.id, coalesce(nullif(trim(p_wording), ''), private.suggest_wording(s)), pos)
  returning id into item_id;
  perform private.subject_event(s.id, 'Inscrit à l''ordre du jour de la réunion du ' || private.fr_date(m.meeting_date));
  for c in select id from requests where subject_id = s.id and status <> 'close' order by id loop
    perform private.add_event(c.id, 'Inscrite à l''ordre du jour de la réunion du ' || private.fr_date(m.meeting_date));
  end loop;
  if s.status in ('ouvert', 'repondu') then
    perform private.set_subject_status(s.id, 'inscrit_odj');
  end if;
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

-- p : { subject_id, wording } ou { title, wording, recurring, recurrence: { every, months, end_date } }
create function public.add_agenda_item(p_meeting_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m meetings;
  s subjects;
  pos int;
  item_id bigint;
  sid bigint := nullif(p ->> 'subject_id', '')::bigint;
  rule jsonb := nullif(p -> 'recurrence', 'null'::jsonb);
begin
  m := private.require_editable(p_meeting_id);
  select coalesce(max(position), 0) + 1 into pos from agenda_items where meeting_id = m.id;
  if sid is not null then
    s := private.require_subject(sid);
    if exists (select 1 from agenda_items where meeting_id = m.id and subject_id = s.id) then
      raise exception 'Ce sujet est déjà à l''ordre du jour.' using errcode = '23505';
    end if;
    if s.status = 'clos' then raise exception 'Sujet clos.' using errcode = '22023'; end if;
    perform private.inscribe(m, s.id, pos, p ->> 'wording');
  else
    if char_length(trim(coalesce(p ->> 'title', ''))) = 0 then
      raise exception 'Indiquez un sujet ou un intitulé de point.' using errcode = '22023';
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

-- Génère l'ordre du jour : points fixes d'ouverture, sujets proposés, points fixes de clôture.
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
      where meeting_id = m.id and subject_id is null and lower(trim(title)) = lower(t)
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
    new_id := private.inscribe(m, (pi -> 'subject' ->> 'id')::bigint, 0, pi ->> 'wording');
    middle := middle || new_id;
  end loop;

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
  if a.subject_id is not null and not public.can_see_subject(a.subject_id) then
    raise exception 'Ce point est à accès restreint.' using errcode = '42501';
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
  if a.subject_id is null and nullif(trim(p ->> 'title'), '') is not null then
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

  if a.subject_id is null then
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

  if a.subject_id is not null and coalesce((p ->> 'send_as_answer')::boolean, false) then
    if a.outcome is null then
      raise exception 'Saisissez d''abord le relevé de décision.' using errcode = '22023';
    end if;
    body := 'Réponse suite à la réunion du ' || private.fr_date(m.meeting_date) || E' :\n\n' || a.outcome;
    update agenda_items set discussed = true where id = a.id;
    perform private.answer_subject(a.subject_id, body, false);
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
    -- Sujets déjà passés à une réunion tenue antérieure : « questions des PV précédents »
    'held_before', coalesce((select jsonb_agg(distinct a.subject_id) from agenda_items a join meetings o on o.id = a.meeting_id
                             where o.status = 'tenue' and o.id <> m.id and o.meeting_date <= m.meeting_date
                               and a.subject_id is not null), '[]'::jsonb),
    'categories', to_jsonb(s.categories),
    'word', s.word_settings);
end $$;

-- -----------------------------------------------------------------------------
--  Élus — votes du CSE
--  En séance : la question est préparée (facultatif), puis un élu note le nombre
--  de voix. En ligne : chaque élu ayant le droit de vote vote dans l'appli ;
--  les résultats ne sont visibles qu'à la clôture (date limite ou clôture manuelle).
--  Bulletin secret : personne, même un administrateur, ne voit qui a voté quoi.
-- -----------------------------------------------------------------------------

create function private.is_standard_vote(opts text[]) returns boolean language sql immutable as $$
  select opts = array['Pour', 'Contre', 'Abstention']
$$;

create function private.vote_closed(v public.votes) returns boolean language sql stable as $$
  select v.status = 'clos' or (v.mode = 'en_ligne' and v.deadline is not null and v.deadline <= now())
$$;

-- Nombre de voix par réponse
create function private.vote_counts(v public.votes) returns int[]
language plpgsql stable security definer set search_path = public as $$
declare out int[];
begin
  if v.mode = 'seance' then return v.tally; end if;
  if v.secret then
    select array_agg(coalesce(t.n, 0) order by i) into out
    from generate_subscripts(v.options, 1) i
    left join vote_secret_tally t on t.vote_id = v.id and t.choice = i - 1;
  else
    select array_agg((select count(*)::int from vote_ballots b where b.vote_id = v.id and b.choice = i - 1) order by i)
    into out from generate_subscripts(v.options, 1) i;
  end if;
  return out;
end $$;

-- Pour / contre / abstention : résolution adoptée à la majorité des votants (les abstentions comptent)
create function private.vote_result(opts text[], counts int[]) returns text
language plpgsql immutable as $$
declare total int;
begin
  if counts is null or not private.is_standard_vote(opts) then return null; end if;
  select coalesce(sum(c), 0) into total from unnest(counts) c;
  if total = 0 then return null; end if;
  return case when counts[1] * 2 > total then 'adopte' else 'rejete' end;
end $$;

create function private.vote_json(v public.votes, detailed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  closed boolean := private.vote_closed(v);
  visible boolean;
  counts int[];
  total int;
  mine smallint;
  voted boolean := false;
  subj bigint;
  out jsonb;
begin
  -- En ligne : résultats cachés jusqu'à la clôture. En séance : dès que le résultat est noté.
  visible := (v.mode = 'seance' and v.tally is not null) or (v.mode = 'en_ligne' and closed);
  if visible then counts := private.vote_counts(v); end if;
  select coalesce(sum(c), 0) into total from unnest(counts) c;
  select b.choice, true into mine, voted from vote_ballots b where b.vote_id = v.id and b.elu_id = auth.uid();
  select a.subject_id into subj from agenda_items a where a.id = v.agenda_item_id;
  out := jsonb_build_object(
    'id', v.id, 'title', v.title, 'description', v.description, 'mode', v.mode, 'options', to_jsonb(v.options),
    'secret', v.secret, 'deadline', v.deadline, 'created_at', v.created_at, 'closed_at', v.closed_at,
    'status', case when closed then 'clos' else 'ouvert' end,
    'recorded', v.mode = 'en_ligne' or v.tally is not null,
    'standard', private.is_standard_vote(v.options),
    'counts', to_jsonb(counts),
    'total', case when visible then total end,
    'result', case when visible then private.vote_result(v.options, counts) end,
    'winners', case when visible and total > 0 and not private.is_standard_vote(v.options) then
                 (select jsonb_agg(v.options[i] order by i) from generate_subscripts(v.options, 1) i
                  where counts[i] = (select max(c) from unnest(counts) c)) end,
    'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'meeting_date', m.meeting_date, 'status', m.status)
                from meetings m where m.id = v.meeting_id),
    'agenda_item_id', v.agenda_item_id,
    'subject', case when subj is not null then private.subject_ref(subj) end,
    'created_by', private.elu_json(v.created_by),
    'can_manage', coalesce(v.created_by = auth.uid(), false) or public.is_admin(),
    'voters_count', (select count(*) from vote_ballots b where b.vote_id = v.id),
    'eligible_count', (select count(*) from elus e where e.is_active and e.can_vote),
    'i_voted', coalesce(voted, false),
    'my_choice', case when v.secret then null else mine end,
    'can_vote', v.mode = 'en_ligne' and not closed
                and exists (select 1 from elus e where e.id = auth.uid() and e.is_active and e.can_vote)
                and not (v.secret and coalesce(voted, false)));
  if detailed then
    out := out || jsonb_build_object(
      'voters', coalesce((select jsonb_agg(e.full_name order by e.full_name)
                          from vote_ballots b join elus e on e.id = b.elu_id where b.vote_id = v.id), '[]'::jsonb),
      'not_voted', case when v.mode = 'en_ligne' then
                     coalesce((select jsonb_agg(e.full_name order by e.full_name) from elus e
                               where e.is_active and e.can_vote
                                 and not exists (select 1 from vote_ballots b where b.vote_id = v.id and b.elu_id = e.id)),
                              '[]'::jsonb) end,
      'by_option', case when visible and v.mode = 'en_ligne' and not v.secret then
                     (select jsonb_agg(coalesce((select jsonb_agg(e.full_name order by e.full_name)
                                                 from vote_ballots b join elus e on e.id = b.elu_id
                                                 where b.vote_id = v.id and b.choice = i - 1), '[]'::jsonb) order by i)
                      from generate_subscripts(v.options, 1) i) end);
  end if;
  return out;
end $$;

create function private.require_vote(vid bigint) returns public.votes
language plpgsql stable security definer set search_path = public as $$
declare v public.votes;
begin
  perform private.require_elu();
  select * into v from votes where id = vid;
  if v.id is null then raise exception 'Vote introuvable.' using errcode = 'P0002'; end if;
  return v;
end $$;

-- Réponses d'un vote en ligne : « Pour, Contre, Abstention » par défaut, ou 2 à 8 choix libres
create function private.vote_options(x jsonb, md text) returns text[]
language plpgsql immutable as $$
declare opts text[];
begin
  if md = 'seance' or x is null or jsonb_typeof(x) <> 'array' or jsonb_array_length(x) = 0 then
    return array['Pour', 'Contre', 'Abstention'];
  end if;
  select array_agg(o order by first) into opts from (
    select trim(e) o, min(ord) first from jsonb_array_elements_text(x) with ordinality as t(e, ord)
    where trim(coalesce(e, '')) <> '' group by trim(e)) s;
  if coalesce(array_length(opts, 1), 0) not between 2 and 8 then
    raise exception 'Proposez entre 2 et 8 réponses différentes.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(opts) o where char_length(o) > 120) then
    raise exception 'Une réponse est trop longue (120 caractères au plus).' using errcode = '22023';
  end if;
  return opts;
end $$;

-- Date limite : un jour (AAAA-MM-JJ) compte jusqu'au soir, heure de Paris
create function private.vote_deadline(x text) returns timestamptz
language plpgsql stable as $$
declare d timestamptz;
begin
  if nullif(trim(coalesce(x, '')), '') is null then return null; end if;
  if x ~ '^\d{4}-\d{2}-\d{2}$' then
    d := ((x::date + 1)::timestamp) at time zone 'Europe/Paris';
  else
    d := x::timestamptz;
  end if;
  if d <= now() then raise exception 'La date limite est déjà passée.' using errcode = '22023'; end if;
  return d;
end $$;

-- Résultat d'un vote en séance : nombre de voix par réponse ; null = à noter de nouveau
create function private.record_tally(v public.votes, x jsonb) returns public.votes
language plpgsql volatile security definer set search_path = public as $$
declare t int[];
begin
  if v.mode <> 'seance' then
    raise exception 'Le résultat d''un vote en ligne vient des votes des élus.' using errcode = '22023';
  end if;
  if x is null or jsonb_typeof(x) = 'null' then
    update votes set tally = null, status = 'ouvert', closed_at = null where id = v.id returning * into v;
    return v;
  end if;
  if jsonb_typeof(x) <> 'array' or exists (select 1 from jsonb_array_elements(x) e
                                           where jsonb_typeof(e) not in ('number', 'null')
                                             and not (jsonb_typeof(e) = 'string' and e #>> '{}' ~ '^\s*\d{0,3}\s*$')) then
    raise exception 'Indiquez le nombre de voix pour chaque réponse.' using errcode = '22023';
  end if;
  select array_agg(coalesce(nullif(trim(e), '')::int, 0) order by ord) into t
  from jsonb_array_elements_text(x) with ordinality as a(e, ord);
  if coalesce(array_length(t, 1), 0) <> array_length(v.options, 1) or exists (select 1 from unnest(t) n where n < 0 or n > 999) then
    raise exception 'Indiquez le nombre de voix pour chaque réponse.' using errcode = '22023';
  end if;
  if (select sum(n) from unnest(t) n) = 0 then
    raise exception 'Aucune voix : vérifiez le résultat.' using errcode = '22023';
  end if;
  update votes set tally = t, status = 'clos', closed_at = coalesce(closed_at, now()) where id = v.id returning * into v;
  return v;
end $$;

create function public.list_votes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  return coalesce((select jsonb_agg(private.vote_json(v) order by v.created_at desc, v.id desc) from votes v), '[]'::jsonb);
end $$;

create function public.get_vote(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return private.vote_json(private.require_vote(p_id), true);
end $$;

-- p : { title, description, mode (seance | en_ligne), options, secret, meeting_id, agenda_item_id, deadline, tally }
create function public.create_vote(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v votes;
  md text := coalesce(nullif(p ->> 'mode', ''), 'seance');
  mid bigint := nullif(p ->> 'meeting_id', '')::bigint;
  iid bigint := nullif(p ->> 'agenda_item_id', '')::bigint;
begin
  perform private.require_elu();
  if md not in ('seance', 'en_ligne') then raise exception 'Type de vote inconnu.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p ->> 'title', ''))) < 3 then
    raise exception 'Indiquez la question soumise au vote.' using errcode = '22023';
  end if;
  if mid is not null and not exists (select 1 from meetings where id = mid) then
    raise exception 'Réunion introuvable.' using errcode = 'P0002';
  end if;
  if iid is not null and not exists (select 1 from agenda_items where id = iid and meeting_id = mid) then
    raise exception 'Ce point n''est pas à l''ordre du jour de cette réunion.' using errcode = '22023';
  end if;
  insert into votes (title, description, mode, options, secret, meeting_id, agenda_item_id, deadline, created_by)
  values (trim(p ->> 'title'), nullif(trim(p ->> 'description'), ''), md, private.vote_options(p -> 'options', md),
          coalesce((p ->> 'secret')::boolean, false), mid, iid,
          case when md = 'en_ligne' then private.vote_deadline(p ->> 'deadline') end, auth.uid())
  returning * into v;
  if md = 'seance' and jsonb_typeof(p -> 'tally') = 'array' then
    v := private.record_tally(v, p -> 'tally');
  end if;
  return private.vote_json(v, true);
end $$;

-- p : { title, description, meeting_id, agenda_item_id, deadline, tally (en séance ; null = à noter de nouveau) }
create function public.update_vote(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v votes; mid bigint; iid bigint;
begin
  v := private.require_vote(p_id);
  if (p ? 'title' or p ? 'description') and v.mode = 'en_ligne'
     and exists (select 1 from vote_ballots where vote_id = v.id) then
    raise exception 'Des élus ont déjà voté : la question ne peut plus être modifiée.' using errcode = '22023';
  end if;
  if p ? 'title' then
    if char_length(trim(coalesce(p ->> 'title', ''))) < 3 then
      raise exception 'Indiquez la question soumise au vote.' using errcode = '22023';
    end if;
    update votes set title = trim(p ->> 'title') where id = v.id;
  end if;
  if p ? 'description' then update votes set description = nullif(trim(p ->> 'description'), '') where id = v.id; end if;
  if p ? 'meeting_id' or p ? 'agenda_item_id' then
    mid := case when p ? 'meeting_id' then nullif(p ->> 'meeting_id', '')::bigint else v.meeting_id end;
    iid := case when p ? 'agenda_item_id' then nullif(p ->> 'agenda_item_id', '')::bigint
                when mid is distinct from v.meeting_id then null else v.agenda_item_id end;
    if mid is not null and not exists (select 1 from meetings where id = mid) then
      raise exception 'Réunion introuvable.' using errcode = 'P0002';
    end if;
    if iid is not null and not exists (select 1 from agenda_items where id = iid and meeting_id = mid) then
      raise exception 'Ce point n''est pas à l''ordre du jour de cette réunion.' using errcode = '22023';
    end if;
    update votes set meeting_id = mid, agenda_item_id = iid where id = v.id;
  end if;
  if p ? 'deadline' then
    if v.mode <> 'en_ligne' then raise exception 'Seul un vote en ligne a une date limite.' using errcode = '22023'; end if;
    if private.vote_closed(v) then raise exception 'Ce vote est clos.' using errcode = '22023'; end if;
    update votes set deadline = private.vote_deadline(p ->> 'deadline') where id = v.id;
  end if;
  if p ? 'tally' then
    select * into v from votes where id = p_id;
    perform private.record_tally(v, p -> 'tally');
  end if;
  select * into v from votes where id = p_id;
  return private.vote_json(v, true);
end $$;

-- Voter (en ligne). Vote nominatif : on peut changer d'avis jusqu'à la clôture.
create function public.cast_vote(p_id bigint, p_choice int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v votes;
begin
  v := private.require_vote(p_id);
  if v.mode <> 'en_ligne' then raise exception 'Ce vote a lieu en séance.' using errcode = '22023'; end if;
  if private.vote_closed(v) then raise exception 'Ce vote est clos.' using errcode = '22023'; end if;
  if not exists (select 1 from elus where id = auth.uid() and is_active and can_vote) then
    raise exception 'Votre compte n''a pas le droit de vote.' using errcode = '42501';
  end if;
  if p_choice is null or p_choice < 0 or p_choice >= array_length(v.options, 1) then
    raise exception 'Réponse inconnue.' using errcode = '22023';
  end if;
  if v.secret then
    if exists (select 1 from vote_ballots where vote_id = v.id and elu_id = auth.uid()) then
      raise exception 'Vous avez déjà voté : un vote à bulletin secret ne se modifie pas.' using errcode = '22023';
    end if;
    insert into vote_ballots (vote_id, elu_id) values (v.id, auth.uid());
    insert into vote_secret_tally (vote_id, choice, n) values (v.id, p_choice, 1)
    on conflict (vote_id, choice) do update set n = vote_secret_tally.n + 1;
  else
    insert into vote_ballots (vote_id, elu_id, choice) values (v.id, auth.uid(), p_choice)
    on conflict (vote_id, elu_id) do update set choice = excluded.choice, voted_at = now();
  end if;
  return private.vote_json(v, true);
end $$;

-- Clore un vote en ligne avant sa date limite : son auteur ou un administrateur
create function public.close_vote(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v votes;
begin
  v := private.require_vote(p_id);
  if v.mode <> 'en_ligne' then raise exception 'Un vote en séance se clôt en notant son résultat.' using errcode = '22023'; end if;
  if not (coalesce(v.created_by = auth.uid(), false) or public.is_admin()) then
    raise exception 'Seuls l''auteur du vote et les administrateurs peuvent le clore.' using errcode = '42501';
  end if;
  if not private.vote_closed(v) then
    update votes set status = 'clos', closed_at = now() where id = v.id returning * into v;
  end if;
  return private.vote_json(v, true);
end $$;

create function public.delete_vote(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v votes;
begin
  v := private.require_vote(p_id);
  if not (coalesce(v.created_by = auth.uid(), false) or public.is_admin()) then
    raise exception 'Seuls l''auteur du vote et les administrateurs peuvent le supprimer.' using errcode = '42501';
  end if;
  delete from votes where id = v.id;
end $$;

-- -----------------------------------------------------------------------------
--  Élus — prêts de matériel aux salariés
--  Un prêt est réservé (à venir), sorti (remis au salarié), rendu ou annulé.
--  La disponibilité tient compte des quantités : réserver deux tentes sur trois
--  laisse une tente disponible aux mêmes dates.
-- -----------------------------------------------------------------------------

-- Fin de l'occupation du matériel. Un prêt sorti et en retard le bloque tant qu'il n'est pas rendu.
create function private.loan_end(l public.loans) returns date language sql stable as $$
  select case when l.status = 'sorti' and l.due_date < private.today() then 'infinity'::date else l.due_date end
$$;

-- Quantité disponible chaque jour de d1 à d2 (la plus petite), sans compter le prêt except_loan
create function private.equipment_free(eid bigint, d1 date, d2 date, except_loan bigint default null) returns int
language sql stable security definer set search_path = public as $$
  select e.quantity - coalesce((
    select max(used) from (
      select (select coalesce(sum(l.quantity), 0) from loans l
              where l.equipment_id = eid and l.status in ('reserve', 'sorti') and l.id is distinct from except_loan
                and l.start_date <= d::date and private.loan_end(l) >= d::date) used
      from generate_series(d1, greatest(d1, d2), interval '1 day') d) x), 0)::int
  from equipment e where e.id = eid
$$;

create function private.equipment_json(e public.equipment) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(e) || jsonb_build_object(
    'available_today', private.equipment_free(e.id, private.today(), private.today()),
    'out_now', (select coalesce(sum(l.quantity), 0) from loans l where l.equipment_id = e.id and l.status = 'sorti'),
    'reserved', (select coalesce(sum(l.quantity), 0) from loans l where l.equipment_id = e.id and l.status = 'reserve'),
    'loan_count', (select count(*) from loans l where l.equipment_id = e.id))
$$;

create function private.loan_json(l public.loans) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(l) - 'created_by' || jsonb_build_object(
    'equipment', jsonb_build_object('id', e.id, 'name', e.name, 'quantity', e.quantity, 'active', e.active),
    'late', l.status = 'sorti' and l.due_date < private.today(),
    'to_hand', l.status = 'reserve' and l.start_date <= private.today(),
    'created_by', private.elu_json(l.created_by))
  from equipment e where e.id = l.equipment_id
$$;

create function private.check_loan_dates(d1 date, d2 date) returns void
language plpgsql immutable as $$
begin
  if d1 is null or d2 is null then raise exception 'Indiquez les dates de sortie et de retour.' using errcode = '22023'; end if;
  if d2 < d1 then raise exception 'Le retour ne peut pas précéder la sortie.' using errcode = '22023'; end if;
  if d2 - d1 > 366 then raise exception 'Un prêt dure au plus un an.' using errcode = '22023'; end if;
end $$;

create function private.require_free(eid bigint, d1 date, d2 date, q int, except_loan bigint default null) returns void
language plpgsql stable security definer set search_path = public as $$
declare free int := private.equipment_free(eid, d1, d2, except_loan);
begin
  if free < q then
    raise exception '%', case when free <= 0 then 'Ce matériel n''est pas disponible sur ces dates.'
                              else 'Seulement ' || free || ' disponible' || case when free > 1 then 's' else '' end
                                   || ' sur ces dates.' end
      using errcode = '22023';
  end if;
end $$;

create function public.list_equipment() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  return coalesce((select jsonb_agg(private.equipment_json(e) order by e.active desc, lower(e.name), e.id)
                   from equipment e), '[]'::jsonb);
end $$;

-- p : { id (modification), name, description, quantity, deposit, location, active }
create function public.save_equipment(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare e equipment; q int; busy int;
begin
  perform private.require_elu();
  if p ? 'id' and nullif(p ->> 'id', '') is not null then
    select * into e from equipment where id = (p ->> 'id')::bigint;
    if e.id is null then raise exception 'Matériel introuvable.' using errcode = 'P0002'; end if;
  end if;
  if p ? 'name' or e.id is null then
    if char_length(trim(coalesce(p ->> 'name', ''))) < 2 then
      raise exception 'Indiquez le nom du matériel.' using errcode = '22023';
    end if;
  end if;
  q := coalesce(nullif(p ->> 'quantity', '')::int, e.quantity, 1);
  if q < 1 or q > 999 then raise exception 'Quantité : de 1 à 999.' using errcode = '22023'; end if;
  if e.id is not null and q < e.quantity then
    -- Pas moins que ce qui est déjà sorti ou réservé en même temps
    select coalesce(max(used), 0) into busy from (
      select (select coalesce(sum(l.quantity), 0) from loans l
              where l.equipment_id = e.id and l.status in ('reserve', 'sorti')
                and l.start_date <= d::date and private.loan_end(l) >= d::date) used
      from generate_series(private.today(),
                           greatest(private.today(), least(private.today() + 400,
                                    (select max(private.loan_end(l)) from loans l
                                     where l.equipment_id = e.id and l.status in ('reserve', 'sorti')))),
                           interval '1 day') d) x;
    if q < busy then
      raise exception '% déjà prêté(s) ou réservé(s) en même temps : la quantité ne peut pas descendre sous %.', busy, busy
        using errcode = '22023';
    end if;
  end if;
  if nullif(p ->> 'deposit', '') is not null and (p ->> 'deposit')::numeric < 0 then
    raise exception 'La caution ne peut pas être négative.' using errcode = '22023';
  end if;
  if e.id is null then
    insert into equipment (name, description, quantity, deposit, location, active)
    values (trim(p ->> 'name'), nullif(trim(p ->> 'description'), ''), q, nullif(p ->> 'deposit', '')::numeric,
            nullif(trim(p ->> 'location'), ''), coalesce((p ->> 'active')::boolean, true))
    returning * into e;
  else
    update equipment set
      name = case when p ? 'name' then trim(p ->> 'name') else name end,
      description = case when p ? 'description' then nullif(trim(p ->> 'description'), '') else description end,
      quantity = q,
      deposit = case when p ? 'deposit' then nullif(p ->> 'deposit', '')::numeric else deposit end,
      location = case when p ? 'location' then nullif(trim(p ->> 'location'), '') else location end,
      active = coalesce((p ->> 'active')::boolean, active)
    where id = e.id returning * into e;
  end if;
  return private.equipment_json(e);
end $$;

create function public.delete_equipment(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_elu();
  if exists (select 1 from loans where equipment_id = p_id) then
    raise exception 'Ce matériel a déjà été prêté : retirez-le du prêt plutôt que de le supprimer, pour garder l''historique.'
      using errcode = '22023';
  end if;
  delete from equipment where id = p_id;
  if not found then raise exception 'Matériel introuvable.' using errcode = 'P0002'; end if;
end $$;

-- Quantité disponible sur une période (formulaire de prêt)
create function public.equipment_availability(p_id bigint, p_from date, p_to date, p_except bigint default null) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_elu();
  perform private.check_loan_dates(p_from, p_to);
  return private.equipment_free(p_id, p_from, p_to, p_except);
end $$;

-- p : { vue (en_cours | rendus | tous), q, equipment_id }
create function public.list_loans(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare vue text := coalesce(nullif(p ->> 'vue', ''), 'en_cours'); q text := nullif(trim(p ->> 'q'), '');
begin
  perform private.require_elu();
  return coalesce((select jsonb_agg(private.loan_json(l) order by
                     case when l.status = 'sorti' and l.due_date < private.today() then 0
                          when l.status = 'sorti' then 1 when l.status = 'reserve' then 2 else 3 end,
                     case when l.status in ('sorti', 'reserve') then l.due_date end,
                     case when l.status = 'reserve' then l.start_date end,
                     coalesce(l.returned_on, l.due_date) desc, l.id desc)
                   from loans l join equipment e on e.id = l.equipment_id
                   where (vue = 'tous' or (vue = 'en_cours' and l.status in ('reserve', 'sorti'))
                          or (vue = 'rendus' and l.status in ('rendu', 'annule')))
                     and (nullif(p ->> 'equipment_id', '') is null or l.equipment_id = (p ->> 'equipment_id')::bigint)
                     and (q is null or l.borrower_name ilike '%' || q || '%' or l.borrower_service ilike '%' || q || '%'
                          or e.name ilike '%' || q || '%')
                   limit 500), '[]'::jsonb);
end $$;

-- p : { equipment_id, quantity, borrower_name, borrower_service, borrower_contact, start_date, due_date,
--       out_now (remis tout de suite), deposit, deposit_received, notes }
create function public.create_loan(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e equipment; l loans;
  q int := coalesce(nullif(p ->> 'quantity', '')::int, 1);
  d1 date := coalesce(nullif(p ->> 'start_date', '')::date, private.today());
  d2 date := nullif(p ->> 'due_date', '')::date;
  out_now boolean := coalesce((p ->> 'out_now')::boolean, false);
begin
  perform private.require_elu();
  select * into e from equipment where id = nullif(p ->> 'equipment_id', '')::bigint;
  if e.id is null then raise exception 'Choisissez le matériel prêté.' using errcode = '22023'; end if;
  if not e.active then raise exception 'Ce matériel est retiré du prêt.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p ->> 'borrower_name', ''))) < 2 then
    raise exception 'Indiquez le nom du salarié qui emprunte.' using errcode = '22023';
  end if;
  perform private.check_loan_dates(d1, d2);
  if q < 1 or q > e.quantity then
    raise exception 'Quantité possible : de 1 à %.', e.quantity using errcode = '22023';
  end if;
  if out_now and d1 > private.today() then
    raise exception 'Le prêt commence plus tard : enregistrez-le comme réservation.' using errcode = '22023';
  end if;
  perform private.require_free(e.id, d1, case when out_now then greatest(d2, private.today()) else d2 end, q);
  if nullif(p ->> 'deposit', '') is not null and (p ->> 'deposit')::numeric < 0 then
    raise exception 'La caution ne peut pas être négative.' using errcode = '22023';
  end if;
  insert into loans (equipment_id, quantity, borrower_name, borrower_service, borrower_contact, start_date, due_date,
                     status, deposit, deposit_received, notes, created_by)
  values (e.id, q, trim(p ->> 'borrower_name'), nullif(trim(p ->> 'borrower_service'), ''),
          nullif(trim(p ->> 'borrower_contact'), ''), d1, d2, case when out_now then 'sorti' else 'reserve' end,
          case when p ? 'deposit' then nullif(p ->> 'deposit', '')::numeric else e.deposit end,
          coalesce((p ->> 'deposit_received')::boolean, false), nullif(trim(p ->> 'notes'), ''), auth.uid())
  returning * into l;
  return private.loan_json(l);
end $$;

-- p : champs de create_loan, plus status (reserve | sorti | rendu | annule), returned_on, return_state,
--     deposit_returned
create function public.update_loan(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l loans; n loans; e equipment; st text := nullif(p ->> 'status', '');
begin
  perform private.require_elu();
  select * into l from loans where id = p_id;
  if l.id is null then raise exception 'Prêt introuvable.' using errcode = 'P0002'; end if;
  n := l;
  if p ? 'borrower_name' then
    if char_length(trim(coalesce(p ->> 'borrower_name', ''))) < 2 then
      raise exception 'Indiquez le nom du salarié qui emprunte.' using errcode = '22023';
    end if;
    n.borrower_name := trim(p ->> 'borrower_name');
  end if;
  if p ? 'borrower_service' then n.borrower_service := nullif(trim(p ->> 'borrower_service'), ''); end if;
  if p ? 'borrower_contact' then n.borrower_contact := nullif(trim(p ->> 'borrower_contact'), ''); end if;
  if p ? 'start_date' then n.start_date := nullif(p ->> 'start_date', '')::date; end if;
  if p ? 'due_date' then n.due_date := nullif(p ->> 'due_date', '')::date; end if;
  if p ? 'quantity' then n.quantity := coalesce(nullif(p ->> 'quantity', '')::int, n.quantity); end if;
  if p ? 'deposit' then
    n.deposit := nullif(p ->> 'deposit', '')::numeric;
    if n.deposit < 0 then raise exception 'La caution ne peut pas être négative.' using errcode = '22023'; end if;
  end if;
  if p ? 'deposit_received' then n.deposit_received := coalesce((p ->> 'deposit_received')::boolean, false); end if;
  if p ? 'deposit_returned' then n.deposit_returned := coalesce((p ->> 'deposit_returned')::boolean, false); end if;
  if p ? 'notes' then n.notes := nullif(trim(p ->> 'notes'), ''); end if;
  if p ? 'return_state' then n.return_state := nullif(p ->> 'return_state', ''); end if;
  -- Changement d'état : remis au salarié, rendu, annulé, de nouveau réservé
  if st is not null and st <> l.status then
    if st not in ('reserve', 'sorti', 'rendu', 'annule') then raise exception 'État inconnu.' using errcode = '22023'; end if;
    if st = 'sorti' and n.start_date > private.today() then n.start_date := private.today(); end if;  -- remis en avance
    if st = 'rendu' then
      n.returned_on := coalesce(nullif(p ->> 'returned_on', '')::date, private.today());
      if n.returned_on < n.start_date then n.returned_on := n.start_date; end if;
    else
      n.returned_on := null;
      if st <> 'annule' then n.return_state := null; end if;
    end if;
    n.status := st;
  elsif p ? 'returned_on' and n.status = 'rendu' then
    n.returned_on := coalesce(nullif(p ->> 'returned_on', '')::date, n.returned_on);
  end if;
  perform private.check_loan_dates(n.start_date, n.due_date);
  select * into e from equipment where id = l.equipment_id;
  if n.quantity < 1 or n.quantity > e.quantity then
    raise exception 'Quantité possible : de 1 à %.', e.quantity using errcode = '22023';
  end if;
  -- Un prêt actif dont les dates, la quantité ou l'état changent doit rester possible
  if n.status in ('reserve', 'sorti')
     and (n.start_date, n.due_date, n.quantity, n.status) is distinct from (l.start_date, l.due_date, l.quantity, l.status) then
    perform private.require_free(e.id, n.start_date,
                                 case when n.status = 'sorti' then greatest(n.due_date, private.today()) else n.due_date end,
                                 n.quantity, l.id);
  end if;
  update loans set borrower_name = n.borrower_name, borrower_service = n.borrower_service,
    borrower_contact = n.borrower_contact, start_date = n.start_date, due_date = n.due_date, quantity = n.quantity,
    status = n.status, deposit = n.deposit, deposit_received = n.deposit_received, deposit_returned = n.deposit_returned,
    returned_on = n.returned_on, return_state = n.return_state, notes = n.notes, updated_at = now()
  where id = l.id returning * into l;
  return private.loan_json(l);
end $$;

create function public.delete_loan(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_elu();
  delete from loans where id = p_id;
  if not found then raise exception 'Prêt introuvable.' using errcode = 'P0002'; end if;
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
  p_role text default null, p_is_active boolean default null, p_can_vote boolean default null
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
    can_vote  = coalesce(p_can_vote, can_vote),
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
     and not exists (select 1 from recurring_points) and not exists (select 1 from subjects)
     and not exists (select 1 from votes) and not exists (select 1 from equipment)
$$;

create function private.wipe_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate public.notifications, public.request_notify, public.vote_secret_tally, public.vote_ballots, public.votes,
    public.loans, public.equipment, public.commitments, public.agenda_items,
    public.recurring_points, public.meetings, public.events, public.messages, public.request_viewers,
    public.requests, public.subject_events, public.subject_notes, public.subject_viewers, public.subjects
    restart identity;
end $$;

create function public.admin_data_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'requests', (select count(*) from requests), 'subjects', (select count(*) from subjects),
    'meetings', (select count(*) from meetings),
    'commitments', (select count(*) from commitments), 'votes', (select count(*) from votes),
    'equipment', (select count(*) from equipment), 'loans', (select count(*) from loans),
    'empty', private.is_space_empty(),
    'is_demo', (select is_demo from settings where id = 1));
end $$;

-- Repartir de zéro : efface demandes, sujets, réunions, engagements, votes, prêts (confirmation : « EFFACER »)
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
  update subject_events set created_at = ts where created_at = now();
  update subject_notes set created_at = ts where created_at = now();
$$;

create function private.sample_request(
  k text, temp text, cat text, subj text, descr text, who text, service text, anon boolean, n int,
  prio text default 'normale', s_start date default null, vis boolean default true
) returns requests
language plpgsql security definer set search_path = public as $$
declare r requests;
begin
  insert into requests (tracking_code, kind, temporality, category, subject, description, anonymous,
                        requester_name, requester_service, priority, situation_start, visible_to_all, created_at, updated_at)
  values (private.new_tracking_code(), k, temp, cat, subj, descr, anon, who, service, prio, s_start, vis,
          private.ago(n), private.ago(n))
  returning * into r;
  insert into events (request_id, label, created_at)
  values (r.id, case when k = 'signalement' then 'Signalement déposé' else 'Demande déposée' end, private.ago(n));
  return r;
end $$;

create function private.sample_subject(
  ttl text, descr text, cat text, k text, temp text, prio text, n int, owner uuid, viewers uuid[] default null
) returns subjects
language plpgsql security definer set search_path = public as $$
declare s subjects;
begin
  insert into subjects (number, title, description, category, kind, temporality, priority, visible_to_all,
                        created_by, assignee_id, created_at, updated_at)
  values (private.new_subject_number(), ttl, descr, cat, k, temp, prio, viewers is null, owner, owner,
          private.ago(n, 11), private.ago(n, 11))
  returning * into s;
  if viewers is not null then
    insert into subject_viewers (subject_id, elu_id) select s.id, x from unnest(viewers) x where x is not null;
  end if;
  insert into subject_events (subject_id, label, elu_id, created_at)
  values (s.id, 'Sujet créé par ' || coalesce((select full_name from elus where id = owner), 'un élu'), owner, private.ago(n, 11));
  return s;
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
  fontaine requests; cheques requests; cheques2 requests; samedi requests; parking requests;
  transport requests; chauffage requests;
  s_fontaine subjects; s_parking subjects; s_transport subjects; s_nao subjects;
  m1 meetings; m2 meetings; rp bigint; pos int; main_name text; answer text; vid bigint;
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
  insert into request_viewers (request_id, elu_id) select transport.id, x from unnest(array[coalesce(other, main)]) x where x is not null;

  -- Sujets portés par les élus
  s_fontaine := private.sample_subject('Fontaine à eau hors service en zone B',
    'Fontaine balisée depuis plus d’une semaine : les salariés de la zone B n’ont plus d’accès proche à l’eau potable.',
    'Santé, sécurité (SSCT)', 'signalement', 'actuel', 'haute', 39, main);
  perform private.attach_request(fontaine, s_fontaine); perform private.stamp(private.ago(39, 11));
  s_parking := private.sample_subject('Stationnement sur les places visiteurs',
    'Places visiteurs occupées par le personnel, livreurs garés sur la voie pompiers.',
    'Restauration, locaux, parking', 'demande', null, 'normale', 31, main);
  perform private.attach_request(parking, s_parking); perform private.stamp(private.ago(31, 11));
  s_transport := private.sample_subject('Prime de transport des intérimaires',
    'Demander à la direction si les intérimaires bénéficient de la prime de transport, et sinon pourquoi.',
    'Rémunération, primes, avantages', 'demande', null, 'normale', 3, coalesce(other, main), array[coalesce(other, main)]);
  perform private.attach_request(transport, s_transport); perform private.stamp(private.ago(3, 11));
  s_nao := private.sample_subject('Calendrier des NAO 2027',
    'Demander à la direction le calendrier des négociations annuelles obligatoires et la liste des thèmes abordés.',
    'Rémunération, primes, avantages', 'demande', null, 'normale', 8, main);
  insert into subject_notes (subject_id, author_id, body, created_at)
  values (s_nao.id, main, 'Penser à demander aussi le bilan de l’accord égalité professionnelle.', private.ago(7));

  -- Activités sociales : le CSE répond lui-même, sans sujet ni passage en réunion
  answer := E'Bonjour,\n\nLes chèques cadeaux de fin d’année seront distribués la semaine du 7 décembre, '
            'au local du CSE, avec le même montant que l’an dernier.';
  insert into messages (request_id, author_type, author_id, body, is_answer)
  values (cheques.id, 'elu', main, answer, true), (cheques2.id, 'elu', main, answer, true);
  perform private.add_event(cheques.id, 'Réponse du CSE (par ' || coalesce(main_name, 'un élu') || ')');
  perform private.add_event(cheques2.id, 'Réponse du CSE (par ' || coalesce(main_name, 'un élu') || ')');
  perform private.set_status(cheques.id, 'repondue'); perform private.set_status(cheques2.id, 'repondue');
  perform private.stamp(private.ago(9));

  -- Réunion passée (tenue) : points fixes, deux sujets traités, point récurrent
  m1 := private.sample_meeting(25, 'tenue');
  pos := private.sample_fixed_points(m1);
  insert into recurring_points (title, wording, kind, start_date)
  values ('Point sur la mutuelle', 'Suivi du contrat santé : cotisations, réclamations, évolutions.', 'ordinaire', m1.meeting_date)
  returning id into rp;
  perform private.inscribe(m1, s_fontaine.id, pos + 1, null);
  perform private.inscribe(m1, s_parking.id, pos + 2, null);
  perform private.stamp(private.ago(28));
  insert into agenda_items (meeting_id, recurring_id, title, wording, position, discussed, outcome)
  values (m1.id, rp, 'Point sur la mutuelle', 'Suivi du contrat santé : cotisations, réclamations, évolutions.', pos + 3, true,
          'Pas d’évolution des cotisations au 1er janvier.');
  update agenda_items set discussed = true, outcome = 'La direction a commandé une nouvelle fontaine, installation prévue sous trois semaines.'
  where meeting_id = m1.id and subject_id = s_fontaine.id;
  update agenda_items set discussed = true, outcome = 'Marquage au sol des places visiteurs et rappel des règles par note de service.'
  where meeting_id = m1.id and subject_id = s_parking.id;
  perform private.answer_subject(s_fontaine.id, 'Réponse suite à la réunion du ' || private.fr_date(m1.meeting_date) ||
          E' :\n\nLa direction a commandé une nouvelle fontaine, installation prévue sous trois semaines.');
  perform private.answer_subject(s_parking.id, 'Réponse suite à la réunion du ' || private.fr_date(m1.meeting_date) ||
          E' :\n\nMarquage au sol des places visiteurs et rappel des règles par note de service.');
  update messages set author_id = main where is_answer and author_id is null;
  update subject_notes set author_id = main where is_answer and author_id is null;
  -- Engagements de la direction : un en retard, un tenu
  insert into commitments (subject_id, text, due_date, meeting_id, created_by)
  values (s_fontaine.id, 'Installer une nouvelle fontaine à eau en zone B', t - 4, m1.id, main),
         (s_parking.id, 'Marquage au sol des places visiteurs', t - 12, m1.id, main);
  perform private.subject_event(s_fontaine.id, 'Engagement de la direction, délai au ' || private.fr_date(t - 4) || ' : Installer une nouvelle fontaine à eau en zone B');
  perform private.add_event(fontaine.id, 'Engagement de la direction, délai au ' || private.fr_date(t - 4) || ' : Installer une nouvelle fontaine à eau en zone B');
  perform private.subject_event(s_parking.id, 'Engagement de la direction, délai au ' || private.fr_date(t - 12) || ' : Marquage au sol des places visiteurs');
  perform private.add_event(parking.id, 'Engagement de la direction, délai au ' || private.fr_date(t - 12) || ' : Marquage au sol des places visiteurs');
  perform private.stamp(private.ago(25, 16));
  update commitments set status = 'tenu', closed_at = private.ago(11) where subject_id = s_parking.id;
  perform private.subject_event(s_parking.id, 'Engagement de la direction tenu');
  perform private.add_event(parking.id, 'Engagement de la direction tenu');
  perform private.stamp(private.ago(11, 15));

  -- Prochaine réunion (planifiée) : points fixes, sujets inscrits, point récurrent repris
  m2 := private.sample_meeting(-10, 'planifiee');
  pos := private.sample_fixed_points(m2);
  perform private.inscribe(m2, s_transport.id, pos + 1, null);
  perform private.inscribe(m2, s_nao.id, pos + 2, null);
  insert into agenda_items (meeting_id, recurring_id, title, wording, position)
  values (m2.id, rp, 'Point sur la mutuelle', 'Suivi du contrat santé : cotisations, réclamations, évolutions.', pos + 3);
  perform private.stamp(private.ago(1));

  -- Votes : deux votes en séance à la réunion tenue, un vote à préparer pour la prochaine,
  -- un vote en ligne ouvert (le second élu a déjà voté) et un vote en ligne secret clos
  insert into votes (title, mode, meeting_id, agenda_item_id, tally, status, closed_at, created_by, created_at)
  values ('Approbation du PV de la réunion précédente', 'seance', m1.id,
          (select id from agenda_items where meeting_id = m1.id order by position, id limit 1),
          array[9, 0, 1], 'clos', private.ago(25, 10), main, private.ago(25, 9));
  insert into votes (title, description, mode, meeting_id, tally, status, closed_at, created_by, created_at)
  values ('Avis du CSE sur le passage de l’équipe de nuit en 4 nuits de 10 heures',
          'Projet présenté par la direction : quatre nuits de 10 heures au lieu de cinq nuits de 8 heures, à partir de janvier.',
          'seance', m1.id, array[2, 7, 1], 'clos', private.ago(25, 11), main, private.ago(25, 9));
  insert into votes (title, description, mode, meeting_id, created_by, created_at)
  values ('Budget des activités sociales et culturelles 2027',
          'Répartition proposée par la commission ASC, jointe à la convocation.', 'seance', m2.id, main, private.ago(1));
  insert into votes (title, description, mode, options, deadline, created_by, created_at)
  values ('Destination de la sortie familiale du printemps', 'Trois devis reçus, pour un budget équivalent.', 'en_ligne',
          array['Parc animalier', 'Parc d’attractions', 'Croisière sur le Rhône'],
          ((t + 7)::timestamp) at time zone 'Europe/Paris', main, private.ago(2))
  returning id into vid;
  if other is not null then
    insert into vote_ballots (vote_id, elu_id, choice, voted_at) values (vid, other, 0, private.ago(1, 14));
  end if;
  insert into votes (title, mode, secret, deadline, status, closed_at, created_by, created_at)
  values ('Reconduction du prestataire des chèques cadeaux', 'en_ligne', true, private.ago(15, 18), 'clos',
          private.ago(15, 18), main, private.ago(19))
  returning id into vid;
  insert into vote_ballots (vote_id, elu_id, voted_at) select vid, x, private.ago(17) from unnest(array[main, other]) x where x is not null;
  insert into vote_secret_tally (vote_id, choice, n) values (vid, 0, case when other is null then 1 else 2 end);

  -- Prêts de matériel : un en retard, un en cours, une réservation, un rendu
  insert into equipment (name, description, quantity, deposit, location, created_at) values
    ('Tente de réception 3 × 6 m', 'Montage à deux personnes, sacs de lestage fournis.', 2, 150, 'Local CSE, armoire du fond', private.ago(60)),
    ('Barbecue à gaz', 'Bouteille de gaz non fournie.', 1, 50, 'Local CSE', private.ago(60)),
    ('Appareil à raclette 8 personnes', null, 3, null, 'Local CSE, étagère haute', private.ago(60)),
    ('Vidéoprojecteur et écran', 'Câble HDMI et rallonge dans la sacoche.', 1, 100, 'Bureau du secrétaire', private.ago(60)),
    ('Nettoyeur haute pression', null, 1, 50, 'Local CSE', private.ago(60));
  insert into loans (equipment_id, quantity, borrower_name, borrower_service, borrower_contact, start_date, due_date, status,
                     deposit, deposit_received, deposit_returned, returned_on, return_state, created_by, created_at, updated_at)
  values
    ((select id from equipment where name = 'Barbecue à gaz'), 1, 'Karim Benali', 'Maintenance', '06 12 34 56 78',
     t - 9, t - 2, 'sorti', 50, true, false, null, null, main, private.ago(9), private.ago(9)),
    ((select id from equipment where name = 'Appareil à raclette 8 personnes'), 2, 'Sophie Leroy', 'Logistique', null,
     t - 1, t + 2, 'sorti', null, false, false, null, null, main, private.ago(1), private.ago(1)),
    ((select id from equipment where name = 'Tente de réception 3 × 6 m'), 1, 'Paul Martin', 'Atelier usinage',
     'paul.martin@exemple.fr', t + 12, t + 14, 'reserve', 150, false, false, null, null, main, private.ago(3), private.ago(3)),
    ((select id from equipment where name = 'Vidéoprojecteur et écran'), 1, 'Julie Moreau', 'Production', null,
     t - 21, t - 18, 'rendu', 100, true, true, t - 18, 'bon', main, private.ago(21), private.ago(18));

  -- Dernière activité de chaque demande et de chaque sujet
  update requests r set updated_at = x.last
  from (select q.id, coalesce((select max(e.created_at) from events e where e.request_id = q.id), q.created_at) last
        from requests q) x
  where x.id = r.id and r.updated_at is distinct from x.last;
  update subjects s set updated_at = x.last
  from (select q.id, coalesce((select max(e.created_at) from subject_events e where e.subject_id = q.id), q.created_at) last
        from subjects q) x
  where x.id = s.id and s.updated_at is distinct from x.last;
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
    'format', 'allocse', 'version', 3, 'exported_at', now(),
    'organisation', (select organisation from settings where id = 1),
    'subjects', coalesce((select jsonb_agg(to_jsonb(s) - 'assignee_id' - 'created_by' || jsonb_build_object(
                   'assignee_email', private.email_of(s.assignee_id), 'created_by_email', private.email_of(s.created_by),
                   'viewer_emails', (select coalesce(jsonb_agg(private.email_of(v.elu_id)), '[]') from subject_viewers v where v.subject_id = s.id))
                   order by s.id) from subjects s), '[]'),
    'subject_notes', coalesce((select jsonb_agg(to_jsonb(n) - 'author_id' || jsonb_build_object('author_email', private.email_of(n.author_id))
                   order by n.id) from subject_notes n), '[]'),
    'subject_events', coalesce((select jsonb_agg(to_jsonb(e) - 'elu_id' || jsonb_build_object('elu_email', private.email_of(e.elu_id))
                   order by e.id) from subject_events e), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) - 'assignee_id' || jsonb_build_object(
                   'assignee_email', private.email_of(r.assignee_id),
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
                   order by c.id) from commitments c), '[]'),
    'votes', coalesce((select jsonb_agg(to_jsonb(v) - 'created_by' || jsonb_build_object('created_by_email', private.email_of(v.created_by))
                   order by v.id) from votes v), '[]'),
    -- Bulletin secret : le fichier ne contient que la participation, jamais le choix
    'vote_ballots', coalesce((select jsonb_agg(to_jsonb(b) - 'elu_id' || jsonb_build_object('elu_email', private.email_of(b.elu_id))
                   order by b.vote_id, b.voted_at) from vote_ballots b), '[]'),
    'vote_secret_tally', coalesce((select jsonb_agg(to_jsonb(t) order by t.vote_id, t.choice) from vote_secret_tally t), '[]'),
    'equipment', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from equipment e), '[]'),
    'loans', coalesce((select jsonb_agg(to_jsonb(l) - 'created_by' || jsonb_build_object('created_by_email', private.email_of(l.created_by))
                   order by l.id) from loans l), '[]'));
end $$;

-- Élus d'une liste d'e-mails présents dans cet espace ; à défaut, l'administrateur qui importe
create function private.viewers_from(x jsonb) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(distinct u) from (
           select private.elu_by_email(e) u from jsonb_array_elements_text(coalesce(x, '[]')) e) s where u is not null),
         array[auth.uid()])
$$;

-- Import dans un espace vide. p_shift : décale toutes les dates de l'écart entre l'export et aujourd'hui
create function public.admin_import_data(p jsonb, p_shift boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  delta interval := '0';
  days int := 0;
  x jsonb;
  s subjects; sn subject_notes; se subject_events;
  r requests; m meetings; rp recurring_points; a agenda_items; c commitments; msg messages; ev events;
  vt votes; vb vote_ballots; eq equipment; lo loans;
  t text;
begin
  perform private.require_admin();
  if coalesce(p ->> 'format', '') <> 'allocse' then
    raise exception 'Ce fichier n''est pas un export AlloCSE.' using errcode = '22023';
  end if;
  if coalesce((p ->> 'version')::int, 1) < 2 then
    raise exception 'Cet export vient d''une version précédente d''AlloCSE (avant les sujets) : il ne peut pas être rechargé.'
      using errcode = '22023';
  end if;
  if not private.is_space_empty() then
    raise exception 'L''espace contient déjà des données : videz-le d''abord.' using errcode = '22023';
  end if;
  if p_shift and p ->> 'exported_at' is not null then
    days := private.today() - ((p ->> 'exported_at')::timestamptz at time zone 'Europe/Paris')::date;
    delta := make_interval(days => days);
  end if;

  for x in select * from jsonb_array_elements(coalesce(p -> 'subjects', '[]')) loop
    s := jsonb_populate_record(null::subjects, x);
    s.assignee_id := private.elu_by_email(x ->> 'assignee_email');
    s.created_by := private.elu_by_email(x ->> 'created_by_email');
    s.created_at := s.created_at + delta; s.updated_at := s.updated_at + delta;
    s.situation_start := s.situation_start + days; s.situation_end := s.situation_end + days; s.due_date := s.due_date + days;
    insert into subjects overriding system value select (s).*;
    if not s.visible_to_all then
      insert into subject_viewers (subject_id, elu_id) select s.id, unnest(private.viewers_from(x -> 'viewer_emails'));
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'subject_notes', '[]')) loop
    sn := jsonb_populate_record(null::subject_notes, x);
    sn.author_id := private.elu_by_email(x ->> 'author_email'); sn.created_at := sn.created_at + delta;
    insert into subject_notes overriding system value select (sn).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'subject_events', '[]')) loop
    se := jsonb_populate_record(null::subject_events, x);
    se.elu_id := private.elu_by_email(x ->> 'elu_email'); se.created_at := se.created_at + delta;
    insert into subject_events overriding system value select (se).*;
  end loop;
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
  for x in select * from jsonb_array_elements(coalesce(p -> 'requests', '[]')) loop
    r := jsonb_populate_record(null::requests, x);
    r.assignee_id := private.elu_by_email(x ->> 'assignee_email');
    r.created_at := r.created_at + delta; r.updated_at := r.updated_at + delta;
    r.situation_start := r.situation_start + days; r.situation_end := r.situation_end + days; r.due_date := r.due_date + days;
    insert into requests overriding system value select (r).*;
    if not r.visible_to_all then
      -- Aucun élu destinataire retrouvé : l'administrateur qui importe la reçoit, pour qu'elle ne soit pas perdue
      insert into request_viewers (request_id, elu_id) select r.id, unnest(private.viewers_from(x -> 'viewer_emails'));
    end if;
  end loop;
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
  for x in select * from jsonb_array_elements(coalesce(p -> 'votes', '[]')) loop
    vt := jsonb_populate_record(null::votes, x);
    vt.created_by := private.elu_by_email(x ->> 'created_by_email');
    vt.created_at := vt.created_at + delta; vt.closed_at := vt.closed_at + delta; vt.deadline := vt.deadline + delta;
    insert into votes overriding system value select (vt).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'vote_ballots', '[]')) loop
    vb := jsonb_populate_record(null::vote_ballots, x);
    vb.elu_id := private.elu_by_email(x ->> 'elu_email'); vb.voted_at := vb.voted_at + delta;
    -- Bulletin d'un élu absent de cet espace : la participation est perdue, le décompte secret reste juste
    if vb.elu_id is not null then
      insert into vote_ballots select (vb).* on conflict do nothing;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'vote_secret_tally', '[]')) loop
    insert into vote_secret_tally select (jsonb_populate_record(null::vote_secret_tally, x)).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'equipment', '[]')) loop
    eq := jsonb_populate_record(null::equipment, x);
    eq.created_at := eq.created_at + delta;
    insert into equipment overriding system value select (eq).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'loans', '[]')) loop
    lo := jsonb_populate_record(null::loans, x);
    lo.created_by := private.elu_by_email(x ->> 'created_by_email');
    lo.start_date := lo.start_date + days; lo.due_date := lo.due_date + days; lo.returned_on := lo.returned_on + days;
    lo.created_at := lo.created_at + delta; lo.updated_at := lo.updated_at + delta;
    insert into loans overriding system value select (lo).*;
  end loop;

  -- Les compteurs reprennent après les identifiants importés
  foreach t in array array['subjects', 'subject_notes', 'subject_events', 'requests', 'messages', 'events',
                           'meetings', 'recurring_points', 'agenda_items', 'commitments', 'votes', 'equipment',
                           'loans'] loop
    execute format('select setval(pg_get_serial_sequence(%L, ''id''), (select coalesce(max(id), 0) + 1 from public.%I), false)',
                   'public.' || t, t);
  end loop;
  return public.admin_data_summary();
end $$;

-- -----------------------------------------------------------------------------
--  E-mails aux salariés qui l'ont demandé : réponse du CSE, message du CSE
--  (précisions attendues), clôture. Les événements sont mis en file
--  (table notifications) puis envoyés chaque minute par la base elle-même
--  (pg_cron + pg_net) via l'API de Brevo. La clé Brevo est rangée dans le
--  coffre-fort chiffré de Supabase (Vault), sous le nom « brevo_api_key ».
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end $$;

alter table public.request_notify enable row level security;
alter table public.notifications  enable row level security;
revoke all on public.request_notify, public.notifications from anon, authenticated;

create function private.notify(rid bigint, what text) returns void
language plpgsql security definer set search_path = public as $$
declare mail text;
begin
  select email into mail from request_notify where request_id = rid;
  if mail is null or (select is_demo from settings where id = 1) then return; end if;
  insert into notifications (request_id, to_email, answered, asked, closed)
  values (rid, mail, what = 'reponse', what = 'message', what = 'cloture')
  on conflict (request_id) where state = 'en_attente' and request_id is not null do update set
    answered = notifications.answered or excluded.answered,
    asked    = notifications.asked or excluded.asked,
    closed   = notifications.closed or excluded.closed;
end $$;

create function private.on_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_type = 'elu' and not new.internal then
    perform private.notify(new.request_id, case when new.is_answer then 'reponse' else 'message' end);
  end if;
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function private.on_message_notify();

create function private.on_close_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.notify(new.id, 'cloture');
  return new;
end $$;
create trigger requests_close_notify after update of status on public.requests
  for each row when (new.status = 'close' and old.status is distinct from 'close')
  execute function private.on_close_notify();

create function private.html_escape(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- Contenu de l'e-mail : jamais le texte de la réponse, seulement l'invitation à la lire dans l'appli
create function private.notification_mail(n public.notifications) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s settings;
  r requests;
  lines text[] := '{}';
  link text;
  subj text;
  txt text;
  html text;
begin
  select * into s from settings where id = 1;
  if n.test then
    return jsonb_build_object(
      'subject', 'AlloCSE : e-mail de test',
      'text', E'Ceci est un e-mail de test envoyé depuis AlloCSE.\nLes salariés qui le demandent seront prévenus de cette façon.',
      'html', '<p>Ceci est un e-mail de test envoyé depuis AlloCSE.</p><p>Les salariés qui le demandent seront prévenus de cette façon.</p>');
  end if;
  select * into r from requests where id = n.request_id;
  if n.answered then lines := lines || 'Le CSE a répondu à votre demande.'::text; end if;
  if n.asked then lines := lines || 'Le CSE vous a écrit : il attend peut-être des précisions de votre part.'::text; end if;
  if n.closed then lines := lines || 'Votre demande a été clôturée.'::text; end if;
  link := case when nullif(trim(s.app_url), '') is not null
               then trim(s.app_url) || '#/suivi/' || r.tracking_code end;
  subj := 'CSE ' || s.organisation || ' : du nouveau sur votre ' ||
          case when r.kind = 'signalement' then 'signalement' else 'demande' end;
  txt := array_to_string(lines, E'\n') || E'\n\nObjet : « ' || r.subject || E' »\n' ||
         coalesce(E'\nPour lire le détail et répondre : ' || link || E'\n', '') ||
         E'\nVotre numéro de suivi : ' || r.tracking_code ||
         E'\n\nVous recevez ce message car vous avez demandé à être prévenu. Merci de ne pas répondre à cet e-mail.';
  html := '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16213A;line-height:1.5">' ||
          (select string_agg('<p>' || private.html_escape(l) || '</p>', '') from unnest(lines) l) ||
          '<p>Objet : « ' || private.html_escape(r.subject) || ' »</p>' ||
          coalesce('<p><a href="' || private.html_escape(link) ||
                   '" style="display:inline-block;background:#1B2A4A;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Voir ma demande</a></p>', '') ||
          '<p>Votre numéro de suivi : <strong>' || private.html_escape(r.tracking_code) || '</strong></p>' ||
          '<p style="color:#5A6680;font-size:13px">Vous recevez ce message car vous avez demandé à être prévenu. Merci de ne pas répondre à cet e-mail.</p></div>';
  return jsonb_build_object('subject', subj, 'text', txt, 'html', html);
end $$;

create function private.brevo_key() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'brevo_api_key' limit 1);
exception when others then
  return null;
end $$;

-- Remet une notification en file après un échec (en la fusionnant avec une éventuelle autre en attente)
create function private.retry_notification(n public.notifications, err text) returns void
language plpgsql security definer set search_path = public as $$
declare pending bigint;
begin
  if n.attempts >= 5 then
    update notifications set state = 'echec', error = left(err, 500) where id = n.id;
    return;
  end if;
  select id into pending from notifications
  where request_id = n.request_id and state = 'en_attente' and n.request_id is not null;
  if pending is not null then
    update notifications set answered = answered or n.answered, asked = asked or n.asked, closed = closed or n.closed
    where id = pending;
    update notifications set state = 'echec', error = left('Fusionnée avec un envoi plus récent. ' || err, 500) where id = n.id;
  else
    update notifications set state = 'en_attente', error = left(err, 500) where id = n.id;
  end if;
end $$;

-- Appelée chaque minute par pg_cron
create function private.dispatch_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare
  s settings;
  n notifications;
  resp record;
  key text;
  mail jsonb;
  nid bigint;
  sent int := 0;
begin
  select * into s from settings where id = 1;
  if s.is_demo then return 0; end if;

  -- 1. Résultat des envois de la minute précédente
  for n in select * from notifications where state = 'envoi' order by id loop
    select status_code, content, error_msg into resp from net._http_response where id = n.net_id;
    if found and resp.status_code between 200 and 299 then
      update notifications set state = 'envoyee', sent_at = now(), error = null where id = n.id;
      -- Demande anonyme clôturée et prévenue : l'adresse est effacée
      if n.closed and (select anonymous from requests where id = n.request_id) then
        delete from request_notify where request_id = n.request_id;
      end if;
    elsif found then
      perform private.retry_notification(n, coalesce(resp.status_code::text || ' ', '') ||
                                            coalesce(resp.error_msg, resp.content, 'erreur inconnue'));
    elsif n.dispatched_at < now() - interval '15 minutes' then
      perform private.retry_notification(n, 'Pas de réponse du service d''envoi.');
    end if;
  end loop;

  -- 2. Envois en attente
  key := private.brevo_key();
  if key is null or nullif(trim(s.mail_from), '') is null then return 0; end if;
  for n in select * from notifications where state = 'en_attente' and created_at < now() - interval '20 seconds'
           order by id limit 50 loop
    mail := private.notification_mail(n);
    nid := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      body := jsonb_build_object(
        'sender', jsonb_build_object('name', 'CSE ' || s.organisation, 'email', trim(s.mail_from)),
        'to', jsonb_build_array(jsonb_build_object('email', n.to_email)),
        'subject', mail ->> 'subject', 'textContent', mail ->> 'text', 'htmlContent', mail ->> 'html'),
      headers := jsonb_build_object('api-key', key, 'Content-Type', 'application/json', 'Accept', 'application/json'),
      timeout_milliseconds := 10000);
    update notifications set state = 'envoi', net_id = nid, attempts = attempts + 1, dispatched_at = now()
    where id = n.id;
    sent := sent + 1;
  end loop;
  return sent;
end $$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('allocse-notifications', '* * * * *', 'select private.dispatch_notifications()');
  end if;
end $$;

-- Administrateurs : état des e-mails et envoi d'un test à soi-même
create function public.admin_notification_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s settings;
begin
  perform private.require_admin();
  select * into s from settings where id = 1;
  return jsonb_build_object(
    'ready_extensions', to_regnamespace('net') is not null and to_regnamespace('cron') is not null,
    'key_configured', private.brevo_key() is not null,
    'mail_from', s.mail_from, 'app_url', s.app_url, 'is_demo', s.is_demo,
    'subscribers', (select count(*) from request_notify n join requests r on r.id = n.request_id where r.status <> 'close'),
    'pending', (select count(*) from notifications where state in ('en_attente', 'envoi')),
    'sent_30d', (select count(*) from notifications where state = 'envoyee' and sent_at > now() - interval '30 days'),
    'failed', (select count(*) from notifications where state = 'echec' and created_at > now() - interval '30 days'),
    'last_error', (select error from notifications where error is not null order by coalesce(dispatched_at, created_at) desc limit 1));
end $$;

create function public.admin_send_test_mail() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  insert into notifications (to_email, test) select email, true from elus where id = auth.uid();
  return public.admin_notification_status();
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
  public.is_active_elu(), public.is_admin(), public.can_see_request(bigint), public.can_see_subject(bigint),
  public.search_requests(jsonb), public.get_request(bigint), public.dashboard_stats(),
  public.timeline(boolean), public.update_request(bigint, jsonb), public.add_message(bigint, jsonb),
  public.link_request(bigint, bigint),
  public.search_subjects(jsonb), public.get_subject(bigint), public.create_subject(jsonb),
  public.update_subject(bigint, jsonb), public.add_subject_requests(bigint, jsonb),
  public.add_subject_note(bigint, jsonb), public.merge_subjects(bigint, bigint), public.delete_subject(bigint),
  public.add_commitment(bigint, jsonb), public.update_commitment(bigint, jsonb), public.delete_commitment(bigint),
  public.list_meetings(), public.create_meeting(jsonb), public.get_meeting(bigint),
  public.update_meeting(bigint, jsonb), public.delete_meeting(bigint), public.preparation(),
  public.propose_agenda(bigint), public.add_agenda_item(bigint, jsonb),
  public.generate_agenda(bigint, boolean), public.update_agenda_item(bigint, jsonb),
  public.remove_agenda_item(bigint, boolean), public.reorder_agenda(bigint, bigint[]),
  public.meeting_word_data(bigint), public.update_my_profile(text, text),
  public.admin_update_elu(uuid, text, text, text, boolean, boolean),
  public.list_votes(), public.get_vote(bigint), public.create_vote(jsonb), public.update_vote(bigint, jsonb),
  public.cast_vote(bigint, int), public.close_vote(bigint), public.delete_vote(bigint), public.list_equipment(),
  public.save_equipment(jsonb), public.delete_equipment(bigint), public.equipment_availability(bigint, date, date, bigint), public.list_loans(jsonb),
  public.create_loan(jsonb), public.update_loan(bigint, jsonb), public.delete_loan(bigint),
  public.admin_data_summary(), public.admin_wipe_data(text), public.admin_load_sample(),
  public.admin_export_data(), public.admin_import_data(jsonb, boolean),
  public.admin_notification_status(), public.admin_send_test_mail()
  to authenticated;

-- search_requests s'exécute avec les droits de l'élu : il appelle ces aides internes
grant usage on schema private to authenticated;
grant execute on function private.request_summary(public.requests), private.elu_json(uuid),
  private.subject_ref(bigint) to authenticated;

-- Les fonctions créées plus tard ne seront pas exécutables par défaut
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
