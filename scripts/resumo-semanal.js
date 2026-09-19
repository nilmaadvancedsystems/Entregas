// Resumo da semana por e-mail, toda sexta a partir das 17h.
//
// O resumo diário que já existia fala só do Gmail. Este é o do escritório: o
// que foi entregue e o que não foi, quem abriu o link dele, quem ainda deve
// documento, o que mudou na Receita e se o backup está em dia. Vai pro mesmo
// endereço dos outros avisos do robô. Se o PC estiver desligado na sexta, sai
// na primeira vez que ele ligar depois disso (uma vez por semana, nunca duas).
const cacheDeClientes = require('./clientes-cache');

const DIA_DO_RESUMO = 5;      // sexta
const HORA_DO_RESUMO = 17;
const NOMES_DOC = { extrato: 'extrato', comprovante: 'comprovantes', aplicacao: 'aplicação' };

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function segundaDaSemana(agora) {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// Já passou da sexta 17h desta semana?
function horaDoResumo(agora) {
  const dia = (agora.getDay() + 6) % 7;                       // segunda = 0 ... domingo = 6
  const sexta = (DIA_DO_RESUMO + 6) % 7;
  return dia > sexta || (dia === sexta && agora.getHours() >= HORA_DO_RESUMO);
}
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

// Função pura: recebe os dados já lidos e devolve assunto e texto.
function montarTexto(d) {
  const L = [];
  const entregues = d.entregas.filter(e => e.status === 'confirmada');
  const falhas = d.entregas.filter(e => e.status === 'falha');
  L.push('ENTREGAS');
  if (!d.entregas.length) L.push('  Nenhuma entrega registrada nesta semana.');
  else {
    L.push('  ' + plural(entregues.length, 'entregue', 'entregues') + ', ' + plural(falhas.length, 'não realizada', 'não realizadas') + '.');
    const porPessoa = {};
    entregues.forEach(e => { const k = e.entregadoPorNome || e.entregadoPor || 'sem nome'; porPessoa[k] = (porPessoa[k] || 0) + 1; });
    Object.keys(porPessoa).sort((a, b) => porPessoa[b] - porPessoa[a]).forEach(k => L.push('  - ' + k + ': ' + porPessoa[k]));
    falhas.slice(0, 8).forEach(e => L.push('  ! ' + (e.clienteNome || 'cliente') + (e.motivoFalha ? ': ' + e.motivoFalha : '')));
  }
  L.push('', 'LINK DO CLIENTE');
  if (!d.portais.total) L.push('  Nenhum cliente tem link criado ainda.');
  else {
    L.push('  ' + plural(d.portais.abriram.length, 'cliente abriu', 'clientes abriram') + ' o link nesta semana, de ' + d.portais.total + ' com link.');
    d.portais.abriram.slice(0, 10).forEach(n => L.push('  - ' + n));
  }
  L.push('', 'DOCUMENTOS DE ' + d.mesDosDocumentos.toUpperCase());
  if (!d.devendo.length) L.push('  Ninguém devendo documento.');
  else {
    L.push('  ' + plural(d.devendo.length, 'cliente ainda deve', 'clientes ainda devem') + ' documento.');
    d.devendo.slice(0, 12).forEach(c => L.push('  - ' + c.nome + ': ' + c.faltam.map(t => NOMES_DOC[t] || t).join(', ')));
    if (d.devendo.length > 12) L.push('  e mais ' + (d.devendo.length - 12) + '.');
  }
  if (d.receita.length) {
    L.push('', 'MUDOU NA RECEITA (ainda sem "Já vi")');
    d.receita.slice(0, 10).forEach(r => L.push('  - ' + r.nome + ': ' + r.textos.join(' | ')));
  }
  L.push('', 'BACKUP');
  L.push('  ' + (d.backup && d.backup.em ? 'Último backup bom: ' + new Date(d.backup.em).toLocaleString('pt-BR') + (d.backup.ok === false ? ' (a última tentativa FALHOU)' : '')
    : 'Ainda não há registro de backup feito pelo vigia.'));
  return {
    assunto: 'Resumo da semana: ' + plural(entregues.length, 'entrega', 'entregas') + (falhas.length ? ', ' + plural(falhas.length, 'não realizada', 'não realizadas') : '') +
      (d.devendo.length ? ', ' + d.devendo.length + ' devendo documento' : ''),
    texto: 'Semana de ' + d.de + ' a ' + d.ate + '\n\n' + L.join('\n') + '\n',
  };
}

async function juntarDados(db, agora) {
  const segunda = segundaDaSemana(agora);
  const inicio = segunda.toISOString();
  const entregasSnap = await db.collection('entregas').where('confirmadoEm', '>=', inicio).get();
  const entregas = entregasSnap.docs.map(x => x.data());

  const portaisSnap = await db.collection('portais').get();
  const abriram = [];
  portaisSnap.forEach(p => { const v = p.data().visto; if (v && v.ultima && v.ultima >= inicio) abriram.push(p.data().clienteNome || 'cliente'); });

  // clientes: do arquivo que o vigia mantém (sem gastar leitura); senão, do banco
  const clientes = [];
  (await cacheDeClientes.clientesAtivos(db)).forEach(c => clientes.push(Object.assign({ id: c.id }, c.data())));

  const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const comp = mesAnterior.getFullYear() + '-' + String(mesAnterior.getMonth() + 1).padStart(2, '0');
  const docs = new Map();
  (await db.collection('documentosMensal').where('competencia', '==', comp).get()).forEach(x => docs.set(x.data().clienteId, x.data()));
  const devendo = [];
  // só quem já tem registro no mês: cliente que nunca entrou na cobrança não
  // é "devedor", é cliente que o escritório não cobra por aqui
  clientes.forEach(c => {
    const dado = docs.get(c.id);
    if (!dado || dado.semMovimento) return;
    const na = Array.isArray(c.documentosNaoAplicaveis) ? c.documentosNaoAplicaveis : [];
    const faltam = ['extrato', 'comprovante', 'aplicacao'].filter(t => !na.includes(t) && !dado[t]);
    if (faltam.length) devendo.push({ nome: c.nome || 'cliente', faltam });
  });
  devendo.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const receita = clientes.filter(c => c.receita && Array.isArray(c.receita.mudancas) && c.receita.mudancas.length)
    .map(c => ({ nome: c.nome || 'cliente', textos: c.receita.mudancas.map(m => m.texto) }));
  const estado = (await db.collection('robo').doc('estado').get()).data() || {};
  return {
    de: segunda.toLocaleDateString('pt-BR'), ate: agora.toLocaleDateString('pt-BR'),
    entregas, portais: { total: portaisSnap.size, abriram }, devendo, receita, backup: estado.backup || null,
    mesDosDocumentos: mesAnterior.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

function iniciarResumoSemanal({ db, log, enviar, destino }) {
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false;
  async function talvez() {
    const agora = new Date();
    if (rodando || !horaDoResumo(agora)) return;
    rodando = true;
    try {
      const semana = iso(segundaDaSemana(agora));
      const { estado, para } = await destino();
      if (estado.resumoSemana === semana || !para) return;
      const r = montarTexto(await juntarDados(db, agora));
      await enviar({ para, assunto: r.assunto, corpo: r.texto });
      await estadoRef.set({ resumoSemana: semana, resumoSemanaEm: agora.toISOString() }, { merge: true });
      log('resumo da semana enviado para', para);
    } catch (err) {
      log('não consegui mandar o resumo da semana:', err.message);
    } finally { rodando = false; }
  }
  setTimeout(talvez, 6 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('resumo da semana ligado (sexta, a partir das ' + HORA_DO_RESUMO + 'h)');
}

module.exports = { montarTexto, horaDoResumo, segundaDaSemana, iniciarResumoSemanal };
