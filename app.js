// Tela da correção pelo celular.
"use strict";

const BASE = new URL(".", location.href).href;
const $ = (s) => document.querySelector(s);
const numBR = (x) => (Math.round(x * 100) / 100).toString().replace(".", ",");
let pacote = null, atual = null, modelosProntos = null;

// ---------------------------------------------------------------------------
// Armazenamento no aparelho (IndexedDB)
// ---------------------------------------------------------------------------

const banco = new Promise((ok, falha) => {
  const r = indexedDB.open("corretor-provas", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("pacotes", { keyPath: "hash" });
    r.result.createObjectStore("folhas", { keyPath: "id", autoIncrement: true }).createIndex("hash", "hash");
    r.result.createObjectStore("config");
  };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => falha(r.error);
});
async function tx(loja, modo, f) {
  const db = await banco;
  return new Promise((ok, falha) => {
    const t = db.transaction(loja, modo);
    const res = f(t.objectStore(loja));
    t.oncomplete = () => ok(res && "result" in res ? res.result : res);
    t.onerror = () => falha(t.error);
  });
}
const guardar = (loja, v, k) => tx(loja, "readwrite", s => s.put(v, k));
const ler = (loja, k) => tx(loja, "readonly", s => s.get(k));
const apagar = (loja, k) => tx(loja, "readwrite", s => s.delete(k));
const folhasDa = (hash) => tx("folhas", "readonly", s => s.index("hash").getAll(hash));

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

async function cinzaDoArquivo(arq, ladoMax = 3200) {
  const bmp = await createImageBitmap(arq);
  const e = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * e), h = Math.round(bmp.height * e);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const d = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < d.length; i += 4, j++) d[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  return { w, h, d };
}

function canvasDe(g) {
  const cv = document.createElement("canvas");
  cv.width = g.w; cv.height = g.h;
  const ctx = cv.getContext("2d");
  const im = ctx.createImageData(g.w, g.h);
  for (let j = 0, i = 0; j < g.d.length; j++, i += 4) { const v = g.d[j]; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  ctx.putImageData(im, 0, 0);
  return cv;
}

function anotar(res) {
  const L = res.leitura, P = Leitura.PX_MM, K = pacote.constantes;
  const cv = canvasDe(L.reta), ctx = cv.getContext("2d");
  const versao = pacote.versoes.find(v => v.versao === res.versao);
  const gab = {}; versao.respostas.forEach(r => gab[r.n] = r.resposta);
  const R = K.RAIO * P + 3;
  const circ = (x, y, r, cor, lw) => { ctx.beginPath(); ctx.arc(x * P, y * P, r, 0, 2 * Math.PI); ctx.strokeStyle = cor; ctx.lineWidth = lw; ctx.stroke(); };
  const VERDE = "#28a028", VERMELHO = "#dc1e1e", LARANJA = "#ff8c00", AZUL = "#006ec8";
  for (const { coluna, vals } of L.raMarcas) coluna.forEach(([x, y], i) => {
    if (vals[i] >= Leitura.LIMIAR_DUVIDA) circ(x, y, K.RAIO_RA * P + 3, vals[i] >= Leitura.LIMIAR_MARCA ? AZUL : LARANJA, 3);
  });
  for (const r of L.respostas) {
    const certa = gab[r.n];
    r.q.opcoes.forEach((op, i) => {
      const [x, y] = r.q.centros[i], v = r.vals[i];
      if (v >= Leitura.LIMIAR_MARCA) circ(x, y, R, op === certa || (certa || "").includes(op) && r.sit !== "múltipla" ? VERDE : VERMELHO, 4);
      else if (v >= Leitura.LIMIAR_DUVIDA) circ(x, y, R, LARANJA, 4);
      if (certa && certa !== "*" && certa.includes(op)) circ(x, y, R + 5, VERDE, 2);
    });
  }
  for (const nt of L.notas) for (const { centros, vals } of nt.marcas) centros.forEach(([x, y], i) => {
    if (vals[i] >= Leitura.LIMIAR_DUVIDA) circ(x, y, R, vals[i] >= Leitura.LIMIAR_MARCA ? (nt.sit === "duas notas marcadas" ? VERMELHO : VERDE) : LARANJA, 4);
  });
  return cv;
}

function miniatura(cv, largura = 700) {
  const e = Math.min(1, largura / cv.width);
  const m = document.createElement("canvas");
  m.width = Math.round(cv.width * e); m.height = Math.round(cv.height * e);
  m.getContext("2d").drawImage(cv, 0, 0, m.width, m.height);
  return m.toDataURL("image/jpeg", 0.7);
}

// ---------------------------------------------------------------------------
// Telas, avisos e perguntas
// ---------------------------------------------------------------------------

const TELAS = ["provas", "prova", "alunos", "questoes", "conferencia", "folha"];
const todos = (loja) => tx(loja, "readonly", s => s.getAll());
const nomeProva = (p) => p.nome.replace(" - Gabaritos", "");
const vivoAberto = () => document.body.classList.contains("vivo-aberto");
const quandoBR = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "";
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mesmoNome = (a, b) => !!a && !!b && Identificacao.normalizarNome(a) === Identificacao.normalizarNome(b);

function irPara(tela) {
  for (const t of TELAS) $("#tela-" + t).hidden = t !== tela;
  window.scrollTo(0, 0);
  if (tela === "provas") listarProvas();
}

// Aviso flutuante. tipo: "info" (some sozinho), "ok" (verde, some sozinho), "lendo" (com roda), "erro" (fica até fechar).
let avisoTempo = null;
function status(txt, erro = false, tipo = "info") {
  if (erro) tipo = "erro";
  const a = $("#aviso");
  clearTimeout(avisoTempo);
  if (!txt || (vivoAberto() && tipo !== "erro")) { a.hidden = true; return; }
  a.className = tipo === "erro" || tipo === "ok" ? tipo : "";
  a.querySelector(".txt").textContent = txt;
  a.querySelector(".girando").hidden = tipo !== "lendo";
  a.hidden = false;
  if (tipo === "ok" || tipo === "info") avisoTempo = setTimeout(() => { a.hidden = true; }, tipo === "ok" ? 3500 : 5000);
}

// Pergunta feita na própria página. botoes: [{ rotulo, valor, classe }]; tocar fora = null.
function perguntar(titulo, texto, botoes) {
  return new Promise((ok) => {
    const d = $("#dialogo");
    d.querySelector("h3").textContent = titulo;
    d.querySelector("p").textContent = texto;
    const caixa = d.querySelector(".botoes"); caixa.innerHTML = "";
    const fim = (v) => { d.hidden = true; d.onclick = null; ok(v); };
    for (const b of [...botoes, { rotulo: "Cancelar", valor: null, classe: "sec" }]) {
      const el = document.createElement("button");
      el.className = "botao " + (b.classe || ""); el.textContent = b.rotulo;
      el.onclick = (e) => { e.stopPropagation(); fim(b.valor); };
      caixa.appendChild(el);
    }
    d.onclick = (e) => { if (e.target === d) fim(null); };
    d.hidden = false;
  });
}

function estadoLeitura(txt, erro = false) {
  const e = $("#estado-leitura");
  e.textContent = txt || ""; e.className = erro ? "erro" : ""; e.hidden = !txt;
}

// ---------------------------------------------------------------------------
// Provas guardadas no aparelho
// ---------------------------------------------------------------------------

function totalAlunos(p) { return (p.nomes && p.nomes.length) || (p.alunos && p.alunos.length) || 0; }

// Quantos alunos diferentes já têm folha (folhas sem nome contam uma a uma).
function corrigidas(fs) {
  const nomes = new Set(); let semNome = 0;
  for (const f of fs) { if (f.nome) nomes.add(Identificacao.normalizarNome(f.nome)); else semNome++; }
  return nomes.size + semNome;
}

async function naoExportadas(hash, fs) {
  const exp = await ler("config", "exportado:" + hash).catch(() => null);
  return fs.filter(f => !exp || f.quando > exp.quando).length;
}

// Nome da prova desmontado: "Unifeg - DI - Prova 1 - Gabaritos (2026.2)" → instituição, sigla, rótulo, semestre.
function infoProva(p) {
  let n = p.nome.replace(" - Gabaritos", "");
  const m = n.match(/\s*\(([^)]+)\)\s*$/), semestre = m ? m[1] : "";
  if (m) n = n.slice(0, m.index);
  const partes = n.split(" - ");
  const inst = p.instituicao || (partes.length > 2 ? partes[0] : "");
  const sigla = partes.length > 2 ? partes[1] : "";
  const rotulo = partes.length > 2 ? partes.slice(2).join(" - ") : n;
  return { inst, sigla, rotulo, semestre, disciplina: p.disciplina || sigla || "Sem disciplina", turma: p.turma || "" };
}
const chaveDisc = (p) => { const i = infoProva(p); return i.inst + "|" + i.disciplina; };

// Data da prova: a marcada no aparelho vale mais que a do arquivo ("22/09/2026").
let datasMarcadas = {};
function dataDe(p) {
  const iso = datasMarcadas[p.hash];
  if (iso) return new Date(iso + "T12:00");
  const m = String(p.data || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : null;
}
const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const diaBR = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const diaLongo = (d) => d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

// Capa gerada (cor a partir da disciplina, sigla grande) — aparece em alguns temas.
function corDa(texto) { let h = 0; for (const c of texto) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function htmlCapa(p, classe = "capa") {
  const i = infoProva(p), h = corDa(i.disciplina);
  return `<div class="${classe}" style="--h:${h}"><span>${esc(i.sigla || i.disciplina.slice(0, 3))}</span><small>${esc(i.rotulo)}</small></div>`;
}

let modoProvas = "lista", filtro = { inst: "", disc: "" }, mesCal = null, diaSel = "";
let dadosLista = null;   // { ps, porHash, pendentes }

async function carregarLista() {
  const [ps, fs] = await Promise.all([todos("pacotes"), todos("folhas")]);
  const porHash = {};
  for (const f of fs) (porHash[f.hash] = porHash[f.hash] || []).push(f);
  const uso = {}, pendentes = {};
  datasMarcadas = {};
  for (const p of ps) {
    uso[p.hash] = (await ler("config", "uso:" + p.hash).catch(() => null)) || "";
    pendentes[p.hash] = await naoExportadas(p.hash, porHash[p.hash] || []);
    const d = await ler("config", "data:" + p.hash).catch(() => null);
    if (d) datasMarcadas[p.hash] = d;
  }
  ps.sort((a, b) => (uso[b.hash] || "").localeCompare(uso[a.hash] || "") || nomeProva(a).localeCompare(nomeProva(b), "pt"));
  return { ps, porHash, pendentes };
}

let vezLista = 0;
async function listarProvas() {
  const vez = ++vezLista;
  const dados = await carregarLista();
  if (vez !== vezLista) return;   // outra chamada mais nova já vai desenhar
  dadosLista = dados;
  desenharProvas();
}

function provasFiltradas() {
  return dadosLista.ps.filter(p => (!filtro.inst || infoProva(p).inst === filtro.inst) && (!filtro.disc || chaveDisc(p) === filtro.disc));
}

function desenharFiltros() {
  const ps = dadosLista.ps;
  const insts = [...new Set(ps.map(p => infoProva(p).inst).filter(Boolean))].sort();
  if (filtro.inst && !insts.includes(filtro.inst)) filtro.inst = "";
  const caixa = $("#filtro-inst"); caixa.innerHTML = "";
  for (const [v, rot] of [["", "Todas"], ...insts.map(i => [i, i])]) {
    const b = document.createElement("button");
    b.className = "ficha" + (filtro.inst === v ? " ativa" : ""); b.textContent = rot;
    b.onclick = () => { filtro.inst = v; filtro.disc = ""; salvarFiltro(); desenharProvas(); };
    caixa.appendChild(b);
  }
  const discs = {};
  for (const p of ps) if (!filtro.inst || infoProva(p).inst === filtro.inst) discs[chaveDisc(p)] = infoProva(p);
  if (filtro.disc && !discs[filtro.disc]) filtro.disc = "";
  const sel = $("#filtro-disc");
  sel.innerHTML = `<option value="">Todas as disciplinas</option>` + Object.entries(discs)
    .sort((a, b) => a[1].disciplina.localeCompare(b[1].disciplina, "pt"))
    .map(([k, i]) => `<option value="${esc(k)}">${esc(i.disciplina)}${!filtro.inst && insts.length > 1 ? ` · ${esc(i.inst)}` : ""}</option>`).join("");
  sel.value = filtro.disc;
  sel.onchange = () => { filtro.disc = sel.value; salvarFiltro(); desenharProvas(); };
  $("#filtros").hidden = ps.length < 2;
  $("#modo-provas").hidden = !ps.length;
}
const salvarFiltro = () => guardar("config", { ...filtro, modo: modoProvas }, "filtro");

function desenharProvas() {
  if (!dadosLista) return;
  desenharFiltros();
  for (const b of document.querySelectorAll("#modo-provas button")) b.classList.toggle("ativo", b.dataset.modo === modoProvas);
  for (const m of ["lista", "disciplinas", "calendario"]) $("#vista-" + m).hidden = m !== modoProvas;
  $("#provas-vazio").hidden = dadosLista.ps.length > 0;
  const ps = provasFiltradas();
  if (modoProvas === "lista") desenharLista(ps);
  else if (modoProvas === "disciplinas") desenharDisciplinas(ps);
  else desenharCalendario(ps);
}

function liProva(p) {
  const { porHash, pendentes } = dadosLista;
  const suas = porHash[p.hash] || [], total = totalAlunos(p), feitas = corrigidas(suas), pend = pendentes[p.hash];
  const i = infoProva(p), d = dataDe(p);
  const li = document.createElement("li");
  li.innerHTML = `<button class="abrir-prova">${htmlCapa(p)}
    <div class="corpo-prova">
      <div class="nome">${esc(nomeProva(p))}</div>
      <div class="disc">${esc([i.disciplina, i.turma, d ? diaBR(d) : ""].filter(Boolean).join(" · "))}</div>
      <div class="barra-prog"><i style="width:${total ? Math.min(100, 100 * feitas / total) : 0}%"></i></div>
      <div class="numeros"><span><b>${feitas}</b> de ${total} corrigidas</span>
        ${pend ? `<span class="etiqueta alerta">${pend} sem exportar</span>` : suas.length ? `<span class="etiqueta ok">exportada</span>` : ""}</div>
    </div></button>`;
  li.querySelector("button").onclick = () => abrirPacote(p);
  return li;
}

function desenharLista(ps) {
  const ul = $("#provas"); ul.innerHTML = "";
  for (const p of ps) ul.appendChild(liProva(p));
  if (!ps.length && dadosLista.ps.length) ul.innerHTML = `<li class="sem-capa"><div class="vazio">Nenhuma prova com este filtro.</div></li>`;
}

function gruposDisciplina(ps) {
  const g = {};
  for (const p of ps) { const k = chaveDisc(p); (g[k] = g[k] || { info: infoProva(p), provas: [] }).provas.push(p); }
  for (const x of Object.values(g)) x.provas.sort((a, b) => (dataDe(a) || 0) - (dataDe(b) || 0) || infoProva(a).rotulo.localeCompare(infoProva(b).rotulo, "pt"));
  return Object.entries(g).sort((a, b) => a[1].info.disciplina.localeCompare(b[1].info.disciplina, "pt"));
}

function desenharDisciplinas(ps) {
  const caixa = $("#vista-disciplinas"); caixa.innerHTML = "";
  for (const [k, { info, provas }] of gruposDisciplina(ps)) {
    const alunos = alunosDaDisciplina(provas).length;
    const div = document.createElement("div"); div.className = "cartao disciplina";
    div.innerHTML = `<div class="disc-topo">${htmlCapa(provas[0])}<div><div class="nome">${esc(info.disciplina)}</div>
      <div class="disc">${esc([info.inst, info.turma, info.semestre].filter(Boolean).join(" · "))}</div></div></div>
      <ul class="itens embutida"></ul>
      <button class="botao sec ver-alunos">Ver os ${alunos} alunos</button>`;
    const ul = div.querySelector("ul");
    for (const p of provas) {
      const suas = dadosLista.porHash[p.hash] || [], d = dataDe(p);
      const li = document.createElement("li"); li.className = "toque";
      li.innerHTML = `<div class="nome"><span>${esc(infoProva(p).rotulo)}</span><small>${d ? diaBR(d) + " · " : ""}${corrigidas(suas)} de ${totalAlunos(p)} corrigidas</small></div>`;
      li.onclick = () => abrirPacote(p);
      ul.appendChild(li);
    }
    div.querySelector(".ver-alunos").onclick = () => abrirAlunos(k, "provas");
    caixa.appendChild(div);
  }
  if (!caixa.children.length && dadosLista.ps.length) caixa.innerHTML = `<div class="vazio">Nenhuma disciplina com este filtro.</div>`;
}

function inicioSemana(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }

function desenharCalendario(ps) {
  const caixa = $("#vista-calendario");
  const hoje = new Date();
  if (!mesCal) {   // abre no mês da próxima prova (ou no mês atual)
    const prox = ps.map(dataDe).filter(d => d && isoDia(d) >= isoDia(hoje)).sort((a, b) => a - b)[0];
    const base = prox || hoje; mesCal = new Date(base.getFullYear(), base.getMonth(), 1);
  }
  const porDia = {};
  for (const p of ps) { const d = dataDe(p); if (d) (porDia[isoDia(d)] = porDia[isoDia(d)] || []).push(p); }
  const ano = mesCal.getFullYear(), mes = mesCal.getMonth();
  const primeiro = new Date(ano, mes, 1).getDay(), dias = new Date(ano, mes + 1, 0).getDate();
  let celulas = "";
  for (let i = 0; i < primeiro; i++) celulas += `<span></span>`;
  for (let d = 1; d <= dias; d++) {
    const k = isoDia(new Date(ano, mes, d)), tem = porDia[k] || [];
    const marcas = tem.slice(0, 3).map(p => `<i style="--h:${corDa(infoProva(p).disciplina)}"></i>`).join("");
    celulas += `<button data-dia="${k}" class="${[k === isoDia(hoje) ? "hoje" : "", tem.length ? "tem" : "", k === diaSel ? "sel" : ""].join(" ")}">${d}<span class="marcas">${marcas}</span></button>`;
  }
  let titulo = mesCal.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  caixa.innerHTML = `<div class="cartao calendario">
      <div class="cal-topo"><button class="mini" data-mes="-1" aria-label="Mês anterior">‹</button><b>${titulo}</b><button class="mini" data-mes="1" aria-label="Próximo mês">›</button></div>
      <div class="cal-semana">${["D", "S", "T", "Q", "Q", "S", "S"].map(x => `<span>${x}</span>`).join("")}</div>
      <div class="cal-dias">${celulas}</div>
    </div><div id="cal-lista"></div>`;
  for (const b of caixa.querySelectorAll("[data-mes]")) b.onclick = () => { mesCal = new Date(ano, mes + +b.dataset.mes, 1); diaSel = ""; desenharCalendario(ps); };
  for (const b of caixa.querySelectorAll("[data-dia]")) b.onclick = () => { diaSel = diaSel === b.dataset.dia ? "" : b.dataset.dia; desenharCalendario(ps); };

  const lista = $("#cal-lista");
  const bloco = (titulo, provas) => {
    const h = document.createElement("h2"); h.textContent = titulo; lista.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "lista-provas";
    for (const p of provas) ul.appendChild(liProva(p));
    lista.appendChild(ul);
  };
  if (diaSel) {
    const d = new Date(diaSel + "T12:00");
    if (porDia[diaSel]) bloco(diaLongo(d), porDia[diaSel]);
    else lista.innerHTML = `<h2>${diaLongo(d)}</h2><div class="vazio">Nenhuma prova neste dia.</div>`;
    return;
  }
  // provas do mês mostrado, agrupadas por semana (semana de provas)
  const doMes = ps.filter(p => { const d = dataDe(p); return d && d.getFullYear() === ano && d.getMonth() === mes; }).sort((a, b) => dataDe(a) - dataDe(b));
  const semanas = {};
  for (const p of doMes) { const k = isoDia(inicioSemana(dataDe(p))); (semanas[k] = semanas[k] || []).push(p); }
  for (const [k, provas] of Object.entries(semanas)) {
    const ini = new Date(k + "T12:00"), fim = new Date(ini); fim.setDate(fim.getDate() + 6);
    const estaK = isoDia(inicioSemana(hoje)), prox = new Date(estaK + "T12:00"); prox.setDate(prox.getDate() + 7);
    const nome = k === estaK ? "Esta semana" : k === isoDia(prox) ? "Próxima semana" : "Semana";
    bloco(`${nome} · ${diaBR(ini)} a ${diaBR(fim)}`, provas);
  }
  if (!doMes.length) lista.innerHTML = `<div class="vazio">Nenhuma prova marcada neste mês.</div>`;
  const semData = ps.filter(p => !dataDe(p));
  if (semData.length) {
    const h = document.createElement("h2"); h.textContent = "Sem data marcada"; lista.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "itens";
    for (const p of semData) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="nome"><span>${esc(nomeProva(p))}</span><small>${esc(infoProva(p).disciplina)}</small></div>
        <label class="mini">Marcar data<input type="date"></label>`;
      li.querySelector("input").onchange = async (e) => { if (e.target.value) { await guardar("config", e.target.value, "data:" + p.hash); mesCal = null; await listarProvas(); } };
      ul.appendChild(li);
    }
    lista.appendChild(ul);
  }
}

// ---------------------------------------------------------------------------
// Alunos inscritos na disciplina (todas as provas da mesma disciplina e instituição)
// ---------------------------------------------------------------------------

function alunosDaDisciplina(provas) {
  const m = new Map();
  for (const p of provas) {
    const ras = {}; for (const a of p.alunos || []) ras[a.nome] = a.ra;
    for (const n of p.nomes && p.nomes.length ? p.nomes : (p.alunos || []).map(a => a.nome)) {
      const k = Identificacao.normalizarNome(n);
      const a = m.get(k) || { nome: n, ra: "" };
      if (!a.ra && ras[n]) a.ra = ras[n];
      m.set(k, a);
    }
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
}

let alunosAberto = null;
async function abrirAlunos(chave, voltarPara) {
  if (!dadosLista) dadosLista = await carregarLista();
  const provas = gruposDisciplina(dadosLista.ps.filter(p => chaveDisc(p) === chave)).map(x => x[1].provas)[0] || [];
  if (!provas.length) return;
  const info = infoProva(provas[0]), alunos = alunosDaDisciplina(provas);
  alunosAberto = { provas, alunos };
  $("#alunos-titulo").textContent = info.disciplina;
  $("#alunos-info").textContent = [info.inst, info.turma, `${alunos.length} alunos`, `${provas.length} prova(s)`].filter(Boolean).join(" · ");
  $("#alunos-voltar").textContent = voltarPara === "prova" ? "Prova" : "Provas";
  $("#alunos-voltar").onclick = () => irPara(voltarPara);
  $("#alunos-busca").value = "";
  $("#alunos-busca").oninput = desenharAlunos;
  $("#alunos-legenda").textContent = provas.length ? "Em cada prova: nota da folha guardada; “falta” quando a folha ainda não foi corrigida; a data, quando a prova ainda vai ser aplicada." : "";
  desenharAlunos();
  irPara("alunos");
}

function desenharAlunos() {
  const { provas, alunos } = alunosAberto;
  const busca = Identificacao.normalizarNome($("#alunos-busca").value || "");
  const ul = $("#alunos-lista"); ul.innerHTML = "";
  for (const a of alunos) {
    if (busca && !Identificacao.normalizarNome(a.nome).includes(busca) && !String(a.ra).includes($("#alunos-busca").value.trim())) continue;
    const fichas = provas.map(p => {
      const naLista = (p.nomes || []).some(n => mesmoNome(n, a.nome));
      if (!naLista) return "";
      const f = (dadosLista.porHash[p.hash] || []).filter(f => mesmoNome(f.nome, a.nome)).sort((x, y) => y.quando.localeCompare(x.quando))[0];
      const rot = esc(infoProva(p).rotulo.replace(/^Prova\s*/i, "P"));
      if (f) return `<span class="nota-ficha">${rot} <b>${f.nota === null ? "–" : numBR(f.nota)}</b></span>`;
      const d = dataDe(p);
      return d && isoDia(d) > isoDia(new Date()) ? `<span class="nota-ficha falta">${rot} em ${diaBR(d)}</span>` : `<span class="nota-ficha falta">${rot} falta</span>`;
    }).join("");
    const li = document.createElement("li");
    li.innerHTML = `<div class="nome"><span>${esc(a.nome)}</span><small>${a.ra ? "R.A. " + esc(a.ra) : "sem R.A."}</small></div><div class="notas-aluno">${fichas}</div>`;
    ul.appendChild(li);
  }
  if (!ul.children.length) ul.innerHTML = `<li><div class="vazio">Nenhum aluno encontrado.</div></li>`;
}

async function abrirArquivos(arqs) {
  const abertas = [], erros = [];
  let atualizadas = 0;
  for (const arq of arqs) {
    try {
      const p = JSON.parse(await arq.text());
      if (!p || p.tipo !== "gerador-de-provas/celular") throw new Error("não é um arquivo da prova para o celular");
      if (await ler("pacotes", p.hash)) atualizadas++;
      await guardar("pacotes", p);          // mesma prova (mesmo hash): atualiza a turma; as folhas ficam
      abertas.push(p);
    } catch (e) { erros.push(`${arq.name}: ${e.message}`); }
  }
  if (abertas.length === 1 && !erros.length) {
    await abrirPacote(abertas[0]);
    status(atualizadas ? "Prova atualizada. As folhas já corrigidas foram mantidas." : "Prova aberta.", false, "ok");
    return;
  }
  irPara("provas");
  if (erros.length) status((abertas.length ? `${abertas.length} prova(s) guardada(s). ` : "") + "Não abri: " + erros.join("; ") +
    ". Escolha o arquivo “… - Celular (….json”.", true);
  else status(`${abertas.length} provas guardadas no aparelho` + (atualizadas ? ` (${atualizadas} atualizada(s), folhas mantidas).` : "."), false, "ok");
}

function mostrarDataProva() {
  const d = dataDe(pacote);
  $("#prova-data").textContent = d ? d.toLocaleDateString("pt-BR") : "marcar";
  $("#prova-data-campo").value = d ? isoDia(d) : "";
}

async function abrirPacote(p) {
  if (!p || p.tipo !== "gerador-de-provas/celular") throw new Error("Este não é um arquivo da prova para o celular (… - Celular (….json).");
  pacote = p;
  await guardar("pacotes", p);
  await guardar("config", p.hash, "atual");
  await guardar("config", new Date().toISOString(), "uso:" + p.hash);
  $("#prova-nome").textContent = nomeProva(p);
  const info = infoProva(p);
  $("#prova-info").textContent = [p.disciplina, info.turma, `${totalAlunos(p)} alunos`, p.versoes.length > 1 ? `${p.versoes.length} tipos de prova` : ""].filter(Boolean).join(" · ");
  $("#prova-capa").outerHTML = htmlCapa(p, "capa grande-capa").replace('class="capa grande-capa"', 'class="capa grande-capa" id="prova-capa"');
  const dm = await ler("config", "data:" + p.hash).catch(() => null);
  if (dm) datasMarcadas[p.hash] = dm; else delete datasMarcadas[p.hash];
  mostrarDataProva();
  if (!dadosLista) dadosLista = await carregarLista();
  const doGrupo = dadosLista.ps.filter(x => chaveDisc(x) === chaveDisc(p));
  $("#ir-alunos-n").textContent = alunosDaDisciplina(doGrupo.length ? doGrupo : [p]).length;
  $("#ir-alunos").onclick = async () => { dadosLista = await carregarLista(); abrirAlunos(chaveDisc(p), "prova"); };
  montarQuestoes();
  aba("lista");
  await listar();
  irPara("prova");
}

async function removerProva() {
  const fs = await folhasDa(pacote.hash), pend = await naoExportadas(pacote.hash, fs);
  const texto = !fs.length ? "A prova sai da lista. Dá para abrir o arquivo de novo quando quiser."
    : pend ? `Atenção: ${pend} folha(s) corrigida(s) ainda não foram exportadas e serão apagadas deste aparelho. Exporte antes, se ainda não lançou as notas.`
    : `As ${fs.length} folha(s) corrigida(s) já foram exportadas e também saem deste aparelho.`;
  const r = await perguntar(`Remover “${nomeProva(pacote)}”?`, texto,
    [...(pend ? [{ rotulo: "Exportar antes", valor: "exportar" }] : []), { rotulo: fs.length ? "Remover prova e folhas" : "Remover prova", valor: "remover", classe: "perigo" }]);
  if (r === "exportar") return exportar();
  if (r !== "remover") return;
  for (const f of fs) await apagar("folhas", f.id);
  await apagar("pacotes", pacote.hash);
  await apagar("config", "uso:" + pacote.hash);
  await apagar("config", "exportado:" + pacote.hash);
  if ((await ler("config", "atual")) === pacote.hash) await apagar("config", "atual");
  pacote = null;
  irPara("provas");
  status("Prova removida do aparelho.", false, "ok");
}

// ---------------------------------------------------------------------------
// Gabarito e questões (só para consulta)
// ---------------------------------------------------------------------------

function textoRico(t) {
  const e = String(t || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return e.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1<i>$2</i>")
    .replace(/(^|[^\w*])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![\w*])/g, "$1<i>$2</i>")
    .replace(/\n/g, "<br>");
}

function htmlQuestao(q) {
  if (q.tipo === "diss") {
    const padrao = (q.padrao || []).map(([nivel, t]) =>
      `<div class="padrao" style="margin-left:${nivel * 14}px">${nivel ? "• " : ""}${textoRico(t)}</div>`).join("");
    return `<div class="questao"><div class="qtit">Dissertativa ${q.n} · ${numBR(q.pontos || 0)} ponto(s)</div>
      <div>${textoRico(q.enunciado)}</div>${padrao ? `<div class="qpadrao"><b>Padrão de resposta</b>${padrao}</div>` : ""}</div>`;
  }
  const alts = (q.alts || []).map(([l, t]) =>
    `<div class="alt${String(q.resposta).includes(l) ? " certa" : ""}"><b>${l})</b> ${textoRico(t)}</div>`).join("");
  return `<div class="questao"><div class="qtit">${q.n} · ${q.tipo === "vf" ? "V ou F" : "Múltipla escolha"} · gabarito <span class="gab">${q.resposta}</span></div>
    <div>${textoRico(q.enunciado)}</div>${alts}</div>`;
}

function montarQuestoes() {
  const qs = (pacote && pacote.questoes) || {};
  const versoes = Object.keys(qs);
  $("#ir-questoes").hidden = !versoes.length;
  if (!versoes.length) return;
  const sel = $("#q-versao"); sel.innerHTML = "";
  for (const v of versoes) { const o = document.createElement("option"); o.value = o.textContent = v; sel.appendChild(o); }
  $("#q-versao-campo").hidden = versoes.length < 2;
  const pintar = () => {
    const lista = qs[sel.value] || [];
    const obj = lista.filter(q => q.tipo !== "diss");
    $("#q-gabarito-cartao").hidden = !obj.length;
    $("#q-gabarito").innerHTML = obj.map(q => `<span><small>${q.n}</small><b>${esc(q.resposta)}</b></span>`).join("");
    $("#q-lista").innerHTML = lista.map(htmlQuestao).join("");
  };
  sel.onchange = pintar;
  pintar();
}

function questaoDaFolha(versao, n) {
  return ((pacote.questoes || {})[versao] || []).find(q => q.tipo !== "diss" && q.n === n);
}

// ---------------------------------------------------------------------------
// Tela da prova: progresso, corrigidas, faltam, notas
// ---------------------------------------------------------------------------

function notaMaxima(versao) {
  const v = pacote.versoes.find(x => x.versao === versao) || pacote.versoes[0];
  return (v ? v.respostas.length : 0) * (pacote.pontos_objetiva || 0) + (pacote.dissertativas || []).reduce((a, x) => a + (x || 0), 0);
}

function aba(qual) {
  for (const b of document.querySelectorAll(".segmentos button[data-aba]")) b.classList.toggle("ativo", b.dataset.aba === qual);
  for (const a of ["lista", "faltam", "notas"]) $("#aba-" + a).hidden = a !== qual;
}

async function listar() {
  if (!pacote) return;
  const fs = await folhasDa(pacote.hash);
  const total = totalAlunos(pacote), feitas = corrigidas(fs);
  const notas = fs.map(f => f.nota).filter(n => n !== null && n !== undefined);
  $("#n-folhas").textContent = feitas;
  $("#n-total").textContent = total ? `de ${total} corrigidas` : feitas === 1 ? "folha corrigida" : "folhas corrigidas";
  $("#prog").style.width = total ? Math.min(100, 100 * feitas / total) + "%" : "0";
  $("#r-media").textContent = notas.length ? numBR(notas.reduce((a, b) => a + b, 0) / notas.length) : "–";
  $("#r-maior").textContent = notas.length ? numBR(Math.max(...notas)) : "–";
  $("#r-faltam").textContent = total ? Math.max(0, total - feitas) : "–";
  const contagem = $("#vivo-contagem");
  if (contagem) contagem.textContent = total ? `${feitas} de ${total} corrigidas` : `${feitas} corrigidas`;

  // corrigidas
  const ul = $("#lista"); ul.innerHTML = "";
  fs.sort((a, b) => (a.nome || "~").localeCompare(b.nome || "~", "pt"));
  const repetidos = {};
  for (const f of fs) if (f.nome) { const k = Identificacao.normalizarNome(f.nome); repetidos[k] = (repetidos[k] || 0) + 1; }
  for (const f of fs) {
    const li = document.createElement("li"); li.className = "toque";
    const rep = f.nome && repetidos[Identificacao.normalizarNome(f.nome)] > 1;
    li.innerHTML = `<div class="nome"><span></span><small></small></div>
      ${f.conferir.length || rep ? `<span class="etiqueta alerta">${rep ? "repetida" : "conferir"}</span>` : ""}
      <span class="nota">${f.nota === null ? "–" : numBR(f.nota)}</span>`;
    li.querySelector(".nome span").textContent = f.nome || `Sem nome · R.A. ${f.ra || "—"}`;
    li.querySelector("small").textContent = [pacote.versoes.length > 1 ? `Tipo ${f.versao}` : "", quandoBR(f.quando)].filter(Boolean).join(" · ");
    li.onclick = () => abrirFolha(f);
    ul.appendChild(li);
  }
  if (!fs.length) ul.innerHTML = `<li><div class="vazio">Nenhuma folha corrigida ainda.<br>Toque em <b style="display:inline;font-size:inherit">Corrigir com a câmera</b>.</div></li>`;

  // faltam
  const ja = new Set(fs.map(f => Identificacao.normalizarNome(f.nome)).filter(Boolean));
  const ras = {}; for (const a of pacote.alunos || []) ras[a.nome] = a.ra;
  const faltam = (pacote.nomes || []).filter(n => !ja.has(Identificacao.normalizarNome(n)));
  const uf = $("#faltam"); uf.innerHTML = "";
  for (const n of faltam) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="nome"><span></span><small></small></div>`;
    li.querySelector("span").textContent = n;
    li.querySelector("small").textContent = ras[n] ? `R.A. ${ras[n]}` : "";
    uf.appendChild(li);
  }
  if (!faltam.length) uf.innerHTML = `<li><div class="vazio">${(pacote.nomes || []).length ? "Todos os alunos da lista já têm folha corrigida." : "Esta prova não tem lista de alunos."}</div></li>`;
  document.querySelector('[data-aba="faltam"]').textContent = faltam.length ? `Faltam (${faltam.length})` : "Faltam";

  montarNotas(fs, notas);

  // exportação
  $("#exportar").disabled = !fs.length;
  const exp = await ler("config", "exportado:" + pacote.hash).catch(() => null);
  const pend = fs.filter(f => !exp || f.quando > exp.quando).length;
  $("#exportado").textContent = !fs.length ? "" : !exp ? `${fs.length} folha(s) ainda não exportada(s).`
    : pend ? `Última exportação: ${quandoBR(exp.quando)}. ${pend} folha(s) nova(s) desde então.` : `Tudo exportado (${quandoBR(exp.quando)}).`;
}

function montarNotas(fs, notas) {
  const caixa = $("#aba-notas");
  if (!notas.length) { caixa.innerHTML = `<ul class="itens"><li><div class="vazio">As notas aparecem aqui depois da primeira folha guardada.</div></li></ul>`; return; }
  const max = notaMaxima(pacote.versoes[0].versao) || Math.max(...notas) || 1;
  const ord = [...notas].sort((a, b) => a - b), meio = ord.length >> 1;
  const mediana = ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
  const faixas = [0, 0, 0, 0, 0];
  for (const n of notas) faixas[Math.min(4, Math.floor(5 * n / max))]++;
  const alto = Math.max(...faixas);
  const rot = (i) => `${numBR(i * max / 5)}–${numBR((i + 1) * max / 5)}`;
  // questões com mais erros (por tipo de prova e número)
  const erros = {};
  for (const f of fs) {
    const v = pacote.versoes.find(x => x.versao === f.versao); if (!v) continue;
    (f.respostas || []).forEach((r, i) => {
      const certa = String((v.respostas[i] || {}).resposta || ""); if (!certa || certa === "*") return;
      const k = (pacote.versoes.length > 1 ? `Tipo ${f.versao} · ` : "") + `Questão ${r.n}`;
      erros[k] = erros[k] || [0, 0]; erros[k][1]++;
      if (!(r.resp && r.resp.length === 1 && certa.includes(r.resp))) erros[k][0]++;
    });
  }
  const piores = Object.entries(erros).filter(([, [e]]) => e > 0).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).slice(0, 5);
  caixa.innerHTML = `<div class="cartao">
      <div class="progresso"><div class="numeros" style="margin-top:0">
        <div><b>${numBR(notas.reduce((a, b) => a + b, 0) / notas.length)}</b><small>média</small></div>
        <div><b>${numBR(mediana)}</b><small>mediana</small></div>
        <div><b>${numBR(ord[0])}–${numBR(ord[ord.length - 1])}</b><small>menor–maior</small></div>
      </div></div>
      <h2>Distribuição das notas (de ${numBR(max)})</h2>
      <div class="hist">${faixas.map(c => `<div>${c || ""}<i style="height:${alto ? 100 * c / alto : 0}%"></i></div>`).join("")}</div>
      <div class="hist-rot">${faixas.map((_, i) => `<span>${rot(i)}</span>`).join("")}</div>
    </div>
    ${piores.length ? `<h2>Questões com mais erros</h2><ul class="itens erros">${piores.map(([k, [e, t]]) =>
      `<li><div class="nome">${esc(k)}<small>${e} de ${t} erraram</small></div><div class="barra-prog"><i style="width:${100 * e / t}%"></i></div></li>`).join("")}</ul>` : ""}`;
}

// Folha já guardada (consulta e apagar)
function abrirFolha(f) {
  const v = pacote.versoes.find(x => x.versao === f.versao);
  $("#f-nome").textContent = f.nome || "Aluno não identificado";
  $("#f-info").textContent = [f.ra ? `R.A. ${f.ra}` : "", `Tipo ${f.versao}`, `guardada ${quandoBR(f.quando)}`].filter(Boolean).join(" · ");
  const resp = (f.respostas || []).map((r, i) => {
    const certa = String(((v && v.respostas[i]) || {}).resposta || "");
    const ok = certa === "*" || (r.resp && r.resp.length === 1 && certa.includes(r.resp));
    return `<div class="q${ok ? "" : " errada"}${r.sit ? " duvida" : ""}"><span>${r.n}</span><b>${esc(r.resp || "–")}</b></div>`;
  }).join("");
  const diss = (f.notas_diss || []).map((n, i) => `<div class="q" style="background:var(--fundo)"><span>D${i + 1}</span><b style="color:var(--texto)">${n === null ? "?" : numBR(n)}</b><small>/${numBR((pacote.dissertativas || [])[i] ?? 0)}</small></div>`).join("");
  $("#f-corpo").innerHTML = `
    ${f.conferir.length ? `<div class="conferir"><strong>Marcado para conferir</strong><ul>${f.conferir.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    <div class="cartao"><div class="placar"><div class="nota">${f.nota === null ? "–" : numBR(f.nota)} <small>de ${numBR(notaMaxima(f.versao))}</small></div>
      <div class="det">${v && v.respostas.length ? `${f.acertos} de ${v.respostas.length} acertos` : ""}</div></div></div>
    ${resp ? `<div class="cartao"><span class="rotulo">Respostas</span><div class="grade">${resp}</div></div>` : ""}
    ${diss ? `<div class="cartao"><span class="rotulo">Dissertativas</span><div class="grade">${diss}</div></div>` : ""}
    ${f.imagem ? `<div class="cartao"><span class="rotulo">Folha lida</span><img class="folha" alt="Folha lida" src="${f.imagem}"></div>` : ""}
    <p class="ajuda">Para corrigir esta folha, leia-a de novo: a nova leitura pode substituir esta.</p>`;
  $("#f-apagar").onclick = async () => {
    const r = await perguntar("Apagar esta folha?", `${f.nome || "Folha sem nome"} · nota ${f.nota === null ? "–" : numBR(f.nota)}. A folha sai deste aparelho.`,
      [{ rotulo: "Apagar folha", valor: true, classe: "perigo" }]);
    if (!r) return;
    await apagar("folhas", f.id);
    await listar();
    irPara("prova");
    status("Folha apagada.", false, "ok");
  };
  irPara("folha");
}

// ---------------------------------------------------------------------------
// Conferência da folha lida
// ---------------------------------------------------------------------------

function notaAtual() {
  const versao = pacote.versoes.find(v => v.versao === atual.versao);
  const resps = [];
  for (const l of document.querySelectorAll("#respostas .qlinha")) resps[+l.dataset.i] = l.dataset.valor;
  const ac = Identificacao.acertos(resps, versao.respostas.map(r => r.resposta));
  const diss = [...document.querySelectorAll("#diss input")].map(i => i.value === "" ? null : parseFloat(i.value.replace(",", ".")));
  const completa = !diss.length || diss.every(v => v !== null && !isNaN(v));
  return { resps, ac, diss, completa, nota: completa ? ac * pacote.pontos_objetiva + diss.reduce((a, v) => a + (v || 0), 0) : null };
}

// Grade compacta: número e resposta de cada questão (verde certa, vermelha errada, contorno laranja a conferir).
function resumoRespostas() {
  const caixa = $("#respostas-resumo"); caixa.innerHTML = "";
  $("#q-detalhe").innerHTML = ""; $("#q-detalhe").dataset.n = "";
  if (!atual) return;
  const versao = pacote.versoes.find(v => v.versao === atual.versao);
  const linhas = {};
  for (const l of document.querySelectorAll("#respostas .qlinha")) linhas[+l.dataset.i] = l;
  atual.leitura.respostas.forEach((r, i) => {
    const l = linhas[i], v = l.dataset.valor, certa = String(versao.respostas[i].resposta || "");
    const ok = certa === "*" || (v.length === 1 && certa.includes(v));
    const d = document.createElement("div");
    d.className = "q" + (ok ? "" : " errada") + (l.classList.contains("duvida") ? " duvida" : "");
    d.innerHTML = `<span>${r.n}</span><b>${v || "–"}</b>`;
    d.onclick = () => {
      const q = questaoDaFolha(atual.versao, r.n), alvo = $("#q-detalhe");
      for (const x of caixa.children) x.classList.remove("aberta");
      if (!q || alvo.dataset.n == r.n) { alvo.innerHTML = ""; alvo.dataset.n = ""; return; }
      d.classList.add("aberta");
      alvo.dataset.n = r.n;
      alvo.innerHTML = htmlQuestao(q);
    };
    caixa.appendChild(d);
  });
}

function editarRespostas(ligar) {
  $("#respostas").hidden = !ligar;
  $("#respostas-resumo").hidden = ligar;
  $("#legenda").hidden = ligar;
  $("#q-detalhe").hidden = ligar;
  $("#r-resp-rotulo").textContent = ligar ? "Corrigir respostas" : "Respostas lidas · toque para ver a questão";
  $("#editar-respostas").textContent = ligar ? "Concluir" : "Editar";
  if (!ligar) resumoRespostas();
}

function atualizarNota() {
  const n = notaAtual(), total = atual.total;
  $("#r-nota-valor").innerHTML = (n.nota === null ? "?" : numBR(n.nota)) + ` <small>de ${numBR(notaMaxima(atual.versao))}</small>`;
  $("#r-nota").textContent = (total ? `${n.ac} de ${total} acertos` : "") + (n.nota === null ? (total ? " · " : "") + "falta nota de dissertativa" : "");
}

// Mostra se o aluno escolhido já tem folha guardada e troca os botões para Substituir / Manter a anterior.
async function verificarRepetida() {
  if (!atual) return;
  const res = atual, nome = $("#r-aluno").value;
  const ant = nome ? (await folhasDa(pacote.hash)).filter(f => mesmoNome(f.nome, nome)).sort((a, b) => b.quando.localeCompare(a.quando))[0] : null;
  if (atual !== res) return;
  res.anterior = ant || null;
  const caixa = $("#r-ja");
  caixa.hidden = !ant;
  if (ant) caixa.innerHTML = `<b>${esc(ant.nome)} já tem folha guardada</b><br>Nota ${ant.nota === null ? "–" : numBR(ant.nota)} · guardada ${quandoBR(ant.quando)}. Guardar esta substitui a anterior.`;
  $("#guardar").textContent = ant ? "Substituir a anterior" : "Guardar folha";
  $("#descartar").textContent = ant ? "Manter a anterior" : "Não guardar";
}

function mostrar(res, foto) {
  atual = res;
  const cv = anotar(res);
  atual.miniatura = miniatura(cv);
  const alvo = $("#r-folha"); alvo.innerHTML = ""; cv.className = "folha"; alvo.appendChild(cv);
  const sel = $("#r-aluno");
  sel.innerHTML = `<option value="">— não identificado —</option>`;
  for (const n of pacote.nomes) { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); }
  sel.value = res.nome || "";
  $("#r-ra").value = res.ra || "";
  sel.onchange = () => {
    const a = pacote.alunos.find(a => a.nome === sel.value);
    if (a) $("#r-ra").value = a.ra;
    verificarRepetida();
  };
  $("#r-versao").textContent = res.versao;
  // nome e R.A. escritos, para conferir
  const nomeCv = canvasDe(res.leitura.nomeEscrito); nomeCv.className = "recorte";
  $("#r-nome-img").innerHTML = ""; $("#r-nome-img").appendChild(nomeCv);
  const versao = pacote.versoes.find(v => v.versao === res.versao);
  const grade = $("#respostas"); grade.querySelectorAll(".qlinha").forEach(l => l.remove());
  // uma linha por questão, com as opções como botões (toque para marcar; toque de novo para deixar em branco).
  // As questões com rasura ou marca fraca vêm primeiro, destacadas.
  const ordem = res.leitura.respostas.map((r, i) => i).sort((a, b) =>
    (res.leitura.respostas[a].sit ? 0 : 1) - (res.leitura.respostas[b].sit ? 0 : 1) || a - b);
  for (const i of ordem) {
    const r = res.leitura.respostas[i];
    const certa = String(versao.respostas[i].resposta || "");
    const linha = document.createElement("div");
    linha.className = "qlinha" + (r.sit ? " duvida" : "");
    linha.dataset.i = i;
    linha.dataset.valor = r.resp;
    const marcadas = new Set(r.resp.split("+").filter(Boolean));
    linha.innerHTML = `<span class="num">${r.n}</span>` +
      (r.sit ? `<span class="motivo">${r.sit === "múltipla" ? "rasura" : "marca fraca"}</span>` : "");
    const ops = document.createElement("div"); ops.className = "ops";
    for (const op of r.q.opcoes) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = op; b.dataset.op = op;
      if (marcadas.size > 1 && marcadas.has(op)) b.classList.add("rasura");
      b.onclick = () => {
        linha.dataset.valor = linha.dataset.valor === op ? "" : op;
        linha.classList.remove("duvida");
        pinta();
        atualizarNota();
      };
      ops.appendChild(b);
    }
    linha.appendChild(ops);
    const pinta = () => {
      const v = linha.dataset.valor;
      for (const b of ops.children) {
        const op = b.dataset.op, escolhida = v === op;
        b.classList.toggle("certa", escolhida && (certa === "*" || certa.includes(op)));
        b.classList.toggle("errada", escolhida && !(certa === "*" || certa.includes(op)));
        b.classList.toggle("gabarito", !escolhida && certa !== "*" && certa.includes(op));
        if (escolhida || !v.includes("+")) b.classList.remove("rasura");
      }
    };
    pinta();
    grade.appendChild(linha);
  }
  resumoRespostas();
  editarRespostas(false);
  $("#bloco-respostas").hidden = !res.leitura.respostas.length;
  const diss = $("#diss"); diss.innerHTML = "";
  res.leitura.notas.forEach((nt, i) => {
    const d = document.createElement("label");
    d.className = "q" + (nt.sit ? " duvida" : "");
    d.innerHTML = `<span>D${nt.n}</span>`;
    const inp = document.createElement("input");
    inp.type = "text"; inp.inputMode = "decimal"; inp.placeholder = "?";
    inp.value = nt.valor === null ? "" : numBR(nt.valor);
    inp.oninput = atualizarNota;
    d.appendChild(inp);
    const mx = document.createElement("small"); mx.textContent = `/${numBR(pacote.dissertativas[i] ?? 0)}`; d.appendChild(mx);
    diss.appendChild(d);
  });
  $("#bloco-diss").hidden = !res.leitura.notas.length;
  const c = $("#r-conferir"); c.innerHTML = "";
  for (const a of res.conferir) { const li = document.createElement("li"); li.textContent = a; c.appendChild(li); }
  $("#r-conferir-bloco").hidden = !res.conferir.length;
  $("#r-ja").hidden = true;
  $("#guardar").textContent = "Guardar folha"; $("#descartar").textContent = "Não guardar";
  atualizarNota();
  verificarRepetida();
  $("#passo-resultado").hidden = false;
  if (!vivoAberto()) irPara("conferencia");
}

// Guarda a folha em conferência. Se o aluno já tem folha, substitui a anterior. Devolve true se guardou.
async function salvarAtual() {
  if (!atual) return false;
  const n = notaAtual();
  const nome = $("#r-aluno").value;
  const ra = $("#r-ra").value.trim();
  const conferir = atual.conferir.filter(a => !/aluno não identificado/.test(a) || !nome);
  const anteriores = nome ? (await folhasDa(pacote.hash)).filter(f => mesmoNome(f.nome, nome)) : [];
  const folha = {
    hash: pacote.hash, quando: new Date().toISOString(), nome, ra, versao: atual.versao,
    respostas: atual.leitura.respostas.map((r, i) => ({ n: r.n, resp: n.resps[i], sit: n.resps[i] === r.resp ? r.sit : "" })),
    notas_diss: n.diss, acertos: n.ac, nota: n.nota,
    conferir: atual.conferir.length && (nome !== (atual.nome || "") || ra !== (atual.ra || "")) ? [...conferir, "corrigido à mão no celular"] : conferir,
    imagem: atual.miniatura,
  };
  if (anteriores.length) folha.id = anteriores[0].id;   // substitui a anterior (mesmo registro)
  await guardar("folhas", folha);
  for (const f of anteriores.slice(1)) await apagar("folhas", f.id);   // repetidas antigas
  atual = null;
  $("#passo-resultado").hidden = true;
  await listar();
  if (!vivoAberto()) {
    irPara("prova");
    status(`${anteriores.length ? "Folha substituída" : "Folha guardada"}${nome ? ": " + nome : ""}${n.nota === null ? "" : " · nota " + numBR(n.nota)}.`, false, "ok");
  }
  return true;
}

function naoGuardar() {
  const tinha = atual && atual.anterior;
  atual = null;
  $("#passo-resultado").hidden = true;
  irPara("prova");
  status(tinha ? "Mantida a folha anterior." : "Leitura não guardada.");
}

async function processarFoto(arq) {
  if (!pacote) return;
  $("#passo-resultado").hidden = true;
  try {
    status("Preparando a leitura…", false, "lendo");
    await modelosProntos;
    status("Lendo a folha…", false, "lendo");
    await new Promise(r => setTimeout(r, 30));
    const gray = await cinzaDoArquivo(arq);
    const loc = Leitura.localizar(gray, pacote);
    if (!loc) { status("Não encontrei a folha de respostas na foto. Enquadre a folha inteira, com os quatro quadrados pretos dos cantos, em lugar bem iluminado.", true); return; }
    if (loc.erro) { status(loc.erro, true); return; }
    const res = await Identificacao.corrigirFolha(gray, loc, pacote);
    status("");
    mostrar(res, arq);
  } catch (e) {
    console.error(e);
    status("Erro ao ler a folha: " + e.message, true);
  }
}

// Arquivo de resultados da prova aberta (o mesmo formato lido pelo corrigir.py / lancar.bat).
async function montarExportacao() {
  const fs = await folhasDa(pacote.hash);
  const dados = {
    tipo: "gerador-de-provas/resultados-celular", versao: 1, hash: pacote.hash, chave_arquivo: pacote.chave_arquivo,
    nome_notas: pacote.nome_notas, exportado_em: new Date().toISOString(),
    folhas: fs.map((f, i) => ({ ...f, arquivo: `celular ${i + 1}`, id: undefined, hash: undefined })),
  };
  const agora = new Date();
  const carimbo = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")} ${String(agora.getHours()).padStart(2, "0")}h${String(agora.getMinutes()).padStart(2, "0")}`;
  const nome = `${pacote.nome_notas} - celular ${carimbo}.json`;
  const marcar = async () => { await guardar("config", { quando: dados.exportado_em, n: fs.length }, "exportado:" + pacote.hash); await listar(); };
  return { dados, nome, texto: JSON.stringify(dados), marcar };
}

async function exportar() {
  const { nome, texto, marcar } = await montarExportacao();
  const arq = new File([texto], nome, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [arq] })) {
    try { await navigator.share({ files: [arq], title: nome }); await marcar(); status("Resultados enviados. Salve-os na pasta da prova, no OneDrive.", false, "ok"); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(arq); a.download = nome; a.click();
  await marcar();
  status("Resultados baixados. Coloque o arquivo na pasta da prova, no OneDrive.", false, "ok");
}


// ---------------------------------------------------------------------------
// Aparência (temas). A escolha fica no aparelho; ?tema=… na URL só mostra a prévia.
// ---------------------------------------------------------------------------

const TEMAS = [["classico", "Clássico"], ["apple-music", "Apple Music"], ["ios", "iOS"], ["material", "Material"], ["editorial", "Editorial"],
  ["academico", "Acadêmico"], ["brutalista", "Brutalista"], ["vidro", "Vidro"], ["sol", "Sol forte (alto contraste)"], ["noite", "Noite"]];

function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  const est = getComputedStyle(document.documentElement);
  let cor = est.getPropertyValue("--barra-fundo").trim();
  if (!/^#/.test(cor)) cor = est.getPropertyValue("--fundo").trim();
  if (!/^#/.test(cor)) cor = (est.getPropertyValue("--vidro-fundo").match(/#[0-9a-fA-F]{6}/) || [""])[0];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && /^#/.test(cor)) meta.content = cor;
}

async function escolherTema() {
  const atualT = document.documentElement.dataset.tema || "vidro";
  const r = await perguntar("Aparência", "Escolha o estilo da página. Dá para trocar quando quiser.",
    TEMAS.map(([v, rot]) => ({ rotulo: rot + (v === atualT ? " ✓" : ""), valor: v, classe: v === atualT ? "" : "sec" })));
  if (!r) return;
  try { localStorage.setItem("tema", r); } catch (e) {}
  aplicarTema(r);
  if (r === "vidro") await escolherCorVidro();
}

const CORES_VIDRO = [["auto", "Automático: Oceano de dia, Meia-noite à noite"], ["violeta", "Violeta"], ["oceano", "Oceano"], ["aurora", "Aurora"], ["por-do-sol", "Pôr do sol"], ["floresta", "Floresta"],
  ["academico", "Acadêmico"], ["vinho", "Vinho"], ["lavanda", "Lavanda"], ["grafite", "Grafite (escuro)"], ["meia-noite", "Meia-noite (escuro)"]];

function corEscolhida() {
  try { return localStorage.getItem("cor") || "auto"; } catch (e) { return "auto"; }
}

// Põe a cor do Vidro na página; "auto" segue o relógio (Oceano das 6h às 18h, Meia-noite fora disso).
function aplicarCor() {
  if (new URLSearchParams(location.search).get("cor")) return;   // prévia
  let cor = corEscolhida();
  if (cor === "auto") { const hr = new Date().getHours(); cor = hr >= 6 && hr < 18 ? "oceano" : "meia-noite"; }
  const h = document.documentElement;
  if (cor === "violeta") delete h.dataset.cor; else h.dataset.cor = cor;
  aplicarTema(h.dataset.tema || "vidro");
}

async function escolherCorVidro() {
  const atualC = corEscolhida();
  const r = await perguntar("Cores do Vidro", "Escolha a composição de cores.",
    CORES_VIDRO.map(([v, rot]) => ({ rotulo: rot + (v === atualC ? " ✓" : ""), valor: v, classe: v === atualC ? "" : "sec" })));
  if (!r) return;
  try { localStorage.setItem("cor", r); } catch (e) {}
  aplicarCor();
}
// troca de dia para noite com a página aberta, e ao voltar para ela
setInterval(() => { if (corEscolhida() === "auto") aplicarCor(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && corEscolhida() === "auto") aplicarCor(); });

// ---------------------------------------------------------------------------

window.addEventListener("load", async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  aplicarTema(document.documentElement.dataset.tema || "vidro");
  estadoLeitura("Preparando a leitura…");
  modelosProntos = Identificacao.carregarModelos(BASE, (t) => estadoLeitura(t)).then(() => estadoLeitura(""));
  modelosProntos.catch(e => estadoLeitura("Não consegui carregar os modelos de leitura: " + e.message, true));
  $("#abrir").onchange = async (ev) => {
    const arqs = [...ev.target.files]; ev.target.value = "";
    if (arqs.length) await abrirArquivos(arqs);
  };
  $("#foto").onchange = (ev) => { const a = ev.target.files[0]; ev.target.value = ""; if (a) processarFoto(a); };
  $("#guardar").onclick = salvarAtual;
  $("#descartar").onclick = naoGuardar;
  $("#exportar").onclick = exportar;
  $("#remover-prova").onclick = removerProva;
  $("#editar-respostas").onclick = () => editarRespostas($("#respostas").hidden);
  $("#aviso button").onclick = () => { $("#aviso").hidden = true; };
  for (const b of document.querySelectorAll("[data-ir]")) b.onclick = () => irPara(b.dataset.ir);
  for (const b of document.querySelectorAll(".segmentos button[data-aba]")) b.onclick = () => aba(b.dataset.aba);
  for (const b of document.querySelectorAll("#modo-provas button")) b.onclick = () => { modoProvas = b.dataset.modo; diaSel = ""; salvarFiltro(); desenharProvas(); window.scrollTo(0, 0); };
  const fl = await ler("config", "filtro").catch(() => null);
  if (fl) { filtro = { inst: fl.inst || "", disc: fl.disc || "" }; modoProvas = fl.modo || "lista"; }
  $("#prova-data-campo").onchange = async (e) => {
    if (e.target.value) await guardar("config", e.target.value, "data:" + pacote.hash); else await apagar("config", "data:" + pacote.hash);
    if (e.target.value) datasMarcadas[pacote.hash] = e.target.value; else delete datasMarcadas[pacote.hash];
    mostrarDataProva(); mesCal = null;
  };
  $("#aparencia").onclick = escolherTema;
  // "Guardar sozinho" vem desligado; o aparelho lembra a escolha do professor.
  const auto = $("#vivo-auto");
  auto.checked = !!(await ler("config", "guardar-sozinho").catch(() => false));
  auto.onchange = () => guardar("config", auto.checked, "guardar-sozinho");
  const h = await ler("config", "atual").catch(() => null);
  const p = h ? await ler("pacotes", h) : null;
  if (p) await abrirPacote(p); else irPara("provas");
});
