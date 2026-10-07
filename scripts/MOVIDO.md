# O robô mudou para o nads

Desde 07/10/2026 o robô do escritório (o vigia da máquina do Google, o arquivador do PC, o SIEG, os avisos, a régua
de cobrança e o FGTS Digital) mora no repositório do nads, pasta `robo/`:
https://github.com/nilmaadvancedsystems/nads/tree/desenvolvimento/robo

- A máquina do Google (`robo-nilma`) puxa o nads, ramo `desenvolvimento`; atualizar = push lá + trocar `robo-versao`.
- O arquivador do PC roda de `C:\claudio\nads\robo` (pasta Inicializar do Windows → `Arquivador Nilma.cmd`).
- Mudanças no robô se fazem lá, não aqui.

Ficaram aqui só as ferramentas das páginas do Entregas (`teste-app.js`, `teste-pendencias.js`, `teste-consulta.js`,
`teste-codigo-pagamento.js`, `teste-creditor.js` e `monta-folha.js`), que leem os arquivos .html desta raiz.
