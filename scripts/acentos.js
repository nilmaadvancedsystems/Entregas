// Acentos embaralhados ("COMÃ‰RCIO", "SAÃDA", "mÃªs"): o e-mail foi escrito
// em UTF-8 e lido como Latin-1/Windows-1252 — ou pelo sistema de quem mandou,
// ou porque o e-mail diz um charset e manda outro. Cada letra acentuada vira
// duas ("Ã" + mais uma).
//
// consertarAcentos desfaz isso: pega cada pedaço que tem cara de UTF-8 lido
// como Windows-1252, volta pros bytes e lê de novo como UTF-8. Se os bytes
// não formam UTF-8 válido, o pedaço fica como está (texto certo não muda).

// Windows-1252 põe letras em 0x80–0x9F; o resto até 0xFF é igual ao Latin-1.
const CP1252 = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
  0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
  0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};
const CONTINUACAO = '\\u0080-\\u00BF' + Object.keys(CP1252).map(c => '\\u' + Number(c).toString(16).padStart(4, '0')).join('');
// início de letra UTF-8 seguido de quantos bytes de continuação ela pede:
// 0xC2–0xDF (1), 0xE0–0xEF (2), 0xF0–0xF4 (3)
const C = '[' + CONTINUACAO + ']';
const SUSPEITO = new RegExp('[\\u00C2-\\u00DF]' + C + '|[\\u00E0-\\u00EF]' + C + '{2}|[\\u00F0-\\u00F4]' + C + '{3}', 'g');

const utf8Estrito = new TextDecoder('utf-8', { fatal: true });

function paraBytes(pedaco) {
  const bytes = [];
  for (const ch of pedaco) {
    const c = ch.codePointAt(0);
    if (c <= 0xFF) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return null;
  }
  return Buffer.from(bytes);
}

function consertarAcentos(texto) {
  const t = String(texto == null ? '' : texto);
  if (!/[Â-ô]/.test(t)) return t;
  return t.replace(SUSPEITO, pedaco => {
    const bytes = paraBytes(pedaco);
    if (!bytes) return pedaco;
    try {
      const lido = utf8Estrito.decode(bytes);
      // de 2 bytes, só letra latina (é, ç, ã...): "É“" num texto certo não vira "ɓ"
      if (pedaco.length === 2 && lido.codePointAt(0) > 0x17F) return pedaco;
      return lido.length < pedaco.length ? lido : pedaco;
    } catch (e) { return pedaco; }
  });
}

// Bytes que formam UTF-8 válido e têm alguma letra fora do ASCII: é UTF-8,
// diga o e-mail o que disser (Latin-1 com acento quase nunca passa nesse teste).
function pareceUtf8(bytes) {
  if (!bytes.some(b => b >= 0x80)) return false;
  try { utf8Estrito.decode(bytes); return true; } catch (e) { return false; }
}

module.exports = { consertarAcentos, pareceUtf8 };
