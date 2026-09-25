// Mapa da pasta do ano no Drive (G:\Meu Drive\2026), pro app mostrar as
// pastas dos clientes e marcar sozinho o que já chegou.
//
// Quem lê é o robô da nuvem, pela API do Drive, com a permissão de só leitura
// da conta do escritório (drive.readonly). O navegador não fala com o Drive:
// ele lê o mapa que fica no banco. Assim quem usa o app vê as pastas sem
// ganhar acesso ao Drive — e sem poder apagar nada lá.
//
// No banco:
//   driveIndice/raiz                     a pasta do ano: lista de clientes com
//                                        totais, e o marcador de mudanças do Drive
//   driveIndice/{pastaDoCliente}         totais da pasta de um cliente
//   driveIndice/{pastaDoCliente}/partes/{n}
//                                        os itens (pastas e arquivos) em lista
//                                        plana, cada um com o id da pasta-mãe;
//                                        a tela monta a árvore. Em partes porque
//                                        um documento tem teto de 1 MB.
//
// Tempo real: depois da primeira leitura inteira, o robô pergunta ao Drive "o
// que mudou desde a última vez" a cada minuto (changes.list) e relê só a pasta
// do cliente afetado. Uma releitura completa por noite corrige qualquer coisa
// que tenha escapado.
//
// E o status automático do Pendências sai daqui: a rotina de arquivamento
// guarda extrato, comprovante e aplicação em pastas fixas
// (CONTÁBIL/EXTRATOS/AAAA/MM/BANCÁRIOS...), então arquivo nessas pastas quer
// dizer documento recebido naquele mês. Ver marcarPeloIndice.
const { google } = require('googleapis');
const { getAuth } = require('./gmail-client');
const { FieldValue } = require('firebase-admin/firestore');

const PASTA_ANO = process.env.DRIVE_PASTA_ANO || '2026';
const COLECAO = 'driveIndice';
const MIME_PASTA = 'application/vnd.google-apps.folder';
const ITENS_POR_PARTE = 4000;          // ~130 bytes cada: ~520 KB por documento
const PASTAS_POR_CONSULTA = 25;        // "a in parents or b in parents or ..."
const LEITURAS_EM_PARALELO = 6;
const MUDANCAS_A_CADA_MS = 60 * 1000;
const HORA_DA_RELEITURA = 3;           // releitura completa, de madrugada

let drive = null;
function getDrive() {
  if (!drive) drive = google.drive({ version: 'v3', auth: getAuth() });
  return drive;
}

// ---------- funções puras (testadas sem rede) ----------

// "58 - TORNEARIA VOLPONI LTDA" -> { codigo: '58', nome: 'TORNEARIA VOLPONI LTDA' }
function codigoDaPasta(nome) {
  const m = /^(\d+)\s*-\s*(.+)$/.exec(String(nome || '').trim());
  return m ? { codigo: m[1], nome: m[2].trim() } : { codigo: null, nome: String(nome || '').trim() };
}

// Compara nome de pasta sem acento e sem diferença de maiúscula: o Drive pode
// devolver "BANCÁRIOS" com o acento em forma composta ou decomposta.
function chaveDeNome(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

// Caminho de cada item a partir da pasta do cliente: Map(id -> ['CONTÁBIL', 'EXTRATOS', ...])
function caminhos(itens, raizId) {
  const porId = new Map(itens.map(i => [i.i, i]));
  const memo = new Map([[raizId, []]]);
  function de(id, profundidade) {
    if (memo.has(id)) return memo.get(id);
    const it = porId.get(id);
    if (!it || profundidade > 60) return null;
    const pai = de(it.p, profundidade + 1);
    const c = pai ? pai.concat([it.n]) : null;
    memo.set(id, c);
    return c;
  }
  itens.forEach(i => de(i.i, 0));
  return memo;
}

// Pastas da rotina -> tipo do Pendências. MAQUININHAS fica de fora de
// propósito: não é o "Extrato Bancário" que o Pendências cobra.
const TIPO_POR_PASTA = { BANCARIOS: 'extrato', COMPROVANTES: 'comprovante', APLICACOES: 'aplicacao' };

// Nome da pasta do banco (CONTÁBIL/EXTRATOS/AAAA/MM/BANCÁRIOS/<BANCO>) -> id do
// banco no app (bancos-nilma.js). A rotina de arquivamento usa sempre o nome
// curto; o que não está aqui passa pelo reconhecedor de texto dos PDFs. Pasta
// de banco que o app não conhece (INFINITEPAY, BIGCARD) fica sem banco.
const BANCO_POR_PASTA = {
  'BANCO DO BRASIL': 'bb', BB: 'bb', SICOOB: 'sicoob', BANCOOB: 'sicoob', BRADESCO: 'bradesco', NUBANK: 'nubank',
  CAIXA: 'caixa', CEF: 'caixa', 'CAIXA ECONOMICA': 'caixa', 'CAIXA ECONOMICA FEDERAL': 'caixa',
  ITAU: 'itau', 'ITAU UNIBANCO': 'itau', SANTANDER: 'santander', BNB: 'bnb', 'BANCO DO NORDESTE': 'bnb',
  INTER: 'inter', 'BANCO INTER': 'inter', 'MERCADO PAGO': 'mercadopago', MERCADOPAGO: 'mercadopago',
  CORA: 'cora', PAGBANK: 'pagbank', PAGSEGURO: 'pagbank', C6: 'c6', 'C6 BANK': 'c6', STONE: 'stone',
  SICREDI: 'sicredi', CRESOL: 'cresol', BTG: 'btg', 'BTG PACTUAL': 'btg', SAFRA: 'safra', BANRISUL: 'banrisul',
};
function bancoDaPasta(nome) {
  const k = chaveDeNome(nome);
  if (!k) return null;
  if (BANCO_POR_PASTA[k]) return BANCO_POR_PASTA[k];
  try { return require('./bancos').bancosDoTexto(nome)[0] || null; } catch (e) { return null; }
}

// Quais documentos a pasta de um cliente prova que chegaram, e de que banco:
// Map("2026-06|extrato" -> [{ id, nome, banco }])
function documentosNaPasta(itens, raizId) {
  const cam = caminhos(itens, raizId);
  const achados = new Map();
  itens.forEach(it => {
    if (it.t === 'd') return;
    const original = cam.get(it.i) || [];
    const c = original.map(chaveDeNome);
    // CONTÁBIL / EXTRATOS / AAAA / MM / BANCÁRIOS / <BANCO> / ... / arquivo
    if (c.length < 6 || c[0] !== 'CONTABIL' || c[1] !== 'EXTRATOS') return;
    if (!/^\d{4}$/.test(c[2]) || !/^(0[1-9]|1[0-2])$/.test(c[3])) return;
    const tipo = TIPO_POR_PASTA[c[4]];
    if (!tipo) return;
    const chave = c[2] + '-' + c[3] + '|' + tipo;
    if (!achados.has(chave)) achados.set(chave, []);
    // a pasta logo abaixo do tipo é o banco (só quando o arquivo está dentro dela)
    achados.get(chave).push({ id: it.i, nome: it.n, banco: c.length >= 7 ? bancoDaPasta(original[5]) : null });
  });
  return achados;
}

function totais(itens) {
  const t = { arquivos: 0, pastas: 0, bytes: 0, mod: null };
  itens.forEach(i => {
    if (i.t === 'd') t.pastas++; else { t.arquivos++; t.bytes += i.s || 0; }
    if (i.m && (!t.mod || i.m > t.mod)) t.mod = i.m;
  });
  return t;
}

// ---------- leitura do Drive ----------

function paraConsulta(texto) { return String(texto).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function itemDoDrive(f) {
  const t = f.mimeType === MIME_PASTA ? 'd' : /^application\/vnd\.google-apps\./.test(f.mimeType) ? 'g' : 'f';
  const it = { i: f.id, n: f.name, p: (f.parents || [])[0] || null, t };
  if (f.size) it.s = Number(f.size);
  if (f.modifiedTime) it.m = f.modifiedTime;
  if (t !== 'd' && f.mimeType) it.x = f.mimeType;
  return it;
}

async function listarFilhosDe(pastas) {
  const d = getDrive();
  const itens = [];
  let pageToken;
  do {
    const r = await d.files.list({
      q: '(' + pastas.map(id => `'${paraConsulta(id)}' in parents`).join(' or ') + ') and trashed = false',
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)',
      pageSize: 1000,
      pageToken,
    });
    (r.data.files || []).forEach(f => itens.push(itemDoDrive(f)));
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return itens;
}

// Tudo dentro de uma pasta, nível por nível, várias pastas por consulta.
async function varrerPasta(pastaId) {
  const itens = [];
  let nivel = [pastaId];
  let voltas = 0;
  while (nivel.length && voltas++ < 40) {
    const proximo = [];
    for (let i = 0; i < nivel.length; i += PASTAS_POR_CONSULTA) {
      const filhos = await listarFilhosDe(nivel.slice(i, i + PASTAS_POR_CONSULTA));
      filhos.forEach(f => { itens.push(f); if (f.t === 'd') proximo.push(f.i); });
    }
    nivel = proximo;
  }
  return itens;
}

async function acharPastaDoAno() {
  const r = await getDrive().files.list({
    q: `'root' in parents and name = '${paraConsulta(PASTA_ANO)}' and mimeType = '${MIME_PASTA}' and trashed = false`,
    fields: 'files(id, name)',
  });
  const p = (r.data.files || [])[0];
  if (!p) throw new Error('não achei a pasta "' + PASTA_ANO + '" no Meu Drive da conta do escritório');
  return p.id;
}

// ---------- gravação no banco ----------

async function gravarCliente(db, pasta, itens) {
  const ref = db.collection(COLECAO).doc(pasta.id);
  const antes = await ref.get();
  const partesAntes = antes.exists ? (antes.data().partes || 0) : 0;
  const partes = Math.max(1, Math.ceil(itens.length / ITENS_POR_PARTE));
  for (let n = 0; n < partes; n++) {
    await ref.collection('partes').doc(String(n)).set({ itens: itens.slice(n * ITENS_POR_PARTE, (n + 1) * ITENS_POR_PARTE) });
  }
  // Pasta que encolheu: as partes que sobraram são do próprio índice, não do Drive.
  for (let n = partes; n < partesAntes; n++) await ref.collection('partes').doc(String(n)).delete();
  const c = codigoDaPasta(pasta.name);
  const t = totais(itens);
  const resumo = Object.assign({ id: pasta.id, nomePasta: pasta.name, codigo: c.codigo, nome: c.nome, partes, atualizadoEm: new Date().toISOString() }, t);
  await ref.set(resumo);
  return resumo;
}

// ---------- status automático do Pendências ----------

// Liga a pasta do cliente ao cadastro pelo código ("58 - ..." -> codigoOrigem "58").
async function clientesPorCodigo(db) {
  const m = new Map();
  (await db.collection('clientes').get()).forEach(d => {
    const c = d.data();
    if (c.codigoOrigem != null && c.ativo !== false) m.set(String(c.codigoOrigem).trim(), Object.assign({ id: d.id }, c));
  });
  return m;
}

// Marca como recebido o que a pasta prova que chegou. Três cuidados:
//   - só MARCA, nunca desmarca: falta de arquivo na pasta não é prova de nada;
//   - lembra quais arquivos já usou (campo "pasta" do mês): se alguém
//     desmarcar à mão, o robô não remarca por causa do mesmo arquivo — só se
//     chegar um arquivo novo;
//   - não passa por cima de quem já marcou (Gmail, link, alguém da equipe):
//     nesses casos só anota que o arquivo também está na pasta.
async function marcarPeloIndice(db, cliente, achados, log, soEnsaio) {
  if (!cliente || !achados.size) return 0;
  let marcados = 0;
  const hoje = new Date();
  const limite = new Date(hoje.getFullYear(), hoje.getMonth() - 18, 1);
  for (const [chave, arquivos] of achados) {
    const [competencia, tipo] = chave.split('|');
    const [a, m] = competencia.split('-').map(Number);
    if (new Date(a, m - 1, 1) < limite) continue;
    const ref = db.collection('documentosMensal').doc(cliente.id + '_' + competencia);
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : {};
    const vistos = new Set(((d.pasta || {})[tipo]) || []);
    const novos = arquivos.filter(x => !vistos.has(x.id));
    if (!novos.length) continue;
    const agora = new Date().toISOString();
    const patch = {
      clienteId: cliente.id, clienteNome: cliente.nome || '', competencia,
      pasta: { [tipo]: Array.from(vistos).concat(novos.map(x => x.id)).slice(-500) },
      atualizadoEm: agora,
    };
    // De que banco(s) veio o documento do mês (a pasta do banco na rotina):
    // é o que a tela usa pra contar o mês banco a banco.
    const bancos = Array.from(new Set(novos.map(x => x.banco).filter(Boolean)));
    if (bancos.length && !soEnsaio) patch.bancosPorTipo = { [tipo]: FieldValue.arrayUnion(...bancos) };
    if (d[tipo] !== true) {
      if (soEnsaio) { marcados++; continue; }       // só conta o que marcaria
      patch[tipo] = true;
      patch.detalhes = { [tipo]: Object.assign({ origem: 'pasta', em: agora, arquivos: novos.slice(0, 20).map(x => x.nome) }, bancos.length ? { bancos } : {}) };
      marcados++;
      log('pasta do cliente:', (cliente.nome || cliente.id) + ',', tipo, competencia, 'marcado como recebido');
    }
    await ref.set(patch, { merge: true });
  }
  return marcados;
}

// ---------- o cadastro do cliente pela pasta ----------
// Duas coisas que a pasta ensina sobre o cliente, com os mesmos cuidados do
// robô do Gmail (download-attachments.js, aprenderBancos):
//
// 1. Bancos: o banco da pasta do extrato e da aplicação vai pro cadastro
//    (clientes.bancos, e bancosPeloRobo pra saber quem pôs). Banco que alguém
//    tirou do cadastro (bancosRecusados) não volta. Comprovante não ensina
//    banco: pode ser o banco de quem recebeu o pagamento.
//
// 2. "Não se aplica" automático (pedido do escritório em 25/09/2026): cliente
//    com movimento no ano (documento em pelo menos MESES_PRA_CONCLUIR meses)
//    e NENHUM extrato, ou NENHUMA aplicação, no ano inteiro — nem na pasta,
//    nem marcado por outro caminho — não tem esse documento: ele entra em
//    documentosNaoAplicaveis e some da cobrança e da tela. O robô anota o que
//    ele mesmo pôs em naoAplicavelAuto:
//      - se o documento aparecer depois, ele tira;
//      - se alguém tirar à mão, ele não põe de novo (a pessoa sabe mais).
const MESES_PRA_CONCLUIR = 3;
const TIPOS_QUE_PODEM_NAO_SE_APLICAR = ['extrato', 'aplicacao'];

async function ajustarCadastroPeloIndice(db, cliente, achados, log) {
  if (!cliente) return;
  const ano = String(new Date().getFullYear());
  const tiposNoAno = new Set();
  const mesesComMovimento = new Set();
  const bancos = new Set();
  for (const [chave, arquivos] of achados) {
    const [competencia, tipo] = chave.split('|');
    if (tipo !== 'comprovante') arquivos.forEach(x => { if (x.banco) bancos.add(x.banco); });
    if (competencia.slice(0, 4) !== ano) continue;
    tiposNoAno.add(tipo);
    mesesComMovimento.add(competencia);
  }
  // o que já está marcado no ano por qualquer caminho (Gmail, link, à mão)
  const docs = await db.collection('documentosMensal').where('clienteId', '==', cliente.id).get();
  docs.forEach(d => {
    const x = d.data();
    if (String(x.competencia || '').slice(0, 4) !== ano) return;
    ['extrato', 'comprovante', 'aplicacao'].forEach(t => { if (x[t] === true) { tiposNoAno.add(t); mesesComMovimento.add(x.competencia); } });
  });

  const atualizacao = {};
  const tem = new Set([].concat(cliente.bancos || [], cliente.bancosRecusados || []));
  const bancosNovos = Array.from(bancos).filter(b => !tem.has(b));
  if (bancosNovos.length) {
    atualizacao.bancos = FieldValue.arrayUnion(...bancosNovos);
    atualizacao.bancosPeloRobo = FieldValue.arrayUnion(...bancosNovos);
  }

  const na = new Set(cliente.documentosNaoAplicaveis || []);
  const auto = new Set(cliente.naoAplicavelAuto || []);
  const por = [], tirar = [];
  if (mesesComMovimento.size >= MESES_PRA_CONCLUIR) {
    TIPOS_QUE_PODEM_NAO_SE_APLICAR.forEach(t => {
      if (!tiposNoAno.has(t) && !na.has(t) && !auto.has(t)) por.push(t);
    });
  }
  TIPOS_QUE_PODEM_NAO_SE_APLICAR.forEach(t => {
    if (tiposNoAno.has(t) && auto.has(t) && na.has(t)) tirar.push(t);
  });
  if (por.length) {
    atualizacao.documentosNaoAplicaveis = FieldValue.arrayUnion(...por);
    atualizacao.naoAplicavelAuto = FieldValue.arrayUnion(...por);
  }
  if (tirar.length && !por.length) {
    // (um só arrayRemove por campo numa atualização; pôr e tirar o mesmo
    // tipo na mesma volta não acontece, porque dependem de tiposNoAno)
    atualizacao.documentosNaoAplicaveis = FieldValue.arrayRemove(...tirar);
    atualizacao.naoAplicavelAuto = FieldValue.arrayRemove(...tirar);
  }
  if (!Object.keys(atualizacao).length) return;
  await db.collection('clientes').doc(cliente.id).update(atualizacao);
  const nome = cliente.nome || cliente.id;
  if (bancosNovos.length) { log('pasta do cliente:', nome + ', banco(s) no cadastro:', bancosNovos.join(', ')); cliente.bancos = (cliente.bancos || []).concat(bancosNovos); }
  if (por.length) log('pasta do cliente:', nome + ', não se aplica (sem nenhum no ano):', por.join(', '));
  if (tirar.length && !por.length) log('pasta do cliente:', nome + ', voltou a se aplicar:', tirar.join(', '));
}

// ---------- varredura completa ----------

async function emParalelo(lista, n, fn) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const item = lista[i++]; await fn(item); }
  });
  await Promise.all(trabalhadores);
}

// A marcação automática só age com config/indiceDrive.marcar = true. Desligada,
// o mapa das pastas funciona igual e o robô só conta o que marcaria (ensaio).
async function marcacaoLigada(db) {
  try { return ((await db.collection('config').doc('indiceDrive').get()).data() || {}).marcar === true; }
  catch (e) { return false; }
}

async function releituraDoCliente(db, pasta, porCodigo, log, soEnsaio) {
  const itens = await varrerPasta(pasta.id);
  const resumo = await gravarCliente(db, { id: pasta.id, name: pasta.name }, itens);
  const cliente = resumo.codigo ? porCodigo.get(resumo.codigo) : null;
  const achados = documentosNaPasta(itens, pasta.id);
  const marcados = await marcarPeloIndice(db, cliente, achados, log, soEnsaio);
  // cadastro (bancos, "não se aplica") só com a marcação ligada
  if (!soEnsaio) {
    try { await ajustarCadastroPeloIndice(db, cliente, achados, log); }
    catch (err) { log('pasta do cliente:', (cliente && cliente.nome) || pasta.name, '- cadastro não atualizou:', err.message); }
  }
  return { resumo, marcados, itens };
}

async function atualizarRaiz(db, raizId, clientes, extra) {
  const lista = clientes.map(c => ({ id: c.id, nome: c.nome, nomePasta: c.nomePasta, codigo: c.codigo, arquivos: c.arquivos, pastas: c.pastas, bytes: c.bytes, mod: c.mod }))
    .sort((a, b) => (Number(a.codigo) || 1e9) - (Number(b.codigo) || 1e9) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  await db.collection(COLECAO).doc('raiz').set(Object.assign({ pastaId: raizId, pastaNome: PASTA_ANO, clientes: lista, atualizadoEm: new Date().toISOString() }, extra || {}), { merge: true });
}

async function varreduraCompleta(db, log, estado) {
  const t0 = Date.now();
  // O marcador de mudanças é pego ANTES de ler: o que mudar durante a leitura
  // aparece na primeira conferência de mudanças, em vez de se perder.
  const inicio = await getDrive().changes.getStartPageToken({});
  const raizId = await acharPastaDoAno();
  const topo = (await listarFilhosDe([raizId])).filter(i => i.t === 'd');
  const porCodigo = await clientesPorCodigo(db);
  const soEnsaio = !(await marcacaoLigada(db));
  const resumos = [];
  let marcados = 0;
  await emParalelo(topo, LEITURAS_EM_PARALELO, async p => {
    try {
      const r = await releituraDoCliente(db, { id: p.i, name: p.n }, porCodigo, log, soEnsaio);
      resumos.push(r.resumo);
      marcados += r.marcados;
      if (estado) lembrarDonos(estado, p.i, r.itens);
    } catch (err) { log('pasta', p.n, 'não foi lida:', err.message); }
  });
  await atualizarRaiz(db, raizId, resumos, { pageToken: inicio.data.startPageToken, varreduraEm: new Date().toISOString() });
  const arquivos = resumos.reduce((s, r) => s + r.arquivos, 0);
  log('mapa do Drive: ' + resumos.length + ' pastas de cliente, ' + arquivos + ' arquivos, ' + marcados + ' documento(s) ' + (soEnsaio ? 'que seriam marcados (marcação automática desligada)' : 'marcado(s) pela pasta') + ', em ' + Math.round((Date.now() - t0) / 1000) + 's');
  return { raizId, resumos };
}

// ---------- mudanças (tempo real) ----------

// De que pasta de cliente é este arquivo? Sobe pelas pastas-mãe até achar a
// que está direto na pasta do ano.
async function pastaDoClienteDe(fileId, raizId, cache) {
  let id = fileId;
  for (let passo = 0; passo < 30 && id; passo++) {
    if (cache.has(id)) {
      const pai = cache.get(id);
      if (pai === raizId) return id;
      if (pai == null) return null;
      id = pai;
      continue;
    }
    let f;
    try { f = (await getDrive().files.get({ fileId: id, fields: 'id, parents' })).data; }
    catch (e) { return null; }
    const pai = (f.parents || [])[0] || null;
    cache.set(id, pai);
    if (pai === raizId) return id;
    id = pai;
  }
  return null;
}

async function conferirMudancas(db, estado, log) {
  const raizRef = db.collection(COLECAO).doc('raiz');
  const raiz = (await raizRef.get()).data() || {};
  if (!raiz.pageToken || !raiz.pastaId) return false;
  const sujas = new Set();
  let novaRaiz = false;
  let token = raiz.pageToken;
  let proximo = null;
  do {
    const r = await getDrive().changes.list({
      pageToken: token, pageSize: 1000, includeRemoved: true, spaces: 'drive',
      fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, parents, trashed))',
    });
    for (const ch of r.data.changes || []) {
      const pais = (ch.file && ch.file.parents) || [];
      if (pais.includes(raiz.pastaId)) novaRaiz = true;     // pasta de cliente criada/renomeada
      // Apagado ou tirado de lugar: o cache de onde ele estava diz a quem pertencia.
      const antiga = estado.dono.get(ch.fileId);
      if (antiga) sujas.add(antiga);
      if (!ch.removed && ch.file && !ch.file.trashed) {
        const dono = await pastaDoClienteDe(ch.fileId, raiz.pastaId, estado.pais);
        if (dono) sujas.add(dono);
      }
    }
    token = r.data.nextPageToken;
    proximo = r.data.newStartPageToken || proximo;
  } while (token);

  if (!sujas.size && !novaRaiz) {
    if (proximo && proximo !== raiz.pageToken) await raizRef.set({ pageToken: proximo }, { merge: true });
    return false;
  }
  const porCodigo = await clientesPorCodigo(db);
  const soEnsaio = !(await marcacaoLigada(db));
  const clientes = new Map((raiz.clientes || []).map(c => [c.id, c]));
  if (novaRaiz) {
    const topo = (await listarFilhosDe([raiz.pastaId])).filter(i => i.t === 'd');
    const ids = new Set(topo.map(t => t.i));
    topo.forEach(t => { if (!clientes.has(t.i)) sujas.add(t.i); });
    for (const id of Array.from(clientes.keys())) if (!ids.has(id)) clientes.delete(id);
    topo.forEach(t => { if (clientes.has(t.i) && clientes.get(t.i).nomePasta !== t.n) sujas.add(t.i); });
    estado.nomes = new Map(topo.map(t => [t.i, t.n]));
  }
  for (const id of sujas) {
    const nome = (estado.nomes && estado.nomes.get(id)) || (clientes.get(id) || {}).nomePasta;
    if (!nome) continue;
    try {
      const r = await releituraDoCliente(db, { id, name: nome }, porCodigo, log, soEnsaio);
      clientes.set(id, r.resumo);
      lembrarDonos(estado, id, r.itens);
    } catch (err) { log('pasta', nome, 'não foi relida:', err.message); }
  }
  await atualizarRaiz(db, raiz.pastaId, Array.from(clientes.values()), { pageToken: proximo || raiz.pageToken });
  log('mapa do Drive: ' + sujas.size + ' pasta(s) de cliente atualizada(s)');
  return true;
}

// Guarda "este arquivo é daquele cliente" pra saber a quem avisar quando ele
// for apagado (o Drive não diz mais onde ele estava).
function lembrarDonos(estado, clienteId, itens) {
  if (!itens) return;
  itens.forEach(i => estado.dono.set(i.i, clienteId));
}

// ---------- ligar no robô ----------

function iniciarIndiceDrive(db, log) {
  const estado = { dono: new Map(), pais: new Map(), nomes: null, ocupado: false, ultimaCompleta: '' };
  const hojeIso = () => new Date().toISOString().slice(0, 10);

  async function volta() {
    if (estado.ocupado) return;
    estado.ocupado = true;
    try {
      const raiz = (await db.collection(COLECAO).doc('raiz').get()).data() || {};
      const precisaCompleta = !raiz.pageToken ||
        (new Date().getHours() === HORA_DA_RELEITURA && estado.ultimaCompleta !== hojeIso());
      if (precisaCompleta) {
        estado.dono.clear();
        await varreduraCompleta(db, log, estado);
        estado.ultimaCompleta = hojeIso();
        estado.pais.clear();
      } else {
        await conferirMudancas(db, estado, log);
      }
    } catch (err) {
      log('mapa do Drive: erro (' + err.message + '); tento de novo no próximo minuto');
    } finally { estado.ocupado = false; }
  }
  setTimeout(volta, 20 * 1000);
  setInterval(volta, MUDANCAS_A_CADA_MS);
  log('mapa do Drive ligado (pasta ' + PASTA_ANO + ', mudanças a cada minuto, releitura completa às ' + HORA_DA_RELEITURA + 'h)');
}

module.exports = {
  iniciarIndiceDrive, varreduraCompleta, conferirMudancas, pastaDoClienteDe, getDrive,
  // puras, pro teste
  codigoDaPasta, chaveDeNome, caminhos, documentosNaPasta, totais, TIPO_POR_PASTA, bancoDaPasta,
  // cadastro pela pasta (bancos, "não se aplica"): exposta pra aplicar/testar fora do robô
  ajustarCadastroPeloIndice, marcarPeloIndice,
};
