# Guia do app Nilma (pra IA tirar dúvidas da equipe)

Linguagem de quem usa, não de programador. Quando o app mudar, atualize aqui.

## Como o app é organizado
- No computador há duas barras laterais: a coluna fixa da esquerda mostra as páginas do módulo aberto; o ☰ (canto de cima) abre o menu geral com todos os módulos: Entregas, Clientes e ajustes, Tarefas, Contábil, Fiscal e Pendências. Cada pessoa só vê os módulos do seu papel.
- "Recolher/Ocultar barra lateral", no pé da coluna, deixa só os ícones (o navegador lembra).
- A foto/ícone no canto de cima abre a conta: Configurações (aparência, tema claro/escuro, foto de perfil ou ícone, senha) e Sair.
- A caixa "Perguntar à IA" (atalho /) abre a conversa com a IA em qualquer tela.
- No celular as páginas do módulo ficam em abas embaixo do cabeçalho e os módulos no ☰.
- A versão do app aparece no rodapé do ☰. Se algo parecer velho, feche e abra o app de novo.

## Entregas
- **Nova entrega**: registra um documento entregue ao cliente. Escolha o cliente, a competência (mês), os documentos (DAS, FGTS, DARF, Honorário, Notas, Boleto...) com os valores, e colete assinatura ou foto. "Adicionar à rota" (botão vermelho) põe na rota em vez de entregar agora: aí escolha a região (superior, central ou inferior).
- **Rota**: as paradas que o entregador leva. Paradas, Ordem fixa (ordem das ruas), Protocolos (imprimir protocolo de papel de um período) e Qualidade (clientes sem região ou sem endereço). Cada parada tem "Entregar" (assinatura/foto), "Não entregue" (com motivo; dá pra reagendar) e o menu com mais opções.
- **Banco (pagar ou buscar documento no banco)**: na Nova entrega, marque "Banco" (ao lado de "Cliente avulso"); o campo Cliente vira Banco (lista: Banco do Brasil, Caixa, Sicoob, Sicredi…, ou digite). Marque os documentos e use "Adicionar à rota": vira a parada "Banco: Sicoob" na Rota, concluída com a foto do comprovante.
- **Lembretes pra entrega**: na página do cliente (Clientes › Carteira › a empresa › Resumo) dá pra deixar um lembrete de algo pra falar com o cliente ("+ Lembrete"). Quem for entregar vê o lembrete em destaque na tela de assinatura e, ao concluir a entrega, abre a janela "Não esqueça de falar com o cliente" com "Falei" (resolve) ou "Deixar pra próxima" — e dá pra deixar um lembrete novo pra próxima vez. Na Rota, a parada com lembrete tem um sininho.
- **Painel**: as entregas do mês por cliente, com filtros, busca e "Exportar PDF/planilha". "Números" mostra o resumo do mês.
- **Honorários**: quem paga honorário em visita, a forma, o dia e o ponto de referência; marca entregue, "Não se aplica" e tem o botão Cadastros.
- **Solicitações**: pedidos internos (buscar documento, atestado etc.). Também ficam no menu da foto. Cada uma tem a data do pedido e a data máxima de conclusão ("Concluir até", padrão daqui a 2 dias); as pendentes ficam em ordem de prazo (urgentes primeiro) e a vencida aparece como "Atrasada".

## Clientes e ajustes
- **Carteira**: lista de clientes com busca. Clicar abre a página do cliente: Resumo (números do mês, avisos, contato, empresa, últimas entregas), Entregas, Cadastro, Receita (dados da Receita Federal), Contatos, Documentos e Ações (link do cliente, desativar etc.).
- Editar cadastro (nome, CNPJ, telefone, endereço, bancos, e-mails) é do admin. A equipe pode mudar e-mail, região da rota, ponto de referência e dias de entrega.
- **Novo cliente**: por CNPJ (busca os dados na Receita) ou à mão.
- **Link do cliente**: página própria do cliente (sem senha, pelo link) onde ele vê guias, confirma "Recebi" e manda documentos.
- **Ajustes**: dados do escritório (PIX, WhatsApp), ordem fixa da rota, integrações, IA, equipe e acessos (convite por link ou criar acesso).

## Pendências (documentos que os clientes mandam)
- **Hoje**: o que chegou hoje e quem está atrasado.
- **Clientes**: cada cliente com os quadrinhos E (extrato), C (comprovantes) e A (aplicação) do mês. Clicar num quadrinho marca/desmarca como recebido (com Desfazer). Se o cliente tem vários bancos, a ficha mostra banco por banco. "Sem movimento" e "Não se aplica" tiram a pendência do mês.
- O mês aberto muda nas setas do topo.
- **Robô do Gmail**: o robô (na nuvem) lê a caixa nilmacontabilidade@gmail.com, reconhece o cliente pelo e-mail, salva os anexos no Drive e marca sozinho o que chegou. Abas: E-mails de clientes, Sem cliente (vincule o remetente a um cliente), Spam, Marcados, Histórico. Dá pra responder o e-mail pelo app. "Cobranças" e "Disparo" mandam e-mail cobrando o que falta.
- **Arquivo**: a pasta 2026 do Drive por cliente; pedir arquivamento (a rotina que organiza os arquivos nas pastas) e ver as execuções.
- **Configurações** da Pendências: textos dos e-mails, lembretes, cobrança.

## Tarefas
- Minhas tarefas, Todas as tarefas, Requisições (pedidos que vieram do cliente), Minhas empresas, Todas as empresas, Parcelamentos e Equipe e férias.
- Tarefa tem título, empresa, responsável, prazo, prioridade (urgente, alta, normal, baixa), status (a fazer, em andamento, aguardando cliente, feito), checklist, comentários e anexos (clicar, arrastar ou colar).
- Visões Lista e Quadro. Cada empresa tem DOIS responsáveis, um do Contábil e um do Fiscal (o admin escolhe em "Todas as empresas", nas colunas Contábil e Fiscal). Tarefa tem Setor: a tarefa de uma empresa vai pro responsável do setor dela; trocar o setor passa pro responsável do outro. Sem responsável, a tarefa fica com quem criou. "Minhas empresas" mostra as empresas em que você é responsável em qualquer setor.
- Caderno da empresa: onde parou, particularidades, recado por banco e quem substitui nas férias.
- Parcelamentos (PGFN, Simples, Receita): o robô marca a parcela paga pelo comprovante e avisa atrasos.

## Contábil e Fiscal
- **Contábil**: Conciliadorzinho (conciliação de cartão/maquininha) e Cheque especial.
- **Fiscal**: Importador LCDPR.
- Só aparecem pra quem tem o papel contábil/fiscal.

## Perguntar à IA
- Dois modos: Rápida (busca na hora, de graça) e Com IA (entende pergunta aberta).
- A IA consulta o sistema e lê os arquivos das pastas dos clientes no Drive (só leitura).
- Dá pra mandar arquivo (clipe, colar print ou arrastar): PDF, imagem, texto. Ex.: mandar a guia do DAS e pedir "coloca na rota da Padaria".
- A IA PREPARA e você CONFIRMA num cartão: colocar na rota, marcar extrato/comprovante/aplicação recebido, criar tarefa e alterar o cadastro do cliente (e-mail, telefone, endereço, região, nome fantasia, ponto de referência, observação, responsável). Ela nunca grava sozinha.

## Problemas comuns
- "Não aparece a mudança": feche e abra o app (o navegador guarda a versão antiga).
- "Sem permissão": a ação é do admin (cadastro, bancos, acessos).
- "A IA não responde": ela roda no PC do escritório; se ele estiver desligado, use a resposta Rápida.
- "O robô não marcou o extrato": veja em Pendências › Robô do Gmail se o e-mail caiu em Sem cliente (vincule o remetente) ou Spam.

<!-- FAQ-TAREFAS:INICIO (gerado pelo nads: npm run faq; não edite aqui, edite o faq-tarefas.md) -->
## Tarefas (nads, tarefas-nilma.web.app) — Primeiros passos

### O que é a Tarefas?
É onde o escritório faz a rotina de cada empresa, etapa por etapa (Importação, Conferência fiscal, Caixa, Bancos, Fechamento…). Cada etapa abre a ferramenta certa no meio da tela, e o andamento fica salvo para todo mundo ver. O endereço é tarefas-nilma.web.app.

### Como eu entro?
Com o mesmo usuário e senha do Entregas. Se a proteção do login estiver ligada, um computador novo precisa ser liberado por um administrador: você pede a liberação na tela de entrada e ele passa um código de 6 números.

### Onde ficam os módulos (Minhas empresas, Drive, Gmail…)?
No ☰, no canto de cima à esquerda. Cada pessoa vê só os módulos do seu setor: o Drive é do Contábil; o Gmail é do Contábil e do Fiscal; o Fiscal (em desenvolvimento) é do Fiscal. A barra da esquerda mostra as páginas do módulo aberto.

### O que é a Minha página?
A janela que abre no seu avatar (a foto ou as iniciais, no canto de cima à direita). Tem a Caixa de entrada, as Anotações, a sua conta, a aparência, a versão do sistema, estas perguntas frequentes e o chat com a IA.

## Tarefas (nads, tarefas-nilma.web.app) — Minhas empresas e o executor

### Como começo a rotina de uma empresa?
Em Minhas empresas, escolha a competência (o mês) no seletor de cima e clique em Iniciar (ou Continuar, se já começou). O executor abre na etapa da vez. Dá para escolher Competência (um mês) ou Em lote (vários meses de uma vez) no próprio seletor.

### Como passo para a próxima etapa?
No executor, use o botão de seta (Próximo) no canto de cima. Se faltar algo para seguir, aparece o sino com um número: clique nele para ver o que falta e use Resolver, que leva até o problema e o destaca.

### Como paro uma etapa que não dá para terminar agora?
Use Interromper (o X vermelho, o último botão do cabeçalho do executor) e escolha o motivo (por exemplo, "O cliente não enviou o extrato"). A etapa fica parada até alguém retomar, e aparece na sua Caixa de entrada com o botão Retomar.

### O que é o Em lote?
Fazer a mesma rotina para vários meses de uma vez (um período, como julho a setembro). Alterar ou cancelar o período só pode ser feito na Importação; depois dela, não.

### Onde vejo as etapas paradas de todas as empresas?
Em Contábil › Paradas (para o Contábil e admin): a empresa, a etapa, o motivo, quem parou e quando.

### Para que serve a página da empresa?
Clicando numa empresa em Minhas empresas, abre o resumo dela: os números, as etapas, o histórico e os extratos da competência.

## Tarefas (nads, tarefas-nilma.web.app) — Drive

### Como acho um arquivo de um cliente?
Em Drive, abra a pasta do cliente (ou digite o nome na busca: a tecla T vai direto para ela). Dentro da pasta, a árvore da esquerda mostra as subpastas. Dois cliques abrem o arquivo; o botão direito mostra as opções (baixar, copiar o caminho, propriedades…).

### Como mando um arquivo para ser arquivado?
Use "Enviar para o Claudio Secretário" (o + no painel do Drive, ou o botão direito numa pasta). O arquivo vai para a pasta do Claudio Secretário e entra na próxima rodada de arquivamento; em Meus envios (e na sua Caixa de entrada) você vê onde ele foi parar.

### O mapa do Drive está velho. E agora?
Use o botão de atualizar o mapa (as setas girando) no painel do Drive: o robô relê a pasta do ano.

## Tarefas (nads, tarefas-nilma.web.app) — Gmail e cobranças

### O que é a caixa do robô do Gmail?
Os e-mails de clientes que o robô leu: os que têm anexo, já ligados ao cliente. Em cima dá para escolher a caixa (a da Nilma Contabilidade e a do seu setor). As abas separam De clientes, Sem cliente e Spam.

### O que faço com um e-mail sem cliente?
Abra o e-mail e escolha de qual cliente ele é: o robô aprende o remetente e os próximos já chegam ligados. Se for propaganda, marque como spam. A sua Caixa de entrada avisa quando há e-mails sem cliente.

### Como peço documentos a um cliente (cobrança)?
Na etapa de Importação, use Pedir extratos (ou Pedir documentos): monte a lista do que falta, confira o e-mail como o cliente vai ver e envie. O robô manda pela caixa do escritório e as respostas voltam para a caixa do setor. As cobranças que você pediu aparecem na sua Caixa de entrada, com "Enviado" ou o erro.

## Tarefas (nads, tarefas-nilma.web.app) — Cadastro

### Onde ficam as contas bancárias de uma empresa?
Em Cadastro › Empresas: clique na empresa e abra a aba Contas bancárias. Dá para incluir, editar, encerrar e reabrir. O que o robô já sabe dos extratos aparece em "O robô já sabe", com Incluir.

### Como importo o plano de contas?
Na janela da empresa, aba Plano de contas: importe a planilha do Alterdata (ou o balancete) ou monte pelo balancete que o Entregas já tem.

### Quem muda o setor, o cargo e os papéis de uma pessoa?
Um administrador, em Cadastro › Usuários. Lá também ficam os computadores liberados de cada pessoa.

## Tarefas (nads, tarefas-nilma.web.app) — Minha página e conta

### O que aparece na Caixa de entrada?
O que é seu e pede atenção: as etapas que você parou (com Retomar), os e-mails sem cliente da caixa do seu setor, as cobranças que você pediu, os arquivos que mandou ao Claudio Secretário e, para o admin, os pedidos de liberação de computador. Cada item pode ser arquivado (some da caixa e fica em Arquivados).

### Como uso as Anotações?
Na Minha página › Anotações: escreva e clique em Anotar (ou Ctrl+Enter). Dá para pôr um lembrete com data e hora, marcar como feita, clicar no texto para editar e apagar. São as mesmas anotações do Entregas: o que você anota num aparece no outro, e só você vê.

### Como troco a foto de perfil?
Na Minha página › Minha conta: Escolher foto (uma imagem do computador) ou um dos ícones. A foto aparece no seu avatar e também no Entregas.

### Como troco o meu nome ou a minha senha?
Na Minha página › Minha conta: edite o nome e clique em Salvar; para a senha, Trocar senha pede a atual e a nova duas vezes. É a mesma senha do Entregas.

### Dá para a Tarefas abrir direto no Drive ou no mês atual?
Sim, na Minha página › Aparência e telas: "Onde a Tarefas abre" e "Mês em que as telas abrem". Ali também ficam o tema (claro, escuro), a barra lateral recolhida, as tabelas compactas e a lista dos atalhos de teclado. Vale para este navegador.

## Tarefas (nads, tarefas-nilma.web.app) — Problemas comuns

### Apareceu "Versão nova" ou o sistema pediu para atualizar.
Clique em Atualizar: o que estava na tela volta depois. Se algo parecer antigo, recarregue a página (F5).

### Deu "Failed to fetch dynamically imported module" ou uma tela não abriu.
É uma aba aberta desde antes de uma atualização do sistema. Recarregue a página (F5) e tente de novo.

### Não vejo o Drive ou o Gmail no ☰.
Eles aparecem só para o setor deles (Drive: Contábil; Gmail: Contábil e Fiscal). Se o seu setor estiver errado, peça a um administrador para corrigir em Cadastro › Usuários.

### O computador pede liberação.
A proteção do login está ligada e este computador ainda não foi liberado. Peça a liberação na tela de entrada; um administrador aprova e passa o código.

### A IA não responde.
O chat depende do robô da IA (que roda no computador do escritório). Se ele estiver desligado, a Minha página avisa "A IA está desligada agora"; tente mais tarde ou consulte estas perguntas frequentes.
<!-- FAQ-TAREFAS:FIM -->
