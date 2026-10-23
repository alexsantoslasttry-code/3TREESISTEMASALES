// Passa ao navegador o endereço do Supabase e a chave pública (anon). Nunca a chave de serviço.
import { env, json } from '../lib/sv.mjs';

export default async () => {
  const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY');
  if (!url || !anon) return json(200, { online: false });
  return json(200, { online: true, url, anon });
};
