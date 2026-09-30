// Agência e conta do cliente, lidas do cabeçalho do extrato (30/09/2026).
//
// O banco o robô já reconhece (bancos.js); aqui ele aprende também a agência e a
// conta, para o Cadastro do nads (Tarefas › Cadastro) já vir com as contas de
// cada cliente. Vale a mesma cautela do banco: só o CABEÇALHO do PDF conta — no
// miolo, "PIX RECEBIDO ... AG 1234 CC 5678" é a conta de quem pagou, não a do
// cliente. E só guarda quando acha as duas coisas (agência E conta).
//
// No banco: clientes/{id}.contasBancarias = [{ banco, agencia, conta, origem, em }]
// (só acrescentado; nunca apaga). Os arquivos do Drive já lidos ficam em
// clientes/{id}.contasBancariasLidas, para não baixar o mesmo PDF de novo.

const CABECALHO = 2500;

// "Agência: 3001", "Ag. 3001-5", "Cooperativa: 3144-5" (Sicoob, Sicredi, Cresol), "Coop.: 0101"
const AGENCIA = /\b(?:ag[êe]ncia|ag\.?|cooperativa|coop\.?)(?:\s+n[º°o]\.?)?\s*[:.\-–]?\s*(\d{1,5}(?:-[\dxX])?)(?![\d.])/i;
// "Conta: 12.345-6", "Conta corrente: 0012345-6", "C/C 12345-6", "Conta Corrente Nº 1234567-8"
const CONTA = /\b(?:conta(?:\s+corrente)?|c\/c|cc)(?:\s+n[º°o]\.?)?\s*[:.\-–]?\s*(\d[\d. ]{0,18}\d(?:-[\dxX])?|\d(?:-[\dxX]))(?![\d])/i;
// "Agência/Conta: 3001/12345-6", "Agência | Conta ... \n 1234-5 | 12345-6"
const JUNTAS = /ag[êe]ncia\s*[\/|]\s*conta[^\d\n]{0,40}\n?\s*(\d{1,5}(?:-[\dxX])?)\s*[\/|]\s*(\d[\d.]{2,18}(?:-[\dxX])?)/i;

const digitos = s => String(s || '').replace(/\D/g, '');
const limpo = s => String(s || '').replace(/\s+/g, '').replace(/\.$/, '');

/** A chave de uma conta para comparar (banco + só os números da agência e da conta, sem zeros à esquerda). */
function chaveDaConta(c) {
  const n = s => digitos(s).replace(/^0+/, '');
  return [c.banco || '', n(c.agencia), n(c.conta)].join('|');
}

/**
 * A agência e a conta do dono do extrato: [{ agencia, conta }] (vazio quando não dá para ter certeza).
 * A conta precisa de pelo menos 4 dígitos ("Conta Corrente: 060 - SALINAS" é a agência do BNB, não a conta).
 */
function contasDoTexto(texto) {
  const topo = String(texto || '').slice(0, CABECALHO).replace(/[ \t]+/g, ' ');
  const juntas = topo.match(JUNTAS);
  if (juntas && digitos(juntas[2]).length >= 4) return [{ agencia: limpo(juntas[1]), conta: limpo(juntas[2]) }];
  const ag = topo.match(AGENCIA);
  if (!ag) return [];
  // a conta vem depois da agência (ou pouco antes, na mesma linha): procura a partir de um pouco antes dela
  const desde = Math.max(0, (ag.index || 0) - 80);
  const resto = topo.slice(desde);
  let ct = null;
  const re = new RegExp(CONTA.source, 'gi');
  for (let m; (m = re.exec(resto));) {
    if (digitos(m[1]).length >= 4) { ct = m; break; }
  }
  if (!ct) return [];
  return [{ agencia: limpo(ag[1]), conta: limpo(ct[1]) }];
}

/** As contas que o cliente ainda não tem (pela chave). */
function contasNovas(cliente, contas) {
  const tem = new Set((cliente.contasBancarias || []).map(chaveDaConta));
  const vistas = new Set();
  return contas.filter(c => {
    const k = chaveDaConta(c);
    if (tem.has(k) || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** Guarda as contas novas no cadastro do cliente (só acrescenta). Devolve as que entraram. */
async function aprenderContas(db, cliente, contas, origem, FieldValue, simular) {
  const novas = contasNovas(cliente, contas).map(c => ({ banco: c.banco, agencia: c.agencia, conta: c.conta, origem, em: new Date().toISOString() }));
  if (!novas.length || simular) return novas;
  await db.collection('clientes').doc(cliente.id).update({ contasBancarias: FieldValue.arrayUnion(...novas) });
  cliente.contasBancarias = (cliente.contasBancarias || []).concat(novas);
  return novas;
}

module.exports = { contasDoTexto, chaveDaConta, contasNovas, aprenderContas };
