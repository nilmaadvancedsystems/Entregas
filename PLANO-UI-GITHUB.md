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

1. Abas do módulo = abas horizontais sublinhadas abaixo da barra, no PC **e** no celular (roláveis).
   Somem a coluna fixa de 224px do PC e a pílula flutuante do celular.
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

REFERENCIA_PRIMER

## 4. Etapas

ETAPAS

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
