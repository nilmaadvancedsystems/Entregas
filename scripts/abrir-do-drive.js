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
const { getStorage } = require('firebase-admin/storage');
const { ouvir } = require('./ouvinte');
const indice = require('./drive-indice');

const BUCKET = process.env.BUCKET_ABERTOS || 'entregas-2e5e2-abertos';
const COPIA_DURA_MS = 30 * 60 * 1000;
const TAMANHO_MAXIMO = 60 * 1024 * 1024;   // arquivo maior que isso: abrir pelo Drive mesmo
const PEDIDO_DURA_MS = 2 * 24 * 36e5;

// Documento do Google (planilha, texto) não tem arquivo pra baixar: exporta em PDF.
const EXPORTAR = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

function iniciarAberturaDoDrive(db, log) {
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
    const ref = doc.ref;
    try {
      await ref.update({ status: 'buscando', buscandoEm: new Date().toISOString() });
      const fileId = String(p.fileId || '');
      if (!/^[\w-]{10,}$/.test(fileId)) throw new Error('arquivo inválido');

      // Reaproveita a cópia ainda viva (mesmo arquivo aberto de novo).
      const viva = copias.get(fileId);
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
          // "inline": PDF e imagem abrem no navegador em vez de baixar.
          contentDisposition: 'inline; filename*=UTF-8\'\'' + encodeURIComponent(nome),
          cacheControl: 'private, max-age=1800',
          metadata: { firebaseStorageDownloadTokens: chave, fileId },
        },
      });
      const url = 'https://firebasestorage.googleapis.com/v0/b/' + BUCKET + '/o/' + encodeURIComponent(caminho) + '?alt=media&token=' + chave;
      const ate = Date.now() + COPIA_DURA_MS;
      copias.set(fileId, { url, caminho, ate, nome, tamanho: corpo.length });
      await ref.update({ status: 'pronto', url, nome, tamanho: corpo.length, validoAte: new Date(ate).toISOString(), prontoEm: new Date().toISOString() });
      log('abrir do Drive:', nome, '(' + Math.round(corpo.length / 1024) + ' KB) para', p.criadoPor || 'alguém');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      await ref.update({ status: 'erro', erro: msg, erroEm: new Date().toISOString() }).catch(() => {});
      log('abrir do Drive falhou:', msg);
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

  const fila = [];
  let ocupado = false;
  async function andar() {
    if (ocupado) return;
    ocupado = true;
    try { while (fila.length) await atender(fila.shift()); } finally { ocupado = false; }
  }
  ouvir('aberturas do Drive', () => pedidos.where('status', '==', 'pendente'), snap => {
    snap.docChanges().forEach(ch => { if (ch.type === 'added') fila.push(ch.doc); });
    andar();
  }, log);
  setInterval(limpar, 5 * 60 * 1000);
  log('abrir do Drive pelo app ligado (cópia dura ' + Math.round(COPIA_DURA_MS / 60000) + ' min)');
}

module.exports = { iniciarAberturaDoDrive };
