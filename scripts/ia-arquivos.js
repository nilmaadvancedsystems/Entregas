// A IA lê os arquivos das pastas dos clientes no Drive (pedido do escritório,
// 28/09/2026: "quero que possa acessar arquivos"). SÓ LEITURA.
//
// O atendente roda no PC do escritório, que tem o Drive montado em
// G:\Meu Drive\2026 (o mesmo que a rotina de arquivamento usa). Cada cliente
// tem uma pasta "<código> - <nome>". A IA lista o que tem dentro e abre um
// arquivo: PDF e planilha viram texto, imagem vai como imagem, texto como
// texto. Nunca sai da pasta do cliente (caminho com ".." ou absoluto é
// recusado) e não grava, move nem apaga nada.
const fs = require('fs');
const path = require('path');

const RAIZ = process.env.DRIVE_PASTA_LOCAL || 'G:\\Meu Drive\\2026';
const MAX_LISTA = 300;
const MAX_TEXTO = 60000;
const MAX_BYTES = 15 * 1024 * 1024;
const IMAGENS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const TEXTOS = new Set(['.txt', '.csv', '.ofx', '.xml', '.json', '.ret', '.rem']);

function semAcento(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

// Pasta do cliente: começa com "<código> - "; sem código, pelo nome.
function pastaDoCliente(cliente, raiz) {
  const base = raiz || RAIZ;
  let nomes;
  try { nomes = fs.readdirSync(base); } catch (e) { return { erro: 'não achei a pasta do Drive neste PC (' + base + ')' }; }
  const cod = cliente.codigoOrigem != null ? String(cliente.codigoOrigem) : '';
  let achou = cod ? nomes.find(n => new RegExp('^0*' + cod + '\\s*-').test(n)) : null;
  if (!achou && cliente.nome) achou = nomes.find(n => semAcento(n).indexOf(semAcento(cliente.nome)) !== -1);
  return achou ? { pasta: path.join(base, achou), nome: achou } : { erro: 'o cliente não tem pasta em ' + base };
}

// Caminho relativo dentro da pasta do cliente, sem escapar dela.
function dentro(pasta, rel) {
  const r = String(rel || '').replace(/\//g, path.sep).trim();
  if (path.isAbsolute(r) || r.split(path.sep).indexOf('..') !== -1) return null;
  const final = path.resolve(pasta, r);
  return final === pasta || final.startsWith(pasta + path.sep) ? final : null;
}

function listar(pasta, sub, busca) {
  const inicio = sub ? dentro(pasta, sub) : pasta;
  if (!inicio) return { erro: 'caminho fora da pasta do cliente' };
  const alvo = semAcento(busca);
  const itens = [];
  let total = 0;
  (function andar(dir, prof) {
    if (prof > 8) return;
    let nomes;
    try { nomes = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of nomes) {
      const cheio = path.join(dir, d.name);
      if (d.isDirectory()) { andar(cheio, prof + 1); continue; }
      const rel = path.relative(pasta, cheio).split(path.sep).join('/');
      if (alvo && semAcento(rel).indexOf(alvo) === -1) continue;
      total++;
      if (itens.length >= MAX_LISTA) continue;
      let st = null; try { st = fs.statSync(cheio); } catch (e) {}
      itens.push({ caminho: rel, kb: st ? Math.round(st.size / 1024) : null, modificado: st ? st.mtime.toISOString().slice(0, 10) : null });
    }
  })(inicio, 0);
  itens.sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'));
  return { arquivos: itens, total, cortado: total > itens.length };
}

// Conteúdo pra IA: { texto } ou { imagem: { data, mime } }.
async function lerConteudo(arquivo) {
  const ext = path.extname(arquivo).toLowerCase();
  const st = fs.statSync(arquivo);
  if (st.size > MAX_BYTES) return { erro: 'arquivo grande demais (' + Math.round(st.size / 1048576) + ' MB)' };
  const buf = fs.readFileSync(arquivo);
  if (IMAGENS[ext]) return { imagem: { data: buf.toString('base64'), mime: IMAGENS[ext] } };
  if (ext === '.pdf') {
    const r = await require('pdf-parse')(buf);
    const texto = String(r.text || '').replace(/\n{3,}/g, '\n\n').trim();
    return { texto: texto ? texto.slice(0, MAX_TEXTO) : '(PDF sem texto: provavelmente digitalizado como imagem)', paginas: r.numpages };
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.ods') {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const texto = wb.SheetNames.map(n => '## ' + n + '\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n');
    return { texto: texto.slice(0, MAX_TEXTO) };
  }
  if (TEXTOS.has(ext)) return { texto: buf.toString('utf8').slice(0, MAX_TEXTO) };
  return { erro: 'não leio arquivos ' + (ext || 'sem extensão') + ' (leio PDF, planilha, imagem e texto)' };
}

const FERRAMENTAS_ARQUIVOS = [
  {
    name: 'arquivos_do_cliente',
    description: 'Lista os arquivos da pasta do cliente no Drive do escritório (G:\\Meu Drive\\2026\\<código - nome>): extratos, notas, guias, balancetes... Dá o caminho de cada arquivo pra abrir com ler_arquivo_do_cliente. Só leitura.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nome, código ou id do cliente.' },
        subpasta: { type: 'string', description: 'Opcional: só dentro desta subpasta (ex.: "CONTÁBIL/EXTRATOS/2026/08").' },
        busca: { type: 'string', description: 'Opcional: só arquivos cujo caminho tenha este texto (ex.: "extrato", "08", "sicoob").' },
      },
      required: ['cliente'],
    },
  },
  {
    name: 'ler_arquivo_do_cliente',
    description: 'Abre um arquivo da pasta do cliente no Drive e devolve o conteúdo (PDF e planilha como texto, imagem como imagem). Use o caminho que arquivos_do_cliente deu. Só leitura.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nome, código ou id do cliente.' },
        caminho: { type: 'string', description: 'Caminho do arquivo dentro da pasta do cliente, como veio da lista.' },
      },
      required: ['cliente', 'caminho'],
    },
  },
];
const NOMES_ARQUIVOS = new Set(FERRAMENTAS_ARQUIVOS.map(f => f.name));

async function executarArquivo(db, nome, args) {
  const { acharCliente } = require('./ia-acoes');
  const snap = await db.collection('clientes').where('ativo', '==', true).get();
  const clientes = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  const r = acharCliente(clientes, args && args.cliente);
  if (r.erro) return { erro: r.erro, candidatos: r.candidatos };
  const p = pastaDoCliente(r.cliente);
  if (p.erro) return { erro: p.erro };
  if (nome === 'arquivos_do_cliente') return Object.assign({ pasta: p.nome }, listar(p.pasta, args.subpasta, args.busca));
  if (nome === 'ler_arquivo_do_cliente') {
    const arq = dentro(p.pasta, args.caminho);
    if (!arq) return { erro: 'caminho fora da pasta do cliente' };
    if (!fs.existsSync(arq) || !fs.statSync(arq).isFile()) return { erro: 'arquivo não encontrado: ' + args.caminho };
    return Object.assign({ arquivo: args.caminho }, await lerConteudo(arq));
  }
  return { erro: 'ferramenta desconhecida: ' + nome };
}

module.exports = { FERRAMENTAS_ARQUIVOS, NOMES_ARQUIVOS, executarArquivo, pastaDoCliente, dentro, listar, lerConteudo };
