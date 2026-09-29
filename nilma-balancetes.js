// Balancete do cliente (Clientes e ajustes → Carteira → Balancetes; pedido do
// escritório, 29/09/2026, "por enquanto", até os apps novos do contábil
// importarem sozinhos). Sobe o XLS do Alterdata ("XLS Dados Arquivo"): o
// arquivo é lido aqui no navegador e vai pro banco SÓ o texto das contas
// (código, nome, grupo, sintética e a ordem do plano) — o arquivo não é
// guardado. Fica em balancetes/{código do cliente no ERP}. Quem usa é o
// Creditor do Extratudo: a conta de cada cliente sai daqui (pela ponte,
// nilma-ponte-extratudo.js).
//
// Leitura igual à da Conferência (nads, conferencia/arquivos lerBalancete):
// coluna C = "NOME [código]", o recuo diz o nível; conta com filha abaixo
// (recuo maior) é sintética; o grupo (Ativo, Passivo…) vem das de 1º nível.
//
// O cliente se escolhe por busca (código, nome ou CNPJ), como na Nova
// entrega; a lista de baixo acompanha o que foi digitado.
(function () {
  var MAX_CONTAS = 5000;

  function classificarGrupo(nome) {
    var n = nome.toUpperCase();
    if (n.indexOf('ATIVO') > -1) return 'Ativo';
    if (n.indexOf('PASSIVO') > -1 || n.indexOf('PATRIMONIO') > -1 || n.indexOf('PATRIMÔNIO') > -1) return 'Passivo';
    if (n.indexOf('RECEITA') > -1) return 'Receita';
    if (n.indexOf('DESPESA') > -1 || n.indexOf('CUSTO') > -1) return 'Despesa';
    return null;
  }

  function lerBalancete(buf) {
    var wb = XLSX.read(buf, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    var contas = [], vistos = {}, grupo = '';
    linhas.forEach(function (r) {
      var desc = String(r[2] || '');
      var mt = desc.match(/\[\s*(\d+)\s*\]/);
      if (!mt || vistos[mt[1]]) return;
      var nome = desc.slice(0, desc.indexOf(mt[0])).replace(/[-–\s]+$/, '').trim() || mt[1];
      var recuo = desc.match(/^ */)[0].length;
      if (recuo <= 5) { var g = classificarGrupo(nome); if (g) grupo = g; }
      vistos[mt[1]] = true;
      contas.push({ codigo: mt[1], nome: nome.slice(0, 70), grupo: grupo || 'Outros', ordem: contas.length, recuo: recuo });
    });
    contas.forEach(function (c, i) { var p = contas[i + 1]; c.sintetica = !!(p && p.recuo > c.recuo); });
    return contas.map(function (c) { return { codigo: c.codigo, nome: c.nome, grupo: c.grupo, sintetica: c.sintetica, ordem: c.ordem }; });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dataCurta(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  // sem acento e em minúsculas, para a busca
  function sem(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function iniciar() {
    var card = document.getElementById('balancetesCard');
    var app = window.NilmaApp_;
    if (!card || !app || !window.firebase) return;
    var db = firebase.firestore();
    var busca = document.getElementById('balanceteBusca');
    var sugestoes = document.getElementById('balanceteSugestoes');
    var limpar = document.getElementById('balanceteLimpar');
    var subirBtn = document.getElementById('balanceteSubirBtn');
    var arq = document.getElementById('balanceteArquivo');
    var lista = document.getElementById('balancetesLista');
    var cont = document.getElementById('balancetesContador');
    var parar = null;
    var escolhido = null;        // o cliente escolhido na busca
    var docsAtuais = [];         // os balancetes guardados (para marcar quem já tem)
    var ativa = -1;              // sugestão marcada pelo teclado

    function clientesComCodigo() {
      return app.clientes().filter(function (c) { return c.ativo !== false && String(c.codigoOrigem || '').trim(); })
        .sort(function (a, b) { return Number(a.codigoOrigem) - Number(b.codigoOrigem) || String(a.nome).localeCompare(b.nome); });
    }

    // ---------- busca do cliente ----------
    function combina(c, q) {
      if (!q) return true;
      var dig = q.replace(/\D/g, '');
      return sem(c.nome).indexOf(q) > -1 || String(c.codigoOrigem).trim().indexOf(q) === 0 ||
        (dig.length >= 3 && String(c.documento || '').replace(/\D/g, '').indexOf(dig) > -1);
    }
    function destacar(texto, q) {
      var i = q ? sem(texto).indexOf(q) : -1;
      if (i < 0) return esc(texto);
      return esc(texto.slice(0, i)) + '<mark>' + esc(texto.slice(i, i + q.length)) + '</mark>' + esc(texto.slice(i + q.length));
    }
    function jaTem(cod) {
      for (var i = 0; i < docsAtuais.length; i++) if (docsAtuais[i].id === cod) return docsAtuais[i].data();
      return null;
    }
    function mostrarSugestoes() {
      var q = sem(busca.value.trim());
      var achados = clientesComCodigo().filter(function (c) { return combina(c, q); }).slice(0, 30);
      ativa = achados.length ? 0 : -1;
      sugestoes.innerHTML = achados.length ? achados.map(function (c, i) {
        var cod = String(c.codigoOrigem).trim(), b = jaTem(cod);
        return '<button type="button" class="suggestion' + (i === 0 ? ' ativa' : '') + '" role="option" data-cod="' + esc(cod) + '">' +
          '<div class="s-nome">' + destacar(cod + ' – ' + c.nome, q) + '</div>' +
          '<div class="s-doc">' + (b ? 'Já tem balancete (' + esc(dataCurta(b.em)) + '): subir de novo substitui' : esc(c.documento || '')) + '</div></button>';
      }).join('') : '<p class="vazio-curto balancete-nada">Nenhum cliente com esse código, nome ou CNPJ.</p>';
      sugestoes.classList.add('show');
      busca.setAttribute('aria-expanded', 'true');
    }
    function fecharSugestoes() { sugestoes.classList.remove('show'); busca.setAttribute('aria-expanded', 'false'); }
    function escolher(cod) {
      escolhido = cod ? clientesComCodigo().filter(function (c) { return String(c.codigoOrigem).trim() === cod; })[0] || null : null;
      busca.value = escolhido ? cod + ' – ' + escolhido.nome : '';
      limpar.hidden = !escolhido;
      subirBtn.setAttribute('aria-disabled', escolhido ? 'false' : 'true');
      fecharSugestoes();
      filtrarLista();
    }
    busca.addEventListener('focus', function () {
      mostrarSugestoes();
      // a carga curta só tem os clientes de entrega: traz a base inteira na 1ª vez
      app.todosOsClientes().then(function () { if (document.activeElement === busca) mostrarSugestoes(); });
    });
    busca.addEventListener('input', function () {
      escolhido = null;
      limpar.hidden = !busca.value;
      subirBtn.setAttribute('aria-disabled', 'true');
      mostrarSugestoes();
      filtrarLista();
    });
    busca.addEventListener('keydown', function (ev) {
      var itens = sugestoes.querySelectorAll('.suggestion');
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!sugestoes.classList.contains('show')) mostrarSugestoes();
        itens = sugestoes.querySelectorAll('.suggestion');
        if (!itens.length) return;
        ev.preventDefault();
        ativa = (ativa + (ev.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
        itens.forEach(function (b, i) { b.classList.toggle('ativa', i === ativa); });
        itens[ativa].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter' && itens[ativa]) {
        ev.preventDefault();
        escolher(itens[ativa].getAttribute('data-cod'));
      } else if (ev.key === 'Escape') fecharSugestoes();
    });
    sugestoes.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); // não tira o foco antes do clique
    sugestoes.addEventListener('click', function (ev) {
      var b = ev.target.closest('.suggestion');
      if (b) escolher(b.getAttribute('data-cod'));
    });
    busca.addEventListener('blur', function () { setTimeout(fecharSugestoes, 120); });
    limpar.addEventListener('click', function () { escolher(''); busca.focus(); });
    subirBtn.addEventListener('click', function (ev) {
      if (escolhido) return;
      ev.preventDefault();
      app.toast('Busque e escolha o cliente antes do arquivo.', 'error');
      busca.focus();
    });

    // ---------- a lista dos guardados (acompanha a busca) ----------
    function filtrarLista() {
      var q = sem(busca.value.trim());
      var cod = escolhido ? String(escolhido.codigoOrigem).trim() : '';
      lista.querySelectorAll('.balancete-linha').forEach(function (l) {
        l.hidden = cod ? l.getAttribute('data-cod') !== cod : !!q && sem(l.textContent).indexOf(q) < 0;
      });
    }
    function pintar(docs) {
      docsAtuais = docs;
      cont.textContent = docs.length ? String(docs.length) : '';
      if (!docs.length) { lista.innerHTML = '<p class="vazio-curto">Nenhum balancete ainda.</p>'; return; }
      lista.innerHTML = docs.map(function (d, i) {
        var b = d.data();
        return '<div class="balancete-linha" data-cod="' + esc(d.id) + '">' +
          '<span class="balancete-n">#' + (i + 1) + '</span>' +
          '<span class="balancete-nome"><b>' + esc(b.codigo) + '</b> ' + esc(b.cliente || '') + '</span>' +
          '<span class="balancete-info">' + (b.contas ? b.contas.length : 0) + ' contas · ' + esc(dataCurta(b.em)) + (b.por ? ' · ' + esc(b.por) : '') + '</span>' +
          '<button type="button" class="btn-chip" data-apagar="' + esc(d.id) + '"><i class="ph ph-trash" aria-hidden="true"></i> Excluir</button>' +
          '</div>';
      }).join('');
      filtrarLista();
    }

    lista.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-apagar]');
      if (!b) return;
      var id = b.getAttribute('data-apagar');
      if (!confirm('Excluir o balancete do cliente ' + id + '?')) return;
      db.collection('balancetes').doc(id).delete()
        .then(function () { app.toast('Balancete excluído.'); })
        .catch(function (e) { app.toast('Não consegui excluir: ' + e.message, 'error'); });
    });

    arq.addEventListener('change', function () {
      var f = arq.files && arq.files[0];
      arq.value = '';
      if (!f) return;
      if (!escolhido) { app.toast('Busque e escolha o cliente antes do arquivo.', 'error'); return; }
      var cliente = escolhido, codigo = String(escolhido.codigoOrigem).trim();
      f.arrayBuffer().then(function (buf) {
        var contas = lerBalancete(buf);
        if (contas.length < 10) throw new Error('não achei as contas ("NOME [código]" na coluna C). É o XLS Dados Arquivo do Alterdata?');
        if (contas.length > MAX_CONTAS) throw new Error('mais de ' + MAX_CONTAS + ' contas');
        var u = firebase.auth().currentUser;
        return db.collection('balancetes').doc(codigo).set({
          codigo: codigo, cliente: cliente.nome || '', contas: contas, arquivo: f.name.slice(0, 200),
          em: new Date().toISOString(), por: ((u && u.email) || '').replace(/@nilma\.local$/, ''), porUid: u ? u.uid : ''
        }).then(function () {
          app.toast('Balancete de ' + codigo + ' guardado: ' + contas.length + ' contas.');
        });
      }).catch(function (e) { app.toast('Não consegui ler o balancete: ' + e.message, 'error'); });
    });

    function ligar() {
      if (parar) { parar(); parar = null; }
      var pode = !!firebase.auth().currentUser && (app.temPapel('admin') || app.temPapel('contabil'));
      card.hidden = !pode;
      if (!pode) return;
      parar = db.collection('balancetes').orderBy('codigo').onSnapshot(function (s) { pintar(s.docs); },
        function (e) { lista.innerHTML = '<p class="vazio-curto">Não consegui ler: ' + esc(e.message) + '</p>'; });
    }
    // os papéis chegam depois do login (evento do entregas.html); ao sair, some
    document.addEventListener('nilma:papeis', ligar);
    firebase.auth().onAuthStateChanged(function (u) { if (!u) ligar(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
