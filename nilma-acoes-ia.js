/* ==========================================================================
   Nilma — cartões de AÇÃO da IA ("Perguntar à IA")

   A IA prepara (scripts/ia-acoes.js) e a pessoa confirma aqui. A proposta
   chega em conversasIA/{id}/mensagens/{msg}.acoes; este arquivo desenha o
   cartão embaixo da resposta e, no botão, grava com o login de quem
   confirmou e as mesmas regras do banco das telas:

     rota      -> entregas (status 'pendente'), como o "Preparar rota";
     documento -> documentosMensal/{cliente}_{mês}, como marcar na Pendências;
     tarefa    -> tarefas, como o "+ Nova" do módulo Tarefas.

   Sem duplicar: entrega e tarefa têm id fixo (ia_<msg>_<ação>_<n>), e a
   marcação de documento é a mesma gravação de novo. Recarregar a página ou
   abrir em outro aparelho acha o que já foi feito e mostra o cartão pronto.

   Usado pelo Entregas (embutido) e pelas outras telas (nilma-extras.js):
     NilmaAcoesIA.html(acoes, msgId)            -> texto do cartão
     NilmaAcoesIA.ligar(el, { db, auth, firebase, nome: () => 'Fulana', render: fn, depois: (tipo, dados) => {} })
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
  function data(d) { return d ? String(d).split('-').reverse().join('/') : ''; }
  function idDa(chave, n) { return 'ia_' + chave + '_' + n; }
  function agoraIso() { return new Date().toISOString(); }

  // ---------- os três tipos ----------
  var TIPOS = {
    rota: {
      lista: 'entregas', icone: 'ph-path', botao: 'Colocar na rota', botaoIcone: 'ph-truck', fazendo: 'Colocando…', feito: 'Na rota',
      linha: function (e) {
        return {
          titulo: e.clienteNome,
          corpo: (e.itens || []).map(function (x) { return esc(x.tipo) + (typeof x.valor === 'number' ? ' <span class="num">' + reais(x.valor) + '</span>' : ''); }).join(' · '),
          meta: [mes(e.competencia), e.zonaNome, e.vencimento ? 'vence ' + data(e.vencimento) : ''].filter(Boolean).join(' · ')
        };
      },
      ref: function (chave, n) { return o.db.collection('entregas').doc(idDa(chave, n)); },
      jaFeito: function (snap) { return snap.exists; },
      // Os mesmos campos do "Preparar rota" da tela de Nova entrega.
      dados: function (e, u) {
        return {
          clienteId: e.clienteId, clienteNome: e.clienteNome, avulso: false,
          competencia: e.competencia, vencimento: e.vencimento || '', codigoPagamento: null, temGuia: false,
          itens: (e.itens || []).map(function (it) { return { tipo: it.tipo, valor: typeof it.valor === 'number' ? it.valor : null }; }),
          recebedor: '', temAssinatura: false, temFoto: false, falha: false, motivoFalha: '',
          zona: e.zona || '', canal: '', geo: null, localDivergente: false, observacao: e.observacao || '',
          entregadoPor: u.email, entregadoPorNome: u.nome,
          status: 'pendente', criadoEm: agoraIso(), confirmadoEm: null, pelaIA: true
        };
      },
      auditoria: function (e) { return ['ia_rota', e.clienteNome + ' · ' + mes(e.competencia) + ' · ' + (e.itens || []).map(function (x) { return x.tipo; }).join(', ')]; }
    },
    documento: {
      lista: 'marcacoes', icone: 'ph-file-text', botao: 'Marcar como recebido', botaoIcone: 'ph-check', fazendo: 'Marcando…', feito: 'Marcado como recebido',
      linha: function (m) {
        return { titulo: m.clienteNome, corpo: esc(m.tipoNome) + (m.bancoNome ? ' · ' + esc(m.bancoNome) : ''), meta: mes(m.competencia) };
      },
      ref: function (chave, n, m) { return o.db.collection('documentosMensal').doc(m.clienteId + '_' + m.competencia); },
      jaFeito: function (snap, m) {
        if (!snap.exists) return false;
        var d = snap.data() || {};
        if (!m.bancoId) return !!d[m.tipo];
        var l = (d.bancosPorTipo && d.bancosPorTipo[m.tipo]) || (m.tipo === 'extrato' ? d.bancosRecebidos : null) || [];
        return l.indexOf(m.bancoId) !== -1;
      },
      // A mesma gravação da Pendências (alternarDoc / alternarBanco). O
      // cliente na Pendências é gravado pelo nome do cadastro, sem código.
      dados: function (m, u) {
        var patch = { clienteId: m.clienteId, clienteNome: m.clienteNomeCadastro || m.clienteNome, competencia: m.competencia, atualizadoEm: agoraIso(), detalhes: {} };
        patch[m.tipo] = true;
        patch.detalhes[m.tipo] = { origem: 'manual', em: agoraIso(), por: u.nome, pelaIA: true };
        if (m.bancoId && o.firebase) {
          var FV = o.firebase.firestore.FieldValue;
          patch.bancosPorTipo = {};
          patch.bancosPorTipo[m.tipo] = FV.arrayUnion(m.bancoId);
          if (m.tipo === 'extrato') patch.bancosRecebidos = FV.arrayUnion(m.bancoId);
        }
        return patch;
      },
      mesclar: true,
      auditoria: function (m) { return ['ia_documento_marcado', m.clienteNome + ' · ' + m.tipoNome + (m.bancoNome ? ' · ' + m.bancoNome : '') + ' · ' + m.competencia]; }
    },
    tarefa: {
      lista: 'tarefas', icone: 'ph-list-checks', botao: 'Criar', botaoIcone: 'ph-plus', fazendo: 'Criando…', feito: 'Criada',
      linha: function (t) {
        var meta = [t.clienteNome, t.responsavelNome ? 'com ' + t.responsavelNome : 'com você', t.prazo ? 'prazo ' + data(t.prazo) : '',
          t.prioridade && t.prioridade !== 'normal' ? t.prioridade : '', t.tipo === 'requisicao' ? 'requisição' : ''].filter(Boolean).join(' · ');
        return { titulo: t.titulo, corpo: t.descricao ? esc(t.descricao.length > 140 ? t.descricao.slice(0, 140) + '…' : t.descricao) : '', meta: meta };
      },
      ref: function (chave, n) { return o.db.collection('tarefas').doc(idDa(chave, n)); },
      jaFeito: function (snap) { return snap.exists; },
      // Os campos do criar() do tarefas.html. Sem responsável: quem confirmou.
      dados: function (t, u) {
        return {
          titulo: t.titulo, tipo: t.tipo === 'requisicao' ? 'requisicao' : 'tarefa', status: 'afazer', aberta: true,
          prioridade: t.prioridade || 'normal', clienteId: t.clienteId || null, clienteNome: t.clienteNome || '',
          responsavelUid: t.responsavelUid || u.uid, responsavelNome: t.responsavelUid ? (t.responsavelNome || '') : u.nome,
          prazo: t.prazo || '', repete: '', descricao: t.descricao || '', checklist: [], comentarios: [],
          solicitante: t.solicitante || '', canal: '',
          criadoEm: agoraIso(), criadoPor: u.nome, criadoPorUid: u.uid, pelaIA: true
        };
      },
      auditoria: function (t) { return ['ia_tarefa_criada', t.titulo + (t.clienteNome ? ' · ' + t.clienteNome : '')]; }
    }
  };

  function cartao(a, chave) {
    var T = TIPOS[a.acao];
    var itens = a[T.lista] || [];
    var st = estado[chave] || '';
    var feito = st === 'feito';
    var linhas = itens.map(function (x, n) {
      var marcado = !tirados[chave + '_' + n];
      var l = T.linha(x);
      return '<label class="ia-acao-linha' + (marcado ? '' : ' tirada') + '">' +
        (feito ? '<i class="ph ph-check-circle" aria-hidden="true"></i>'
               : '<input type="checkbox" data-ia-marcar="' + esc(chave) + '" data-n="' + n + '"' + (marcado ? ' checked' : '') + (st === 'gravando' ? ' disabled' : '') + '>') +
        '<span class="ia-acao-texto"><b>' + esc(l.titulo) + '</b>' + (l.corpo ? '<span>' + l.corpo + '</span>' : '') +
          (l.meta ? '<span class="ia-acao-meta">' + esc(l.meta) + '</span>' : '') +
          (x.avisos && x.avisos.length ? '<span class="ia-acao-aviso">' + x.avisos.map(esc).join(' · ') + '</span>' : '') +
        '</span></label>';
    }).join('');
    var problemas = (a.problemas || []).map(function (p) {
      return '<div class="ia-acao-aviso">' + esc(p.pedido || ('item ' + p.item)) + ': ' + esc(p.problema) + '</div>';
    }).join('');
    var marcados = itens.filter(function (x, n) { return !tirados[chave + '_' + n]; }).length;
    var rodape = feito
      ? '<div class="ia-acao-feito"><i class="ph ph-check" aria-hidden="true"></i> ' + T.feito + '</div>'
      : '<button type="button" class="btn btn-primary btn-sm" data-ia-confirmar="' + esc(chave) + '"' + (st === 'gravando' || !marcados ? ' disabled' : '') + '>' +
          (st === 'gravando' ? T.fazendo : '<i class="ph ' + T.botaoIcone + '" aria-hidden="true"></i> ' + T.botao + (itens.length > 1 ? ' (' + marcados + ')' : '')) + '</button>' +
        (st.indexOf('erro:') === 0 ? '<div class="ia-acao-aviso">' + esc(st.slice(5)) + '</div>' : '');
    return '<div class="ia-acao" data-ia-cartao="' + esc(chave) + '">' +
      '<div class="ia-acao-cab"><i class="ph ' + T.icone + '" aria-hidden="true"></i> ' + esc(a.titulo || T.botao) + '</div>' +
      '<div class="ia-acao-corpo">' + linhas + problemas + '</div>' +
      '<div class="ia-acao-pe">' + rodape + '</div></div>';
  }

  function html(acoes, msgId) {
    if (!Array.isArray(acoes) || !acoes.length || !msgId) return '';
    return acoes.map(function (a, i) {
      var chave = msgId + '_' + i;
      var T = a && TIPOS[a.acao];
      if (!T || !Array.isArray(a[T.lista]) || !a[T.lista].length) return '';
      acoesPorChave[chave] = a;
      return cartao(a, chave);
    }).join('');
  }

  // Já feito (outro aparelho, recarregou a página)? Olha no banco.
  function conferir(el) {
    if (!o || !el) return;
    Array.prototype.forEach.call(el.querySelectorAll('[data-ia-cartao]'), function (c) {
      var chave = c.getAttribute('data-ia-cartao');
      if (conferidos[chave] || estado[chave]) return;
      conferidos[chave] = true;
      var a = acoesPorChave[chave];
      if (!a) return;
      var T = TIPOS[a.acao], itens = a[T.lista];
      Promise.all(itens.map(function (x, n) { return T.ref(chave, n, x).get(); })).then(function (snaps) {
        var feitos = snaps.filter(function (s, n) { return T.jaFeito(s, itens[n]); }).length;
        // rota e tarefa: qualquer uma gravada = foi confirmado; documento: todos marcados
        if (a.acao === 'documento' ? feitos === itens.length : feitos > 0) { estado[chave] = 'feito'; if (o.render) o.render(); }
      }).catch(function () {});
    });
  }

  function registrar(par) {
    var u = o.auth && o.auth.currentUser;
    if (!u || !par) return;
    o.db.collection('auditoria').add({
      acao: par[0], detalhe: par[1] || '', origem: 'ia',
      feitoPor: u.email || '', feitoPorNome: (o.nome && o.nome()) || u.email || '', quando: agoraIso()
    }).catch(function () {});
  }

  function confirmar(chave) {
    var a = acoesPorChave[chave];
    if (!a || !o || estado[chave] === 'gravando' || estado[chave] === 'feito') return;
    var usuario = o.auth && o.auth.currentUser;
    if (!usuario) return;
    var T = TIPOS[a.acao];
    var u = { uid: usuario.uid, email: usuario.email || '', nome: (o.nome && o.nome()) || usuario.email || '' };
    var escolhidas = a[T.lista].map(function (x, n) { return { x: x, n: n }; }).filter(function (e) { return !tirados[chave + '_' + e.n]; });
    if (!escolhidas.length) return;
    estado[chave] = 'gravando';
    if (o.render) o.render();
    var refs = escolhidas.map(function (e) { return T.ref(chave, e.n, e.x); });
    // Entrega e tarefa que já existem (confirmou em outro aparelho) ficam como estão.
    var conferirAntes = T.mesclar ? Promise.resolve(refs.map(function () { return { exists: false }; })) : Promise.all(refs.map(function (r) { return r.get(); }));
    conferirAntes.then(function (snaps) {
      var lote = o.db.batch(), gravadas = [];
      escolhidas.forEach(function (e, k) {
        if (snaps[k].exists) return;
        var dados = T.dados(e.x, u);
        if (T.mesclar) lote.set(refs[k], dados, { merge: true }); else lote.set(refs[k], dados);
        gravadas.push(e.x);
      });
      return lote.commit().then(function () { return gravadas; });
    }).then(function (gravadas) {
      estado[chave] = 'feito';
      gravadas.forEach(function (x) {
        registrar(T.auditoria(x));
        if (o.depois) { try { o.depois(a.acao, x); } catch (err) {} }
      });
      if (o.render) o.render();
    }).catch(function (err) {
      estado[chave] = 'erro:' + ((err && (err.message || err.code)) || 'não foi possível gravar');
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
