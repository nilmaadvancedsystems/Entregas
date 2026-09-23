// Estado que o robô precisa lembrar de uma leitura do Gmail pra outra: quais
// e-mails já foram lidos, quais anexos ficaram sem dono e quantas vezes um
// anexo quebrado já foi tentado.
//
// Isso morava em três arquivos ao lado do script. Funciona no PC do escritório
// e NÃO funciona na nuvem, onde cada execução nasce com o disco limpo — e
// perder esse estado não é detalhe: o robô releria a janela inteira de dias e
// remarcaria como recebido tudo que alguém tinha desmarcado na mão.
//
// A partir daqui a fonte da verdade é o Firestore, no documento
// robo/gmailEstado. Os arquivos continuam sendo escritos enquanto o robô roda
// no PC: são a rede de segurança pra uma queda de luz no meio da leitura (o
// Firestore é assíncrono; o arquivo fecha na hora) e são o caminho de volta se
// algo der errado. Na nuvem eles simplesmente falham calados e o Firestore
// responde sozinho.
const fs = require('fs');
const path = require('path');

const DOC = { colecao: 'robo', id: 'gmailEstado' };

const CAMINHOS = {
  processados: path.join(__dirname, 'gmail-processados.json'),
  semCliente: path.join(__dirname, 'gmail-sem-cliente.json'),
  tentativas: path.join(__dirname, 'gmail-tentativas.json')
};

// Um id de mensagem do Gmail tem ~16 caracteres; 20 mil deles são ~400 KB,
// ainda longe do teto de 1 MB por documento do Firestore. Passando disso, os
// mais antigos saem — e sair é seguro: e-mail antigo já caiu fora da janela de
// dias que o robô lê, então ele nunca mais vai ser reaberto mesmo.
const MAX_PROCESSADOS = 20000;

function lerArquivo(caminho, padrao) {
  try { return JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch (e) { return padrao; }
}

// Grava num arquivo ao lado e troca de nome no fim, pra uma queda no meio da
// escrita não deixar um arquivo cortado (que abriria como "nada lido").
function gravarInteiro(caminho, texto) {
  fs.writeFileSync(caminho + '.tmp', texto);
  fs.renameSync(caminho + '.tmp', caminho);
}

function vazio() {
  return { processados: new Set(), semCliente: {}, tentativas: {} };
}

function dosArquivos() {
  return {
    processados: new Set(lerArquivo(CAMINHOS.processados, [])),
    semCliente: lerArquivo(CAMINHOS.semCliente, {}),
    tentativas: lerArquivo(CAMINHOS.tentativas, {})
  };
}

// Lê do Firestore. Se o documento ainda não existe (primeira vez), traz o que
// estiver nos arquivos — é assim que a migração acontece sozinha, sem script
// de mão única e sem ninguém precisar lembrar de rodar nada.
async function carregar(db) {
  let doArquivo = null;
  try { doArquivo = dosArquivos(); } catch (e) { doArquivo = null; }

  if (!db) return doArquivo || vazio();

  try {
    const snap = await db.collection(DOC.colecao).doc(DOC.id).get();
    if (!snap.exists) {
      const inicial = doArquivo || vazio();
      console.log('estado do robô: primeira vez no banco, trazendo dos arquivos (' +
        inicial.processados.size + ' lidos, ' + Object.keys(inicial.semCliente).length + ' sem dono)');
      return inicial;
    }
    const d = snap.data() || {};
    return {
      processados: new Set(Array.isArray(d.processados) ? d.processados : []),
      semCliente: d.semCliente || {},
      tentativas: d.tentativas || {}
    };
  } catch (e) {
    // Sem banco (ou sem permissão), o arquivo local ainda segura a leitura —
    // melhor do que começar do zero e remarcar tudo.
    console.log('estado do robô: não consegui ler do banco (' + e.message + '); usando o arquivo local');
    return doArquivo || vazio();
  }
}

// Só os arquivos, e de forma síncrona: é o que dá pra fazer dentro de um
// Ctrl+C, onde não há tempo de esperar a rede.
function salvarLocal(estado) {
  try {
    gravarInteiro(CAMINHOS.processados, JSON.stringify(Array.from(estado.processados)));
    gravarInteiro(CAMINHOS.semCliente, JSON.stringify(estado.semCliente));
    gravarInteiro(CAMINHOS.tentativas, JSON.stringify(estado.tentativas));
  } catch (e) { /* na nuvem não há disco; o Firestore responde sozinho */ }
}

async function salvar(db, estado) {
  salvarLocal(estado);
  if (!db) return;
  let lidos = Array.from(estado.processados);
  if (lidos.length > MAX_PROCESSADOS) lidos = lidos.slice(lidos.length - MAX_PROCESSADOS);
  try {
    await db.collection(DOC.colecao).doc(DOC.id).set({
      processados: lidos,
      semCliente: estado.semCliente || {},
      tentativas: estado.tentativas || {},
      atualizadoEm: new Date().toISOString()
    });
  } catch (e) {
    console.log('estado do robô: não consegui gravar no banco (' + e.message + ')');
  }
}

module.exports = { carregar, salvar, salvarLocal, MAX_PROCESSADOS };
