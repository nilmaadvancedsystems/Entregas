// Backup de todo dia, disparado pelo vigia do robô.
//
// O backup-firestore.js já existia e já é seguro (só lê o banco, nunca apaga
// nada, pula se o retrato de hoje já existe), mas dependia de alguém lembrar
// de rodar. Aqui o PC do robô roda sozinho, uma vez por dia a partir do
// meio-dia, e deixa em robo/estado.backup quando foi e se deu certo — é o
// que a tela de funções usa pra avisar quando o backup está atrasado.
const path = require('path');
const { spawn } = require('child_process');

const HORA_MINIMA = 12;
const hojeIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function rodarBackup() {
  return new Promise(resolve => {
    const linhas = [];
    const filho = spawn(process.execPath, [path.join(__dirname, 'backup-firestore.js')], { cwd: __dirname });
    const guardar = b => String(b).split(/\r?\n/).filter(Boolean).forEach(l => { linhas.push(l); if (linhas.length > 12) linhas.shift(); });
    filho.stdout.on('data', guardar);
    filho.stderr.on('data', guardar);
    filho.on('error', err => resolve({ ok: false, resumo: err.message }));
    filho.on('close', code => {
      const ok = code === 0;
      const util = linhas.filter(l => /^OK:|documentos:|ja existe|ERRO/.test(l)).join(' | ') || linhas.slice(-1)[0] || '';
      resolve({ ok, resumo: util.slice(0, 300) });
    });
  });
}

function iniciarBackupDiario(db, log) {
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false;
  async function talvez() {
    if (rodando || new Date().getHours() < HORA_MINIMA) return;
    rodando = true;
    try {
      const estado = (await estadoRef.get()).data() || {};
      if (estado.backup && estado.backup.dia === hojeIso() && estado.backup.ok) return;
      log('backup do dia: começando');
      const r = await rodarBackup();
      // "em" só anda quando deu certo: é a data do último backup BOM
      const patch = { dia: hojeIso(), ok: r.ok, resumo: r.resumo, tentadoEm: new Date().toISOString() };
      if (r.ok) patch.em = patch.tentadoEm;
      await estadoRef.set({ backup: patch }, { merge: true });
      log('backup do dia:', r.ok ? 'ok' : 'FALHOU', '-', r.resumo);
    } catch (err) {
      log('backup do dia falhou:', err.message);
    } finally { rodando = false; }
  }
  setTimeout(talvez, 10 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('backup diário ligado (uma vez por dia, a partir das ' + HORA_MINIMA + 'h)');
}

module.exports = { iniciarBackupDiario };
