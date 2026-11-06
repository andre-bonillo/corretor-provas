// Correção ao vivo: a câmera fica aberta, a página procura a folha em cada quadro e,
// quando ela está enquadrada e parada, lê e mostra a nota sem precisar fotografar.
"use strict";

const AoVivo = (() => {
  const LADO_BUSCA = 1280;      // resolução usada só para achar a folha (rápido)
  const QUADROS_ESTAVEIS = 2;   // leituras seguidas com a folha parada antes de corrigir
  const TOLERANCIA = 0.025;     // quanto os cantos podem se mexer entre quadros (fração do tamanho da folha)

  let fluxo = null, video = null, rodando = false, estado = "procurando";
  let anteriores = [], ultimaFolha = null, quadrosSemFolha = 0;
  const cvQuadro = document.createElement("canvas");
  const ctxQuadro = cvQuadro.getContext("2d", { willReadFrequently: true });

  const el = (id) => document.getElementById(id);
  const dormir = (ms) => new Promise(r => setTimeout(r, ms));

  function quadroCinza(ladoMax) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const e = Math.min(1, ladoMax / Math.max(vw, vh));
    const w = Math.round(vw * e), h = Math.round(vh * e);
    cvQuadro.width = w; cvQuadro.height = h;
    ctxQuadro.drawImage(video, 0, 0, w, h);
    const px = ctxQuadro.getImageData(0, 0, w, h).data;
    const d = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < d.length; i += 4, j++) d[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    return { w, h, d, escala: e };
  }

  function cantos(loc, escala) {
    const e = 1 / escala;
    return [loc.esq[0], loc.dir[0], loc.dir[loc.dir.length - 1], loc.esq[loc.esq.length - 1]].map(p => [p[0] * e, p[1] * e]);
  }

  function parada(lista) {
    if (lista.length < QUADROS_ESTAVEIS) return false;
    const a = lista[lista.length - 1], b = lista[lista.length - QUADROS_ESTAVEIS];
    const tam = Math.hypot(a[2][0] - a[0][0], a[2][1] - a[0][1]);
    return a.every((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < TOLERANCIA * tam);
  }

  function mesmaFolha(c) {
    if (!ultimaFolha) return false;
    const tam = Math.hypot(c[2][0] - c[0][0], c[2][1] - c[0][1]);
    return c.every((p, i) => Math.hypot(p[0] - ultimaFolha[i][0], p[1] - ultimaFolha[i][1]) < 0.08 * tam);
  }

  function desenhar(c, cor) {
    const cv = el("vivo-marcas");
    const r = video.getBoundingClientRect();
    cv.width = r.width; cv.height = r.height;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!c) return;
    // o vídeo é mostrado com object-fit: cover
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(r.width / vw, r.height / vh);
    const ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2;
    ctx.beginPath();
    c.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + x * s, oy + y * s));
    ctx.closePath();
    ctx.lineWidth = 4; ctx.strokeStyle = cor; ctx.stroke();
  }

  function aviso(txt) { el("vivo-aviso").textContent = txt; }

  async function corrigirAgora() {
    estado = "lendo";
    aviso("Lendo…");
    const t0 = performance.now();
    const gray = quadroCinza(3200);
    const loc = Leitura.localizar(gray, pacote);
    if (!loc || loc.erro) {
      estado = "procurando"; anteriores = [];
      aviso(loc && loc.erro ? loc.erro : "Segure firme…");
      return;
    }
    const res = await Identificacao.corrigirFolha(gray, loc, pacote);
    ultimaFolha = cantos(loc, gray.escala);
    estado = "resultado";
    desenhar(null);
    if (navigator.vibrate) navigator.vibrate(60);
    mostrar(res);
    el("vivo-painel").scrollTop = 0;
    const nota = res.nota === null || res.notasDiss.some(v => v === null) ? "nota incompleta" : `nota ${numBR(res.nota)}`;
    aviso(`${res.nome || "Aluno não identificado"} · ${nota} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    // guarda sozinho quando não há nada a conferir (se a opção estiver ligada)
    if (el("vivo-auto").checked && !res.conferir.length && res.nome) {
      const ja = (await folhasDa(pacote.hash)).some(f => Identificacao.normalizarNome(f.nome) === Identificacao.normalizarNome(res.nome));
      if (!ja) { await dormir(900); if (estado === "resultado" && atual === res) await guardar_(); }
    }
  }

  async function guardar_() {
    if (!atual) return;
    const nome = atual.nome;
    const antes = (await folhasDa(pacote.hash)).length;
    await salvarAtual();
    const depois = (await folhasDa(pacote.hash)).length;
    if (depois === antes) return;   // guardar cancelado (aluno repetido): continua no resultado
    aviso(`Guardada${nome ? ": " + nome : ""}. Aponte para a próxima folha.`);
    proxima(true);
  }

  function proxima(esperarTroca) {
    atual = null;
    el("passo-resultado").hidden = true;
    estado = esperarTroca ? "esperando-troca" : "procurando";
    if (!esperarTroca) ultimaFolha = null;
    anteriores = [];
    quadrosSemFolha = 0;
  }

  async function laco() {
    while (rodando) {
      if (estado === "lendo" || estado === "resultado" || video.readyState < 2) { await dormir(150); continue; }
      const q = quadroCinza(LADO_BUSCA);
      if (!q) { await dormir(100); continue; }
      const loc = Leitura.localizar(q, pacote);
      if (!loc || loc.erro) {
        desenhar(null);
        quadrosSemFolha++;
        anteriores = [];
        if (estado === "esperando-troca" && quadrosSemFolha >= 2) { estado = "procurando"; ultimaFolha = null; }
        if (estado === "procurando") aviso(loc && loc.erro ? loc.erro : "Enquadre a folha de respostas, com os quatro quadrados pretos dos cantos.");
        await dormir(60);
        continue;
      }
      quadrosSemFolha = 0;
      const c = cantos(loc, q.escala);
      if (estado === "esperando-troca") {
        if (mesmaFolha(c)) { desenhar(c, "#9aa4b2"); await dormir(120); continue; }
        estado = "procurando"; ultimaFolha = null;
      }
      anteriores.push(c);
      if (anteriores.length > 5) anteriores.shift();
      desenhar(c, "#2ecc40");
      if (parada(anteriores)) await corrigirAgora();
      else { aviso("Segure firme…"); await dormir(40); }
    }
  }

  async function abrir() {
    if (!pacote) return;
    el("vivo").hidden = false;
    document.body.classList.add("vivo-aberto");
    el("vivo-painel").appendChild(el("passo-resultado"));
    el("passo-resultado").hidden = true;
    aviso("Abrindo a câmera…");
    try {
      await modelosProntos;
      fluxo = window.__fonteTeste ? window.__fonteTeste() : await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
      video = el("vivo-video");
      video.srcObject = fluxo;
      await video.play();
      const trilha = fluxo.getVideoTracks()[0];
      // foco contínuo, quando o aparelho permite
      try { await trilha.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) { /* sem suporte */ }
      rodando = true;
      proxima(false);
      laco();
    } catch (e) {
      aviso(e.name === "NotAllowedError"
        ? "Sem permissão para a câmera. Libere em Ajustes > Safari > Câmera, ou use o botão Fotografar."
        : "Não consegui abrir a câmera: " + e.message);
    }
  }

  function fechar() {
    rodando = false;
    if (fluxo) fluxo.getTracks().forEach(t => t.stop());
    fluxo = null;
    el("vivo").hidden = true;
    document.body.classList.remove("vivo-aberto");
    el("passo-foto").after(el("passo-resultado"));
    if (atual) { el("passo-resultado").hidden = false; }
    listar();
  }

  function ligar() {
    el("ao-vivo").onclick = abrir;
    el("vivo-fechar").onclick = fechar;
    const guardarOriginal = el("guardar").onclick, descartarOriginal = el("descartar").onclick;
    el("guardar").onclick = () => rodando ? guardar_() : guardarOriginal();
    el("descartar").onclick = () => {
      if (!rodando) return descartarOriginal();
      aviso("Descartada. Aponte para a próxima folha.");
      proxima(true);
    };
    el("vivo-de-novo").onclick = () => { aviso("Lendo de novo…"); proxima(false); };
    document.addEventListener("visibilitychange", () => { if (document.hidden && rodando) fechar(); });
  }

  return { ligar, abrir, fechar, estado: () => estado };
})();

window.addEventListener("load", () => AoVivo.ligar());
