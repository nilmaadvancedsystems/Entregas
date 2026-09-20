// Certidão, procuração e certificado digital vencendo.
//
// O cadastro de cada cliente guarda clientes.papeis = [{tipo, vence, observacao}].
// Uma vez por dia, a partir das 8h, o PC do robô olha a lista inteira e avisa
// no celular de quem é admin ou contábil o que vence em 30, 15 e 3 dias — e o
// que já venceu, uma vez só.
//
// Barato: usa o arquivo local de clientes que o vigia já mantém, então na
// maioria dos dias não lê nada do banco.
const cacheDeClientes = require('./clientes-cache');

const HORA_MINIMA = 8;
const MARCOS = [30, 15, 3, 0];        // dias antes; 0 = venceu hoje ou já passou
const MAX_POR_DIA = 20;

const pad2 = n => String(n).padStart(2, '0');
const diaIso = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const NOMES = {
  'cnd-federal': 'CND Federal', 'cnd-estadual': 'CND Estadual', 'cnd-municipal': 'CND Municipal',
  'fgts': 'CRF do FGTS', 'trabalhista': 'Certidão trabalhista',
  'procuracao': 'Procuração eletrônica', 'certificado': 'Certificado digital', 'outro': 'Documento',
};

function diasAte(vence, hoje) {
  const p = String(vence || '').split('-').map(Number);
  if (p.length !== 3 || !p[0]) return null;
  const alvo = new Date(p[0], p[1] - 1, p[2]);
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo - base) / 864e5);
}

// O que avisar hoje: só quem cai exatamente num marco (pra não repetir o mesmo
// documento todo santo dia) e o que venceu, uma vez.
function papeisParaAvisar(clientes, hoje) {
  const fora = [];
  (clientes || []).forEach(c => {
    if (!c || c.ativo === false) return;
    (Array.isArray(c.papeis) ? c.papeis : []).forEach(p => {
      if (!p || !p.vence) return;
      const dias = diasAte(p.vence, hoje);
      if (dias === null) return;
      const marco = dias < 0 ? (dias === -1 ? 0 : null) : (MARCOS.indexOf(dias) !== -1 ? dias : null);
      if (marco === null) return;
      fora.push({
        cliente: c.nomeFantasia || c.nome || 'cliente',
        nome: NOMES[p.tipo] || NOMES.outro,
        dias,
        vence: p.vence,
      });
    });
  });
  return fora.sort((a, b) => a.dias - b.dias).slice(0, MAX_POR_DIA);
}

function textoDoAviso(lista) {
  const frase = x => x.nome + ' de ' + x.cliente +
    (x.dias < 0 ? ' venceu ontem' : (x.dias === 0 ? ' vence hoje' : ' vence em ' + x.dias + ' dias'));
  if (lista.length === 1) return { titulo: 'Documento vencendo', corpo: frase(lista[0]) };
  return {
    titulo: lista.length + ' documentos vencendo',
    corpo: lista.slice(0, 3).map(frase).join(' · ') + (lista.length > 3 ? ' …' : ''),
  };
}

function iniciarPapeisVencendo({ db, log, avisos }) {
  if (!avisos) { log('papéis vencendo: sem aviso no celular, módulo parado'); return; }
  const estadoRef = db.collection('robo').doc('estado');
  let rodando = false;
  let feitoEm = '';

  async function talvez() {
    const agora = new Date();
    const hoje = diaIso(agora);
    if (rodando || feitoEm === hoje || agora.getHours() < HORA_MINIMA) return;
    rodando = true;
    try {
      const clientes = [];
      (await cacheDeClientes.clientesAtivos(db, log)).forEach(d => clientes.push(Object.assign({ id: d.id }, d.data())));
      const lista = papeisParaAvisar(clientes, agora);
      if (!lista.length) { feitoEm = hoje; return; }
      const estado = (await estadoRef.get()).data() || {};
      if (estado.papeisEm === hoje) { feitoEm = hoje; return; }
      // marca antes de avisar: vigia religado não manda de novo
      await estadoRef.set({ papeisEm: hoje }, { merge: true });
      feitoEm = hoje;
      const texto = textoDoAviso(lista);
      await avisos.enviar('admin', '', texto.titulo, texto.corpo, 'papeis');
      await avisos.enviar('contabil', '', texto.titulo, texto.corpo, 'papeis').catch(() => {});
      log('aviso de documento vencendo:', lista.map(x => x.nome + '/' + x.cliente).join(', '));
    } catch (err) {
      log('aviso de documento vencendo falhou:', err.message);
    } finally { rodando = false; }
  }

  setTimeout(talvez, 5 * 60 * 1000);
  setInterval(talvez, 60 * 60 * 1000);
  log('aviso de certidão/procuração/certificado ligado (a partir das ' + HORA_MINIMA + 'h)');
}

module.exports = { diasAte, papeisParaAvisar, textoDoAviso, iniciarPapeisVencendo };
