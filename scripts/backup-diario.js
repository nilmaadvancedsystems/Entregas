// Backup de todo dia, disparado pelo vigia do robô.
//
// O backup-firestore.js já existia e já é seguro (só lê o banco, nunca apaga
// nada, pula se o retrato de hoje já existe), mas dependia de alguém lembrar
// de rodar. Aqui o PC do robô roda sozinho, uma vez por dia a partir do
// meio-dia, e deixa em robo/estado.backup quando foi e se deu certo — é o
// que a tela de funções usa pra avisar quando o backup está atrasado.
//
// Depois de um backup-firestore.js bom, roda o backup-planilha.js em cima do
// MESMO arquivo que acabou de ser escrito — sem ler o Firestore de novo, sem
// gastar cota — e deixa uma planilha .xlsx (Clientes, Documentos Mensais,
// Entregas) na mesma pasta, ordenada por empresa.
const path = require('path');
const { spawn } = require('child_process');

// Entre 12h e 20h: nesse intervalo a data daqui e a data UTC (que o
// backup-firestore.js usa no nome do arquivo) são a mesma. Rodando depois das
// 21h o arquivo saía com a data de amanhã, e o backup de amanhã respondia "já
// existe" sem ter lido nada.
const HORA_MINIMA = 12;
const HORA_MAXIMA = 20;
const MAX_TENTATIVAS = 2;     // o backup lê o banco inteiro: falhou duas vezes, fica pra amanhã
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

function rodarPlanilha() {
  return new Promise(resolve => {
    const linhas = [];
    const filho = spawn(process.execPath, [path.join(__dirname, 'backup-planilha.js')], { cwd: __dirname });
    const guardar = b => String(b).split(/\r?\n/).filter(Boolean).forEach(l => linhas.push(l));
    filho.stdout.on('data', guardar);
    filho.stderr.on('data', guardar);
    filho.on('error', err => resolve({ ok: false, resumo: err.message }));
    filho.on('close', code => resolve({ ok: code === 0, resumo: linhas.slice(-2).join(' | ') }));
  });
}

function iniciarBackupDiario(db, log) {
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false;
  let feitoNoDia = '', tentativasNoDia = 0, diaDasTentativas = '';
  async function talvez() {
    const hora = new Date().getHours();
    if (rodando || hora < HORA_MINIMA || hora >= HORA_MAXIMA || feitoNoDia === hojeIso()) return;
    if (diaDasTentativas !== hojeIso()) { diaDasTentativas = hojeIso(); tentativasNoDia = 0; }
    if (tentativasNoDia >= MAX_TENTATIVAS) return;
    rodando = true;
    try {
      const estado = (await estadoRef.get()).data() || {};
      if (estado.backup && estado.backup.dia === hojeIso() && estado.backup.ok) { feitoNoDia = hojeIso(); return; }
      tentativasNoDia++;
      log('backup do dia: começando');
      const r = await rodarBackup();
      // "em" só anda quando deu certo: é a data do último backup BOM
      const patch = { dia: hojeIso(), ok: r.ok, resumo: r.resumo, tentadoEm: new Date().toISOString() };
      if (r.ok) patch.em = patch.tentadoEm;
      await estadoRef.set({ backup: patch }, { merge: true });
      if (r.ok) feitoNoDia = hojeIso();
      log('backup do dia:', r.ok ? 'ok' : 'FALHOU', '-', r.resumo);
      if (r.ok) {
        // Não lê o banco de novo: monta a planilha em cima do arquivo que
        // acabou de sair do forno. Se falhar, o backup em si já está salvo
        // e seguro — só a planilha (um extra) que fica pra próxima.
        const p = await rodarPlanilha();
        log('planilha do backup:', p.ok ? 'ok' : 'falhou', '-', p.resumo);
      }
    } catch (err) {
      log('backup do dia falhou:', err.message);
    } finally { rodando = false; }
  }
  setTimeout(talvez, 10 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('backup diário ligado (uma vez por dia, entre ' + HORA_MINIMA + 'h e ' + HORA_MAXIMA + 'h)');
}

module.exports = { iniciarBackupDiario };
