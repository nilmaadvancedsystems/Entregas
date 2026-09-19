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
const COR = {
  tinta: '#1C1917', suave: '#57534E', fraca: '#8A8580', borda: '#E7E2DD', fundo: '#EFEBE7',
  vinho: '#8C2620', vinhoClaro: '#F6E9E7', ok: '#17603A', okClaro: '#E6F2EA', falta: '#A4480F', faltaClaro: '#FBEFE4',
};
const FONTE = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TIPOS = {
  extrato: { nome: 'Extrato bancário', icone: 'extrato', rotulos: /extrato banc|extrato do banco/i },
  comprovante: { nome: 'Comprovantes de pagamento', icone: 'comprovante', rotulos: /comprovante/i },
  aplicacao: { nome: 'Extrato de aplicação', icone: 'aplicacao', rotulos: /aplica/i },
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_CURTO = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const tipoDaLinha = linha => Object.keys(TIPOS).find(k => TIPOS[k].rotulos.test(linha)) || '';

// Anexa a imagem uma vez e devolve o <img>; sem o arquivo, null.
function imagem(imagens, pasta, nome, lado, estilo) {
  const arquivo = path.join(pasta, nome + '.png');
  if (!fs.existsSync(arquivo)) return null;
  const cid = (pasta === PASTA_LOGOS ? 'banco-' : 'icone-') + nome;
  if (!imagens.some(i => i.cid === cid)) imagens.push({ cid, arquivo, mime: 'image/png' });
  return '<img src="cid:' + cid + '" width="' + lado + '" height="' + lado + '" alt="" style="display:block;width:' + lado + 'px;height:' + lado + 'px;border:0;' + (estilo || '') + '">';
}

function marcaDoBanco(b, imagens) {
  return imagem(imagens, PASTA_LOGOS, b.id, 36, 'border-radius:9px;border:1px solid ' + COR.borda) ||
    '<div style="width:36px;height:36px;line-height:36px;border-radius:9px;background:' + b.cor + ';color:' + b.tinta +
    ';font:700 9px/36px ' + FONTE + ';text-align:center;white-space:nowrap;overflow:hidden">' + esc(b.sigla) + '</div>';
}

// Um banco na grade: logo, nome, recebido/falta.
function celulaDoBanco(b, recebido, imagens) {
  const icone = imagem(imagens, PASTA_ICONES, recebido ? 'ok' : 'falta', 14, 'display:inline-block;vertical-align:-2px;margin-right:4px');
  return '<td width="50%" style="padding:4px;vertical-align:top">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + (recebido ? COR.okClaro : '#FFFFFF') +
      ';border:1px solid ' + (recebido ? COR.okClaro : COR.borda) + ';border-radius:10px"><tr>' +
      '<td width="44" style="padding:10px 0 10px 10px;vertical-align:middle">' + marcaDoBanco(b, imagens) + '</td>' +
      '<td style="padding:10px 10px 10px 8px;vertical-align:middle">' +
        '<div style="font:600 14px/1.25 ' + FONTE + ';color:' + COR.tinta + '">' + esc(b.nome) + '</div>' +
        '<div style="font:600 12px/1.4 ' + FONTE + ';color:' + (recebido ? COR.ok : COR.falta) + ';margin-top:2px">' + (icone || '') + (recebido ? 'Recebido' : 'Falta') + '</div>' +
      '</td></tr></table></td>';
}

// Cartão de um documento que falta. Extrato com bancos conhecidos vira grade.
function cartaoDoDocumento(tipo, cliente, recebidos, imagens) {
  const t = TIPOS[tipo];
  const bancos = tipo === 'extrato' ? (cliente.bancos || []).map(id => POR_ID.get(id)).filter(Boolean) : [];
  const faltam = bancos.filter(b => !recebidos.includes(b.id)).length;
  const icone = imagem(imagens, PASTA_ICONES, t.icone, 22) || '';
  const resumo = bancos.length
    ? (faltam === 1 ? 'Falta 1 banco' : faltam ? 'Faltam ' + faltam + ' bancos' : 'Todos os bancos chegaram')
    : 'Falta enviar';
  let grade = '';
  if (bancos.length) {
    // bancos que faltam primeiro: é o que o cliente precisa ver
    const ordem = bancos.slice().sort((a, b) => recebidos.includes(a.id) - recebidos.includes(b.id));
    const linhas = [];
    for (let i = 0; i < ordem.length; i += 2) {
      linhas.push('<tr>' + celulaDoBanco(ordem[i], recebidos.includes(ordem[i].id), imagens) +
        (ordem[i + 1] ? celulaDoBanco(ordem[i + 1], recebidos.includes(ordem[i + 1].id), imagens) : '<td width="50%"></td>') + '</tr>');
    }
    grade = '<tr><td colspan="3" style="padding:4px 10px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + linhas.join('') + '</table></td></tr>';
  }
  return '<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid ' + COR.borda + ';border-radius:12px">' +
    '<tr><td width="46" style="padding:14px 0 14px 14px;vertical-align:middle"><div style="width:36px;height:36px;border-radius:10px;background:' + COR.vinhoClaro + '">' +
      (icone ? '<table role="presentation" width="36" height="36" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle">' + icone + '</td></tr></table>' : '') + '</div></td>' +
    '<td style="padding:14px 8px;vertical-align:middle;font:600 16px/1.3 ' + FONTE + ';color:' + COR.tinta + '">' + esc(t.nome) + '</td>' +
    '<td align="right" style="padding:14px 14px 14px 0;vertical-align:middle;white-space:nowrap"><span style="font:600 12px ' + FONTE + ';color:' + COR.falta +
      ';background:' + COR.faltaClaro + ';padding:4px 10px;border-radius:99px">' + resumo + '</span></td></tr>' + grade + '</table></td></tr>';
}

// Quanto já chegou: extrato conta um por banco conhecido.
function progresso(cliente, faltando, recebidos) {
  const naoAplica = Array.isArray(cliente.documentosNaoAplicaveis) ? cliente.documentosNaoAplicaveis : [];
  let total = 0, feitos = 0;
  Object.keys(TIPOS).filter(k => !naoAplica.includes(k)).forEach(k => {
    const bancos = k === 'extrato' ? (cliente.bancos || []).filter(id => POR_ID.has(id)) : [];
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

// { corpo, cliente, competencia, faltando?, bancosRecebidos, diaLimite, assinatura, caixa, agora } -> { html, imagens }
function htmlDaCobranca(o) {
  const imagens = [];
  const cliente = o.cliente || {};
  const recebidos = Array.isArray(o.bancosRecebidos) ? o.bancosRecebidos : [];
  const linhas = String(o.corpo || '').replace(/\r/g, '').split('\n');
  const faltando = Array.isArray(o.faltando) && o.faltando.length ? o.faltando
    : [...new Set(linhas.filter(l => /^\s*-\s+/.test(l)).map(tipoDaLinha).filter(Boolean))];
  const link = (linhas.find(l => /^\s*https?:\/\/\S+\s*$/.test(l)) || '').trim();

  // o texto do modelo, com a lista virando cartões no mesmo lugar
  const blocos = [];
  let paragrafo = [], cartoes = null;
  const fechaP = () => { if (paragrafo.length) blocos.push('<p style="margin:0 0 14px;font:15px/1.6 ' + FONTE + ';color:' + COR.tinta + '">' + paragrafo.map(esc).join('<br>') + '</p>'); paragrafo = []; };
  const fechaC = () => { if (cartoes) blocos.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px">' + cartoes.join('') + '</table>'); cartoes = null; };
  linhas.forEach((bruta, i) => {
    const l = bruta.trim();
    if (/^-\s+/.test(l)) {
      fechaP();
      const tipo = tipoDaLinha(l);
      cartoes = cartoes || [];
      if (tipo && !cartoes.some(c => c.tipo === tipo)) { const c = new String(cartaoDoDocumento(tipo, cliente, recebidos, imagens)); c.tipo = tipo; cartoes.push(c); }
      else if (!tipo) cartoes.push('<tr><td style="padding:0 0 10px;font:600 15px ' + FONTE + ';color:' + COR.tinta + '">' + esc(l.replace(/^-\s+/, '')) + '</td></tr>');
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
  const barra = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 6px;border-radius:99px;background:' + COR.borda + '"><tr>' +
    (pct > 0 ? '<td width="' + pct + '%" style="height:8px;line-height:8px;font-size:0;background:' + COR.ok + ';border-radius:99px">&nbsp;</td>' : '') +
    (pct < 100 ? '<td style="height:8px;line-height:8px;font-size:0">&nbsp;</td>' : '') + '</tr></table>';
  const iconePrazo = prazo ? imagem(imagens, PASTA_ICONES, 'prazo', 16, 'display:inline-block;vertical-align:-3px;margin-right:6px') : '';
  const iconeAnexo = imagem(imagens, PASTA_ICONES, 'anexo', 18, 'display:inline-block;vertical-align:-4px;margin-right:6px') || '';
  const passo = (n, texto) => '<tr><td width="30" style="padding:5px 0;vertical-align:top"><div style="width:22px;height:22px;border-radius:99px;background:' + COR.vinho +
    ';color:#FFFFFF;font:700 12px/22px ' + FONTE + ';text-align:center">' + n + '</div></td><td style="padding:6px 0 5px;font:14px/1.45 ' + FONTE + ';color:' + COR.suave + '">' + texto + '</td></tr>';

  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + esc('Documentos de ' + mesNome) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + COR.fundo + ';-webkit-text-size-adjust:100%">' +
    // pré-cabeçalho: a linha cinza que aparece na lista do Gmail
    '<div style="display:none;max-height:0;overflow:hidden">' + esc((p.faltam === 1 ? 'Falta 1 documento' : 'Faltam ' + p.faltam + ' documentos') + ' de ' + mesNome + (prazo ? '. ' + prazo.texto : '')) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + COR.fundo + '"><tr><td align="center" style="padding:20px 10px 28px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">' +

    // faixa do escritório
    '<tr><td style="background:' + COR.vinho + ';border-radius:14px 14px 0 0;padding:16px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font:700 15px ' + FONTE + ';color:#FFFFFF">' + esc(o.assinatura || 'Nilma Contabilidade') + '</td>' +
      (chip ? '<td align="right"><span style="font:700 12px ' + FONTE + ';color:' + COR.vinho + ';background:#FFFFFF;padding:5px 10px;border-radius:99px;letter-spacing:.04em">' + chip + '</span></td>' : '') +
    '</tr></table></td></tr>' +

    // manchete
    '<tr><td style="background:#FFFFFF;padding:24px 22px 18px;border-bottom:1px solid ' + COR.borda + '">' +
      (nomeCliente ? '<div style="font:600 13px ' + FONTE + ';color:' + COR.fraca + '">' + esc(nomeCliente) + '</div>' : '') +
      '<div style="font:700 24px/1.25 ' + FONTE + ';color:' + COR.tinta + ';margin-top:4px">' +
        (p.faltam === 1 ? 'Falta 1 documento' : 'Faltam ' + p.faltam + ' documentos') + (mesNome ? ' de ' + mesNome : '') + '</div>' +
      barra +
      '<div style="font:13px ' + FONTE + ';color:' + COR.suave + '">' + p.feitos + ' de ' + p.total + ' já chegaram</div>' +
      (prazo ? '<div style="margin-top:12px;font:600 14px ' + FONTE + ';color:' + (prazo.atrasado ? COR.falta : COR.tinta) + '">' + (iconePrazo || '') + esc(prazo.texto) + '</div>' : '') +
    '</td></tr>' +

    // o texto do modelo com os cartões
    '<tr><td style="background:#FFFFFF;padding:22px 22px 8px">' + blocos.join('') + '</td></tr>' +

    // como mandar
    '<tr><td style="background:#FFFFFF;padding:6px 22px 24px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + COR.fundo + ';border-radius:12px"><tr><td style="padding:18px">' +
        '<div style="font:700 15px ' + FONTE + ';color:' + COR.tinta + ';margin-bottom:8px">' + iconeAnexo + 'Como mandar</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
          passo(1, 'Responda este e-mail.') +
          passo(2, 'Anexe os PDFs ou as fotos dos documentos.') +
          passo(3, 'Pronto: o recebimento é marcado sozinho, sem precisar avisar.') +
        '</table>' +
        (link ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="background:' + COR.vinho + ';border-radius:10px">' +
          '<a href="' + esc(link) + '" style="display:inline-block;padding:13px 20px;font:700 15px ' + FONTE + ';color:#FFFFFF;text-decoration:none">Enviar ou conferir pela sua página</a></td></tr></table>' +
          '<div style="font:12px/1.5 ' + FONTE + ';color:' + COR.fraca + ';margin-top:8px">Na página dá pra mandar a foto do documento direto do celular e ver o que já chegou.</div>' : '') +
      '</td></tr></table>' +
    '</td></tr>' +

    // rodapé
    '<tr><td style="background:#FFFFFF;border-radius:0 0 14px 14px;border-top:1px solid ' + COR.borda + ';padding:16px 22px;font:12px/1.55 ' + FONTE + ';color:' + COR.fraca + '">' +
      esc(o.assinatura || 'Nilma Contabilidade') + (o.caixa ? ' · <a href="mailto:' + esc(o.caixa) + '" style="color:' + COR.fraca + '">' + esc(o.caixa) + '</a>' : '') +
      '<br>Mensagem enviada pelo sistema do escritório. Se já mandou, desconsidere: o registro atualiza em poucas horas.' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
  return { html, imagens };
}

module.exports = { htmlDaCobranca, textoDoPrazo, progresso, PASTA_LOGOS, PASTA_ICONES };
