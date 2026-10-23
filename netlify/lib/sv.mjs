// Funções compartilhadas pelas funções do Netlify do Sistema V.
// Mesmas regras do index.html: numeração 3TU, histórico encadeado por hash.
import crypto from 'node:crypto';

export const env = k => (process.env[k] || '').trim();

export function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/* ---------------- Supabase (REST, com a chave de serviço) ---------------- */
function sbBase() {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no Netlify.');
  return { url: url.replace(/\/+$/, ''), key };
}
export async function sb(path, { method = 'GET', body, headers = {} } = {}) {
  const { url, key } = sbBase();
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${r.status} ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}
export const nextSeq = async chave => sb('rpc/next_seq', { method: 'POST', body: { p_chave: chave, p_n: 1 } });
export async function salvarRec(rec) {
  await sb('recs?on_conflict=id', {
    method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { id: rec.id, tipo: rec.tipo, data: rec, atualizado: new Date().toISOString() }
  });
}
export async function addEvent(ev) {
  await sb('ev', { method: 'POST', headers: { prefer: 'return=minimal' }, body: { id: ev.id, ref: ev.ref, n: ev.n, em: ev.em, data: ev } });
}
/** Confere o login do Supabase de quem chamou (token do navegador). */
export async function usuarioDoToken(token) {
  const { url } = sbBase();
  const anon = env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json();
}

/* ---------------- utilidades iguais às do index.html ---------------- */
export const uid = () => crypto.randomUUID();
export const agoraISO = () => new Date().toISOString();
export const somaHoras = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toISOString();
export const digitos = s => String(s || '').replace(/\D/g, '');
const sha256 = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export const hashEv = e => sha256([e.hashAnterior || '', e.ref, e.n, e.em, e.pessoaId || '', e.papel, e.acao, e.detalhe || '',
  canon(e.antes ?? null), canon(e.depois ?? null), e.motivo || ''].join('|'));
const limpo = r => { const { hist, ...x } = r; return x; };
const clone = o => JSON.parse(JSON.stringify(o));

/** Mesma lógica de registrar() do index.html. Atualiza rec.hist e grava o evento. */
export async function registrar(rec, acao, { antes = null, depois = null, motivo = '', detalhe = '', papel = 'whatsapp' } = {}) {
  const prev = rec.hist || { n: 0, hash: '' };
  const ev = clone({ id: uid(), ref: rec.id, tipo: rec.tipo, numero: rec.numero || '', n: prev.n + 1, em: agoraISO(), pessoaId: null, papel,
    unidadeId: rec.unidadeId || null, acao, detalhe, antes, depois, motivo, hashAnterior: prev.hash });
  ev.hash = hashEv(ev);
  rec.hist = { n: ev.n, hash: ev.hash };
  await addEvent(ev);
  return ev;
}
export async function criar(tipo, dados, detalhe, papel) {
  const rec = { id: uid(), tipo, criadoEm: agoraISO(), criadoPor: null, atualizadoEm: agoraISO(), ...dados };
  await registrar(rec, 'criacao', { depois: clone(limpo(rec)), detalhe: detalhe || ('Criado: ' + tipo), papel });
  await salvarRec(rec);
  return rec;
}
export async function alterar(rec, mudancas, acao, { motivo, detalhe, papel } = {}) {
  const antes = {}, depois = {};
  for (const [k, v] of Object.entries(mudancas)) {
    if (JSON.stringify(rec[k]) !== JSON.stringify(v)) { antes[k] = rec[k] === undefined ? null : rec[k]; depois[k] = v; }
  }
  const novo = { ...rec, ...mudancas, atualizadoEm: agoraISO() };
  await registrar(novo, acao, { antes: clone(antes), depois: clone(depois), motivo, detalhe, papel });
  await salvarRec(novo);
  return novo;
}
export async function numeroProtocolo() {
  const ano = new Date().getFullYear();
  const s = await nextSeq('protocolo-' + ano);
  return `3TU-${ano}-${String(s).padStart(6, '0')}`;
}
export async function numeroCliente() {
  const s = await nextSeq('cliente-0');
  return `CL-${String(s).padStart(6, '0')}`;
}

/* ---------------- WhatsApp Cloud API ---------------- */
export async function waEnviarTexto(phoneNumberId, para, texto) {
  const token = env('WA_TOKEN');
  if (!token) throw new Error('WA_TOKEN não configurado no Netlify.');
  const ver = env('WA_GRAPH_VERSION') || 'v23.0';
  const r = await fetch(`https://graph.facebook.com/${ver}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: digitos(para), type: 'text', text: { preview_url: false, body: texto } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = d?.error || {};
    const err = new Error(e.message || `WhatsApp recusou o envio (${r.status})`);
    err.codigo = e.code; err.status = r.status;
    throw err;
  }
  return d?.messages?.[0]?.id || null;
}
export function assinaturaValida(rawBody, header) {
  const secret = env('WA_APP_SECRET');
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Converte uma mensagem recebida do WhatsApp em texto para o protocolo. */
export function textoDaMensagem(m) {
  const leg = x => (x && x.caption ? ': ' + x.caption : '');
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'image': return '[imagem]' + leg(m.image);
    case 'video': return '[vídeo]' + leg(m.video);
    case 'audio': return m.audio?.voice ? '[áudio de voz]' : '[áudio]';
    case 'document': return '[documento' + (m.document?.filename ? ' ' + m.document.filename : '') + ']' + leg(m.document);
    case 'sticker': return '[figurinha]';
    case 'location': return `[localização] ${m.location?.latitude},${m.location?.longitude}` + (m.location?.name ? ' — ' + m.location.name : '');
    case 'contacts': return '[contato compartilhado]';
    case 'button': return m.button?.text || '[botão]';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[resposta]';
    case 'reaction': return null; // reações não viram mensagem
    default: return `[${m.type || 'mensagem'}]`;
  }
}
