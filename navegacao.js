// Navegação da tela inicial, em quatro formatos escolhidos em Ajustes › Exibição do menu
// (a escolha fica no aparelho; ?nav=… na URL só mostra a prévia):
//   abas       barra de abas embaixo: Provas, Disciplinas, Calendário, Ajustes
//   lateral    menu lateral à esquerda (como no Word para iPad): fixo em telas largas (iPad deitado),
//              gaveta pelo botão ☰ no iPhone e no iPad em pé
//   icones     ícones no cabeçalho: sincronizar e "⋯" (opções por baixo); Provas/Disciplinas/Calendário no alto
//   flutuante  cápsula flutuante embaixo: Provas, Disciplinas, Calendário, Abrir arquivo, Ajustes
// As opções (abrir arquivo, sincronização, aparência, exibição) ficam em #opcoes: na tela Ajustes
// (abas e lateral) ou numa folha que sobe de baixo (ícones e flutuante).
"use strict";

(() => {
  const CHAVE = "corretor-nav";
  const NOMES = { abas: "Abas embaixo", lateral: "Menu lateral", icones: "Ícones no alto", flutuante: "Barra flutuante" };
  const FORMATOS = Object.keys(NOMES);
  const COM_TELA_AJUSTES = ["abas", "lateral"];
  const $ = (s) => document.querySelector(s);
  const ic = {
    lista: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    disciplinas: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
    calendario: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    abrir: '<path d="M4 7h6l2 2h8v10H4z"/><path d="M12 12v5M9.5 14.5L12 12l2.5 2.5"/>',
    sinc: '<path d="M20 11a8 8 0 00-14.5-4.5L4 8M4 13a8 8 0 0014.5 4.5L20 16"/><path d="M4 4v4h4M20 20v-4h-4"/>',
    mais: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  };
  const svg = (n, t = 24) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[n]}</svg>`;
  const ROTULOS = { lista: "Provas", disciplinas: "Disciplinas", calendario: "Calendário", ajustes: "Ajustes" };

  let previa = new URLSearchParams(location.search).get("nav");
  if (!FORMATOS.includes(previa)) previa = null;
  const lerFormato = () => { if (previa) return previa; try { const f = localStorage.getItem(CHAVE); return FORMATOS.includes(f) ? f : "abas"; } catch (e) { return "abas"; } };
  const gravarFormato = (f) => { previa = null; try { localStorage.setItem(CHAVE, f); } catch (e) {} };

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

  async function escolherExibicao() {
    const atual = lerFormato();
    const r = await perguntar("Exibição do menu", "Como o menu aparece neste aparelho. O menu lateral fica fixo à esquerda no iPad deitado; no iPhone, abre pelo botão ☰.",
      FORMATOS.map(f => ({ rotulo: (f === atual ? "✓ " : "") + NOMES[f], valor: f })));
    if (!r || r === atual) return;
    gravarFormato(r);
    fecharOpcoes();
    aplicar();
    if (COM_TELA_AJUSTES.includes(r)) irPara("ajustes");
    status("Menu: " + NOMES[r].toLowerCase() + ".", false, "ok");
  }

  // --------------------------------------------------------------- montagem
  function montar() {
    $("#nav-abas").innerHTML = ["lista", "disciplinas", "calendario", "ajustes"].map(m =>
      `<button type="button" data-nav-modo="${m}">${svg(m, 26)}<span>${ROTULOS[m]}</span></button>`).join("");
    $("#nav-flutuante").innerHTML = ["lista", "disciplinas", "calendario"].map(m =>
      `<button type="button" data-nav-modo="${m}" aria-label="${ROTULOS[m]}" title="${ROTULOS[m]}">${svg(m)}</button>`).join("") +
      `<span class="sep"></span>` +
      `<button type="button" data-acao="abrir" aria-label="Abrir arquivo da prova" title="Abrir arquivo da prova">${svg("abrir")}</button>` +
      `<button type="button" data-acao="opcoes" aria-label="Ajustes" title="Ajustes">${svg("ajustes")}</button>`;
    $("#nav-icones").innerHTML =
      `<button type="button" data-acao="sinc" aria-label="Sincronizar agora" title="Sincronizar agora">${svg("sinc", 22)}</button>` +
      `<button type="button" data-acao="opcoes" aria-label="Opções" title="Opções">${svg("mais", 22)}</button>`;
    $("#nav-lateral").innerHTML = `<div class="titulo">Corretor</div>` +
      ["lista", "disciplinas", "calendario"].map(m => `<button type="button" data-nav-modo="${m}">${svg(m)}${ROTULOS[m]}</button>`).join("") +
      `<div class="sep"></div>` +
      `<button type="button" data-acao="abrir">${svg("abrir")}Abrir arquivo da prova</button>` +
      `<button type="button" class="pe" data-nav-modo="ajustes">${svg("ajustes")}Ajustes</button>`;   // no pé, como as Opções do Word

    for (const b of document.querySelectorAll("[data-nav-modo]"))
      b.onclick = () => b.dataset.navModo === "ajustes" ? abrirOpcoes() : irModo(b.dataset.navModo);
    for (const b of document.querySelectorAll("[data-acao]")) b.onclick = () => {
      const a = b.dataset.acao;
      if (a === "opcoes") abrirOpcoes();
      else if (a === "abrir") { fecharOpcoes(); $("#abrir").click(); }
      else if (a === "sinc") window.Sincronia && Sincronia.ligada() ? Sincronia.sincronizar(false) : abrirOpcoes();
    };
    for (const b of document.querySelectorAll(".nav-gaveta-botao")) b.onclick = () => document.body.classList.toggle("gaveta-aberta");
    $("#nav-lateral-fundo").onclick = fecharOpcoes;
    $("#opcoes-folha").onclick = (e) => { if (e.target.id === "opcoes-folha") fecharOpcoes(); };
    $("#opcoes-fechar").onclick = fecharOpcoes;
    $("#exibicao").onclick = escolherExibicao;

    // no formato "ícones no alto", o estado da sincronização aparece sob o título
    const quem = $("#gh-quem"), sub = $("#provas-sub");
    const copiar = () => { sub.textContent = lerFormato() === "icones" && window.Sincronia && Sincronia.ligada() ? quem.textContent : "Provas guardadas neste aparelho"; };
    new MutationObserver(copiar).observe(quem, { childList: true, characterData: true, subtree: true });
    window.addEventListener("nav-mudou", copiar);
    copiar();
  }

  function aplicar() {
    const f = lerFormato();
    document.body.dataset.nav = f;
    if (COM_TELA_AJUSTES.includes(f)) fecharOpcoes();
    $("#exibicao-atual").textContent = NOMES[f];
    window.dispatchEvent(new Event("nav-mudou"));
    marcar();
  }

  window.Navegacao = { marcar, fecharOpcoes };
  window.addEventListener("load", () => { montar(); aplicar(); });
})();
