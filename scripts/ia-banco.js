// Leitura livre do banco pro Claude do PC (servida pelo ia-mcp.js).
//
// As 4 consultas prontas do ia-consultas.js respondem as perguntas comuns;
// estas aqui deixam o Claude olhar qualquer coleção quando a pergunta foge
// delas. TUDO SÓ LEITURA: nenhuma função aqui grava, apaga ou altera.
//
// Diferente do ia-consultas.js, aqui o dado vai inteiro (inclusive CPF, CNPJ
// e telefone) — pedido do escritório em 25/09/2026, porque quem lê é o
// Claude da conta do próprio escritório, e não a faixa gratuita do Gemini.
// Só é cortado o que não serve pra responder e estouraria a conversa:
// imagens em base64 (assinatura, foto) e textos muito compridos.

const LIMITE_PADRAO = 30;
const LIMITE_MAXIMO = 200;
const TEXTO_MAXIMO = 600;
const OPERADORES = ['==', '!=', '<', '<=', '>', '>=', 'array-contains', 'array-contains-any', 'in', 'not-in'];

function limitar(n) {
  const v = parseInt(n, 10);
  if (!isFinite(v) || v <= 0) return LIMITE_PADRAO;
  return Math.min(v, LIMITE_MAXIMO);
}

// Deixa o documento legível e curto: data vira texto ISO, referência vira
// caminho, imagem some, texto longo é cortado com aviso.
function enxugar(v, prof) {
  prof = prof || 0;
  if (v == null) return v;
  if (typeof v === 'string') {
    if (/^data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(v)) return '(imagem ' + Math.round(v.length / 1365) + ' KB, omitida)';
    return v.length > TEXTO_MAXIMO ? v.slice(0, TEXTO_MAXIMO) + '… (cortado, ' + v.length + ' caracteres)' : v;
  }
  if (typeof v !== 'object') return v;
  if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return String(v); } }
  if (v.path && v.firestore) return 'ref:' + v.path;
  if (v.latitude != null && v.longitude != null && Object.keys(v).length <= 2) return { lat: v.latitude, lng: v.longitude };
  if (Buffer.isBuffer(v)) return '(binário omitido)';
  if (prof > 6) return '(aninhado demais)';
  if (Array.isArray(v)) {
    const lista = v.slice(0, 50).map(x => enxugar(x, prof + 1));
    if (v.length > 50) lista.push('… mais ' + (v.length - 50) + ' itens');
    return lista;
  }
  const o = {};
  Object.keys(v).forEach(k => { o[k] = enxugar(v[k], prof + 1); });
  return o;
}

function escolherCampos(dados, campos) {
  if (!Array.isArray(campos) || !campos.length) return dados;
  const o = {};
  campos.forEach(c => {
    const valor = String(c).split('.').reduce((acc, p) => (acc == null ? undefined : acc[p]), dados);
    if (valor !== undefined) o[c] = valor;
  });
  return o;
}

function montarConsulta(db, a) {
  if (!a.colecao || typeof a.colecao !== 'string') throw new Error('Informe "colecao" (ex.: "clientes" ou "clientes/ID/sub").');
  const partes = a.colecao.split('/').filter(Boolean);
  if (partes.length % 2 === 0) throw new Error('"colecao" tem que apontar pra uma coleção (número ímpar de partes), não pra um documento.');
  let q = db.collection(partes.join('/'));
  (Array.isArray(a.filtros) ? a.filtros : []).forEach(f => {
    if (!f || !f.campo || !OPERADORES.includes(f.op)) throw new Error('Filtro inválido: ' + JSON.stringify(f) + '. Operadores: ' + OPERADORES.join(' '));
    q = q.where(f.campo, f.op, f.valor);
  });
  return q;
}

const FERRAMENTAS_BANCO = [
  {
    name: 'listar_colecoes',
    description: 'Lista as coleções de primeiro nível do banco (Firestore). Use pra descobrir onde está a informação.',
    parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ler_documento',
    description: 'Lê um documento inteiro pelo caminho (ex.: "clientes/ID", "config/integracoes", "robo/estado") e diz quais subcoleções ele tem.',
    parametersJsonSchema: {
      type: 'object',
      properties: { caminho: { type: 'string', description: 'Caminho do documento: coleção/id[/subcoleção/id...].' } },
      required: ['caminho'],
    },
  },
  {
    name: 'consultar_colecao',
    description:
      'Busca documentos de uma coleção com filtros opcionais. Sem índice composto no banco, combinar filtro de ' +
      'igualdade com ordenação em outro campo pode falhar — se falhar, tire a ordenação e ordene você mesmo. ' +
      'Antes de filtrar por um campo, leia um documento de exemplo pra saber o nome e o formato do campo.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        colecao: { type: 'string', description: 'Caminho da coleção (ex.: "entregas", "conversasIA/ID/mensagens").' },
        filtros: {
          type: 'array',
          description: 'Filtros (todos valem juntos).',
          items: {
            type: 'object',
            properties: {
              campo: { type: 'string' },
              op: { type: 'string', enum: OPERADORES },
              valor: { description: 'Valor a comparar (texto, número, booleano ou lista pra in/not-in/array-contains-any).' },
            },
            required: ['campo', 'op', 'valor'],
          },
        },
        ordenar_por: { type: 'string', description: 'Campo pra ordenar (opcional).' },
        decrescente: { type: 'boolean', description: 'Ordem decrescente. Padrão: falso.' },
        limite: { type: 'integer', description: 'Quantos documentos no máximo. Padrão 30, teto 200.' },
        campos: { type: 'array', items: { type: 'string' }, description: 'Só estes campos de cada documento (economiza espaço). Aceita "a.b".' },
      },
      required: ['colecao'],
    },
  },
  {
    name: 'contar',
    description: 'Conta quantos documentos uma coleção tem, com os mesmos filtros de consultar_colecao. Não traz os documentos.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        colecao: { type: 'string' },
        filtros: { type: 'array', items: { type: 'object' } },
      },
      required: ['colecao'],
    },
  },
];

async function executarBanco(db, nome, args) {
  const a = args || {};
  switch (nome) {
    case 'listar_colecoes': {
      const cols = await db.listCollections();
      return { colecoes: cols.map(c => c.id).sort() };
    }
    case 'ler_documento': {
      const partes = String(a.caminho || '').split('/').filter(Boolean);
      if (!partes.length || partes.length % 2 !== 0) return { erro: 'O caminho tem que apontar pra um documento (coleção/id).' };
      const ref = db.doc(partes.join('/'));
      const [snap, subs] = await Promise.all([ref.get(), ref.listCollections()]);
      if (!snap.exists) return { caminho: ref.path, existe: false, subcolecoes: subs.map(c => c.id) };
      return { caminho: ref.path, existe: true, dados: enxugar(snap.data()), subcolecoes: subs.map(c => c.id) };
    }
    case 'consultar_colecao': {
      let q = montarConsulta(db, a);
      if (a.ordenar_por) q = q.orderBy(a.ordenar_por, a.decrescente ? 'desc' : 'asc');
      const limite = limitar(a.limite);
      const snap = await q.limit(limite + 1).get();
      const docs = snap.docs.slice(0, limite).map(d => Object.assign({ id: d.id }, enxugar(escolherCampos(d.data(), a.campos))));
      return { colecao: a.colecao, mostrando: docs.length, temMais: snap.docs.length > limite, documentos: docs };
    }
    case 'contar': {
      const snap = await montarConsulta(db, a).count().get();
      return { colecao: a.colecao, total: snap.data().count };
    }
    default:
      return null;   // não é daqui
  }
}

module.exports = { FERRAMENTAS_BANCO, executarBanco, enxugar, escolherCampos };
