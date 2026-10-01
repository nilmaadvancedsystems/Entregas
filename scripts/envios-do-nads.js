// Arquivo mandado pelo nads (Tarefas › Drive › "Enviar para o Claudio Secretário") para a pasta
// Claudio Secretario, de onde a rotina de arquivamento (a do PC, /organizar) tira na próxima rodada.
//
// A tela cria enviosSecretario/{id} ({ status: 'enviando', nome, tamanho, partes, competencia, cliente,
// codigo, criadoPor, criadoPorUid }), sobe o arquivo em pedaços (partes/{n} { dados: bytes }) e passa
// o envio para 'pendente'. Este módulo, no vigia:
//   1. junta os pedaços e confere o tamanho;
//   2. grava em Claudio Secretario/<competencia>/<cliente> — o nome do cliente vem do cadastro pelo
//      código ("58" -> clientes.codigoOrigem), senão o que a tela mandou, senão "Enviados pelo nads" —,
//      na mesma pasta onde o robô do Gmail guarda (pela API na nuvem, em disco no PC);
//   3. apaga os pedaços (o arquivo não fica no banco) e responde no envio ('pronto', pasta, nomeFinal).
// Nunca apaga nem sobrescreve nada no Drive: nome repetido com conteúdo diferente vira "nome (2).pdf" e
// o mesmo arquivo de novo não é gravado duas vezes (salvarArquivo).
const fs = require('fs');
const path = require('path');
const { ouvir } = require('./ouvinte');
const baixar = require('./download-attachments');
const USAR_DRIVE_API = process.env.USAR_DRIVE_API === '1';
const driveArquivos = USAR_DRIVE_API ? require('./drive-arquivos.js') : null;

const PASTA_SEM_CLIENTE = 'Enviados pelo nads';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PARTES = 30;
// envio que ficou pela metade (a pessoa fechou a tela no meio) e resposta velha: some do banco
const ABANDONADO_MS = 2 * 36e5;
// a resposta (sem os pedaços, que já foram apagados) fica 30 dias: a tela mostra onde o arquivo foi parar
const RESPOSTA_DURA_MS = 30 * 24 * 36e5;
const ESPERA_MS = 15 * 60 * 1000;

// Confere o envio e junta os pedaços. Devolve { erro } ou { buffer, nome, competencia }.
function montarEnvio(envio, pedacos) {
  if (!envio || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(envio.competencia || '')) return { erro: 'competência inválida' };
  const n = Number(envio.partes);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTES) return { erro: 'quantidade de partes inválida' };
  if (pedacos.length !== n) return { erro: 'faltam partes do arquivo (' + pedacos.length + ' de ' + n + ')' };
  const ordenados = pedacos.slice().sort((a, b) => a.n - b.n);
  if (ordenados.some((p, i) => p.n !== i)) return { erro: 'partes fora de ordem' };
  const buffer = Buffer.concat(ordenados.map(p => Buffer.from(p.dados || [])));
  if (!buffer.length || buffer.length > MAX_BYTES) return { erro: 'tamanho fora do limite' };
  if (buffer.length !== Number(envio.tamanho)) return { erro: 'o arquivo chegou incompleto' };
  const nome = String(envio.nome || '').split(/[\\/]/).pop().trim() || 'arquivo';
  return { buffer, nome, competencia: envio.competencia };
}

// A pasta do cliente dentro do mês: o nome do cadastro (pelo código), o que veio, ou "Enviados pelo nads".
function nomeDaPastaDoCliente(envio, porCodigo) {
  const doCadastro = envio.codigo ? porCodigo.get(String(envio.codigo).trim()) : null;
  return (doCadastro && doCadastro.nome) || String(envio.cliente || '').trim() || PASTA_SEM_CLIENTE;
}

async function clientesPorCodigo(db) {
  const m = new Map();
  try {
    (await require('./clientes-cache').clientesAtivos(db)).forEach(d => {
      const c = d.data();
      if (c.codigoOrigem != null) m.set(String(c.codigoOrigem).trim(), Object.assign({ id: d.id }, c));
    });
  } catch (e) { /* sem o cadastro: fica o nome que veio da tela */ }
  return m;
}

function iniciarEnviosDoNads(db, log) {
  const envios = db.collection('enviosSecretario');
  const tratando = new Set();

  async function apagarPartes(ref) {
    const ps = await ref.collection('partes').get();
    await Promise.all(ps.docs.map(d => d.ref.delete()));
  }

  async function tratar(doc) {
    if (tratando.has(doc.id)) return;
    tratando.add(doc.id);
    const envio = doc.data();
    try {
      await doc.ref.update({ status: 'gravando', gravandoEm: new Date().toISOString() });
      const ps = await doc.ref.collection('partes').get();
      const c = montarEnvio(envio, ps.docs.map(d => ({ n: Number(d.id), dados: d.get('dados') })));
      if (c.erro) {
        await apagarPartes(doc.ref);
        await doc.ref.update({ status: 'erro', erro: c.erro, prontoEm: new Date().toISOString() });
        log('envio pelo nads recusado (' + c.erro + '):', envio.nome);
        return;
      }
      const cliente = nomeDaPastaDoCliente(envio, await clientesPorCodigo(db));
      let nomeFinal;
      if (USAR_DRIVE_API) {
        const drive = driveArquivos.getDrive();
        const pastaId = await driveArquivos.pastaDoCliente(drive, c.competencia, cliente);
        nomeFinal = await driveArquivos.salvarArquivo(drive, pastaId, c.nome, c.buffer);
      } else {
        const pasta = path.join(baixar.PASTA_DESTINO, c.competencia, baixar.sanitizar(cliente));
        fs.mkdirSync(pasta, { recursive: true });           // G: fora do ar dá erro aqui e o envio espera
        const destino = baixar.salvarArquivo(pasta, c.nome, c.buffer);
        nomeFinal = destino ? path.basename(destino) : null;
      }
      const pasta = c.competencia + '/' + baixar.sanitizar(cliente);
      await apagarPartes(doc.ref);
      await doc.ref.update({
        status: 'pronto', pasta, nomeFinal: nomeFinal || c.nome, jaEstava: !nomeFinal, prontoEm: new Date().toISOString(),
      });
      log('enviado pelo nads (' + (envio.criadoPor || '?') + '):', c.nome, '->', 'Claudio Secretario/' + pasta + (nomeFinal ? '' : ' (já estava lá)'));
    } catch (err) {
      // Drive fora do ar: fica 'gravando' e a limpeza devolve para a fila (sem ficar tentando sem parar)
      log('envio pelo nads ficou esperando:', err.message);
      try { await doc.ref.update({ esperando: err.message, gravandoEm: new Date().toISOString() }); } catch (e) { /* a limpeza acha */ }
    } finally { tratando.delete(doc.id); }
  }

  ouvir('envios do nads', () => envios.where('status', '==', 'pendente').limit(5), snap => {
    snap.docs.forEach(d => { tratar(d); });
  }, log);

  // limpeza: envio abandonado no meio (com os pedaços) e respostas velhas
  async function limpar() {
    try {
      const agora = Date.now();
      const velhos = await envios.where('criadoEm', '<', new Date(agora - ABANDONADO_MS).toISOString()).limit(50).get();
      for (const d of velhos.docs) {
        const e = d.data();
        const fim = e.status === 'pronto' || e.status === 'erro';
        if (e.status === 'enviando' || (fim && Date.parse(e.prontoEm || e.criadoEm) < agora - RESPOSTA_DURA_MS)) {
          await apagarPartes(d.ref);
          await d.ref.delete();
        }
      }
      // o que ficou esperando (Drive fora do ar, robô reiniciou no meio) volta para a fila
      const parados = await envios.where('status', '==', 'gravando').limit(20).get();
      for (const d of parados.docs) {
        if (tratando.has(d.id) || Date.parse(d.get('gravandoEm') || 0) > agora - ESPERA_MS) continue;
        await d.ref.update({ status: 'pendente' });
      }
    } catch (e) { log('limpeza dos envios do nads:', e.message); }
  }
  setInterval(limpar, 15 * 60 * 1000);
  setTimeout(limpar, 60 * 1000);
  log('arquivos enviados pelo nads para o Claudio Secretario: ligado');
}

// ---------- onde o arquivo foi parar (01/10/2026) ----------
// Depois de cada rodada do arquivamento (arquivador.js publica arquivamentos/{EXEC-…} e detalhe/tudo), os envios
// prontos que ainda não sabem o destino são procurados pelo nome com que ficaram no Claudio Secretario (nomeFinal):
// em detalhe.arquivos (arquivado: código, cliente, subpasta e o nome final), em detalhe.naoIdentificados, ou como
// DUPLICADO no relatório. O manifesto não guarda a pasta de origem, então o casamento é pelo nome e pelo código.
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** O destino do envio numa rodada (ou null quando a rodada não fala dele). */
function destinoNoArquivamento(envio, run, detalhe) {
  const nome = semAcento(envio.nomeFinal);
  if (!nome || !detalhe) return null;
  const doCodigo = a => !envio.codigo || !a.codigo || String(a.codigo) === String(envio.codigo);
  const arq = (detalhe.arquivos || []).find(a => semAcento(a.original) === nome && doCodigo(a));
  if (arq) {
    return { situacao: 'arquivado', em: run.em || '', execucao: run.id || '', codigo: String(arq.codigo || ''), cliente: String(arq.cliente || ''),
      subpasta: String(arq.subpasta || ''), final: String(arq.final || arq.original || '') };
  }
  const nao = (detalhe.naoIdentificados || []).find(n => semAcento(n.nome).endsWith(nome));
  if (nao) return { situacao: 'nao_identificado', em: run.em || '', execucao: run.id || '', motivo: String(nao.motivo || '') };
  const linha = String(detalhe.relatorio || '').split(/\r?\n/).find(l => /^\s*DUPLICADO:/.test(l) && semAcento(l).includes(nome));
  if (linha) return { situacao: 'duplicado', em: run.em || '', execucao: run.id || '', motivo: linha.replace(/^\s*DUPLICADO:\s*/, '').slice(0, 300) };
  return null;
}

function iniciarDestinoDosEnvios(db, log) {
  const envios = db.collection('enviosSecretario');
  const vistos = new Map();   // rodada -> publicadoEm já conferido
  async function conferir(runs) {
    const prontos = (await envios.where('status', '==', 'pronto').limit(200).get()).docs.filter(d => !d.get('arquivamento'));
    if (!prontos.length) return;
    for (const run of runs.sort((a, b) => String(a.em).localeCompare(String(b.em)))) {
      const aguardando = prontos.filter(d => !d._resolvido && String(d.get('prontoEm') || '') < String(run.em || ''));
      if (!aguardando.length) continue;
      const det = (await db.collection('arquivamentos').doc(run.id).collection('detalhe').doc('tudo').get()).data();
      for (const d of aguardando) {
        const destino = destinoNoArquivamento(d.data(), run, det);
        if (!destino) continue;
        d._resolvido = true;
        await d.ref.update({ arquivamento: destino });
        log('envio pelo nads', destino.situacao + ':', d.get('nomeFinal'), destino.subpasta ? '-> ' + destino.codigo + ' - ' + destino.cliente + '/' + destino.subpasta : '');
      }
    }
  }
  ouvir('arquivamentos para os envios', () => db.collection('arquivamentos').orderBy('em', 'desc').limit(5), snap => {
    const runs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
      .filter(r => r.modo === 'PRODUCAO' && vistos.get(r.id) !== r.publicadoEm);
    if (!runs.length) return;
    runs.forEach(r => vistos.set(r.id, r.publicadoEm));
    conferir(runs).catch(err => log('destino dos envios do nads:', err.message));
  }, log);
}

module.exports = { montarEnvio, nomeDaPastaDoCliente, PASTA_SEM_CLIENTE, iniciarEnviosDoNads, destinoNoArquivamento, iniciarDestinoDosEnvios };
