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
