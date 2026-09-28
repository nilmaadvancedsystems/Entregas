/* ==========================================================================
   Nilma — cartões de AÇÃO da IA ("Perguntar à IA")

   A IA prepara (scripts/ia-acoes.js) e a pessoa confirma aqui. A proposta
   chega em conversasIA/{id}/mensagens/{msg}.acoes; este arquivo desenha o
   cartão embaixo da resposta e, no botão, grava com o login de quem
   confirmou e as mesmas regras do banco das telas:

     rota      -> entregas (status 'pendente'), como o "Preparar rota";
     documento -> documentosMensal/{cliente}_{mês}, como marcar na Pendências;
     tarefa    -> tarefas, como o "+ Nova" do módulo Tarefas;
     cliente   -> clientes/{id} (update), os campos da ficha do cliente.

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
    },
    cliente: {
      lista: 'alteracoes', icone: 'ph-user-gear', botao: 'Salvar no cadastro', botaoIcone: 'ph-floppy-disk', fazendo: 'Salvando…', feito: 'Salvo no cadastro',
      linha: function (a) {
        return {
          titulo: a.clienteNome,
          corpo: '<b>' + esc(a.rotulo) + ':</b> ' + (a.de ? '<s>' + esc(a.de) + '</s> → ' : '') + esc(a.para),
          meta: a.soAdmin ? 'só o admin consegue salvar este campo' : ''
        };
      },
      ref: function (chave, n, a) { return o.db.collection('clientes').doc(a.clienteId); },
      jaFeito: function (snap, a) {
        if (!snap.exists) return false;
        var d = snap.data() || {};
        if (a.uniao) return (d.emails || []).indexOf(a.uniao.valor) !== -1 || d.email === a.uniao.valor;
        return Object.keys(a.gravar || {}).every(function (k) { return d[k] === a.gravar[k]; });
      },
      // Mesmos campos da ficha do cliente (Entregas); "outro e-mail" entra na lista.
      dados: function (a) {
        var x = Object.assign({}, a.gravar || {});
        if (a.uniao && o.firebase) x[a.uniao.campo] = o.firebase.firestore.FieldValue.arrayUnion(a.uniao.valor);
        return x;
      },
      atualizar: true,
      auditoria: function (a) { return ['ia_cliente_editado', a.clienteNome + ' · ' + a.rotulo + ': ' + (a.de || '—') + ' → ' + a.para]; }
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
        // rota e tarefa: qualquer uma gravada = foi confirmado; documento e cadastro: todos já assim
        if (a.acao === 'documento' || a.acao === 'cliente' ? feitos === itens.length : feitos > 0) { estado[chave] = 'feito'; if (o.render) o.render(); }
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
    var conferirAntes = (T.mesclar || T.atualizar) ? Promise.resolve(refs.map(function () { return { exists: false }; })) : Promise.all(refs.map(function (r) { return r.get(); }));
    conferirAntes.then(function (snaps) {
      var lote = o.db.batch(), gravadas = [];
      var porDoc = {};   // cadastro: várias mudanças do mesmo cliente numa gravação só
      escolhidas.forEach(function (e, k) {
        if (snaps[k].exists) return;
        var dados = T.dados(e.x, u);
        if (T.atualizar) {
          var id = refs[k].path || refs[k].id;
          if (!porDoc[id]) porDoc[id] = { ref: refs[k], dados: {} };
          Object.assign(porDoc[id].dados, dados);
        } else if (T.mesclar) lote.set(refs[k], dados, { merge: true }); else lote.set(refs[k], dados);
        gravadas.push(e.x);
      });
      Object.keys(porDoc).forEach(function (id) { lote.update(porDoc[id].ref, porDoc[id].dados); });
      return lote.commit().then(function () { return gravadas; });
    }).then(function (gravadas) {
      estado[chave] = 'feito';
      gravadas.forEach(function (x) {
        registrar(T.auditoria(x));
        if (o.depois) { try { o.depois(a.acao, x); } catch (err) {} }
      });
      if (o.render) o.render();
    }).catch(function (err) {
      var negado = err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''));
      estado[chave] = 'erro:' + (negado
        ? (a.acao === 'cliente' ? 'Só o admin pode salvar telefone, endereço, nome fantasia, observação e responsável.' : 'Você não tem permissão pra isso.')
        : ((err && (err.message || err.code)) || 'não foi possível gravar'));
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

/* ==========================================================================
   Arquivos na conversa com a IA (pedido do escritório, 28/09/2026)

   Clipe ao lado do "Perguntar", colar (Ctrl+V de print) e arrastar pro
   painel. PDF, imagem e texto (TXT, CSV, OFX): é o que a IA lê. Até 3 por
   pergunta, 5 MB cada. O arquivo sobe pro banco em pedaços, como os anexos
   das Tarefas (anexosIA/{id} + partes/{n}, só quem mandou lê); a mensagem
   leva a lista [{id, nome, mime, tamanho}] e o atendente do PC entrega o
   arquivo à IA junto com a pergunta (scripts/atendente-claude.js).

     NilmaAnexosIA.montar({ antesDe: botaoEnviar, painel: el, aoMudar: fn })
     NilmaAnexosIA.pendentes()  -> arquivos escolhidos (File[])
     NilmaAnexosIA.limpar()
     NilmaAnexosIA.subir(db, uid, arquivos) -> Promise<[{id, nome, mime, tamanho}]>
     NilmaAnexosIA.etiquetas(lista) -> html das etiquetas (na mensagem)
   ========================================================================== */
(function () {
  'use strict';
  var TIPOS = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    txt: 'text/plain', csv: 'text/csv', ofx: 'text/plain'
  };
  var MAX = 5 * 1024 * 1024, POR_PERGUNTA = 3, PEDACO = 900000;
  var escolhidos = [];
  var cfg = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ext(nome) { var m = /\.([a-z0-9]+)$/i.exec(nome || ''); return m ? m[1].toLowerCase() : ''; }
  function tamanho(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function icone(mime) { return /^image\//.test(mime) ? 'ph-image' : (mime === 'application/pdf' ? 'ph-file-pdf' : 'ph-file-text'); }
  function avisar(t) { if (cfg && cfg.avisar) cfg.avisar(t); }

  function acrescentar(lista) {
    Array.prototype.forEach.call(lista || [], function (f) {
      var nome = f.name || ('print-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png');
      if (!f.name) { try { f = new File([f], nome, { type: f.type || 'image/png' }); } catch (e) { return; } }
      if (!TIPOS[ext(nome)]) { avisar(nome + ': a IA lê PDF, imagem e texto (TXT, CSV, OFX).'); return; }
      if (f.size > MAX) { avisar(nome + ' passa de 5 MB.'); return; }
      if (escolhidos.length >= POR_PERGUNTA) { avisar('No máximo ' + POR_PERGUNTA + ' arquivos por pergunta.'); return; }
      escolhidos.push(f);
    });
    pintar();
  }

  function pintar() {
    if (!cfg) return;
    var faixa = cfg.faixa;
    faixa.hidden = !escolhidos.length;
    faixa.innerHTML = escolhidos.map(function (f, i) {
      var mime = TIPOS[ext(f.name)];
      return '<span class="cq-anexo"><i class="ph ' + icone(mime) + '" aria-hidden="true"></i><span>' + esc(f.name) + '</span>' +
        '<button type="button" class="cq-anexo-tirar" data-tirar="' + i + '" title="Tirar" aria-label="Tirar ' + esc(f.name) + '"><i class="ph ph-x" aria-hidden="true"></i></button></span>';
    }).join('');
    if (cfg.aoMudar) cfg.aoMudar(escolhidos.length);
  }

  function montar(o) {
    if (cfg || !o || !o.antesDe) return;
    cfg = o;
    var entrada = document.createElement('input');
    entrada.type = 'file'; entrada.multiple = true; entrada.hidden = true;
    entrada.accept = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.ofx,application/pdf,image/*';
    var clipe = document.createElement('button');
    clipe.type = 'button'; clipe.className = 'icon-btn cq-clipe'; clipe.title = 'Anexar arquivo (PDF, imagem ou texto)';
    clipe.setAttribute('aria-label', 'Anexar arquivo');
    clipe.innerHTML = '<i class="ph ph-paperclip" aria-hidden="true"></i>';
    o.antesDe.parentNode.insertBefore(clipe, o.antesDe);
    o.antesDe.parentNode.insertBefore(entrada, o.antesDe);
    clipe.addEventListener('click', function () { entrada.click(); });
    entrada.addEventListener('change', function () { acrescentar(entrada.files); entrada.value = ''; });
    // faixa das etiquetas, logo embaixo da barra da pergunta
    var faixa = document.createElement('div');
    faixa.className = 'cq-anexos'; faixa.hidden = true;
    var barra = o.antesDe.closest('.cq-barra') || o.antesDe.parentNode;
    barra.parentNode.insertBefore(faixa, barra.nextSibling);
    cfg.faixa = faixa;
    faixa.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-tirar]');
      if (b) { escolhidos.splice(+b.getAttribute('data-tirar'), 1); pintar(); }
    });
    var painel = o.painel || barra.parentNode;
    // colar print (Ctrl+V) no campo da pergunta
    painel.addEventListener('paste', function (ev) {
      var itens = (ev.clipboardData && ev.clipboardData.files) || [];
      if (itens.length) { ev.preventDefault(); acrescentar(itens); }
    });
    painel.addEventListener('dragover', function (ev) { if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') !== -1) { ev.preventDefault(); painel.classList.add('cq-soltar'); } });
    painel.addEventListener('dragleave', function (ev) { if (!painel.contains(ev.relatedTarget)) painel.classList.remove('cq-soltar'); });
    painel.addEventListener('drop', function (ev) {
      if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
      ev.preventDefault(); painel.classList.remove('cq-soltar'); acrescentar(ev.dataTransfer.files);
    });
  }

  function base64(f) {
    return new Promise(function (ok, erro) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { erro(r.error || new Error('não consegui ler ' + f.name)); };
      r.readAsDataURL(f);
    });
  }

  // Sobe cada arquivo: pedaços primeiro (levam o uid), o documento por último.
  function subir(db, uid, arquivos) {
    return Promise.all((arquivos || []).map(function (f) {
      var ref = db.collection('anexosIA').doc();
      var mime = TIPOS[ext(f.name)] || 'application/octet-stream';
      return base64(f).then(function (b64) {
        var n = Math.ceil(b64.length / PEDACO);
        var partes = [];
        for (var i = 0; i < n; i++) partes.push(ref.collection('partes').doc(String(i)).set({ dados: b64.slice(i * PEDACO, (i + 1) * PEDACO), uid: uid }));
        return Promise.all(partes).then(function () {
          return ref.set({ nome: String(f.name).slice(0, 200), mime: mime, tamanho: f.size, partes: n, criadoPorUid: uid, criadoEm: new Date().toISOString() });
        }).then(function () { return { id: ref.id, nome: String(f.name).slice(0, 200), mime: mime, tamanho: f.size }; });
      });
    }));
  }

  function etiquetas(lista) {
    if (!Array.isArray(lista) || !lista.length) return '';
    return '<div class="cq-anexos-msg">' + lista.map(function (a) {
      return '<span class="cq-anexo"><i class="ph ' + icone(a.mime) + '" aria-hidden="true"></i><span>' + esc(a.nome) + '</span>' +
        (a.tamanho ? '<span class="cq-anexo-tam">' + tamanho(a.tamanho) + '</span>' : '') + '</span>';
    }).join('') + '</div>';
  }

  window.NilmaAnexosIA = {
    montar: montar,
    pendentes: function () { return escolhidos.slice(); },
    limpar: function () { escolhidos = []; pintar(); },
    subir: subir,
    etiquetas: etiquetas
  };
})();
