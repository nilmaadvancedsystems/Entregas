// Versão em HTML da cobrança que o robô manda pelo Gmail.
//
// O texto é o dos modelos (Pendências › Configurações) e continua no meio do
// e-mail. Em volta dele:
//   - faixa com o mês e manchete "Faltam N documentos", barra do que já
//     chegou e o prazo;
//   - no lugar da lista "- Extrato Bancário", um cartão por documento; o
//     extrato mostra os bancos do cliente com o logo e se já chegou;
//   - no lugar do link solto, o botão pra mandar pela página do cliente e o
//     passo a passo de responder com anexo.
// Vai junto a versão em texto puro (o próprio modelo).
//
// Imagens: logos em scripts/logos-bancos/<id>.png e ícones em
// scripts/icones-email/*.png, anexados no e-mail (cid:), então aparecem mesmo
// com imagens externas bloqueadas. Banco sem logo vira selo com a sigla.
// Tudo em tabela e estilo inline: é o que Gmail e Outlook respeitam.
const fs = require('fs');
const path = require('path');
const { POR_ID } = require('./bancos');

const PASTA_LOGOS = path.join(__dirname, 'logos-bancos');
const PASTA_ICONES = path.join(__dirname, 'icones-email');
// As cores do app (nilma-ui.css, tema claro): o e-mail tem a cara das telas.
const COR = {
  tinta: '#1D1C1F', suave: '#5E5D64', fraca: '#8C8C92', borda: '#DADADF', fundo: '#F7F7F8', faixa: '#EEEEF0',
  vinho: '#B0262D', vinhoClaro: '#F9E7E7', ok: '#116329', okClaro: '#DAFBE1', okBorda: '#ACE8BA',
  falta: '#953800', faltaClaro: '#FFF1E5', faltaBorda: '#FFD8B5',
};
const FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const TIPOS = {
  extrato: { nome: 'Extrato bancário', icone: 'extrato', rotulos: /extrato banc|extrato do banco/i, dica: 'O mês inteiro, de cada conta.' },
  comprovante: { nome: 'Comprovantes de pagamento', icone: 'comprovante', rotulos: /comprovante/i, dica: 'Dos pagamentos feitos no mês.' },
  aplicacao: { nome: 'Extrato de aplicação', icone: 'aplicacao', rotulos: /aplica/i, dica: 'Das aplicações e investimentos.' },
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_CURTO = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const tipoDaLinha = linha => Object.keys(TIPOS).find(k => TIPOS[k].rotulos.test(linha)) || '';

// Anexa a imagem uma vez e devolve o <img>; sem o arquivo, null. lado pode
// ser [largura, altura] (o logo não é quadrado).
function imagem(imagens, pasta, nome, lado, estilo) {
  const arquivo = path.join(pasta, nome + '.png');
  if (!fs.existsSync(arquivo)) return null;
  const cid = (pasta === PASTA_LOGOS ? 'banco-' : 'icone-') + nome;
  if (!imagens.some(i => i.cid === cid)) imagens.push({ cid, arquivo, mime: 'image/png' });
  const [w, h] = Array.isArray(lado) ? lado : [lado, lado];
  return '<img src="cid:' + cid + '" width="' + w + '" height="' + h + '" alt="" style="display:block;width:' + w + 'px;height:' + h + 'px;border:0;' + (estilo || '') + '">';
}

function marcaDoBanco(b, imagens, lado) {
  lado = lado || 18;
  return imagem(imagens, PASTA_LOGOS, b.id, lado, 'display:inline-block;vertical-align:middle;border-radius:5px;margin-right:6px') ||
    '<span style="display:inline-block;vertical-align:middle;width:' + lado + 'px;height:' + lado + 'px;border-radius:5px;margin-right:6px;background:' + b.cor + ';color:' + b.tinta +
    ';font:700 7px/' + lado + 'px ' + FONTE + ';text-align:center;white-space:nowrap;overflow:hidden">' + esc(b.sigla) + '</span>';
}

// Selo no desenho do app (.badge): texto pequeno, borda e fundo claros.
function selo(texto, tipo) {
  const c = tipo === 'ok' ? [COR.okClaro, COR.okBorda, COR.ok] : tipo === 'falta' ? [COR.faltaClaro, COR.faltaBorda, COR.falta] : ['#FFFFFF', COR.borda, COR.suave];
  return '<span style="display:inline-block;padding:3px 8px;border-radius:2em;border:1px solid ' + c[1] + ';background:' + c[0] +
    ';font:500 12px/16px ' + FONTE + ';color:' + c[2] + ';white-space:nowrap">' + esc(texto) + '</span>';
}

// Um banco dentro da linha do documento: selo pequeno com o logo e se chegou.
function seloDoBanco(b, recebido, imagens) {
  return '<span style="display:inline-block;margin:8px 6px 0 0;padding:3px 10px 3px 4px;border-radius:2em;white-space:nowrap;' +
    'border:1px solid ' + (recebido ? COR.okBorda : COR.borda) + ';background:' + (recebido ? COR.okClaro : '#FFFFFF') + ';font:500 13px/18px ' + FONTE + ';color:' + COR.tinta + '">' +
    marcaDoBanco(b, imagens) + '<span style="vertical-align:middle">' + esc(b.nome) + '</span>' +
    '<span style="vertical-align:middle;color:' + (recebido ? COR.ok : COR.falta) + '">&nbsp;·&nbsp;' + (recebido ? '✓ Recebido' : 'Falta') + '</span></span>';
}

// Uma linha por documento que falta, todas numa lista só: ícone, nome, o que
// mandar e, com bancos conhecidos, um selo por banco (os que faltam primeiro).
// Vale pros três documentos, que saem todos do banco.
function linhaDoDocumento(tipo, cliente, recebidosPorTipo, imagens) {
  const t = TIPOS[tipo];
  const recebidos = (recebidosPorTipo && recebidosPorTipo[tipo]) || [];
  const bancos = (cliente.bancos || []).map(id => POR_ID.get(id)).filter(Boolean);
  const faltam = bancos.filter(b => !recebidos.includes(b.id)).length;
  const icone = imagem(imagens, PASTA_ICONES, t.icone, 20) || '';
  // com um banco só, o selo já diz qual: o resumo fica "Falta"
  const resumo = bancos.length > 1
    ? (faltam === 1 ? 'Falta 1 banco' : faltam ? 'Faltam ' + faltam + ' bancos' : 'Todos chegaram')
    : 'Falta';
  const ordem = bancos.slice().sort((a, b) => recebidos.includes(a.id) - recebidos.includes(b.id));
  const selos = ordem.map(b => seloDoBanco(b, recebidos.includes(b.id), imagens)).join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="44" style="vertical-align:top;padding-top:1px"><table role="presentation" width="32" height="32" cellpadding="0" cellspacing="0" style="background:' + COR.vinhoClaro + ';border-radius:6px"><tr><td align="center" valign="middle" style="height:32px">' + icone + '</td></tr></table></td>' +
    '<td style="vertical-align:top">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="vertical-align:top;font:600 15px/1.35 ' + FONTE + ';color:' + COR.tinta + '">' + esc(t.nome) +
          '<div style="font:13px/1.45 ' + FONTE + ';color:' + COR.suave + ';font-weight:400;margin-top:1px">' + esc(t.dica) + '</div></td>' +
        '<td align="right" style="vertical-align:top;white-space:nowrap;padding-left:8px">' + selo(resumo, 'falta') + '</td>' +
      '</tr></table>' +
      (selos ? '<div style="margin-top:2px">' + selos + '</div>' : '') +
    '</td></tr></table>';
}

// Quanto já chegou: cada documento conta um por banco conhecido. Cliente
// com três bancos deve nove documentos, não três.
function progresso(cliente, faltando, recebidosPorTipo) {
  const naoAplica = Array.isArray(cliente.documentosNaoAplicaveis) ? cliente.documentosNaoAplicaveis : [];
  const bancos = (cliente.bancos || []).filter(id => POR_ID.has(id));
  let total = 0, feitos = 0;
  Object.keys(TIPOS).filter(k => !naoAplica.includes(k)).forEach(k => {
    const recebidos = (recebidosPorTipo && recebidosPorTipo[k]) || [];
    if (bancos.length) {
      total += bancos.length;
      feitos += faltando.includes(k) ? bancos.filter(id => recebidos.includes(id)).length : bancos.length;
    } else { total += 1; if (!faltando.includes(k)) feitos += 1; }
  });
  return { total, feitos, faltam: total - feitos };
}

function textoDoPrazo(competencia, diaLimite, agora) {
  const p = String(competencia || '').split('-').map(Number);
  if (!diaLimite || p.length !== 2 || !p[0]) return null;
  const limite = new Date(p[0], p[1], Number(diaLimite));            // mês seguinte à competência
  const hoje = new Date((agora || new Date()).getFullYear(), (agora || new Date()).getMonth(), (agora || new Date()).getDate());
  const dias = Math.round((limite - hoje) / 864e5);
  const data = pad2(limite.getDate()) + '/' + pad2(limite.getMonth() + 1);
  if (dias < 0) return { texto: 'O prazo era ' + data + ' (' + (-dias === 1 ? 'ontem' : 'há ' + -dias + ' dias') + ')', atrasado: true };
  if (dias === 0) return { texto: 'O prazo é hoje, ' + data, atrasado: true };
  return { texto: 'Prazo: até ' + data + ' (' + (dias === 1 ? 'amanhã' : 'faltam ' + dias + ' dias') + ')', atrasado: false };
}

// Moldura comum dos e-mails do escritório, no desenho do app: faixa clara com
// o logo e o nome, título da página, o conteúdo em cartões e o rodapé.
// { assinatura, caixa, chip, previa, titulo, sobre, cabecalho, corpo, imagens }
function moldura(o) {
  const logo = imagem(o.imagens, PASTA_ICONES, 'marca', [15, 24], 'display:inline-block;vertical-align:middle;margin-right:10px') || '';
  const nome = o.assinatura || 'Nilma Contabilidade';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + esc(o.titulo || nome) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + COR.fundo + ';-webkit-text-size-adjust:100%">' +
    // pré-cabeçalho: a linha cinza que aparece na lista do Gmail
    (o.previa ? '<div style="display:none;max-height:0;overflow:hidden">' + esc(o.previa) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + COR.fundo + '"><tr><td align="center" style="padding:24px 12px 32px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid ' + COR.borda + ';border-radius:6px">' +

    // barra de cima, como a do app
    '<tr><td style="background:' + COR.fundo + ';border-bottom:1px solid ' + COR.borda + ';border-radius:6px 6px 0 0;padding:12px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font:600 15px/24px ' + FONTE + ';color:' + COR.tinta + '">' + logo + '<span style="vertical-align:middle">' + esc(nome) + '</span></td>' +
      (o.chip ? '<td align="right">' + selo(o.chip) + '</td>' : '') +
    '</tr></table></td></tr>' +

    // título da página
    '<tr><td style="padding:24px 20px 20px;border-bottom:1px solid ' + COR.borda + '">' +
      (o.sobre ? '<div style="font:12px/16px ' + FONTE + ';color:' + COR.suave + '">' + esc(o.sobre) + '</div>' : '') +
      '<div style="font:600 20px/28px ' + FONTE + ';color:' + COR.tinta + ';margin-top:4px">' + esc(o.titulo || '') + '</div>' +
      (o.cabecalho || '') +
    '</td></tr>' +

    '<tr><td style="padding:20px 20px 4px">' + o.corpo + '</td></tr>' +

    // rodapé
    '<tr><td style="border-top:1px solid ' + COR.borda + ';padding:14px 20px;font:12px/1.55 ' + FONTE + ';color:' + COR.suave + '">' +
      esc(nome) + (o.caixa ? ' · <a href="mailto:' + esc(o.caixa) + '" style="color:' + COR.suave + '">' + esc(o.caixa) + '</a>' : '') +
      (o.rodape ? '<br>' + esc(o.rodape) : '') +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// Cartão do app: cabeçalho cinza com título e o conteúdo embaixo.
function cartao(titulo, conteudo, iconeHtml) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid ' + COR.borda + ';border-radius:6px">' +
    '<tr><td style="background:' + COR.fundo + ';border-bottom:1px solid ' + COR.borda + ';border-radius:6px 6px 0 0;padding:10px 16px;font:600 14px/20px ' + FONTE + ';color:' + COR.tinta + '">' +
      (iconeHtml || '') + '<span style="vertical-align:middle">' + esc(titulo) + '</span></td></tr>' +
    '<tr><td style="padding:14px 16px">' + conteudo + '</td></tr></table>';
}

// Parágrafos do texto (linhas em branco separam).
function paragrafos(texto) {
  return String(texto || '').replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
    .map(b => '<p style="margin:0 0 14px;font:15px/1.6 ' + FONTE + ';color:' + COR.tinta + '">' + b.split('\n').map(esc).join('<br>') + '</p>').join('');
}

// { corpo, cliente, competencia, faltando?, bancosPorTipo | bancosRecebidos, diaLimite, assinatura, caixa, agora } -> { html, imagens }
function htmlDaCobranca(o) {
  const imagens = [];
  const cliente = o.cliente || {};
  // bancosPorTipo é o formato de agora; bancosRecebidos era só do extrato e
  // segue valendo pro mês gravado antes desta mudança.
  const recebidos = (o.bancosPorTipo && typeof o.bancosPorTipo === 'object')
    ? o.bancosPorTipo
    : { extrato: Array.isArray(o.bancosRecebidos) ? o.bancosRecebidos : [] };
  const linhas = String(o.corpo || '').replace(/\r/g, '').split('\n');
  const faltando = Array.isArray(o.faltando) && o.faltando.length ? o.faltando
    : [...new Set(linhas.filter(l => /^\s*-\s+/.test(l)).map(tipoDaLinha).filter(Boolean))];
  const link = (linhas.find(l => /^\s*https?:\/\/\S+\s*$/.test(l)) || '').trim();

  // o texto do modelo, com a lista virando uma caixa no mesmo lugar
  const blocos = [];
  let paragrafo = [], cartoes = null;
  const fechaP = () => { if (paragrafo.length) blocos.push('<p style="margin:0 0 14px;font:15px/1.6 ' + FONTE + ';color:' + COR.tinta + '">' + paragrafo.map(esc).join('<br>') + '</p>'); paragrafo = []; };
  // a lista "- Extrato Bancário" vira uma caixa só, uma linha por documento
  const fechaC = () => {
    if (cartoes && cartoes.length) blocos.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;background:#FFFFFF;border:1px solid ' + COR.borda + ';border-radius:6px">' +
      cartoes.map((c, k) => '<tr><td style="padding:14px 16px;' + (k ? 'border-top:1px solid ' + COR.borda : '') + '">' + c + '</td></tr>').join('') + '</table>');
    cartoes = null;
  };
  linhas.forEach((bruta, i) => {
    const l = bruta.trim();
    if (/^-\s+/.test(l)) {
      fechaP();
      const tipo = tipoDaLinha(l);
      cartoes = cartoes || [];
      if (tipo && !cartoes.some(c => c.tipo === tipo)) { const c = new String(linhaDoDocumento(tipo, cliente, recebidos, imagens)); c.tipo = tipo; cartoes.push(c); }
      else if (!tipo) cartoes.push('<div style="font:600 15px/1.4 ' + FONTE + ';color:' + COR.tinta + '">' + esc(l.replace(/^-\s+/, '')) + '</div>');
    } else if (/^https?:\/\//.test(l)) {
      fechaP(); fechaC();                                   // o link vira o botão lá embaixo
    } else if (l.endsWith(':') && /^https?:\/\//.test((linhas[i + 1] || '').trim())) {
      fechaP();                                             // "…fica sempre atualizado aqui:" sai junto com o link
    } else if (!l) { fechaP(); fechaC(); }
    else { fechaC(); paragrafo.push(l); }
  });
  fechaP(); fechaC();

  const p = progresso(cliente, faltando, recebidos);
  const comp = String(o.competencia || '').split('-');
  const mesNome = MESES[Number(comp[1]) - 1] || '';
  const chip = MES_CURTO[Number(comp[1]) - 1] ? MES_CURTO[Number(comp[1]) - 1] + ' ' + comp[0] : '';
  const prazo = textoDoPrazo(o.competencia, o.diaLimite, o.agora);
  const nomeCliente = (cliente.nomeFantasia || '').trim() || cliente.nome || '';
  const pct = p.total ? Math.round(p.feitos / p.total * 100) : 0;
  const barra = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 6px;border-radius:99px;background:' + COR.faixa + '"><tr>' +
    (pct > 0 ? '<td width="' + pct + '%" style="height:6px;line-height:6px;font-size:0;background:' + COR.ok + ';border-radius:99px">&nbsp;</td>' : '') +
    (pct < 100 ? '<td style="height:6px;line-height:6px;font-size:0">&nbsp;</td>' : '') + '</tr></table>';
  const iconePrazo = prazo ? imagem(imagens, PASTA_ICONES, 'prazo', 16, 'display:inline-block;vertical-align:-3px;margin-right:6px') : '';
  const iconeAnexo = imagem(imagens, PASTA_ICONES, 'anexo', 16, 'display:inline-block;vertical-align:middle;margin-right:8px') || '';
  const passo = (n, texto) => '<tr><td width="30" style="padding:4px 0;vertical-align:top"><div style="width:20px;height:20px;border-radius:99px;border:1px solid ' + COR.borda +
    ';background:' + COR.fundo + ';color:' + COR.tinta + ';font:600 11px/20px ' + FONTE + ';text-align:center">' + n + '</div></td><td style="padding:5px 0 4px;font:14px/1.45 ' + FONTE + ';color:' + COR.suave + '">' + texto + '</td></tr>';

  const cabecalho = barra +
    '<div style="font:12px ' + FONTE + ';color:' + COR.suave + '">' + p.feitos + ' de ' + p.total + ' já chegaram</div>' +
    (prazo ? '<div style="margin-top:12px;font:600 14px ' + FONTE + ';color:' + (prazo.atrasado ? COR.falta : COR.tinta) + '">' + (iconePrazo || '') + esc(prazo.texto) + '</div>' : '');

  const comoMandar = cartao('Como mandar',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      passo(1, 'Responda este e-mail.') +
      passo(2, 'Anexe os PDFs ou as fotos dos documentos.') +
      passo(3, 'Pronto: o recebimento é marcado sozinho, sem precisar avisar.') +
    '</table>' +
    (link ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="background:' + COR.vinho + ';border-radius:6px">' +
      '<a href="' + esc(link) + '" style="display:inline-block;padding:9px 16px;font:500 14px/20px ' + FONTE + ';color:#FFFFFF;text-decoration:none">Enviar ou conferir pela sua página</a></td></tr></table>' +
      '<div style="font:12px/1.5 ' + FONTE + ';color:' + COR.suave + ';margin-top:8px">Na página dá pra mandar a foto do documento direto do celular e ver o que já chegou.</div>' : ''),
    iconeAnexo);

  const html = moldura({
    imagens, assinatura: o.assinatura, caixa: o.caixa, chip,
    previa: (p.faltam === 1 ? 'Falta 1 documento' : 'Faltam ' + p.faltam + ' documentos') + ' de ' + mesNome + (prazo ? '. ' + prazo.texto : ''),
    titulo: (p.faltam === 1 ? 'Falta 1 documento' : 'Faltam ' + p.faltam + ' documentos') + (mesNome ? ' de ' + mesNome : ''),
    sobre: nomeCliente, cabecalho,
    corpo: blocos.join('') + comoMandar,
    rodape: 'Mensagem enviada pelo sistema do escritório. Se já mandou, desconsidere: o registro atualiza em poucas horas.',
  });
  return { html, imagens };
}

// Disparo pra vários clientes (Robô do Gmail › Disparo): o texto que a pessoa
// escreveu e o arquivo anexado, na mesma moldura.
// { assunto, corpo, assinatura, caixa, anexo: { nome, tamanho } } -> { html, imagens }
function htmlDoDisparo(o) {
  const imagens = [];
  const a = o.anexo || null;
  const kb = a && a.tamanho ? (a.tamanho >= 1048576 ? (a.tamanho / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(a.tamanho / 1024)) + ' KB') : '';
  const iconeAnexo = imagem(imagens, PASTA_ICONES, 'anexo', 16, 'display:inline-block;vertical-align:middle;margin-right:8px') || '';
  const arquivo = a ? cartao('Arquivo anexado',
    '<div style="font:500 14px/20px ' + FONTE + ';color:' + COR.tinta + ';overflow-wrap:anywhere">' + esc(a.nome) + '</div>' +
    '<div style="font:12px/16px ' + FONTE + ';color:' + COR.suave + ';margin-top:2px">' + (kb ? kb + ' · ' : '') + 'está no fim deste e-mail, é só abrir ou baixar.</div>', iconeAnexo) : '';
  const html = moldura({
    imagens, assinatura: o.assinatura, caixa: o.caixa,
    previa: String(o.corpo || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    titulo: o.assunto || '', corpo: paragrafos(o.corpo) + arquivo,
    rodape: 'Mensagem enviada pelo sistema do escritório para os clientes.',
  });
  return { html, imagens };
}

module.exports = { htmlDaCobranca, htmlDoDisparo, textoDoPrazo, progresso, PASTA_LOGOS, PASTA_ICONES };
