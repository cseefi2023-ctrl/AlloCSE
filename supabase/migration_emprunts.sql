-- =============================================================================
--  AlloCSE — mise à jour : demandes d'emprunt de matériel par les salariés
--  À exécuter UNE fois dans une base installée avec la version précédente
--  (après migration_votes_prets.sql). Aucune donnée existante n'est modifiée :
--  nouvelles colonnes (vides), nouvelles fonctions, fonctions existantes complétées.
-- =============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'requests' and column_name = 'loan_start') then
    raise exception 'Cette base est déjà à jour (les demandes d''emprunt existent).';
  end if;
  if to_regclass('public.loans') is null then
    raise exception 'Base trop ancienne : exécutez d''abord migration_votes_prets.sql.';
  end if;
end $$;

-- Demande d'emprunt : matériel, quantité, dates, réponse des élus (null : en attente)
alter table public.requests
  add column loan_equipment_id bigint references public.equipment (id) on delete set null,
  add column loan_quantity     int check (loan_quantity between 1 and 999),
  add column loan_start        date,
  add column loan_due          date,
  add column loan_decision     text check (loan_decision in ('acceptee', 'refusee')),
  add constraint requests_loan_dates_check check (loan_due is null or loan_start is null or loan_due >= loan_start);
-- Prêt issu d'une demande d'emprunt du salarié
alter table public.loans add column request_id bigint references public.requests (id) on delete set null;
create index loans_request_idx on public.loans (request_id);

-- ---------- Nouvelles fonctions ----------

-- Demande d'emprunt de matériel (null pour une demande ordinaire) : ce qui est demandé, la réponse
-- des élus, le prêt qui en découle. Aucune donnée d'élu : la page de suivi du salarié l'affiche aussi.
create function private.loan_request_json(r public.requests) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e equipment; l loans;
begin
  if r.loan_start is null then return null; end if;
  select * into e from equipment where id = r.loan_equipment_id;
  select * into l from loans where request_id = r.id order by id desc limit 1;
  return jsonb_build_object(
    'equipment_id', r.loan_equipment_id, 'equipment_name', e.name, 'equipment_quantity', e.quantity,
    'equipment_active', coalesce(e.active, false), 'deposit', e.deposit,
    'quantity', r.loan_quantity, 'start_date', r.loan_start, 'due_date', r.loan_due, 'decision', r.loan_decision,
    -- Quantité encore libre aux dates demandées, tant que les élus n'ont pas répondu
    'free', case when r.loan_decision is null and e.active then private.equipment_free(e.id, r.loan_start, r.loan_due) end,
    'loan', case when l.id is not null then jsonb_build_object(
              'id', l.id, 'status', l.status, 'quantity', l.quantity, 'start_date', l.start_date,
              'due_date', l.due_date, 'returned_on', l.returned_on, 'deposit', l.deposit,
              'late', l.status = 'sorti' and l.due_date < private.today()) end);
end $$;

-- Emprunt de matériel : ce que le CSE prête, la disponibilité sur des dates, la demande du salarié
create function public.public_equipment() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'description', e.description,
                                               'quantity', e.quantity, 'deposit', e.deposit)
                            order by lower(e.name), e.id), '[]'::jsonb)
  from equipment e where e.active
$$;

create function public.public_availability(p_equipment_id bigint, p_from date, p_to date) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from equipment where id = p_equipment_id and active) then
    raise exception 'Ce matériel n''est pas prêté.' using errcode = 'P0002';
  end if;
  perform private.check_loan_dates(p_from, p_to);
  return private.equipment_free(p_equipment_id, p_from, p_to);
end $$;

-- p = { equipment_id, quantity, start_date, due_date, requester_name, requester_service, requester_email,
--       notify, message }. Les élus acceptent (le prêt est alors réservé) ou refusent.
create function public.submit_loan_request(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e equipment;
  rid bigint;
  code text;
  attempts int := 0;
  q int := coalesce(nullif(p ->> 'quantity', '')::int, 1);
  d1 date := nullif(p ->> 'start_date', '')::date;
  d2 date := nullif(p ->> 'due_date', '')::date;
  who text := nullif(trim(p ->> 'requester_name'), '');
  service text := nullif(trim(p ->> 'requester_service'), '');
  email text := nullif(lower(trim(p ->> 'requester_email')), '');
  notify boolean := coalesce((p ->> 'notify')::boolean, false);
  msg text := nullif(trim(p ->> 'message'), '');
  free int;
begin
  select * into e from equipment where id = nullif(p ->> 'equipment_id', '')::bigint and active;
  if e.id is null then raise exception 'Choisissez le matériel à emprunter.' using errcode = '22023'; end if;
  perform private.check_loan_dates(d1, d2);
  if d1 < private.today() then raise exception 'La date d''emprunt est déjà passée.' using errcode = '22023'; end if;
  if d1 > private.today() + 366 then
    raise exception 'Demandez au plus un an à l''avance.' using errcode = '22023';
  end if;
  if q < 1 or q > e.quantity then
    raise exception 'Quantité possible : de 1 à %.', e.quantity using errcode = '22023';
  end if;
  if char_length(coalesce(who, '')) < 2 then
    raise exception 'Indiquez votre nom et votre prénom.' using errcode = '22023';
  end if;
  if char_length(who) > 120 or char_length(coalesce(service, '')) > 120 then
    raise exception 'Nom ou service trop long.' using errcode = '22023';
  end if;
  if email is not null and (email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(email) > 190) then
    raise exception 'L''adresse e-mail ne semble pas valide.' using errcode = '22023';
  end if;
  if notify and email is null then
    raise exception 'Indiquez votre adresse e-mail pour être prévenu.' using errcode = '22023';
  end if;
  if char_length(coalesce(msg, '')) > 2000 then
    raise exception 'Message trop long (2000 caractères au plus).' using errcode = '22023';
  end if;
  free := private.equipment_free(e.id, d1, d2);
  if free < q then
    raise exception '%', case when free <= 0 then 'Ce matériel est déjà réservé sur ces dates : choisissez d''autres dates.'
                              else 'Seulement ' || free || ' disponible' || case when free > 1 then 's' else '' end
                                   || ' sur ces dates.' end
      using errcode = '22023';
  end if;

  loop
    attempts := attempts + 1;
    code := private.new_tracking_code();
    begin
      insert into requests (tracking_code, kind, category, subject, description, anonymous, requester_name,
                            requester_email, requester_service, visible_to_all,
                            loan_equipment_id, loan_quantity, loan_start, loan_due)
      values (code, 'demande', 'Prêt de matériel', 'Emprunt : ' || e.name,
              'Demande d''emprunt : ' || e.name || case when q > 1 then ' (× ' || q || ')' else '' end
                || ', du ' || private.fr_date(d1) || ' au ' || private.fr_date(d2) || '.' || coalesce(E'\n\n' || msg, ''),
              false, who, email, service, true, e.id, q, d1, d2)
      returning id into rid;
      exit;
    exception when unique_violation then
      if attempts >= 5 then raise; end if;
    end;
  end loop;

  if notify then
    insert into request_notify (request_id, email) values (rid, email);
  end if;
  insert into events (request_id, label) values (rid, 'Demande d''emprunt déposée');
  return jsonb_build_object('tracking_code', code,
    'message', 'Conservez ce numéro : il permet de suivre votre demande et de lire la réponse du CSE.');
end $$;

-- Réponse des élus à une demande d'emprunt : accepter (le prêt est réservé) ou refuser.
-- p = { accept, message (réponse au salarié), quantity, start_date, due_date, deposit }
create function public.decide_loan_request(p_id bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r requests; e equipment; me elus;
  ok boolean := coalesce((p ->> 'accept')::boolean, false);
  q int; d1 date; d2 date; dep numeric;
  body text := nullif(trim(p ->> 'message'), '');
begin
  r := private.require_visible(p_id);
  if r.loan_start is null then
    raise exception 'Ce n''est pas une demande d''emprunt.' using errcode = '22023';
  end if;
  if r.status = 'close' then
    raise exception 'Demande clôturée : rouvrez-la avant de répondre.' using errcode = '22023';
  end if;
  if exists (select 1 from loans where request_id = r.id and status in ('reserve', 'sorti')) then
    raise exception 'Un prêt est déjà en cours pour cette demande.' using errcode = '22023';
  end if;
  if char_length(coalesce(body, '')) > 10000 then
    raise exception 'Message trop long.' using errcode = '22023';
  end if;
  select * into me from elus where id = auth.uid();
  if ok then
    select * into e from equipment where id = r.loan_equipment_id;
    if e.id is null then raise exception 'Ce matériel n''existe plus.' using errcode = '22023'; end if;
    if not e.active then raise exception 'Ce matériel est retiré du prêt.' using errcode = '22023'; end if;
    q := coalesce(nullif(p ->> 'quantity', '')::int, r.loan_quantity, 1);
    d1 := coalesce(nullif(p ->> 'start_date', '')::date, r.loan_start);
    d2 := coalesce(nullif(p ->> 'due_date', '')::date, r.loan_due);
    perform private.check_loan_dates(d1, d2);
    if q < 1 or q > e.quantity then
      raise exception 'Quantité possible : de 1 à %.', e.quantity using errcode = '22023';
    end if;
    dep := case when p ? 'deposit' then nullif(p ->> 'deposit', '')::numeric else e.deposit end;
    if dep < 0 then raise exception 'La caution ne peut pas être négative.' using errcode = '22023'; end if;
    perform private.require_free(e.id, d1, d2, q);
    insert into loans (equipment_id, quantity, borrower_name, borrower_service, borrower_contact, start_date, due_date,
                       status, deposit, created_by, request_id)
    values (e.id, q, coalesce(r.requester_name, 'Salarié'), r.requester_service, r.requester_email, d1, d2, 'reserve',
            dep, auth.uid(), r.id);
    update requests set loan_decision = 'acceptee', loan_quantity = q, loan_start = d1, loan_due = d2 where id = r.id;
    body := coalesce(body, 'C''est d''accord : ' || e.name || case when q > 1 then ' (× ' || q || ')' else '' end
                           || ' est réservé pour vous du ' || private.fr_date(d1) || ' au ' || private.fr_date(d2) || '.'
                           || case when dep > 0 then ' Une caution de ' || replace(trim_scale(dep)::text, '.', ',')
                                                     || ' € vous sera demandée.' else '' end);
    perform private.add_event(r.id, 'Emprunt accepté : réservé du ' || private.fr_date(d1) || ' au ' || private.fr_date(d2));
  else
    update requests set loan_decision = 'refusee' where id = r.id;
    body := coalesce(body, 'Le CSE ne peut pas donner suite à votre demande d''emprunt.');
    perform private.add_event(r.id, 'Demande d''emprunt refusée');
  end if;
  insert into messages (request_id, author_type, author_id, body, is_answer) values (r.id, 'elu', me.id, body, true);
  perform private.set_status(r.id, 'repondue');
  update requests set updated_at = now() where id = r.id;
  return private.request_detail(p_id);
end $$;

-- ---------- Fonctions existantes complétées ----------

create or replace function private.request_summary(r public.requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'tracking_code', r.tracking_code, 'kind', r.kind, 'temporality', r.temporality,
    'situation_start', r.situation_start, 'situation_end', r.situation_end,
    'category', r.category, 'subject', r.subject, 'status', r.status, 'priority', r.priority,
    'anonymous', r.anonymous, 'requester_name', r.requester_name, 'visible_to_all', r.visible_to_all,
    'assignee', private.elu_json(r.assignee_id), 'due_date', r.due_date,
    'subject_ref', private.subject_ref(r.subject_id),
    'loan_request', private.loan_request_json(r),
    'created_at', r.created_at, 'updated_at', r.updated_at)
$$;

create or replace function public.public_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'app_name', s.app_name, 'organisation', s.organisation, 'contact', s.contact,
    'tracking_prefix', s.tracking_prefix, 'categories', to_jsonb(s.categories), 'demo', s.is_demo,
    -- Matériel que les salariés peuvent demander à emprunter
    'equipment_count', (select count(*) from equipment e where e.active),
    'elus', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'mandate', e.mandate)
                                       order by e.full_name)
                      from elus e where e.is_active), '[]'::jsonb))
  from settings s where s.id = 1
$$;

create or replace function private.public_view(rid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tracking_code', r.tracking_code, 'kind', r.kind, 'temporality', r.temporality,
    'situation_start', r.situation_start, 'situation_end', r.situation_end,
    'category', r.category, 'subject', r.subject, 'description', r.description,
    'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at,
    'visible_to_all', r.visible_to_all,
    'notify', exists (select 1 from request_notify n where n.request_id = r.id),
    'loan_request', private.loan_request_json(r),
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

create or replace function public.search_requests(p jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(private.request_summary(r) order by r.updated_at desc, r.id desc), '[]'::jsonb)
  from (
    select * from requests r
    where (p -> 'status' is null or jsonb_typeof(p -> 'status') <> 'array' or jsonb_array_length(p -> 'status') = 0
           or r.status in (select jsonb_array_elements_text(p -> 'status')))
      and (not coalesce((p ->> 'open_only')::boolean, false) or r.status <> 'close')
      -- À trier : pas de sujet et pas encore de réponse (même si un élu a déjà échangé avec le salarié) ;
      -- les demandes d'emprunt se traitent avec les prêts
      and (not coalesce((p ->> 'to_triage')::boolean, false)
           or (r.subject_id is null and r.status in ('nouvelle', 'en_cours') and r.loan_start is null))
      -- Demandes d'emprunt qui attendent les élus : pas encore de réponse, ou nouveau message du salarié
      and (not coalesce((p ->> 'loans_todo')::boolean, false)
           or (r.loan_start is not null and r.status in ('nouvelle', 'en_cours')))
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
                  and r.loan_start is null and public.can_see_request(r.id)),
    'commitments_late', (select count(*) from commitments c where c.status = 'en_attente'
                         and c.due_date < private.today() and public.can_see_subject(c.subject_id)),
    -- Demandes d'emprunt des salariés : à accepter ou refuser, ou nouveau message après la réponse
    'loan_requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'subject', r.subject, 'equipment', e.name,
                                                                   'quantity', r.loan_quantity, 'requester_name', r.requester_name,
                                                                   'start_date', r.loan_start, 'due_date', r.loan_due,
                                                                   'decision', r.loan_decision)
                                                order by r.loan_start, r.id)
                               from requests r left join equipment e on e.id = r.loan_equipment_id
                               where r.loan_start is not null and r.status in ('nouvelle', 'en_cours')
                                 and public.can_see_request(r.id)), '[]'::jsonb),
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

create or replace function public.update_loan(p_id bigint, p jsonb) returns jsonb
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
  -- Prêt issu d'une demande d'emprunt : le salarié suit son prêt avec son numéro
  if l.request_id is not null then
    if n.status is distinct from l.status then
      perform private.add_event(l.request_id, case n.status
        when 'sorti' then 'Matériel remis'
        when 'rendu' then 'Matériel rendu le ' || private.fr_date(n.returned_on)
        when 'annule' then 'Réservation annulée'
        else 'Réservé du ' || private.fr_date(n.start_date) || ' au ' || private.fr_date(n.due_date) end);
    elsif (n.start_date, n.due_date) is distinct from (l.start_date, l.due_date) and n.status in ('reserve', 'sorti') then
      perform private.add_event(l.request_id, 'Dates du prêt : du ' || private.fr_date(n.start_date)
                                              || ' au ' || private.fr_date(n.due_date));
    end if;
  end if;
  update loans set borrower_name = n.borrower_name, borrower_service = n.borrower_service,
    borrower_contact = n.borrower_contact, start_date = n.start_date, due_date = n.due_date, quantity = n.quantity,
    status = n.status, deposit = n.deposit, deposit_received = n.deposit_received, deposit_returned = n.deposit_returned,
    returned_on = n.returned_on, return_state = n.return_state, notes = n.notes, updated_at = now()
  where id = l.id returning * into l;
  return private.loan_json(l);
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
  -- Le matériel avant les demandes : une demande d'emprunt y fait référence
  for x in select * from jsonb_array_elements(coalesce(p -> 'equipment', '[]')) loop
    eq := jsonb_populate_record(null::equipment, x);
    eq.created_at := eq.created_at + delta;
    insert into equipment overriding system value select (eq).*;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'requests', '[]')) loop
    r := jsonb_populate_record(null::requests, x);
    r.assignee_id := private.elu_by_email(x ->> 'assignee_email');
    r.created_at := r.created_at + delta; r.updated_at := r.updated_at + delta;
    r.situation_start := r.situation_start + days; r.situation_end := r.situation_end + days; r.due_date := r.due_date + days;
    r.loan_start := r.loan_start + days; r.loan_due := r.loan_due + days;
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
  m1 meetings; m2 meetings; rp bigint; pos int; main_name text; answer text; vid bigint; pret requests;
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

  -- Demandes d'emprunt des salariés : la tente réservée vient d'une demande acceptée, le nettoyeur attend les élus
  pret := private.sample_request('demande', null, 'Prêt de matériel', 'Emprunt : Tente de réception 3 × 6 m',
    'Demande d''emprunt : Tente de réception 3 × 6 m, du ' || private.fr_date(t + 12) || ' au ' || private.fr_date(t + 14)
      || E'.\n\nPour la fête des voisins de notre lotissement.', 'Paul Martin', 'Atelier usinage', false, 4);
  update requests set requester_email = 'paul.martin@exemple.fr', loan_quantity = 1, loan_start = t + 12, loan_due = t + 14,
    loan_equipment_id = (select id from equipment where name = 'Tente de réception 3 × 6 m'), loan_decision = 'acceptee'
  where id = pret.id;
  update events set label = 'Demande d''emprunt déposée' where request_id = pret.id;
  update loans set request_id = pret.id where borrower_name = 'Paul Martin' and status = 'reserve';
  insert into messages (request_id, author_type, author_id, body, is_answer)
  values (pret.id, 'elu', main, 'C''est d''accord : la tente est réservée pour vous du ' || private.fr_date(t + 12) || ' au '
          || private.fr_date(t + 14) || '. Une caution de 150 € vous sera demandée au local du CSE.', true);
  perform private.add_event(pret.id, 'Emprunt accepté : réservé du ' || private.fr_date(t + 12) || ' au ' || private.fr_date(t + 14));
  perform private.set_status(pret.id, 'repondue');
  perform private.stamp(private.ago(3, 10));
  pret := private.sample_request('demande', null, 'Prêt de matériel', 'Emprunt : Nettoyeur haute pression',
    'Demande d''emprunt : Nettoyeur haute pression, du ' || private.fr_date(t + 3) || ' au ' || private.fr_date(t + 4)
      || E'.\n\nPour nettoyer ma terrasse ce week-end.', 'Thomas Girard', 'Atelier montage', false, 1);
  update requests set loan_quantity = 1, loan_start = t + 3, loan_due = t + 4,
    loan_equipment_id = (select id from equipment where name = 'Nettoyeur haute pression')
  where id = pret.id;
  update events set label = 'Demande d''emprunt déposée' where request_id = pret.id;

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

revoke execute on function private.loan_request_json(public.requests), public.public_equipment(),
  public.public_availability(bigint, date, date), public.submit_loan_request(jsonb), public.decide_loan_request(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.public_equipment(), public.public_availability(bigint, date, date),
  public.submit_loan_request(jsonb)
  to anon, authenticated;
grant execute on function public.decide_loan_request(bigint, jsonb) to authenticated;
