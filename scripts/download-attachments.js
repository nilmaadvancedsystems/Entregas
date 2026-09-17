// Varre o Gmail atrás de e-mails de clientes cadastrados com anexo de
// Extrato/Comprovante/Aplicação, baixa os anexos de verdade (bytes reais,
// via Gmail API) e marca o(s) tipo(s) correspondente(s) como recebido no
// Firestore (documentosMensal), automaticamente.
//
// Uso: node download-attachments.js [dias_para_tras]
// Padrão: últimos 10 dias.
const fs = require('fs');
const path = require('path');
const { getGmail } = require('./gmail-client');
const { getDb } = require('./firestore-client');

const PASTA_DESTINO = 'G:\\Meu Drive\\Claudio Secretario';
const PROCESSADOS_PATH = __dirname + '/gmail-processados.json';

const PALAVRAS = {
  extrato: ['extrato'],
  comprovante: ['comprovante'],
  aplicacao: ['aplicaç', 'aplicac', 'investiment'],
};

function carregarProcessados() {
  try { return new Set(JSON.parse(fs.readFileSync(PROCESSADOS_PATH, 'utf8'))); }
  catch (e) { return new Set(); }
}
function salvarProcessados(set) {
  fs.writeFileSync(PROCESSADOS_PATH, JSON.stringify(Array.from(set)));
}

function extrairEmail(headerFrom) {
  const m = (headerFrom || '').match(/<([^>]+)>/);
  return (m ? m[1] : headerFrom || '').trim().toLowerCase();
}

function detectarTipos(texto) {
  const baixo = (texto || '').toLowerCase();
  const tipos = [];
  for (const [tipo, palavras] of Object.entries(PALAVRAS)) {
    if (palavras.some(p => baixo.includes(p))) tipos.push(tipo);
  }
  return tipos;
}

// Percorre a árvore de partes da mensagem coletando anexos reais (com filename).
function coletarAnexos(part, acc) {
  if (!part) return acc;
  if (part.filename && part.body && part.body.attachmentId) {
    acc.push({ filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType });
  }
  (part.parts || []).forEach(p => coletarAnexos(p, acc));
  return acc;
}

function sanitizar(nome) {
  return (nome || 'desconhecido').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
}

function competenciaDaData(dataMs) {
  const d = new Date(Number(dataMs));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

async function main() {
  const dias = parseInt(process.argv[2], 10) || 10;
  const gmail = getGmail();
  const db = getDb('entregas-2e5e2');

  const clientesSnap = await db.collection('clientes').where('ativo', '==', true).get();
  const clientesPorEmail = new Map();
  clientesSnap.forEach(d => {
    const data = d.data();
    if (data.email) clientesPorEmail.set(String(data.email).toLowerCase().trim(), Object.assign({ id: d.id }, data));
  });
  console.log('Clientes ativos com e-mail cadastrado:', clientesPorEmail.size);

  const processados = carregarProcessados();

  const query = `has:attachment (extrato OR aplicação OR aplicacao OR comprovante OR investimento) newer_than:${dias}d in:inbox`;
  const lista = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 100 });
  const mensagens = lista.data.messages || [];
  console.log('E-mails encontrados na busca:', mensagens.length);

  let baixados = 0, marcados = 0, ignorados = 0;

  for (const { id } of mensagens) {
    if (processados.has(id)) { ignorados++; continue; }

    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const headers = msg.data.payload.headers || [];
    const fromHeader = (headers.find(h => h.name === 'From') || {}).value || '';
    const subjectHeader = (headers.find(h => h.name === 'Subject') || {}).value || '';
    const remetente = extrairEmail(fromHeader);

    const cliente = clientesPorEmail.get(remetente);
    if (!cliente) { processados.add(id); continue; } // não é cliente cadastrado

    const tipos = detectarTipos(subjectHeader + ' ' + (msg.data.snippet || ''));
    const anexos = coletarAnexos(msg.data.payload, []);
    if (anexos.length === 0) { processados.add(id); continue; }

    const competencia = competenciaDaData(msg.data.internalDate);
    const nomeCliente = sanitizar(cliente.nome);
    const pastaCliente = path.join(PASTA_DESTINO, competencia, nomeCliente);
    fs.mkdirSync(pastaCliente, { recursive: true });

    for (const anexo of anexos) {
      try {
        const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: anexo.attachmentId });
        const buffer = Buffer.from(att.data.data, 'base64');
        let destino = path.join(pastaCliente, sanitizar(anexo.filename));
        let n = 1;
        while (fs.existsSync(destino)) {
          const ext = path.extname(anexo.filename);
          const base = path.basename(anexo.filename, ext);
          destino = path.join(pastaCliente, sanitizar(base) + ' (' + (++n) + ')' + ext);
        }
        fs.writeFileSync(destino, buffer);
        baixados++;
        console.log('Baixado:', cliente.nome, '->', path.basename(destino));
      } catch (err) {
        console.error('Falha ao baixar anexo de', cliente.nome, ':', err.message);
      }
    }

    if (tipos.length > 0) {
      const docId = cliente.id + '_' + competencia;
      const patch = { clienteId: cliente.id, clienteNome: cliente.nome, competencia, atualizadoEm: new Date().toISOString() };
      tipos.forEach(t => { patch[t] = true; });
      await db.collection('documentosMensal').doc(docId).set(patch, { merge: true });
      marcados++;
      console.log('Marcado em', competencia, 'para', cliente.nome, ':', tipos.join(', '));
    }

    processados.add(id);
  }

  salvarProcessados(processados);
  console.log('---');
  console.log('Anexos baixados:', baixados, '| Documentos marcados:', marcados, '| E-mails já vistos antes (ignorados):', ignorados);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
