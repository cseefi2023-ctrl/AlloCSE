-- =============================================================================
--  AlloCSE — mise à jour : votes du CSE et prêts de matériel
--  À exécuter UNE fois dans une base installée avec la version précédente
--  (après migration_sujets.sql). Aucune donnée existante n'est modifiée :
--  nouvelles tables, nouvelles fonctions, droit de vote des élus (oui par défaut).
-- =============================================================================

do $$
begin
  if to_regclass('public.votes') is not null then
    raise exception 'Cette base est déjà à jour (la table des votes existe).';
  end if;
  if to_regclass('public.subjects') is null then
    raise exception 'Base trop ancienne : exécutez d''abord migration_sujets.sql.';
  end if;
end $$;

alter table public.elus add column can_vote boolean not null default true;

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

alter table public.votes             enable row level security;
alter table public.vote_ballots      enable row level security;
alter table public.vote_secret_tally enable row level security;
alter table public.equipment         enable row level security;
alter table public.loans             enable row level security;
revoke all on public.votes, public.vote_ballots, public.vote_secret_tally, public.equipment, public.loans
  from anon, authenticated;

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

-- ---------- Fonctions existantes mises à jour ----------

drop function public.admin_update_elu(uuid, text, text, text, boolean);
create or replace function private.meeting_detail(mid bigint) returns jsonb
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

create or replace function private.is_space_empty() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from requests) and not exists (select 1 from meetings)
     and not exists (select 1 from recurring_points) and not exists (select 1 from subjects)
     and not exists (select 1 from votes) and not exists (select 1 from equipment)
$$;

create or replace function private.wipe_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate public.notifications, public.request_notify, public.vote_secret_tally, public.vote_ballots, public.votes,
    public.loans, public.equipment, public.commitments, public.agenda_items,
    public.recurring_points, public.meetings, public.events, public.messages, public.request_viewers,
    public.requests, public.subject_events, public.subject_notes, public.subject_viewers, public.subjects
    restart identity;
end $$;

create or replace function public.admin_data_summary() returns jsonb
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

create or replace function public.admin_export_data() returns jsonb
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

create or replace function public.admin_import_data(p jsonb, p_shift boolean default true) returns jsonb
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

create or replace function private.load_sample(main uuid, other uuid default null) returns void
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

-- ---------- Droits d'exécution ----------

do $$
declare f record;
begin
  -- Les nouvelles fonctions ne sont exécutables que si on l'autorise explicitement
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private')
             and p.proname in ('admin_update_elu', 'cast_vote', 'check_loan_dates', 'close_vote', 'create_loan', 'create_vote', 'delete_equipment', 'delete_loan', 'delete_vote', 'equipment_availability', 'equipment_free', 'equipment_json', 'get_vote', 'is_standard_vote', 'list_equipment', 'list_loans', 'list_votes', 'loan_end', 'loan_json', 'record_tally', 'require_free', 'require_vote', 'save_equipment', 'update_loan', 'update_vote', 'vote_closed', 'vote_counts', 'vote_deadline', 'vote_json', 'vote_options', 'vote_result') loop
    execute 'revoke execute on function ' || f.sig || ' from public, anon, authenticated';
  end loop;
end $$;

grant execute on function
  public.admin_update_elu(uuid, text, text, text, boolean, boolean),
  public.list_votes(), public.get_vote(bigint), public.create_vote(jsonb), public.update_vote(bigint, jsonb),
  public.cast_vote(bigint, int), public.close_vote(bigint), public.delete_vote(bigint), public.list_equipment(),
  public.save_equipment(jsonb), public.delete_equipment(bigint), public.equipment_availability(bigint, date, date, bigint), public.list_loans(jsonb),
  public.create_loan(jsonb), public.update_loan(bigint, jsonb), public.delete_loan(bigint)
  to authenticated;
