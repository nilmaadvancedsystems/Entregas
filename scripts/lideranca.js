// Um vigia só — agora entre máquinas, não só dentro de uma.
//
// A trava de arquivo (vigia.lock) impede dois vigias no MESMO computador. Ela
// não enxerga um vigia rodando em outro lugar: com um robô no PC do escritório
// e outro na nuvem, os dois atenderiam a mesma fila, e o cliente receberia a
// cobrança duas vezes; o resumo das 18h sairia dobrado; o aviso no celular
// também.
//
// Então a vez de mandar mora no banco, em robo/lider, com prazo de validade.
// Quem está com a vez renova a cada RENOVAR_MS. Quem não está espera de
// reserva, sem fazer nada — nem bater ponto, nem ler o Gmail — e tenta de novo
// no mesmo ritmo. Se o titular some (PC desligado, queda de luz, a nuvem
// reiniciando), o prazo vence e o reserva assume sozinho, em até PRAZO_MS.
//
// Quem desliga direito (Ctrl+C, fechar pela bandeja, a nuvem pedindo pra
// parar) devolve a vez na hora, e o reserva assume já na tentativa seguinte.
//
// O prazo é contado no relógio de cada máquina. Computador e servidor acertam
// a hora pela internet, e a folga de 90 s cobre com sobra a diferença entre
// eles. Cada renovação confere, dentro de uma transação, que a vez ainda é
// sua; e quem não consegue renovar para sozinho antes do prazo vencer, pra
// não seguir trabalhando depois que o reserva já assumiu.
const os = require('os');
const crypto = require('crypto');

const PRAZO_MS = 90 * 1000;
const RENOVAR_MS = 30 * 1000;

// Uma identidade por processo: duas partidas seguidas na mesma máquina são
// vigias diferentes, e o novo não pode achar que a vez do antigo é dele.
const EU = {
  id: crypto.randomBytes(8).toString('hex'),
  maquina: process.env.ROBO_NOME || os.hostname(),
  pid: process.pid,
};

function refDoLider(db) {
  // LIDER_DOC só existe pra teste: ensaiar a troca sem mexer na vez de verdade.
  return db.collection('robo').doc(process.env.LIDER_DOC || 'lider');
}

// Pega a vez se estiver livre (ou vencida, ou já for minha). Devolve quem
// está com ela depois da tentativa.
async function tentarAssumir(db) {
  const ref = refDoLider(db);
  return db.runTransaction(async t => {
    const snap = await t.get(ref);
    const atual = snap.exists ? snap.data() : null;
    const agora = Date.now();
    const livre = !atual || atual.id === EU.id || !atual.ate || atual.ate < agora;
    if (!livre) return { minha: false, dono: atual };
    const novo = Object.assign({}, EU, {
      ate: agora + PRAZO_MS,
      renovadoEm: new Date(agora).toISOString(),
      desde: atual && atual.id === EU.id ? atual.desde : new Date(agora).toISOString(),
    });
    t.set(ref, novo);
    return { minha: true, dono: novo };
  });
}

function descrever(dono) {
  if (!dono) return 'ninguém';
  return dono.maquina + ' (processo ' + dono.pid + ')';
}

// Espera, de reserva, até ser a vez deste vigia. Só resolve quando a vez for
// dele; enquanto isso, não toca em mais nada do banco.
async function esperarAVez(db, log) {
  let avisado = '';
  for (;;) {
    try {
      const r = await tentarAssumir(db);
      if (r.minha) return;
      const quem = descrever(r.dono);
      if (quem !== avisado) {
        log('de reserva: quem está atendendo agora é', quem + '. Assumo sozinho se ele parar.');
        avisado = quem;
      }
    } catch (err) {
      log('não consegui conferir de quem é a vez:', err.message);
    }
    await new Promise(r => setTimeout(r, RENOVAR_MS));
  }
}

// Renova a vez enquanto o vigia roda. Se descobrir que ela passou pra outro
// (este ficou tanto tempo sem conseguir renovar que o prazo venceu e o reserva
// assumiu), chama aoPerder: continuar mandando aqui seria justamente o envio
// em dobro que este arquivo existe pra evitar.
function manterAVez(db, log, aoPerder) {
  let perdida = false;
  let ultimaRenovacao = Date.now();
  const perder = motivo => {
    perdida = true;
    clearInterval(timer);
    log(motivo + '; este vigia vai parar.');
    aoPerder();
  };
  const timer = setInterval(async () => {
    if (perdida) return;
    try {
      const r = await tentarAssumir(db);
      if (r.minha) { ultimaRenovacao = Date.now(); return; }
      perder('a vez passou para ' + descrever(r.dono));
    } catch (err) {
      log('não consegui renovar a vez:', err.message);
      // Sem conseguir renovar, a vez vence do lado de lá e o reserva assume.
      // Continuar trabalhando aqui depois disso — com o Gmail no ar e só o
      // banco fora, por exemplo — seria o envio em dobro. Então para junto
      // com o prazo, um pouco antes dele, pra não haver sobreposição.
      if (Date.now() - ultimaRenovacao > PRAZO_MS - RENOVAR_MS) {
        perder('fiquei sem renovar a vez até o prazo acabar');
      }
    }
  }, RENOVAR_MS);
  return () => clearInterval(timer);
}

// Devolve a vez ao desligar, pra o reserva não precisar esperar o prazo vencer.
async function devolverAVez(db) {
  const ref = refDoLider(db);
  try {
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      if (snap.exists && snap.data().id === EU.id) {
        t.set(ref, Object.assign({}, snap.data(), { ate: 0, devolvidaEm: new Date().toISOString() }));
      }
    });
  } catch (e) { /* desligando: o prazo vence sozinho */ }
}

module.exports = { esperarAVez, manterAVez, devolverAVez, PRAZO_MS, RENOVAR_MS, EU };
