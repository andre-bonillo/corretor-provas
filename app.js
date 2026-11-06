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
// Telas
// ---------------------------------------------------------------------------

function status(txt, erro = false) {
  const s = $("#status");
  s.textContent = txt || "";
  s.className = erro ? "status erro" : "status";
}

async function abrirPacote(p) {
  if (!p || p.tipo !== "gerador-de-provas/celular") throw new Error("Este não é um arquivo da prova para o celular (… - Celular (….json).");
  pacote = p;
  await guardar("pacotes", p);
  await guardar("config", p.hash, "atual");
  $("#prova-nome").textContent = p.nome.replace(" - Gabaritos", "");
  $("#prova-info").textContent = `${p.alunos.length || p.nomes.length} alunos na lista · ${p.versoes.length} tipo(s) de prova`;
  $("#passo-foto").hidden = false;
  await listar();
}

async function listar() {
  const fs = pacote ? await folhasDa(pacote.hash) : [];
  $("#n-folhas").textContent = fs.length;
  $("#exportar").disabled = !fs.length;
  const ul = $("#lista");
  ul.innerHTML = "";
  fs.sort((a, b) => (a.nome || "~").localeCompare(b.nome || "~", "pt"));
  for (const f of fs) {
    const li = document.createElement("li");
    const nota = f.nota === null ? "sem nota" : numBR(f.nota);
    li.innerHTML = `<span class="nome"></span><span class="nota"></span><button class="x" title="Apagar">×</button>`;
    li.querySelector(".nome").textContent = (f.nome || `R.A. ${f.ra || "—"}`) + ` · ${f.versao}`;
    li.querySelector(".nota").textContent = nota + (f.conferir.length ? " ⚠" : "");
    li.querySelector(".x").onclick = async () => { if (confirm("Apagar esta folha?")) { await apagar("folhas", f.id); listar(); } };
    ul.appendChild(li);
  }
  const ja = new Set(fs.map(f => Identificacao.normalizarNome(f.nome)).filter(Boolean));
  const faltam = (pacote ? pacote.nomes : []).filter(n => !ja.has(Identificacao.normalizarNome(n)));
  $("#faltam").textContent = pacote && pacote.nomes.length ? `Faltam ${faltam.length}: ${faltam.slice(0, 40).join("; ")}` : "";
}

function notaAtual() {
  const versao = pacote.versoes.find(v => v.versao === atual.versao);
  const resps = [];
  for (const l of document.querySelectorAll("#respostas .qlinha")) resps[+l.dataset.i] = l.dataset.valor;
  const ac = Identificacao.acertos(resps, versao.respostas.map(r => r.resposta));
  const diss = [...document.querySelectorAll("#diss input")].map(i => i.value === "" ? null : parseFloat(i.value.replace(",", ".")));
  const completa = !diss.length || diss.every(v => v !== null && !isNaN(v));
  return { resps, ac, diss, completa, nota: completa ? ac * pacote.pontos_objetiva + diss.reduce((a, v) => a + (v || 0), 0) : null };
}

function atualizarNota() {
  const n = notaAtual(), total = atual.total;
  $("#r-nota").textContent = (total ? `${n.ac}/${total} acertos · ` : "") + (n.nota === null ? "nota incompleta" : `nota ${numBR(n.nota)}`);
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
  };
  $("#r-versao").textContent = res.versao;
  // nome e R.A. escritos, para conferir
  const nomeCv = canvasDe(res.leitura.nomeEscrito); nomeCv.className = "recorte";
  $("#r-nome-img").innerHTML = ""; $("#r-nome-img").appendChild(nomeCv);
  const versao = pacote.versoes.find(v => v.versao === res.versao);
  const grade = $("#respostas"); grade.innerHTML = "";
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
  atualizarNota();
  $("#passo-resultado").hidden = false;
  $("#passo-resultado").scrollIntoView({ behavior: "smooth" });
}

async function salvarAtual() {
  const n = notaAtual();
  const nome = $("#r-aluno").value;
  const ra = $("#r-ra").value.trim();
  const conferir = atual.conferir.filter(a => !/aluno não identificado/.test(a) || !nome);
  const fs = await folhasDa(pacote.hash);
  if (nome && fs.some(f => Identificacao.normalizarNome(f.nome) === Identificacao.normalizarNome(nome))
      && !confirm(`${nome} já tem uma folha corrigida. Guardar mesmo assim?`)) return;
  await guardar("folhas", {
    hash: pacote.hash, quando: new Date().toISOString(), nome, ra, versao: atual.versao,
    respostas: atual.leitura.respostas.map((r, i) => ({ n: r.n, resp: n.resps[i], sit: n.resps[i] === r.resp ? r.sit : "" })),
    notas_diss: n.diss, acertos: n.ac, nota: n.nota,
    conferir: atual.conferir.length && (nome !== (atual.nome || "") || ra !== (atual.ra || "")) ? [...conferir, "corrigido à mão no celular"] : conferir,
    imagem: atual.miniatura,
  });
  atual = null;
  $("#passo-resultado").hidden = true;
  status("Folha guardada. Fotografe a próxima.");
  await listar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function processarFoto(arq) {
  if (!pacote) return;
  $("#passo-resultado").hidden = true;
  try {
    status("Preparando…");
    await modelosProntos;
    status("Lendo a folha…");
    await new Promise(r => setTimeout(r, 30));
    const t0 = performance.now();
    const gray = await cinzaDoArquivo(arq);
    const loc = Leitura.localizar(gray, pacote);
    if (!loc) { status("Não encontrei a folha de respostas na foto. Enquadre a folha inteira, com os quatro quadrados pretos dos cantos, em lugar bem iluminado.", true); return; }
    if (loc.erro) { status(loc.erro, true); return; }
    const res = await Identificacao.corrigirFolha(gray, loc, pacote);
    status(`Lida em ${((performance.now() - t0) / 1000).toFixed(1)} s. Confira e guarde.`);
    mostrar(res, arq);
  } catch (e) {
    console.error(e);
    status("Erro ao ler a folha: " + e.message, true);
  }
}

async function exportar() {
  const fs = await folhasDa(pacote.hash);
  const dados = {
    tipo: "gerador-de-provas/resultados-celular", versao: 1, hash: pacote.hash, chave_arquivo: pacote.chave_arquivo,
    nome_notas: pacote.nome_notas, exportado_em: new Date().toISOString(),
    folhas: fs.map((f, i) => ({ ...f, arquivo: `celular ${i + 1}`, id: undefined, hash: undefined })),
  };
  const agora = new Date();
  const carimbo = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")} ${String(agora.getHours()).padStart(2, "0")}h${String(agora.getMinutes()).padStart(2, "0")}`;
  const nome = `${pacote.nome_notas} - celular ${carimbo}.json`;
  const arq = new File([JSON.stringify(dados)], nome, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [arq] })) {
    try { await navigator.share({ files: [arq], title: nome }); status("Resultados enviados. Salve-os na pasta da prova, no OneDrive."); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(arq); a.download = nome; a.click();
  status("Resultados baixados. Coloque o arquivo na pasta da prova, no OneDrive.");
}

// ---------------------------------------------------------------------------

window.addEventListener("load", async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  modelosProntos = Identificacao.carregarModelos(BASE, (t) => { if (!atual) status(t); }).then(() => status(pacote ? "Pronto. Fotografe uma folha." : "Pronto. Abra o arquivo da prova."));
  modelosProntos.catch(e => status("Não consegui carregar os modelos de leitura: " + e.message, true));
  $("#abrir").onchange = async (ev) => {
    const arq = ev.target.files[0]; ev.target.value = "";
    if (!arq) return;
    try { await abrirPacote(JSON.parse(await arq.text())); status("Prova aberta. Fotografe uma folha."); }
    catch (e) { status(e.message, true); }
  };
  $("#foto").onchange = (ev) => { const a = ev.target.files[0]; ev.target.value = ""; if (a) processarFoto(a); };
  $("#guardar").onclick = salvarAtual;
  $("#descartar").onclick = () => { atual = null; $("#passo-resultado").hidden = true; status("Folha descartada."); };
  $("#exportar").onclick = exportar;
  const h = await ler("config", "atual").catch(() => null);
  if (h) { const p = await ler("pacotes", h); if (p) await abrirPacote(p); }
});
