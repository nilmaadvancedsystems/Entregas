// Testa o envolvedor de leituras contra uma imitação da cadeia de protótipos
// do SDK compat: Query tem get/onSnapshot, CollectionReference herda de Query,
// DocumentReference tem os seus.
const fs = require('fs');
const s = fs.readFileSync(__dirname + '/../entregas.html', 'utf8');
const pega = nome => {
  const ini = s.indexOf('  function ' + nome + '(');
  const fim = s.indexOf('\n  }\n', ini);
  if (ini < 0 || fim < 0) throw new Error('nao achei ' + nome);
  return s.slice(ini, fim + 5);
};

class Query {
  constructor(n) { this.n = n; }
  where() { return new Query(this.n); }
  get() { return Promise.resolve({ size: this.n }); }
  onSnapshot(cb) { cb({ size: this.n, docChanges: () => new Array(this.n) }); return () => {}; }
}
class CollectionReference extends Query {}
class DocumentReference {
  get() { return Promise.resolve({ exists: true }); }
  onSnapshot(cb) { cb({ exists: true }); return () => {}; }
}
const db = { collection: () => new CollectionReference(7), doc: () => new DocumentReference() };

let guardado = {};
const localStorage = { getItem: k => guardado[k] || null, setItem: (k, v) => { guardado[k] = v; } };
const codigo = pega('chaveLeituras_') + pega('lerContadorDeLeituras_') + pega('contarLeituras_') +
  pega('donoDoMetodo_') + pega('envolverLeituras_') +
  '; envolverLeituras_(); return { contar: lerContadorDeLeituras_, chave: chaveLeituras_ };';
const api = new Function('db', 'localStorage', 'leiturasHoje_', codigo)(db, localStorage, { dia: '', n: 0 });

let falhas = 0, total = 0;
const igual = (nome, a, b) => { total++; if (a !== b) { falhas++; console.log('FALHOU', nome, '| obtido', a, '| esperado', b); } };

igual('começa zerado', api.contar(), 0);
db.collection('clientes').get().then(() => {
  igual('consulta de coleção conta os documentos', api.contar(), 7);
  return db.collection('clientes').where('ativo', '==', true).get();
}).then(() => {
  igual('consulta COM filtro também conta', api.contar(), 14);
  return db.doc('robo/estado').get();
}).then(() => {
  igual('leitura de um documento conta 1', api.contar(), 15);
  db.collection('entregas').onSnapshot(() => {});
  igual('ouvinte conta o que mudou', api.contar(), 22);
  db.doc('robo/estado').onSnapshot(() => {});
  igual('ouvinte de documento conta 1', api.contar(), 23);
  igual('guardou no aparelho', Number(guardado[api.chave()]), 23);
  console.log(falhas ? falhas + ' de ' + total + ' FALHARAM' : total + ' testes, todos passaram');
  process.exit(falhas ? 1 : 0);
});
