// Creditor: a conciliação do relatório de liquidação do banco (cobrança) com o
// balancete da empresa, gerando o arquivo de importação contábil de 8 colunas.
// Veio do Extratudo (nads, packages/core/src/extratudo/creditor) para rodar
// dentro do Entregas (29/09/2026): aqui fica só a lógica, sem tela e sem banco
// (a tela é o creditor.html). Roda no navegador (window.NilmaCreditor) e no
// Node (scripts/teste-creditor.js).
//
// O BANCO MANDA: valor e cliente são os do relatório; do balancete sai só a
// conta de cada cliente:
//   1. a conta com o nome do sacado, quando só uma parece;
//   2. o nome bate em mais de uma conta (uma por filial) e o banco não diz a
//      filial, ou diz uma filial que não tem conta: vai na CONTA PRINCIPAL do
//      cliente (a sem filial no nome; sem ela, a primeira do plano) — pedido
//      do escritório, 29/09/2026 ("os que não estão batendo");
//   3. a conta aprendida (a pessoa já informou antes);
//   4. nenhuma: a pessoa informa a conta (fica aprendida ao baixar o arquivo).
(function (raiz) {
  'use strict';

  // ─── textos e números ─────────────────────────────────────────────────────
  function nomeNorm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function brl(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim().replace(/\s*[DC]$/, '').trim();
    if (!/[0-9]/.test(s) || !/^-?\(?[\d.,]+\)?$/.test(s)) return null;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '');
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? null : neg ? -n : n;
  }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function igual(a, b) { return Math.abs(a - b) < 0.005; }
  function somar(vs) { return r2(vs.reduce(function (s, v) { return s + v; }, 0)); }
  /** "004521" → "4521" · "4548/2" → "4548" · "NF 4521" → "4521" */
  function chaveNf(nf) {
    var m = String(nf == null ? '' : nf).match(/\d+/);
    return m ? m[0].replace(/^0+(?=\d)/, '') : '';
  }
  function dinheiro(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? r2(v) : null;
    var n = num(String(v).replace(/R\$\s*/i, '').trim());
    return n == null ? null : r2(n);
  }
  var pad = function (n) { return String(n).padStart(2, '0'); };
  function dataBR(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return pad(v.getDate()) + '/' + pad(v.getMonth() + 1) + '/' + v.getFullYear();
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    }
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) return pad(+m[1]) + '/' + pad(+m[2]) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return '';
  }
  function ordemData(d) {
    var m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0;
  }
  /** o que o banco creditou no título: o cobrado, ou valor + mora + outros − desconto */
  function liquidoDoTitulo(t) { return t.cobrado != null ? t.cobrado : r2(t.valor + t.mora + (t.outros || 0) - t.desconto); }
  function uniq(xs) { var v = {}; return xs.filter(function (x) { var k = typeof x + ':' + x; if (v[k]) return false; v[k] = 1; return true; }); }

  // ─── competência ──────────────────────────────────────────────────────────
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function competenciaValida(c) { var m = /^(\d{4})-(\d{2})$/.exec(c || ''); return !!m && +m[2] >= 1 && +m[2] <= 12; }
  function competenciaPadrao(hoje) { var d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function partes(c) { var p = String(c).split('-'); return { ano: +p[0], mes: +p[1] }; }
  function rotuloCompetencia(c) { if (!competenciaValida(c)) return ''; var p = partes(c); return pad(p.mes) + '/' + p.ano; }
  function competenciaPorExtenso(c) { if (!competenciaValida(c)) return ''; var p = partes(c); return MESES[p.mes - 1] + ' de ' + p.ano; }
  function titulosForaDaCompetencia(titulos, c) {
    if (!competenciaValida(c)) return [];
    var p = partes(c);
    return titulos.filter(function (t) { var m = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(t.liquidacao || ''); return m && (+m[1] !== p.mes || +m[2] !== p.ano); });
  }

  // ─── conferência dos grupos (totais impressos) ────────────────────────────
  var COLUNAS_VALOR = ['valor', 'mora', 'desconto', 'outros', 'cobrado'];
  var TOTAIS_VAZIOS = { valor: null, mora: null, desconto: null, outros: null, cobrado: null };
  function vazios() { return { valor: null, mora: null, desconto: null, outros: null, cobrado: null }; }
  function somaDaColuna(ts, c) { return somar(ts.map(function (t) { return c === 'cobrado' ? liquidoDoTitulo(t) : t[c]; })); }
  function tituloCoerente(t) { return t.cobrado == null || igual(t.cobrado, r2(t.valor + t.mora + t.outros - t.desconto)); }
  function datasDoGrupo(g) { return uniq(g.titulos.map(function (t) { return t.liquidacao; })).sort(function (a, b) { return ordemData(a) - ordemData(b); }); }
  function conferirGrupo(g) {
    var colunas = COLUNAS_VALOR.map(function (c) { var s = somaDaColuna(g.titulos, c), imp = g.impresso[c]; return { coluna: c, soma: s, impresso: imp, diferenca: imp == null ? null : r2(s - imp) }; });
    var incoerentes = g.titulos.filter(function (t) { return !tituloCoerente(t); }).map(function (t) { return t.id; });
    var comTotal = colunas.filter(function (c) { return c.impresso != null; });
    var regImp = g.registros == null ? null : g.registros;
    var faltaLinha = regImp != null && regImp !== g.titulos.length;
    var situacao = faltaLinha || incoerentes.length || comTotal.some(function (c) { return !igual(c.diferenca || 0, 0); }) ? 'diverge' : comTotal.length === 0 ? 'sem-total' : 'ok';
    return { colunas: colunas, incoerentes: incoerentes, situacao: situacao };
  }
  /**
   * Leitura errada (dígito trocado no PDF, mora e desconto em colunas
   * trocadas): numa linha que não fecha consigo mesma (cobrado ≠ valor + mora
   * + outros − desconto), num grupo que não bate com o total impresso, tenta
   * as correções óbvias — o valor pelo cobrado, o cobrado pelo valor, ou mora
   * e desconto trocados — e só aplica a combinação que faz o grupo BATER com
   * o impresso. Sem total impresso não há contra o que conferir: não mexe.
   * -> { rel (novo), correcoes: [{ nf, sacado, campo, antes, depois }] }
   */
  function corrigirLeitura(rel) {
    var correcoes = [];
    var grupos = rel.grupos.map(function (g) {
      var c = conferirGrupo(g);
      if (c.situacao !== 'diverge' || !c.incoerentes.length || c.incoerentes.length > 6) return g;
      var ops = c.incoerentes.map(function (id) {
        var t = g.titulos.find(function (x) { return x.id === id; });
        var cands = [];
        if (t.cobrado != null) cands.push({ valor: r2(t.cobrado - t.mora - t.outros + t.desconto) });
        cands.push({ cobrado: r2(t.valor + t.mora + t.outros - t.desconto) });
        if (t.mora !== t.desconto) cands.push({ mora: t.desconto, desconto: t.mora });
        return { id: id, cands: cands.filter(function (m) { return Object.keys(m).every(function (k) { return m[k] >= 0; }); }) };
      });
      var achou = null;
      (function tentar(i, escolha) {
        if (achou) return;
        if (i === ops.length) {
          var ts = g.titulos.map(function (t) { var e = escolha[t.id]; return e ? Object.assign({}, t, e) : t; });
          var gg = Object.assign({}, g, { titulos: ts });
          if (conferirGrupo(gg).situacao === 'ok') achou = { g: gg, escolha: Object.assign({}, escolha) };
          return;
        }
        ops[i].cands.forEach(function (m) { escolha[ops[i].id] = m; tentar(i + 1, escolha); delete escolha[ops[i].id]; });
      })(0, {});
      if (!achou) return g;
      g.titulos.forEach(function (t) {
        var m = achou.escolha[t.id];
        if (!m) return;
        Object.keys(m).forEach(function (k) { if (!igual(t[k], m[k])) correcoes.push({ id: t.id, nf: t.nf, sacado: t.sacado, campo: k, antes: t[k], depois: m[k] }); });
      });
      achou.g.titulos = achou.g.titulos.map(function (t) {
        return achou.escolha[t.id] ? Object.assign({}, t, { corrigido: true, aviso: undefined }) : t;
      });
      return achou.g;
    });
    return { rel: Object.assign({}, rel, { grupos: grupos }), correcoes: correcoes };
  }
  function temTotalImpresso(r) {
    var algum = function (t) { return Object.keys(t).some(function (k) { return t[k] != null; }); };
    return r.grupos.some(function (g) { return algum(g.impresso) || g.registros != null; }) || algum(r.totalGeral) || r.registrosGeral != null;
  }

  // ─── leitura do relatório do banco ────────────────────────────────────────
  var EXTENSOES_BANCO = ['.pdf', '.csv', '.xls', '.xlsx', '.txt'];
  function campoDoCabecalho(h) {
    var s = normalizarTexto(h);
    if (!s) return null;
    if (/nosso/.test(s)) return 'nosso';
    if (/seu n|^(n )?documento|^nf\b|nota fiscal/.test(s)) return 'seu';
    if (/sacado|pagador|cliente/.test(s)) return 'sacado';
    if (/venc/.test(s)) return 'vencimento';
    if (/mora|juros/.test(s)) return 'mora';
    if (/desc|abatim/.test(s)) return 'desconto';
    if (/outros|acresc/.test(s)) return 'outros';
    if (/cobrado|pago|recebido/.test(s)) return 'cobrado';
    if (/liquida|^(dt|data) (liq|pag|cred)/.test(s)) return 'liquidacao';
    if (/valor|vlr/.test(s)) return 'valor';
    return null;
  }
  var ehBaixa = function (n) { return /baixa/.test(n) && /(cedente|pedido)/.test(n); };
  var ehTotalGeral = function (n) { return /total/.test(n) && /(liquidados|geral)/.test(n); };

  function montar(blocos, totalGeral, ignorados, avisos, registrosGeral) {
    if (registrosGeral === undefined) registrosGeral = null;
    var lista = blocos.filter(function (b) { return b.titulos.length; });
    var algumTotal = lista.some(function (b) { return Object.keys(b.impresso).some(function (k) { return b.impresso[k] != null; }); });
    if (!algumTotal) {
      var ts = [].concat.apply([], lista.map(function (b) { return b.titulos; }));
      var datas = uniq(ts.map(function (t) { return t.liquidacao; })).sort(function (a, b) { return ordemData(a) - ordemData(b); });
      lista = datas.map(function (d) { return { titulos: ts.filter(function (t) { return t.liquidacao === d; }), impresso: vazios() }; });
      var geral = registrosGeral != null || Object.keys(totalGeral).some(function (k) { return totalGeral[k] != null; });
      if (ts.length) avisos.push('O relatório não trouxe "Total de Valores do grupo": separei os grupos por dia de liquidação. '
        + (geral ? 'Confira os totais de cada dia.' : 'Sem nenhum total impresso, não há contra o que conferir.'));
    }
    var grupos = lista.map(function (b, i) { return { id: i + 1, rotulo: b.rotulo, titulos: b.titulos, impresso: b.impresso, registros: b.registros == null ? null : b.registros }; });
    var rel = { grupos: grupos, totalGeral: totalGeral, registrosGeral: registrosGeral, ignorados: ignorados, avisos: avisos };
    var semData = [].concat.apply([], grupos.map(function (g) { return g.titulos; })).filter(function (t) { return !t.liquidacao; }).length;
    if (semData) avisos.push(semData + ' título(s) sem data de liquidação: eles saem sem data no arquivo.');
    return rel;
  }

  function textoDaCelula(v) { if (v == null) return ''; if (v instanceof Date) return v.toISOString(); return String(v).trim(); }

  /** Relatório a partir das linhas de uma planilha (XLSX.utils.sheet_to_json com header:1). */
  function lerRelatorioLinhas(linhas) {
    var mapa = null, blocos = [], bloco = { titulos: [], impresso: vazios() }, totalGeral = vazios();
    var ignorando = false, ignorados = 0, id = 1;
    var cel = function (l, k) { return mapa && mapa[k] != null ? l[mapa[k]] : null; };
    var totais = function (l) { return { valor: dinheiro(cel(l, 'valor')), mora: dinheiro(cel(l, 'mora')), desconto: dinheiro(cel(l, 'desconto')), outros: dinheiro(cel(l, 'outros')), cobrado: dinheiro(cel(l, 'cobrado')) }; };
    linhas.forEach(function (l) {
      l = l || [];
      var n = normalizarTexto(l.map(textoDaCelula).join(' '));
      if (!n) return;
      var cab = {};
      l.forEach(function (c, i) { var k = campoDoCabecalho(c); if (k && cab[k] == null) cab[k] = i; });
      if (cab.seu != null && cab.valor != null && Object.keys(cab).length >= 3) { mapa = cab; return; }
      if (ehBaixa(n)) { ignorando = true; return; }
      if (!mapa) return;
      if (/total/.test(n)) {
        if (ehTotalGeral(n)) { totalGeral = totais(l); ignorando = false; return; }
        if (ignorando) return;
        bloco.impresso = totais(l); blocos.push(bloco); bloco = { titulos: [], impresso: vazios() };
        return;
      }
      var seu = textoDaCelula(cel(l, 'seu')), valor = dinheiro(cel(l, 'valor'));
      if (!seu || valor == null) { if (/liquida/.test(n)) ignorando = false; return; }
      if (ignorando) { ignorados++; return; }
      bloco.titulos.push({
        id: id++, sacado: textoDaCelula(cel(l, 'sacado')), nossoNumero: textoDaCelula(cel(l, 'nosso')), nf: seu, valor: valor,
        mora: dinheiro(cel(l, 'mora')) || 0, desconto: dinheiro(cel(l, 'desconto')) || 0, outros: dinheiro(cel(l, 'outros')) || 0,
        liquidacao: dataBR(cel(l, 'liquidacao')), cobrado: dinheiro(cel(l, 'cobrado'))
      });
    });
    blocos.push(bloco);
    if (!mapa) throw new Error('Não achei o cabeçalho do relatório (colunas como Sacado, Seu Número e Valor).');
    return montar(blocos, totalGeral, ignorados, []);
  }

  var RE_DATA = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
  var RE_DINHEIRO = /(?<![\d.,])-?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d,])/g;
  var RE_INTEIRO = /(?<![\w,])\d[\d\-/.]*\d(?![\w,])|(?<![\w,.])\d(?![\w,.])/g;
  var PADROES_CABECALHO = [
    ['sacado', /sacado|pagador/], ['nosso', /nosso/], ['seu', /seu n/], ['vencimento', /venc/],
    ['valor', /\bvalor\b(?! cobrado| pago| liquid)|vlr (titulo|nominal)/], ['mora', /mora|juros/], ['desconto', /desc|abatim/], ['outros', /outros/],
    ['liquidacao', /liquida/], ['cobrado', /cobrado|pago|recebido/]
  ];
  function ordemDoCabecalho(linha) {
    var n = normalizarTexto(linha);
    if (!/(sacado|pagador)/.test(n) || !/(valor|vlr)/.test(n)) return null;
    var pos = {};
    PADROES_CABECALHO.forEach(function (p) { var m = n.match(p[1]); if (m && m.index != null) pos[p[0]] = m.index; });
    var ord = function (ks) { return ks.filter(function (k) { return pos[k] != null; }).sort(function (a, b) { return pos[a] - pos[b]; }); };
    return { dinheiro: ord(['valor', 'mora', 'desconto', 'outros', 'cobrado']), datas: ord(['vencimento', 'liquidacao']), inteiros: ord(['nosso', 'seu']) };
  }
  function distribuir(valores, ordem) {
    var t = vazios();
    if (ordem && ordem.dinheiro.length === valores.length) { ordem.dinheiro.forEach(function (c, i) { t[c] = valores[i]; }); return { t: t, adivinhado: false }; }
    if (!valores.length) return { t: t, adivinhado: false };
    t.valor = valores[0];
    if (valores.length >= 4) { t.mora = valores[1]; t.desconto = valores[2]; t.cobrado = valores[valores.length - 1]; }
    else if (valores.length >= 2) {
      t.cobrado = valores[valores.length - 1];
      var meio = valores.length === 3 ? valores[1] : Math.abs(r2(t.cobrado - t.valor));
      if (t.cobrado > t.valor) t.mora = meio; else if (t.cobrado < t.valor) t.desconto = meio;
    }
    return { t: t, adivinhado: valores.length > 1 };
  }
  function dinheiros(linha) { return (linha.match(RE_DINHEIRO) || []).map(function (s) { return dinheiro(s); }); }
  function tituloDaLinha(linha, ordem, id) {
    var datas = linha.match(RE_DATA) || [];
    var valores = dinheiros(linha);
    if (!datas.length || !valores.length) return null;
    var resto = linha.replace(RE_DATA, ' ').replace(RE_DINHEIRO, ' ');
    var inteiros = resto.match(RE_INTEIRO) || [];
    var dist = distribuir(valores, ordem), t = dist.t;
    var liquidacao = datas[datas.length - 1];
    if (ordem && ordem.datas.length === datas.length) { var li = datas[ordem.datas.indexOf('liquidacao')]; if (li != null) liquidacao = li; }
    var nosso = '', seu = '', usados;
    if (ordem && ordem.inteiros.length && inteiros.length >= ordem.inteiros.length) {
      usados = inteiros.slice(-ordem.inteiros.length);
      ordem.inteiros.forEach(function (k, i) { if (k === 'nosso') nosso = usados[i]; else seu = usados[i]; });
    } else if (inteiros.length >= 2) {
      nosso = inteiros.slice().sort(function (a, b) { return b.length - a.length; })[0];
      seu = inteiros.find(function (x) { return x !== nosso; }) || '';
      usados = [nosso, seu];
    } else { seu = inteiros[0] || ''; usados = [seu]; }
    if (!seu) return null;
    var semNumeros = resto;
    usados.forEach(function (u) { semNumeros = semNumeros.replace(u, ' '); });
    var sacado = semNumeros.replace(/R\$/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      id: id, sacado: sacado, nossoNumero: nosso, nf: seu, valor: t.valor, mora: t.mora || 0, desconto: t.desconto || 0, outros: t.outros || 0,
      liquidacao: dataBR(liquidacao), cobrado: t.cobrado,
      aviso: dist.adivinhado ? 'Colunas de valor sem cabeçalho: confira valor, mora, desconto e cobrado.' : undefined
    };
  }
  function lerRelatorioTexto(texto) {
    var blocos = [], bloco = { titulos: [], impresso: vazios() }, totalGeral = vazios();
    var ordem = null, ignorando = false, ignorados = 0, id = 1, avisos = [];
    String(texto || '').split(/\r?\n/).forEach(function (linha) {
      var n = normalizarTexto(linha);
      if (!n) return;
      var cab = ordemDoCabecalho(linha);
      if (cab) { if (!ignorando) ordem = cab; return; }
      if (ehBaixa(n)) { ignorando = true; return; }
      if (/total/.test(n)) {
        var t = distribuir(dinheiros(linha), ordem).t;
        if (ehTotalGeral(n)) { totalGeral = t; ignorando = false; return; }
        if (ignorando) return;
        bloco.impresso = t; blocos.push(bloco); bloco = { titulos: [], impresso: vazios() };
        return;
      }
      var titulo = tituloDaLinha(linha, ordem, id);
      if (!titulo) { if (/liquida/.test(n) && !dinheiros(linha).length) ignorando = false; return; }
      if (ignorando) { ignorados++; return; }
      id++;
      bloco.titulos.push(titulo);
    });
    blocos.push(bloco);
    if (!ordem) avisos.push('Não achei a linha de cabeçalho (Sacado, Valor…): as colunas foram adivinhadas. Confira linha a linha.');
    return montar(blocos, totalGeral, ignorados, avisos);
  }

  // PDF por posição (Sicoob "Relatório - Títulos por Período"): cada coluna é um
  // bloco de texto; o cabeçalho diz onde fica cada coluna e cada "Seu Número" é
  // uma linha da tabela. Itens: { texto, x, y (de cima pra baixo), largura }.
  var centro = function (i) { return i.x + i.largura / 2; };
  function colunasDoCabecalho(itens) {
    var cols = [];
    itens.forEach(function (it) {
      var ps = it.texto.split(/(?=Vlr\.)/).filter(function (p) { return p.trim(); });
      var ini = 0;
      ps.forEach(function (p) {
        var x0 = it.x + (it.largura * ini) / it.texto.length, x1 = it.x + (it.largura * (ini + p.length)) / it.texto.length;
        cols.push({ campo: campoDoCabecalho(p), centro: (x0 + x1) / 2 });
        ini += p.length;
      });
    });
    return cols;
  }
  function colunaDe(it, cols) {
    var melhor = null;
    cols.forEach(function (c) { if (!melhor || Math.abs(c.centro - centro(it)) < Math.abs(melhor.centro - centro(it))) melhor = c; });
    return melhor ? melhor.campo : null;
  }
  var ehSecao = function (t) { return /^\d+\s*-\s*\S/.test(t.trim()) && /(liquida|baixa)/.test(normalizarTexto(t)); };
  var ehCabecalhoPdf = function (t) { return normalizarTexto(t) === 'sacado'; };
  var ehTotalPdf = function (t) { return /^total de (valores|registros)/.test(normalizarTexto(t)); };
  function relatorioDosItens(paginas) {
    var blocos = [], bloco = { titulos: [], impresso: vazios() }, totalGeral = vazios(), registrosGeral = null;
    var cols = null, colsLiquidacao = null, ignorando = false, ignorados = 0, id = 1, achouCabecalho = false, avisos = [];
    paginas.forEach(function (pagina) {
      var itens = pagina.filter(function (i) { return i.texto.trim(); }).sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      var marcos = itens.filter(function (i) { return ehSecao(i.texto) || ehCabecalhoPdf(i.texto) || ehTotalPdf(i.texto); });
      marcos.forEach(function (m, k) {
        var n = normalizarTexto(m.texto);
        if (ehSecao(m.texto)) {
          var rotulo = m.texto.trim();
          if (rotulo !== bloco.rotulo) { if (bloco.titulos.length) blocos.push(bloco); bloco = { titulos: [], impresso: vazios(), rotulo: rotulo }; }
          ignorando = ehBaixa(n);
          return;
        }
        if (ehTotalPdf(m.texto)) {
          var perto = itens.filter(function (i) { return i !== m && Math.abs(i.y - m.y) <= 6 && i.x > m.x; });
          if (/registros/.test(n)) {
            var qtd = perto.map(function (i) { return i.texto.trim(); }).find(function (t) { return /^\d+$/.test(t); });
            if (qtd == null || /baixados/.test(n)) return;
            if (/liquidados/.test(n)) registrosGeral = +qtd;
            else if (!ignorando && blocos.length && blocos[blocos.length - 1].rotulo === bloco.rotulo) blocos[blocos.length - 1].registros = +qtd;
            return;
          }
          var valorIt = perto.find(function (i) { return dinheiro(i.texto) != null && /,\d{2}$/.test(i.texto.trim()); });
          if (!valorIt || /baixados/.test(n)) return;
          var campo = (colsLiquidacao && colunaDe(valorIt, colsLiquidacao)) || 'cobrado';
          var c = ['valor', 'mora', 'desconto', 'outros'].indexOf(campo) > -1 ? campo : 'cobrado';
          if (/liquidados/.test(n)) { totalGeral[c] = dinheiro(valorIt.texto); return; }
          if (ignorando) return;
          bloco.impresso[c] = dinheiro(valorIt.texto);
          blocos.push(bloco);
          bloco = { titulos: [], impresso: vazios(), rotulo: bloco.rotulo };
          return;
        }
        achouCabecalho = true;
        cols = colunasDoCabecalho(itens.filter(function (i) { return Math.abs(i.y - m.y) <= 8 && !ehSecao(i.texto); }));
        if (!ignorando) colsLiquidacao = cols;
        var fim = k + 1 < marcos.length ? marcos[k + 1].y - 2 : Infinity;
        var regiao = itens.filter(function (i) { return i.y > m.y + 8 && i.y < fim; });
        var cc = cols;
        var ancoras = regiao.filter(function (i) { return colunaDe(i, cc) === 'seu' && /\d/.test(i.texto); });
        var linhas = ancoras.map(function (a) { return { a: a, partes: [] }; });
        regiao.forEach(function (it) {
          if (ancoras.indexOf(it) > -1) return;
          var melhor = null;
          linhas.forEach(function (l) { if (!melhor || Math.abs(l.a.y - it.y) < Math.abs(melhor.a.y - it.y)) melhor = l; });
          var cp = colunaDe(it, cc);
          if (melhor && cp && Math.abs(melhor.a.y - it.y) <= 12) melhor.partes.push({ campo: cp, it: it });
        });
        linhas.forEach(function (l) {
          if (ignorando) { ignorados++; return; }
          var de = function (k2) {
            return l.partes.filter(function (p) { return p.campo === k2; }).sort(function (x, y) { return x.it.y - y.it.y || x.it.x - y.it.x; })
              .map(function (p) { return p.it.texto.trim(); }).join(' ');
          };
          var valor = dinheiro(de('valor'));
          if (valor == null) { avisos.push('Linha do Seu Número ' + l.a.texto.trim() + ' sem valor: confira no PDF.'); return; }
          bloco.titulos.push({
            id: id++, sacado: de('sacado'), nossoNumero: de('nosso'), nf: l.a.texto.trim(), valor: valor,
            mora: dinheiro(de('mora')) || 0, desconto: dinheiro(de('desconto')) || 0, outros: dinheiro(de('outros')) || 0,
            liquidacao: dataBR(de('liquidacao')), cobrado: dinheiro(de('cobrado'))
          });
        });
      });
    });
    if (!achouCabecalho) return null;
    if (bloco.titulos.length) blocos.push(bloco);
    return montar(blocos, totalGeral, ignorados, avisos, registrosGeral);
  }
  /** Remonta as linhas do PDF para ler como texto corrido (quando não há cabeçalho por posição). */
  function linhasDosItens(itens) {
    var linhas = [];
    itens.forEach(function (it) {
      if (!it.texto.trim()) return;
      var l = linhas.find(function (x) { return Math.abs(x.y - it.y) <= 2; });
      if (l) l.itens.push(it); else linhas.push({ y: it.y, itens: [it] });
    });
    return linhas.sort(function (a, b) { return a.y - b.y; }).map(function (l) {
      var s = '', fim = -Infinity;
      l.itens.sort(function (a, b) { return a.x - b.x; }).forEach(function (it) {
        var vao = it.x - fim;
        s += s ? (vao > 6 ? '  ' : vao > 0.5 ? ' ' : '') : '';
        s += it.texto.trim();
        fim = it.x + it.largura;
      });
      return s;
    });
  }
  function relatorioDoPdf(paginas) {
    if (!paginas.some(function (p) { return p.length; })) throw new Error('O PDF não tem texto (parece escaneado ou foto). Peça ao banco o PDF exportado.');
    var porPosicao = relatorioDosItens(paginas);
    if (porPosicao && porPosicao.grupos.some(function (g) { return g.titulos.length; })) return porPosicao;
    return lerRelatorioTexto(paginas.map(function (p) { return linhasDosItens(p).join('\n'); }).join('\n'));
  }

  // ─── balancete: contas do layout e contas de clientes ─────────────────────
  var CONTAS_PADRAO = { banco: '10503', juros: '97304', desconto: '85001', histPrincipal: '246', histJuros: '59648', histDesconto: '256' };
  var CONTAS_DO_LAYOUT = ['banco', 'juros', 'desconto'];
  var HISTORICOS = ['histPrincipal', 'histJuros', 'histDesconto'];
  var SEM_BALANCETE = { origem: 'nenhum', contas: [] };
  var CONFIG_VAZIA = { contas: {}, nomes: {}, clientes: {} };
  var txt = function (v) { return v == null ? '' : String(v).trim(); };

  /** balancetes/{código} do Entregas → o balancete como o Creditor vê. */
  function balanceteDoDocumento(doc) {
    if (!doc || !Array.isArray(doc.contas) || !doc.contas.length) return SEM_BALANCETE;
    var contas = doc.contas.map(function (c, i) {
      return { codigo: txt(c && c.codigo), nome: txt(c && c.nome), grupo: txt(c && c.grupo) || undefined, sintetica: !!(c && c.sintetica === true), ordem: c && typeof c.ordem === 'number' ? c.ordem : i };
    }).filter(function (c) { return c.codigo; }).sort(function (x, y) { return x.ordem - y.ordem; });
    return contas.length ? { origem: 'balancete', contas: contas, em: txt(doc.em) || undefined } : SEM_BALANCETE;
  }

  /** creditor/{código} → o que ficou salvo da empresa (contas confirmadas e clientes aprendidos). */
  function configDoDocumento(doc) {
    if (!doc) return { contas: {}, nomes: {}, clientes: {} };
    var contas = {}, nomes = {}, clientes = {};
    var c = doc.contas || {}, n = doc.nomes || {}, cl = doc.clientes || {};
    Object.keys(CONTAS_PADRAO).forEach(function (k) { if (txt(c[k])) contas[k] = txt(c[k]); });
    CONTAS_DO_LAYOUT.forEach(function (k) { if (txt(n[k])) nomes[k] = txt(n[k]); });
    Object.keys(cl).forEach(function (k) {
      var v = cl[k], conta = v && v.conta != null ? String(v.conta).trim() : '';
      if (k && conta) clientes[k] = { conta: conta, nome: String(v.nome || k), em: String(v.em || '') };
    });
    return { contas: contas, nomes: nomes, clientes: clientes, atualizadoEm: txt(doc.atualizadoEm) || undefined };
  }

  var REGRAS = {
    // o relatório de liquidação é do Sicoob
    banco: { quer: [/\bsicoob\b/], evita: /\b(aplicac|capital|cotas?|emprestimo|financiamento|tarifas?|juros|consorcio)/, grupo: 'Ativo' },
    juros: { quer: [/\bjuros (recebidos|ativos|auferidos|s recebimento)/, /\bjuros\b/], evita: /\b(pagos|passivos|incorridos|a pagar|a apropriar|a transcorrer|sobre emprestimo)/, grupo: 'Receita' },
    desconto: { quer: [/\bdescontos? (financeiros? )?concedidos?\b/, /\bdescontos?\b/], evita: /\b(obtidos?|a apropriar|duplicatas descontadas|incondicionais)/, grupo: 'Despesa' }
  };
  function sugerirConta(campo, contas) {
    var r = REGRAS[campo];
    var cand = contas.filter(function (c) { return !c.sintetica && (!c.grupo || c.grupo === r.grupo || c.grupo === 'Outros') && !r.evita.test(nomeNorm(c.nome)); });
    for (var i = 0; i < r.quer.length; i++) {
      var q = r.quer[i], achou = cand.find(function (c) { return q.test(nomeNorm(c.nome)); });
      if (achou) return achou;
    }
    return null;
  }
  var ROTULO_CONTA = { banco: 'conta banco', juros: 'conta de juros', desconto: 'conta de descontos' };
  function resolverUma(campo, bal, cfg) {
    var salva = cfg.contas[campo];
    var noBal = function (cod) { return bal.contas.find(function (c) { return c.codigo === cod; }) || null; };
    if (salva) {
      if (bal.origem === 'nenhum') return { codigo: salva, nome: cfg.nomes[campo] || null, origem: 'salva', bloqueia: false };
      var c = noBal(salva);
      if (!c) return { codigo: salva, nome: null, origem: 'salva', bloqueia: true, aviso: 'A ' + ROTULO_CONTA[campo] + ' salva (' + salva + (cfg.nomes[campo] ? ' – ' + cfg.nomes[campo] : '') + ') não está no balancete atual. Escolha outra.' };
      var antes = cfg.nomes[campo];
      return { codigo: salva, nome: c.nome, origem: 'salva', bloqueia: false, aviso: antes && nomeNorm(antes) !== nomeNorm(c.nome) ? 'Mudou de nome no balancete: era "' + antes + '".' : undefined };
    }
    if (bal.origem === 'nenhum') return { codigo: CONTAS_PADRAO[campo], nome: null, origem: 'padrao', bloqueia: false };
    var s = sugerirConta(campo, bal.contas);
    if (s) return { codigo: s.codigo, nome: s.nome, origem: 'sugerida', bloqueia: false };
    return { codigo: '', nome: null, origem: 'falta', bloqueia: true, aviso: 'Não achei a ' + ROTULO_CONTA[campo] + ' no balancete. Escolha na lista.' };
  }
  function resolverContas(bal, cfg) {
    var detalhe = { banco: resolverUma('banco', bal, cfg), juros: resolverUma('juros', bal, cfg), desconto: resolverUma('desconto', bal, cfg) };
    var contas = { banco: detalhe.banco.codigo, juros: detalhe.juros.codigo, desconto: detalhe.desconto.codigo };
    HISTORICOS.forEach(function (k) { contas[k] = cfg.contas[k] || CONTAS_PADRAO[k]; });
    return { contas: contas, detalhe: detalhe };
  }
  function escolherConta(cfg, campo, codigo, bal) {
    var v = String(codigo || '').trim(), contas = Object.assign({}, cfg.contas), nomes = Object.assign({}, cfg.nomes);
    if (v) contas[campo] = v; else delete contas[campo];
    if (CONTAS_DO_LAYOUT.indexOf(campo) > -1) {
      var c = v ? bal.contas.find(function (x) { return x.codigo === v; }) : null;
      if (c) nomes[campo] = c.nome; else delete nomes[campo];
    }
    return Object.assign({}, cfg, { contas: contas, nomes: nomes });
  }
  /** baixar o arquivo confirma: as sugeridas passam a ser salvas */
  function confirmarContas(cfg, r) {
    var contas = Object.assign({}, cfg.contas), nomes = Object.assign({}, cfg.nomes);
    CONTAS_DO_LAYOUT.forEach(function (k) {
      var d = r.detalhe[k];
      if (d.origem === 'sugerida') contas[k] = d.codigo;
      if ((d.origem === 'sugerida' || d.origem === 'salva') && d.nome) nomes[k] = d.nome;
    });
    return Object.assign({}, cfg, { contas: contas, nomes: nomes });
  }

  /** Sintética que abre as contas de clientes. */
  var SECAO_CLIENTES = /\bclientes?\b|duplicatas? a receber|contas? a receber/;
  function contasDeClientes(b) {
    if (!b.contas.some(function (c) { return c.sintetica; })) return b.contas;
    var saida = [], naSecao = false;
    b.contas.forEach(function (c) {
      if (c.sintetica) { naSecao = SECAO_CLIENTES.test(nomeNorm(c.nome)); return; }
      if (naSecao) saida.push(c);
    });
    return saida;
  }

  // ─── o cliente de cada título ─────────────────────────────────────────────
  var VAZIAS = { ltda: 1, me: 1, epp: 1, eireli: 1, sa: 1, s: 1, a: 1, de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, cia: 1 };
  function palavrasDoNome(n) { return nomeNorm(n).split(' ').filter(function (p) { return p && !VAZIAS[p]; }); }
  /** "TAI1", "PA3", "AL2": código de filial que o banco e o plano põem no fim do nome */
  var ehFilial = function (p) { return /^[a-z]{1,4}\d{1,2}$/.test(p); };
  var mesmaPalavra = function (a, b) { return a === b || (!ehFilial(a) && !ehFilial(b) && Math.min(a.length, b.length) >= 2 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)); };
  function filiaisDoNome(n) { return palavrasDoNome(n).filter(ehFilial); }

  /**
   * Quanto o nome do sacado parece o nome da conta (0 a 1): as palavras que
   * batem sobre as do nome mais comprido. Filial diferente ("-TAI1" × "PA3")
   * não é o mesmo cliente: 0. semFilial = compara sem as filiais (para achar a
   * conta principal quando a filial do banco não tem conta).
   */
  function semelhancaDeNome(sacado, conta, semFilial) {
    var a = palavrasDoNome(sacado), b = palavrasDoNome(conta);
    var fa = a.filter(ehFilial), fb = b.filter(ehFilial);
    if (!semFilial && fa.length && fb.length && !fa.some(function (x) { return fb.indexOf(x) > -1; })) return 0;
    if (semFilial || !fa.length || !fb.length) { a = a.filter(function (p) { return !ehFilial(p); }); b = b.filter(function (p) { return !ehFilial(p); }); }
    if (!a.length || !b.length) return 0;
    var livres = b.slice(), bate = 0;
    a.forEach(function (p) {
      var i = livres.findIndex(function (q) { return mesmaPalavra(p, q); });
      if (i >= 0) { bate++; livres.splice(i, 1); }
    });
    return bate / Math.max(a.length, b.length);
  }
  var SEMELHANCA_MINIMA = 0.6;

  /** As contas mais parecidas com o sacado (as do topo) e a nota delas. */
  function maisParecidas(sacado, clientes, semFilial) {
    // a conta da mesma filial do banco passa na frente da conta sem filial
    var fs = semFilial ? [] : filiaisDoNome(sacado);
    var daFilial = function (c) { return fs.length && filiaisDoNome(c.nome).some(function (x) { return fs.indexOf(x) > -1; }) ? 1 : 0; };
    var notas = clientes.map(function (c) { var n = semelhancaDeNome(sacado, c.nome, semFilial); return { c: c, n: n >= SEMELHANCA_MINIMA ? n + daFilial(c) : 0 }; }).filter(function (x) { return x.n >= SEMELHANCA_MINIMA; });
    var topo = Math.max.apply(null, [0].concat(notas.map(function (x) { return x.n; })));
    var contas = [], vistos = {};
    notas.filter(function (x) { return x.n === topo; }).forEach(function (x) { if (!vistos[x.c.codigo]) { vistos[x.c.codigo] = 1; contas.push(x.c); } });
    return { contas: contas, topo: topo };
  }
  /** A conta principal do cliente: a sem filial no nome; sem ela, a primeira do plano. */
  function contaPrincipal(contas) {
    var porOrdem = contas.slice().sort(function (x, y) { return (x.ordem || 0) - (y.ordem || 0); });
    return porOrdem.find(function (c) { return !filiaisDoNome(c.nome).length; }) || porOrdem[0] || null;
  }

  // ─── aprendizado ──────────────────────────────────────────────────────────
  var chaveDoCliente = function (sacado) { return nomeNorm(sacado); };
  function contaAprendida(aprendidos, sacado) {
    var k = chaveDoCliente(sacado);
    if (!k) return null;
    if (aprendidos[k]) return aprendidos[k];
    var parecidos = Object.keys(aprendidos).filter(function (x) { return x.length >= 6 && k.length >= 6 && (x.indexOf(k) > -1 || k.indexOf(x) > -1); });
    var contas = uniq(parecidos.map(function (x) { return aprendidos[x].conta; }));
    return parecidos.length && contas.length === 1 ? aprendidos[parecidos[0]] : null;
  }

  /**
   * Cruza cada título com as contas de clientes do balancete e as aprendidas.
   * situacao: 'ok' (tem conta) ou 'nao-encontrada' (a pessoa informa ou exclui).
   * principal: a conta é a principal do cliente (a filial do banco não tem conta,
   * ou o banco não diz a filial); opcoes: as outras contas do cliente, pra trocar.
   */
  function cruzarPeloBalancete(titulos, clientes, aprendidos) {
    return titulos.map(function (t) {
      var base = { tituloId: t.id, valorBanco: t.valor };
      var linha = function (conta, nome) { return { contrapartida: conta, cliente: nome }; };
      var opcoesDe = function (cs) { return cs.map(function (c) { return { codigo: c.codigo, nome: c.nome }; }); };
      var aprendida = contaAprendida(aprendidos, t.sacado);
      var p = maisParecidas(t.sacado, clientes, false);
      var codigos = p.contas.map(function (c) { return c.codigo; });
      var aprendidaNota = function (cods) { return aprendida && cods.indexOf(aprendida.conta) > -1 ? ' Da última vez: ' + aprendida.conta + '.' : ''; };

      // O nome bate em várias contas (uma por filial) e o banco não diz qual:
      // vai na principal; as outras ficam de opção.
      if (codigos.length > 1) {
        var pr = contaPrincipal(p.contas);
        return Object.assign({}, base, {
          situacao: 'ok', linha: linha(pr.codigo, pr.nome), principal: true, opcoes: opcoesDe(p.contas),
          nota: 'O cliente tem ' + codigos.length + ' contas com esse nome (uma por filial) e o banco não diz a filial: vai na conta principal, ' + pr.codigo + '.' + aprendidaNota(codigos)
        });
      }
      if (aprendida) {
        var doBal = clientes.find(function (c) { return c.codigo === aprendida.conta; });
        return Object.assign({}, base, { situacao: 'ok', linha: linha(aprendida.conta, doBal ? doBal.nome : aprendida.nome), nota: 'Conta aprendida do cliente.', aprendida: true });
      }
      var fil = filiaisDoNome(t.sacado);
      if (codigos.length === 1) {
        var so = p.contas[0];
        // o banco diz a filial e a única conta é a sem filial: é a principal
        if (fil.length && !filiaisDoNome(so.nome).length) {
          return Object.assign({}, base, { situacao: 'ok', linha: linha(so.codigo, so.nome), principal: true, nota: 'A filial ' + fil.join(' ').toUpperCase() + ' não tem conta no balancete: vai na conta principal do cliente, ' + so.codigo + '.' });
        }
        return Object.assign({}, base, { situacao: 'ok', linha: linha(so.codigo, so.nome), nota: p.topo < 1 ? 'Pelo nome parecido: ' + so.nome + '.' : '' });
      }
      // Nada com a mesma filial: o banco diz uma filial que não tem conta no
      // balancete. O cliente existe (sem olhar a filial)? Conta principal dele.
      if (fil.length) {
        var sf = maisParecidas(t.sacado, clientes, true);
        if (sf.contas.length) {
          var pr2 = contaPrincipal(sf.contas);
          return Object.assign({}, base, {
            situacao: 'ok', linha: linha(pr2.codigo, pr2.nome), principal: true, opcoes: sf.contas.length > 1 ? opcoesDe(sf.contas) : undefined,
            nota: 'A filial ' + fil.join(' ').toUpperCase() + ' não tem conta no balancete: vai na conta principal do cliente, ' + pr2.codigo + '.'
          });
        }
      }
      return Object.assign({}, base, { situacao: 'nao-encontrada', linha: null, nota: 'Cliente sem conta com esse nome no balancete. Informe a conta (fica aprendida).' });
    });
  }

  // ─── decisões e lançamentos ───────────────────────────────────────────────
  // decisao: { tipo: 'manual', contrapartida, historico } | { tipo: 'excluir' }
  function precisaDecisao(c) { return c.situacao === 'nao-encontrada'; }
  function decisaoValida(c, d) {
    if (!d) return false;
    if (d.tipo === 'excluir') return true;
    if (d.tipo === 'manual') return !!String(d.contrapartida || '').trim();
    return false;
  }
  function pendentes(cruzamentos, decisoes) {
    return cruzamentos.filter(function (c) { return precisaDecisao(c) && !decisaoValida(c, decisoes[c.tituloId]); });
  }
  /** A pessoa informou antes: resolve sozinho os sem conta (a decisão da pessoa vence). */
  function decisoesAprendidas(titulos, cruzamentos, aprendidos, daPessoa) {
    var porId = {}; titulos.forEach(function (t) { porId[t.id] = t; });
    var saida = {};
    cruzamentos.forEach(function (c) {
      if (c.situacao !== 'nao-encontrada' || daPessoa[c.tituloId]) return;
      var t = porId[c.tituloId], a = t && contaAprendida(aprendidos, t.sacado);
      if (a) saida[c.tituloId] = { tipo: 'manual', contrapartida: a.conta, historico: '' };
    });
    return saida;
  }
  /**
   * O que a conciliação ensina: a conta de cada título que entrou no arquivo. A
   * conta principal posta sozinha não ensina (senão, quando a filial ganhar
   * conta no balancete, a aprendida seguiria mandando pra principal).
   */
  function aprender(atuais, titulos, cruzamentos, decisoes, agora) {
    var porId = {}; titulos.forEach(function (t) { porId[t.id] = t; });
    var novo = Object.assign({}, atuais);
    cruzamentos.forEach(function (c) {
      var t = porId[c.tituloId], k = t && chaveDoCliente(t.sacado);
      if (!t || !k) return;
      var d = decisoes[c.tituloId], conta = '';
      if (d && d.tipo === 'excluir') return;
      if (d && d.tipo === 'manual' && decisaoValida(c, d)) conta = d.contrapartida.trim();
      else if (c.linha && c.situacao === 'ok' && !c.principal) conta = c.linha.contrapartida.trim();
      if (conta) novo[k] = { conta: conta, nome: t.sacado.trim(), em: agora.toISOString() };
    });
    return novo;
  }
  function mesmosClientes(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return b[k] && b[k].conta === a[k].conta && b[k].nome === a[k].nome; });
  }
  function mesmaConfig(a, b) {
    var igualObj = function (x, y) { return uniq(Object.keys(x).concat(Object.keys(y))).every(function (k) { return (x[k] || '') === (y[k] || ''); }); };
    return igualObj(a.contas, b.contas) && igualObj(a.nomes, b.nomes);
  }

  function historicoNfCliente(t) { return (chaveNf(t.nf) || t.nf) + ' - ' + String(t.sacado || '').trim(); }
  function origemDoTitulo(c, d) {
    if (d && d.tipo === 'excluir') return null;
    if (d && d.tipo === 'manual' && decisaoValida(c, d)) return { contrapartida: d.contrapartida.trim(), historico: String(d.historico || '').trim() };
    if (c.situacao === 'ok' && c.linha) return { contrapartida: c.linha.contrapartida, historico: '' };
    return null;
  }
  function titulosFora(titulos, cruzamentos, decisoes) {
    var porId = {}; cruzamentos.forEach(function (c) { porId[c.tituloId] = c; });
    return titulos.filter(function (t) { var c = porId[t.id]; return !c || !origemDoTitulo(c, decisoes[t.id]); });
  }
  /**
   * A) principal: D banco, C cliente, valor cheio da NF;
   * B) mora + outros acréscimos: D banco, C juros;  C) desconto: D desconto, C banco.
   * Em ordem de liquidação e, no dia, na ordem do relatório.
   */
  function gerarLancamentos(titulos, cruzamentos, decisoes, contas) {
    var porId = {}; cruzamentos.forEach(function (c) { porId[c.tituloId] = c; });
    var ordem = titulos.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) { return ordemData(a.t.liquidacao) - ordemData(b.t.liquidacao) || a.i - b.i; });
    var saida = [];
    ordem.forEach(function (x) {
      var t = x.t, c = porId[t.id], o = c && origemDoTitulo(c, decisoes[t.id]);
      if (!o) return;
      var comum = { automatico: '', data: t.liquidacao, documento: chaveNf(t.nf), tituloId: t.id };
      saida.push(Object.assign({}, comum, { tipo: 'principal', debito: contas.banco, credito: o.contrapartida, codHistorico: contas.histPrincipal, historico: o.historico || historicoNfCliente(t), valor: r2(t.valor) }));
      var acres = r2(t.mora + t.outros);
      if (acres > 0) saida.push(Object.assign({}, comum, { tipo: 'mora', debito: contas.banco, credito: contas.juros, codHistorico: contas.histJuros, historico: historicoNfCliente(t), valor: acres }));
      if (t.desconto > 0) saida.push(Object.assign({}, comum, { tipo: 'desconto', debito: contas.desconto, credito: contas.banco, codHistorico: contas.histDesconto, historico: historicoNfCliente(t), valor: r2(t.desconto) }));
    });
    return saida;
  }
  /** A conta banco, dia a dia, contra o que o banco creditou (a última checagem). */
  function fecharPorDia(grupos, lancamentos, fora, contas) {
    var titulos = [].concat.apply([], grupos.map(function (g) { return g.titulos; }));
    var datas = uniq(titulos.map(function (t) { return t.liquidacao; })).sort(function (a, b) { return ordemData(a) - ordemData(b); });
    return datas.map(function (data) {
      var doDia = lancamentos.filter(function (l) { return l.data === data; });
      var debitos = somar(doDia.filter(function (l) { return l.debito === contas.banco; }).map(function (l) { return l.valor; }));
      var creditos = somar(doDia.filter(function (l) { return l.credito === contas.banco; }).map(function (l) { return l.valor; }));
      var liquido = r2(debitos - creditos);
      var gruposDoDia = grupos.filter(function (g) { return g.titulos.some(function (t) { return t.liquidacao === data; }); });
      var soDoDia = gruposDoDia.every(function (g) { return datasDoGrupo(g).length === 1 && g.impresso.cobrado != null && conferirGrupo(g).situacao === 'ok'; });
      var esperado = soDoDia ? somar(gruposDoDia.map(function (g) { return g.impresso.cobrado; })) : somar(titulos.filter(function (t) { return t.liquidacao === data; }).map(liquidoDoTitulo));
      var foraDia = somar(fora.filter(function (t) { return t.liquidacao === data; }).map(liquidoDoTitulo));
      var diferenca = r2(liquido - esperado);
      var situacao = igual(diferenca, 0) ? 'ok' : foraDia > 0 && igual(diferenca, -foraDia) ? 'explicada' : 'diverge';
      return { data: data, debitos: debitos, creditos: creditos, liquido: liquido, esperado: esperado, fonte: soDoDia ? 'impresso' : 'extraido', fora: foraDia, diferenca: diferenca, situacao: situacao };
    });
  }

  // ─── arquivo de importação (.xls de 8 colunas) ────────────────────────────
  var CABECALHO_8_COLUNAS = ['LANC AUTOMÁTICO', 'DATA', 'DÉBITO', 'CRÉDITO', 'COD HISTÓRICO', 'HISTÓRICO', 'VALOR', 'DOCUMENTO'];
  function serialExcel(d) { var m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000 + 25569 : d; }
  var numeroOuTexto = function (s) { return /^\d+$/.test(String(s)) ? Number(s) : s; };
  /** Bytes do .xls (Excel 97-2003); XLSX = a SheetJS. */
  function planilhaDeImportacao(XLSX, lancamentos) {
    var aoa = [CABECALHO_8_COLUNAS.slice()];
    lancamentos.forEach(function (l) { aoa.push([l.automatico, serialExcel(l.data), numeroOuTexto(l.debito), numeroOuTexto(l.credito), numeroOuTexto(l.codHistorico), l.historico, l.valor, numeroOuTexto(l.documento)]); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    for (var r = 1; r < aoa.length; r++) {
      var d = ws[XLSX.utils.encode_cell({ r: r, c: 1 })]; if (d && typeof d.v === 'number') d.z = 'dd/mm/yyyy';
      var v = ws[XLSX.utils.encode_cell({ r: r, c: 6 })]; if (v) v.z = '0.00';
    }
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 48 }, { wch: 12 }, { wch: 12 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Importacao');
    return new Uint8Array(XLSX.write(wb, { bookType: 'biff8', type: 'array' }));
  }
  function nomeDoArquivo(codigo) { return 'creditor_importacao' + (codigo ? '_' + codigo : '') + '.xls'; }

  // ─── o relatório na pasta da empresa no Drive ─────────────────────────────
  // 2026 › <código> - <RAZÃO> › CONTÁBIL › RECEBIMENTO DE CLIENTES (driveIndice)
  function pastaDoCliente(clientes, codigo) {
    if (codigo == null) return null;
    return clientes.find(function (c) { return String(c.codigo == null ? '' : c.codigo).trim() === String(codigo); }) || null;
  }
  function pastaDoRecebimento(itens, raizDoCliente) {
    var filhos = function (p) { return itens.filter(function (it) { return it.p === p && it.t === 'd'; }); };
    var contabil = filhos(raizDoCliente).find(function (it) { return nomeNorm(it.n) === 'contabil'; });
    if (!contabil) return null;
    return filhos(contabil.i).find(function (it) { return /\brecebimentos? (de )?clientes?\b/.test(nomeNorm(it.n)); }) || null;
  }
  function falaDaCompetencia(texto, c) {
    var p = partes(c), t = nomeNorm(texto), aa = String(p.ano).slice(2), mm = '0?' + p.mes, nome = nomeNorm(MESES[p.mes - 1]);
    var anos = '(' + p.ano + '|' + aa + ')';
    return new RegExp('\\b' + mm + ' ?' + anos + '\\b').test(t)
      || new RegExp('\\b' + p.ano + ' ?' + mm + '\\b').test(t)
      || new RegExp('\\b(' + nome + '|' + nome.slice(0, 3) + ') ?' + anos + '\\b').test(t)
      || (new RegExp('\\b' + p.ano + '\\b').test(t) && new RegExp('(^| )(' + mm + '|' + nome + ')( |$)').test(t));
  }
  var EXT_DRIVE = /\.(pdf|xlsx?|csv|txt)$/i;
  function acharRelatorioNoDrive(itens, raizDoCliente, c) {
    if (!raizDoCliente) return { situacao: 'sem-cliente', arquivo: null, candidatos: [] };
    var rec = pastaDoRecebimento(itens, raizDoCliente);
    if (!rec) return { situacao: 'sem-pasta', arquivo: null, candidatos: [] };
    var filhos = {};
    itens.forEach(function (it) { (filhos[it.p] = filhos[it.p] || []).push(it); });
    var achados = [];
    (function andar(pasta, caminho) {
      (filhos[pasta] || []).forEach(function (it) {
        if (it.t === 'd') { andar(it.i, caminho.concat([it.n])); return; }
        if (it.t !== 'f' || !EXT_DRIVE.test(it.n)) return;
        var texto = caminho.concat([it.n]).join(' ');
        achados.push({ id: it.i, nome: it.n, caminho: caminho.concat([it.n]).join(' › '), modificado: it.m, credliquidacao: /cred ?liquid/.test(nomeNorm(it.n)), daCompetencia: falaDaCompetencia(texto, c) });
      });
    })(rec.i, []);
    var maisNovo = function (a, b) { return (b.modificado || '').localeCompare(a.modificado || ''); };
    var cred = achados.filter(function (a) { return a.credliquidacao && a.daCompetencia; }).sort(maisNovo);
    var outros = achados.filter(function (a) { return !a.credliquidacao && a.daCompetencia; }).sort(maisNovo);
    var escolha = cred.length ? cred : outros;
    var resto = achados.filter(function (a) { return !a.daCompetencia; }).sort(function (a, b) { return Number(b.credliquidacao) - Number(a.credliquidacao) || maisNovo(a, b); });
    var candidatos = escolha.concat(cred.length ? outros : [], resto);
    if (escolha.length === 1) return { situacao: 'achou', arquivo: escolha[0], candidatos: candidatos };
    if (escolha.length > 1) return { situacao: 'varios', arquivo: null, candidatos: candidatos };
    return { situacao: 'nada', arquivo: null, candidatos: candidatos };
  }
  function mensagemDaBusca(b, competencia) {
    switch (b.situacao) {
      case 'sem-cliente': return 'A empresa não tem pasta no Drive (a pasta do ano precisa de "<código> - <nome>").';
      case 'sem-pasta': return 'A pasta da empresa no Drive não tem CONTÁBIL › RECEBIMENTO DE CLIENTES.';
      case 'nada': return 'Não achei o relatório de ' + competencia + ' em RECEBIMENTO DE CLIENTES' + (b.candidatos.length ? ': escolha um dos arquivos abaixo ou anexe à mão.' : '. Anexe à mão.');
      case 'varios': return 'Achei mais de um arquivo de ' + competencia + ': escolha qual usar.';
      default: return 'Achei ' + (b.arquivo ? b.arquivo.caminho : '') + '.';
    }
  }

  var EXEMPLO_RELATORIO = [
    'BANCO EXEMPLO S.A. - RELATORIO DE TITULOS LIQUIDADOS',
    'Liquidacao',
    'Sacado  Nosso Numero  Seu Numero  Vencimento  Valor (R$)  Vlr. Mora  Vlr. Desc. Acresc.  Dt. Liquidacao  Vlr. Cobrado',
    'MERCADO BOM PRECO LTDA  00012345671  4521  28/08/2026  1.250,00  12,50  0,00  01/09/2026  1.262,50',
    'PADARIA SAO JORGE ME  00012345682  4533  01/09/2026  830,40  0,00  16,61  01/09/2026  813,79',
    'RESTAURANTE SABOR CASEIRO  00012345693  4540  01/09/2026  2.100,00  0,00  0,00  01/09/2026  2.100,00',
    'Total de Valores do grupo  4.180,40  12,50  16,61  4.176,29',
    'SUPERMERCADO ALVORADA LTDA -TAI1  00012345704  4548  25/08/2026  615,33  0,00  0,00  02/09/2026  615,33',
    'ACOUGUE BOI GORDO  00012345737  4555  02/09/2026  450,00  0,00  0,00  02/09/2026  450,00',
    'Total de Valores do grupo  1.065,33  0,00  0,00  1.065,33',
    'EMPORIO VERDE EIRELI  00012345759  4560  03/09/2026  322,15  0,00  0,00  03/09/2026  322,15',
    'MERCEARIA DOIS IRMAOS  00012345760  4562  03/09/2026  1.480,00  0,00  29,60  03/09/2026  1.450,40',
    'Total de Valores do grupo  1.802,15  0,00  29,60  1.772,55',
    'Baixa - Pedido Cedente',
    'Sacado  Nosso Numero  Seu Numero  Vencimento  Vlr. Baixado',
    'LANCHONETE PONTO CERTO  00012345726  4502  20/08/2026  300,00',
    'Total de Valores Baixados  300,00',
    'Total de Valores Liquidados  7.047,88  12,50  46,21  7.014,17'
  ].join('\n');

  var api = {
    nomeNorm: nomeNorm, brl: brl, r2: r2, igual: igual, somar: somar, chaveNf: chaveNf, dinheiro: dinheiro, dataBR: dataBR, ordemData: ordemData, liquidoDoTitulo: liquidoDoTitulo,
    MESES: MESES, competenciaValida: competenciaValida, competenciaPadrao: competenciaPadrao, rotuloCompetencia: rotuloCompetencia, competenciaPorExtenso: competenciaPorExtenso, titulosForaDaCompetencia: titulosForaDaCompetencia,
    conferirGrupo: conferirGrupo, corrigirLeitura: corrigirLeitura, tituloCoerente: tituloCoerente, temTotalImpresso: temTotalImpresso, TOTAIS_VAZIOS: TOTAIS_VAZIOS,
    EXTENSOES_BANCO: EXTENSOES_BANCO, lerRelatorioLinhas: lerRelatorioLinhas, lerRelatorioTexto: lerRelatorioTexto, relatorioDosItens: relatorioDosItens, linhasDosItens: linhasDosItens, relatorioDoPdf: relatorioDoPdf,
    CONTAS_PADRAO: CONTAS_PADRAO, CONTAS_DO_LAYOUT: CONTAS_DO_LAYOUT, HISTORICOS: HISTORICOS, SEM_BALANCETE: SEM_BALANCETE, CONFIG_VAZIA: CONFIG_VAZIA,
    balanceteDoDocumento: balanceteDoDocumento, configDoDocumento: configDoDocumento, sugerirConta: sugerirConta, resolverContas: resolverContas, escolherConta: escolherConta, confirmarContas: confirmarContas, mesmaConfig: mesmaConfig,
    contasDeClientes: contasDeClientes, semelhancaDeNome: semelhancaDeNome, SEMELHANCA_MINIMA: SEMELHANCA_MINIMA, contaPrincipal: contaPrincipal, cruzarPeloBalancete: cruzarPeloBalancete,
    contaAprendida: contaAprendida, decisoesAprendidas: decisoesAprendidas, aprender: aprender, mesmosClientes: mesmosClientes,
    precisaDecisao: precisaDecisao, decisaoValida: decisaoValida, pendentes: pendentes, historicoNfCliente: historicoNfCliente, titulosFora: titulosFora, gerarLancamentos: gerarLancamentos, fecharPorDia: fecharPorDia,
    CABECALHO_8_COLUNAS: CABECALHO_8_COLUNAS, planilhaDeImportacao: planilhaDeImportacao, nomeDoArquivo: nomeDoArquivo,
    pastaDoCliente: pastaDoCliente, pastaDoRecebimento: pastaDoRecebimento, falaDaCompetencia: falaDaCompetencia, acharRelatorioNoDrive: acharRelatorioNoDrive, mensagemDaBusca: mensagemDaBusca,
    EXEMPLO_RELATORIO: EXEMPLO_RELATORIO
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.NilmaCreditor = api;
})(typeof window !== 'undefined' ? window : this);
