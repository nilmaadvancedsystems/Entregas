// Gravar anexo na pasta "Claudio Secretario", quando não existe um G:\.
//
// No PC do escritório o Drive é uma letra de unidade: o robô faz mkdir e
// writeFile como em qualquer pasta, e o aplicativo do Google sincroniza. Na
// nuvem não há unidade montada, então o mesmo destino é alcançado pela API.
//
// As funções daqui têm de propósito a MESMA forma das de disco em
// download-attachments.js (sanitizar / copiaJaNaOrigem / salvarArquivo), pra
// quem for ler os dois não precisar aprender dois vocabulários.
//
// O que este arquivo NÃO faz, e é de propósito: apagar, mover pra lixeira,
// renomear ou sobrescrever arquivo que já existe. Um anexo repetido é
// reconhecido e ignorado; um nome repetido com conteúdo diferente vira
// "nome (2).pdf", como no disco. Nenhum caminho deste módulo remove nada.
const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { getAuth } = require('./gmail-client');

const PASTA_RAIZ = 'Claudio Secretario';
const MIME_PASTA = 'application/vnd.google-apps.folder';

// Nome de arquivo no Drive aceita quase tudo (não existe a restrição de
// caracteres do Windows), mas os dois lados precisam gerar o MESMO nome: é
// assim que o robô reconhece "já baixei isso" indo de um pro outro.
function sanitizar(nome) {
  return (nome || 'desconhecido').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
}

// Nome com aspas simples quebra a sintaxe de busca do Drive.
function paraConsulta(texto) {
  return String(texto).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// Ids de pasta não mudam; guardar poupa duas chamadas por anexo.
const cacheDePastas = new Map();

async function filhoChamado(drive, paiId, nome, apenasPasta) {
  const q = [
    `'${paraConsulta(paiId)}' in parents`,
    `name = '${paraConsulta(nome)}'`,
    'trashed = false',
  ];
  if (apenasPasta) q.push(`mimeType = '${MIME_PASTA}'`);
  const r = await drive.files.list({
    q: q.join(' and '),
    fields: 'files(id, name, size, md5Checksum)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (r.data.files || [])[0] || null;
}

async function garantirPasta(drive, paiId, nome) {
  const chave = paiId + '/' + nome;
  if (cacheDePastas.has(chave)) return cacheDePastas.get(chave);
  let pasta = await filhoChamado(drive, paiId, nome, true);
  if (!pasta) {
    const r = await drive.files.create({
      requestBody: { name: nome, mimeType: MIME_PASTA, parents: [paiId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    pasta = { id: r.data.id };
  }
  cacheDePastas.set(chave, pasta.id);
  return pasta.id;
}

// A raiz pode vir pronta por variável de ambiente (DRIVE_PASTA_ID). Vale a
// pena: além de poupar a busca, é o que permite trabalhar com permissão
// restrita, onde o robô conhece a pasta pelo id sem poder vasculhar o Drive.
let raizId = null;
async function pastaRaiz(drive) {
  if (raizId) return raizId;
  if (process.env.DRIVE_PASTA_ID) return (raizId = process.env.DRIVE_PASTA_ID);
  const achada = await filhoChamado(drive, 'root', PASTA_RAIZ, true);
  if (!achada) {
    throw new Error(
      `Não achei a pasta "${PASTA_RAIZ}" no Drive desta conta. ` +
      'Se ela estiver em outro lugar, informe o id dela em DRIVE_PASTA_ID.'
    );
  }
  return (raizId = achada.id);
}

async function pastaDoCliente(drive, mes, nomeCliente) {
  const raiz = await pastaRaiz(drive);
  const doMes = await garantirPasta(drive, raiz, mes);
  return garantirPasta(drive, doMes, sanitizar(nomeCliente));
}

// Mesmo conteúdo = mesmo md5. O Drive já calcula e devolve na listagem, então
// dá pra comparar sem baixar o arquivo de volta.
function mesmoConteudo(arquivo, buffer) {
  if (!arquivo) return false;
  if (arquivo.md5Checksum) return arquivo.md5Checksum === md5(buffer);
  return Number(arquivo.size) === buffer.length;   // Documento Google não tem md5
}

// Espelha salvarArquivo do disco: devolve null quando o anexo já está lá
// (releitura do mesmo e-mail), e nunca sobrescreve.
async function salvarArquivo(drive, pastaId, nome, buffer) {
  const limpo = sanitizar(nome);
  const ponto = limpo.lastIndexOf('.');
  const base = ponto > 0 ? limpo.slice(0, ponto) : limpo;
  const ext = ponto > 0 ? limpo.slice(ponto) : '';

  let candidato = limpo;
  let n = 1;
  for (;;) {
    const existente = await filhoChamado(drive, pastaId, candidato, false);
    if (!existente) break;
    if (mesmoConteudo(existente, buffer)) return null;
    candidato = base + ' (' + (++n) + ')' + ext;
  }

  const r = await drive.files.create({
    requestBody: { name: candidato, parents: [pastaId] },
    media: { body: Readable.from(buffer) },
    fields: 'id, name',
    supportsAllDrives: true,
  });
  return r.data.name;
}

// A rotina de arquivamento lê a pasta inteira, em qualquer mês: o mesmo anexo
// gravado em dois meses vira documento em dobro no layout. Antes de gravar,
// procura o arquivo nas outras pastas de mês deste cliente. Devolve onde achou
// (ex.: "2026-08/FULANO LTDA") ou null.
async function copiaJaNaOrigem(drive, nomeCliente, nome, buffer) {
  const raiz = await pastaRaiz(drive);
  const meses = await drive.files.list({
    q: `'${paraConsulta(raiz)}' in parents and mimeType = '${MIME_PASTA}' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const limpo = sanitizar(nome);
  const ponto = limpo.lastIndexOf('.');
  const base = ponto > 0 ? limpo.slice(0, ponto) : limpo;
  const ext = ponto > 0 ? limpo.slice(ponto) : '';
  const daConta = md5(buffer);

  for (const mes of meses.data.files || []) {
    if (!/^\d{4}-\d{2}$/.test(mes.name)) continue;
    const doCliente = await filhoChamado(drive, mes.id, sanitizar(nomeCliente), true);
    if (!doCliente) continue;
    const arquivos = await drive.files.list({
      q: `'${paraConsulta(doCliente.id)}' in parents and trashed = false`,
      fields: 'files(id, name, size, md5Checksum)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const a of arquivos.data.files || []) {
      const mesmoNome = a.name === limpo || (a.name.startsWith(base + ' (') && a.name.endsWith(ext));
      if (!mesmoNome) continue;
      if (a.md5Checksum ? a.md5Checksum === daConta : Number(a.size) === buffer.length) {
        return mes.name + '/' + sanitizar(nomeCliente);
      }
    }
  }
  return null;
}

// Mesma conta, mesmo token do Gmail — ver gmail-client.js.
let drive = null;
function getDrive() {
  if (!drive) drive = google.drive({ version: 'v3', auth: getAuth() });
  return drive;
}

module.exports = {
  PASTA_RAIZ, sanitizar, getDrive, pastaDoCliente, salvarArquivo, copiaJaNaOrigem, pastaRaiz,
};
