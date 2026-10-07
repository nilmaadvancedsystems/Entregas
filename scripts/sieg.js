// O SIEG no Fiscal do nads (Vitor, 06/10/2026: "integre a API do SIEG ao app"). Roda no processo do arquivador, neste
// PC (as credenciais ficam só aqui: scripts/sieg_credenciais.json, fora do git). Faz duas coisas, e só elas:
//
// 1. Toda madrugada conta as notas de cada cliente ativo com CNPJ no mês (emitidas e recebidas, por tipo) e grava em
//    siegContagens/{codigo}_{AAAA-MM}. O Fiscal do nads mostra ("SIEG: 214 notas") e avisa de quem está com zero.
// 2. Atende os pedidos do nads (pedidosSieg): baixa os XMLs de saída do mês de uma empresa (NF-e e NFC-e, com os
//    eventos de cancelamento) e grava só os números por série e as canceladas em siegSaidas/{codigo}_{AAAA-MM}, que a
//    Conferência de Saídas usa para achar os buracos da numeração.
//
// A API (integracoes.sieg.com › Clientes SIEG): o token (create-jwt, com o ClientId e a SecretKey do cadastro do
// sistema, vale 24 h) e a API Key em toda chamada. Limites: contar-xmls 5 por minuto; baixar-xmls 2 por minuto, 50 XMLs
// cada. Respondeu 429: espera e tenta de novo. Sem as três credenciais, fica desligado (e diz por quê em robo/sieg).
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const CREDENCIAIS = path.join(__dirname, 'sieg_credenciais.json');
// a pasta do Drive deste PC (o Google Drive para computador): os XMLs do mês vão para Claudio Secretario/AAAA-MM/<cliente>,
// a mesma do "Salvar no Drive" do Gmail, de onde a rotina das 9h arquiva e o Alterdata importa (07/10/2026)
const PASTA_DO_DRIVE = process.env.PASTA_DESTINO || 'G:\\Meu Drive\\Claudio Secretario';
const sx = require('./sieg-xmls');
const BASE = 'https://api.sieg.com/api/v1/';
const ESPERA_MS = { 'contar-xmls': 13000, 'baixar-xmls': 31000, 'create-jwt': 2000 };
const TIPO = { NFe: 1, CTe: 2, NFSe: 3, NFCe: 4, CFe: 5 };

const dormir = ms => new Promise(r => setTimeout(r, ms));
const soDigitos = v => String(v || '').replace(/\D/g, '');
// o documento do cliente: CNPJ (14) ou CPF (11, o produtor rural; o SIEG conta pelos dois, 07/10/2026)
const documentoValido = d => d.length === 14 || d.length === 11;
// o código do cliente no Alterdata: nos clientes do Entregas ele está em codigoOrigem (07/10/2026: com `codigo` só, a
// contagem não achava ninguém)
const codigoDe = x => soDigitos(x && (x.codigo != null && x.codigo !== '' ? x.codigo : x.codigoOrigem));

function lerCredenciais() {
  try {
    const c = JSON.parse(fs.readFileSync(CREDENCIAIS, 'utf8'));
    const faltam = ['apiKey', 'clientId', 'secretKey'].filter(k => !String(c[k] || '').trim());
    return { c, faltam };
  } catch (e) { return { c: null, faltam: ['apiKey', 'clientId', 'secretKey'] }; }
}

// o baixar-xmls às vezes leva mais de 2 minutos (07/10/2026, ~100 s numa chamada de 2 notas): 5 minutos para ele
const LIMITE_MS = { 'baixar-xmls': 5 * 60000 };

function http(metodo, rota, headers, corpo) {
  return new Promise((resolve, reject) => {
    const dados = corpo == null ? null : Buffer.from(JSON.stringify(corpo));
    const req = https.request(BASE + rota, {
      method: metodo, timeout: LIMITE_MS[rota] || 120000,
      headers: Object.assign({ Accept: 'application/json' }, dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}, headers),
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => { const bytes = Buffer.concat(partes); resolve({ status: res.statusCode, texto: bytes.toString('utf8'), bytes }); });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('o SIEG não respondeu em ' + Math.round((LIMITE_MS[rota] || 120000) / 60000) + ' minutos'), { tempo: true })));
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

// ---------- o token (24 h) ----------
let jwt = { token: '', ate: 0 };
async function token(c) {
  if (jwt.token && Date.now() < jwt.ate) return jwt.token;
  const cab = { clientId: c.clientId, secretKey: c.secretKey, 'X-Client-Id': c.clientId, 'X-Secret-Key': c.secretKey };
  let ultimo = '';
  for (const metodo of ['POST', 'GET']) {
    const r = await http(metodo, 'create-jwt', cab, null);
    ultimo = 'HTTP ' + r.status;
    if (r.status >= 300) continue;
    let t = r.texto.trim();
    try { const j = JSON.parse(t); t = typeof j === 'string' ? j : (j.token || j.Token || j.accessToken || j.jwt || j.access_token || ''); } catch (e) { /* veio o token cru */ }
    t = String(t).replace(/^"|"$/g, '');
    if (t) { jwt = { token: t, ate: Date.now() + 23 * 36e5 }; return t; }
  }
  throw new Error('não consegui gerar o token do SIEG (' + ultimo + ')');
}

// ---------- uma chamada, no ritmo do limite de cada rota ----------
const ultimaChamada = {};
async function chamar(c, rota, corpo) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const falta = (ultimaChamada[rota] || 0) + (ESPERA_MS[rota] || 15000) - Date.now();
    if (falta > 0) await dormir(falta);
    ultimaChamada[rota] = Date.now();
    let r;
    try { r = await http('POST', rota, { Authorization: 'Bearer ' + await token(c), 'X-API-Key': c.apiKey }, corpo); }
    // demorou demais: tenta de novo (até 3 vezes); outro erro de rede sobe
    catch (e) { if (e.tempo && tentativa < 2) continue; throw e; }
    if (r.status === 429) { await dormir(60000 * (tentativa + 1)); continue; }
    if (r.status === 401) { jwt = { token: '', ate: 0 }; continue; }
    // nada no período: o SIEG responde 404 "Nenhum arquivo XML localizado." (07/10/2026) — lista vazia, não é erro
    if (r.status === 404 && /nenhum arquivo|nenhum xml|não localizado|nao localizado/i.test(r.texto)) return [];
    if (r.status >= 300) throw new Error(rota + ': HTTP ' + r.status + ' ' + r.texto.slice(0, 200));
    // o baixar-xmls responde com o .zip direto (binário: "PK…", 07/10/2026): vai como bytes para o xmlsDaResposta abrir
    if (r.bytes.length > 4 && r.bytes.readUInt32LE(0) === 0x04034b50) return r.bytes;
    let j;
    try { j = JSON.parse(r.texto); } catch (e) { return r.texto; }
    // a resposta vem embrulhada (07/10/2026, a primeira chamada de verdade): { IsSuccess, ErrorMessage, StatusCode, Data }
    if (j && typeof j === 'object' && 'IsSuccess' in j) {
      // sem nada no período: lista vazia (não é erro)
      if (!j.IsSuccess && /nenhum|nao encontr|não encontr|sem xml|sem arquivo|not found|no file/i.test(String(j.ErrorMessage || ''))) return [];
      if (!j.IsSuccess) throw new Error(rota + ': ' + (j.ErrorMessage || 'o SIEG recusou'));
      return j.Data;
    }
    return j;
  }
  throw new Error(rota + ': o SIEG seguiu recusando (limite de chamadas)');
}

// ---------- ZIP (o baixar-xmls pode mandar os XMLs num .zip em Base64): leitor mínimo, sem biblioteca ----------
function lerZip(buf) {
  const saida = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const metodo = buf.readUInt16LE(i + 8);
    const tam = buf.readUInt32LE(i + 18);
    const nome = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const ini = i + 30 + nome + extra;
    const dados = buf.subarray(ini, ini + tam);
    saida.push((metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('utf8'));
    i = ini + tam;
  }
  return saida;
}

/** Os XMLs que vieram na resposta, seja qual for o formato (lista de Base64, objeto com a lista, ZIP em Base64). */
function xmlsDaResposta(resp) {
  if (Buffer.isBuffer(resp)) return resp.length > 4 && resp.readUInt32LE(0) === 0x04034b50 ? lerZip(resp) : [resp.toString('utf8')];
  const lista = Array.isArray(resp) ? resp
    : resp && typeof resp === 'object' ? (resp.xmls || resp.Xmls || resp.data || resp.arquivos || Object.values(resp).find(Array.isArray) || [])
      : typeof resp === 'string' ? [resp] : [];
  const xmls = [];
  for (const item of lista) {
    const s = typeof item === 'string' ? item : (item && (item.xml || item.Xml || item.conteudo)) || '';
    if (!s) continue;
    if (s.trim().startsWith('<')) { xmls.push(s); continue; }
    const buf = Buffer.from(s, 'base64');
    if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) xmls.push(...lerZip(buf));
    else xmls.push(buf.toString('utf8'));
  }
  return xmls;
}

const tag = (xml, nome) => { const m = new RegExp('<(?:\\w+:)?' + nome + '>([^<]*)</(?:\\w+:)?' + nome + '>').exec(xml); return m ? m[1].trim() : ''; };

/** Uma NF-e/NFC-e ({ chave, modelo, serie, numero, valor }) ou um evento de cancelamento ({ cancela: chave }). */
function lerXml(xml) {
  if (/<(?:\w+:)?tpEvento>110111</.test(xml)) return { cancela: tag(xml, 'chNFe') };
  const id = /Id="NFe(\d{44})"/.exec(xml);
  if (!id) return null;
  return { chave: id[1], modelo: tag(xml, 'mod'), serie: tag(xml, 'serie'), numero: Number(tag(xml, 'nNF')) || 0, valor: Number(tag(xml, 'vNF')) || 0 };
}

function periodo(competencia) {
  const [a, m] = competencia.split('-').map(Number);
  const fim = new Date(a, m, 0).getDate();
  return { DataEmissaoInicio: competencia + '-01', DataEmissaoFim: competencia + '-' + String(fim).padStart(2, '0') + 'T23:59:59.999' };
}

/** As contagens do mês: emitidas (o cliente emitiu) e recebidas (o cliente é o destinatário), por tipo. */
async function contagemDoMes(c, cnpj, competencia, aoAndar) {
  const p = periodo(competencia);
  const norm = r => ({ NFe: Number(r.NFe) || 0, NFCe: Number(r.NFCe) || 0, NFSe: Number(r.NFSe) || 0, CTe: Number(r.CTe) || 0, CFe: Number(r.CFe) || 0 });
  if (aoAndar) await aoAndar('emitidas');
  const emitidas = norm(await chamar(c, 'contar-xmls', Object.assign({ CnpjEmit: cnpj }, p)));
  if (aoAndar) await aoAndar('recebidas');
  const recebidas = norm(await chamar(c, 'contar-xmls', Object.assign({ CnpjDest: cnpj }, p)));
  return { emitidas, recebidas };
}

/**
 * Todos os XMLs do mês (nads, 07/10/2026: "importar os XML direto do SIEG"): emitidos (NF-e, NFC-e, CT-e, NFS-e) e recebidos
 * (NF-e, CT-e, NFS-e), com os eventos. Devolve os arquivos (nome e conteúdo) e o resumo de cada nota (o que vai para o banco).
 */
async function xmlsDoMes(c, doc, competencia, aoAndar) {
  const p = periodo(competencia);
  const grupos = [
    ['emitidas', 'CnpjEmit', [['NF-e', TIPO.NFe], ['NFC-e', TIPO.NFCe], ['CT-e', TIPO.CTe], ['NFS-e', TIPO.NFSe]]],
    ['recebidas', 'CnpjDest', [['NF-e', TIPO.NFe], ['CT-e', TIPO.CTe], ['NFS-e', TIPO.NFSe]]],
  ];
  const arquivos = new Map();
  const resumo = { emitidas: [], recebidas: [] };
  const canceladas = new Set();
  for (const [grupo, campo, tipos] of grupos) {
    for (const [nome, tipo] of tipos) {
      for (let skip = 0; skip < 50000; skip += 50) {
        if (aoAndar) await aoAndar((grupo === 'emitidas' ? 'Emitidas' : 'Recebidas') + ' · ' + nome + ' (' + arquivos.size + ' XMLs até agora)');
        // a NFS-e só aceita dia/mês/ano, sem a hora ("Certifique-se de apenas passar dia/mês/ano em NFSe", 07/10/2026)
        const datas = tipo === TIPO.NFSe ? { DataEmissaoInicio: p.DataEmissaoInicio, DataEmissaoFim: p.DataEmissaoFim.slice(0, 10) } : p;
        const xmls = xmlsDaResposta(await chamar(c, 'baixar-xmls', Object.assign({ TipoXml: tipo, Take: 50, Skip: skip, [campo]: doc, BaixarEventos: true }, datas)));
        let notasNaPagina = 0;
        for (const x of xmls) {
          arquivos.set(sx.nomeDoArquivo(x), x);
          const r = sx.resumoDaNota(x);
          if (!r) continue;
          if (r.cancela) { canceladas.add(r.cancela); continue; }
          notasNaPagina++;
          resumo[grupo].push(r);
        }
        if (notasNaPagina < 50) break;
      }
    }
  }
  for (const g of ['emitidas', 'recebidas']) for (const n of resumo[g]) if (n.chave && canceladas.has(n.chave)) n.cancelada = true;
  return { arquivos: [...arquivos].map(([nome, xml]) => ({ nome, xml })), resumo };
}

/** Grava um arquivo sem duplicar: o mesmo nome e o mesmo conteúdo já estão lá = não grava. Devolve se gravou. */
function gravarSeNovo(pasta, nome, texto) {
  const destino = path.join(pasta, nome);
  try { if (fs.readFileSync(destino, 'utf8') === texto) return false; } catch (e) { /* ainda não existe */ }
  fs.writeFileSync(destino, texto);
  return true;
}

/** O resumo para o banco, cabendo num documento (até ~900 KB): se passar, sai o detalhe dos itens (fica o resto da nota). */
function resumoQueCabe(doc) {
  if (Buffer.byteLength(JSON.stringify(doc)) < 900000) return doc;
  const sem = n => { const x = Object.assign({}, n); delete x.itens; return x; };
  return Object.assign({}, doc, { emitidas: doc.emitidas.map(sem), recebidas: doc.recebidas.map(sem), itensCortados: true });
}

/** As saídas do mês (NF-e e NFC-e emitidas), com os cancelamentos: os números por modelo e série. */
async function saidasDoMes(c, cnpj, competencia, aoAndar) {
  const p = periodo(competencia);
  const notas = new Map();
  const canceladas = new Set();
  for (const [nome, tipo] of [['NF-e', TIPO.NFe], ['NFC-e', TIPO.NFCe]]) {
    for (let skip = 0; skip < 50000; skip += 50) {
      const resp = await chamar(c, 'baixar-xmls', Object.assign({ TipoXml: tipo, Take: 50, Skip: skip, CnpjEmit: cnpj, BaixarEventos: true }, p));
      const xmls = xmlsDaResposta(resp);
      let notasNaPagina = 0;
      for (const x of xmls) {
        const n = lerXml(x);
        if (!n) continue;
        if (n.cancela) canceladas.add(n.cancela);
        else { notas.set(n.chave, n); notasNaPagina++; }
      }
      if (aoAndar) aoAndar(nome + ': ' + notas.size + ' notas');
      if (notasNaPagina < 50) break;
    }
  }
  const series = new Map();
  for (const n of notas.values()) {
    const k = n.modelo + '|' + n.serie;
    const s = series.get(k) || { modelo: n.modelo, serie: n.serie, numeros: [], canceladas: [], valor: 0 };
    s.numeros.push(n.numero);
    if (canceladas.has(n.chave)) s.canceladas.push(n.numero);
    else s.valor += n.valor;
    series.set(k, s);
  }
  return [...series.values()].map(s => ({ ...s, numeros: s.numeros.sort((a, b) => a - b), canceladas: s.canceladas.sort((a, b) => a - b), valor: Math.round(s.valor * 100) / 100 }));
}

const competenciaDe = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

function iniciarSieg({ db, log }) {
  const estadoRef = db.collection('robo').doc('sieg');
  const { c, faltam } = lerCredenciais();
  if (faltam.length) {
    log('SIEG desligado: falta ' + faltam.join(', ') + ' em scripts/sieg_credenciais.json');
    estadoRef.set({ em: new Date().toISOString(), ligado: false, motivo: 'falta ' + faltam.join(', ') }, { merge: true }).catch(() => {});
    return () => {};
  }
  let situacao = 'livre';
  const ponto = () => estadoRef.set({ em: new Date().toISOString(), ligado: true, motivo: null, situacao }, { merge: true }).catch(() => {});
  ponto();
  const relogio = setInterval(ponto, 60 * 1000);

  // uma coisa por vez (o limite é por API Key): os pedidos do nads passam na frente da contagem da noite
  let ocupado = false;
  async function atenderPedidos() {
    if (ocupado) return;
    ocupado = true;
    try {
      const snap = await db.collection('pedidosSieg').where('status', '==', 'pendente').limit(5).get();
      for (const d of snap.docs) {
        const p = d.data();
        const id = soDigitos(p.codigo) + '_' + p.competencia;
        situacao = 'baixando as saídas de ' + p.codigo;
        await d.ref.update({ status: 'processando', processandoEm: new Date().toISOString() });
        try {
          // o nads conhece a empresa pelo código: o CNPJ vem do cadastro de clientes
          let cnpj = soDigitos(p.cnpj);
          if (!documentoValido(cnpj)) {
            const lista = [];
            (await require('./clientes-cache').clientesAtivos(db)).forEach(x => lista.push(x.data()));
            const cli = lista.find(x => codigoDe(x) === soDigitos(p.codigo));
            cnpj = soDigitos(cli && cli.documento);
            if (!documentoValido(cnpj)) throw new Error('o cliente ' + p.codigo + ' não tem CNPJ nem CPF no cadastro');
          }
          // "Baixar XMLs do SIEG" (07/10/2026): todos os XMLs do mês na pasta do cliente (Drive deste PC) e o resumo no banco
          if (p.tipo === 'xmls') {
            situacao = 'baixando os XMLs de ' + p.codigo;
            const lista = [];
            (await require('./clientes-cache').clientesAtivos(db)).forEach(x => lista.push(x.data()));
            const cli = lista.find(x => codigoDe(x) === soDigitos(p.codigo));
            if (!cli) throw new Error('o cliente ' + p.codigo + ' não está no cadastro');
            if (!fs.existsSync(PASTA_DO_DRIVE)) throw new Error('a pasta do Drive deste PC não está em ' + PASTA_DO_DRIVE);
            await d.ref.update({ andamento: 'Baixando do SIEG' });
            const { arquivos, resumo } = await xmlsDoMes(c, cnpj, p.competencia, t => d.ref.update({ andamento: t }).catch(() => {}));
            await d.ref.update({ andamento: 'Salvando ' + arquivos.length + ' XMLs no Drive' });
            const nomeDaPasta = (cli.nome || 'cliente ' + p.codigo).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
            const pasta = path.join(PASTA_DO_DRIVE, p.competencia, nomeDaPasta);
            fs.mkdirSync(pasta, { recursive: true });
            let novos = 0;
            for (const a of arquivos) if (gravarSeNovo(pasta, a.nome, a.xml)) novos++;
            // e um .zip com todos, na mesma pasta (07/10/2026: "quero que ele também salve um arquivo .zip na hora")
            const nomeDoZip = 'SIEG ' + p.competencia + ' - ' + nomeDaPasta + '.zip';
            if (arquivos.length) fs.writeFileSync(path.join(pasta, nomeDoZip), sx.zipDe(arquivos));
            const onde = 'Claudio Secretario/' + p.competencia + '/' + nomeDaPasta;
            await db.collection('siegNotas').doc(id).set(resumoQueCabe({
              codigo: soDigitos(p.codigo), competencia: p.competencia, em: new Date().toISOString(), pasta: onde, zip: arquivos.length ? nomeDoZip : '', arquivos: arquivos.length, novos,
              emitidas: resumo.emitidas, recebidas: resumo.recebidas,
            }));
            await d.ref.update({
              status: 'concluido', concluidoEm: new Date().toISOString(), andamento: '',
              resultado: { arquivos: arquivos.length, novos, pasta: onde, zip: arquivos.length ? nomeDoZip : '', emitidas: resumo.emitidas.length, recebidas: resumo.recebidas.length },
            });
            log('SIEG: XMLs de', p.codigo, p.competencia, '-', arquivos.length, 'arquivos (' + novos + ' novos) em', onde);
            continue;
          }
          // o "Contar agora" do nads (07/10/2026): só a contagem desta empresa e mês, sem esperar a madrugada
          if (p.tipo === 'contagem') {
            situacao = 'contando ' + p.codigo + ' (pedido)';
            await d.ref.update({ andamento: 'emitidas' });
            const r = await contagemDoMes(c, cnpj, p.competencia, t => d.ref.update({ andamento: t }).catch(() => {}));
            await db.collection('siegContagens').doc(id).set({ codigo: soDigitos(p.codigo), cnpj, competencia: p.competencia, em: new Date().toISOString(), ...r });
            await d.ref.update({ status: 'concluido', concluidoEm: new Date().toISOString() });
            log('SIEG: contagem de', p.codigo, p.competencia, 'pedida pelo nads');
            continue;
          }
          const series = await saidasDoMes(c, cnpj, p.competencia, t => d.ref.update({ andamento: t }).catch(() => {}));
          await db.collection('siegSaidas').doc(id).set({ codigo: String(p.codigo), cnpj, competencia: p.competencia, em: new Date().toISOString(), series });
          await d.ref.update({ status: 'concluido', concluidoEm: new Date().toISOString() });
          log('SIEG: saídas de', p.codigo, p.competencia, '-', series.reduce((s, x) => s + x.numeros.length, 0), 'notas');
        } catch (err) {
          await d.ref.update({ status: 'erro', erro: err.message, erroEm: new Date().toISOString() });
          log('SIEG: erro', p.tipo === 'contagem' ? 'na contagem de' : p.tipo === 'xmls' ? 'nos XMLs de' : 'nas saídas de', p.codigo, '-', err.message);
        }
      }
    } catch (err) { log('SIEG: não consegui ler os pedidos -', err.message); }
    finally { situacao = 'livre'; ocupado = false; }
  }
  const pararPedidos = db.collection('pedidosSieg').where('status', '==', 'pendente').onSnapshot(s => { if (!s.empty) atenderPedidos(); }, err => log('SIEG: pedidos -', err.message));

  // a contagem da madrugada (entre 1h e 5h, uma vez por dia): o mês atual e, até o dia 10, o anterior também
  let contouEm = '';
  async function contarTodos() {
    const hoje = new Date();
    const dia = hoje.toISOString().slice(0, 10);
    if (ocupado || contouEm === dia || hoje.getHours() < 1 || hoje.getHours() >= 5) return;
    ocupado = true;
    contouEm = dia;
    try {
      const comps = [competenciaDe(hoje)];
      if (hoje.getDate() <= 10) comps.push(competenciaDe(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)));
      const ativos = [];
      (await require('./clientes-cache').clientesAtivos(db)).forEach(d => ativos.push(d.data()));
      const comCnpj = ativos.filter(x => documentoValido(soDigitos(x.documento)) && codigoDe(x));
      log('SIEG: contando as notas de', comCnpj.length, 'clientes em', comps.join(' e '));
      for (const comp of comps) {
        for (const cli of comCnpj) {
          situacao = 'contando ' + codigoDe(cli) + ' (' + comp + ')';
          try {
            const r = await contagemDoMes(c, soDigitos(cli.documento), comp);
            await db.collection('siegContagens').doc(codigoDe(cli) + '_' + comp).set({ codigo: codigoDe(cli), cnpj: soDigitos(cli.documento), competencia: comp, em: new Date().toISOString(), ...r });
          } catch (err) { log('SIEG: contagem de', codigoDe(cli), '-', err.message); }
        }
      }
      log('SIEG: contagem da noite pronta');
    } catch (err) { log('SIEG: contagem da noite falhou -', err.message); }
    finally { situacao = 'livre'; ocupado = false; }
  }
  const relogioNoite = setInterval(() => { contarTodos(); if (!ocupado) atenderPedidos(); }, 10 * 60 * 1000);
  log('SIEG ligado: contagem da madrugada e os pedidos do nads');
  return () => { clearInterval(relogio); clearInterval(relogioNoite); pararPedidos(); };
}

module.exports = { iniciarSieg, lerXml, xmlsDaResposta, lerZip, periodo, contagemDoMes, saidasDoMes, xmlsDoMes, resumoQueCabe };
