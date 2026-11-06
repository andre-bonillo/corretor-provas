// Modelos de escrita (dígitos do R.A. e nome) e identificação do aluno: tradução de corrigir.py e nomes.py.
"use strict";

const CONF_ESCRITA = 0.80;
const PREPOSICOES = new Set(["da", "de", "do", "das", "dos", "e"]);

const soDigitos = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.replace(/^0+/, "") || (d ? "0" : ""); };
const dobrar = (s) => String(s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const normalizarNome = (s) => String(s || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

let sessaoDigitos = null, sessaoNomes = null, dicionario = null;

async function carregarModelos(base, aviso) {
  ort.env.wasm.wasmPaths = base + "vendor/";
  ort.env.wasm.numThreads = 1;
  const opc = { executionProviders: ["wasm"] };
  aviso && aviso("Carregando o modelo dos dígitos…");
  sessaoDigitos = await ort.InferenceSession.create(base + "modelos/mnist-12.onnx", opc);
  aviso && aviso("Carregando o modelo dos nomes…");
  sessaoNomes = await ort.InferenceSession.create(base + "modelos/latin_PP-OCRv5_rec_mobile.onnx", opc);
  const linhas = (await (await fetch(base + "modelos/ppocrv5_latin_dict.txt")).text()).split(/\r?\n/);
  if (linhas.length && linhas[linhas.length - 1] === "") linhas.pop();
  const chars = ["<blank>", ...linhas, " "];
  const chaves = chars.map(c => c !== " " ? dobrar(c) : " ");
  const classes = [...new Set(chaves.slice(1).filter(k => k.length === 1 && (/[a-z]/.test(k) || k === " ")))].sort();
  const idx = new Map(classes.map((k, i) => [k, i + 1]));
  const n = classes.length + 2;
  const mapa = new Int32Array(chars.length);  // caractere do modelo → classe dobrada
  mapa[0] = 0;
  for (let j = 1; j < chars.length; j++) mapa[j] = idx.has(chaves[j]) ? idx.get(chaves[j]) : n - 1;
  dicionario = { classes, idx, n, mapa };
}

function softmax(z) {
  const mx = Math.max(...z);
  const e = z.map(v => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}

// Dígito escrito num quadrinho: [dígito, confiança, probabilidades] ou ["", 0, null] em branco.
async function lerDigito(reg) {
  const tela = Leitura.prepararDigito(reg);
  if (!tela) return ["", 0, null];
  const ent = new ort.Tensor("float32", tela, [1, 1, 28, 28]);
  const r = await sessaoDigitos.run({ [sessaoDigitos.inputNames[0]]: ent });
  const p = softmax(Array.from(r[sessaoDigitos.outputNames[0]].data));
  let k = 0; for (let i = 1; i < 10; i++) if (p[i] > p[k]) k = i;
  return [String(k), p[k], p];
}

// log-probabilidades por quadro, nas classes dobradas (T × n); null sem escrita.
async function logProbsNome(gray) {
  const ent = Leitura.prepararNome(gray);
  if (!ent) return null;
  const t = new ort.Tensor("float32", ent.dados, [1, 3, 48, ent.largura]);
  const r = await sessaoNomes.run({ [sessaoNomes.inputNames[0]]: t });
  const saida = r[sessaoNomes.outputNames[0]];
  const [, T, C] = saida.dims;
  const p = saida.data;
  const { n, mapa } = dicionario;
  const lp = [];
  for (let i = 0; i < T; i++) {
    let soma = 0;
    for (let j = 0; j < C; j++) soma += p[i * C + j];
    const ehSoftmax = Math.abs(soma - 1) < 1e-2;
    let mx = -Infinity;
    if (!ehSoftmax) for (let j = 0; j < C; j++) mx = Math.max(mx, p[i * C + j]);
    let tot = 0;
    const lin = new Float64Array(n);
    for (let j = 0; j < C; j++) {
      const v = ehSoftmax ? p[i * C + j] : Math.exp(p[i * C + j] - mx);
      lin[mapa[j]] += v; tot += v;
    }
    for (let k = 0; k < n; k++) lin[k] = Math.log(Math.min(1, Math.max(1e-12, lin[k] / (ehSoftmax ? 1 : tot))));
    lp.push(lin);
  }
  return lp;
}

const logaddexp = (a, b) => {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
};

function ctc(lp, rotulo) {
  const L = [...rotulo].filter(c => dicionario.idx.has(c)).map(c => dicionario.idx.get(c));
  if (!L.length) return -Infinity;
  const ext = [0];
  for (const c of L) ext.push(c, 0);
  const S = ext.length, T = lp.length;
  let alfa = new Float64Array(S).fill(-Infinity);
  alfa[0] = lp[0][0];
  alfa[1] = lp[0][ext[1]];
  for (let t = 1; t < T; t++) {
    const novo = new Float64Array(S);
    for (let s = 0; s < S; s++) {
      let v = alfa[s];
      if (s >= 1) v = logaddexp(v, alfa[s - 1]);
      if (s >= 2 && ext[s] !== 0 && ext[s] !== ext[s - 2]) v = logaddexp(v, alfa[s - 2]);
      novo[s] = v + lp[t][ext[s]];
    }
    alfa = novo;
  }
  return logaddexp(alfa[S - 1], alfa[S - 2]);
}

function variantes(nome) {
  const partes = dobrar(nome).split(" ").filter(Boolean);
  const sem = partes.filter(p => !PREPOSICOES.has(p));
  const f = new Set([partes.join(" "), sem.join(" ")]);
  if (sem.length >= 2) { f.add(`${sem[0]} ${sem[sem.length - 1]}`); f.add(sem.slice(0, 2).join(" ")); }
  if (sem.length >= 3) f.add([...sem.slice(0, 2), sem[sem.length - 1]].join(" "));
  return [...f].filter(Boolean);
}

function posterior(pontos) {
  const ks = Object.keys(pontos);
  if (!ks.length) return {};
  const mx = Math.max(...ks.map(k => pontos[k]));
  const ex = {}; let tot = 0;
  for (const k of ks) { ex[k] = Math.exp(pontos[k] - mx); tot += ex[k]; }
  for (const k of ks) ex[k] /= tot;
  return ex;
}

async function probNomes(gray, nomes) {
  if (!nomes.length) return {};
  const lp = await logProbsNome(gray);
  if (!lp) return {};
  const pts = {};
  for (const nome of nomes) pts[nome] = Math.max(...variantes(nome).map(v => ctc(lp, v)));
  return posterior(pts);
}

// R.A.: junta bolinhas e escrita e confere com a lista da turma (corrigir.combinar_ra).
function combinarRA(marcado, escrito, rasConhecidos, pontos) {
  let colunas = [], probs = [];
  marcado.forEach((m, i) => {
    const [e, conf, p] = escrito[i];
    colunas.push([m, e, e !== "" && e !== "?" && conf >= CONF_ESCRITA ? e : ""]);
    probs.push(p);
  });
  while (colunas.length && !colunas[colunas.length - 1][0] && !colunas[colunas.length - 1][1]) { colunas.pop(); probs.pop(); }
  while (colunas.length && !colunas[0][0] && !colunas[0][1]) { colunas.shift(); probs.shift(); }
  let ra = "";
  const avisos = [];
  const temBolinha = colunas.some(x => x[0]);
  colunas.forEach(([m, e, eok], i) => {
    const k = i + 1, mok = /^\d$/.test(m) ? m : "";
    if (mok && eok && mok !== eok) avisos.push(`R.A. col. ${k}: marcado ${mok}, escrito ${eok}`);
    if (mok) ra += mok;
    else if (eok) { ra += eok; if (temBolinha) avisos.push(`R.A. col. ${k} lido da escrita`); }
    else { ra += "?"; avisos.push(`R.A. col. ${k} ilegível`); }
  });
  const conhecidos = new Set(rasConhecidos.map(soDigitos).filter(Boolean));
  if (!conhecidos.size) return [ra, avisos];
  const n = colunas.length, melhores = [];
  for (const r of conhecidos) {
    const cand = r.padStart(n, "0");
    if (cand.length !== n) continue;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const [m] = colunas[i], p = probs[i], d = cand[i];
      const pm = /^\d$/.test(m) ? (m === d ? 0.97 : 0.003) : null;
      const pe = p ? p[+d] : null;
      if (/^\d$/.test(m) && m !== d && (pe === null || pe < 0.5)) { s = null; break; }
      const v = pm !== null && pe !== null ? 0.5 * pm + 0.5 * pe : (pm !== null ? pm : (pe !== null ? pe : 0.1));
      s += Math.log(Math.max(v, 1e-6));
    }
    if (s !== null) melhores.push([s, cand]);
  }
  melhores.sort((a, b) => b[0] - a[0]);
  for (const [s, c] of melhores) pontos[soDigitos(c)] = s;
  if (conhecidos.has(soDigitos(ra)) && !avisos.some(a => a.includes("marcado"))) return [ra, []];
  if (melhores.length) {
    const [s1, c1] = melhores[0];
    const s2 = melhores.length > 1 ? melhores[1][0] : -1e9;
    if (s1 >= n * Math.log(0.02)) {
      if (s1 - s2 >= Math.log(50)) return [c1, c1 === ra ? [] : [`R.A. identificado pela lista da turma (lido ${ra} → ${c1})`]];
      if (s1 - s2 >= Math.log(4)) avisos.push(`R.A. provável ${c1} (confira na imagem)`);
    }
  }
  avisos.push("R.A. fora da lista da turma");
  return [ra, avisos];
}

// Cruza o R.A. com o nome escrito (corrigir.decidir_aluno). Devolve [nome, ra, avisos].
function decidirAluno(ra, avisos, pontosRA, post, ras) {
  const nomeRA = ra && !ra.includes("?") ? (ras[soDigitos(ra)] || "") : "";
  const ks = Object.keys(post);
  if (!ks.length) return [nomeRA, ra, avisos];
  const melhor = ks.reduce((a, b) => post[b] > post[a] ? b : a);
  const pm = post[melhor];
  if (nomeRA) {
    const pRA = ks.filter(k => normalizarNome(k) === normalizarNome(nomeRA)).reduce((a, k) => a + post[k], 0);
    if (pRA >= 0.5) return [nomeRA, ra, []];
    if (pm >= 0.9) return ["", ra, [...avisos, `R.A. ${ra} é de ${nomeRA.trim()}, mas o nome escrito parece ser ${melhor.trim()}`]];
    return [nomeRA, ra, [...avisos, "nome escrito não confirma o R.A."]];
  }
  if (pm < 0.98) return ["", ra, [...avisos, ...(pm >= 0.6 ? [`nome escrito parece ser ${melhor.trim()}`] : [])]];
  const raDoNome = Object.keys(ras).find(r => normalizarNome(ras[r]) === normalizarNome(melhor));
  const lido = soDigitos(ra.replace(/\?/g, ""));
  if (raDoNome === undefined) return [melhor, ra, ["identificado pelo nome (aluno sem R.A. na planilha)"]];
  if (!lido) return [melhor, raDoNome, ["identificado só pelo nome (R.A. em branco ou ilegível)"]];
  const vals = Object.values(pontosRA);
  if (raDoNome in pontosRA && pontosRA[raDoNome] >= Math.max(...vals) - Math.log(1000)) return [melhor, raDoNome, []];
  return ["", ra, [...avisos, `nome escrito parece ser ${melhor.trim()}, mas o R.A. lido (${ra}) não confere`]];
}

function acertos(respostas, gabarito) {
  let t = 0;
  respostas.forEach((r, i) => {
    r = String(r || "").trim().toUpperCase();
    const g = String(gabarito[i] || "").trim().toUpperCase();
    if (g === "*" || (r.length === 1 && g.includes(r))) t++;
  });
  return t;
}

function suspeitaDeCola(resps, pacote, versao) {
  const proprio = pacote.versoes.find(v => v.versao === versao);
  const n = proprio.respostas.length;
  const ac = acertos(resps, proprio.respostas.map(r => r.resposta));
  for (const outra of pacote.versoes) {
    if (outra.versao === versao) continue;
    const ao = acertos(resps, outra.respostas.map(r => r.resposta));
    if (ao >= ac + Math.max(3, Math.round(0.2 * n))) return `respostas batem com o gabarito da prova ${outra.versao} (${ao} × ${ac} da própria)`;
  }
  return null;
}

// Correção completa de uma folha já localizada.
async function corrigirFolha(gray, loc, pacote) {
  const L = Leitura.lerFolha(gray, loc, pacote);
  const versao = pacote.versoes[loc.indice];
  const escrito = [];
  for (const reg of L.caixasRA) escrito.push(await lerDigito(reg));
  const ras = {};
  for (const a of pacote.alunos) ras[soDigitos(a.ra)] = a.nome;
  const pontosRA = {};
  let [ra, conferir] = combinarRA(L.marcado, escrito, Object.keys(ras), pontosRA);
  const post = await probNomes(L.nomeEscrito, pacote.nomes);
  let nome;
  [nome, ra, conferir] = decidirAluno(ra, conferir, pontosRA, post, ras);
  if (!nome && (Object.keys(ras).length || pacote.nomes.length)) conferir.push("aluno não identificado");
  for (const r of L.respostas) {
    if (r.sit === "múltipla") conferir.push(`Q${r.n} rasura (${r.resp})`);
    else if (r.sit === "dúvida") conferir.push(`Q${r.n} marca fraca`);
  }
  const resps = L.respostas.map(r => r.resp);
  const ac = acertos(resps, versao.respostas.map(r => r.resposta));
  const cola = suspeitaDeCola(resps, pacote, versao.versao);
  if (cola) conferir.push(cola);
  const notasDiss = L.notas.map(nt => nt.valor);
  for (const nt of L.notas) if (nt.sit) conferir.push(`D${nt.n} ${nt.sit}`);
  const completa = notasDiss.length > 0 && notasDiss.every(v => v !== null);
  return {
    leitura: L, versao: versao.versao, ra, nome, conferir, acertos: ac, total: versao.respostas.length,
    notasDiss, dissCompleta: completa, escrito, post,
    nota: ac * pacote.pontos_objetiva + notasDiss.reduce((a, v) => a + (v || 0), 0),
  };
}

window.Identificacao = { carregarModelos, corrigirFolha, acertos, soDigitos, normalizarNome };
