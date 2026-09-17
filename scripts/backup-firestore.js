// Backup completo do banco, em um arquivo JSON.
//
// Por que existe: o projeto esta no plano gratuito do Firebase, e tanto o
// backup agendado quanto a recuperacao a ponto no tempo do Firestore so
// existem no plano pago. Sem isso, um delete errado ou uma regra mal
// publicada apaga registro de entrega -- que e prova de entrega -- sem
// volta. Este script cobre esse buraco sem custo nenhum.
//
// O que ele NAO substitui: a rotina que ja copia assinatura e foto como
// imagem pra NILMA-PROTOCOLO-BACKUPS. Aquilo guarda a prova em formato
// que qualquer um abre; aqui e o banco inteiro, pra conseguir reconstruir
// o sistema (clientes, cargos, honorarios, auditoria...).
//
// Uso:  node backup-firestore.js [pasta-destino]
// Padrao: G:\Meu Drive\NILMA-PROTOCOLO-BACKUPS\banco
//
// So le. Nao escreve nada no Firestore.
const fs = require('fs');
const path = require('path');
const { getDb } = require('./firestore-client');

const DESTINO_PADRAO = 'G:\\Meu Drive\\NILMA-PROTOCOLO-BACKUPS\\banco';

// Converte tipos do Firestore (Timestamp, GeoPoint, referencia) em algo que
// sobrevive ao JSON e ainda diz o que era, pra restauracao nao virar
// adivinhacao.
function serializar(valor) {
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) return valor.map(serializar);
  if (typeof valor === 'object') {
    if (typeof valor.toDate === 'function') return { __tipo: 'timestamp', valor: valor.toDate().toISOString() };
    if (typeof valor.latitude === 'number' && typeof valor.longitude === 'number') {
      return { __tipo: 'geopoint', lat: valor.latitude, lng: valor.longitude };
    }
    if (valor._path && typeof valor.path === 'string') return { __tipo: 'referencia', caminho: valor.path };
    const saida = {};
    Object.keys(valor).forEach(k => { saida[k] = serializar(valor[k]); });
    return saida;
  }
  return valor;
}

async function lerColecao(ref, contador) {
  const snap = await ref.get();
  const docs = {};
  for (const doc of snap.docs) {
    contador.docs++;
    const registro = { dados: serializar(doc.data()) };
    // subcolecoes (entregas/{id}/anexos, usuarios/{id}/notas)
    const subs = await doc.ref.listCollections();
    if (subs.length) {
      registro.subcolecoes = {};
      for (const sub of subs) {
        registro.subcolecoes[sub.id] = await lerColecao(sub, contador);
      }
    }
    docs[doc.id] = registro;
  }
  return docs;
}

async function main() {
  const destino = process.argv[2] || DESTINO_PADRAO;
  const db = getDb('entregas-2e5e2');
  const contador = { docs: 0 };

  const colecoes = await db.listCollections();
  const backup = { projeto: 'entregas-2e5e2', feitoEm: new Date().toISOString(), colecoes: {} };

  for (const col of colecoes) {
    process.stderr.write('lendo ' + col.id + '... ');
    backup.colecoes[col.id] = await lerColecao(col, contador);
    process.stderr.write(Object.keys(backup.colecoes[col.id]).length + ' documentos\n');
  }
  backup.totalDeDocumentos = contador.docs;

  fs.mkdirSync(destino, { recursive: true });
  const nome = 'banco-' + new Date().toISOString().slice(0, 10) + '.json';
  const caminho = path.join(destino, nome);
  fs.writeFileSync(caminho, JSON.stringify(backup, null, 1));

  const mb = (fs.statSync(caminho).size / (1024 * 1024)).toFixed(1);
  console.log('OK:', caminho);
  console.log('colecoes:', colecoes.length, '| documentos:', contador.docs, '| tamanho:', mb, 'MB');
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
