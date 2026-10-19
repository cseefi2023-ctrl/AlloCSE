// =====================================================================
//  AlloCSE — espaces CSE (une entreprise = une base Supabase séparée)
//
//  Chaque espace s'ouvre avec son lien :  https://…/AlloCSE/?cse=<clé>
//  Pour chaque espace, renseignez (Supabase > Project Settings > API Keys) :
//    - supabaseUrl     : l'URL du projet (https://xxxx.supabase.co)
//    - supabaseAnonKey : la clé publique « publishable » (sb_publishable_…)
//  Ces clés sont faites pour être publiques : les droits sont contrôlés dans
//  chaque base (supabase/schema.sql). Ne mettez JAMAIS de clé « secret ».
//
//  default : l'espace ouvert quand le lien ne précise rien (la démo, pour
//  les prospects, une fois son projet Supabase créé).
// =====================================================================
window.ALLOCSE_CONFIG = {
  default: 'efi',
  tenants: {
    // Démonstration : données fictives, remises à zéro chaque nuit (voir supabase/demo.sql)
    demo: {
      name: 'AlloCSE, démonstration',
      demo: true,
      supabaseUrl: 'https://VOTRE-PROJET-DEMO.supabase.co',
      supabaseAnonKey: 'VOTRE_CLE_PUBLIQUE',
    },
    efi: {
      name: 'CSE EFI Automotive',
      logo: 'logos/cse-efi.png',
      supabaseUrl: 'https://tpgpuxrwlvdtllvrocsw.supabase.co',
      supabaseAnonKey: 'sb_publishable_uXJu3vU1IFKlZmbofZ6gNA_6AxHEj-j',
    },
  },
}
