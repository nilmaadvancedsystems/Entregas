// Os XMLs que o SIEG manda (nads, 07/10/2026: "quero que tenha como importar os XML direto do SIEG"): o nome de cada
// arquivo na pasta do cliente (para o Alterdata importar) e o resumo de cada nota que vai para o banco (siegNotas) — só o
// resumo, nunca o arquivo. Funções puras: o sieg.js baixa e grava; aqui só se lê o XML.
//   NF-e/NFC-e: a chave, o número, a série, a data, o emitente, o destinatário, o valor e os itens (NCM, CFOP, CST/CSOSN, CEST)
//   CT-e: a chave, o número, a data, o emitente, o valor e o CFOP
//   NFS-e (o padrão nacional e o ABRASF): o número, a data, o prestador, o tomador, o valor, o NBS, a descrição e as retenções
//   evento de cancelamento (110111): { cancela: chave }; os outros eventos: só o arquivo
const crypto = require('crypto');

const re = (nome, g) => new RegExp('<(?:\\w+:)?' + nome + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + nome + '>', g);
/** O conteúdo da primeira tag com este nome (sem prefixo), ou ''. */
const tag = (xml, nome) => { const m = re(nome).exec(xml || ''); return m ? m[1].trim() : ''; };
/** O primeiro de vários nomes que existir. */
const primeira = (xml, ...nomes) => { for (const n of nomes) { const v = tag(xml, n); if (v) return v; } return ''; };
/** Todos os blocos <nome …>…</nome>. */
const blocos = (xml, nome) => { const out = []; const r = re(nome, 'g'); let m; while ((m = r.exec(xml || ''))) out.push(m[1]); return out; };
const num = v => { const n = Number(String(v || '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
/** dd/mm/aaaa de uma data ISO (2026-09-03T10:00:00-03:00) ou aaaa-mm-dd. */
const data = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const pessoa = bloco => ({ doc: primeira(bloco, 'CNPJ', 'CPF', 'Cnpj', 'Cpf'), nome: primeira(bloco, 'xNome', 'RazaoSocial', 'xFant') });

/** O que é o XML: 'nfe' (NF-e e NFC-e), 'cte', 'evento', 'nfse' ou null. */
function tipoDoXml(xml) {
  if (/<(?:\w+:)?tpEvento>/.test(xml)) return 'evento';
  if (/Id="NFe\d{44}"/.test(xml)) return 'nfe';
  if (/Id="CTe\d{44}"/.test(xml)) return 'cte';
  if (/<(?:\w+:)?(?:NFSe|CompNfse|Nfse|InfNfse|infNFSe)[\s>]/.test(xml)) return 'nfse';
  return null;
}

/** O nome do arquivo na pasta: a chave (NF-e/CT-e), a chave e o evento, ou o número da NFS-e. Sempre o mesmo para o mesmo XML. */
function nomeDoArquivo(xml) {
  const t = tipoDoXml(xml);
  const hash = crypto.createHash('md5').update(xml).digest('hex').slice(0, 10);
  if (t === 'nfe') return /Id="NFe(\d{44})"/.exec(xml)[1] + '-nfe.xml';
  if (t === 'cte') return /Id="CTe(\d{44})"/.exec(xml)[1] + '-cte.xml';
  if (t === 'evento') return (primeira(xml, 'chNFe', 'chCTe') || hash) + '-evento-' + (tag(xml, 'tpEvento') || 'x') + '-' + (tag(xml, 'nSeqEvento') || '1') + '.xml';
  if (t === 'nfse') {
    const n = primeira(xml, 'nNFSe', 'Numero');
    const prest = pessoa(primeira(xml, 'emit', 'PrestadorServico', 'Prestador')).doc;
    return 'nfse-' + (prest ? prest + '-' : '') + (n || hash) + '.xml';
  }
  return 'xml-' + hash + '.xml';
}

/** O CST do item: o CSOSN (Simples) ou a origem + o CST (ex.: 060). */
function cstDoItem(det) {
  const icms = tag(det, 'ICMS');
  const csosn = tag(icms, 'CSOSN');
  if (csosn) return csosn;
  const cst = tag(icms, 'CST');
  return cst ? (tag(icms, 'orig') || '') + cst : '';
}

/** O resumo de uma nota (o que vai para o banco), { cancela } para o cancelamento, ou null (outro evento, XML desconhecido). */
function resumoDaNota(xml) {
  const t = tipoDoXml(xml);
  if (t === 'evento') return tag(xml, 'tpEvento') === '110111' ? { cancela: primeira(xml, 'chNFe', 'chCTe') } : null;
  if (t === 'nfe') {
    const ide = tag(xml, 'ide');
    return {
      tipo: tag(ide, 'mod') === '65' ? 'NFC-e' : 'NF-e',
      chave: /Id="NFe(\d{44})"/.exec(xml)[1], numero: tag(ide, 'nNF'), serie: tag(ide, 'serie'), data: data(primeira(ide, 'dhEmi', 'dEmi')),
      emitente: pessoa(tag(xml, 'emit')), destinatario: pessoa(tag(xml, 'dest')), valor: num(tag(tag(xml, 'ICMSTot'), 'vNF')),
      itens: blocos(xml, 'det').map(det => ({ ncm: tag(det, 'NCM'), cfop: tag(det, 'CFOP'), cst: cstDoItem(det), cest: tag(det, 'CEST'), valor: num(tag(det, 'vProd')) })),
    };
  }
  if (t === 'cte') {
    const ide = tag(xml, 'ide');
    return {
      tipo: 'CT-e', chave: /Id="CTe(\d{44})"/.exec(xml)[1], numero: tag(ide, 'nCT'), serie: tag(ide, 'serie'), data: data(tag(ide, 'dhEmi')),
      emitente: pessoa(tag(xml, 'emit')), destinatario: pessoa(primeira(xml, 'dest', 'rem')), valor: num(primeira(xml, 'vTPrest', 'vRec')), cfop: tag(ide, 'CFOP'),
    };
  }
  if (t === 'nfse') {
    const ret = {
      ISS: num(primeira(xml, 'vISSRet', 'ValorIssRetido', 'vISSQNRet')), INSS: num(primeira(xml, 'vRetCP', 'ValorInss')),
      IRRF: num(primeira(xml, 'vRetIRRF', 'ValorIr')), PIS: num(primeira(xml, 'vRetPIS', 'ValorPis')),
      COFINS: num(primeira(xml, 'vRetCOFINS', 'ValorCofins')), CSLL: num(primeira(xml, 'vRetCSLL', 'ValorCsll')),
    };
    // o ISS do ABRASF só é retido com IssRetido = 1
    if (!tag(xml, 'vISSRet') && tag(xml, 'IssRetido') && tag(xml, 'IssRetido') !== '1') ret.ISS = 0;
    return {
      tipo: 'NFS-e', chave: '', numero: primeira(xml, 'nNFSe', 'Numero'), serie: '', data: data(primeira(xml, 'dhEmi', 'dhProc', 'DataEmissao', 'Competencia')),
      emitente: pessoa(primeira(xml, 'emit', 'PrestadorServico', 'Prestador')), destinatario: pessoa(primeira(xml, 'toma', 'TomadorServico', 'Tomador')),
      valor: num(primeira(xml, 'vServ', 'ValorServicos')), nbs: primeira(xml, 'cNBS', 'CodigoNbs'),
      descricao: primeira(xml, 'xDescServ', 'Discriminacao').slice(0, 300),
      retencoes: Object.entries(ret).filter(([, v]) => v > 0).map(([imposto, valor]) => ({ imposto, valor })),
    };
  }
  return null;
}

// ---------- o .zip com todos os XMLs (07/10/2026: "quero que ele também salve um arquivo .zip na hora"), sem biblioteca ----------
const zlib = require('zlib');
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Um .zip (deflate) com os arquivos [{ nome, xml }]: o cabeçalho de cada um, o diretório central e o fim. */
function zipDe(arquivos) {
  const locais = [];
  const centrais = [];
  let pos = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const dados = Buffer.from(a.xml, 'utf8');
    const comp = zlib.deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(pos, 42);
    locais.push(local, nome, comp);
    centrais.push(central, nome);
    pos += 30 + nome.length + comp.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, dir, fim]);
}

module.exports = { tipoDoXml, nomeDoArquivo, resumoDaNota, zipDe, crc32 };
