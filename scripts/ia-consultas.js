// As consultas que o atendente de IA pode fazer no banco — e só elas.
//
// Regra que manda neste arquivo: TUDO AQUI É SÓ LEITURA. Nenhuma função
// grava, apaga ou altera coisa nenhuma. O atendente responde pergunta; quem
// mexe no banco é a tela, com a pessoa clicando e as regras do Firestore
// valendo. Se um dia alguém quiser dar poder de escrita pro chat, que seja em
// outro arquivo e por decisão consciente — não crescendo este aqui por
// descuido.
//
// A SEGUNDA REGRA: CPF, CNPJ E TELEFONE NÃO SOBEM PRA API.
// O escritório tirou a base de clientes de dentro do entregas.html justamente
// porque ela vazava em texto puro. Mandar o mesmo dado pro Google agora seria
// desfazer aquilo por outro caminho. Então `limparCliente` roda em cima de
// todo cliente antes de qualquer coisa sair daqui, e o teste-ia.js confere
// que ela não deixa passar. O modelo trabalha com nome e situação, que é o
// que a pergunta do escritório de fato precisa.
//
// Isso vale em dobro na faixa gratuita do Gemini, onde o Google pode usar o
// conteúdo pra melhorar os produtos dele.
//
// As funções puras (as que recebem os dados prontos e devolvem o resultado)
// ficam separadas das que falam com o Firestore, pra dar pra testar sem rede.

const TIPOS_DOC = ['extrato', 'comprovante', 'aplicacao'];
const NOMES_DOC = {
  extrato: 'Extrato Bancário',
  comprovante: 'Comprovante',
  aplicacao: 'Aplicação',
};

// Teto por consulta. Sem isso uma pergunta larga ("me fala de todo mundo")
// sobe os 315 clientes pra API em toda ida do laço de ferramentas — o que na
// faixa gratuita queima a cota do dia e na paga vira conta.
const LIMITE_PADRAO = 40;
const LIMITE_MAXIMO = 120;

// ---------- utilidades puras ----------

function competenciaAtual(agora) {
  const d = agora ? new Date(agora) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function competenciaValida(c) {
  return typeof c === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
}

// Busca de nome que não se importa com acento nem com maiúscula: quem digita
// "jose" tem que achar "JOSÉ". É como a busca da tela já se comporta.
function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// A peneira de dado pessoal. Lista o que PODE sair, em vez de listar o que
// não pode — assim um campo novo no cadastro (digamos, `rg`) nasce barrado
// por padrão, em vez de vazar até alguém lembrar de acrescentá-lo na lista
// de proibidos.
function limparCliente(cliente) {
  if (!cliente) return null;
  const emails = [cliente.email]
    .concat(Array.isArray(cliente.emails) ? cliente.emails : [])
    .filter(Boolean);
  return {
    id: cliente.id,
    nome: cliente.nome || '(sem nome)',
    ativo: cliente.ativo !== false,
    // quantidade, não os endereços: dá pra responder "fulano não tem e-mail
    // cadastrado" sem passar o e-mail de ninguém adiante
    temEmail: emails.length > 0,
    documentosNaoAplicaveis: Array.isArray(cliente.documentosNaoAplicaveis)
      ? cliente.documentosNaoAplicaveis
      : [],
  };
}

function limitar(n) {
  const v = parseInt(n, 10);
  if (!isFinite(v) || v <= 0) return LIMITE_PADRAO;
  return Math.min(v, LIMITE_MAXIMO);
}

// ---------- pendências (mesma regra da tela de Cobrança) ----------

// A regra vive em três lugares: aqui, no list-pending.js e na Consulta rápida
// do entregas.html. As três têm que continuar iguais: documento marcado "não
// se aplica" no cliente não é falta, e mês marcado "sem movimento" não tem
// pendência. Se a regra da tela mudar, muda nos três — senão o atendente
// responde uma coisa e a tela mostra outra, que é pior do que não ter chat.
function pendenciasDe(clientes, docsPorCliente, opcoes) {
  const opts = opcoes || {};
  const competencia = opts.competencia;
  const incluirSemEmail = opts.incluirSemEmail !== false;
  const pendentes = [];
  let semEmail = 0;

  clientes.forEach(function (bruto) {
    const cliente = limparCliente(bruto);
    if (!cliente.ativo) return;
    const status = docsPorCliente.get(cliente.id) || {};
    if (status.semMovimento) return;

    const faltando = TIPOS_DOC.filter(function (t) {
      return cliente.documentosNaoAplicaveis.indexOf(t) === -1 && !status[t];
    });
    if (!faltando.length) return;

    if (!cliente.temEmail) {
      semEmail++;
      if (!incluirSemEmail) return;
    }

    pendentes.push({
      clienteId: cliente.id,
      cliente: cliente.nome,
      competencia: competencia,
      faltando: faltando.map(function (t) { return NOMES_DOC[t]; }),
      temEmail: cliente.temEmail,
      cobrancasEnviadasNoMes: Array.isArray(status.cobrancas) ? status.cobrancas.length : 0,
    });
  });

  pendentes.sort(function (a, b) { return a.cliente.localeCompare(b.cliente, 'pt-BR'); });
  return { pendentes: pendentes, semEmail: semEmail };
}

function buscarClientesEm(clientes, termo) {
  const alvo = normalizar(termo);
  if (!alvo) return [];
  return clientes
    .map(limparCliente)
    .filter(function (c) { return normalizar(c.nome).indexOf(alvo) !== -1; })
    .sort(function (a, b) {
      // quem começa com o que foi digitado vem antes de quem só contém
      const ia = normalizar(a.nome).indexOf(alvo);
      const ib = normalizar(b.nome).indexOf(alvo);
      if (ia !== ib) return ia - ib;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
}

// Uma entrega registrada, enxuta: o atendente precisa saber o que foi
// entregue, quando e se tem assinatura — não precisa da assinatura em si, que
// é uma imagem em base64 e nem caberia num prompt.
function resumirEntrega(entrega) {
  const itens = Array.isArray(entrega.itens) ? entrega.itens : [];
  return {
    id: entrega.id,
    cliente: entrega.clienteNome || '(sem nome)',
    competencia: entrega.competencia || null,
    status: entrega.status || null,
    documentos: itens.map(function (i) { return i && i.tipo ? i.tipo : '?'; }),
    // O valor guia a guia. Só o total somado não responde a pergunta mais
    // comum do balcão: "quanto deu o DAS de fulano?".
    valores: itens
      .filter(function (i) { return i && typeof i.valor === 'number'; })
      .map(function (i) { return { documento: i.tipo || '?', valor: i.valor }; }),
    valorTotal: itens.reduce(function (soma, i) {
      const v = i && typeof i.valor === 'number' ? i.valor : 0;
      return soma + v;
    }, 0),
    assinada: entrega.temAssinatura === true,
    semComprovante: entrega.semComprovante === true,
    entreguePor: entrega.entregadoPorNome || entrega.entregadoPor || null,
    criadoEm: entrega.criadoEm || null,
  };
}

function resumirMes(entregas) {
  const resumo = {
    total: entregas.length,
    confirmadas: 0,
    pendentes: 0,
    assinadas: 0,
    valorTotal: 0,
    porDocumento: {},
  };
  entregas.forEach(function (bruta) {
    const e = resumirEntrega(bruta);
    if (e.status === 'confirmada') resumo.confirmadas++;
    if (e.status === 'pendente') resumo.pendentes++;
    if (e.assinada) resumo.assinadas++;
    resumo.valorTotal += e.valorTotal;
    e.documentos.forEach(function (d) {
      resumo.porDocumento[d] = (resumo.porDocumento[d] || 0) + 1;
    });
  });
  return resumo;
}

// ---------- as ferramentas que o modelo enxerga ----------
//
// `parametersJsonSchema` é o campo do SDK novo (@google/genai); o `parameters`
// antigo, com os tipos em MAIÚSCULA, é mutuamente exclusivo com ele.
const FERRAMENTAS = [
  {
    name: 'listar_pendencias',
    description:
      'Lista os clientes ativos que ainda não entregaram algum documento do mês ' +
      '(Extrato Bancário, Comprovante ou Aplicação) na Cobrança de Documentos. ' +
      'Segue as mesmas regras da tela: documento marcado como "não se aplica" no ' +
      'cadastro não conta como falta, e mês marcado "sem movimento" não tem pendência.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        competencia: {
          type: 'string',
          description: 'Mês no formato AAAA-MM. Se não informar, usa o mês atual.',
        },
        somente_com_email: {
          type: 'boolean',
          description:
            'Se verdadeiro, deixa de fora quem não tem e-mail cadastrado (esses não dá pra cobrar por e-mail). Padrão: falso.',
        },
      },
      required: [],
    },
  },
  {
    name: 'buscar_cliente',
    description:
      'Procura clientes pelo nome, ignorando acento e maiúscula. Use antes de ' +
      'perguntar sobre um cliente específico, pra descobrir o id dele.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        termo: { type: 'string', description: 'Parte do nome do cliente.' },
      },
      required: ['termo'],
    },
  },
  {
    name: 'entregas_do_cliente',
    description:
      'Lista as entregas de documentos já registradas para um cliente, da mais ' +
      'recente pra mais antiga. Use o id que veio de buscar_cliente.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string', description: 'O id do cliente.' },
        competencia: {
          type: 'string',
          description: 'Opcional. Limita a um mês, no formato AAAA-MM.',
        },
        limite: {
          type: 'integer',
          description: 'Quantas entregas no máximo. Padrão 40, teto 120.',
        },
      },
      required: ['cliente_id'],
    },
  },
  {
    name: 'resumo_do_mes',
    description:
      'Números fechados de um mês: quantas entregas, quantas confirmadas, ' +
      'quantas assinadas, o valor total e a contagem por tipo de documento.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        competencia: {
          type: 'string',
          description: 'Mês no formato AAAA-MM. Se não informar, usa o mês atual.',
        },
      },
      required: [],
    },
  },
];

// ---------- execução (aqui sim fala com o Firestore) ----------

async function executarFerramenta(db, nome, args, agora) {
  const a = args || {};
  switch (nome) {
    case 'listar_pendencias': {
      const competencia = competenciaValida(a.competencia) ? a.competencia : competenciaAtual(agora);
      const [clientesSnap, docsSnap] = await Promise.all([
        db.collection('clientes').where('ativo', '==', true).get(),
        db.collection('documentosMensal').where('competencia', '==', competencia).get(),
      ]);
      const clientes = clientesSnap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      const porCliente = new Map();
      docsSnap.forEach(function (d) { porCliente.set(d.data().clienteId, d.data()); });

      const r = pendenciasDe(clientes, porCliente, {
        competencia: competencia,
        incluirSemEmail: a.somente_com_email !== true,
      });
      // O corte é explícito na resposta pra o modelo não afirmar "são 12"
      // quando na verdade são 80 e ele só viu os 12 primeiros.
      const limite = limitar(a.limite);
      return {
        competencia: competencia,
        totalComPendencia: r.pendentes.length,
        semEmailCadastrado: r.semEmail,
        mostrando: Math.min(limite, r.pendentes.length),
        pendentes: r.pendentes.slice(0, limite),
      };
    }

    case 'buscar_cliente': {
      if (!a.termo) return { erro: 'Informe parte do nome em "termo".' };
      const snap = await db.collection('clientes').get();
      const clientes = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      const achados = buscarClientesEm(clientes, a.termo);
      const limite = limitar(a.limite);
      return {
        termo: a.termo,
        total: achados.length,
        mostrando: Math.min(limite, achados.length),
        clientes: achados.slice(0, limite),
      };
    }

    case 'entregas_do_cliente': {
      if (!a.cliente_id) return { erro: 'Informe o "cliente_id" (use buscar_cliente antes).' };
      let consulta = db.collection('entregas').where('clienteId', '==', a.cliente_id);
      if (competenciaValida(a.competencia)) {
        consulta = consulta.where('competencia', '==', a.competencia);
      }
      const snap = await consulta.limit(LIMITE_MAXIMO * 2).get();
      const entregas = snap.docs
        .map(function (d) { return resumirEntrega(Object.assign({ id: d.id }, d.data())); })
        .sort(function (x, y) { return String(y.criadoEm).localeCompare(String(x.criadoEm)); });
      const limite = limitar(a.limite);
      return {
        clienteId: a.cliente_id,
        total: entregas.length,
        mostrando: Math.min(limite, entregas.length),
        entregas: entregas.slice(0, limite),
      };
    }

    case 'resumo_do_mes': {
      const competencia = competenciaValida(a.competencia) ? a.competencia : competenciaAtual(agora);
      const snap = await db.collection('entregas').where('competencia', '==', competencia).limit(3000).get();
      const entregas = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      return Object.assign({ competencia: competencia }, resumirMes(entregas));
    }

    default:
      return { erro: 'Ferramenta desconhecida: ' + nome };
  }
}

module.exports = {
  FERRAMENTAS,
  executarFerramenta,
  // expostas para o teste-ia.js
  competenciaAtual,
  competenciaValida,
  normalizar,
  limparCliente,
  limitar,
  pendenciasDe,
  buscarClientesEm,
  resumirEntrega,
  resumirMes,
  TIPOS_DOC,
  NOMES_DOC,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
};
