// =====================================================================
//  AlloCSE — connexion à Supabase
//  Renseignez ces deux valeurs (Supabase > Project Settings > API Keys) :
//    - l'URL du projet  (https://xxxx.supabase.co)
//    - la clé publique  : « publishable key » (sb_publishable_…)
//                         ou, onglet Legacy, la clé « anon »
//  Cette clé est faite pour être publique : les droits sont contrôlés
//  dans la base (supabase/schema.sql). Ne mettez JAMAIS ici la clé
//  « secret » ni « service_role ».
// =====================================================================
window.ALLOCSE_CONFIG = {
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseAnonKey: 'VOTRE_CLE_ANON',
}
