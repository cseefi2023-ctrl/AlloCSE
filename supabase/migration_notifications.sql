-- =============================================================================
--  AlloCSE — mise à jour : e-mails aux salariés qui le demandent
--  (réponse du CSE, message du CSE, clôture), envoyés via Brevo.
--  À exécuter UNE fois dans une base déjà installée. Les données sont conservées.
-- =============================================================================

alter table public.settings add column if not exists mail_from text check (char_length(mail_from) <= 190);
alter table public.settings add column if not exists app_url text check (char_length(app_url) <= 300);
grant update (mail_from, app_url) on public.settings to authenticated;

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

create or replace function private.notify(rid bigint, what text) returns void
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

create or replace function private.on_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_type = 'elu' and not new.internal then
    perform private.notify(new.request_id, case when new.is_answer then 'reponse' else 'message' end);
  end if;
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function private.on_message_notify();

create or replace function private.on_close_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.notify(new.id, 'cloture');
  return new;
end $$;
create trigger requests_close_notify after update of status on public.requests
  for each row when (new.status = 'close' and old.status is distinct from 'close')
  execute function private.on_close_notify();

create or replace function private.html_escape(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- Contenu de l'e-mail : jamais le texte de la réponse, seulement l'invitation à la lire dans l'appli
create or replace function private.notification_mail(n public.notifications) returns jsonb
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

create or replace function private.brevo_key() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'brevo_api_key' limit 1);
exception when others then
  return null;
end $$;

-- Remet une notification en file après un échec (en la fusionnant avec une éventuelle autre en attente)
create or replace function private.retry_notification(n public.notifications, err text) returns void
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
create or replace function private.dispatch_notifications() returns int
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
create or replace function public.admin_notification_status() returns jsonb
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

create or replace function public.admin_send_test_mail() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  perform private.require_admin();
  insert into notifications (to_email, test) select email, true from elus where id = auth.uid();
  return public.admin_notification_status();
end $$;


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


create or replace function private.request_detail(rid bigint) returns jsonb
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
    'notify', exists (select 1 from request_notify n where n.request_id = r.id),
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


create or replace function private.public_view(rid bigint) returns jsonb
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


create or replace function private.wipe_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate public.notifications, public.request_notify, public.commitments, public.agenda_items, public.recurring_points, public.meetings, public.events,
    public.messages, public.request_viewers, public.requests restart identity;
end $$;


grant execute on function public.admin_notification_status(), public.admin_send_test_mail() to authenticated;
revoke execute on function public.admin_notification_status(), public.admin_send_test_mail() from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.request_summary(public.requests), private.elu_json(uuid),
  private.subject_number_of(public.requests) to authenticated;

notify pgrst, 'reload schema';
