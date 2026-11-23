// Navegação da tela inicial, em quatro formatos escolhidos em Ajustes › Exibição do menu
// (a escolha fica no aparelho; ?nav=… na URL só mostra a prévia):
//   abas       barra de abas embaixo: Início, Provas, Disciplinas, Calendário, Ajustes
//   lateral    menu lateral à esquerda (como no Word para iPad): fixo em telas largas (iPad deitado),
//              gaveta pelo botão ☰ no iPhone e no iPad em pé
//   icones     ícones no cabeçalho: sincronizar e "⋯" (opções por baixo); Provas/Disciplinas/Calendário no alto
//   flutuante  cápsula flutuante embaixo: Provas, Disciplinas, Calendário, Abrir arquivo, Ajustes
// As opções (abrir arquivo, sincronização, aparência, exibição, ícones) ficam em #opcoes: na tela Ajustes
// (abas e lateral) ou numa folha que sobe de baixo (ícones e flutuante).
// Estilo dos ícones (Ajustes › Ícones; ?icones=… só mostra a prévia): contorno, coloridos ou blocos.
"use strict";

(() => {
  const CHAVE = "corretor-nav", CHAVE_IC = "corretor-icones";
  const NOMES = { abas: "Abas embaixo", lateral: "Menu lateral", icones: "Ícones no alto", flutuante: "Barra flutuante" };
  const FORMATOS = Object.keys(NOMES);
  const COM_TELA_AJUSTES = ["abas", "lateral"];
  const ESTILOS = { contorno: "Contorno", coloridos: "Coloridos", blocos: "Blocos coloridos" };
  const $ = (s) => document.querySelector(s);

  // engrenagem desenhada aqui: 8 dentes em volta de um círculo
  const engrenagem = (() => {
    const pts = [], n = 8, passo = 2 * Math.PI / n, R = 9.6, r = 7.4;
    for (let i = 0; i < n; i++) {
      const a = i * passo - Math.PI / 2;
      for (const [da, raio] of [[-0.3, r], [-0.17, R], [0.17, R], [0.3, r]])
        pts.push([12 + raio * Math.cos(a + da * passo * 1.6), 12 + raio * Math.sin(a + da * passo * 1.6)]);
    }
    return `<path d="M${pts.map(([x, y]) => x.toFixed(2) + " " + y.toFixed(2)).join("L")}Z"/><circle cx="12" cy="12" r="3"/>`;
  })();
  const ic = {
    inicio: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    lista: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    disciplinas: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
    calendario: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    ajustes: engrenagem,
    abrir: '<path d="M4 7h6l2 2h8v10H4z"/><path d="M12 12v5M9.5 14.5L12 12l2.5 2.5"/>',
    aparencia: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 000 16z" fill="currentColor"/>',
    exibicao: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    icones: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><circle cx="16.5" cy="16.5" r="3.5"/>',
    sinc: '<path d="M20 11a8 8 0 00-14.5-4.5L4 8M4 13a8 8 0 0014.5 4.5L20 16"/><path d="M4 4v4h4M20 20v-4h-4"/>',
    mais: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  };
  const CORES = { inicio: "#4f5bd5", lista: "#2f7bf6", disciplinas: "#8e5cf0", calendario: "#ef4b4b", abrir: "#21a366", ajustes: "#7a8590",
                  aparencia: "#f59e0b", exibicao: "#14a3b8", icones: "#e5508f" };
  const ROTULOS = { inicio: "Início", lista: "Provas", disciplinas: "Turmas", calendario: "Calendário", ajustes: "Ajustes" };

  const lerPrevia = (k, validos) => { const v = new URLSearchParams(location.search).get(k); return validos.includes(v) ? v : null; };
  let previa = lerPrevia("nav", FORMATOS), previaIc = lerPrevia("icones", Object.keys(ESTILOS));
  const ler = (k, validos, padrao) => { try { const v = localStorage.getItem(k); return validos.includes(v) ? v : padrao; } catch (e) { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const lerFormato = () => previa || ler(CHAVE, FORMATOS, "abas");
  const lerEstilo = () => previaIc || ler(CHAVE_IC, Object.keys(ESTILOS), "contorno");

  // desenho simples (cabeçalho, barra de abas) e desenho no estilo escolhido
  const svg = (n, t = 24, cor = "currentColor", larg = 1.8) =>
    `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="${larg}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[n]}</svg>`;
  function icone(n, t = 24) {
    const e = lerEstilo();
    if (e === "coloridos" && CORES[n]) return svg(n, t, CORES[n], 1.9);
    if (e === "blocos" && CORES[n]) {
      const lado = Math.round(t * 1.25);
      return `<span class="bloco-ic" style="width:${lado}px;height:${lado}px;background:${CORES[n]}">${svg(n, Math.round(t * 0.8), "#fff", 2)}</span>`;
    }
    return svg(n, t);
  }

  // --------------------------------------------------------------- opções (Ajustes)
  function abrirOpcoes() {
    if (COM_TELA_AJUSTES.includes(lerFormato())) { irPara("ajustes"); return; }
    const folha = $("#opcoes-folha");
    folha.querySelector(".caixa").appendChild($("#opcoes"));
    folha.hidden = false;
  }
  // fecha o que estiver aberto por cima (folha de opções, gaveta do menu lateral)
  function fecharOpcoes() {
    document.body.classList.remove("gaveta-aberta");
    const folha = $("#opcoes-folha");
    if (folha.hidden) return;
    folha.hidden = true;
    $("#tela-ajustes main").appendChild($("#opcoes"));
  }

  // --------------------------------------------------------------- Provas/Disciplinas/Calendário
  function irModo(modo) {
    fecharOpcoes();
    if (document.body.dataset.tela !== "provas") irPara("provas");
    const b = document.querySelector(`#modo-provas button[data-modo="${modo}"]`);
    if (b) b.click();
    marcar();
  }
  function marcar() {
    const naAjustes = document.body.dataset.tela === "ajustes";
    for (const b of document.querySelectorAll("[data-nav-modo]"))
      b.classList.toggle("ativo", naAjustes ? b.dataset.navModo === "ajustes" : b.dataset.navModo === modoProvas);
  }

  async function escolher(titulo, texto, opcoes, atual) {
    return perguntar(titulo, texto, Object.entries(opcoes).map(([v, nome]) => ({ rotulo: (v === atual ? "✓ " : "") + nome, valor: v })));
  }
  async function escolherExibicao() {
    const atual = lerFormato();
    const r = await escolher("Exibição do menu", "Como o menu aparece neste aparelho. O menu lateral fica fixo à esquerda no iPad deitado; no iPhone, abre pelo botão ☰.", NOMES, atual);
    if (!r || r === atual) return;
    previa = null; gravar(CHAVE, r);
    fecharOpcoes();
    aplicar();
    if (COM_TELA_AJUSTES.includes(r)) irPara("ajustes");
    status("Menu: " + NOMES[r].toLowerCase() + ".", false, "ok");
  }
  async function escolherIcones() {
    const atual = lerEstilo();
    const r = await escolher("Ícones", "Estilo dos ícones do menu e de Ajustes, neste aparelho.", ESTILOS, atual);
    if (!r || r === atual) return;
    previaIc = null; gravar(CHAVE_IC, r);
    desenhar(); aplicar();
    status("Ícones: " + ESTILOS[r].toLowerCase() + ".", false, "ok");
  }

  // --------------------------------------------------------------- montagem
  function desenhar() {
    $("#nav-abas").innerHTML = ["inicio", "lista", "disciplinas", "calendario", "ajustes"].map(m =>
      `<button type="button" data-nav-modo="${m}">${icone(m, lerEstilo() === "blocos" ? 22 : 26)}<span>${ROTULOS[m]}</span></button>`).join("");
    $("#nav-flutuante").innerHTML = ["inicio", "lista", "disciplinas", "calendario"].map(m =>
      `<button type="button" data-nav-modo="${m}" aria-label="${ROTULOS[m]}" title="${ROTULOS[m]}">${icone(m, lerEstilo() === "blocos" ? 20 : 24)}</button>`).join("") +
      `<span class="sep"></span>` +
      `<button type="button" data-acao="abrir" aria-label="Abrir arquivo da prova" title="Abrir arquivo da prova">${icone("abrir", lerEstilo() === "blocos" ? 20 : 24)}</button>` +
      `<button type="button" data-acao="opcoes" aria-label="Ajustes" title="Ajustes">${icone("ajustes", lerEstilo() === "blocos" ? 20 : 24)}</button>`;
    $("#nav-icones").innerHTML =       // no cabeçalho, sempre em contorno (sobre a cor da barra)
      `<button type="button" data-acao="sinc" aria-label="Sincronizar agora" title="Sincronizar agora">${svg("sinc", 22)}</button>` +
      `<button type="button" data-acao="opcoes" aria-label="Opções" title="Opções">${svg("mais", 22)}</button>`;
    $("#nav-lateral").innerHTML = `<div class="titulo">Logos</div>` +
      ["inicio", "lista", "disciplinas", "calendario"].map(m => `<button type="button" data-nav-modo="${m}">${icone(m)}${ROTULOS[m]}</button>`).join("") +
      `<div class="sep"></div>` +
      `<button type="button" data-acao="abrir">${icone("abrir")}Abrir arquivo da prova</button>` +
      `<button type="button" class="pe" data-nav-modo="ajustes">${icone("ajustes")}Ajustes</button>`;   // no pé, como as Opções do Word
    for (const s of document.querySelectorAll(".op-ic[data-ic]")) s.innerHTML = icone(s.dataset.ic);

    for (const b of document.querySelectorAll("[data-nav-modo]"))
      b.onclick = () => b.dataset.navModo === "ajustes" ? abrirOpcoes() : irModo(b.dataset.navModo);
    for (const b of document.querySelectorAll("[data-acao]")) b.onclick = () => {
      const a = b.dataset.acao;
      if (a === "opcoes") abrirOpcoes();
      else if (a === "abrir") { fecharOpcoes(); $("#abrir").click(); }
      else if (a === "sinc") window.Sincronia && Sincronia.ligada() ? Sincronia.sincronizar(false) : abrirOpcoes();
    };
    marcar();
  }

  function montar() {
    desenhar();
    for (const b of document.querySelectorAll(".nav-gaveta-botao")) b.onclick = () => document.body.classList.toggle("gaveta-aberta");
    $("#nav-lateral-fundo").onclick = fecharOpcoes;
    $("#opcoes-folha").onclick = (e) => { if (e.target.id === "opcoes-folha") fecharOpcoes(); };
    $("#opcoes-fechar").onclick = fecharOpcoes;
    $("#exibicao").onclick = escolherExibicao;
    $("#icones-estilo").onclick = escolherIcones;

    // no formato "ícones no alto", o estado da sincronização aparece sob o título
    const quem = $("#gh-quem"), sub = $("#provas-sub");
    const copiar = () => { sub.textContent = lerFormato() === "icones" && window.Sincronia && Sincronia.ligada() ? quem.textContent : ""; };
    new MutationObserver(copiar).observe(quem, { childList: true, characterData: true, subtree: true });
    window.addEventListener("nav-mudou", copiar);
    copiar();
  }

  function aplicar() {
    const f = lerFormato();
    document.body.dataset.nav = f;
    document.body.dataset.icones = lerEstilo();
    if (COM_TELA_AJUSTES.includes(f)) fecharOpcoes();
    $("#exibicao-atual").textContent = NOMES[f];
    $("#icones-atual").textContent = ESTILOS[lerEstilo()];
    window.dispatchEvent(new Event("nav-mudou"));
    marcar();
  }

  window.Navegacao = { marcar, fecharOpcoes, irModo };
  window.addEventListener("load", () => { montar(); aplicar(); });
})();
