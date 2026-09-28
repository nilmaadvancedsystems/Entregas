/* ==========================================================================
   Nilma — cartões de AÇÃO da IA ("Perguntar à IA")

   A IA prepara (scripts/ia-acoes.js) e a pessoa confirma aqui. A proposta
   chega em conversasIA/{id}/mensagens/{msg}.acoes; este arquivo desenha o
   cartão embaixo da resposta e, no "Colocar na rota", grava com o login de
   quem confirmou e as mesmas regras do banco da tela de Rota.

   Sem duplicar: cada parada tem id fixo (entregas/ia_<msg>_<ação>_<n>).
   Confirmar de novo, em outro aparelho ou depois de recarregar, acha a
   parada já gravada e só mostra "Na rota".

   Usado pelo Entregas (embutido) e pelas outras telas (nilma-extras.js):
     NilmaAcoesIA.html(acoes, msgId)            -> texto do cartão
     NilmaAcoesIA.ligar(el, { db, auth, nome: () => 'Fulana', render: fn, depois: entrega => {} })
     NilmaAcoesIA.conferir(el)                  -> marca o que já foi gravado
   ========================================================================== */
(function () {
  'use strict';
  var estado = {};       // chave do cartão -> 'gravando' | 'feito' | 'erro:<msg>'
  var tirados = {};      // chave do cartão + '_' + n -> true (desmarcado pela pessoa)
  var conferidos = {};   // chave -> true (já olhou no banco)
  var acoesPorChave = {};
  var o = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function reais(v) { return typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''; }
  function mes(c) {
    var m = /^(\d{4})-(\d{2})$/.exec(c || '');
    return m ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m[2] - 1] + '/' + m[1] : (c || '');
  }
  function idDa(chave, n) { return 'ia_' + chave + '_' + n; }

  function cartaoRota(a, chave) {
    var st = estado[chave] || '';
    var feito = st === 'feito';
    var linhas = a.entregas.map(function (e, n) {
      var marcado = !tirados[chave + '_' + n];
      var docs = (e.itens || []).map(function (x) { return esc(x.tipo) + (typeof x.valor === 'number' ? ' <span class="num">' + reais(x.valor) + '</span>' : ''); }).join(' · ');
      var meta = [mes(e.competencia), e.zonaNome, e.vencimento ? 'vence ' + e.vencimento.split('-').reverse().join('/') : ''].filter(Boolean).join(' · ');
      return '<label class="ia-acao-linha' + (marcado ? '' : ' tirada') + '">' +
        (feito ? '<i class="ph ph-check-circle" aria-hidden="true"></i>'
               : '<input type="checkbox" data-ia-marcar="' + esc(chave) + '" data-n="' + n + '"' + (marcado ? ' checked' : '') + (st === 'gravando' ? ' disabled' : '') + '>') +
        '<span class="ia-acao-texto"><b>' + esc(e.clienteNome) + '</b><span>' + docs + '</span>' +
          '<span class="ia-acao-meta">' + esc(meta) + '</span>' +
          (e.avisos && e.avisos.length ? '<span class="ia-acao-aviso">' + e.avisos.map(esc).join(' · ') + '</span>' : '') +
        '</span></label>';
    }).join('');
    var problemas = (a.problemas || []).map(function (p) {
      return '<div class="ia-acao-aviso">' + esc(p.pedido || ('item ' + p.item)) + ': ' + esc(p.problema) + '</div>';
    }).join('');
    var marcados = a.entregas.filter(function (e, n) { return !tirados[chave + '_' + n]; }).length;
    var rodape = feito
      ? '<div class="ia-acao-feito"><i class="ph ph-check" aria-hidden="true"></i> Na rota</div>'
      : '<button type="button" class="btn btn-primary btn-sm" data-ia-confirmar="' + esc(chave) + '"' + (st === 'gravando' || !marcados ? ' disabled' : '') + '>' +
          (st === 'gravando' ? 'Colocando…' : '<i class="ph ph-truck" aria-hidden="true"></i> Colocar na rota' + (a.entregas.length > 1 ? ' (' + marcados + ')' : '')) + '</button>' +
        (st.indexOf('erro:') === 0 ? '<div class="ia-acao-aviso">' + esc(st.slice(5)) + '</div>' : '');
    return '<div class="ia-acao" data-ia-cartao="' + esc(chave) + '">' +
      '<div class="ia-acao-cab"><i class="ph ph-path" aria-hidden="true"></i> ' + esc(a.titulo || 'Colocar na rota') + '</div>' +
      '<div class="ia-acao-corpo">' + linhas + problemas + '</div>' +
      '<div class="ia-acao-pe">' + rodape + '</div></div>';
  }

  function html(acoes, msgId) {
    if (!Array.isArray(acoes) || !acoes.length || !msgId) return '';
    return acoes.map(function (a, i) {
      var chave = msgId + '_' + i;
      acoesPorChave[chave] = a;
      return a && a.acao === 'rota' && Array.isArray(a.entregas) ? cartaoRota(a, chave) : '';
    }).join('');
  }

  // Já gravado (outro aparelho, recarregou a página)? Olha as paradas no banco.
  function conferir(el) {
    if (!o || !el) return;
    Array.prototype.forEach.call(el.querySelectorAll('[data-ia-cartao]'), function (c) {
      var chave = c.getAttribute('data-ia-cartao');
      if (conferidos[chave] || estado[chave]) return;
      conferidos[chave] = true;
      var a = acoesPorChave[chave];
      if (!a) return;
      var docs = a.entregas.map(function (e, n) { return o.db.collection('entregas').doc(idDa(chave, n)).get(); });
      Promise.all(docs).then(function (snaps) {
        if (snaps.some(function (s) { return s.exists; })) { estado[chave] = 'feito'; if (o.render) o.render(); }
      }).catch(function () {});
    });
  }

  function confirmar(chave) {
    var a = acoesPorChave[chave];
    if (!a || !o || estado[chave] === 'gravando' || estado[chave] === 'feito') return;
    var usuario = o.auth && o.auth.currentUser;
    if (!usuario) return;
    var nome = (o.nome && o.nome()) || usuario.email || '';
    var escolhidas = a.entregas.map(function (e, n) { return { e: e, n: n }; }).filter(function (x) { return !tirados[chave + '_' + x.n]; });
    if (!escolhidas.length) return;
    estado[chave] = 'gravando';
    if (o.render) o.render();
    var agora = new Date().toISOString();
    var refs = escolhidas.map(function (x) { return o.db.collection('entregas').doc(idDa(chave, x.n)); });
    // As que já existem (confirmou em outro aparelho) ficam como estão.
    Promise.all(refs.map(function (r) { return r.get(); })).then(function (snaps) {
      var lote = o.db.batch(), gravadas = [];
      escolhidas.forEach(function (x, k) {
        if (snaps[k].exists) return;
        var e = x.e;
        // Os mesmos campos do "Preparar rota" da tela de Nova entrega.
        var dados = {
          clienteId: e.clienteId, clienteNome: e.clienteNome, avulso: false,
          competencia: e.competencia, vencimento: e.vencimento || '', codigoPagamento: null, temGuia: false,
          itens: (e.itens || []).map(function (it) { return { tipo: it.tipo, valor: typeof it.valor === 'number' ? it.valor : null }; }),
          recebedor: '', temAssinatura: false, temFoto: false, falha: false, motivoFalha: '',
          zona: e.zona || '', canal: '', geo: null, localDivergente: false,
          observacao: e.observacao || '',
          entregadoPor: usuario.email || '', entregadoPorNome: nome,
          status: 'pendente', criadoEm: agora, confirmadoEm: null,
          pelaIA: true
        };
        lote.set(refs[k], dados);
        gravadas.push(dados);
      });
      return lote.commit().then(function () { return gravadas; });
    }).then(function (gravadas) {
      estado[chave] = 'feito';
      if (o.depois) gravadas.forEach(function (d) { try { o.depois(d); } catch (e) {} });
      if (o.render) o.render();
    }).catch(function (err) {
      estado[chave] = 'erro:' + ((err && (err.message || err.code)) || 'não foi possível colocar na rota');
      if (o.render) o.render();
    });
  }

  function ligar(el, opcoes) {
    o = opcoes || {};
    if (!el || el.__iaAcoes) return;
    el.__iaAcoes = true;
    el.addEventListener('change', function (ev) {
      var cb = ev.target.closest('[data-ia-marcar]');
      if (!cb) return;
      var k = cb.getAttribute('data-ia-marcar') + '_' + cb.getAttribute('data-n');
      if (cb.checked) delete tirados[k]; else tirados[k] = true;
      if (o.render) o.render();
    });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ia-confirmar]');
      if (b) confirmar(b.getAttribute('data-ia-confirmar'));
    });
  }

  window.NilmaAcoesIA = { html: html, ligar: ligar, conferir: conferir };
})();
