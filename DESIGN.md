# Nilma Protocolos — sistema visual

Documento de referência da folha de estilo. Quem for mexer no visual depois
lê isto antes de inventar um token novo.

Arquivo anterior guardado como `entregas-antes-do-redesign.html`.

---

## A cena que manda em tudo

> Um office boy em pé na calçada às 14h, celular numa mão e a pasta de guias na
> outra, precisando achar o cliente certo e colher uma assinatura antes do
> comerciante sumir. E, às 18h, alguém sentado num monitor de 1280px varrendo
> 300 clientes pra ver quem não recebeu guia esse mês.

Dessa frase saem as três decisões que explicam todo o resto:

1. **Claro é o padrão.** Sol na tela e escritório com lâmpada fria. O escuro
   existe como opção, não como estrela.
2. **Cor contida.** Superfície neutra; a cor da marca em menos de 10% da tela —
   botão principal, item selecionado do menu, contagem, foco.
3. **Celular largo, PC denso.** Mesma linguagem nos dois. A linha da lista tem
   52px de alvo no celular e 40px no monitor. Um token só (`--linha`) manda
   nisso.

---

## Tokens

### Neutros

**Uma superfície só.** Barra de cima, menu lateral e conteúdo dividem o mesmo
fundo; o que separa é fio de 1px, não bloco de cor. A versão anterior tinha
página escura e cartão claro — painéis boiando numa bandeja, com o vão entre
eles gritando.

Os cinzas são **puros (R=G=B)**. A primeira tentativa tinha até +8 de desvio
pro azul e o app saía preto-e-azul; o tom tem que vir da paleta escolhida
(3%), não de um viés cravado na base.

| Token | Papel |
|---|---|
| `--bg` = `--surface` | a superfície do app, do menu ao conteúdo |
| `--surface-2` | poço: campo, trilho de controle segmentado |
| `--border` | o fio de 1px que faz todo o trabalho de separar |
| `--border-forte` | divisor que precisa ser lido, barra de rolagem |

Com a folha toda na mesma cor, **o campo precisa afundar** (`--surface-2`) pra
parecer campo — borda sozinha não basta.

### Texto

`--ink` · `--ink-soft` · `--ink-faint`. **Não são tingidos pela paleta** — eram
eles que faziam a tela inteira parecer pintada.

### Cor com significado

`--success` · `--warning` · `--danger` não mudam com a paleta escolhida.
Significado não é gosto: verde quer dizer ok em qualquer cor de marca.

### As variantes `-forte`

```css
--dose-forte: 62%;  /* claro */
--dose-forte: 92%;  /* escuro */
--accent-forte: color-mix(in srgb, var(--accent) var(--dose-forte), var(--ink));
```

A cor cheia **preenche** (botão, barra, ponto no mapa). Como **texto** ela não
alcança 4,5:1 em todas as paletas.

**A dose não pode ser a mesma nos dois temas.** No claro `--ink` é quase preto
e misturar escurece — é o que dá contraste. No escuro `--ink` é quase branco e
a mesma conta desbotava a marca até quase branco: dava dois verdes diferentes
na mesma tela, um no menu e outro no botão. No escuro a marca já nasce clara,
então mistura quase nada (92%).

**Regra prática: cor cheia pra fundo, `-forte` pra texto e ícone.**

### Armadilha de especificidade

O bloco de tinta da paleta é `:root[data-paleta]`, **não** `[data-paleta]`.
O bloco do tema escuro é `:root[data-theme="dark"]`, de especificidade maior —
com o seletor curto, `--accent-soft` ficava travado na cor da paleta padrão em
todas as paletas no escuro (a amostra "Assinar" saía marrom com a paleta
verde). Empatando a especificidade, ganha quem vem depois na folha.

### Forma

`--r-xs` 4 · `--r-sm` 6 · `--r-md` 8 · `--r-lg` 10 · `--r-pill`.

Cartão para em 10px. Raio grande em cartão é o que fazia a tela parecer app de
banco em vez de ferramenta.

### Elevação

Uma sombra só (`--shadow`), e só pro que **realmente flutua**: modal, barra de
abas do celular, lista suspensa, busca rápida, resumo sobre o mapa.

Seção não flutua — seção tem um fio em cima. Borda larga e sombra larga nunca
no mesmo elemento.

### Movimento

`--dur-rapido` 120ms · `--dur` 180ms · `--dur-lento` 280ms, saída exponencial.

Quem está numa tarefa não quer assistir coreografia. A entrada em sequência dos
cartões a cada troca de aba **saiu** — virou um aparecer curto da tela inteira.
O escalonamento sobrou só onde tem função: lista saindo do esqueleto, nos 4
primeiros itens, uma vez só.

### Empilhamento

Escala com nome, de `--z-fixo` (20) a `--z-assinatura` (100). Nada de número
solto — foi assim que o aviso saía atrás do modal.

---

## Tipografia

**Fonte do sistema**, a mesma lista do github.com: Segoe UI no PC do
escritório, Roboto no Android, SF no iPhone. Mono do sistema (Consolas no PC).
Nada é baixado.

O caminho até aqui: Plus Jakarta Sans (arredondada demais pra ferramenta) →
IBM Plex Sans (**serrilhou** a 13px no monitor 1x do escritório) → Inter
(boa, mas vinha do Google Fonts: offline caía na fonte do sistema de qualquer
jeito, porque o service worker não guarda arquivo de outro site, e a letra
pequena de 11–13px continuava apertada). A Segoe UI foi desenhada pro
ClearType do Windows: é a fonte mais nítida que existe naquele monitor, e é a
que a Nilma já lê o dia inteiro no Windows e no Outlook.

Só dois pesos: **400 e 600**. A Segoe UI não tem 500 (sai igual ao 400), então
botão, rótulo, contador e selo usam 600. Sem `letter-spacing`, sem caixa alta
na interface, sem `-webkit-font-smoothing` (no Windows não faz nada e no Mac
afina o traço).

Escala fixa em rem, com **piso de 12px** — nada menor na tela:

| Token | px | Onde |
|---|---|---|
| `--t-xs` / `--t-sm` | 12 | contador, selo, legenda, meta, cabeçalho de tabela |
| `--t-base` | 14 | botão, cabeçalho de caixa, célula, rótulo de campo (600, cor do texto) |
| `--t-md` | **16 no celular / 15 no PC** | corpo, campo |
| `--t-lg` | 16 | título de seção |
| `--t-xl` | 20 | título de tela |
| `--t-2xl` | 24 | número de painel, título das telas públicas |
| `--t-display` | 40 | o número grande da rota |
| `--t-nav` | 14 / 15 | abas e trilha da barra de cima |

A regra de 15px no PC fica junto dos tokens (recorte que vai pro
`nilma-ui.css`), então vale em todos os apps — antes ela morava num bloco que
não saía do Entregas, e as outras telas ficavam com 15px e o Entregas com 14.
Altura de linha: `--lh` 1.5 no corpo, `--lh-tight` 1.25 em título; controles
e selos usam `--lh-ctl`/`--lh-pill` em rem, que crescem junto com "Texto
grande"/"maior".

**Mono só pra identificador lido dígito a dígito**: CNPJ/CPF, linha
digitável, PIX copia-e-cola, código, tecla (`.mono`, `code`, `kbd`). Contador,
valor, data e posição usam a sans com `tabular-nums` — vírgula alinha com
vírgula do mesmo jeito.

---

## Componentes

### Linha de lista

O coração do app. Um vocabulário só pra `.entrega-row`, `.client-row` e
`.history-row`.

**Celular** — bloco de duas linhas, altura mínima 52px, régua de 1px embaixo.
**PC** — nome, meta e ação na mesma altura de linha de 40px; o nome corta com
reticências, a meta encosta à direita.

Medido: a linha caiu de **68px pra 40px** no monitor (−41%) e a aba Rota inteira
de **1413px pra 1049px** (−26%) com o mesmo conteúdo. Cabe cerca de 1,7× mais
entrega por tela.

Situação vira **um ponto de 6px antes do nome** (`--row-cor`), não uma barra
colorida na lateral.

### Seção (o antigo cartão)

`.card` **não é mais um cartão**: é um trecho da mesma folha, separado do
anterior por um fio de 1px e por respiro vertical. Sem fundo próprio, sem
borda em volta, sem raio.

Cartão dentro de cartão não existe mais: a lista da rota e o resultado do
painel foram pra dentro da seção dos filtros.

Título com ícone na cor `-forte`, dica em `--ink-faint` limitada a 68ch.

### Botão

Uma forma só, três pesos:

- `.btn-primary` — cor da marca cheia. **Sem brilho**; o `box-shadow` colorido
  saiu.
- `.btn-secondary` — borda de 1px, fundo da própria folha.
- `.btn-chip` — mesma forma, 34px de altura mínima, pra ação secundária dentro
  de cartão ou linha.

`.btn-perigo` é o secundário com a cor só no texto — sair da conta não é a ação
principal de lugar nenhum.

### Controle segmentado

O item escolhido **sobe** (fundo de cartão + contorno interno) e leva a cor só
no texto. Preencher de cor cheia dava cinco blocos saturados numa tela de
Configurações — mais cor do que a estratégia comporta.

A exceção é o menu: aba ativa é cor cheia. É o único item da moldura que precisa
ser achado de relance.

### Faixa de indicadores

Sem caixa, sem sombra, sem levantar no hover. Três células na mesma folha do
resto, separadas por um fio vertical (`border-left`, menos o primeiro).

No celular empilha ícone / número / rótulo; no PC os três ficam na mesma linha,
alinhados à esquerda.



### A marca dentro do app

O logo **não aparece na moldura** (menu lateral no PC, barra de cima no
celular). Não é gosto: o arquivo é um JPEG de 1280×1280 com fundo
rgb(247,247,247). JPEG não tem canal alfa, então esse branco é opaco —
recortado em círculo sobre a moldura escura (rgb(23,25,26)) ele vira o objeto
mais claro da tela, bem no canto onde o olho cai primeiro. Não existe CSS que
conserte um branco opaco.

Dentro da ferramenta a marca é o nome escrito. O desenho fica na **tela de
entrada**, onde mora sobre a faixa colorida — ali um selo branco sobre cor
saturada é lockup normal e funciona.

A tag `<img class="brand-mark">` continua no HTML, com `display: none`. Ela é a
fonte única de quatro coisas: o logo da tela de entrada, o ícone do PWA, o
`apple-touch-icon` e o ícone da notificação push. **Não remova a tag** —
imagem escondida continua carregando, e o canvas continua conseguindo
desenhar a partir dela.

Se um dia quiserem a marca de volta na moldura, o caminho é trocar o ativo:
um PNG ou SVG com fundo transparente, mais uma variante clara pro tema
escuro — o emblema atual é escuro sobre branco, então só tirar o branco o
deixaria invisível no escuro.

### Duas colunas no monitor (≥1200px)

Medido antes de mexer: a janela tem 860px de altura e **toda aba passava de
990px** — tudo exigia rolagem. E a coluna travava em 1160px, então num monitor
de 1590px sobrava um palmo de nada à direita.

A divisão não é meio a meio. É **coluna de trabalho** (o que você faz: a lista
da rota, o formulário, a busca do painel) e **faixa de contexto** de 360px (o
que você confere de relance: recados, fechamento do dia, ranking, auditoria).

Quem é contexto está declarado em `contextoPorAba_`, no JS, junto da lista — e
não espalhado por seis blocos de marcação. O JS só reparenta as seções para uma
`div.col-lado`; o CSS faz o resto.

```css
.view > .col-lado { grid-column: 2; grid-row: 1 / span 99; }
```

O `span 99` é o truque: a faixa ocupa a coluna 2 da primeira linha até o fim,
em vez de disputar linha a linha com as seções da esquerda — que é o que
deixaria buraco entre elas.

Dentro da faixa a linha volta a ser bloco de duas linhas (como no celular): em
360px o corte com reticências comia justamente o texto do recado.

Abaixo de 1200px tudo volta pro fluxo único, nesta ordem: **primeiro o que eu
faço, depois o que eu confiro**. No celular isso significa que a aba Rota abre
direto na lista de entregas, e não nos recados.

Se a faixa não tem nada visível (seções só de admin), ela sai de cena e a
coluna de trabalho ocupa tudo.

### Campo

Poço (`--surface-2`) com borda de 1px, raio 6px, 42px de altura. Com a folha
toda na mesma cor, borda sozinha não faz o campo parecer campo.
Foco = borda na cor da marca + anel de 3px. Teclado ganha contorno; o anel é o
que parece campo ativo.

---

## Como verificar antes de publicar

O que foi medido nesta rodada, e o que vale repetir a cada mexida:

- **Contraste**: 6 abas × 7 paletas × 2 temas, mais os dois painéis de
  Configurações em cada combinação, em 1440px / 1100px / 375px. Zero
  reprovação em 4,5:1 (3:1 pra texto grande).
- **Estouro horizontal**: zero em 320, 375, 1100, 1280 e 1440px, em todas as abas.
- **Quebra das colunas**: em 1100px a faixa de contexto volta pro fluxo único.
- **Barra de abas** cabe em 320px (262px de largura).
- **Alvo de toque**: nenhum controle abaixo de 32px; a linha da lista tem 52px
  no celular.
- **Marcação** com aninhamento balanceado, igual ao arquivo de origem.
- Todos os blocos `<script>` compilam.

O erro de console `unknown error when fetching the script` que aparece em
preview local é o service worker faltando na pasta de teste — não acontece
publicado.

---

## O que não mudou

Nenhuma linha de lógica. Nenhuma regra do Firestore, nenhum campo novo no banco.
Mesma estrutura de abas, mesmo menu lateral no PC, mesma barra flutuante no
celular, mesmos 7 seletores de cor e claro/escuro/automático.

Os nomes de classe ficaram todos — o JavaScript não sabe que o visual mudou.

## Cuidado na publicação

Fonte: nenhuma é baixada — a lista é a do sistema (ver Tipografia). Nada de
`fonts.googleapis.com` no `<head>` de nenhum app.

Se o service worker estiver com cache de versão anterior, suba o nome do cache
(`nilma-app-v1` → `v2`) — senão o navegador serve a folha velha e a tela sai
meio antiga, meio nova.
