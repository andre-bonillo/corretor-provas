// Aplica o tema e a cor guardados antes de a página aparecer (evita piscar no tema errado).
"use strict";
{ const q = new URLSearchParams(location.search), h = document.documentElement; let t = null, c = null;
  try { t = localStorage.getItem("tema"); c = localStorage.getItem("cor"); } catch (e) {}
  h.dataset.tema = q.get("tema") || t || "vidro";
  // Vidro automático (padrão): Oceano das 6h às 18h, Meia-noite no resto do tempo
  let cor = q.get("cor") || c || "auto";
  if (cor === "auto") { const hr = new Date().getHours(); cor = hr >= 6 && hr < 18 ? "oceano" : "meia-noite"; }
  if (cor !== "violeta") h.dataset.cor = cor; }
