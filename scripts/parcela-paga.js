// Parcela de parcelamento paga, reconhecida pelo comprovante.
//
// O cliente manda por e-mail o comprovante do DARF / DAS / guia da PGFN que
// pagou. Aqui o robô lê o PDF, vê se é pagamento de parcela (não a guia a
// pagar, nem o DAS do mês), de que órgão, quanto, de que parcela e quando foi
// pago, acha o parcelamento do cliente cadastrado na tela Tarefas › empresa ›
// Parcelamentos (coleção parcelamentos) e marca a parcela do mês como paga.
//
// Na dúvida não marca: dois parcelamentos que servem, valor muito diferente
// ou parcela já paga ficam só no log. Marcar a parcela errada é pior que
// deixar alguém marcar na mão.
//
// As contas de mês e vencimento são as mesmas da tela (tarefas.html).

const pad2 = n => String(n).padStart(2, '0');
const isoDe = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const digitos = t => String(t || '').replace(/\D/g, '');

function mesMais(ym, n) { const p = String(ym).split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function difMeses(a, b) { const x = String(a).split('-').map(Number), y = String(b).split('-').map(Number); return (y[0] - x[0]) * 12 + (y[1] - x[1]); }
// último dia útil do mês (padrão da PGFN, do Simples e da Receita) ou o dia fixo
function vencimentoDe(p, ym) {
  const q = String(ym).split('-').map(Number);
  const ult = new Date(q[0], q[1], 0, 12);
  if (p.dia && p.dia !== 'util') return isoDe(new Date(q[0], q[1] - 1, Math.min(Number(p.dia), ult.getDate()), 12));
  while (ult.getDay() === 0 || ult.getDay() === 6) ult.setDate(ult.getDate() - 1);
  return isoDe(ult);
}
// situação do parcelamento num dia (AAAA-MM-DD): pagas, atrasadas, a do mês
function situacao(p, hoje) {
  const mesHoje = hoje.slice(0, 7), total = Number(p.parcelas) || 0, pagas = p.pagas || {};
  let nPagas = 0; const atrasadas = [];
  for (let i = 0; i < total; i++) {
    const ym = mesMais(p.primeira, i);
    if (pagas[ym]) { nPagas++; continue; }
    if (ym < mesHoje || (ym === mesHoje && hoje > vencimentoDe(p, ym))) atrasadas.push(ym);
  }
  const n = difMeses(p.primeira, mesHoje) + 1;
  const temAtual = n >= 1 && n <= total;
  return { total, nPagas, atrasadas, atual: temAtual ? mesHoje : null, atualPaga: temAtual && !!pagas[mesHoje], vencAtual: temAtual ? vencimentoDe(p, mesHoje) : null };
}

// ---------- leitura do comprovante ----------
const PAGO = /COMPROVANTE DE (PAGAMENTO|ARRECADACAO)|PAGAMENTO (EFETUADO|REALIZADO|CONFIRMADO)|AUTENTICACAO( MECANICA| ELETRONICA| BANCARIA)?|VALOR PAGO|DATA D[OE] PAGAMENTO|PAGO EM|TRANSACAO (EFETUADA|REALIZADA)|OPERACAO (EFETUADA|REALIZADA)|DEBITO EFETUADO/;
const DE_PARCELA = /PARCELA(?!S? A PAGAR)|PARCELAMENTO|NEGOCIACAO|TRANSACAO (EXCEPCIONAL|TRIBUTARIA|INDIVIDUAL|POR ADESAO)|ACORDO/;
const ORGAO = [
  ['pgfn', /PGFN|DIVIDA ATIVA|PROCURADORIA|REGULARIZE|TRANSACAO (EXCEPCIONAL|TRIBUTARIA|INDIVIDUAL|POR ADESAO)/],
  ['simples', /SIMPLES NACIONAL|PARCELAMENTO DO SIMPLES|PARCSN|PERT-?SN|\bDAS\b/],
  ['receita', /\bDARF\b|RECEITA FEDERAL|\bRFB\b|E-?CAC/],
  ['estadual', /\bICMS\b|SEFAZ|SECRETARIA (DE ESTADO )?DA FAZENDA|\bDAE\b|\bGARE\b/],
  ['municipal', /PREFEITURA|\bISSQN?\b|\bIPTU\b|MUNICIPIO DE/],
];
function numeroBR(txt) { const n = Number(String(txt).replace(/\./g, '').replace(',', '.')); return isFinite(n) && n > 0 ? n : null; }

// -> { orgao, valor, parcela, de, numero, pagoEm, soPeloNumero } ou null
// Comprovante de banco de DARF quase nunca escreve "parcela": traz só o
// número de referência. Sem a palavra, vale só se esse número bater com o
// nº do parcelamento cadastrado (soPeloNumero) — assim o DAS do mês e o
// DARF de imposto comum nunca viram parcela.
function lerGuiaPaga(texto) {
  const t = semAcento(texto).toUpperCase().replace(/[ \t]+/g, ' ');
  if (!PAGO.test(t)) return null;
  const orgao = (ORGAO.find(o => o[1].test(t)) || [null])[0];
  if (!orgao) return null;
  const soPeloNumero = !DE_PARCELA.test(t);
  let valor = null;
  const v = t.match(/VALOR (TOTAL PAGO|TOTAL|PAGO|DO DOCUMENTO|COBRADO|DO PAGAMENTO|DEBITADO|DA PARCELA)\s*:?\s*(R\$)?\s*(\d{1,3}(\.\d{3})*,\d{2})/) ||
    t.match(/TOTAL\s*:?\s*R\$\s*(\d{1,3}(\.\d{3})*,\d{2})/) || t.match(/R\$\s*(\d{1,3}(\.\d{3})*,\d{2})/);
  if (v) valor = numeroBR(v[3] || v[1]);
  let parcela = null, de = null;
  const p = t.match(/PARCELA(?!MENTO|S)\s*(?:N[O°º.]*\s*)?:?\s*(\d{1,3})(?:\s*(?:\/|DE)\s*(\d{1,3}))?/);
  if (p) { parcela = Number(p[1]) || null; de = p[2] ? Number(p[2]) : null; }
  let numero = null;
  const n = t.match(/(?:N(?:UMERO|O|º|°)\.?\s*(?:D[OA]\s*)?)?(?:PARCELAMENTO|NEGOCIACAO|ACORDO|INSCRICAO|CONTA DO PARCELAMENTO|PEDIDO|REFERENCIA)\s*(?:N(?:UMERO|O|º|°)\.?)?\s*:?\s*(\d[\d.\/-]{4,})/);
  if (n) numero = n[1].replace(/[.\-\/]+$/, '');
  if (soPeloNumero && !numero) return null;
  let pagoEm = null;
  const d = t.match(/(?:DATA D[OE] PAGAMENTO|PAGO EM|PAGAMENTO EM|DATA DA TRANSACAO|DATA DA OPERACAO|DATA DO DEBITO|DEBITADO EM|DATA DE ARRECADACAO)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (d) pagoEm = d[3] + '-' + d[2] + '-' + d[1];
  return { orgao, valor, parcela, de, numero, pagoEm, soPeloNumero };
}

// Qual parcelamento e qual mês. -> { p, ym } ou { motivo } (não marca)
function acharParcela(parcelamentos, guia, diaRef) {
  let cands = (parcelamentos || []).filter(p => p && p.aberto !== false && (!p.status || p.status === 'ativo') && p.primeira && Number(p.parcelas) > 0);
  if (!cands.length) return { motivo: 'o cliente não tem parcelamento ativo cadastrado' };
  let escolhido = null;
  const dg = digitos(guia.numero);
  if (dg.length >= 5) {
    const porNumero = cands.filter(p => { const x = digitos(p.numero); return x.length >= 5 && (x.includes(dg) || dg.includes(x)); });
    if (porNumero.length === 1) escolhido = porNumero[0];
  }
  if (!escolhido && guia.soPeloNumero) return { motivo: 'o nº de referência ' + (guia.numero || '') + ' não é de nenhum parcelamento cadastrado' };
  if (!escolhido) {
    cands = cands.filter(p => p.orgao === guia.orgao);
    if (!cands.length) return { motivo: 'nenhum parcelamento de ' + guia.orgao + ' cadastrado' };
    if (guia.valor) {
      // a parcela da PGFN sobe com a Selic: até 25% de diferença ainda é ela
      const dif = p => Math.abs(guia.valor - Number(p.valorParcela || 0)) / Math.max(Number(p.valorParcela || 0), 1);
      const perto = cands.filter(p => dif(p) <= 0.25).sort((a, b) => dif(a) - dif(b));
      if (!perto.length) return { motivo: 'valor ' + guia.valor.toFixed(2) + ' não bate com nenhum parcelamento de ' + guia.orgao };
      if (perto.length > 1 && dif(perto[1]) - dif(perto[0]) < 0.1) return { motivo: 'mais de um parcelamento de ' + guia.orgao + ' com valor parecido' };
      escolhido = perto[0];
    } else if (cands.length === 1) escolhido = cands[0];
    else return { motivo: 'mais de um parcelamento de ' + guia.orgao + ' e o comprovante não diz o valor' };
  }
  const p = escolhido, total = Number(p.parcelas), pagas = p.pagas || {};
  let ym = null;
  // o comprovante diz a parcela (e o total bate, quando vem): é ela
  if (guia.parcela && guia.parcela <= total && (!guia.de || guia.de === total)) ym = mesMais(p.primeira, guia.parcela - 1);
  else {
    // senão, a mais antiga em aberto até o mês do pagamento (ou o seguinte, se pagou adiantado)
    const ref = (guia.pagoEm || diaRef).slice(0, 7);
    for (let i = 0; i < total; i++) { const y = mesMais(p.primeira, i); if (!pagas[y]) { if (y <= mesMais(ref, 1)) ym = y; break; } }
  }
  if (!ym) return { motivo: 'nenhuma parcela em aberto até ' + (guia.pagoEm || diaRef).slice(0, 7) };
  if (pagas[ym]) return { motivo: 'a parcela de ' + ym + ' já estava paga' };
  return { p, ym, n: difMeses(p.primeira, ym) + 1 };
}

const NOME_ORGAO = { pgfn: 'PGFN', simples: 'Simples', receita: 'Receita', estadual: 'Estado', municipal: 'Prefeitura', outro: 'parcelamento' };
const DICAS = /darf|\bdas\b|guia|parcel|pgfn|receita|simples|comprovante|pagamento|pago|arrecada|regulariz|transa|icms|iss|iptu/i;

// Chamado pelo download-attachments.js com o cliente já reconhecido.
// anexos: os que têm bytes; textoDe(a) devolve o texto do PDF (com cache).
// -> [{ texto }] do que foi marcado (pra andamento da tela)
async function conferirGuias({ db, FV, cliente, anexos, textoDe, dicas, tipos, mensagemId, dataMs, simular, log, cache }) {
  // comprovante é pequeno: PDF grande (extrato de 200 páginas) nem é aberto
  const pdfs = (anexos || []).filter(a => a.mimeType === 'application/pdf' && a.buffer && a.buffer.length <= 3 * 1024 * 1024);
  if (!pdfs.length) return [];
  const temDica = DICAS.test(String(dicas || '') + ' ' + pdfs.map(a => a.filename).join(' ')) || (tipos || []).includes('comprovante');
  if (!temDica) return [];
  const feitos = [];
  let parcs = cache && cache.get(cliente.id);
  for (const a of pdfs) {
    // PDF que o leitor não termina de ler em 20 s fica de fora (não trava a leitura toda)
    const textoPdf = await Promise.race([Promise.resolve(textoDe(a)).catch(() => ''), new Promise(r => setTimeout(() => r(''), 20000))]);
    const guia = lerGuiaPaga(textoPdf);
    if (!guia) continue;
    if (!parcs) {
      const snap = await db.collection('parcelamentos').where('clienteId', '==', cliente.id).get();
      parcs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (cache) cache.set(cliente.id, parcs);
    }
    const dia = isoDe(new Date(Number(dataMs) || Date.now()));
    const r = acharParcela(parcs, guia, dia);
    if (!r.p) { log('comprovante de parcela (' + a.filename + '), não marcado: ' + r.motivo); continue; }
    const p = r.p, agora = new Date().toISOString();
    const marca = { em: agora, por: 'Robô (e-mail)', auto: true, arquivo: a.filename, mensagemId: mensagemId || null };
    if (guia.valor) marca.valor = guia.valor;
    if (guia.pagoEm) marca.pagoEm = guia.pagoEm;
    const campos = { ['pagas.' + r.ym]: marca, atualizadoEm: agora, atualizadoPor: 'Robô' };
    p.pagas = Object.assign({}, p.pagas || {}, { [r.ym]: marca });
    const quitou = Object.keys(p.pagas).filter(k => difMeses(p.primeira, k) >= 0 && difMeses(p.primeira, k) < Number(p.parcelas)).length >= Number(p.parcelas);
    if (quitou) { campos.status = 'quitado'; campos.aberto = false; p.status = 'quitado'; p.aberto = false; }
    const texto = 'parcela ' + r.n + '/' + p.parcelas + ' ' + (NOME_ORGAO[p.orgao] || '') + ' (' + r.ym.split('-').reverse().join('/') + ') paga' + (quitou ? ' — parcelamento quitado' : '');
    if (!simular) await db.collection('parcelamentos').doc(p.id).update(campos);
    log(texto + ' (' + a.filename + ')' + (simular ? ' [simulação]' : ''));
    feitos.push({ texto, parcelamentoId: p.id, ym: r.ym });
  }
  return feitos;
}

module.exports = { lerGuiaPaga, acharParcela, conferirGuias, situacao, vencimentoDe, mesMais, difMeses };
