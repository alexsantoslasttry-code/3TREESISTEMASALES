// Envia uma resposta da equipe pelo mesmo número de WhatsApp que recebeu o atendimento.
// Chamado pelo Sistema V (usuário logado). O registro da mensagem no protocolo é feito pelo navegador,
// para o histórico continuar no nome de quem respondeu.
import { json, sb, usuarioDoToken, waEnviarTexto } from '../lib/sv.mjs';

const JANELA_H = 24; // a Meta só aceita texto livre até 24h depois da última mensagem do cliente

export default async (req) => {
  if (req.method !== 'POST') return json(405, { erro: 'Use POST.' });
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !(await usuarioDoToken(token))) return json(401, { erro: 'Faça login no Sistema V de novo.' });

  let b; try { b = await req.json(); } catch { return json(400, { erro: 'Pedido inválido.' }); }
  const texto = String(b.texto || '').trim();
  if (!b.protocoloId || !texto) return json(400, { erro: 'Faltou o protocolo ou o texto.' });
  if (texto.length > 4000) return json(400, { erro: 'Mensagem longa demais para o WhatsApp (máx. 4000 caracteres).' });

  const rows = await sb(`recs?id=eq.${encodeURIComponent(b.protocoloId)}&select=data&limit=1`);
  const r = rows[0]?.data;
  if (!r || r.tipo !== 'protocolo' || !r.wa?.phoneNumberId || !r.wa?.contato) return json(404, { erro: 'Este protocolo não está ligado a um WhatsApp.' });

  const ultimaDoCliente = [...(r.mensagens || [])].reverse().find(m => m.autor === 'cliente');
  if (!ultimaDoCliente || Date.now() - new Date(ultimaDoCliente.em).getTime() > JANELA_H * 3600e3) {
    return json(409, { erro: 'Passaram mais de 24h desde a última mensagem do cliente. Pelas regras do WhatsApp, só dá para responder depois que ele escrever de novo (ou com um modelo aprovado pela Meta).' });
  }
  try {
    const waId = await waEnviarTexto(r.wa.phoneNumberId, r.wa.contato, texto);
    return json(200, { ok: true, waId });
  } catch (e) {
    return json(502, { erro: 'O WhatsApp não aceitou o envio: ' + e.message });
  }
};
