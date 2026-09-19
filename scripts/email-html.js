// Versão em HTML da cobrança que o robô manda pelo Gmail.
//
// O texto continua sendo o dos modelos (Pendências › Configurações): aqui ele
// só ganha forma. Linhas "- Extrato Bancário" viram cartões; o extrato mostra
// os bancos do cliente com o logo de cada um e o que já chegou no mês; o link
// do cliente vira botão. Vai junto a versão em texto puro, pra programa de
// e-mail que não mostra HTML.
//
// Logos: scripts/logos-bancos/<id>.png, anexados no próprio e-mail (cid:),
// então aparecem mesmo com "imagens externas" bloqueadas. Sem o arquivo, um
// selo com a cor e a sigla do banco. Tudo com estilo inline e tabela: é o que
// o Gmail e o Outlook respeitam.
const fs = require('fs');
const path = require('path');
const { POR_ID } = require('./bancos');

const PASTA_LOGOS = path.join(__dirname, 'logos-bancos');
const COR = { tinta: '#1F1F1F', suave: '#5B5B5B', borda: '#E4E4E4', fundo: '#F4F4F4', acento: '#9A2B24', ok: '#17603A', okFundo: '#E4F3EA' };

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ehExtrato = linha => /extrato banc|extrato do banco/i.test(linha);

function logoDe(id) {
  const arquivo = path.join(PASTA_LOGOS, id + '.png');
  return fs.existsSync(arquivo) ? { cid: 'banco-' + id, arquivo } : null;
}

// Um banco: logo (ou selo), nome e se já chegou.
function htmlDoBanco(b, recebido, imagens) {
  const logo = logoDe(b.id);
  let marca;
  if (logo) {
    if (!imagens.some(i => i.cid === logo.cid)) imagens.push({ cid: logo.cid, arquivo: logo.arquivo, mime: 'image/png' });
    marca = '<img src="cid:' + logo.cid + '" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border-radius:6px">';
  } else {
    marca = '<span style="display:inline-block;min-width:28px;height:28px;line-height:28px;padding:0 4px;border-radius:6px;background:' + b.cor +
      ';color:' + b.tinta + ';font:700 10px/28px Arial,sans-serif;text-align:center">' + esc(b.sigla) + '</span>';
  }
  const estado = recebido
    ? '<span style="font:600 12px Arial,sans-serif;color:' + COR.ok + ';background:' + COR.okFundo + ';padding:2px 8px;border-radius:99px">recebido</span>'
    : '<span style="font:600 12px Arial,sans-serif;color:' + COR.acento + '">falta</span>';
  return '<tr><td width="36" style="padding:6px 8px 6px 0;vertical-align:middle">' + marca + '</td>' +
    '<td style="padding:6px 0;font:15px Arial,sans-serif;color:' + COR.tinta + ';vertical-align:middle">' + esc(b.nome) + '</td>' +
    '<td align="right" style="padding:6px 0;vertical-align:middle">' + estado + '</td></tr>';
}

function htmlDoItem(linha, cliente, recebidos, imagens) {
  const bancos = ehExtrato(linha) ? (cliente.bancos || []).map(id => POR_ID.get(id)).filter(Boolean) : [];
  const tabela = bancos.length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid ' + COR.borda + '">' +
        bancos.map(b => htmlDoBanco(b, recebidos.includes(b.id), imagens)).join('') + '</table>'
    : '';
  return '<tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + COR.borda +
    ';border-radius:10px"><tr><td style="padding:12px 14px;font:600 15px Arial,sans-serif;color:' + COR.tinta + '">' + esc(linha) + tabela + '</td></tr></table></td></tr>';
}

// corpo em texto -> { html, imagens:[{cid, arquivo, mime}] }
function htmlDaCobranca({ corpo, cliente, bancosRecebidos, assinatura }) {
  const imagens = [];
  const recebidos = Array.isArray(bancosRecebidos) ? bancosRecebidos : [];
  const linhas = String(corpo || '').replace(/\r/g, '').split('\n');
  const blocos = [];
  let lista = null, paragrafo = [];
  const fecharParagrafo = () => {
    if (!paragrafo.length) return;
    blocos.push('<p style="margin:0 0 14px;font:15px/1.55 Arial,sans-serif;color:' + COR.tinta + '">' + paragrafo.map(esc).join('<br>') + '</p>');
    paragrafo = [];
  };
  const fecharLista = () => {
    if (!lista) return;
    blocos.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">' + lista.join('') + '</table>');
    lista = null;
  };
  for (const bruta of linhas) {
    const linha = bruta.trim();
    if (/^-\s+/.test(linha)) {
      fecharParagrafo();
      lista = lista || [];
      lista.push(htmlDoItem(linha.replace(/^-\s+/, ''), cliente || {}, recebidos, imagens));
    } else if (/^https?:\/\/\S+$/.test(linha)) {
      fecharParagrafo(); fecharLista();
      blocos.push('<p style="margin:0 0 18px"><a href="' + esc(linha) + '" style="display:inline-block;background:' + COR.acento +
        ';color:#FFFFFF;font:600 15px Arial,sans-serif;text-decoration:none;padding:12px 20px;border-radius:8px">Ver o que já recebemos e o que falta</a></p>');
    } else if (!linha) {
      fecharParagrafo(); fecharLista();
    } else {
      fecharLista();
      paragrafo.push(linha);
    }
  }
  fecharParagrafo(); fecharLista();
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:' + COR.fundo + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + COR.fundo + '"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px">' +
    '<tr><td style="padding:18px 24px;border-bottom:3px solid ' + COR.acento + ';font:700 14px Arial,sans-serif;color:' + COR.acento + '">' + esc(assinatura || 'Nilma Contabilidade') + '</td></tr>' +
    '<tr><td style="padding:22px 24px 8px">' + blocos.join('') + '</td></tr>' +
    '<tr><td style="padding:14px 24px 20px;border-top:1px solid ' + COR.borda + ';font:12px/1.5 Arial,sans-serif;color:' + COR.suave + '">' +
      'Responda este e-mail com os arquivos em anexo. O recebimento é registrado automaticamente.</td></tr>' +
    '</table></td></tr></table></body></html>';
  return { html, imagens };
}

module.exports = { htmlDaCobranca, PASTA_LOGOS };
