# Nilma Protocolos — instalação e entrega

O que tem nesta pasta, o que subir, e as duas coisas que só uma pessoa
consegue fazer no console do Firebase.

---

## O pacote

| Arquivo | O que é | Vai pro ar? |
|---|---|---|
| `entregas.html` | O app inteiro — HTML, CSS e JS num arquivo só | **Sim** |
| `firebase-messaging-sw.js` | Service worker: notificação com o app fechado e cache offline | **Sim, obrigatório** |
| `firestore.rules` | As regras de segurança do banco | **Sim** (`--only firestore:rules`) |
| `firebase.json` / `.firebaserc` | Configuração do deploy | Ficam, não são servidos |
| `dados-do-escritorio/` | A base de clientes do escritório | **NÃO. Nunca.** — e não vem neste zip |

### `dados-do-escritorio/` não sobe. Nunca.

**Ela não vem dentro do zip de propósito.** Zip é arquivo feito pra circular —
WhatsApp, e-mail, pendrive, repasse pra quem vai publicar. A base de clientes
fica guardada separada, com o escritório, e só é usada na hora de importar.

São 315 clientes com CPF, CNPJ e telefone, e 476 endereços com coordenada de
GPS. Até a versão anterior isso vinha **dentro do `entregas.html`**, em texto
puro — qualquer pessoa que abrisse o código-fonte da página baixava a carteira
inteira do escritório, sem login. Foi retirado.

Agora esses arquivos são importados uma vez, pelo admin, pelos botões
**Clientes → Base inicial** e **Clientes → Endereços e localização**, que pedem
o arquivo na hora. Guarde a pasta fora do servidor.

O `firebase.json` já lista `dados-do-escritorio/**` no `ignore` do hosting, mas
não confie só nisso: não copie a pasta pro servidor.

---

## Subir

```bash
firebase deploy --only hosting,firestore:rules
```

O `firebase.json` manda `/` cair em `/entregas.html` e envia
`Cache-Control: no-cache` pro HTML e pro service worker — sem isso o navegador
segura uma versão velha e ninguém recebe correção.

---

## As duas coisas que só o console resolve

### 1. O primeiro admin

O app **não** dá admin a ninguém sozinho. Antes ele dava: quem logasse primeiro
virava admin, porque a própria página olhava se a coleção `usuarios` estava
vazia. Isso é decisão do navegador sobre o próprio poder — e qualquer pessoa
logada repetia no console com uma linha:

```js
db.collection('usuarios').doc(auth.currentUser.uid).update({ roles: ['admin'] })
```

As regras agora recusam. Então, na instalação:

1. Entre no app uma vez com a sua conta (você nasce como `staff`).
2. Firebase → Firestore → coleção `usuarios` → seu documento.
3. Troque `roles` de `["staff"]` para `["admin"]`.
4. Recarregue o app. As abas de administração aparecem.

Daí pra frente todo mundo entra por **convite**, gerado no app.

### 2. Domínio autorizado

Se o endereço mudar (sair do GitHub Pages, entrar no Firebase Hosting ou num
domínio próprio):

- Authentication → Settings → **Authorized domains** → adicione o domínio novo.
- Google Cloud → Credenciais → a **API key** tem restrição por referenciador
  HTTP. Inclua o domínio, senão o login volta 403.

---

## O que as regras protegem

`firestore.rules` fecha três buracos que estavam abertos. Vale saber quais,
porque são coisas que um desenvolvedor do comprador procura:

1. **Ninguém se promove.** `roles` só muda por admin, ou entra igual ao de um
   convite válido, não usado e não vencido — e o documento do usuário grava
   qual convite foi, pra regra poder conferir.
2. **Convite não se enumera.** `get` é liberado (quem tem o código é o
   convidado), `list` não. Sem isso, qualquer pessoa logada baixava a coleção
   inteira e ficava com todos os códigos em aberto — inclusive os de
   redefinição de senha, que o serviço de contas aceita como única autorização
   pra trocar a senha de uma conta existente.
3. **Link de assinatura vence de verdade.** A validade era conferida só no
   navegador; pelo SDK direto, link vencido ainda assinava. Agora a expiração e
   o "assina uma vez só" valem no servidor.

A trilha em `auditoria` é só-escrita: ninguém edita, ninguém apaga, nem o
admin. Trilha que o admin limpa não é trilha.

### Testar antes de subir

```bash
firebase emulators:start --only firestore
```

---

## O serviço de contas (Apps Script)

Redefinir senha e excluir acesso precisam de poder de administrador do Firebase,
que o navegador não tem. Isso é feito por um Apps Script cuja URL fica em
`config/integracoes.contasUrl`, editável em **Perfil → Integrações**.

**Ele roda na conta Google de quem instalou.** Se o app mudar de dono, o script
precisa mudar de conta junto — senão, no dia em que aquela conta for desligada,
o escritório perde a redefinição de senha e a exclusão de acesso sem aviso.

---

## A Consulta rápida e o reforço de IA

O botão redondo no canto da tela abre a **Consulta rápida**: a pessoa escreve
a pergunta como fala e recebe o dado do banco.

**Ela funciona sozinha, sem configurar nada, e é de graça.** Roda no próprio
navegador, em cima do que o app já tem carregado, e responde na hora — com o
PC do escritório desligado, inclusive. Nenhum dado de cliente sai do Firebase.
Ela sabe quatro coisas:

| Pergunta | Responde |
|---|---|
| "quem não mandou extrato esse mês?" | pendências de documento, pela regra da tela de Cobrança |
| "entregas do Volponi em agosto" | histórico de um cliente |
| "o que falta na rota?" | o que ainda está pendente de entrega |
| "quantas entregas em 09/2026?" | números fechados do mês |

Entende mês por extenso ("agosto"), abreviado ("ago"), numérico ("09/2026",
"2026-09"), "esse mês" e "mês passado". Acha o cliente pelo nome no meio da
frase, sem acento e sem ligar pra maiúscula.

### O reforço de IA

Quando a Consulta não entende a pergunta, ela oferece **"Tentar com a IA"**.
A ordem (busca local primeiro, IA só no resto) é de propósito: o que dá pra
responder de graça é respondido de graça.

Quem responde é escolhido em **Ajustes › Integrações → Quem responde**
(`config/integracoes.iaMotor`):

- **Claude (PC do escritório)** — o padrão desde 25/09/2026. O
  `scripts/arquivador.js`, que já roda no PC com o Claude instalado, liga junto
  o `scripts/atendente-claude.js`. Cada pergunta vai para uma conversa oculta
  do Claude (`claude -p`, sem janela e sem guardar sessão). Fica sempre uma
  conversa **já aquecida** esperando, e por isso a resposta sai em ~4 a 6 s.
  Cada conversa atende uma pergunta só. Depende do PC ligado: com ele
  desligado, o selo da tela mostra "PC desligado".
- **Gemini (nuvem)** — a reserva. O robô da máquina do Google
  (`scripts/ia-atendente.js`) só atende com esse motor escolhido. A chave fica
  só no disco da máquina, em `scripts/gemini_key.json` (o `.gitignore` barra).
  O modelo é o campo **Modelo**, que só aparece com o Gemini escolhido.

Os dois nunca pegam a mesma pergunta: uma transação em `conversasIA/{id}` trava.

**O que o Claude enxerga:** só consultas de **leitura**, servidas pelo
`scripts/ia-mcp.js`:

- as 4 consultas prontas de `scripts/ia-consultas.js` (pendências, buscar
  cliente, entregas do cliente, resumo do mês) — as mesmas do Gemini, com a
  peneira que não deixa CPF, CNPJ e telefone saírem;
- a leitura livre de `scripts/ia-banco.js` (listar coleções, ler documento,
  consultar coleção com filtro, contar). Aqui o dado vai inteiro, inclusive
  CPF, CNPJ e telefone, porque quem lê é o Claude da conta do escritório. Só
  imagens e textos muito longos são cortados.

Nenhuma ferramenta do Claude Code fica ligada (arquivo, comando, internet), e
os plugins e memórias do Claude do PC ficam de fora. Não existe caminho pelo
qual a IA registre entrega, altere cadastro ou envie cobrança. Cada consulta
traz no máximo 200 documentos; uma pergunta comum gasta de dezenas a ~700
leituras do banco.

**Modelo do Claude:** `sonnet` por padrão. Para gastar menos do limite da
assinatura, grave `iaModeloClaude: 'haiku'` em `config/integracoes`. Vale na
hora; o Haiku erra mais em perguntas de várias etapas.

**Testar antes de publicar:**

```bash
cd scripts
node teste-consulta.js   # o interpretador de mês e de intenção da busca local
node teste-ia.js         # as consultas, a peneira de dado pessoal e o laço do modelo
```

## Limites que valem conhecer

- **1 MB por documento do Firestore.** Assinatura e foto são gravadas como
  data URL dentro de `entregas/{id}/anexos/comprovante`. Foto grande demais faz
  a gravação falhar.
- **Lembrete de anotação só toca com o app aberto.** Notificação agendada com o
  app fechado precisa de push agendado (Cloud Function ou Apps Script).
