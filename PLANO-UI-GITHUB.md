# Reformulação da UI no estilo GitHub — plano complementado e diário de execução

> Continuação do plano `glowing-questing-squirrel.md` (pesquisa de 2026-09-22). Este arquivo é a versão
> complementada: acrescenta a referência de desenho do GitHub (Primer) traduzida pros tokens da casa, a
> arquitetura da casca compartilhada (`nilma-shell.js`), as listas exatas por etapa (refeitas pela pesquisa
> desta rodada, porque os `.output` da rodada anterior ficaram na máquina Windows) e o registro do que foi
> feito em cada etapa. Ponto de volta: tag `antes-github-ui` = commit `700bab1`.

## 1. O pedido (não muda)

A Nilma (contadora, usuária leiga, dona do app) pediu uma reformulação COMPLETA no estilo do GitHub:

- barra principal superior com ☰ que abre um painel lateral SOBREPOSTO com os módulos e as ferramentas;
- perfil no canto superior direito com painel próprio;
- Entregas refeito: sem textos de explicação, botões de ação na mesma linha (como na Ordem fixa da rota);
- Pendências e os sublinks (cliente etc.) reformulados; layout de tudo pode mudar; foco em usuária leiga.

Padrão de linha aprovado (commit `700bab1`, `.rotafixa-*`): cabeçalho de seção com fundo, `#n`, hover na
linha, botão de ação **com borda e fundo na mesma linha**.

### Decisões já tomadas com a Nilma (não perguntar de novo)

1. **Revisado em 2026-09-23 (pedido da Nilma: "duas barras laterais, uma fixa do app e uma alternante"):**
   no PC as abas do módulo ficam numa barra lateral FIXA à esquerda (`--lateral: 232px`, abaixo da barra de
   cima) e o ☰ é a barra que abre e fecha por cima, com módulos e ferramentas. No celular as abas ficam
   sublinhadas logo abaixo da barra de cima (roláveis) e o ☰ é o mesmo painel. Sai a pílula flutuante.
2. A tela hub (cartões) SOME. O app abre no último módulo usado (`localStorage nilma_ultima_funcao`,
   padrão Entregas). Trocar de módulo é só pelo ☰.
3. Consulta rápida vira a busca da barra superior (caixa no centro, atalho `/`).
4. Entrega em ETAPAS, publicando cada uma e esperando a crítica dela antes da próxima.
5. Remover TODOS os textos explicativos — inclusive Ajuda (?), tour do primeiro dia e "O que mudou".
6. Já feito antes (não refazer): Painéis sem submenu, "Cadastro" dentro de Carteira, "Minha conta" fora de
   Ajustes, "Endereço do serviço de contas" em Integrações, hints de Clientes/Ajustes removidos, menu duplo
   corrigido, rota fixa corrigida no Firestore.

## 2. Arquitetura alvo — a casca GitHub em todas as páginas

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ☰  [logo] Nilma / Entregas         [ 🔍 Consulta rápida…     / ]   📝³  (avatar) │ ← #topo .gh-topo (fixed, --topo 56px)
├──────────────────────────────────────────────────────────────────────────────┤
│  Nova entrega   Rota ⑫   Painel   Solicitações ②   Honorários                 │ ← #tabsNav .tabs (sticky, sublinhadas)
├──────────────────────────────────────────────────────────────────────────────┤
│  <h1 #pageTitle>                                            [ação principal] │ ← .tela-cabecalho
│  listas densas, fio de 1px, #n, ação com borda na linha                        │
└──────────────────────────────────────────────────────────────────────────────┘
☰ → #menuApp (gaveta esquerda, 320px, véu)          avatar → #menuPerfil (gaveta direita, 300px, véu)
  Módulos: Entregas · Clientes e ajustes · Contábil ·   nome + cargos
           Fiscal · Pendências (filtrados por papel)     Meu perfil (quando a aba Perfil existe)
  Ferramentas: Anotações · Busca (Ctrl K) · Instalar app Aparência → abrirConfiguracoes('personalizacao')
  rodapé: versão                                        Conta     → abrirConfiguracoes('conta')
                                                        Sair da conta
```

### 2.1 `nilma-shell.js` — a casca nasce num lugar só

Arquivo novo na raiz. Gera a marcação da barra, das duas gavetas e (nas telas-satélite) da barra de abas, e
liga os eventos genéricos. Cada página chama `NilmaShell.montar({...})` **no começo do `<body>`** (sem
`defer`: os scripts da página procuram `#notasBtn`, `#tabsNav` etc. quando rodam) e escuta os ganchos:

| Chamada | O que faz |
|---|---|
| `montar({modulo, moduloId, abas?, semLogin?, semMenu?, busca?, notas?, versao?, logo?, marca?})` | injeta a casca; `abas` gera `#tabsNav` com `.tab` (id `tabbtn-<id>`) |
| `ao('modulo', fn(id, ev))` | item de módulo clicado; devolver `true` troca por dentro (entregas.html), senão navega pelo `href` |
| `ao('busca' \| 'buscaGlobal' \| 'notas' \| 'instalar' \| 'perfil' \| 'aparencia' \| 'conta' \| 'sair' \| 'aba', fn)` | ferramentas e itens da conta; `aba` só quando a casca gerou as abas |
| `definirUsuario({nome, cargos, foto, podeVer(id, papel)})` | pinta avatar (foto ou iniciais), nome, cargos e filtra os módulos por papel |
| `definirModulo(id, nome)` | trilha "Nilma / <nome>", `aria-current` na gaveta, `document.title` |
| `definirLogo(src)` · `mostrarNotas(b)` · `mostrarInstalar(b)` · `mostrarPerfil(b)` · `versao(v)` · `ativarAba(id)` | estado |
| `abrirGaveta(id)` · `fecharGaveta()` · `gavetaAberta()` | controle direto |

Regras embutidas (iguais ao `closeModal` do entregas.html): `hidden` é a verdade; fechar = `.gaveta-saindo`
+ 180ms + `hidden=true`, respeitando `html[data-animacao=reduzida]` e `prefers-reduced-motion`; ESC fecha;
clique no véu fecha; Tab preso na gaveta; foco devolvido ao gatilho; `/` fora de campo e sem janela aberta
dispara `busca`; `aria-expanded` nos gatilhos; sombra `.rolado` na barra ao rolar.

Ids que a casca cria (os scripts das páginas usam estes): `#topo #menuAppBtn #topoMarca #topoLogo #topoModulo
#topoBusca #notasBtn #notasBadge #avatarBtn #avatarIniciais #topoPessoa #tabsNav #gavetaVeu #menuApp
#menuAppModulos #menuAppFerramentas #menuNotasBtn #menuBuscaBtn #menuInstalarBtn #menuAppVersao #menuPerfil
#menuPerfilAvatar #menuPerfilNome #menuPerfilCargos #menuPerfilBtn #menuAparenciaBtn #menuContaBtn #menuSairBtn`.

### 2.2 Onde mora o CSS

No `entregas.html`, bloco "Casca GitHub" (tokens `--topo: 56px`, `--topo-total`, `--z-gaveta: 45`;
`.gh-topo`, `.topo-*`, `.tabs/.tab*`, `.gaveta*`). `scripts/monta-folha.js` ganha o pedaço "casca GitHub" e
exporta o bloco pro `nilma-ui.css`, que Pendências, LCDPR e o portal já carregam. **Nunca editar o gerado.**

### 2.3 Navegação entre páginas (como no GitHub: cada página carrega inteira, a barra é idêntica)

Itens do ☰: `entregas.html`, `entregas.html#clientes`, `entregas.html#contabil`,
`Pendencias-e-envio-automatico-via-Gmail.html`, `lcdpr.html`. O `entregas.html` lê o hash no boot
(`#clientes` → `entrarModoClientes_()`, `#contabil` → `entrarModoSecundario_('contabil')`) e, por dentro,
troca de módulo sem recarregar (gancho `modulo` devolve `true`). Papéis: Contábil e Pendências exigem
`contabil`, Fiscal exige `fiscal` (mesmos `data-cargo` dos cartões antigos).

## 3. Referência: como o GitHub (Primer) desenha cada peça — e a tradução pros tokens da casa

> A web (primer.style, github.com) está bloqueada neste ambiente; o que segue é a especificação do Primer
> (Primer CSS 21 / Primer React 37, "global navigation" de 2023) conforme documentada, com a tradução
> para os tokens do `entregas.html`. Onde o Primer e o DESIGN.md divergem, manda o DESIGN.md (cor contida,
> `--linha` manda na densidade, claro é o padrão, fio de 1px separa).

| Peça do GitHub | Como o Primer faz | Tradução Nilma |
|---|---|---|
| **AppHeader-globalBar** (barra de cima) | 64px de altura (padding 16px + controles de 32px), fundo `--bgColor-default` (#fff / #0d1117), `border-bottom: 1px solid --borderColor-default`; ☰ à esquerda (`Button--iconOnly` 32×32), logo 32px, trilha "dono / repositório" (14px, último item 600), busca no centro-direita, ícones (criar, issues, PRs, sino) e avatar 32px à direita | `.gh-topo`: `--topo: 56px` (a moldura antiga já era 56px; 64 sobra em 1280px), `position: fixed`, `background: var(--bg)`, `border-bottom: 1px solid var(--border)`, `z-index: var(--z-nav)`, sombra só quando `.rolado`; controles com `min-height: var(--alvo)` e largura igual; padding lateral `var(--esp-4)` |
| **Trilha de contexto** ("nilma / Entregas") | `AppHeader-context`: crumbs separados por "/" em `--fgColor-muted`, o último em `font-weight: 600`; no celular só o último aparece | `<a class="topo-marca">` (logo 24px + "Nilma") + `<span class="topo-sep">/</span>` + `<b id="topoModulo">Entregas</b>`; abaixo de 600px some "Nilma /", fica só o módulo |
| **Busca** ("Type / to search") | botão que parece campo: 32px de altura, `width: 320px` (máx.), `border: 1px solid --borderColor-default`, `border-radius: 6px`, texto `--fgColor-muted` 14px, lupa à esquerda, `<kbd>/</kbd>` à direita; no celular vira só o ícone de lupa | `#topoBusca` (`.topo-busca`): mesma forma com `--surface-2` de fundo (regra da casa: campo afunda), `--r-sm`, `kbd` já estilizado no app; `< 900px` só ícone; atalho `/` fora de campos abre `#cqPainel` (Consulta rápida) |
| **Sino / notificações** | `Button--iconOnly` 32px com ponto/contador azul no canto | `#notasBtn` (anotações) com `#notasBadge` (o `.tab-badge` de hoje) |
| **Avatar** | 32px redondo (24 no celular), abre **painel lateral direito** (`Overlay--side-right`, 320px, altura toda, véu `--overlay-backdrop-bgColor` rgba(31,35,40,.5)); cabeçalho com avatar + login + nome; lista `ActionList` (itens 32px, ícone 16px à esquerda, 14px); divisores 1px; "Sign out" por último | `#avatarBtn` (32px, iniciais ou foto) abre `#menuPerfil` (`.gaveta.gaveta-direita`, `width: min(300px, 86vw)`); cabeçalho nome + `cargosLabel_`; itens `.gaveta-item` (`min-height: var(--alvo)`, `--r-sm`, hover `--surface-2`); "Sair da conta" com `.perigo` |
| **☰ Global navigation** | `Overlay--side-left`, 320px, altura toda, mesmo véu; X no canto superior direito do painel; grupos "Home / Issues / PRs / Projects…", divisor, "Explore / Marketplace", divisor, "Repositories" com filtro; `ActionList-sectionDivider` com título 12px 600 `--fgColor-muted`; item ativo `aria-current="page"` com fundo `--control-transparent-bgColor-selected` e barra de 4px `--fgColor-accent` à esquerda | `#menuApp` (`.gaveta`): grupo **Módulos** (Entregas · Clientes e ajustes · Contábil · Fiscal · Pendências, filtrados por `temPapel`), grupo **Ferramentas** (Anotações · Busca Ctrl+K · Instalar app), rodapé versão; item ativo: `aria-current="page"` + `font-weight: 600` + barra de 3px `var(--accent)` à esquerda (a única cor cheia da gaveta) |
| **AppHeader-localBar / UnderlineNav** (Code · Issues · PRs) | barra de 48px com `padding: 0 16px`; item: 14px, `padding: 0 8px`, `line-height: 30px`, ícone 16px `--fgColor-muted` + 8px + rótulo + contador; sublinhado `border-bottom: 2px solid transparent`; selecionado `[aria-current]`: `border-color: --underlineNav-borderColor-active` (#fd8c73) e `font-weight: 600`; hover: pílula `--bgColor-neutral-muted` atrás do rótulo (raio 6px); no celular rola horizontal (`overflow-x: auto`, barra escondida); no PC o que não cabe vai pro menu "More" | `#tabsNav.tabs`: `position: sticky; top: var(--topo)`, altura 48px, `overflow-x: auto; scrollbar-width: none`; `.tab`: `border-bottom: 2px solid transparent`, `color: var(--ink-soft)`; `.tab.active`: `border-bottom-color: var(--accent); color: var(--ink); font-weight: 600` — **sem fundo de cor** (cor contida); `.tab-badge` estático à direita do rótulo; ao ativar, `scrollIntoView({inline:'nearest'})`; sem menu "More" (as abas são ≤ 5 por módulo) |
| **Counter** (contador ao lado da aba) | 12px 500, `padding: 0 6px`, `line-height: 18px`, `min-width: 20px`, `border-radius: 2em`, fundo `--bgColor-neutral-muted` rgba(175,184,193,.2), texto `--fgColor-default` | `.tab-badge` (já é mono + `tabular-nums`): fundo `var(--surface-2)`, texto `var(--ink-soft)`, mesma forma; na aba ativa continua neutro (não vira cor) |
| **PageHeader** (título + ação "New issue") | título 20px 600 (`--text-title-size-medium`), ação primária à direita na mesma linha, `border-bottom` opcional; no celular a ação continua na linha, encolhida | `.tela-cabecalho` (já existe): `display: flex; justify-content: space-between; align-items: center`; `#pageTitle` `--t-xl` 600; `#acaoPrincipal` (o botão do formulário da aba) à direita; no celular o botão ganha `position: sticky; bottom` só onde a aba é um formulário longo (Nova entrega, Solicitações) |
| **Button** | médio 32px, `padding: 0 12px`, 14px 500, `border-radius: 6px`, `border: 1px solid rgba(31,35,40,.15)`, fundo `#f6f8fa`, hover `#f3f4f6`; primário `#1f883d` texto branco; pequeno 28px 12px; `Button--iconOnly` 32×32; **nunca** só ícone sem borda em linha de lista | `.btn` (uma forma, três pesos): tirar `width: 100%` global → `.btn.largura-total` só onde precisa; `.btn-chip` = o "small" (34px, borda 1px `var(--border)`, fundo `var(--surface)`, hover `var(--surface-2)` + `border-color: var(--border-forte)`); ícone-só = `.btn-chip.so-icone` 34×34 **com borda**, `title` + `aria-label` |
| **Box com Box-header** (lista de arquivos, lista de issues) | `border: 1px solid --borderColor-default; border-radius: 6px`; cabeçalho `padding: 12px 16px`, fundo `--bgColor-muted` (#f6f8fa), título 14px 600, contagem em `--fgColor-muted`; linhas `border-top: 1px solid --borderColor-muted`, 40px (arquivos) / `padding: 8px 16px` (issues), hover `--bgColor-muted`; ações da linha à direita, sempre visíveis no celular, no PC podem aparecer no hover **mas com fallback visível** (o GitHub mostra os botões da linha sempre no celular) | `.rotafixa-zona-titulo` + `.rotafixa-lista` + `.rotafixa-item` (aprovado): é o **Box** do GitHub. Generalizar como `.lista-gh` / `.lista-gh-titulo` / `.lista-gh-item` (mesmo CSS, nome neutro) e apontar `.rotafixa-*` pra ele; `#n` em `--ink-faint` mono; ação `.btn-chip` na mesma linha, **sempre visível** (nada de `opacity: 0` até o hover) |
| **Label / Token** (etiqueta de situação) | 12px 500, `padding: 0 7px`, `line-height: 18px`, `border: 1px solid`, `border-radius: 2em`, cor por significado | `.selo` (já existe) — só garantir que a cor vem de `--success/--warning/--danger`, nunca da paleta |
| **Settings: NavList lateral** | sidebar de 256px (`Layout--sidebar`), itens 32px raio 6px, selecionado fundo `--control-transparent-bgColor-selected` + barra 4px `--fgColor-accent` à esquerda + 600; abaixo de 768px vira lista empilhada em cima do conteúdo | Etapa 3: `.clientes-subnav` ≥ 900px vira `.subnav-lateral` (coluna 220px, `grid-template-columns: 220px 1fr`, mesmo item da gaveta); < 900px continua controle segmentado rolável |
| **Blankslate** (lista vazia) | ícone 24px `--fgColor-muted`, título 20px 600, uma linha 14px `--fgColor-muted`, ação primária | `.empty-state` (já existe): manter **uma linha só** — é o único "texto explicativo" que sobrevive, porque explica um estado, não a ferramenta |
| **Flash** (aviso amarelo "robô parado") | `padding: 16px`, `border: 1px solid`, raio 6px, fundo `--bgColor-attention-muted` (#fff8c5), ícone à esquerda, ação à direita | `.aviso-faixa` em `main` junto de `#offline-banner`: `background: var(--warning-soft); border: 1px solid var(--warning); color: var(--warning-forte)` |
| **Overlay / Dialog** (motion) | `Overlay--motion-slideInLeft/Right` 250ms `cubic-bezier(.33,1,.68,1)`, respeita `prefers-reduced-motion`; véu clicável fecha; ESC fecha; foco preso; foco devolvido ao gatilho | `@keyframes gavetaEntra/gavetaSai` (`translateX(∓100%)`) `var(--dur-lento) var(--ease)`; guardadas por `movimentoLigado_()` e pelo bloco `@media (prefers-reduced-motion: reduce)`; fechar = classe `.gaveta-saindo` + `setTimeout(180)` + `hidden = true` (copiar `closeModal`) |
| **Cores** (claro) | canvas #fff, muted #f6f8fa, border #d1d9e0, fg #1f2328, fg-muted #59636e, accent #0969da, success #1f883d, attention #9a6700, danger #d1242f; (escuro) canvas #0d1117, muted #151b23, border #3d444d, fg #f0f6fc, fg-muted #9198a1, accent #4493f8 | Já cobertos por `--bg/--surface-2/--border/--ink/--ink-soft/--accent/--success/--warning/--danger` — **não** copiar hex do GitHub: a paleta é da Nilma (7 cores + claro/escuro) |
| **Tipografia** | 14px corpo / 12px pequeno / 20px título; `line-height: 1.5`; mono só em código e contadores | `--t-md` corpo (15 no celular / 14 no PC), `--t-sm` 12, `--t-xl` 20 — igual ao Primer no PC; mono + `tabular-nums` nos contadores (já é regra da casa) |
| **Foco** | `outline: 2px solid --focus-outlineColor (#0969da); outline-offset: -2px` em botões, `2px` em links | `:focus-visible` já existe no app com `var(--accent)`; as gavetas e as abas novas herdam |
| **Pontos de quebra** | 544 / 768 / 1012 / 1280 | Casa: 600 (celular largo), 900 (PC), 1200 (duas colunas) — manter os da casa |

### O que o GitHub NÃO faz e a Nilma pediu mesmo assim (decisões, não erros)

- **Sem tela inicial de cartões**: o GitHub abre no dashboard; a Nilma abre no último módulo (decisão 2).
- **Abas roláveis no celular sem menu "More"**: o Primer React manda o excedente pra um "More"; aqui são no máximo 5 abas por módulo e rolar é mais simples de explicar.
- **Botão primário fixo no rodapé do celular** em formulário longo (Nova entrega): o GitHub não faz; a Nilma reclamou de "botão escondido lá embaixo".
- **Um só texto por tela vazia** (`.empty-state`) e nenhum outro texto explicativo (decisão 5).

### Princípios que valem pra toda etapa (checklist do revisor)

1. Toda ação de item de lista é um `.btn-chip` **com borda, sempre visível, na mesma linha** (celular e PC). Menu de 3 pontos só quando sobram mais de 2 ações — e as 2 primeiras ficam visíveis.
2. Toda lista tem cabeçalho de fundo (`.lista-gh-titulo`), contagem discreta, `#n` mono à esquerda e `hover` `--surface-2`.
3. Botão principal de formulário no `.tela-cabecalho`, à direita do título (PC) e sticky no rodapé (celular) quando o formulário passa de uma tela.
4. Zero texto explicativo: rótulo curto no lugar. Os `.card-hint` **com id** (dinâmicos) viram `.contagem` no cabeçalho da seção.
5. Cor cheia só em: botão primário, sublinhado/barra do item ativo, contador com significado, foco. Nada de fundo colorido em aba ativa.
6. Nada de altura fixa em px em item novo: `min-height: var(--alvo)` / `var(--linha)`.
7. Seletor novo nunca depende de `html[data-theme]` (tema `auto` = sem atributo).
8. Elemento novo da casca entra nas TRÊS listas: `appShellEls` (JS), `html.publico` (CSS), `@media print` (CSS).
9. Animação de saída = classe + `setTimeout` **antes** de `hidden = true`.
10. `nilma-ui.css` é gerado: mexer no `entregas.html` e rodar `node scripts/monta-folha.js`.

## 4. Etapas

Cada etapa: implementar num worktree → verificação mecânica (`scratchpad/verifica-etapa1.sh` e seguintes) → dois revisores
adversariais (fluxo/carga e visual/DESIGN.md) → correção → commit na branch → push → a Nilma testa no ar e manda print.

### Etapa 1 — Casca nova no entregas.html (barra, gavetas, abas horizontais, fim do hub)
Arquivos: `entregas.html`, `nilma-shell.js`, `scripts/monta-folha.js`, `firebase-messaging-sw.js` (cache v4).
1. Tokens `--topo: 56px`, `--z-gaveta: 45` (`:root`); `viewport-fit=cover`.
2. `<body>` começa com `<script src="nilma-shell.js">` + `NilmaShell.montar({modulo:'Entregas', moduloId:'entregas'})`; o
   `<nav class="tabs" id="tabsNav">` estático (9 botões, ids/aria preservados) é MOVIDO pra logo depois; `.topbar` (escondida) fica
   guardando a `.brand-mark`; `.sidebar-brand`, `.sidebar-footer` e `#hubScreen` saem do DOM; `#cqBotao` (FAB) sai — a busca da barra abre
   o `#cqPainel`; faixa `#roboAviso` em `main` recebe o aviso "robô parado" (antes só no hub).
3. CSS: bloco "casca GitHub" entre as âncoras `/* ---------- casca GitHub: barra, abas e gavetas ---------- */` e
   `/* ---------- fim da casca GitHub ---------- */` (exportado pro `nilma-ui.css`); apagadas a pílula do celular, a coluna de 224px, o
   `.sidebar-*`, o `padding-right: 88px` do cabeçalho e o `padding-bottom: 88px` do `main`; `body.modo-secundario` reescrito (iframes
   abaixo de barra + abas); `html.publico` e `@media print` escondem `#topo`, `#tabsNav`, `.gaveta`, `.gaveta-veu`.
4. JS: `appShellEls = [#topo, main, #tabsNav]`; `mostrarHub()` → `abrirModuloInicial_()` (último módulo por `nilma_ultima_funcao`, ou o hash
   `#clientes`/`#contabil`, ou Entregas); ganchos da casca (`modulo`, `busca` → `abrirConsultaRapida_`, `buscaGlobal` → `abrirBuscaGlobal_`,
   `notas`, `aparencia`/`conta` → `abrirConfiguracoes(aba)`, `perfil`, `instalar`, `sair`); `aplicarFotoPerfil` → `NilmaShell.definirUsuario`;
   `sincronizarCorDaBarra` lê `#topo`; apagados Ajuda, Tour, Novidades, hub, atalhos numéricos, `topbarEl`, preferência "Explicações".
5. Verificação: `scratchpad/verifica-etapa1.sh` (compilação, gerador, testes de recorte, referências mortas, as listas da casca, ganchos,
   prévia Playwright com o CSS real em 375/900/1280 claro/escuro).

### Etapa 2 — Módulo Entregas
Lista exata em `pesquisa/entregas-modulo.json` (59 textos, 32 botões fora do padrão, 21 riscos). Resumo das decisões:
- Textos: apagar todos os `.card-hint` sem id das 5 seções, `#formHint` (+ JS), `#dashStrip` (hub de cartões dentro da aba), as sub-linhas
  do Fechamento do mês; encurtar rótulos com parênteses; dinâmicos com id viram `.contagem` no cabeçalho ("≈ N min · N paradas",
  "N de M separados", "N de M pendentes · N no filtro"); estados vazios em uma linha sem citar botão.
- Botão principal: `#submitBtn` e `#solSubmitBtn` vão pro `.tela-cabecalho` (`form=…`, mesmos ids), mostrados por aba; no celular ficam
  fixos no rodapé (`.tela-acoes`). `.btn` deixa de ter `width:100%` fora de modal/login.
- Ações na linha: "Assinar" na rota e em Vencendo; lote vira linha-cabeçalho da parada; menu ⋯ da rota vira barra de chips; "Buscado"/
  "Concluir" na mesma linha; Painel com "Histórico"; Honorários com "Registrar" + "Editar" + ⋯ (Já entreguei, Não se aplica); foto/assinatura
  com chips; `#verSemEntregaBtn` "Ver N clientes".
- Listas: `.card.caixa` (Box do GitHub: cabeçalho com fundo, borda, hover) nos cartões de lista e da `.col-lado`; `#n` (`.linha-pos`) na rota,
  solicitações e atestados. Formulários continuam seção plana.

### Etapa 3 — Clientes e ajustes
Nível 1 (Carteira / Painéis / Ajustes do app) já são as abas horizontais desde a Etapa 1. Nível 2 (`.mode-toggle.clientes-subnav`): no PC
≥ 900px vira lista lateral estilo "Settings" (`.subnav-lateral`, 220px), no celular continua segmentado rolável. Lista de clientes com `#n` e
ação com borda (abrir ficha, link do portal), sem menu ⋯. Ficha do cliente com seções `.caixa` e ações na linha. Formulário da equipe:
"Criar acesso" com id no cabeçalho da seção; rótulos sem parênteses. Lista exata em `pesquisa/clientes.json`.

### Etapa 4 — Pendências
`Pendencias-e-envio-automatico-via-Gmail.html` troca a casca própria (`.app + nav.menu`) por `NilmaShell.montar({modulo:'Pendências',
moduloId:'pendencias', abas:[Hoje · Lista · Anual · Cobranças · Robô · Config]})`; `.secao-btn` unifica com `.tab`; `.linha-cliente` com
`.lc-acoes` sempre visível e bordada, `#n`; menus ⋯ abertos em chips; 46 textos explicativos fora. As 11 funções recortadas por
`scripts/teste-pendencias.js` não mudam de nome nem de indentação. Lista exata em `pesquisa/pendencias.json`.

### Etapa 5 — Portal do cliente e telas públicas
`cliente.html` carrega `nilma-ui.css` + `nilma-shell.js` (`semLogin`, `semMenu`, nome do cliente à direita), abas horizontais em qualquer
largura, seções em ordem de importância (Documentos do mês → Recebi / Pedir → PIX → Entregas anteriores), linhas com `.pi-enviar` bordado.
Telas públicas do entregas.html (`#rotaGate`, `#assinaturaGate`, `#conviteGate`): card único, ação ao lado do título. Lista em
`pesquisa/satelites.json`.

### Etapa 6 — Fiscal e Contábil
`lcdpr.html` troca `.nilma-app/.nilma-menu` pela casca compartilhada (passos viram abas). `conciliador.html` e `cheque-especial.html`
recebem `?embutido=1` na `data-src` dos iframes e escondem a própria `.topbar` (fim das duas barras somadas). Regenerar `nilma-ui.css`.

## 5. Verificação (toda etapa)

```bash
cd /home/user/Entregas && node -e "const fs=require('fs');const s=fs.readFileSync('entregas.html','utf8');[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{try{new Function(m[1])}catch(e){console.log('script',i,'ERRO',e.message);process.exit(1)}});[...s.matchAll(/<style>([\s\S]*?)<\/style>/g)].forEach((m,i)=>{let d=0;for(const c of m[1]){if(c=='{')d++;if(c=='}')d--}if(d)console.log('style',i,'chaves desbalanceadas',d)});console.log('ok')"
node --check nilma-shell.js && node scripts/monta-folha.js
node scripts/teste-pendencias.js && node scripts/teste-robo.js   # (teste-robo precisa de `npm ci` em scripts/)
```

- Referências mortas: `grep -n` de cada id/função removida tem que voltar zero fora de comentários.
- As três listas da casca em sincronia: `appShellEls` (JS), `html.publico` (CSS), `@media print` (CSS).
- Preview visual: montar um HTML de amostra com o `<style>` do entregas.html embutido e a casca montada por
  `nilma-shell.js`, abrir no Chromium (Playwright) em 375 / 900 / 1280px, tema claro e escuro, e tirar print.
- Publicar: commit + push; a Nilma testa no ar e manda print; corrigir antes da etapa seguinte.

## 6. Armadilhas (as que mais mordem)

- Handler genérico de `.tab` tira `.active` de todo `.tab` e é preso uma vez aos botões do `#tabsNav`:
  **não** reusar `.tab` nos itens das gavetas (elas usam `.gaveta-item`).
- Lista fixa de nomes `$('tab-'+name)` sem guarda: não renomear `<section id="tab-*">`.
- `hidden` é a verdade (`[hidden]{display:none !important}`): animação de saída via classe + timeout ANTES.
- `.brand-mark` (data-URI, linha ~2311) não pode sumir; não ler essa faixa com `Read`.
- `html[data-densidade]`/`html[data-texto]` mudam `--linha/--alvo`: nada de altura fixa em px em item novo.
- Tema `auto` = SEM `data-theme`: seletor novo não pode depender de `html[data-theme]`.
- Pendências: contrato do robô (coleções, ids `clienteId_AAAA-MM`) e as 11 funções recortadas por nome e
  indentação em `scripts/teste-pendencias.js`.
- Modo público (`html.publico`) e impressão listam a casca por seletor: elemento novo entra nas duas.

## 7. Diário de execução

### Etapa 1 — feita (aguardando a Nilma revisar no ar)
- Barra de cima fixa (`#topo`, `nilma-shell.js`): ☰ · logo + "Nilma / <módulo>" · caixa "Consulta rápida" (tecla `/`) ·
  anotações · avatar. Gaveta ☰ com Módulos (filtrados por cargo) e Ferramentas; gaveta da conta com Aparência, Conta e Sair.
- Abas sublinhadas logo abaixo da barra, no PC e no celular. Saíram a coluna de 224px, a pílula do pé, o botão flutuante da
  consulta, a tela de cartões, a Ajuda, o tour, as Novidades e a preferência "Explicações dos cartões".
- O app abre no último módulo usado (ou no endereço `entregas.html#clientes` / `#contabil`). Valores antigos gravados
  (`hubClientes` etc.) continuam valendo. O aviso "robô parado" virou faixa no alto do conteúdo (`#roboAviso`).
- Módulo Clientes: as abas são Carteira · Painéis · Ajustes do app (o botão genérico "Clientes e ajustes" sai da barra).
- Configurações abre direto em Aparência ou Conta; "Sair" e "Ajustes do escritório" saíram do modal.
- Cache do service worker subiu pra `nilma-app-v4`; `nilma-ui.css` regenerado com o bloco da casca.
- Verificado: scripts compilam, `teste-consulta` / `teste-pendencias` / `teste-robo` passam, e um teste no Chromium com
  Firebase falso percorreu login, troca de módulo, as duas gavetas, Aparência, Conta, `/`, `#clientes` e sair, sem erro de JS.

### Etapa 1 — ajuste pedido (2026-09-23)
- Duas barras laterais no PC: a das abas do módulo, fixa, e o ☰, que abre e fecha por cima. No celular nada muda.
- As ferramentas do Contábil (iframe) ocupam a tela à direita da barra lateral.
