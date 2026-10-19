-- =============================================================================
--  AlloCSE — base de DÉMONSTRATION
--  À exécuter UNE fois, après schema.sql, uniquement dans le projet Supabase
--  de démonstration (jamais dans la base d'un vrai CSE).
--
--  Comptes de démonstration (à créer d'abord dans l'appli, « Je suis un nouvel élu ») :
--    demo-admin@allocse.app   mot de passe demo-allocse   (administrateur)
--    demo-elu@allocse.app     mot de passe demo-allocse   (élu)
--  La fonction demo_reset() remet tout à zéro : comptes, réglages, données fictives.
--  Elle est appelée chaque nuit par le workflow GitHub demo-reset.yml.
-- =============================================================================

update public.settings set is_demo = true, organisation = 'Industrie Démo', contact = 'cse@industrie-demo.fr'
where id = 1;

-- En démonstration, personne ne peut déposer de modèle Word : les modèles neutres sont utilisés
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists allocse_modeles_insert on storage.objects;
    drop policy if exists allocse_modeles_update on storage.objects;
    drop policy if exists allocse_modeles_delete on storage.objects;
  end if;
end $$;

create function public.demo_reset() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s settings;
  adm uuid; elu uuid;
  demo_emails text[] := array['demo-admin@allocse.app', 'demo-elu@allocse.app'];
begin
  select * into s from settings where id = 1 for update;
  if not s.is_demo then
    raise exception 'Cet espace n''est pas une démonstration.' using errcode = '42501';
  end if;
  if s.demo_reset_at > now() - interval '2 minutes' then
    return jsonb_build_object('reset', false, 'reset_at', s.demo_reset_at);
  end if;

  -- Comptes : seuls les comptes de démonstration restent, avec leur mot de passe d'origine
  delete from auth.users where lower(email) <> all (demo_emails);
  begin
    update auth.users set encrypted_password = extensions.crypt('demo-allocse', extensions.gen_salt('bf'))
    where lower(email) = any (demo_emails);
  exception when others then null;  -- mot de passe non réinitialisable : on continue
  end;
  update elus set role = 'admin', is_active = true, validated_at = coalesce(validated_at, now()),
                  full_name = 'Camille Durand', mandate = 'Secrétaire du CSE'
  where email = demo_emails[1] returning id into adm;
  update elus set role = 'elu', is_active = true, validated_at = coalesce(validated_at, now()),
                  full_name = 'Lucas Bernard', mandate = 'Titulaire, collège ouvriers'
  where email = demo_emails[2] returning id into elu;

  -- Données et réglages
  perform private.wipe_data();
  update settings set
    app_name = default, tracking_prefix = default, subject_prefix = default, categories = default,
    odj_weights = default, odj_wordings = default, odj_fixed_points = default, word_settings = default,
    organisation = 'Industrie Démo', contact = 'cse@industrie-demo.fr', demo_reset_at = now()
  where id = 1;
  perform private.load_sample(coalesce(adm, elu), case when adm is null then null else elu end);
  return jsonb_build_object('reset', true, 'reset_at', now());
end $$;

grant execute on function public.demo_reset() to anon, authenticated;

select public.demo_reset();
