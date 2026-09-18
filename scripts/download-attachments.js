// Robô do Gmail da tela de Cobrança de Documentos.
//
// Lê a caixa de entrada, reconhece e-mails de clientes cadastrados e:
//   1. baixa os anexos de verdade pra pasta do cliente no Drive;
//   2. marca Extrato/Comprovante/Aplicação em documentosMensal, com procedência;
//   3. registra a conversa (assunto, trecho, anexos) em documentosMensal.mensagens,
//      que aparece no Histórico e na aba Comunicação do cliente;
//   4. guarda em config/robo os remetentes com anexo que não são de nenhum
//      cliente (a tela sugere a quem vincular) e o histórico das execuções.
//
// Uso:
//   node download-attachments.js [dias]            lê os últimos N dias (padrão 10)
//   node download-attachments.js 30 --simular      mostra o que faria, não grava nada
//   node download-attachments.js 60 --reler        reprocessa e-mails já lidos antes
//                                                  (não baixa de novo arquivo que já está na pasta)
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { FieldValue } = require('firebase-admin/firestore');
const { getGmail } = require('./gmail-client');
const { getDb } = require('./firestore-client');

const PASTA_DESTINO = 'G:\\Meu Drive\\Claudio Secretario';
const PROCESSADOS_PATH = path.join(__dirname, 'gmail-processados.json');
// E-mail com anexo de remetente sem cliente: guarda id -> remetente pra não abrir
// de novo a cada execução. Só volta a ser lido quando o remetente for vinculado.
const SEM_CLIENTE_PATH = path.join(__dirname, 'gmail-sem-cliente.json');
const MAX_MENSAGENS = 500;          // teto por execução, pra uma janela grande não travar
const MAX_NAO_RECONHECIDOS = 100;
const MAX_EXECUCOES = 30;

const ARGS = process.argv.slice(2);
const SIMULAR = ARGS.includes('--simular');
const RELER = ARGS.includes('--reler');
const DIAS = parseInt(ARGS.find(a => /^\d+$/.test(a)), 10) || 10;

// Cada escritório chama o mesmo documento de um jeito — "comprovante" quase nunca
// vem escrito assim; na prática é "títulos pagos", "boletos liquidados" etc.
const PALAVRAS = {
  extrato: ['extrato'],
  comprovante: [
    'comprovante', 'titulo pago', 'título pago', 'titulos pagos', 'títulos pagos',
    'titulo liquidado', 'título liquidado', 'titulos liquidados', 'títulos liquidados',
    'tit liquidado', 'tit liquidados', 'boleto pago', 'boletos pagos', 'boleto liquidado', 'boletos liquidados',
  ],
  aplicacao: ['aplicaç', 'aplicac', 'investiment'],
};

// Provedor público: o domínio não diz de quem é o e-mail. Só domínio próprio
// (@volponi.com.br) serve pra reconhecer um endereço que ainda não foi cadastrado.
const DOMINIOS_PUBLICOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
  'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'bol.com.br',
  'uol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'zipmail.com.br',
]);

const MESES_ABREV = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

// "AGO2026", "AGO/2026", "AGOSTO 2026": o mês A QUE O DOCUMENTO SE REFERE, que
// quase sempre é anterior ao mês em que o e-mail chegou.
function competenciaDoTexto(texto) {
  const m = (texto || '').toLowerCase().match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*[\/\-. ]?(\d{4})\b/);
  if (!m || !MESES_ABREV[m[1]]) return null;
  return m[2] + '-' + String(MESES_ABREV[m[1]]).padStart(2, '0');
}
function competenciaDaData(dataMs) {
  const d = new Date(Number(dataMs));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function carregarProcessados() {
  try { return new Set(JSON.parse(fs.readFileSync(PROCESSADOS_PATH, 'utf8'))); }
  catch (e) { return new Set(); }
}
function salvarProcessados(set) {
  fs.writeFileSync(PROCESSADOS_PATH, JSON.stringify(Array.from(set)));
}
function carregarSemCliente() {
  try { return JSON.parse(fs.readFileSync(SEM_CLIENTE_PATH, 'utf8')); }
  catch (e) { return {}; }
}

function cabecalho(headers, nome) {
  return ((headers || []).find(h => h.name.toLowerCase() === nome.toLowerCase()) || {}).value || '';
}
function extrairEmail(from) {
  const m = (from || '').match(/<([^>]+)>/);
  return (m ? m[1] : from || '').trim().toLowerCase();
}
function extrairNome(from) {
  const m = (from || '').match(/^\s*"?([^"<]*?)"?\s*</);
  return m ? m[1].trim() : '';
}
function dominioDe(email) {
  const i = email.lastIndexOf('@');
  return i === -1 ? '' : email.slice(i + 1);
}

// O snippet do Gmail vem com entidades HTML (&#39;, &quot;...).
function decodificarEntidades(t) {
  return String(t || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function detectarTipos(texto) {
  const baixo = (texto || '').toLowerCase();
  return Object.keys(PALAVRAS).filter(tipo => PALAVRAS[tipo].some(p => baixo.includes(p)));
}

// Anexo de verdade tem filename e não é "inline" — inline é logo de assinatura.
function ehInline(part) {
  return cabecalho(part.headers, 'content-disposition').toLowerCase().startsWith('inline');
}
// O Outlook manda a assinatura como anexo comum (image001.png, Outlook-abc.png),
// sem marcar "inline"; é logo, não documento.
const IMAGEM_DE_ASSINATURA = /^(image\d*|outlook-[\w-]+|~wrd\d+)\.(png|jpe?g|gif|bmp)$/i;
function coletarAnexos(part, acc) {
  if (!part) return acc;
  if (part.filename && part.body && part.body.attachmentId && !ehInline(part) && !IMAGEM_DE_ASSINATURA.test(part.filename)) {
    acc.push({ filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType, tamanho: part.body.size });
  }
  (part.parts || []).forEach(p => coletarAnexos(p, acc));
  return acc;
}

function sanitizar(nome) {
  return (nome || 'desconhecido').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
}

// Salva sem duplicar: se já existe arquivo com o mesmo nome e o mesmo tamanho, é
// o mesmo anexo lido de novo (--reler) e não vira "arquivo (2).pdf".
function salvarArquivo(pasta, nome, buffer) {
  const ext = path.extname(nome);
  const base = path.basename(nome, ext);
  let destino = path.join(pasta, sanitizar(nome));
  let n = 1;
  while (fs.existsSync(destino)) {
    if (fs.statSync(destino).size === buffer.length) return null;
    destino = path.join(pasta, sanitizar(base) + ' (' + (++n) + ')' + ext);
  }
  fs.writeFileSync(destino, buffer);
  return destino;
}

async function textoDosPdfs(anexos) {
  let texto = '';
  for (const a of anexos) {
    if (a.mimeType !== 'application/pdf' || !a.buffer) continue;
    try { texto += ' ' + (await pdfParse(a.buffer)).text; }
    catch (err) { console.error('  não consegui ler o PDF', a.filename, '-', err.message); }
  }
  return texto;
}

// Filiais costumam mandar do mesmo e-mail. Só decide quando o CNPJ/CPF completo
// de exatamente um candidato aparece no texto; senão devolve null e ninguém é
// marcado — marcar a filial errada é pior que não marcar.
function desempatarPorDocumento(candidatos, texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  const achados = candidatos.filter(c => {
    const doc = String(c.documento || '').replace(/\D/g, '');
    return doc.length >= 11 && digitos.includes(doc);
  });
  return achados.length === 1 ? achados[0] : null;
}

function montarIndices(clientesSnap) {
  const porEmail = new Map();
  const porDominio = new Map();
  const adicionar = (mapa, chave, cliente) => {
    if (!mapa.has(chave)) mapa.set(chave, []);
    if (!mapa.get(chave).some(c => c.id === cliente.id)) mapa.get(chave).push(cliente);
  };
  clientesSnap.forEach(d => {
    const c = Object.assign({ id: d.id }, d.data());
    const enderecos = [c.email].concat(Array.isArray(c.emails) ? c.emails : [])
      .filter(Boolean).map(e => String(e).trim().toLowerCase());
    enderecos.forEach(e => {
      adicionar(porEmail, e, c);
      const dom = dominioDe(e);
      if (dom && !DOMINIOS_PUBLICOS.has(dom)) adicionar(porDominio, dom, c);
    });
  });
  return { porEmail, porDominio };
}

// Duas buscas, não a caixa inteira: abrir todo e-mail estourava a cota do Gmail
// lendo newsletter. Interessa (a) o que tem anexo — documento de cliente ou
// remetente novo a vincular — e (b) qualquer conversa de remetente conhecido.
async function listarMensagens(gmail, porEmail, porDominio) {
  const base = `in:inbox newer_than:${DIAS}d -from:me`;
  const consultas = [base + ' has:attachment'];
  const conhecidos = Array.from(porEmail.keys()).concat(Array.from(porDominio.keys()));
  for (let i = 0; i < conhecidos.length; i += 20) {
    consultas.push(base + ' from:(' + conhecidos.slice(i, i + 20).join(' OR ') + ')');
  }
  const ids = new Set();
  for (const q of consultas) {
    let pageToken;
    do {
      const r = await comRetentativa(() => gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken }));
      (r.data.messages || []).forEach(m => ids.add(m.id));
      pageToken = r.data.nextPageToken;
    } while (pageToken && ids.size < MAX_MENSAGENS);
    if (ids.size >= MAX_MENSAGENS) break;
  }
  if (ids.size >= MAX_MENSAGENS) console.log('Atenção: parou em', MAX_MENSAGENS, 'e-mails; os mais antigos da janela ficaram de fora.');
  return Array.from(ids).slice(0, MAX_MENSAGENS);
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

// O Gmail limita leituras por minuto. Em vez de perder o e-mail, espera e tenta
// de novo (2s, 4s, 8s... até 1 min).
async function comRetentativa(fn) {
  for (let tentativa = 0; ; tentativa++) {
    try { return await fn(); }
    catch (err) {
      const limite = err.code === 429 || /quota|rate limit|ratelimit/i.test(err.message || '');
      if (!limite || tentativa >= 6) throw err;
      const espera = Math.min(60000, 2000 * Math.pow(2, tentativa));
      console.log(`  limite de uso do Gmail; esperando ${espera / 1000}s`);
      await dormir(espera);
    }
  }
}

// Remetente automático (banco, nota fiscal, sistema) nunca é cliente mandando
// documento; deixá-lo em "não reconhecidos" só enche a tabela.
const AUTOMATICO = /no-?reply|nao-?respond|naorespond|donotreply|mailer-daemon|postmaster|notifica|newsletter|informativo|marketing/i;

async function gravar(db, docId, patch) {
  if (SIMULAR) return;
  await db.collection('documentosMensal').doc(docId).set(patch, { merge: true });
}

async function main() {
  const inicio = Date.now();
  const gmail = getGmail();
  const db = getDb('entregas-2e5e2');
  const FV = FieldValue;

  const clientesSnap = await db.collection('clientes').where('ativo', '==', true).get();
  const { porEmail, porDominio } = montarIndices(clientesSnap);
  console.log(`Clientes com e-mail: ${porEmail.size} endereços, ${porDominio.size} domínios próprios.`);
  if (SIMULAR) console.log('MODO SIMULAÇÃO: nada será gravado nem baixado.');

  const processados = RELER ? new Set() : carregarProcessados();
  const jaProcessados = carregarProcessados();
  const semCliente = RELER ? {} : carregarSemCliente();
  const ehConhecido = email => porEmail.has(email) || porDominio.has(dominioDe(email));
  const ids = await listarMensagens(gmail, porEmail, porDominio);
  console.log(`E-mails na janela de ${DIAS} dias: ${ids.length}`);

  const cont = { emails: 0, marcados: 0, baixados: 0, conversas: 0, erros: 0, ambiguos: 0 };
  const naoReconhecidosNovos = [];

  for (const id of ids) {
    if (processados.has(id)) continue;
    if (semCliente[id] && !ehConhecido(semCliente[id])) continue;   // ainda sem cliente: nada mudou
    cont.emails++;
    try {
      await dormir(120);
      const msg = await comRetentativa(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
      const headers = msg.data.payload.headers || [];
      const from = cabecalho(headers, 'From');
      const remetente = extrairEmail(from);
      const assunto = cabecalho(headers, 'Subject');
      const em = new Date(Number(msg.data.internalDate)).toISOString();
      const trecho = decodificarEntidades(msg.data.snippet).slice(0, 240);
      const anexos = coletarAnexos(msg.data.payload, []);

      const candidatos = porEmail.get(remetente) || porDominio.get(dominioDe(remetente)) || [];

      if (!candidatos.length) {
        if (anexos.length && !AUTOMATICO.test(from)) {
          // Fica de fora de "processados": depois que alguém vincular o
          // remetente a um cliente na tela, a próxima leitura reconhece.
          semCliente[id] = remetente;
          naoReconhecidosNovos.push({
            remetente, nome: extrairNome(from), assunto, data: em,
            arquivos: anexos.map(a => a.filename), mensagemId: id,
          });
        } else {
          processados.add(id);
        }
        continue;
      }

      // Baixa os bytes antes de decidir: o desempate de filiais e a detecção
      // do tipo podem precisar ler o PDF.
      for (const a of anexos) {
        try {
          const att = await comRetentativa(() => gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: a.attachmentId }));
          a.buffer = Buffer.from(att.data.data, 'base64');
        } catch (err) {
          cont.erros++;
          console.error('  falha ao baixar', a.filename, '-', err.message);
        }
      }

      const textoNomes = assunto + ' ' + trecho + ' ' + anexos.map(a => a.filename).join(' ');
      let textoPdf = null;
      const lerPdf = async () => (textoPdf !== null ? textoPdf : (textoPdf = await textoDosPdfs(anexos)));

      let cliente = candidatos.length === 1 ? candidatos[0] : desempatarPorDocumento(candidatos, textoNomes);
      if (!cliente && candidatos.length > 1 && anexos.length) cliente = desempatarPorDocumento(candidatos, await lerPdf());

      let tipos = anexos.length ? detectarTipos(textoNomes) : [];
      let competencia = competenciaDoTexto(textoNomes);
      if (anexos.length && (!tipos.length || !competencia)) {
        const t = await lerPdf();
        if (!tipos.length) tipos = detectarTipos(t);
        if (!competencia) competencia = competenciaDoTexto(t);
      }
      competencia = competencia || competenciaDaData(msg.data.internalDate);

      const mensagem = { mensagemId: id, em, remetente, assunto, trecho, anexos: anexos.map(a => a.filename) };

      if (!cliente) {
        // Mesmo e-mail pra várias filiais e nada no texto diz qual: a conversa
        // vai pra todas, mas nenhuma é marcada.
        cont.ambiguos++;
        console.log(`  ambíguo: ${remetente} serve ${candidatos.map(c => c.codigoOrigem || c.id).join(', ')} — conversa registrada, nada marcado`);
        for (const c of candidatos) {
          await gravar(db, c.id + '_' + competencia, {
            clienteId: c.id, clienteNome: c.nome, competencia, mensagens: FV.arrayUnion(mensagem),
          });
        }
        cont.conversas++;
        processados.add(id);
        continue;
      }

      delete semCliente[id];
      const patch = { clienteId: cliente.id, clienteNome: cliente.nome, competencia, mensagens: FV.arrayUnion(mensagem) };
      cont.conversas++;

      const comBytes = anexos.filter(a => a.buffer);
      if (comBytes.length) {
        const pasta = path.join(PASTA_DESTINO, competencia, sanitizar(cliente.nome));
        if (!SIMULAR) fs.mkdirSync(pasta, { recursive: true });
        for (const a of comBytes) {
          if (SIMULAR) { cont.baixados++; continue; }
          try {
            if (salvarArquivo(pasta, a.filename, a.buffer)) cont.baixados++;
          } catch (err) {
            cont.erros++;
            console.error('  falha ao salvar', a.filename, '-', err.message);
          }
        }
      }

      if (tipos.length && comBytes.length) {
        const agora = new Date().toISOString();
        patch.atualizadoEm = agora;
        patch.detalhes = {};
        tipos.forEach(t => {
          patch[t] = true;
          patch.detalhes[t] = { origem: 'gmail', em: agora, mensagemId: id, arquivos: comBytes.map(a => a.filename) };
        });
        cont.marcados++;
        console.log(`  ${cliente.nome} (${competencia}): ${tipos.join(', ')} — ${comBytes.length} anexo(s)`);
      } else {
        console.log(`  ${cliente.nome} (${competencia}): conversa registrada${anexos.length ? ', anexo sem tipo reconhecido' : ''}`);
      }

      await gravar(db, cliente.id + '_' + competencia, patch);
      processados.add(id);
    } catch (err) {
      cont.erros++;
      console.error('Erro no e-mail', id, '-', err.message);
    }
  }

  // config/robo: o que a página "Robô do Gmail" mostra.
  const roboRef = db.collection('config').doc('robo');
  const roboAtual = (await roboRef.get()).data() || {};
  const reconhecido = r => porEmail.has(String(r.remetente).toLowerCase()) || porDominio.has(dominioDe(String(r.remetente).toLowerCase()));
  const porMensagem = new Map();
  // --reler refaz a lista do zero; sem ele, soma ao que já estava.
  (!RELER && Array.isArray(roboAtual.naoReconhecidos) ? roboAtual.naoReconhecidos : [])
    .concat(naoReconhecidosNovos)
    .filter(r => r && r.remetente && !reconhecido(r))
    .forEach(r => {
      // Um por remetente, o mais recente: o mesmo fornecedor repetido 14 vezes
      // escondia os outros na tabela da tela.
      const chave = String(r.remetente).toLowerCase();
      const atual = porMensagem.get(chave);
      if (!atual || String(r.data) > String(atual.data)) porMensagem.set(chave, r);
    });
  const naoReconhecidos = Array.from(porMensagem.values())
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))
    .slice(0, MAX_NAO_RECONHECIDOS);

  const novosNaoRec = new Set(naoReconhecidosNovos.filter(r => !jaProcessados.has(r.mensagemId)).map(r => r.remetente)).size;
  const execucao = {
    em: new Date().toISOString(), dias: DIAS,
    emails: cont.emails, marcados: cont.marcados, baixados: cont.baixados,
    naoReconhecidos: novosNaoRec, conversas: cont.conversas, erros: cont.erros, ambiguos: cont.ambiguos,
    duracaoMs: Date.now() - inicio,
  };
  const execucoes = (Array.isArray(roboAtual.execucoes) ? roboAtual.execucoes : []).concat([execucao]).slice(-MAX_EXECUCOES);
  const resumo = [
    cont.marcados + (cont.marcados === 1 ? ' marcado' : ' marcados'),
    cont.baixados + (cont.baixados === 1 ? ' anexo' : ' anexos'),
    cont.erros ? cont.erros + (cont.erros === 1 ? ' erro' : ' erros') : null,
  ].filter(Boolean).join(', ');

  if (!SIMULAR) {
    await roboRef.set({ ultimaExecucao: execucao.em, ultimaExecucaoResumo: resumo, naoReconhecidos, execucoes }, { merge: true });
    salvarProcessados(processados);
    fs.writeFileSync(SEM_CLIENTE_PATH, JSON.stringify(semCliente));
  }

  console.log('---');
  console.log(`E-mails lidos: ${cont.emails} | conversas de clientes: ${cont.conversas} | marcados: ${cont.marcados} | anexos: ${cont.baixados}`);
  console.log(`Remetentes com anexo não reconhecidos: ${naoReconhecidos.length} | ambíguos entre filiais: ${cont.ambiguos} | erros: ${cont.erros}`);
  console.log(`Duração: ${Math.round(execucao.duracaoMs / 1000)}s${SIMULAR ? ' (simulação, nada gravado)' : ''}`);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
