// Recebe as mensagens do WhatsApp (Meta Cloud API) e transforma em protocolos 3TU no Sistema V.
// URL a cadastrar na Meta:  https://SEU-SITE.netlify.app/.netlify/functions/whatsapp-webhook
import { env, json, sb, criar, alterar, numeroProtocolo, numeroCliente, waEnviarTexto, assinaturaValida,
  textoDaMensagem, uid, agoraISO, somaHoras, digitos } from '../lib/sv.mjs';

const FECHADOS = ['encerrado', 'cancelado', 'finalizado', 'resolvido', 'concluido'];
const RESPOSTA_PADRAO = 'Olá! Recebemos sua mensagem. Seu protocolo de atendimento é {protocolo}. Nossa equipe responde por aqui em breve. — 3TreeUniverse';

export default async (req) => {
  // 1) Verificação do webhook (a Meta chama com GET uma vez, ao cadastrar)
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const ok = u.searchParams.get('hub.mode') === 'subscribe' && env('WA_VERIFY_TOKEN') && u.searchParams.get('hub.verify_token') === env('WA_VERIFY_TOKEN');
    return ok ? new Response(u.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  // 2) Só aceita chamadas assinadas pela Meta
  const raw = await req.text();
  if (!assinaturaValida(raw, req.headers.get('x-hub-signature-256'))) return new Response('assinatura inválida', { status: 401 });

  let body; try { body = JSON.parse(raw); } catch { return new Response('json inválido', { status: 400 }); }

  try {
    const numeros = await sb('wa_numeros?ativo=eq.true&select=*');
    const porId = Object.fromEntries((numeros || []).map(n => [n.phone_number_id, n]));
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        const pnid = v.metadata?.phone_number_id;
        const num = porId[pnid];
        if (!num) continue; // número não cadastrado no Sistema V: ignora
        const nomes = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name || '']));
        for (const m of v.messages || []) await receber(num, m, nomes[m.from] || '');
      }
    }
  } catch (e) {
    console.error('[whatsapp-webhook]', e);
    return json(500, { erro: String(e.message || e) }); // a Meta tenta de novo depois
  }
  return json(200, { ok: true });
};

async function receber(num, m, nomePerfil) {
  const texto = textoDaMensagem(m);
  if (texto === null || texto === '') return;
  const contato = digitos(m.from);
  const em = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : agoraISO();
  const msg = { id: uid(), em, autor: 'cliente', canal: 'WhatsApp', texto, visivel: true, waId: m.id };

  // Protocolos recentes deste contato neste número
  const q = `recs?tipo=eq.protocolo&data->wa->>contato=eq.${contato}&data->wa->>phoneNumberId=eq.${encodeURIComponent(num.phone_number_id)}&select=data&order=atualizado.desc&limit=10`;
  const prots = (await sb(q)).map(x => x.data);
  if (prots.some(p => (p.mensagens || []).some(x => x.waId === m.id))) return; // já recebida (a Meta reenviou)

  const aberto = prots.find(p => !FECHADOS.includes(p.status));
  if (aberto) {
    const mud = { mensagens: [...(aberto.mensagens || []), msg] };
    if (aberto.status === 'aguardando_cliente') mud.status = 'em_analise';
    await alterar(aberto, mud, 'mensagem_cliente', { motivo: 'mensagem do cliente pelo WhatsApp', detalhe: texto.slice(0, 140), papel: 'cliente_whatsapp' });
    return;
  }

  // Novo atendimento: cliente + protocolo
  const cliente = await acharOuCriarCliente(contato, nomePerfil, num);
  const numero = await numeroProtocolo();
  const mensagens = [msg];
  const auto = (num.auto_resposta || RESPOSTA_PADRAO).replaceAll('{protocolo}', numero);
  try {
    const waId = await waEnviarTexto(num.phone_number_id, contato, auto);
    mensagens.push({ id: uid(), em: agoraISO(), por: null, papel: 'sistema', canal: 'WhatsApp', texto: auto, visivel: true, waId, auto: true });
  } catch (e) { console.error('[whatsapp-webhook] resposta automática falhou:', e.message); }

  const agora = agoraISO();
  await criar('protocolo', {
    numero, clienteId: cliente.id, pedidoId: null, unidadeId: num.unidade_id || null, produtoId: null, modulo: null,
    origem: 'whatsapp', tipoSolicitacao: 'atendimento', canal: 'WhatsApp',
    assunto: 'WhatsApp — ' + (num.rotulo || num.telefone || ''), categoria: 'Dúvida', prioridade: 'media', descricao: texto,
    nivel: 'sac', setor: 'sac', responsavelId: null, status: 'aberto', reaberturas: 0, encaminhamentos: [], mensagens,
    prazo: somaHoras(agora, 24), prazoDesde: agora,
    wa: { phoneNumberId: num.phone_number_id, contato, nome: nomePerfil || '', rotulo: num.rotulo || '', telefoneEmpresa: num.telefone || '' }
  }, 'Protocolo aberto pelo WhatsApp (' + (num.rotulo || num.telefone || num.phone_number_id) + ')', 'cliente_whatsapp');
}

async function acharOuCriarCliente(contato, nome, num) {
  const porWa = await sb(`recs?tipo=eq.cliente&data->>waId=eq.${contato}&select=data&limit=1`);
  if (porWa.length) return porWa[0].data;
  // procura pelo telefone já cadastrado (compara os últimos 9 dígitos)
  const todos = (await sb('recs?tipo=eq.cliente&select=data')).map(x => x.data);
  const fim = contato.slice(-9);
  const achado = todos.find(c => { const d = digitos(c.telefone); return d && d.length >= 8 && d.slice(-9) === fim; });
  if (achado) return achado;
  return criar('cliente', {
    numero: await numeroCliente(), tipoPessoa: 'PF', nome: nome || ('WhatsApp +' + contato), telefone: '+' + contato, email: '', documento: '', cidade: '',
    consentimento: 'sim', unidadeId: num.unidade_id || null, status: 'ativo', origem: 'whatsapp', waId: contato, idioma: 'pt'
  }, 'Cadastro criado pelo WhatsApp', 'cliente_whatsapp');
}
