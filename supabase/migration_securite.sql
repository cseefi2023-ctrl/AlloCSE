-- =============================================================================
--  AlloCSE — renforcement de la sécurité (v4.3.0), pour une base déjà en version 4.2
--  À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run.
--  Ne supprime ni ne modifie aucune donnée.
--
--  - Limitation des appels publics (sans compte) : demandes déposées, compléments des
--    salariés, numéros de suivi erronés (protection contre les numéros essayés au hasard).
--    Aucune adresse IP n'est conservée : une empreinte de 4 caractères seulement.
--  - Textes saisis par les salariés nettoyés (caractères de contrôle invisibles, inversions
--    du sens d'écriture) et longueurs vérifiées avec des messages clairs.
--  - Fonctions utilitaires : chemin de recherche fixé (alerte « search_path » de Supabase).
-- =============================================================================

-- Compteurs de limitation (schéma privé : inaccessible depuis le site)
create table if not exists private.api_limits (
  bucket  text not null,                        -- depot, depot_jour, message, erreur
  who     text not null,                        -- empreinte de l'adresse, demande:<id>, ou * (tout l'espace)
  started timestamptz not null default now(),   -- début de la fenêtre en cours
  hits    int not null default 0,
  primary key (bucket, who)
);
alter table private.api_limits enable row level security;
revoke all on private.api_limits from public, anon, authenticated;

-- Texte saisi par un salarié : retours à la ligne unifiés ; caractères de contrôle invisibles et
-- inversions du sens d'écriture (qui peuvent maquiller un texte) retirés ; espaces de début et de fin ôtés.
-- Le texte est ensuite toujours affiché comme du texte (jamais comme du HTML) : rien d'autre à filtrer.
create or replace function private.clean_text(t text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
           regexp_replace(replace(replace(t, E'\r\n', E'\n'), E'\r', E'\n'), '[\x0b\x0c\x85\x2028\x2029]', E'\n', 'g'),
           '[\x01-\x08\x0e-\x1f\x7f-\x9f\x200b\x202a-\x202e\x2066-\x2069\xfeff]', '', 'g'), E' \t\n')
$$;

-- Empreinte de l'appelant : « cf:xxxx » (adresse transmise par Cloudflare, devant Supabase), sinon
-- « xf:xxxx » (X-Forwarded-For). En IPv6, le préfixe /64, qu'un même abonné possède en entier.
create or replace function private.client_key() returns text
language plpgsql stable set search_path = public as $$
declare h jsonb; src text := 'cf'; ip text; a inet;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  ip := nullif(btrim(h ->> 'cf-connecting-ip'), '');
  if ip is null then
    src := 'xf';
    ip := nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), '');
  end if;
  if ip is null then return 'aucune'; end if;
  begin
    a := ip::inet;
    ip := case when family(a) = 6 then host(network(set_masklen(a, 64))) else host(a) end;
  exception when others then
    ip := left(ip, 64);
  end;
  return src || ':' || left(md5('allocse|' || ip), 4);
end $$;

-- Compte un appel ; renvoie le nombre d'appels de la fenêtre en cours (fenêtre neuve si l'ancienne est passée)
create or replace function private.count_hit(p_bucket text, p_who text, p_window interval) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  insert into private.api_limits as l (bucket, who, started, hits) values (p_bucket, p_who, now(), 1)
  on conflict (bucket, who) do update
    set hits    = case when l.started <= now() - p_window then 1 else l.hits + 1 end,
        started = case when l.started <= now() - p_window then now() else l.started end
  returning l.hits into n;
  return n;
end $$;

-- Appels déjà comptés dans la fenêtre en cours, sans compter celui-ci
create or replace function private.hits(p_bucket text, p_who text, p_window interval) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select l.hits from private.api_limits l
                   where l.bucket = p_bucket and l.who = p_who and l.started > now() - p_window), 0)
$$;

-- Refus « trop d'appels » : HTTP 429 ; le message destiné au salarié est dans « details »
create or replace function private.too_many(msg text) returns void
language plpgsql volatile set search_path = public as $$
begin
  raise exception using errcode = 'PT429', message = 'Too Many Requests', detail = msg;
end $$;

-- Les limites. « depot » : demandes et emprunts déposés ; « message » : compléments des salariés ;
-- « suivi » / « erreur » : seuls les numéros inconnus comptent (on peut relire sa demande autant
-- qu'on veut), et trop d'erreurs suspendent les recherches quelques minutes.
-- Un appel refusé (ou qui échoue) n'est jamais compté : seuls les dépôts et messages réussis le sont.
create or replace function private.guard(kind text, rid bigint default null) returns void
language plpgsql volatile security definer set search_path = public as $$
declare me text := private.client_key(); n_ip int; n_all int; n_day int; n_req int;
begin
  if kind = 'depot' then
    n_ip := private.count_hit('depot', me, interval '1 hour');
    n_all := private.count_hit('depot', '*', interval '1 hour');
    n_day := private.count_hit('depot_jour', '*', interval '1 day');
    if n_ip > 30 then
      perform private.too_many('Beaucoup de demandes ont été déposées depuis ce réseau en peu de temps. '
        || 'Réessayez dans une heure, ou écrivez directement au CSE.');
    end if;
    if n_all > 100 or n_day > 300 then
      perform private.too_many('AlloCSE reçoit exceptionnellement beaucoup de demandes. '
        || 'Réessayez un peu plus tard, ou écrivez directement au CSE.');
    end if;
  elsif kind = 'message' then
    n_ip := private.count_hit('message', me, interval '1 hour');
    n_all := private.count_hit('message', '*', interval '1 hour');
    n_req := private.count_hit('message', 'demande:' || rid, interval '1 day');
    if n_req > 30 then
      perform private.too_many('Beaucoup de messages ont déjà été ajoutés à cette demande aujourd''hui. '
        || 'Réessayez demain, ou écrivez directement au CSE.');
    end if;
    if n_ip > 60 or n_all > 300 then
      perform private.too_many('Beaucoup de messages ont été envoyés en peu de temps. Réessayez dans une heure.');
    end if;
  elsif kind = 'suivi' then
    if private.hits('erreur', me, interval '10 minutes') >= 30
       or private.hits('erreur', '*', interval '10 minutes') >= 300 then
      perform private.too_many('Trop de numéros de suivi erronés en peu de temps. '
        || 'Réessayez dans une dizaine de minutes, en vérifiant le numéro.');
    end if;
  elsif kind = 'erreur' then
    perform private.count_hit('erreur', me, interval '10 minutes');
    perform private.count_hit('erreur', '*', interval '10 minutes');
  else
    raise exception 'Limite inconnue : %', kind;
  end if;
end $$;

-- Dépôt : p = { kind, temporality, situation_start, situation_end, category, subject, description,
--               anonymous, requester_name, requester_email, requester_service, visible_to_all, viewer_ids }
create or replace function public.submit_request(p jsonb) returns jsonb
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
  subj text := coalesce(private.clean_text(p ->> 'subject'), '');
  descr text := coalesce(private.clean_text(p ->> 'description'), '');
  who text := nullif(private.clean_text(p ->> 'requester_name'), '');
  service text := nullif(private.clean_text(p ->> 'requester_service'), '');
  email text := nullif(lower(private.clean_text(p ->> 'requester_email')), '');
  notify boolean := coalesce((p ->> 'notify')::boolean, false);
  notify_to text;
begin
  perform private.guard('depot');
  if k not in ('demande', 'signalement') then
    raise exception 'Type de demande invalide.' using errcode = '22023';
  end if;
  if not exists (select 1 from settings where id = 1 and (p ->> 'category') = any (categories)) then
    raise exception 'Choisissez un thème dans la liste.' using errcode = '22023';
  end if;
  if char_length(subj) < 3 then
    raise exception 'Donnez un objet d''au moins 3 caractères.' using errcode = '22023';
  end if;
  if char_length(subj) > 200 then
    raise exception 'L''objet est trop long (200 caractères au plus).' using errcode = '22023';
  end if;
  if char_length(descr) < 5 then
    raise exception 'Décrivez la situation en quelques mots.' using errcode = '22023';
  end if;
  if char_length(descr) > 10000 then
    raise exception 'La description est trop longue (10 000 caractères au plus).' using errcode = '22023';
  end if;
  if not anon and (char_length(coalesce(who, '')) > 120 or char_length(coalesce(service, '')) > 120) then
    raise exception 'Nom ou service trop long (120 caractères au plus).' using errcode = '22023';
  end if;
  if email is not null and (email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(email) > 190) then
    raise exception 'L''adresse e-mail ne semble pas valide.' using errcode = '22023';
  end if;
  -- Être prévenu par e-mail : adresse saisie pour l'occasion (même anonyme), sinon celle du demandeur
  if notify then
    notify_to := coalesce(nullif(lower(private.clean_text(p ->> 'notify_email')), ''), case when not anon then email end);
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
              s_start, s_end, p ->> 'category', subj, descr, anon,
              -- Anonyme : aucune donnée d'identité n'est enregistrée
              case when anon then null else who end,
              case when anon then null else email end,
              case when anon then null else service end,
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

-- p = { equipment_id, quantity, start_date, due_date, requester_name, requester_service, requester_email,
--       notify, message }. Les élus acceptent (le prêt est alors réservé) ou refusent.
create or replace function public.submit_loan_request(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e equipment;
  rid bigint;
  code text;
  attempts int := 0;
  q int := coalesce(nullif(p ->> 'quantity', '')::int, 1);
  d1 date := nullif(p ->> 'start_date', '')::date;
  d2 date := nullif(p ->> 'due_date', '')::date;
  who text := nullif(private.clean_text(p ->> 'requester_name'), '');
  service text := nullif(private.clean_text(p ->> 'requester_service'), '');
  email text := nullif(lower(private.clean_text(p ->> 'requester_email')), '');
  notify boolean := coalesce((p ->> 'notify')::boolean, false);
  msg text := nullif(private.clean_text(p ->> 'message'), '');
  free int;
begin
  perform private.guard('depot');
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

create or replace function public.track_request(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare rid bigint;
begin
  perform private.guard('suivi');
  if char_length(coalesce(p_code, '')) <= 40 then
    select id into rid from requests where tracking_code = private.normalize_code(p_code);
  end if;
  if rid is null then
    -- Numéro inconnu : l'échec est compté (protection contre les numéros essayés au hasard)
    perform private.guard('erreur');
    return null;
  end if;
  return private.public_view(rid);
end $$;

create or replace function public.add_public_message(p_code text, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r requests; body text := coalesce(private.clean_text(p_body), '');
begin
  perform private.guard('suivi');
  if char_length(coalesce(p_code, '')) <= 40 then
    select * into r from requests where tracking_code = private.normalize_code(p_code);
  end if;
  if r.id is null then
    -- Comme pour le suivi : rien n'est renvoyé et l'échec est compté
    perform private.guard('erreur');
    return null;
  end if;
  if r.status = 'close' then
    raise exception 'Cette demande est clôturée. Déposez une nouvelle demande si besoin.' using errcode = '22023';
  end if;
  if char_length(body) = 0 then
    raise exception 'Le message est vide.' using errcode = '22023';
  end if;
  if char_length(body) > 10000 then
    raise exception 'Message trop long (10 000 caractères au plus).' using errcode = '22023';
  end if;
  perform private.guard('message', r.id);
  insert into messages (request_id, author_type, body) values (r.id, 'salarie', body);
  insert into events (request_id, label) values (r.id, 'Complément apporté par le salarié');
  if r.status = 'repondue' then
    perform private.set_status(r.id, 'en_cours');
  end if;
  update requests set updated_at = now() where id = r.id;
  return private.public_view(r.id);
end $$;

-- Fonctions utilitaires : chemin de recherche fixé
alter function private.status_label(text) set search_path = public;
alter function private.subject_status_label(text) set search_path = public;
alter function private.fr_date(date) set search_path = public;
alter function private.month_name(int) set search_path = public;
alter function private.today() set search_path = public;
alter function private.period_text(text, date, date) set search_path = public;
alter function private.period_label(public.requests) set search_path = public;
alter function private.is_standard_vote(text[]) set search_path = public;
alter function private.vote_closed(public.votes) set search_path = public;
alter function private.vote_result(text[], int[]) set search_path = public;
alter function private.vote_options(jsonb, text) set search_path = public;
alter function private.vote_deadline(text) set search_path = public;
alter function private.loan_end(public.loans) set search_path = public;
alter function private.check_loan_dates(date, date) set search_path = public;
alter function private.ago(int, int) set search_path = public;
alter function private.html_escape(text) set search_path = public;

-- Les fonctions internes ne sont exécutables que par les fonctions de l'application
revoke execute on function private.clean_text(text), private.client_key(), private.count_hit(text, text, interval), private.hits(text, text, interval), private.too_many(text), private.guard(text, bigint) from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- Le suivi écrit désormais (compteur d'erreurs) : l'API relit la structure de la base
notify pgrst, 'reload schema';
