# Nilma Entregas

Entregador de Entregas (Nilma Entregas)
https://nilmaadvancedsystems.github.io/Entregas/entregas.html

Para testar sem gravar nada no banco, abra com `?demo=1` no fim do link.

## Configurações no estilo do Notion (versão 2.346)

O menu da foto (canto de cima) tem **Minha conta** e **Configurações**. As
duas abrem a mesma janela, igual no Entregas, na Pendências e no Fiscal
(`nilma-config.js`): tópicos à esquerda, com busca, e as opções à direita, no
desenho da ficha do cliente.

- **Minha conta**: foto, nome, e-mail, cargos, trocar senha e sair.
- **Preferências**: tema, onde o Entregas abre e como abrir os PDFs do Drive.
- **Notificações**: se os avisos estão ligados neste aparelho.
- **Aplicativo**: instalar, versão e "Buscar a versão mais nova".
- **Integrações** (só admin): se o robô, o Gmail e a IA estão no ar.

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
