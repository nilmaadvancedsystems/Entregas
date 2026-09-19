// Testa a leitura do código de pagamento com códigos montados por uma conta
// independente (não reaproveita as funções do app pra gerar os verificadores).
const fs = require('fs');
const s = fs.readFileSync((process.argv[2] || require('path').join(__dirname, '..', 'entregas.html')), 'utf8');
const ini = s.indexOf('  function dvMod10_(numeros) {');
const fim = s.indexOf('  // o código lido do PDF que está anexado agora');
const extrair = new Function(s.slice(ini, fim) + '; return extrairCodigoPagamento_;')();

function mod10(n) { let soma = 0; [...n].reverse().forEach((d, i) => { let p = d * (i % 2 === 0 ? 2 : 1); soma += p > 9 ? p - 9 : p; }); return (10 - soma % 10) % 10; }
function mod11(n) { let soma = 0, peso = 2; [...n].reverse().forEach(d => { soma += d * peso; peso = peso === 9 ? 2 : peso + 1; }); const r = soma % 11; return r < 2 ? 0 : r === 10 ? 1 : 11 - r; }
function crc(t) { let c = 0xFFFF; for (const ch of t) { c ^= ch.charCodeAt(0) << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, '0'); }

let falhas = 0, total = 0;
function igual(nome, obtido, esperado) { total++; if (JSON.stringify(obtido) !== JSON.stringify(esperado)) { falhas++; console.log('FALHOU', nome, '\n  obtido:  ', JSON.stringify(obtido), '\n  esperado:', JSON.stringify(esperado)); } }

// guia de arrecadação, módulo 11 (3º dígito 8) e módulo 10 (3º dígito 6)
const blocos11 = ['85800000012', '34560328261', '23071234567', '89012345678'];
const arr11 = blocos11.map(b => b + mod11(b));
igual('DAS com hífen no verificador', extrair('Pague até 20/09/2026 ' + blocos11.map(b => b + '-' + mod11(b)).join(' ') + ' Valor R$ 1.234,56'), { tipo: 'boleto', codigo: arr11.join(' ') });
const blocos10 = ['83660000001', '12340138000', '81288462711', '08013618155'];
igual('arrecadação módulo 10, blocos colados', extrair('linha ' + blocos10.map(b => b + mod10(b)).join(' ') + ' fim'), { tipo: 'boleto', codigo: blocos10.map(b => b + mod10(b)).join(' ') });

// boleto de banco
const c1 = '001905009', c2 = '5401448160', c3 = '6906809350';
const linha = `${c1.slice(0,5)}.${c1.slice(5)}${mod10(c1)} ${c2.slice(0,5)}.${c2.slice(5)}${mod10(c2)} ${c3.slice(0,5)}.${c3.slice(5)}${mod10(c3)} 3 37370000000100`;
igual('boleto de banco', extrair('Honorários ' + linha + ' obrigado'), { tipo: 'boleto', codigo: linha });
igual('boleto com verificador errado é recusado', extrair('00190.50095 40144.816069 06809.350314 3 37370000000100'.replace('50095', '5009' + ((mod10(c1) + 1) % 10))), null);

// PIX
const corpo = '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913NILMA CONTAB6010TAIOBEIRAS62070503***6304';
const pix = corpo + crc(corpo);
igual('PIX inteiro', extrair('Pague com PIX: ' + pix + ' ou boleto'), { tipo: 'pix', codigo: pix });
igual('PIX com CRC errado é recusado', extrair('PIX ' + corpo + 'FFFF'.replace('FFFF', crc(corpo) === 'FFFF' ? '0000' : 'FFFF')), null);
const semEspaco = '00020126360014BR.GOV.BCB.PIX0114+55389999999995204000053039865802BR5905NILMA6009SAO PAULO62070503***6304';
const limpo = semEspaco.replace(/\s/g, '');
igual('PIX quebrado em pedaços pelo PDF volta inteiro', extrair((limpo + crc(limpo)).replace(/(.{30})/g, '$1 ')), { tipo: 'pix', codigo: limpo + crc(limpo) });

igual('texto sem código', extrair('CNPJ 11.222.333/0001-81 competência 08/2026 valor 1.234,56'), null);
igual('CNPJ e chave de NF-e não viram código', extrair('31260811222333000181550010000001551192419083 11222333000181'), null);
console.log(falhas ? falhas + ' de ' + total + ' FALHARAM' : total + ' testes, todos passaram');
process.exit(falhas ? 1 : 0);
