// Vigia de CNPJ: uma vez por semana confere cada cliente nos dados abertos da
// Receita (BrasilAPI, grátis, sem senha nem certificado) e registra o que
// mudou: situação cadastral, Simples, MEI, atividade, sócios, endereço.
//
// Hoje o escritório só descobre que um cliente foi excluído do Simples, ou
// ficou inapto, quando o problema estoura. Aqui o aviso chega sozinho.
//
// O retrato fica em clientes/{id}.receita (a tela já lê o cadastro, então não
// precisa de coleção nem de regra nova). O que mudou fica em
// clientes/{id}.receita.mudancas até alguém marcar como visto no app.
//
// Limite honesto: os dados abertos têm atraso de semanas em relação ao que a
// Receita mostra no e-CAC. Serve de alarme, não de certidão.
//
// Uso:  node vigia-cnpj.js            confere todos agora
//       node vigia-cnpj.js --simular  mostra o que mudaria, sem gravar
const https = require('https');

const SIMULAR = process.argv.includes('--simular');
const PAUSA_MS = 1500;          // a API é de graça: um pedido a cada 1,5s
const DIAS_ENTRE_RODADAS = 7;
const MAX_MUDANCAS = 12;        // por cliente, as mais novas

const soDigitos = v => String(v || '').replace(/\D/g, '');
const dormir = ms => new Promise(r => setTimeout(r, ms));

function buscar(cnpj) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://brasilapi.com.br/api/cnpj/v1/' + cnpj, { headers: { 'User-Agent': 'nilma-entregas-vigia-cnpj' }, timeout: 20000 }, res => {
      let corpo = '';
      res.on('data', d => { corpo += d; });
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(corpo)); } catch (e) { reject(new Error('resposta ilegível')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('demorou demais')));
    req.on('error', reject);
  });
}

// Só o que interessa acompanhar. De propósito fica de fora o CPF mascarado e a
// faixa etária dos sócios que a API devolve: não servem pra nada aqui.
function retrato(j) {
  const texto = v => (v == null || v === 'null' ? '' : String(v).trim());
  return {
    situacao: texto(j.descricao_situacao_cadastral).toUpperCase(),
    situacaoDesde: texto(j.data_situacao_cadastral),
    motivoSituacao: texto(j.descricao_motivo_situacao_cadastral),
    simples: j.opcao_pelo_simples === true,
    mei: j.opcao_pelo_mei === true,
    razaoSocial: texto(j.razao_social),
    naturezaJuridica: texto(j.natureza_juridica),
    porte: texto(j.porte),
    cnae: texto(j.cnae_fiscal),
    cnaeDescricao: texto(j.cnae_fiscal_descricao),
    abertura: texto(j.data_inicio_atividade),
    endereco: [[texto(j.descricao_tipo_de_logradouro), texto(j.logradouro)].filter(Boolean).join(' '), texto(j.numero), texto(j.bairro),
      [texto(j.municipio), texto(j.uf)].filter(Boolean).join('/')].filter(Boolean).join(', '),
    socios: (Array.isArray(j.qsa) ? j.qsa : []).map(s => texto(s.nome_socio)).filter(Boolean).sort(),
  };
}

const simNao = b => (b ? 'sim' : 'não');
// Compara dois retratos e devolve frases prontas pra tela.
function diferencas(antes, agora) {
  const m = [];
  if (antes.situacao !== agora.situacao) m.push({ grave: agora.situacao !== 'ATIVA', texto: 'Situação cadastral: ' + (antes.situacao || '?') + ' → ' + (agora.situacao || '?') + (agora.motivoSituacao && agora.situacao !== 'ATIVA' ? ' (' + agora.motivoSituacao.toLowerCase() + ')' : '') });
  if (antes.simples !== agora.simples) m.push({ grave: !agora.simples, texto: agora.simples ? 'Entrou no Simples Nacional' : 'Saiu do Simples Nacional' });
  if (antes.mei !== agora.mei) m.push({ grave: !agora.mei, texto: agora.mei ? 'Virou MEI' : 'Deixou de ser MEI' });
  if (antes.cnae !== agora.cnae) m.push({ grave: false, texto: 'Atividade principal: ' + (antes.cnaeDescricao || antes.cnae || '?') + ' → ' + (agora.cnaeDescricao || agora.cnae || '?') });
  if (antes.razaoSocial !== agora.razaoSocial) m.push({ grave: false, texto: 'Razão social: ' + (antes.razaoSocial || '?') + ' → ' + (agora.razaoSocial || '?') });
  if (antes.endereco !== agora.endereco) m.push({ grave: false, texto: 'Endereço na Receita: ' + (agora.endereco || 'sem endereço') });
  const saiu = (antes.socios || []).filter(s => !(agora.socios || []).includes(s));
  const entrou = (agora.socios || []).filter(s => !(antes.socios || []).includes(s));
  if (saiu.length) m.push({ grave: false, texto: 'Saiu do quadro de sócios: ' + saiu.join(', ') });
  if (entrou.length) m.push({ grave: false, texto: 'Entrou no quadro de sócios: ' + entrou.join(', ') });
  return m;
}
// Primeira vez que o cliente é conferido: não há "antes", mas situação que não
// é ATIVA merece aviso mesmo assim.
function avisosDaPrimeiraVez(agora) {
  return agora.situacao && agora.situacao !== 'ATIVA'
    ? [{ grave: true, texto: 'Situação cadastral na Receita: ' + agora.situacao + (agora.motivoSituacao ? ' (' + agora.motivoSituacao.toLowerCase() + ')' : '') }]
    : [];
}

async function conferirTodos(db, log) {
  const snap = await db.collection('clientes').where('ativo', '==', true).get();
  const clientes = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(c => soDigitos(c.documento).length === 14);
  log('vigia de CNPJ: conferindo', clientes.length, 'cliente(s) com CNPJ');
  const resumo = { conferidos: 0, mudaram: 0, naoAchados: 0, erros: 0, graves: [] };
  for (const c of clientes) {
    await dormir(PAUSA_MS);
    try {
      const j = await buscar(soDigitos(c.documento));
      if (!j) { resumo.naoAchados++; continue; }
      const agora = retrato(j);
      const antes = c.receita && c.receita.situacao !== undefined ? c.receita : null;
      const novas = (antes ? diferencas(antes, agora) : avisosDaPrimeiraVez(agora))
        .map(m => Object.assign({ em: new Date().toISOString() }, m));
      resumo.conferidos++;
      if (novas.length) {
        resumo.mudaram++;
        novas.filter(m => m.grave).forEach(m => resumo.graves.push((c.nome || 'cliente') + ': ' + m.texto));
        log('  ' + (c.nome || c.id) + ':', novas.map(m => m.texto).join(' | '));
      }
      if (SIMULAR) continue;
      const pendentes = ((c.receita && Array.isArray(c.receita.mudancas)) ? c.receita.mudancas : []).concat(novas).slice(-MAX_MUDANCAS);
      await db.collection('clientes').doc(c.id).update({ receita: Object.assign({}, agora, { conferidoEm: new Date().toISOString(), mudancas: pendentes }) });
    } catch (err) {
      resumo.erros++;
      log('  ' + (c.nome || c.id) + ': não consegui conferir -', err.message);
      if (/HTTP 429/.test(err.message)) await dormir(30000);   // pediram pra ir mais devagar
    }
  }
  if (!SIMULAR) {
    await db.collection('robo').doc('estado').set({ cnpj: { ultimaExecucao: new Date().toISOString(), conferidos: resumo.conferidos, mudaram: resumo.mudaram, erros: resumo.erros } }, { merge: true });
  }
  log('vigia de CNPJ terminou:', resumo.conferidos, 'conferidos,', resumo.mudaram, 'com mudança,', resumo.erros, 'erro(s)');
  return resumo;
}

// Chamado pelo vigia do robô: roda se a última rodada tem mais de 7 dias, e
// olha de novo uma vez por dia.
function iniciarVigiaCnpj(db, log, aoAcharGrave) {
  let rodando = false;
  async function talvezRodar() {
    if (rodando) return;
    try {
      const estado = (await db.collection('robo').doc('estado').get()).data() || {};
      const ultima = estado.cnpj && estado.cnpj.ultimaExecucao;
      if (ultima && Date.now() - new Date(ultima).getTime() < DIAS_ENTRE_RODADAS * 864e5) return;
      rodando = true;
      const r = await conferirTodos(db, log);
      if (r.graves.length && aoAcharGrave) aoAcharGrave(r.graves);
    } catch (err) {
      log('vigia de CNPJ falhou:', err.message);
    } finally { rodando = false; }
  }
  setTimeout(talvezRodar, 5 * 60 * 1000);          // deixa o robô do Gmail subir primeiro
  setInterval(talvezRodar, 24 * 36e5);
  log('vigia de CNPJ ligado (uma conferência por semana nos dados abertos da Receita)');
}

module.exports = { retrato, diferencas, avisosDaPrimeiraVez, conferirTodos, iniciarVigiaCnpj };

if (require.main === module) {
  const { getDb } = require('./firestore-client');
  const log = (...m) => console.log(new Date().toLocaleString('pt-BR'), ...m);
  conferirTodos(getDb('entregas-2e5e2'), log).then(() => process.exit(0), err => { console.error('ERRO:', err.message); process.exit(1); });
}
