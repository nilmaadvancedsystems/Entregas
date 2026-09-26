// Monta a mensagem crua (RFC 822, base64 de URL) que a API do Gmail envia.
//   texto puro;
//   texto + HTML (multipart/alternative);
//   + imagens embutidas por cid (multipart/related) — os logos dos bancos;
//   + anexos (multipart/mixed) — o arquivo do Disparo.
// Assunto e nomes de arquivo com acento vão codificados (RFC 2047).
const fs = require('fs');

// Assunto e corpo em UTF-8, codificados pro cabeçalho e o corpo aguentarem acento.
function codificarCabecalho(texto) {
  return /^[\x20-\x7e]*$/.test(texto) ? texto : '=?UTF-8?B?' + Buffer.from(texto, 'utf8').toString('base64') + '?=';
}
const em76 = buf => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
// Com html: texto puro + HTML (multipart/alternative) e, se houver, as
// imagens embutidas por cid (multipart/related) — os logos dos bancos.
// Com anexos (Disparo): tudo isso dentro de um multipart/mixed com os arquivos.
function nomeCodificado(nome) {
  const limpo = String(nome || 'arquivo').replace(/["\r\n\\]/g, '');
  return /^[\x20-\x7e]*$/.test(limpo) ? limpo : '=?UTF-8?B?' + Buffer.from(limpo, 'utf8').toString('base64') + '?=';
}
function montarMensagem({ de, para, cco, assunto, corpo, html, imagens, anexos }) {
  const linhas = [
    'From: ' + de,
    'To: ' + (para || de),
  ];
  if (cco && cco.length) linhas.push('Bcc: ' + cco.join(', '));
  linhas.push('Subject: ' + codificarCabecalho(assunto), 'MIME-Version: 1.0');
  const texto = em76(Buffer.from(corpo || '', 'utf8'));
  const marca = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // o corpo (texto, ou texto + HTML + imagens), começando pelo Content-Type
  const conteudo = [];
  if (!html) {
    conteudo.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', texto);
  } else {
    const alt = 'alt-' + marca, rel = 'rel-' + marca;
    const partes = [
      '--' + alt, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', texto,
      '--' + alt, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', em76(Buffer.from(html, 'utf8')),
      '--' + alt + '--',
    ];
    // imagem de arquivo (logos, até 200 KB) ou já em memória (as do HTML pronto do Disparo)
    const figuras = (imagens || []).filter(i => {
      if (i.buffer) return i.buffer.length < 3 * 1024 * 1024;
      try { return fs.statSync(i.arquivo).size < 200 * 1024; } catch (e) { return false; }
    });
    if (!figuras.length) {
      conteudo.push('Content-Type: multipart/alternative; boundary="' + alt + '"', '', ...partes);
    } else {
      conteudo.push('Content-Type: multipart/related; boundary="' + rel + '"', '',
        '--' + rel, 'Content-Type: multipart/alternative; boundary="' + alt + '"', '', ...partes);
      figuras.forEach(i => conteudo.push('--' + rel, 'Content-Type: ' + (i.mime || 'image/png'), 'Content-Transfer-Encoding: base64',
        'Content-ID: <' + i.cid + '>', 'Content-Disposition: inline; filename="' + i.cid + '.' + String(i.mime || 'image/png').split('/')[1].replace('jpeg', 'jpg') + '"', '', em76(i.buffer || fs.readFileSync(i.arquivo))));
      conteudo.push('--' + rel + '--');
    }
  }
  if (anexos && anexos.length) {
    const mix = 'mix-' + marca;
    linhas.push('Content-Type: multipart/mixed; boundary="' + mix + '"', '', '--' + mix, ...conteudo);
    anexos.forEach(a => linhas.push('--' + mix,
      'Content-Type: ' + (a.mime || 'application/octet-stream') + '; name="' + nomeCodificado(a.nome) + '"',
      'Content-Disposition: attachment; filename="' + nomeCodificado(a.nome) + '"',
      'Content-Transfer-Encoding: base64', '', em76(a.buffer)));
    linhas.push('--' + mix + '--');
  } else {
    linhas.push(...conteudo);
  }
  return Buffer.from(linhas.join('\r\n'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HTML pronto (Disparo): tira <script> e troca as imagens embutidas em
// data: (que o Gmail não mostra) por imagens anexadas por cid.
// -> { html, imagens: [{ cid, mime, buffer }] }
function prepararHtmlPronto(html) {
  const imagens = [];
  let limpo = String(html || '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  limpo = limpo.replace(/(src\s*=\s*)(["'])data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=\s]+)\2/gi, (tudo, attr, aspas, mime, dados) => {
    const buffer = Buffer.from(dados.replace(/\s+/g, ''), 'base64');
    if (!buffer.length) return tudo;
    const cid = 'img-' + (imagens.length + 1);
    imagens.push({ cid, mime: mime.toLowerCase().replace('jpg', 'jpeg'), buffer });
    return attr + aspas + 'cid:' + cid + aspas;
  });
  return { html: limpo, imagens };
}

module.exports = { montarMensagem, codificarCabecalho, nomeCodificado, prepararHtmlPronto };
