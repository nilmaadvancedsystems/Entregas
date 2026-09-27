// Responder um e-mail pela tela do Robô do Gmail (Pendências › e-mail aberto).
//
// A tela grava em solicitacoesEmail { tipo: 'responder', mensagemId, corpo,
// todos, anexo? }. O vigia confere e manda a resposta da caixa do escritório
// NA MESMA CONVERSA do Gmail: "Re: assunto", In-Reply-To/References do
// original e o threadId, com o e-mail original citado embaixo (recolhido no
// Gmail, como uma resposta feita lá).
//
// Cuidados:
//   - só responde e-mail que o próprio robô listou pra tela (caixa, spam,
//     remetentes sem cliente): o pedido não vira um jeito de mandar e-mail
//     pra qualquer um em nome do escritório;
//   - só admin ou contábil (confere o cadastro de quem pediu, não só a regra);
//   - "responder a todos" copia (Cc) quem estava no Para/Cc do original,
//     menos a própria caixa.
const { textoDoEmail, cabecalho, mensagensDaTela } = require('./leituras-gmail');

const ID_VALIDO = /^[0-9a-f]{10,32}$/i;
const CITACAO_MAX = 8000;

function enderecos(lista) {
  return (String(lista || '').match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g) || []).map(e => e.toLowerCase());
}
const esc = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const semQuebra = t => String(t || '').replace(/[\r\n]+/g, ' ').trim();

// A resposta pronta, sem tocar em nada (testável).
// headers: os do e-mail original; -> { para, cc, assunto, corpo, html, cabecalhos }
function montarResposta({ headers, textoOriginal, corpo, todos, caixa, dataOriginal, assinatura }) {
  const h = n => cabecalho(headers, n);
  const minha = String(caixa || '').toLowerCase();
  const de = enderecos(h('Reply-To'))[0] || enderecos(h('From'))[0] || '';
  // e-mail que a própria caixa mandou: a resposta vai pra quem recebeu
  const para = de && de !== minha ? de : (enderecos(h('To')).find(e => e !== minha) || '');
  if (!para) throw new Error('não achei o endereço de quem mandou o e-mail');
  const cc = todos ? [...new Set(enderecos(h('To') + ',' + h('Cc')))].filter(e => e !== minha && e !== para).slice(0, 20) : [];
  const assuntoOrig = semQuebra(h('Subject'));
  const assunto = /^(re|res|resp)\s*:/i.test(assuntoOrig) ? assuntoOrig : 'Re: ' + (assuntoOrig || '(sem assunto)');
  const msgId = semQuebra(h('Message-ID') || h('Message-Id'));
  const refs = semQuebra(h('References'));
  const cabecalhos = [];
  if (msgId) { cabecalhos.push('In-Reply-To: ' + msgId); cabecalhos.push('References: ' + (refs ? refs + ' ' : '') + msgId); }
  const quando = dataOriginal ? new Date(dataOriginal).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
  const quem = semQuebra(h('From')) || para;
  const linhaCitacao = 'Em ' + (quando || 'data desconhecida') + ', ' + quem + ' escreveu:';
  const original = String(textoOriginal || '').slice(0, CITACAO_MAX);
  const texto = String(corpo || '').trim();
  const corpoTexto = texto + '\n\n' + linhaCitacao + '\n' + original.split('\n').map(l => '> ' + l).join('\n');
  // HTML no formato do Gmail: a citação fica recolhida em "..." lá
  // assinatura discreta do escritório (só no HTML; o texto puro fica como foi escrito)
  const nomeEsc = esc(assinatura || 'Nilma Contabilidade');
  const fonte = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const assin = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr>' +
    '<td style="border-left:3px solid #B0262D;padding:2px 0 2px 10px;font:13px/1.5 ' + fonte + ';color:#5E5D64">' +
    '<b style="color:#1D1C1F">' + nomeEsc + '</b>' + (caixa ? '<br><a href="mailto:' + esc(caixa) + '" style="color:#5E5D64">' + esc(caixa) + '</a>' : '') + '</td></tr></table>';
  const html = '<div dir="ltr" style="font:14px/1.6 ' + fonte + ';color:#1D1C1F">' + esc(texto).replace(/\n/g, '<br>') + '</div>' + assin + '<br>' +
    '<div class="gmail_quote"><div dir="ltr" class="gmail_attr">' + esc(linhaCitacao) + '<br></div>' +
    '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' +
    esc(original).replace(/\n/g, '<br>') + '</blockquote></div>';
  return { para, cc, assunto, corpo: corpoTexto, html, cabecalhos };
}

// -> { gmailId, para, cc, assunto }
async function responder({ db, gmail, p, caixa, montarMime, anexo }) {
  const id = String(p.mensagemId || '');
  if (!ID_VALIDO.test(id)) throw new Error('e-mail inválido');
  const corpo = String(p.corpo || '').trim().slice(0, 20000);
  if (!corpo) throw new Error('a resposta está vazia');
  const quem = p.criadoPorUid ? ((await db.collection('usuarios').doc(String(p.criadoPorUid)).get()).data() || {}) : {};
  const papeis = Array.isArray(quem.roles) ? quem.roles : (quem.role ? [quem.role] : []);
  if (!papeis.includes('admin') && !papeis.includes('contabil')) throw new Error('só admin ou contábil responde e-mail pelo app');
  if (!(await mensagensDaTela(db)).has(id)) throw new Error('este e-mail não está mais na lista do robô; responda pelo Gmail');
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const payload = msg.data.payload || {};
  const r = montarResposta({
    headers: payload.headers || [], textoOriginal: textoDoEmail(payload), corpo, todos: !!p.todos, caixa, assinatura: p.assinatura,
    dataOriginal: Number(msg.data.internalDate) || null,
  });
  const raw = montarMime({ de: caixa, para: r.para, cc: r.cc, assunto: r.assunto, corpo: r.corpo, html: r.html, cabecalhos: r.cabecalhos, anexos: anexo ? [anexo] : [] });
  const enviado = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: msg.data.threadId } });
  return { gmailId: enviado.data.id, para: r.para, cc: r.cc, assunto: r.assunto };
}

module.exports = { montarResposta, responder, enderecos };
