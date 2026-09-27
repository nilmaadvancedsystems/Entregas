# Nilma Entregas

Entregador de Entregas (Nilma Entregas)
https://nilmaadvancedsystems.github.io/Entregas/entregas.html

Para testar sem gravar nada no banco, abra com `?demo=1` no fim do link.

## Tarefas: o "Notion" do escritório (versão 2.367, etapa 1)

Módulo novo no menu ☰, **Tarefas** (`tarefas.html`), pra equipe toda:

- **Tarefas e requisições** numa coleção só (`tarefas`, campo `tipo`):
  título, status (A fazer, Em andamento, Aguardando cliente, Feito),
  empresa, responsável, prazo, prioridade, repetir todo mês, descrição
  (salva sozinha 1 s depois de parar de digitar), checklist e comentários.
  Requisição tem ainda "pedido por" e "chegou por" (WhatsApp, e-mail...).
- **Visões**: Minhas tarefas, Todas, Requisições; em Lista (agrupada por
  status, prazo, responsável ou empresa, com criar rápido em cada grupo),
  Quadro (colunas por status, arrastar muda o status) e Feitas (por mês).
- **Painel lateral** ao abrir um item, com link próprio (`#tarefa/<id>`).
- **Repetir todo mês**: marcada como feita, nasce a do mês seguinte (mesmo
  dia, checklist zerado).
- **Empresas**: responsável de cada cliente (`clientes.responsavelUid/Nome`,
  só admin troca) e a página da empresa com requisições, tarefas e feitas.
  Tarefa nova de uma empresa já vem com o responsável dela.
- **Leituras**: ouve só as tarefas abertas (`aberta == true`); feitas são
  lidas por mês ou por empresa quando se abre. Clientes vêm do cache do
  aparelho (o do Entregas/Pendências), do banco no máximo a cada 12 h.
- Regras: `tarefas` a equipe lê, cria e edita; quem criou não muda; apagar
  só quem criou ou o admin.

**Versão 2.380:** a faixa "Atendendo: ... · N pedidos na fila" da tela do
Robô só aparece quando há pedido de verdade na fila (pendente ou em
andamento), com o número contado da própria fila; antes o aviso gravado por
um robô que reiniciou ficava até meia hora na tela.

**Versão 2.379 — "lendo" preso depois de reiniciar:** o vigia reiniciado no
meio da leitura (atualização do robô) deixava `robo/estado.status = 'lendo'`,
o andamento e o "Atendendo: ..." de pé, e o botão "Verificar Gmail agora"
ficava travado. Agora o vigia limpa esse resto ao ligar e quando o Cancelar
não acha nada rodando, e a tela só considera "lendo" com andamento de menos
de 10 min.

**Versão 2.378 — leitura do Gmail que não termina:**

- O vigia (`vigia-robo.js`) rodava a leitura sem prazo e sem jeito de
  parar: um PDF que o leitor não termina de ler deixava "Lendo o Gmail"
  pra sempre. Agora: leitura 10 min sem nenhuma notícia, ou mais de 1 h, é
  interrompida (aviso por e-mail, "A leitura travou e foi interrompida"); e a
  tela do Robô tem **Cancelar** no cartão da leitura/salvamento (pedido
  `solicitacoesEmail` tipo `cancelar`, atendido na hora, fora da fila). O que
  já foi lido fica gravado; a próxima leitura continua de onde parou.
- A conferência de comprovante de parcela só abre PDF de cliente que tem
  parcelamento ativo (1 leitura por execução), só PDF até 3 MB e desiste do
  PDF que não lê em 20 s.

**Versão 2.377 — Parcelamentos, etapa 3 (robô) e fotos de perfil:**

- **Parcela paga pelo comprovante** (`scripts/parcela-paga.js`): quando o
  cliente manda por e-mail (ou pelo link) o comprovante do DARF / DAS / guia
  da PGFN, o robô lê o PDF e, se for pagamento de parcela, marca a parcela
  paga no parcelamento cadastrado (`pagas.AAAA-MM` com `auto: true`, o
  arquivo, o valor e a data do pagamento). Reconhece: comprovante (não a
  guia a pagar), órgão (PGFN, Simples, Receita, Estado, Prefeitura), valor,
  "Parcela 12/60", nº da negociação/parcelamento e data. Comprovante de
  banco sem a palavra "parcela" vale só se o nº de referência bater com o
  nº do parcelamento cadastrado (o DAS do mês e o DARF comum nunca viram
  parcela). Parcela escrita no comprovante manda; senão, a mais antiga em
  aberto até o mês pago. Na dúvida (dois parcelamentos parecidos, valor
  mais de 25% diferente, parcela já paga) não marca e fica no log. A tela
  mostra "Parcela N marcada pelo robô" e um ponto verde na grade.
- **Aviso diário de atrasados** (`scripts/avisos-atrasados.js`): dias úteis,
  a partir das 8h, notificação no celular de cada pessoa com as tarefas
  atrasadas / que vencem hoje e as parcelas atrasadas / que vencem hoje ou
  nos próximos 3 dias das empresas dela. Quem está de férias não recebe:
  vai pra quem cobre (ou pro admin). O admin recebe também o resumo do
  escritório. Toque abre as Tarefas. `robo/estado.atrasadosEm` evita repetir.
- `avisos-push.js` ganhou `enviarPara(uids, ...)` e link por aviso.
- **Fotos de perfil** (`usuarios.fotoPerfil`) nos avatares da Equipe, das
  linhas, do quadro, do painel e dos comentários. Iniciais ignoram
  pontuação ("QA Claude (apagar)" → QA).

**Versão 2.376 — acabamento das Tarefas (2ª rodada):**

- Painel da tarefa mais largo, com a empresa (clicável, abre a página
  dela) e o tipo no alto; status com a cor do status; responsável com o
  avatar; blocos Descrição / Checklist / Comentários com ícone; checklist
  com barra de progresso; comentários em balões com o avatar de quem
  escreveu.
- Requisições mostram embaixo do título "Pedido por Fulano · WhatsApp".
- Avatares das pessoas coloridos (mesma cor em todo lugar).
- Telas vazias com ícone, explicação e ação ("Limpar busca e filtros",
  "Nova tarefa", "Nova requisição").

**Versão 2.375 — Parcelamentos (etapa 2):**

- Coleção `parcelamentos` (regras novas): empresa, órgão (PGFN, Simples,
  Receita, Estado, Prefeitura, outro), modalidade, nº, quantidade de
  parcelas, 1ª parcela (`AAAA-MM`), valor da parcela, vencimento (último
  dia útil — padrão da PGFN/Simples/Receita — ou dia fixo), situação
  (ativo, quitado, rescindido, cancelado; `aberto` = ativo), observações e
  `pagas` (mapa `AAAA-MM` → quem marcou e quando). A parcela do mês é o
  número de meses desde a 1ª + 1.
- **Aba Parcelamentos na empresa**: um cartão por parcelamento com o selo
  do órgão, valor, "X de Y pagas" (barra), período, quanto falta, a
  situação do mês (paga / vence dd/mm / N atrasadas) e o botão "Pagar
  mmm/aa" (sempre a mais antiga em aberto). "Parcelas mês a mês" abre a
  grade de todas as parcelas: verde paga, vermelho atrasada, contorno no mês
  atual; clicar marca ou desmarca. A última parcela paga quita sozinho.
  Encerrados ficam recolhidos embaixo. A Visão geral mostra um resumo.
- **Menu Parcelamentos**: todos os ativos (admin) ou os das minhas empresas,
  atrasados primeiro, com filtros Atrasados / A pagar no mês / Pagos no mês
  e por órgão; o número vermelho no menu é quantos têm parcela atrasada.
- Cadastro no painel lateral: sugestões de modalidade por órgão, prévia do
  período e do total e a opção de marcar como pagas as parcelas dos meses
  anteriores (parcelamento que já vinha sendo pago).
- Próxima etapa (3): o robô marcar a parcela paga pelo comprovante e avisar
  parcela e tarefa atrasadas.

**Versão 2.374 — acabamento geral das Tarefas:**

- Linhas das listas mais altas (título 15px); a empresa aparece com o
  quadradinho colorido das iniciais, o nome curto (fantasia) e o código;
  prazo com ícone de calendário; nas feitas, "feita dd/mm". Contadores dos
  grupos em bolinha.
- Quadro: cartões com a empresa no alto, título em destaque e rodapé com
  responsável, prazo e prioridade.
- Empresas: linha com avatar colorido, nome e, embaixo, fantasia · CNPJ ·
  regime; tarefas e requisições em bolinhas; prazo com cor.
- Equipe: avatar colorido, cargo por extenso ("Office boy", "Contábil"),
  números em blocos (atrasadas em vermelho) e ações no rodapé do cartão.
- Feitas: mês com ‹ › e o total do mês. Cadastro: links discretos,
  certidões com separadores e atalhos como botões.
- Iniciais de empresa ignoram LTDA/ME/EPP/"de" (A7 COMERCIO DE VEICULOS
  LTDA → AC).

**Versão 2.373 — Bancos com logo:** cada banco mostra o logo de
`scripts/logos-bancos/<id>.png` (o mesmo da Pendências; sem o arquivo, fica o
selo com a cor e a sigla) e o código COMPE. As linhas ficaram maiores, com
colunas Banco · Documentos do mês · Recado; em telas médias o recado desce
para baixo dos documentos e no celular tudo empilha.

**Versão 2.372 — aba Bancos da empresa:**

- Uma linha por banco, na largura toda: nome, os documentos com nome
  ("Extrato", "Comprovantes", "Aplicação"; verde com ✓ quando chegou,
  tracejado com relógio quando falta) e o recado do banco (Enter salva).
- No alto: o mês com ‹ › para ver meses anteriores (lê o
  `documentosMensal` daquele mês uma vez), o resumo "X de Y chegaram" /
  "Tudo chegou" / "Sem movimento" e "Ver na Pendências". Extrato
  incompleto vira um aviso amarelo.

**Versão 2.371 — escolher data:**

- O prazo da tarefa e as datas da ausência deixam o `<input type=date>`
  (que salvava a cada dígito e travava o ano em "0002") e usam um seletor
  próprio: digitar `10/10`, `10/10/26`, `1010`, `15` (dia deste mês ou do
  próximo), `amanhã` ou `+3`; atalhos Hoje, Amanhã, Sexta, Próx. segunda e
  Fim do mês; calendário do mês; e "Sem prazo". Só grava quando a data é
  escolhida. Sem ano, vale o ano atual (ou o próximo, se já passou há mais
  de 2 meses).
- O painel aberto passa a mostrar na hora o que mudou no banco (antes podia
  ficar com o valor antigo).

**Versão 2.370 — Minhas empresas e o que é só do admin:**

- **Minhas empresas** (menu novo): as empresas em que a pessoa é a
  responsável e, embaixo, "Cobrindo Fulano" com as empresas de quem está
  fora e deixou a pessoa cobrindo. A página da empresa volta para a lista de
  onde veio.
- Só o **admin** vê "Todas as tarefas", "Todas as empresas" (onde se escolhe
  o responsável de cada empresa) e o botão "Ver tarefas" na Equipe. Quem não
  é admin e abre `#todas`/`#empresas` cai em Minhas tarefas/Minhas empresas.
  É restrição de tela; as regras do banco não mudaram.

**Versão 2.369 — menos informação na tela:**

- **Listas**: a barra fica só com a busca, os atalhos que têm algo
  (Atrasadas, Hoje, 7 dias, Sem responsável; os zerados somem) e o botão
  **Filtros**, que abre responsável, prioridade e agrupar (mostra quantos
  estão ligados e tem "Limpar"). Grupos vazios somem. O responsável na linha
  é só a bolinha com as iniciais (nome e férias ao parar o mouse; borda
  amarela se está fora). A linha "+ Nova tarefa" do grupo aparece ao passar
  o mouse (no celular fica sempre).
- **Empresa em abas** no menu de cima: **Visão geral** (onde parou,
  particularidades, quem cuida e as 5 primeiras abertas), **Tarefas**
  (requisições, tarefas e feitas), **Bancos** (documentos do mês e recado por
  banco; só lê o `documentosMensal` ao abrir esta aba) e **Cadastro**
  (contatos, Receita, certidões, atalhos). O cabeçalho mostra só nome,
  CNPJ e regime; a situação na Receita só aparece se não estiver ativa.
- **Painel da tarefa**: à vista só Status, Empresa, Responsável e Prazo;
  Tipo, Prioridade, Repetir e os dados da requisição ficam em "Mais
  propriedades", que já abre sozinho quando algum deles está preenchido.

**Versão 2.368 — caderno da empresa e férias:**

- **Página da empresa** vira o caderno de passagem de bastão: "Onde parou"
  (com quem escreveu e quando) e "Particularidades" (texto livre, salva
  sozinho; sem senhas), na coleção `empresas/{clienteId}`, que a equipe toda
  escreve. Ao lado: responsável e **substituto nas férias**, contatos (link
  do WhatsApp), **bancos** com os documentos do mês por banco (E/C/A, do
  `documentosMensal` do mês, 1 leitura) e um recado por banco, dados da
  Receita, certidões e certificados com vencimento, e atalhos (documentos na
  Pendências por `#cliente/<id>`, página do cliente).
- **Equipe e férias**: cada pessoa marca a própria ausência (tipo, de, até e
  quem cobre) em `ausencias/{uid}`; o admin marca de qualquer um. Quem cobre
  vê "Cobrindo Fulano" em Minhas tarefas; a empresa de quem está fora avisa
  no alto; a linha da tarefa mostra "férias" ao lado do responsável.
- Listas com a faixa **Atrasadas / Hoje / Próximos 7 dias / Sem
  responsável** (toca e filtra) e o status trocado direto na linha.

Próximas etapas: parcelamentos dos clientes (PGFN, Simples, Receita) na
página da empresa; depois o robô marcando parcela paga e avisando atrasos.

## Filtros do Disparo, extrato incompleto e o robô que aprende (versão 2.365)

- **Disparo › Para quem**: filtros de pendência no mês aberto (com, sem, falta
  extrato/comprovante/aplicação), zona e enquadramento. Quem não passa sai da
  lista e do envio; a busca só mostra.
- **Extrato de parte do mês** (`scripts/periodo-extrato.js`): o robô lê o
  período escrito no extrato ("Período: 01/08/2026 a 15/08/2026"). Se não vai
  do 1º ao último dia útil (um dia de folga), o extrato não conta como recebido
  e fica `documentosMensal.extratoIncompleto` ({ de, ate, texto }). A tela
  mostra laranja ("chegou só até 15/08") e a cobrança, manual ou automática,
  pede "Extrato Bancário — veio só até 15/08, falta o resto do mês". Extrato
  inteiro que chega depois apaga a anotação. Sem período escrito: como antes.
- **Aprender com as escolhas**: Salvar um e-mail escolhendo a empresa (quando
  ele podia ser de mais de uma) grava em `robo/aprendizado` o remetente, a
  empresa e as palavras do assunto/arquivos. Nos próximos e-mails do mesmo
  remetente, depois de CNPJ e nome, a escolha parecida decide; remetente que
  foi sempre pra mesma empresa (2 vezes ou mais) vai pra ela.

## Disparo pelo Gmail (versão 2.360)

Pendências › Robô do Gmail › **Disparo** (só admin): um assunto, um texto e,
se quiser, um arquivo (PDF, foto, Word, Excel ou CSV, até 5 MB, com o nome
que o cliente vai ver) pra vários clientes de uma vez. Todos os clientes com
e-mail começam marcados; dá pra buscar e desmarcar.

- O arquivo sobe em pedaços em `solicitacoesEmail/{id}/partes/{n}` antes do
  pedido existir, e o vigia apaga os pedaços depois de enviar (dando certo ou
  não).
- O vigia manda em cópia oculta, em grupos de 90, com o HTML no desenho do app
  (`scripts/email-html.js`, `htmlDoDisparo`) e o arquivo anexado
  (`scripts/mensagem-gmail.js`). Confere de novo no cadastro se quem pediu é
  admin. O andamento aparece em % no cartão do robô e na página.
- O Gmail aceita uns 500 destinatários por dia: a página avisa quando passa
  de 450.
- **HTML pronto** (versão 2.361): em vez do texto, um arquivo .html (ou o código
  colado), com prévia na página. Vai do jeito que veio, sem a moldura do
  escritório; o vigia só tira `<script>`/`on…=` e troca imagens embutidas em
  `data:` (que o Gmail não mostra) por imagens anexadas por cid. O `<title>`
  vira o assunto se ele estiver vazio. Máximo de uns 800 KB de HTML.
- Regras do banco: pedido de disparo só admin cria (em nome próprio) e altera;
  `partes` só admin.

O e-mail de cobrança também passou pro desenho do app: barra clara com o logo,
cartões com cabeçalho cinza e uma linha por documento com os bancos em selos.

## Configurações no estilo do Notion (versão 2.347)

O menu da foto (canto de cima) tem **Solicitações** e **Configurações** em
todas as telas. Solicitações (versão 2.358) abre uma janela no mesmo desenho,
por cima da tela, sem sair de onde a pessoa está (`nilma-solicitacoes.js`):
Nova solicitação, Pendentes (urgentes em cima, com Concluir) e Concluídas
(as últimas 30), com busca. O office boy vê a fila da equipe; o resto, o que
pediu. As pendentes só são ouvidas com a janela aberta. Configurações abre a
mesma janela no Entregas, na Pendências, no Fiscal e no Contábil
(`nilma-config.js`), começando em Minha conta: tópicos à esquerda, com busca,
e as opções à direita, no desenho da ficha do cliente.

- **Conta › Minha conta**: foto, nome (editável), e-mail, trocar senha e sair.
- **Conta › Notificações**: ligar, mandar um aviso de teste e desligar neste aparelho.
- **Preferências › Aparência**: tema e barra lateral aberta ou recolhida.
- **Preferências › Telas e listas**: em qual módulo o sistema abre ao entrar
  (Entregas, Clientes e ajustes, Contábil, Fiscal, Pendências ou onde parou),
  clientes da Pendências em lista ou cartões, e como abrir os PDFs do Drive.
- **Preferências › Consulta rápida**: resposta padrão, rápida ou com IA.
- **Aplicativo › Instalação e versão**: instalar, versão, "Buscar a versão mais
  nova" e os atalhos de teclado.
- **Escritório › Integrações** (só admin): robô, Gmail, IA, backup e uso do banco
  (leituras e gravações do dia, contadas pelo Google).

A Pendências tem as configurações da cobrança em **Configurações**: Geral (prazo e
assinatura), Mensagens (1ª, 2ª e 3ª cobrança, WhatsApp, em lote e modelos seus) e
Automático (cobrança sozinha e comprovante por e-mail).

## Visual N1 no ar (25/09/2026)

A versão que estava em teste (`teste/`, visual N1) passou a ser o sistema do
escritório, já com as correções do dia: fim do ciclo que regravava a rota do
cliente sem parar, regras do banco só para a equipe, e a IA da Consulta
respondida pelo Claude do PC do escritório.

O cache do navegador subiu para `nilma-app-v10`: todo aparelho baixa os
arquivos novos de uma vez, sem misturar com os da versão anterior.

### Se aparecer "Sem permissão" ou a barra de cima sumir (Safari)

Nenhuma linha de login, permissão ou conexão com o banco mudou entre as
versões. A causa provável é a sessão de login do Safari ou arquivos antigos
guardados pelo navegador:

1. Feche a aba e abra o link de novo.
2. Se continuar, abra o menu ☰, toque em **Sair da conta** e entre de novo.
3. Se ainda assim não funcionar, tire um print da tela inteira, com a barra de cima.
