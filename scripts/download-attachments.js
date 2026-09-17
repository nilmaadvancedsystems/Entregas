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

// Cada cliente/escritório chama o mesmo documento de um jeito diferente —
// "comprovante" quase nunca aparece escrito assim; na prática vem como
// "título(s) pago(s)", "título(s) liquidado(s)", "boleto(s) pago(s)" etc.
const PALAVRAS = {
  extrato: ['extrato'],
  comprovante: [
    'comprovante', 'titulo pago', 'título pago', 'titulos pagos', 'títulos pagos',
    'titulo liquidado', 'título liquidado', 'titulos liquidados', 'títulos liquidados',
    'boleto pago', 'boletos pagos', 'boleto liquidado', 'boletos liquidados',
  ],
  aplicacao: ['aplicaç', 'aplicac', 'investiment'],
};

const MESES_ABREV = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

// Tenta achar "AGO2026", "AGO/2026", "AGOSTO 2026" etc. no texto (assunto +
// nomes dos anexos) — é a competência A QUE O DOCUMENTO SE REFERE, que quase
// sempre é diferente do mês em que o e-mail chegou (o escritório manda em
// setembro os documentos fechados de agosto).
function competenciaDoTexto(texto) {
  const baixo = (texto || '').toLowerCase();
  const m = baixo.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*[\/\-. ]?(\d{4})\b/);
  if (!m) return null;
  const mes = MESES_ABREV[m[1]];
  if (!mes) return null;
  return m[2] + '-' + String(mes).padStart(2, '0');
}

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

// Percorre a árvore de partes da mensagem coletando anexos reais (com
// filename). Ignora partes "inline" (Content-Disposition: inline) — é
// assim que logo/imagem de assinatura de e-mail chega, não é documento.
function ehInline(part) {
  const disp = (part.headers || []).find(h => h.name.toLowerCase() === 'content-disposition');
  return !!(disp && disp.value.toLowerCase().startsWith('inline'));
}
function coletarAnexos(part, acc) {
  if (!part) return acc;
  if (part.filename && part.body && part.body.attachmentId && !ehInline(part)) {
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

    const anexos = coletarAnexos(msg.data.payload, []);
    if (anexos.length === 0) { processados.add(id); continue; }

    const textoCompleto = subjectHeader + ' ' + (msg.data.snippet || '') + ' ' + anexos.map(a => a.filename).join(' ');
    const tipos = detectarTipos(textoCompleto);
    // Prioridade: mês citado no assunto/nome do arquivo (ex: "AGO2026") —
    // é o mês a que o documento se refere. Sem isso, cai no mês do e-mail.
    const competencia = competenciaDoTexto(textoCompleto) || competenciaDaData(msg.data.internalDate);
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
