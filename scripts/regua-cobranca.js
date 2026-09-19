// Cobrança automática de documentos (a "régua"), enviada pelo PC do robô.
//
// Hoje a cobrança sai quando alguém abre Pendências e clica. Com a régua
// ligada (Pendências › Configurações › Automático), nos dias do mês que o
// admin escolher, o robô manda sozinho a cobrança pra cada cliente que ainda
// não mandou os documentos do mês anterior. Usa os MESMOS modelos da tela
// (1ª, 2ª, 3ª cobrança, conforme quantas já foram feitas) e registra em
// documentosMensal.cobrancas, então a tela mostra como se alguém tivesse
// clicado.
//
// Vem DESLIGADA. Cuidados:
//   - só manda pra e-mail que está no cadastro do cliente;
//   - pula quem foi cobrado nos últimos 3 dias (por gente ou pela régua);
//   - pula quem está "sem movimento" ou não tem nada que se aplique;
//   - no máximo MAX_POR_DIA e-mails por dia, e respeita o freio por hora do vigia;
//   - marca o dia ANTES de começar: se o vigia cair no meio, não recomeça
//     do zero mandando de novo pros primeiros (os que ficaram pra trás
//     entram no próximo dia da régua).
const cacheDeClientes = require('./clientes-cache');
const { htmlDaCobranca } = require('./email-html');

const HORA_MINIMA = 9;
const MAX_POR_DIA = 40;
const INTERVALO_ENTRE_COBRANCAS_MS = 3 * 864e5;
const CAIXA = 'nilmacontabilidade@gmail.com';
const BASE = 'https://nilmaadvancedsystems.github.io/Entregas/cliente.html';
const TIPOS = [
  { chave: 'extrato', label: 'Extrato Bancário' },
  { chave: 'comprovante', label: 'Comprovante' },
  { chave: 'aplicacao', label: 'Aplicação' },
];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// iguais aos da tela de Pendências (CONFIG_PADRAO): valem enquanto o admin não salvar os dele
const MODELOS_PADRAO = {
  '1': { assunto: 'Documentos de {mes} - {cliente}',
         corpo: 'Olá,\n\nPara fechar a contabilidade de {mes} ainda precisamos dos seguintes documentos de {cliente}:\n\n{lista}\n\nPode responder este e-mail com os arquivos em anexo? Assim que chegarem, o recebimento é registrado automaticamente.\n\nObrigado,\n{assinatura}' },
  '2': { assunto: 'Lembrete: documentos de {mes} - {cliente}',
         corpo: 'Olá,\n\nAinda não recebemos os documentos de {mes} de {cliente}:\n\n{lista}\n\nO prazo para fechar o mês é dia {prazo}. Consegue enviar hoje, respondendo este e-mail com os anexos?\n\nObrigado,\n{assinatura}' },
  '3': { assunto: 'Urgente: documentos de {mes} em atraso - {cliente}',
         corpo: 'Olá,\n\nEsta é a {n}ª vez que pedimos os documentos de {mes} de {cliente}:\n\n{lista}\n\nSem eles a apuração do mês fica parada e pode gerar multa e juros. Precisamos deles hoje. Se houver algum problema para enviar, nos avise por aqui.\n\n{assinatura}' },
};

const pad2 = n => String(n).padStart(2, '0');
const diaIso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const competenciaAnterior = d => { const x = new Date(d.getFullYear(), d.getMonth() - 1, 1); return x.getFullYear() + '-' + pad2(x.getMonth() + 1); };
const mesPorExtenso = comp => { const p = String(comp).split('-'); return (MESES[Number(p[1]) - 1] || comp) + ' de ' + p[0]; };
const preencher = (texto, vars) => String(texto || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);

// "5, 10, 15" ou [5, 10, 15] -> [5, 10, 15] (1 a 28, sem repetição)
function diasDaRegua(bruto) {
  const lista = Array.isArray(bruto) ? bruto : String(bruto || '').split(/[^0-9]+/);
  return [...new Set(lista.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 28))].sort((a, b) => a - b);
}

// Hoje é dia de régua? Se o dia marcado caiu num fim de semana (ou com o PC
// desligado), vale o primeiro dia útil seguinte em que o vigia estiver ligado,
// desde que ainda não tenha rodado depois daquele dia marcado.
function diaDeRodar(agora, dias, ultimaRodada) {
  if (!dias.length || agora.getHours() < HORA_MINIMA) return false;
  const fds = agora.getDay() === 0 || agora.getDay() === 6;
  if (fds) return false;
  const hoje = agora.getDate();
  const marcado = dias.filter(d => d <= hoje).pop();
  if (!marcado) return false;
  const dataMarcada = diaIso(new Date(agora.getFullYear(), agora.getMonth(), marcado));
  return !ultimaRodada || ultimaRodada < dataMarcada;
}

// O que falta deste cliente no mês. Mesmo cálculo da tela.
function faltandoDo(cliente, doc) {
  if (doc && doc.semMovimento) return [];
  const naoAplica = Array.isArray(cliente.documentosNaoAplicaveis) ? cliente.documentosNaoAplicaveis : [];
  return TIPOS.filter(t => !naoAplica.includes(t.chave) && !(doc && doc[t.chave]));
}

// Monta a mensagem de um cliente, ou devolve por que ele fica de fora.
function cobrancaDo(cliente, doc, config, comp, agora) {
  const para = String(cliente.email || '').trim().toLowerCase();
  if (!para || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return { pula: 'sem e-mail' };
  const faltando = faltandoDo(cliente, doc);
  if (!faltando.length) return { pula: 'nada falta' };
  const cobs = (doc && Array.isArray(doc.cobrancas) ? doc.cobrancas : []).filter(c => c && c.canal !== 'coleta');
  const recente = cobs.some(c => agora - new Date(c.em).getTime() < INTERVALO_ENTRE_COBRANCAS_MS);
  if (recente) return { pula: 'cobrado há pouco' };
  const n = cobs.length + 1;
  const modelos = Object.assign({}, MODELOS_PADRAO, (config && config.modelos) || {});
  const modelo = Object.assign({}, MODELOS_PADRAO[String(Math.min(n, 3))], modelos[String(Math.min(n, 3))] || {});
  const dia = Number(config && config.diaLimite);
  const p = String(comp).split('-');
  const prazo = dia ? pad2(dia) + '/' + pad2(Number(p[1]) % 12 + 1) : 'combinado';
  const link = cliente.portalToken ? BASE + '?portal=' + cliente.portalToken : '';
  const vars = {
    cliente: (cliente.nomeFantasia || '').trim() || cliente.nome || '',
    mes: mesPorExtenso(comp),
    lista: faltando.map(t => '- ' + t.label).join('\n'),
    documentos: faltando.map(t => t.label.toLowerCase()).join(', '),
    prazo, n,
    assinatura: (config && config.assinatura) || 'Nilma Contabilidade',
    caixa: CAIXA, link,
  };
  let corpo = preencher(modelo.corpo, vars);
  if (link && !/\{link\}/.test(modelo.corpo)) corpo += '\n\nO que já recebemos e o que ainda falta fica sempre atualizado aqui:\n' + link;
  return { para, n, tipos: faltando.map(t => t.chave), assunto: preencher(modelo.assunto, vars), corpo };
}

function iniciarReguaDeCobranca({ db, log, correio }) {
  const estadoRef = db.collection('robo').doc('estado');
  const configRef = db.collection('config').doc('cobranca');
  let rodando = false;
  let feitoHoje = '';
  async function talvez() {
    const agora = new Date();
    const hoje = diaIso(agora);
    if (rodando || feitoHoje === hoje || agora.getHours() < HORA_MINIMA) return;
    rodando = true;
    try {
      const config = (await configRef.get()).data() || {};
      const regua = config.regua || {};
      const dias = diasDaRegua(regua.dias);
      // desligada ou fora do dia: sem trava, o admin pode ligar agora e valer hoje
      // (custa duas leituras por hora)
      if (!regua.ligada || !dias.length) return;
      const estado = (await estadoRef.get()).data() || {};
      if (!diaDeRodar(agora, dias, estado.reguaRodouEm)) return;
      // marca antes: se cair no meio, não repete pros primeiros
      await estadoRef.set({ reguaRodouEm: hoje }, { merge: true });
      feitoHoje = hoje;

      const comp = competenciaAnterior(agora);
      const docs = new Map();
      (await db.collection('documentosMensal').where('competencia', '==', comp).get())
        .forEach(d => docs.set(d.data().clienteId || d.id.split('_')[0], d.data()));
      const clientes = [];
      (await cacheDeClientes.clientesAtivos(db, log)).forEach(d => clientes.push(Object.assign({ id: d.id }, d.data())));

      let enviados = 0;
      const pulos = {};
      for (const c of clientes.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'))) {
        const m = cobrancaDo(c, docs.get(c.id), config, comp, agora.getTime());
        if (m.pula) { pulos[m.pula] = (pulos[m.pula] || 0) + 1; continue; }
        if (enviados >= MAX_POR_DIA || !correio.podeEnviar(1)) { pulos['limite do dia'] = (pulos['limite do dia'] || 0) + 1; continue; }
        try {
          let visual = {};
          try { visual = htmlDaCobranca({ corpo: m.corpo, cliente: c, competencia: comp, faltando: m.tipos, bancosRecebidos: (docs.get(c.id) || {}).bancosRecebidos,
            diaLimite: config.diaLimite, assinatura: config.assinatura || 'Nilma Contabilidade', caixa: CAIXA }); }
          catch (e) { /* sai só em texto */ }
          const gmailId = await correio.enviar({ para: m.para, assunto: m.assunto, corpo: m.corpo, html: visual.html, imagens: visual.imagens });
          correio.contar();
          enviados++;
          await correio.registrarCobranca(c, comp, {
            em: new Date().toISOString(), por: 'Cobrança automática', para: m.para, tipos: m.tipos,
            canal: 'robo', enviadoPeloRobo: true, automatica: true, gmailId,
          });
        } catch (err) {
          log('régua: não consegui cobrar', c.nome, '-', err.message);
          if (/gmail-auth|insufficient|invalid_grant/i.test(err.message)) break;   // sem autorização, os outros também falham
        }
      }
      const resumo = Object.entries(pulos).map(([k, v]) => v + ' ' + k).join(', ');
      log('régua de cobrança (' + comp + '): ' + enviados + ' enviada(s)' + (resumo ? '; de fora: ' + resumo : ''));
      await estadoRef.set({ reguaUltima: { em: new Date().toISOString(), competencia: comp, enviados, pulos } }, { merge: true });
    } catch (err) {
      log('régua de cobrança falhou:', err.message);
    } finally { rodando = false; }
  }
  setTimeout(talvez, 8 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('régua de cobrança pronta (só age se estiver ligada em Pendências › Configurações)');
}

module.exports = { diasDaRegua, diaDeRodar, faltandoDo, cobrancaDo, competenciaAnterior, iniciarReguaDeCobranca };
