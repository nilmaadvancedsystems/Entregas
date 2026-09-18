// O atendente de IA do escritório — o REFORÇO da Consulta rápida.
//
// A Consulta rápida do entregas.html responde sozinha, no navegador, de
// graça e na hora, as perguntas que ela conhece: pendências, entregas de um
// cliente, rota e resumo do mês. Este arquivo existe pro RESTO — a pergunta
// que ela não entendeu. Só nesse caso a tela empurra a pergunta pra cá.
//
// Essa ordem é de propósito: o que dá pra responder de graça é respondido de
// graça, e a IA só é acionada quando agrega. Numa faixa gratuita com cota
// diária, gastar chamada com "quem não mandou extrato" — que a busca local
// resolve em milissegundos — seria desperdício.
//
// Como funciona, de ponta a ponta:
//   1. a tela grava a pergunta em conversasIA/{id}/mensagens e marca a
//      conversa como 'pendente';
//   2. este arquivo vê a conversa pendente, monta a conversa inteira e manda
//      pro Gemini com as ferramentas de ia-consultas.js;
//   3. o modelo pede uma consulta ("listar_pendencias de 2026-09"), a gente
//      executa no Firestore e devolve o resultado;
//   4. a resposta vai sendo gravada aos pedaços no Firestore enquanto é
//      gerada, e a tela mostra o texto crescendo pelo onSnapshot.
//
// POR QUE ISSO RODA NO PC E NÃO NO NAVEGADOR:
// A chave da API não pode ir pro navegador, nem na faixa gratuita. Quem abrir
// o código-fonte da página leva a chave e passa a gastar a cota do escritório
// — é o mesmo buraco que a base de clientes em texto puro era.
//
// POR QUE O TEXTO VAI AOS PEDAÇOS, E COM FREIO:
// Escrever cada palavra no Firestore daria umas 300 gravações por resposta e
// estouraria a cota gratuita do Firebase em um dia de uso. Então o texto sobe
// no máximo uma vez a cada INTERVALO_GRAVACAO_MS.
//
// O QUE ELE NÃO FAZ: não grava nada no banco além da própria conversa. As
// ferramentas de ia-consultas.js são todas de leitura.
const { GoogleGenAI } = require('@google/genai');
const { FERRAMENTAS, executarFerramenta, competenciaAtual } = require('./ia-consultas');

// Apelido que anda junto com a versão atual do Flash, em vez de um número
// cravado que envelhece. O escritório troca isso em Perfil → Integrações sem
// mexer em código: `config/integracoes.iaModelo`.
const MODELO_PADRAO = 'gemini-flash-latest';
const INTERVALO_GRAVACAO_MS = 900;   // freio das gravações de texto parcial
const MAX_IDAS_FERRAMENTA = 6;       // trava contra laço de ferramenta sem fim
const MAX_TOKENS_RESPOSTA = 4096;    // painel lateral: resposta é curta por natureza
const MAX_MENSAGENS_HISTORICO = 24;  // o que sobe de conversa passada por pergunta

const log = (...m) => console.log(new Date().toLocaleString('pt-BR'), '[ia]', ...m);

// ---------- a chave ----------
// Mesma escolha do resto da pasta: credencial fica em arquivo local que o
// .gitignore barra, ou em variável de ambiente. Nunca no código, e nunca no
// Firestore — se a chave entrasse no config/integracoes, qualquer pessoa
// logada no app baixaria ela pelo console do navegador. O MODELO pode ficar
// no Firestore (não é segredo); a CHAVE, não.
function lerChave() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const fs = require('fs');
    const caminho = require('path').join(__dirname, 'gemini_key.json');
    const chave = (JSON.parse(fs.readFileSync(caminho, 'utf8')).apiKey || '').trim();
    return chave || null;
  } catch (e) {
    return null;
  }
}

// ---------- as instruções do atendente ----------
function instrucoes(agora) {
  const hoje = (agora ? new Date(agora) : new Date());
  return [
    'Você é o atendente do sistema interno da Nilma Contabilidade, um escritório de contabilidade brasileiro.',
    'Quem fala com você é gente do escritório: o office boy que entrega documentos e quem cuida da cobrança e da conferência.',
    '',
    'Hoje é ' + hoje.toLocaleDateString('pt-BR') + '. O mês corrente (a "competência") é ' + competenciaAtual(hoje) + '.',
    'Competência sempre no formato AAAA-MM. "Esse mês" é ' + competenciaAtual(hoje) + '.',
    '',
    'COMO RESPONDER:',
    '- Português do Brasil, direto, sem enrolação. Quem lê está em pé na calçada ou com a tela cheia de trabalho.',
    '- Número vem de ferramenta, nunca da sua cabeça. Se não consultou, não afirma.',
    '- Se a consulta não trouxe nada, diga que não trouxe. Não invente cliente, entrega nem valor.',
    '- Quando o resultado vier cortado (o campo "mostrando" menor que "total"), diga o total de verdade e avise que listou só uma parte.',
    '- Lista curta em tópicos. Resposta de uma linha quando uma linha resolve.',
    '',
    'O QUE VOCÊ NÃO PODE FAZER:',
    '- Você só consulta. Não registra entrega, não altera cadastro, não envia cobrança.',
    '- Se pedirem pra mudar alguma coisa, explique em que tela do sistema se faz aquilo e siga em frente.',
    '- Você não recebe CPF, CNPJ nem telefone de cliente, de propósito. Se precisarem desse dado, mande abrir a ficha do cliente na tela.',
  ].join('\n');
}

// ---------- montar a conversa pro modelo ----------
// O histórico vira texto puro: as idas e voltas de ferramenta de perguntas
// ANTERIORES não sobem de novo. Elas já viraram a resposta que está gravada,
// e reenviar tudo só multiplicaria o gasto a cada pergunta nova.
function montarHistorico(mensagens) {
  return mensagens
    .filter(function (m) { return m.texto && String(m.texto).trim(); })
    .slice(-MAX_MENSAGENS_HISTORICO)
    .map(function (m) {
      return {
        role: m.papel === 'model' ? 'model' : 'user',
        parts: [{ text: String(m.texto) }],
      };
    });
}

// Junta os pedaços que chegam picados no stream. Duas sutilezas:
// - parte marcada `thought` é o resumo do raciocínio do modelo, não a
//   resposta: não entra no texto que a pessoa lê;
// - `thoughtSignature` é o lacre que o modelo pede de volta na próxima ida
//   quando houve chamada de ferramenta. Emendar duas partes descartaria o
//   lacre de uma delas, então só emenda texto com texto sem lacre.
function acumularParte(partes, nova) {
  const ultima = partes[partes.length - 1];
  if (
    nova.text != null && !nova.thought && !nova.thoughtSignature &&
    ultima && ultima.text != null && !ultima.thought && !ultima.thoughtSignature
  ) {
    ultima.text += nova.text;
    return;
  }
  partes.push(Object.assign({}, nova));
}

// Erro de cota da faixa gratuita vem como 429. Vale traduzir: "RESOURCE
// EXHAUSTED" não diz nada pra quem está na calçada querendo uma resposta.
function traduzirErro(err) {
  const m = (err && err.message) || String(err);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(m)) {
    return 'a cota do Gemini de hoje acabou; a busca rápida continua funcionando, e a IA volta amanhã';
  }
  if (/API key not valid|API_KEY_INVALID|401|403/i.test(m)) {
    return 'a chave do Gemini foi recusada; confira scripts/gemini_key.json no PC do escritório';
  }
  if (/not found|NOT_FOUND|404/i.test(m)) {
    return 'o modelo configurado não existe ou não está disponível na sua conta; troque em Perfil → Integrações';
  }
  return m;
}

// ---------- uma pergunta, do começo ao fim ----------
async function responder(ai, db, opcoes) {
  const modelo = opcoes.modelo || MODELO_PADRAO;
  const contents = opcoes.contents;
  const aoTexto = opcoes.aoTexto || function () {};
  const aoFerramenta = opcoes.aoFerramenta || function () {};
  const agora = opcoes.agora;

  let textoFinal = '';
  const ferramentasUsadas = [];
  const uso = { entrada: 0, saida: 0 };

  for (let ida = 0; ida < MAX_IDAS_FERRAMENTA; ida++) {
    const stream = await ai.models.generateContentStream({
      model: modelo,
      contents: contents,
      config: {
        systemInstruction: instrucoes(agora),
        tools: [{ functionDeclarations: FERRAMENTAS }],
        maxOutputTokens: MAX_TOKENS_RESPOSTA,
        temperature: 0.2,
      },
    });

    const partesModelo = [];
    let textoDaIda = '';
    let motivoFim = null;

    for await (const pedaco of stream) {
      const candidato = pedaco.candidates && pedaco.candidates[0];
      if (candidato && candidato.finishReason) motivoFim = candidato.finishReason;
      if (pedaco.usageMetadata) {
        uso.entrada = pedaco.usageMetadata.promptTokenCount || uso.entrada;
        uso.saida = pedaco.usageMetadata.candidatesTokenCount || uso.saida;
      }
      const partes = (candidato && candidato.content && candidato.content.parts) || [];
      for (const parte of partes) {
        acumularParte(partesModelo, parte);
        if (parte.text != null && !parte.thought) {
          textoDaIda += parte.text;
          aoTexto(textoFinal + textoDaIda);
        }
      }
    }

    const chamadas = partesModelo
      .filter(function (p) { return p.functionCall; })
      .map(function (p) { return p.functionCall; });

    // Sem chamada de ferramenta: o modelo respondeu, acabou.
    if (!chamadas.length) {
      textoFinal += textoDaIda;
      if (motivoFim && motivoFim !== 'STOP') {
        log('resposta terminou por', motivoFim);
        if (motivoFim === 'MAX_TOKENS') textoFinal += '\n\n_(resposta cortada no limite de tamanho)_';
      }
      return { texto: textoFinal, ferramentas: ferramentasUsadas, uso: uso, modelo: modelo };
    }

    // Tem chamada: executa todas e devolve os resultados juntos, numa volta só.
    textoFinal += textoDaIda;
    contents.push({ role: 'model', parts: partesModelo });

    const respostas = [];
    for (const chamada of chamadas) {
      const nome = chamada.name;
      const args = chamada.args || {};
      aoFerramenta(nome, args);
      let resultado;
      try {
        resultado = await executarFerramenta(db, nome, args, agora);
      } catch (err) {
        log('ferramenta', nome, 'falhou:', err.message);
        resultado = { erro: 'A consulta falhou: ' + err.message };
      }
      ferramentasUsadas.push({ nome: nome, args: args });
      respostas.push({
        functionResponse: {
          id: chamada.id,
          name: nome,
          // a chave "output" é o que o Gemini espera pro resultado em si;
          // "error" seria pra falha. Mandar o objeto cru funcionaria, mas
          // deixa ambíguo o que é resultado e o que é erro.
          response: { output: resultado },
        },
      });
    }
    contents.push({ role: 'user', parts: respostas });
  }

  // Chegou aqui: o modelo ficou pedindo ferramenta e não fechou a resposta.
  log('parou no teto de', MAX_IDAS_FERRAMENTA, 'idas de ferramenta');
  return {
    texto: textoFinal || 'Consultei várias vezes e não consegui fechar uma resposta. Tenta perguntar de um jeito mais específico?',
    ferramentas: ferramentasUsadas,
    uso: uso,
    modelo: modelo,
  };
}

// ---------- atender uma conversa da fila ----------
async function atenderConversa(ai, db, conversaRef, dados, modeloPadrao) {
  const mensagensRef = conversaRef.collection('mensagens');
  const snap = await mensagensRef.orderBy('ordem', 'asc').limit(200).get();
  const mensagens = snap.docs.map(function (d) {
    return Object.assign({ id: d.id }, d.data());
  });

  const ultima = mensagens[mensagens.length - 1];
  if (!ultima || ultima.papel !== 'user') {
    log('conversa', conversaRef.id, 'não termina em pergunta; devolvendo pra ociosa');
    await conversaRef.update({ estado: 'ocioso' });
    return;
  }

  // O lugar onde a resposta vai aparecer, criado já vazio pra tela ter o que
  // mostrar enquanto o modelo pensa.
  const respostaRef = mensagensRef.doc();
  const ordem = (ultima.ordem || mensagens.length) + 1;
  await respostaRef.set({
    papel: 'model',
    texto: '',
    estado: 'gerando',
    ordem: ordem,
    criadoEm: new Date().toISOString(),
  });

  let ultimaGravacao = 0;
  let pendente = null;
  const gravarTexto = function (texto) {
    pendente = texto;
    const agoraMs = Date.now();
    if (agoraMs - ultimaGravacao < INTERVALO_GRAVACAO_MS) return;
    ultimaGravacao = agoraMs;
    const aGravar = pendente;
    pendente = null;
    respostaRef.update({ texto: aGravar }).catch(function (err) {
      log('não consegui gravar o texto parcial:', err.message);
    });
  };

  try {
    const contents = montarHistorico(mensagens);
    const r = await responder(ai, db, {
      modelo: dados.modelo || modeloPadrao,
      contents: contents,
      aoTexto: gravarTexto,
      aoFerramenta: function (nome, args) {
        log('consulta:', nome, JSON.stringify(args));
        respostaRef.update({ consultando: nome }).catch(function () {});
      },
    });

    await respostaRef.update({
      texto: r.texto,
      estado: 'pronta',
      ferramentas: r.ferramentas,
      uso: r.uso,
      modelo: r.modelo,
      consultando: null,
      concluidoEm: new Date().toISOString(),
    });
    await conversaRef.update({
      estado: 'ocioso',
      erro: null,
      atualizadoEm: new Date().toISOString(),
    });
    log('respondeu', conversaRef.id, '(' + r.uso.entrada + ' tokens de entrada, ' + r.uso.saida + ' de saída)');
  } catch (err) {
    const erro = traduzirErro(err);
    log('falhou em', conversaRef.id + ':', erro);
    await respostaRef.update({ texto: '', estado: 'erro', erro: erro, consultando: null }).catch(function () {});
    await conversaRef.update({
      estado: 'erro', erro: erro, atualizadoEm: new Date().toISOString(),
    }).catch(function () {});
  }
}

// ---------- a fila ----------
function iniciarAtendenteIA(db) {
  const chave = lerChave();
  if (!chave) {
    log('sem chave do Gemini — o reforço de IA fica desligado.');
    log('   A Consulta rápida da tela continua funcionando normalmente: ela não usa IA.');
    log('   Pra ligar a IA: GEMINI_API_KEY, ou scripts/gemini_key.json com {"apiKey":"..."}.');
    log('   Veja INSTALACAO.md, seção "O reforço de IA".');
    return function () {};
  }

  const ai = new GoogleGenAI({ apiKey: chave });
  const fila = db.collection('conversasIA');
  const emAndamento = new Set();

  // O modelo mora no Firestore pra trocar sem mexer em código nem reiniciar o
  // vigia: Perfil → Integrações grava, isto aqui escuta.
  let modeloPadrao = MODELO_PADRAO;
  db.doc('config/integracoes').onSnapshot(function (snap) {
    const novo = (snap.exists && snap.data().iaModelo) || '';
    const antes = modeloPadrao;
    modeloPadrao = String(novo).trim() || MODELO_PADRAO;
    if (modeloPadrao !== antes) log('modelo agora é', modeloPadrao);
  }, function (err) { log('não consegui ler o modelo configurado:', err.message); });

  log('reforço de IA ligado (modelo inicial:', modeloPadrao + ').');

  // Avisa a tela que existe IA disponível. Sem isso ela não teria como saber
  // a diferença entre "o PC está ligado mas ninguém configurou chave" e "o PC
  // está ligado e a IA responde" — e ofereceria um botão que não funciona.
  // Mesmo documento que o robô do Gmail já usa pro próprio "vigia.em" —
  // robo/estado, não config/robo: config/* é lido por qualquer logado, e
  // este documento carrega remetente/assunto de cliente (regra em
  // firestore.rules restringe a admin/contábil).
  db.collection('robo').doc('estado')
    .set({ ia: { ligado: true, em: new Date().toISOString() } }, { merge: true })
    .catch(function (err) { log('não consegui avisar a tela:', err.message); });

  const parar = fila.where('estado', '==', 'pendente').limit(20).onSnapshot(function (snap) {
    snap.docs.forEach(function (doc) {
      if (emAndamento.has(doc.id)) return;
      emAndamento.add(doc.id);

      // A trava é em duas camadas: este Set impede o mesmo processo de pegar
      // a conversa duas vezes (o onSnapshot dispara de novo a cada gravação
      // que a gente mesmo faz), e a transação impede dois processos de
      // atender a mesma conversa. O vigia já garante um processo só, mas a
      // transação é barata e o dia em que alguém rodar dois é justamente o
      // dia em que ninguém vai lembrar disso.
      db.runTransaction(async function (t) {
        const atual = await t.get(doc.ref);
        if (!atual.exists || atual.data().estado !== 'pendente') return null;
        t.update(doc.ref, { estado: 'gerando' });
        return atual.data();
      })
        .then(function (dados) {
          if (!dados) return null;
          return atenderConversa(ai, db, doc.ref, dados, modeloPadrao);
        })
        .catch(function (err) { log('erro atendendo', doc.id + ':', err.message); })
        .then(function () { emAndamento.delete(doc.id); });
    });
  }, function (err) {
    log('a escuta da fila caiu:', err.message);
  });

  return parar;
}

module.exports = {
  iniciarAtendenteIA,
  // expostas para o teste-ia.js
  montarHistorico,
  acumularParte,
  instrucoes,
  lerChave,
  traduzirErro,
  MODELO_PADRAO,
  MAX_IDAS_FERRAMENTA,
};
