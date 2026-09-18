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

### O reforço de IA (opcional, e não precisa ligar)

Quando a Consulta não entende a pergunta, ela pode oferecer um **"Tentar com a
IA"**. Isso é opcional: sem configurar nada, o botão simplesmente não aparece
e todo o resto continua funcionando.

Quem responde é o Gemini, chamado **pelo vigia, no PC do escritório** — não
pelo navegador. A chave da API não pode ir pro navegador: quem abrir o
código-fonte da página leva a chave e passa a gastar a sua cota. É o mesmo
buraco que a base de clientes em texto puro era.

A ordem (busca local primeiro, IA só no resto) é de propósito: o que dá pra
responder de graça é respondido de graça, e a cota da IA fica pro que
realmente precisa dela.

**Pra ligar:**

1. Pegue uma chave em <https://aistudio.google.com/apikey>.
2. No PC do escritório, crie `scripts/gemini_key.json`:
   ```json
   { "apiKey": "cole-a-chave-aqui" }
   ```
   (ou defina a variável de ambiente `GEMINI_API_KEY`.) O `.gitignore` barra
   esse arquivo — ele nunca entra no repositório.
3. Instale a dependência e reinicie o vigia:
   ```bash
   cd scripts && npm install
   ```
4. Em **Perfil → Reforço de IA da Consulta**, confira o estado. Ele diz em uma
   linha se está no ar, se falta chave, ou se o PC está desligado.

**O modelo é trocável na tela**, em Perfil → Integrações, e vale na hora — não
precisa reiniciar o vigia. O padrão é `gemini-flash-latest`, que acompanha a
versão atual do Flash sozinha. Dá pra cravar uma versão (`gemini-3.8-flash`)
ou subir pro Pro (`gemini-pro-latest`), que responde melhor e gasta mais cota.

**Faixa gratuita × paga.** A faixa gratuita não pede cartão e dá conta do uso
de um escritório, mas nela **o Google pode usar o conteúdo pra melhorar os
produtos dele**. Com nome de cliente passando pelo modelo, isso merece
decisão consciente. Na faixa paga ele não usa os dados pra treinar, e o custo
do uso real fica na casa de poucos dólares por mês. A cobrança do Google é
pós-paga, no cartão: **alerta de orçamento do Google Cloud avisa, mas não
interrompe o gasto** — confira os limites por tier no console antes de
cadastrar cartão.

**O que sobe pra API, e o que não sobe.** CPF, CNPJ, telefone, endereço e
coordenada de GPS **não sobem**, nunca. A peneira está em
`scripts/ia-consultas.js` (`limparCliente`) e é escrita ao contrário do
normal: lista o que **pode** sair, em vez do que não pode — assim um campo
novo no cadastro nasce barrado. O `teste-ia.js` confere isso a cada rodada.
O modelo trabalha com nome e situação, que é o que a pergunta precisa.

**O que a IA pode fazer:** só ler. As quatro ferramentas que ela enxerga são
consultas. Não existe caminho pelo qual ela registre entrega, altere cadastro
ou envie cobrança.

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
