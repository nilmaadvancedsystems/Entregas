// Robô do Gmail da tela de Cobrança de Documentos.
//
// Lê a caixa de entrada, reconhece e-mails de clientes cadastrados e:
//   1. lê os anexos (grava no Drive só quando alguém clica "Salvar no Drive" na tela);
//   2. marca Extrato/Comprovante/Aplicação em documentosMensal, com procedência;
//   3. registra a conversa (assunto, trecho, anexos) em documentosMensal.mensagens,
//      que aparece no Histórico e na aba Comunicação do cliente;
//   4. guarda em robo/estado os remetentes com anexo que não são de nenhum
//      cliente (a tela sugere a quem vincular) e o histórico das execuções;
//   5. lista em robo/estado.spam o que o Gmail jogou no spam na mesma janela de
//      dias (não lê documento de lá sozinho: a tela decide "Salvar" ou "É spam").
//
// Uso:
//   node download-attachments.js [dias]            lê os últimos N dias (padrão 10)
//   node download-attachments.js 30 --simular      mostra o que faria, não grava nada
//   node download-attachments.js 60 --reler        reprocessa e-mails já lidos antes
//                                                  (não baixa de novo arquivo que já está na pasta)
//   node download-attachments.js --mensagem ID [--cliente CLIENTE_ID]
//                                                  salva os anexos de UM e-mail no Drive agora
//                                                  (é o que o botão "Salvar no Drive" da tela usa)
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
const valorDe = flag => { const i = ARGS.indexOf(flag); return i !== -1 ? ARGS[i + 1] : null; };
const UMA_MENSAGEM = valorDe('--mensagem');
const CLIENTE_FORCADO = valorDe('--cliente');
const DIAS = parseInt(ARGS.find((a, i) => /^\d+$/.test(a) && !['--mensagem', '--cliente'].includes(ARGS[i - 1])), 10) || 10;
const MAX_CAIXA = 150;                       // e-mails com anexo que a tela lista
const MAX_SPAM = 100;                        // e-mails do spam que a tela lista

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

const MESES_EXTENSO = { janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

// O mês A QUE O DOCUMENTO SE REFERE, que quase sempre é anterior ao mês em que
// o e-mail chegou. Aceita, nesta ordem:
//   "AGO2026", "AGO/2026", "AGOSTO 2026"
//   "08/2026", "08.2026", "08-2026"
//   "Extrato agosto" (só o nome inteiro do mês, sem ano): vale o agosto mais
//   recente até a data do e-mail — em setembro, "agosto" é o agosto passado.
// Sem ano, a abreviação não serve ("set", "mar" e "out" são palavras comuns).
function competenciaDoTexto(texto, dataMs, semNumerico) {
  const baixo = (texto || '').toLowerCase();
  const m = baixo.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*[\/\-. ]?(\d{4})\b/);
  if (m && MESES_ABREV[m[1]]) return m[2] + '-' + String(MESES_ABREV[m[1]]).padStart(2, '0');
  const n = semNumerico ? null : baixo.match(/(?:^|[^\d])(0[1-9]|1[0-2])[\/\-.](20\d{2})(?!\d)/);
  if (n) return n[2] + '-' + n[1];
  if (!dataMs) return null;
  const e = baixo.match(/(?:^|[^a-zç])(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?![a-zç])/);
  if (!e) return null;
  const d = new Date(Number(dataMs));
  const mes = MESES_EXTENSO[e[1]];
  const ano = mes > d.getMonth() + 1 ? d.getFullYear() - 1 : d.getFullYear();
  return ano + '-' + String(mes).padStart(2, '0');
}
function competenciaDaData(dataMs) {
  const d = new Date(Number(dataMs));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
// Documento sem mês escrito em lugar nenhum. Se o escritório definiu o dia
// limite (config/cobranca.diaLimite: até esse dia do mês seguinte o cliente
// manda os documentos do mês), o que chega até esse dia é do mês ANTERIOR —
// senão o extrato de agosto que chega em 2 de setembro marcava setembro e
// agosto continuava sendo cobrado. Sem dia limite, vale o mês do e-mail.
function competenciaPresumida(dataMs, diaLimite) {
  const d = new Date(Number(dataMs));
  if (!(diaLimite >= 1) || d.getDate() > diaLimite) return competenciaDaData(dataMs);
  const antes = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return antes.getFullYear() + '-' + String(antes.getMonth() + 1).padStart(2, '0');
}

function carregarProcessados() {
  try { return new Set(JSON.parse(fs.readFileSync(PROCESSADOS_PATH, 'utf8'))); }
  catch (e) { return new Set(); }
}
// Grava num arquivo ao lado e troca de nome no fim. Agora que o controle vai pro
// disco várias vezes por leitura, uma queda de luz no meio de uma gravação
// deixava o arquivo cortado: ele abria como "nenhum e-mail lido" e o robô
// refazia a janela inteira, remarcando o que alguém tinha desmarcado.
function gravarInteiro(caminho, texto) {
  fs.writeFileSync(caminho + '.tmp', texto);
  fs.renameSync(caminho + '.tmp', caminho);
}
function salvarProcessados(set) {
  gravarInteiro(PROCESSADOS_PATH, JSON.stringify(Array.from(set)));
}
// Anexo que não baixa: tenta de novo nas próximas leituras, mas só 3 vezes.
// Sem teto, um anexo quebrado fazia o e-mail ser refeito de 2 em 2 horas por
// semanas, remarcando o documento toda vez que alguém desmarcava.
const TENTATIVAS_PATH = path.join(__dirname, 'gmail-tentativas.json');
const MAX_TENTATIVAS = 3;
function carregarTentativas() { try { return JSON.parse(fs.readFileSync(TENTATIVAS_PATH, 'utf8')); } catch (e) { return {}; } }
function salvarTentativas(t) { try { gravarInteiro(TENTATIVAS_PATH, JSON.stringify(t)); } catch (e) {} }
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
function mesmoConteudo(caminho, buffer) {
  try { return fs.statSync(caminho).size === buffer.length && fs.readFileSync(caminho).equals(buffer); }
  catch (e) { return false; }
}
function salvarArquivo(pasta, nome, buffer) {
  const ext = path.extname(nome);
  const base = path.basename(nome, ext);
  let destino = path.join(pasta, sanitizar(nome));
  let n = 1;
  while (fs.existsSync(destino)) {
    if (mesmoConteudo(destino, buffer)) return null;
    destino = path.join(pasta, sanitizar(base) + ' (' + (++n) + ')' + ext);
  }
  fs.writeFileSync(destino, buffer);
  return destino;
}

// A rotina de arquivamento (repositório "claudio") lê Claudio Secretario em
// qualquer subpasta; duas cópias iguais na mesma rodada viram arquivo em dobro
// no layout ("X" e "X (2)"). Então antes de gravar, procura o mesmo arquivo nas
// outras pastas de mês deste cliente.
function copiaJaNaOrigem(nomeCliente, nome, buffer) {
  let meses = [];
  try { meses = fs.readdirSync(PASTA_DESTINO).filter(d => /^\d{4}-\d{2}$/.test(d)); } catch (e) { return null; }
  for (const mes of meses) {
    const pasta = path.join(PASTA_DESTINO, mes, sanitizar(nomeCliente));
    let arquivos = [];
    try { arquivos = fs.readdirSync(pasta); } catch (e) { continue; }
    const ext = path.extname(nome), base = sanitizar(path.basename(nome, ext));
    for (const a of arquivos) {
      if (a !== sanitizar(nome) && !(a.startsWith(base + ' (') && a.endsWith(ext))) continue;
      if (mesmoConteudo(path.join(pasta, a), buffer)) return path.join(mes, sanitizar(nomeCliente));
    }
  }
  return null;
}

// Bancos dos extratos anexados, cada PDF pelo próprio cabeçalho.
async function bancosDosAnexos(anexos) {
  const textos = [];
  for (const a of anexos) {
    if (a.mimeType !== 'application/pdf' || !a.buffer) continue;
    try { textos.push((await pdfParse(a.buffer)).text); } catch (err) { /* PDF ilegível: sem banco */ }
  }
  return require('./bancos').bancosDosTextos(textos);
}
// Banco novo no cadastro do cliente. O que o admin tirou à mão
// (bancosRecusados) o robô não põe de volta.
function bancosNovos(cliente, bancos) {
  const tem = new Set([].concat(cliente.bancos || [], cliente.bancosRecusados || []));
  return bancos.filter(b => !tem.has(b));
}
async function aprenderBancos(db, cliente, bancos) {
  const novos = bancosNovos(cliente, bancos);
  if (!novos.length || SIMULAR) return;
  try {
    await db.collection('clientes').doc(cliente.id).update({
      bancos: FieldValue.arrayUnion(...novos), bancosPeloRobo: FieldValue.arrayUnion(...novos),
    });
    cliente.bancos = (cliente.bancos || []).concat(novos);
    console.log('  banco(s) aprendido(s) do extrato:', novos.join(', '));
  } catch (err) { console.error('  não consegui guardar o banco no cadastro -', err.message); }
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

// ---------- spam ----------
// Remetentes que a Nilma marcou "É spam" na tela (config/roboIgnorados). O robô
// não lista mais nada deles, nem em "sem cliente" nem no spam. Se a leitura
// falhar, segue sem a lista: pior caso o remetente reaparece na tela.
async function lerIgnorados(db) {
  try {
    const d = (await db.collection('config').doc('roboIgnorados').get()).data() || {};
    return new Set((Array.isArray(d.remetentes) ? d.remetentes : []).map(e => String(e).trim().toLowerCase()).filter(Boolean));
  } catch (err) {
    console.log('Remetentes ignorados não carregaram (' + err.message + '); segue sem eles.');
    return new Set();
  }
}

// robo/estado.spam a partir das mensagens do Gmail (o .data do messages.get).
// Só cabeçalho e nome dos anexos: o robô não baixa nada do spam sozinho, porque
// spam de verdade traz anexo perigoso. O e-mail de cliente vai no topo — é o
// que a Nilma precisa ver e salvar (fila "salvar" com --mensagem ID).
function montarSpam(mensagens, porEmail, porDominio, ignorados) {
  return (mensagens || []).filter(m => m && m.id && m.payload).map(m => {
    const headers = m.payload.headers || [];
    const from = cabecalho(headers, 'From');
    const remetente = extrairEmail(from);
    const cliente = (porEmail.get(remetente) || porDominio.get(dominioDe(remetente)) || [])[0];
    const ms = Number(m.internalDate);
    return {
      mensagemId: m.id, em: ms ? new Date(ms).toISOString() : '', remetente, nome: extrairNome(from),
      assunto: cabecalho(headers, 'Subject'), arquivos: coletarAnexos(m.payload, []).map(a => a.filename),
      clienteId: cliente ? String(cliente.id) : null, clienteNome: cliente ? (cliente.nome || cliente.nomeFantasia || '') : '',
    };
  })
    .filter(s => s.remetente && !(ignorados && ignorados.has(s.remetente)))
    .sort((a, b) => (a.clienteId ? 0 : 1) - (b.clienteId ? 0 : 1) || String(b.em).localeCompare(String(a.em)))
    .slice(0, MAX_SPAM);
}

// Uma página só (até 100): spam de mais de 100 na janela é propaganda, e o de
// cliente vai pro topo de qualquer jeito dentro do que foi lido.
// O que já está em "processados" a Nilma salvou pela tela (--mensagem ID): o
// e-mail continua no spam do Gmail, mas não volta pra lista nem pro resumo.
async function lerSpam(gmail, porEmail, porDominio, ignorados, processados) {
  const r = await comRetentativa(() => gmail.users.messages.list({ userId: 'me', q: `in:spam newer_than:${DIAS}d`, includeSpamTrash: true, maxResults: MAX_SPAM }));
  const ids = (r.data.messages || []).map(m => m.id).filter(id => !(processados && processados.has(id)));
  const mensagens = [];
  let falhas = 0;
  for (const id of ids) {
    try {
      await dormir(120);
      mensagens.push((await comRetentativa(() => gmail.users.messages.get({ userId: 'me', id, format: 'full' }))).data);
    } catch (err) {
      // Apagado entre a lista e a leitura, por exemplo: pula só este.
      falhas++;
      console.error('  spam: e-mail', id, 'não abriu -', err.message);
    }
  }
  // Tudo falhou (cota, rede): lista vazia apagaria a da tela; melhor manter a antiga.
  if (ids.length && falhas === ids.length) throw new Error('nenhum e-mail do spam abriu');
  return montarSpam(mensagens, porEmail, porDominio, ignorados);
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

// ---------- portal do cliente ----------
// Cliente com link próprio (clientes.portalToken) vê lá o que ainda deve. A
// tela de Pendências mantém isso em dia quando está aberta; aqui o robô faz o
// mesmo logo depois de marcar, pra o cliente que acabou de mandar o extrato
// não continuar lendo "falta o extrato". Mesma conta da tela: os dois últimos
// meses fechados, tirando o que não se aplica ao cliente.
const TIPOS_DO_PORTAL = ['extrato', 'comprovante', 'aplicacao'];
function mesesDoPortal(agora) {
  const h = agora || new Date();
  return [1, 2].map(i => {
    const d = new Date(h.getFullYear(), h.getMonth() - i, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });
}
function faltamNoMes(cliente, dado) {
  if (dado && dado.semMovimento) return [];
  const na = Array.isArray(cliente.documentosNaoAplicaveis) ? cliente.documentosNaoAplicaveis : [];
  return TIPOS_DO_PORTAL.filter(t => na.indexOf(t) === -1 && !(dado && dado[t]));
}
async function atualizarPortal(db, cliente, todos) {
  if (SIMULAR || !cliente || !cliente.portalToken) return;
  const mesesDe = async cli => {
    const lista = [];
    for (const comp of mesesDoPortal()) {
      const snap = await db.collection('documentosMensal').doc(cli.id + '_' + comp).get();
      lista.push({ competencia: comp, faltam: faltamNoMes(cli, snap.exists ? snap.data() : null) });
    }
    return lista;
  };
  const meses = await mesesDe(cliente);
  // link de grupo: as empresas aglutinadas a esta entram cada uma com a sua parte
  const seguidoras = cliente.grupoLocal ? [] : Array.from((todos || new Map()).values()).filter(x => x.grupoLocal === cliente.id);
  let empresas = null;
  if (seguidoras.length) {
    empresas = [];
    for (const x of [cliente].concat(seguidoras)) empresas.push({ nome: x.nomeFantasia || x.nome || '', meses: await mesesDe(x) });
  }
  // update() e não set(): portal apagado (link trocado) não pode renascer aqui
  await db.collection('portais').doc(cliente.portalToken)
    .update({ documentos: Object.assign({ atualizadoEm: new Date().toISOString(), meses, email: 'nilmacontabilidade@gmail.com' }, empresas ? { empresas } : {}) });
}

async function gravar(db, docId, patch) {
  if (SIMULAR) return;
  await db.collection('documentosMensal').doc(docId).set(patch, { merge: true });
}

async function main() {
  const inicio = Date.now();
  const gmail = getGmail();
  const db = getDb('entregas-2e5e2');
  const FV = FieldValue;

  // do arquivo que o vigia mantém, quando está fresco; senão, do banco
  const clientesSnap = await require('./clientes-cache').clientesAtivos(db, m => console.log(m));
  const { porEmail, porDominio } = montarIndices(clientesSnap);
  console.log(`Clientes com e-mail: ${porEmail.size} endereços, ${porDominio.size} domínios próprios.`);
  if (SIMULAR) console.log('MODO SIMULAÇÃO: nada será gravado nem baixado.');

  const cobrancaSnap = await db.collection('config').doc('cobranca').get();
  const DIA_LIMITE = Number((cobrancaSnap.data() || {}).diaLimite) || 0;
  // O --mensagem é pedido explícito da tela (e já recusa quem não é cliente).
  const ignorados = UMA_MENSAGEM ? new Set() : await lerIgnorados(db);

  const tentativas = carregarTentativas();
  const processados = RELER ? new Set() : carregarProcessados();
  const jaProcessados = carregarProcessados();
  const semCliente = RELER ? {} : carregarSemCliente();
  const ehConhecido = email => porEmail.has(email) || porDominio.has(dominioDe(email));
  const ids = UMA_MENSAGEM ? [UMA_MENSAGEM] : await listarMensagens(gmail, porEmail, porDominio);
  if (!UMA_MENSAGEM) console.log(`E-mails na janela de ${DIAS} dias: ${ids.length}`);
  const clientesPorId = new Map();
  clientesSnap.forEach(d => clientesPorId.set(d.id, Object.assign({ id: d.id }, d.data())));

  // O que a tela mostra como "caixa": todo e-mail com anexo que o robô viu, e o
  // que já foi salvo no Drive (robo/estado.caixa e robo/estado.salvos).
  const caixaNovos = [];
  const salvosNovos = {};
  let resultado = null;
  const naCaixa = (id, dados) => caixaNovos.push(Object.assign({ mensagemId: id }, dados));
  const relativa = pasta => path.relative(PASTA_DESTINO, pasta);
  // Mapa vazio com merge APAGA o campo no Firestore: só manda "salvos" quando
  // houver algo novo, senão uma execução sem download zerava a lista inteira.
  const comSalvos = () => (Object.keys(salvosNovos).length ? { salvos: salvosNovos } : {});

  const cont = { emails: 0, marcados: 0, baixados: 0, conversas: 0, erros: 0, ambiguos: 0 };
  const portaisATocar = new Map();   // clienteId -> cliente, só quem teve documento marcado
  const naoReconhecidosNovos = [];

  // O controle de e-mails já lidos vai pro disco durante a leitura, não só no
  // fim: se o PC desligar no meio, a próxima leitura não regrava (nem remarca
  // o que alguém desmarcou na tela) tudo que esta já tinha feito.
  let desdeUltimoSalvo = 0;
  const guardarAndamento = () => {
    if (SIMULAR || UMA_MENSAGEM) return;
    try { salvarProcessados(processados); gravarInteiro(SEM_CLIENTE_PATH, JSON.stringify(semCliente)); salvarTentativas(tentativas); } catch (e) { /* tenta de novo no fim */ }
  };
  process.once('SIGINT', () => { guardarAndamento(); process.exit(130); });

  for (const id of ids) {
    if (desdeUltimoSalvo >= 20) { desdeUltimoSalvo = 0; guardarAndamento(); }
    if (!UMA_MENSAGEM) {
      if (processados.has(id)) continue;
      if (semCliente[id] && !ehConhecido(semCliente[id])) {
        // Marcado "É spam" depois de lido: sai da espera e não volta mais.
        if (ignorados.has(semCliente[id])) { processados.add(id); delete semCliente[id]; }
        continue;   // ainda sem cliente: nada mudou
      }
    }
    cont.emails++;
    desdeUltimoSalvo++;
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

      const forcado = CLIENTE_FORCADO ? clientesPorId.get(CLIENTE_FORCADO) : null;
      if (CLIENTE_FORCADO && !forcado) throw new Error('cliente ' + CLIENTE_FORCADO + ' não encontrado ou inativo');
      const candidatos = forcado ? [forcado] : (porEmail.get(remetente) || porDominio.get(dominioDe(remetente)) || []);
      const resumoCaixa = { em, remetente, nome: extrairNome(from), assunto, arquivos: anexos.map(a => a.filename) };

      if (!candidatos.length) {
        // Anexo de quem não é cliente não vai pro Drive: fica só em "remetentes
        // sem cliente" até alguém vincular o remetente a um cliente.
        if (UMA_MENSAGEM) throw new Error('o remetente não é de nenhum cliente; vincule o e-mail a um cliente antes de salvar');
        if (ignorados.has(remetente)) { processados.add(id); continue; }   // "É spam" na tela: nunca mais relê
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
      let faltouAnexo = false;
      for (const a of anexos) {
        try {
          const att = await comRetentativa(() => gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: a.attachmentId }));
          a.buffer = Buffer.from(att.data.data, 'base64');
        } catch (err) {
          cont.erros++;
          faltouAnexo = true;
          console.error('  falha ao baixar', a.filename, '-', err.message);
        }
      }

      const textoNomes = assunto + ' ' + trecho + ' ' + anexos.map(a => a.filename).join(' ');
      let textoPdf = null;
      const lerPdf = async () => (textoPdf !== null ? textoPdf : (textoPdf = await textoDosPdfs(anexos)));

      let cliente = candidatos.length === 1 ? candidatos[0] : desempatarPorDocumento(candidatos, textoNomes);
      if (!cliente && candidatos.length > 1 && anexos.length) cliente = desempatarPorDocumento(candidatos, await lerPdf());

      let tipos = anexos.length ? detectarTipos(textoNomes) : [];
      // Assunto e nomes de arquivo primeiro; o corpo do e-mail só entra sem
      // "08/2026" e afins, porque ali quase sempre é data de envio ou vencimento.
      const nomesArquivos = anexos.map(a => a.filename).join(' ');
      let competencia = competenciaDoTexto(assunto + ' ' + nomesArquivos, msg.data.internalDate) ||
        competenciaDoTexto(trecho, msg.data.internalDate, true);
      if (anexos.length && (!tipos.length || !competencia)) {
        const t = await lerPdf();
        if (!tipos.length) tipos = detectarTipos(t);
        if (!competencia) competencia = competenciaDoTexto(t, msg.data.internalDate);
      }
      competencia = competencia || competenciaPresumida(msg.data.internalDate, DIA_LIMITE);

      const mensagem = { mensagemId: id, em, remetente, assunto, trecho, anexos: anexos.map(a => a.filename) };

      if (!cliente) {
        // Mesmo e-mail pra várias filiais e nada no texto diz qual: a conversa
        // vai pra todas, mas nenhuma é marcada.
        cont.ambiguos++;
        if (anexos.length) naCaixa(id, Object.assign({ clienteId: null, candidatos: candidatos.map(c => c.nome) }, resumoCaixa));
        if (UMA_MENSAGEM) throw new Error('o remetente serve mais de um cliente (' + candidatos.map(c => c.codigoOrigem || c.nome).join(', ') + '); escolha o cliente na tela do cliente');
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
      if (anexos.length) naCaixa(id, Object.assign({ clienteId: cliente.id, clienteNome: cliente.nome }, resumoCaixa));
      cont.baixados += comBytes.length;           // anexos lidos (o Drive só no clique)
      if (comBytes.length && UMA_MENSAGEM) {
        // Um e-mail pode trazer arquivos de meses diferentes (EFD de julho e
        // PIS/Cofins de agosto juntos): cada um vai pro mês do próprio nome.
        const pastas = new Set();
        let salvos = 0;
        for (const a of comBytes) {
          const compArquivo = competenciaDoTexto(a.filename, msg.data.internalDate) || competencia;
          const pasta = path.join(PASTA_DESTINO, compArquivo, sanitizar(cliente.nome));
          const jaEsta = copiaJaNaOrigem(cliente.nome, a.filename, a.buffer);
          if (jaEsta) { pastas.add(jaEsta); salvos++; console.log('  já estava em', jaEsta + ':', a.filename); continue; }
          pastas.add(relativa(pasta));
          if (SIMULAR) { salvos++; continue; }
          try {
            fs.mkdirSync(pasta, { recursive: true });
            salvarArquivo(pasta, a.filename, a.buffer);
            salvos++;
          } catch (err) {
            cont.erros++;
            console.error('  falha ao salvar', a.filename, '-', err.message);
          }
        }
        const listaPastas = Array.from(pastas);
        salvosNovos[id] = { em: new Date().toISOString(), pasta: listaPastas.join(' e '), pastas: listaPastas, arquivos: salvos, clienteId: cliente.id };
        resultado = { mensagemId: id, pasta: listaPastas.join(' e '), arquivos: salvos, cliente: cliente.nome };
      }

      if (tipos.length && comBytes.length) {
        const agora = new Date().toISOString();
        // De que banco(s) veio o anexo. Vale pros TRÊS documentos: extrato,
        // comprovante e aplicação saem todos do banco, e a tela conta o mês
        // banco a banco. Serve também pro cadastro aprender os bancos do
        // cliente sem ninguém digitar.
        const achados = await bancosDosAnexos(comBytes);
        // Comprovante de pagamento traz o banco do RECEBEDOR junto com o de
        // quem pagou. Só o extrato, onde o cabeçalho é sempre do dono da
        // conta, pode ensinar banco novo ao cadastro; nos outros, vale só o
        // que o cliente já tem — senão o boleto pago no Bradesco viraria
        // conta dele no Bradesco.
        const jaTem = new Set(cliente.bancos || []);
        const bancosDoTipo = t => t === 'extrato' ? achados : achados.filter(b => jaTem.has(b));
        patch.atualizadoEm = agora;
        patch.detalhes = {};
        if (achados.length) patch.bancosPorTipo = {};
        tipos.forEach(t => {
          patch[t] = true;
          const doTipo = bancosDoTipo(t);
          patch.detalhes[t] = Object.assign({ origem: 'gmail', em: agora, mensagemId: id, arquivos: comBytes.map(a => a.filename) },
            doTipo.length ? { bancos: doTipo } : {});
          if (doTipo.length) patch.bancosPorTipo[t] = FV.arrayUnion(...doTipo);
        });
        if (achados.length && tipos.includes('extrato')) {
          // bancosRecebidos era o campo antigo, só do extrato: continua em dia
          // pra quem ainda lê ele (o e-mail de cobrança, o mês já gravado).
          patch.bancosRecebidos = FV.arrayUnion(...achados);
          await aprenderBancos(db, cliente, achados);
        }
        cont.marcados++;
        // o link que mostra este cliente: o dele ou o da empresa principal do grupo
        [cliente, clientesPorId.get(cliente.grupoLocal)].forEach(dono => {
          if (dono && dono.portalToken) portaisATocar.set(dono.id, dono);
        });
        console.log(`  ${cliente.nome} (${competencia}): ${tipos.join(', ')} — ${comBytes.length} anexo(s)`);
      } else {
        console.log(`  ${cliente.nome} (${competencia}): conversa registrada${anexos.length ? ', anexo sem tipo reconhecido' : ''}`);
      }

      await gravar(db, cliente.id + '_' + competencia, patch);
      // Anexo que não baixou (queda de rede): o e-mail fica de fora dos já
      // lidos e a próxima leitura tenta de novo, em vez de nunca marcar.
      if (faltouAnexo) {
        tentativas[id] = (tentativas[id] || 0) + 1;
        if (tentativas[id] >= MAX_TENTATIVAS) {
          processados.add(id);
          delete tentativas[id];
          console.error('  desisti do anexo que não baixa (3 tentativas):', assunto);
        }
      } else {
        processados.add(id);
        delete tentativas[id];
      }
    } catch (err) {
      cont.erros++;
      console.error('Erro no e-mail', id, '-', err.message);
      if (UMA_MENSAGEM) resultado = { mensagemId: id, erro: err.message };
    }
  }

  for (const cliente of portaisATocar.values()) {
    try { await atualizarPortal(db, cliente, clientesPorId); }
    catch (err) { console.error('  portal de', cliente.nome, 'não atualizou -', err.message); }
  }

  // Caixa: soma ao que já estava (a não ser no --reler), o mais novo de cada
  // e-mail vence — é assim que um e-mail "sem cliente" passa a mostrar o cliente
  // depois que o remetente é vinculado.
  const caixaMap = new Map();
  const roboAntes = (await db.collection('robo').doc('estado').get()).data() || {};
  (!RELER && Array.isArray(roboAntes.caixa) ? roboAntes.caixa : []).concat(caixaNovos)
    .forEach(c => caixaMap.set(c.mensagemId, c));
  const caixa = Array.from(caixaMap.values())
    .sort((a, b) => String(b.em).localeCompare(String(a.em)))
    .slice(0, MAX_CAIXA);

  if (UMA_MENSAGEM) {
    if (!SIMULAR) {
      await db.collection('robo').doc('estado').set(Object.assign({ caixa }, comSalvos()), { merge: true });
      salvarProcessados(processados);
      gravarInteiro(SEM_CLIENTE_PATH, JSON.stringify(semCliente)); salvarTentativas(tentativas);
    }
    // A última linha é lida pelo vigia pra responder à tela.
    console.log('RESULTADO:' + JSON.stringify(resultado || { mensagemId: UMA_MENSAGEM, erro: 'e-mail não encontrado' }));
    if (!resultado || resultado.erro) process.exitCode = 1;
    return;
  }

  // Spam: só na leitura normal. Se falhar, não manda o campo e a tela continua
  // com a lista da leitura anterior.
  let spam = null;
  try {
    spam = await lerSpam(gmail, porEmail, porDominio, ignorados, processados);
    console.log(`No spam: ${spam.length} (${spam.filter(s => s.clienteId).length} de clientes)`);
  } catch (err) {
    console.error('Spam não foi lido -', err.message, '(fica a lista anterior)');
  }

  // robo/estado: o que a página "Robô do Gmail" mostra.
  const roboRef = db.collection('robo').doc('estado');
  const roboAtual = (await roboRef.get()).data() || {};
  const reconhecido = r => porEmail.has(String(r.remetente).toLowerCase()) || porDominio.has(dominioDe(String(r.remetente).toLowerCase()));
  const porMensagem = new Map();
  // --reler refaz a lista do zero; sem ele, soma ao que já estava.
  (!RELER && Array.isArray(roboAtual.naoReconhecidos) ? roboAtual.naoReconhecidos : [])
    .concat(naoReconhecidosNovos)
    .filter(r => r && r.remetente && !reconhecido(r) && !ignorados.has(String(r.remetente).toLowerCase()))
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
    cont.baixados + (cont.baixados === 1 ? ' anexo lido' : ' anexos lidos'),
    cont.erros ? cont.erros + (cont.erros === 1 ? ' erro' : ' erros') : null,
  ].filter(Boolean).join(', ');

  if (!SIMULAR) {
    await roboRef.set(Object.assign({ ultimaExecucao: execucao.em, ultimaExecucaoResumo: resumo, naoReconhecidos, execucoes, caixa }, comSalvos(), spam ? { spam } : {}), { merge: true });
    salvarProcessados(processados);
    gravarInteiro(SEM_CLIENTE_PATH, JSON.stringify(semCliente)); salvarTentativas(tentativas);
  }

  console.log('---');
  console.log(`E-mails lidos: ${cont.emails} | conversas de clientes: ${cont.conversas} | marcados: ${cont.marcados} | anexos: ${cont.baixados}`);
  console.log(`Remetentes com anexo não reconhecidos: ${naoReconhecidos.length} | ambíguos entre filiais: ${cont.ambiguos} | erros: ${cont.erros}`);
  console.log(`Duração: ${Math.round(execucao.duracaoMs / 1000)}s${SIMULAR ? ' (simulação, nada gravado)' : ''}`);
}

// Rodando direto (node download-attachments.js) faz a leitura; carregado por
// require (teste-robo.js) só entrega as funções de detecção, sem tocar em nada.
if (require.main === module) {
  main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
}

module.exports = {
  competenciaDoTexto, competenciaPresumida, mesesDoPortal, faltamNoMes, detectarTipos, coletarAnexos, IMAGEM_DE_ASSINATURA, AUTOMATICO,
  desempatarPorDocumento, decodificarEntidades, extrairEmail, extrairNome, dominioDe, DOMINIOS_PUBLICOS, montarSpam, MAX_SPAM,
  // usados por envios-do-portal.js (documento que o cliente manda pelo link)
  PASTA_DESTINO, sanitizar, salvarArquivo, atualizarPortal, bancosNovos,
};
