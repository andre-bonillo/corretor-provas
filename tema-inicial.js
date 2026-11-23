// Aplica o tema e a cor guardados antes de a página aparecer (evita piscar no tema errado).
"use strict";
{ const q = new URLSearchParams(location.search), h = document.documentElement; let t = null, c = null;
  try { t = localStorage.getItem("tema"); c = localStorage.getItem("cor"); } catch (e) {}
  h.dataset.tema = q.get("tema") || t || "vidro";
  // Vidro automático (padrão): Oceano das 6h às 18h, Meia-noite no resto do tempo
  let cor = q.get("cor") || c || "auto";
  if (cor === "auto") { const hr = new Date().getHours(); cor = hr >= 6 && hr < 18 ? "oceano" : "meia-noite"; }
  if (cor !== "violeta") h.dataset.cor = cor; }

// Tamanho do texto: acompanha o ajuste do iPhone/iPad (Ajustes › Tela e Brilho › Tamanho do Texto).
// O app só aumenta (até 30%), nunca diminui. ?texto=1.2 na URL simula, para testar no computador.
{ let fator = 1;
  const q = new URLSearchParams(location.search).get("texto");
  if (q) fator = parseFloat(q) || 1;
  else if (window.CSS && CSS.supports && CSS.supports("font", "-apple-system-body")) {
    const m = document.createElement("span");
    m.style.cssText = "font: -apple-system-body; position: absolute; visibility: hidden";
    m.textContent = "x";
    document.documentElement.appendChild(m);
    fator = parseFloat(getComputedStyle(m).fontSize) / 17;   // 17 px é o tamanho padrão do iOS
    m.remove();
  }
  fator = Math.min(1.3, Math.max(1, fator || 1));
  if (fator > 1.02) document.documentElement.style.zoom = String(Math.round(fator * 100) / 100);
}
