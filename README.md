# Nilma Entregas

Entregador de Entregas (Nilma Entregas)
https://nilmaadvancedsystems.github.io/Entregas/entregas.html

Para testar sem gravar nada no banco, abra com `?demo=1` no fim do link.

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
