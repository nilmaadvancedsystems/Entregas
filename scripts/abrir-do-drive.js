// Abrir pelo app um arquivo da pasta do ano no Drive, sem dar acesso ao Drive.
//
// A tela grava um pedido em aberturasDrive ({ fileId, status: 'pendente' }).
// O robô da nuvem confere que o arquivo é mesmo da pasta do ano (e não de
// qualquer canto do Drive do escritório), baixa pela API do Drive e põe uma
// cópia num armazenamento temporário (bucket entregas-2e5e2-abertos, nos EUA,
// na faixa gratuita). O pedido volta com um link que tem uma chave aleatória.
//
// A cópia dura pouco: o robô apaga em COPIA_DURA_MS, e o link morre junto. O
// bucket ainda tem uma regra do próprio Google que apaga tudo com mais de 1 dia,
// de segunda proteção. Quem abre só lê a cópia: o Drive não é tocado, nada lá
// pode ser apagado ou alterado por este caminho.
//
// Custo: baixar do Drive é tráfego que ENTRA na máquina (não conta), e a
// cópia vai pro bucket na mesma região (não conta). Quem entrega o arquivo pra
// quem clicou é o bucket, com franquia própria de 100 GB/mês.
const crypto = require('crypto');
const archiver = require('archiver');
const { getStorage } = require('firebase-admin/storage');
const { ouvir } = require('./ouvinte');
const indice = require('./drive-indice');

const BUCKET = process.env.BUCKET_ABERTOS || 'entregas-2e5e2-abertos';
const COPIA_DURA_MS = 30 * 60 * 1000;
const TAMANHO_MAXIMO = 60 * 1024 * 1024;   // arquivo maior que isso: abrir pelo Drive mesmo
const PEDIDO_DURA_MS = 2 * 24 * 36e5;
// Limites do .zip (vários arquivos ou pasta inteira): acima disso, por partes.
const ZIP_MAX_ARQUIVOS = 2000;
const ZIP_MAX_BYTES = 500 * 1024 * 1024;
const PASTA = 'application/vnd.google-apps.folder';

// Documento do Google (planilha, texto) não tem arquivo pra baixar: exporta em PDF.
const EXPORTAR = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

function iniciarAberturaDoDrive(db, log, opcoes) {
  const pedidos = db.collection('aberturasDrive');
  const bucket = getStorage().bucket(BUCKET);
  const pais = new Map();
  const copias = new Map();   // fileId -> { url, caminho, ate, nome, tamanho }
  let raizId = null;

  async function pastaDoAno() {
    if (raizId) return raizId;
    raizId = ((await db.collection('driveIndice').doc('raiz').get()).data() || {}).pastaId || null;
    return raizId;
  }

  async function atender(doc) {
    const p = doc.data();
    if (p.modo === 'zip') return atenderZip(doc);
    const ref = doc.ref;
    // 'abrir' (padrão): PDF e imagem abrem no navegador. 'baixar': o arquivo
    // vem como download — é o que faz o PDF abrir no leitor do computador.
    const baixar = p.modo === 'baixar';
    try {
      await ref.update({ status: 'buscando', buscandoEm: new Date().toISOString() });
      const fileId = String(p.fileId || '');
      if (!/^[\w-]{10,}$/.test(fileId)) throw new Error('arquivo inválido');
      const chaveCopia = fileId + (baixar ? ':baixar' : '');

      // Reaproveita a cópia ainda viva (mesmo arquivo aberto de novo).
      const viva = copias.get(chaveCopia);
      if (viva && viva.ate > Date.now() + 60000) {
        await ref.update({ status: 'pronto', url: viva.url, nome: viva.nome, tamanho: viva.tamanho, validoAte: new Date(viva.ate).toISOString(), prontoEm: new Date().toISOString() });
        return;
      }

      // Só arquivo que está dentro da pasta do ano: o pedido não pode virar um
      // jeito de ler qualquer coisa do Drive do escritório.
      const raiz = await pastaDoAno();
      if (!raiz) throw new Error('o mapa do Drive ainda não foi montado');
      const dono = await indice.pastaDoClienteDe(fileId, raiz, pais);
      if (!dono) throw new Error('este arquivo não está na pasta ' + (process.env.DRIVE_PASTA_ANO || '2026'));

      const drive = indice.getDrive();
      const meta = (await drive.files.get({ fileId, fields: 'id, name, mimeType, size' })).data;
      if (meta.mimeType === 'application/vnd.google-apps.folder') throw new Error('isto é uma pasta, não um arquivo');
      if (meta.size && Number(meta.size) > TAMANHO_MAXIMO) {
        throw new Error('arquivo grande demais pra abrir pelo app (' + Math.round(meta.size / 1048576) + ' MB)');
      }
      let corpo, tipo = meta.mimeType, nome = meta.name;
      if (EXPORTAR[meta.mimeType]) {
        tipo = EXPORTAR[meta.mimeType];
        nome = nome + '.pdf';
        corpo = Buffer.from((await drive.files.export({ fileId, mimeType: tipo }, { responseType: 'arraybuffer' })).data);
      } else if (/^application\/vnd\.google-apps\./.test(meta.mimeType)) {
        throw new Error('este tipo de documento do Google não abre pelo app');
      } else {
        corpo = Buffer.from((await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })).data);
      }

      const chave = crypto.randomUUID();
      const caminho = 'abertos/' + chave + '/' + nome.replace(/[\\/]/g, '_');
      await bucket.file(caminho).save(corpo, {
        contentType: tipo || 'application/octet-stream',
        metadata: {
          // "inline": PDF e imagem abrem no navegador. "attachment": baixa,
          // e o computador abre no programa dele (o leitor de PDF).
          contentDisposition: (baixar ? 'attachment' : 'inline') + '; filename*=UTF-8\'\'' + encodeURIComponent(nome),
          cacheControl: 'private, max-age=1800',
          metadata: { firebaseStorageDownloadTokens: chave, fileId },
        },
      });
      const url = 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/' + encodeURIComponent(caminho) + '?alt=media&token=' + chave;
      const ate = Date.now() + COPIA_DURA_MS;
      copias.set(chaveCopia, { url, caminho, ate, nome, tamanho: corpo.length });
      await ref.update({ status: 'pronto', url, nome, tamanho: corpo.length, validoAte: new Date(ate).toISOString(), prontoEm: new Date().toISOString() });
      log('abrir do Drive:', nome, '(' + Math.round(corpo.length / 1024) + ' KB) para', p.criadoPor || 'alguém');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      await ref.update({ status: 'erro', erro: msg, erroEm: new Date().toISOString() }).catch(() => {});
      log('abrir do Drive falhou:', msg);
    }
  }

  // ---------- vários arquivos, ou uma pasta inteira, num .zip ----------
  // O .zip é montado AOS POUCOS, direto no bucket: um arquivo do Drive por vez
  // entra no .zip e segue pro armazenamento, sem nunca ficar tudo na memória
  // (a máquina tem 1 GB). Mesmas regras do abrir: só o que está dentro da
  // pasta do ano, e a cópia some em COPIA_DURA_MS.
  async function atenderZip(doc) {
    const p = doc.data();
    const ref = doc.ref;
    try {
      await ref.update({ status: 'buscando', buscandoEm: new Date().toISOString(), progresso: 'listando os arquivos' });
      const raiz = await pastaDoAno();
      if (!raiz) throw new Error('o mapa do Drive ainda não foi montado');
      const pedidos = [].concat(Array.isArray(p.fileIds) ? p.fileIds : [], p.pastaId ? [p.pastaId] : [])
        .map(String).filter(id => /^[\w-]{10,}$/.test(id));
      if (!pedidos.length) throw new Error('nenhum arquivo selecionado');
      if (pedidos.length > 500) throw new Error('seleção grande demais (' + pedidos.length + ' itens); baixe por pasta');

      const drive = indice.getDrive();
      const lista = [];     // { id, nome (caminho dentro do .zip), mime, exportar }
      const usados = new Set();
      let total = 0;
      const semNomeRepetido = nome => {
        let final = nome, n = 2;
        while (usados.has(final.toLowerCase())) final = nome.replace(/(\.[^./]+)?$/, ' (' + (n++) + ')$1');
        usados.add(final.toLowerCase());
        return final;
      };
      const limparNome = n => String(n || 'sem nome').replace(/[\\/:*?"<>|]/g, '_').trim() || 'sem nome';

      async function juntar(meta, prefixo) {
        if (meta.mimeType === PASTA) {
          const base = prefixo + limparNome(meta.name) + '/';
          let pageToken;
          do {
            const r = (await drive.files.list({
              q: "'" + meta.id + "' in parents and trashed = false",
              fields: 'nextPageToken, files(id, name, mimeType, size)', pageSize: 1000, pageToken,
            })).data;
            for (const f of r.files || []) await juntar(f, base);
            pageToken = r.nextPageToken;
          } while (pageToken);
          return;
        }
        let nome = limparNome(meta.name), exportar = null;
        if (EXPORTAR[meta.mimeType]) { exportar = EXPORTAR[meta.mimeType]; nome += '.pdf'; }
        else if (/^application\/vnd\.google-apps\./.test(meta.mimeType)) return;   // atalho, formulário...: não tem arquivo
        total += Number(meta.size || 0);
        if (lista.length >= ZIP_MAX_ARQUIVOS) throw new Error('mais de ' + ZIP_MAX_ARQUIVOS + ' arquivos; baixe por partes');
        if (total > ZIP_MAX_BYTES) throw new Error('passa de ' + Math.round(ZIP_MAX_BYTES / 1048576) + ' MB; baixe por partes');
        lista.push({ id: meta.id, nome: semNomeRepetido(prefixo + nome), exportar });
      }

      for (const id of pedidos) {
        // Cada item pedido tem que estar dentro da pasta do ano, e não pode ser
        // a pasta do ano inteira.
        if (id === raiz || !(await indice.pastaDoClienteDe(id, raiz, pais))) {
          throw new Error('um dos itens não está na pasta ' + (process.env.DRIVE_PASTA_ANO || '2026'));
        }
        const meta = (await drive.files.get({ fileId: id, fields: 'id, name, mimeType, size' })).data;
        // Pasta pedida sozinha: o .zip já tem o nome dela, os arquivos vão na raiz dele.
        await juntar(meta, meta.mimeType === PASTA && pedidos.length === 1 ? '\u0000' : '');
      }
      lista.forEach(it => { it.nome = it.nome.replace(/^\u0000[^/]*\//, ''); });
      if (!lista.length) throw new Error('não há arquivos para baixar');

      let nomeZip = limparNome(p.nomeZip || '');
      if (!nomeZip || nomeZip === 'sem nome') nomeZip = 'arquivos-' + new Date().toISOString().slice(0, 10);
      if (!/\.zip$/i.test(nomeZip)) nomeZip += '.zip';

      const chave = crypto.randomUUID();
      const caminho = 'abertos/' + chave + '/' + nomeZip;
      const destino = bucket.file(caminho).createWriteStream({
        contentType: 'application/zip',
        metadata: {
          contentDisposition: 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(nomeZip),
          cacheControl: 'private, max-age=1800',
          metadata: { firebaseStorageDownloadTokens: chave },
        },
      });
      const gravado = new Promise((ok, falha) => { destino.on('finish', ok); destino.on('error', falha); });
      const zip = archiver('zip', { zlib: { level: 6 } });
      let erroZip = null;
      zip.on('error', e => { erroZip = e; });
      zip.pipe(destino);

      let feitos = 0, ultimoAviso = 0;
      for (const it of lista) {
        if (erroZip) throw erroZip;
        const resp = it.exportar
          ? await drive.files.export({ fileId: it.id, mimeType: it.exportar }, { responseType: 'stream' })
          : await drive.files.get({ fileId: it.id, alt: 'media' }, { responseType: 'stream' });
        // um arquivo por vez: espera este entrar no .zip antes de abrir o próximo
        await new Promise((ok, falha) => {
          const pronto = () => { zip.off('error', falha); ok(); };
          zip.once('entry', pronto);
          zip.once('error', falha);
          resp.data.on('error', falha);
          zip.append(resp.data, { name: it.nome });
        });
        feitos++;
        if (Date.now() - ultimoAviso > 3000) {
          ultimoAviso = Date.now();
          ref.update({ progresso: feitos + ' de ' + lista.length + ' arquivos' }).catch(() => {});
        }
      }
      await zip.finalize();
      await gravado;
      const tamanho = zip.pointer();

      const url = 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/' + encodeURIComponent(caminho) + '?alt=media&token=' + chave;
      const ate = Date.now() + COPIA_DURA_MS;
      copias.set('zip:' + chave, { url, caminho, ate, nome: nomeZip, tamanho });
      await ref.update({
        status: 'pronto', url, nome: nomeZip, tamanho, arquivos: lista.length, progresso: null,
        validoAte: new Date(ate).toISOString(), prontoEm: new Date().toISOString(),
      });
      log('baixar do Drive (.zip):', nomeZip, lista.length, 'arquivos,', Math.round(tamanho / 1048576) + ' MB, para', p.criadoPor || 'alguém');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      await ref.update({ status: 'erro', erro: msg, progresso: null, erroEm: new Date().toISOString() }).catch(() => {});
      log('baixar do Drive (.zip) falhou:', msg);
    }
  }

  // Apaga as cópias vencidas (e o link morre) e os pedidos velhos.
  async function limpar() {
    const agora = Date.now();
    for (const [fileId, c] of copias) {
      if (c.ate > agora) continue;
      await bucket.file(c.caminho).delete({ ignoreNotFound: true }).catch(() => {});
      copias.delete(fileId);
    }
    // Cópia que ficou de um robô anterior (reiniciou no meio): pelo horário.
    try {
      const [arquivos] = await bucket.getFiles({ prefix: 'abertos/' });
      for (const f of arquivos) {
        const criado = new Date(f.metadata.timeCreated).getTime();
        if (agora - criado > COPIA_DURA_MS) await f.delete({ ignoreNotFound: true }).catch(() => {});
      }
    } catch (e) { /* segue: a regra de 1 dia do bucket cobre */ }
    try {
      const velhos = await pedidos.where('criadoEm', '<', new Date(agora - PEDIDO_DURA_MS).toISOString()).limit(200).get();
      for (const d of velhos.docs) await d.ref.delete();
    } catch (e) {}
  }

  // Duas filas: um .zip grande leva minutos, e não pode segurar quem só quer
  // abrir um arquivo nesse meio tempo.
  function criarFila() {
    const itens = [];
    let ocupado = false;
    return {
      entrar(doc) { itens.push(doc); this.andar(); },
      async andar() {
        if (ocupado) return;
        ocupado = true;
        try { while (itens.length) await atender(itens.shift()); } finally { ocupado = false; }
      },
    };
  }
  // Teste (scripts de conferência): devolve o atendente sem ligar a fila.
  if (opcoes && opcoes.semFila) return { atender };
  const filaAbrir = criarFila();
  const filaZip = criarFila();
  ouvir('aberturas do Drive', () => pedidos.where('status', '==', 'pendente'), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type !== 'added') return;
      (ch.doc.data().modo === 'zip' ? filaZip : filaAbrir).entrar(ch.doc);
    });
  }, log);
  setInterval(limpar, 5 * 60 * 1000);
  log('abrir do Drive pelo app ligado (cópia dura ' + Math.round(COPIA_DURA_MS / 60000) + ' min)');
}

module.exports = { iniciarAberturaDoDrive };
