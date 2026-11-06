// Leitura da folha de respostas: tradução do corrigir.py (localizar, endireitar e ler as marcações).
// Código próprio, sem bibliotecas: imagens em tons de cinza como {w, h, d} (d = Uint8Array ou Float32Array).
"use strict";

const PX_MM = 10;
const LIMIAR_MARCA = 0.38;
const LIMIAR_DUVIDA = 0.18;

// ---------------------------------------------------------------------------
// Utilidades de imagem
// ---------------------------------------------------------------------------

function img(w, h, tipo = Uint8Array, valor = 0) {
  const d = new tipo(w * h);
  if (valor) d.fill(valor);
  return { w, h, d };
}

// Redimensiona por média de área (redução) ou bilinear (ampliação), como cv2.INTER_AREA.
function redimensionar(src, nw, nh) {
  const { w, h, d } = src;
  if (nw === w && nh === h) return { w, h, d: Float32Array.from(d) };
  if (nw > w || nh > h) return bilinear(src, nw, nh);
  // horizontal
  const tmp = new Float32Array(nw * h);
  const sx = w / nw;
  for (let x = 0; x < nw; x++) {
    const a = x * sx, b = a + sx;
    const i0 = Math.floor(a), i1 = Math.min(w, Math.ceil(b));
    for (let y = 0; y < h; y++) {
      let s = 0, row = y * w;
      for (let i = i0; i < i1; i++) {
        const peso = Math.min(b, i + 1) - Math.max(a, i);
        s += d[row + i] * peso;
      }
      tmp[y * nw + x] = s / sx;
    }
  }
  const out = new Float32Array(nw * nh);
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const a = y * sy, b = a + sy;
    const j0 = Math.floor(a), j1 = Math.min(h, Math.ceil(b));
    for (let x = 0; x < nw; x++) {
      let s = 0;
      for (let j = j0; j < j1; j++) {
        const peso = Math.min(b, j + 1) - Math.max(a, j);
        s += tmp[j * nw + x] * peso;
      }
      out[y * nw + x] = s / sy;
    }
  }
  return { w: nw, h: nh, d: out };
}

function bilinear(src, nw, nh) {
  const { w, h, d } = src;
  const out = new Float32Array(nw * nh);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    let fy = (y + 0.5) * sy - 0.5;
    fy = Math.max(0, Math.min(h - 1, fy));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < nw; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      fx = Math.max(0, Math.min(w - 1, fx));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const a = d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx;
      const b = d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx;
      out[y * nw + x] = a * (1 - ty) + b * ty;
    }
  }
  return { w: nw, h: nh, d: out };
}

// Máximo deslizante 1D (van Herk / Gil-Werman), janela k centrada; fora da imagem é ignorado.
function maxDeslizante(linha, n, k, saida) {
  const r = k >> 1;
  const g = new Float32Array(n), hh = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (i % k === 0) ? linha[i] : Math.max(g[i - 1], linha[i]);
  for (let i = n - 1; i >= 0; i--) hh[i] = (i === n - 1 || (i + 1) % k === 0) ? linha[i] : Math.max(hh[i + 1], linha[i]);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r), b = Math.min(n - 1, i + r);
    saida[i] = Math.max(hh[a], g[b]);
  }
}

function dilatar(src, k) {
  const { w, h, d } = src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const lin = new Float32Array(Math.max(w, h)), sai = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) lin[x] = d[y * w + x];
    maxDeslizante(lin, w, k, sai);
    for (let x = 0; x < w; x++) tmp[y * w + x] = sai[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) lin[y] = tmp[y * w + x];
    maxDeslizante(lin, h, k, sai);
    for (let y = 0; y < h; y++) out[y * w + x] = sai[y];
  }
  return { w, h, d: out };
}

// Média em janela k×k (somas acumuladas), com a janela cortada na borda.
function borrar(src, k) {
  const { w, h, d } = src;
  const r = k >> 1;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const acc = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    acc[0] = 0;
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + d[y * w + x];
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r), b = Math.min(w, x + r + 1);
      tmp[y * w + x] = (acc[b] - acc[a]) / (b - a);
    }
  }
  for (let x = 0; x < w; x++) {
    acc[0] = 0;
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r), b = Math.min(h, y + r + 1);
      out[y * w + x] = (acc[b] - acc[a]) / (b - a);
    }
  }
  return { w, h, d: out };
}

// Divide pela iluminação de fundo: devolve a escuridão (0 = papel, 1 = preto).
function normalizar(gray, k) {
  k = Math.max(3, Math.floor(k) | 1);
  const fundo = borrar(dilatar(gray, k), k);
  const out = new Float32Array(gray.w * gray.h);
  for (let i = 0; i < out.length; i++) {
    const v = 1 - gray.d[i] / Math.max(fundo.d[i], 1);
    out[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  return { w: gray.w, h: gray.h, d: out };
}

// Componentes conexos (vizinhança 8) de uma máscara Uint8Array. Devolve rótulos e estatísticas.
function componentes(mask, w, h) {
  const rot = new Int32Array(w * h);
  const pai = [0];
  const achar = (x) => { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
  const unir = (a, b) => { a = achar(a); b = achar(b); if (a !== b) { if (a < b) pai[b] = a; else pai[a] = b; } };
  let prox = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let r = 0;
      const viz = [];
      if (x > 0 && rot[i - 1]) viz.push(rot[i - 1]);
      if (y > 0) {
        if (x > 0 && rot[i - w - 1]) viz.push(rot[i - w - 1]);
        if (rot[i - w]) viz.push(rot[i - w]);
        if (x < w - 1 && rot[i - w + 1]) viz.push(rot[i - w + 1]);
      }
      if (!viz.length) { r = prox++; pai.push(r); }
      else { r = viz[0]; for (let v = 1; v < viz.length; v++) unir(r, viz[v]); }
      rot[i] = r;
    }
  }
  const mapa = new Int32Array(prox);
  let n = 1;
  for (let r = 1; r < prox; r++) { const a = achar(r); if (!mapa[a]) mapa[a] = n++; mapa[r] = mapa[a]; }
  const st = [];
  for (let k = 0; k < n; k++) st.push({ area: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1, sx: 0, sy: 0 });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!rot[i]) continue;
    const k = mapa[rot[i]];
    rot[i] = k;
    const s = st[k];
    s.area++; s.sx += x; s.sy += y;
    if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
    if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
  }
  return { n, rot, st };
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

function cascoConvexo(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inf = [], sup = [];
  for (const q of p) { while (inf.length >= 2 && cruz(inf[inf.length - 2], inf[inf.length - 1], q) <= 0) inf.pop(); inf.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (sup.length >= 2 && cruz(sup[sup.length - 2], sup[sup.length - 1], q) <= 0) sup.pop(); sup.push(q); }
  sup.pop(); inf.pop();
  return inf.concat(sup);
}

function areaPoligono(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

// Menor retângulo (área) que contém o casco convexo.
function retanguloMinimo(casco) {
  if (casco.length < 3) return 0;
  let melhor = Infinity;
  for (let i = 0; i < casco.length; i++) {
    const a = casco[i], b = casco[(i + 1) % casco.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!L) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let mn1 = Infinity, mx1 = -Infinity, mn2 = Infinity, mx2 = -Infinity;
    for (const p of casco) {
      const t = p[0] * ux + p[1] * uy, s = -p[0] * uy + p[1] * ux;
      mn1 = Math.min(mn1, t); mx1 = Math.max(mx1, t); mn2 = Math.min(mn2, s); mx2 = Math.max(mx2, s);
    }
    melhor = Math.min(melhor, (mx1 - mn1) * (mx2 - mn2));
  }
  return melhor;
}

// Homografia que leva 4 pontos src em 4 pontos dst (matriz 3×3 em lista de 9).
function homografia(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const piv = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / piv;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function mapear(M, p) {
  const [x, y] = p;
  const z = M[6] * x + M[7] * y + M[8];
  return [(M[0] * x + M[1] * y + M[2]) / z, (M[3] * x + M[4] * y + M[5]) / z];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------------------
// Código da prova (igual ao folha.py)
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function verificacao(valor16) { return ((crc32([(valor16 >> 8) & 0xFF, valor16 & 0xFF]) ^ 0x5) & 0xF); }

function decodificar(bits) {
  if (bits.length !== 20 || bits.every(Boolean) || !bits.some(Boolean)) return null;
  let valor = 0; for (const b of bits.slice(0, 16)) valor = (valor << 1) | b;
  let chk = 0; for (const b of bits.slice(16)) chk = (chk << 1) | b;
  if (chk !== verificacao(valor)) return null;
  return [valor >> 4, valor & 0xF];
}

// ---------------------------------------------------------------------------
// Localização
// ---------------------------------------------------------------------------

function candidatosMarcador(escuro) {
  const { w, h, d } = escuro;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i] > 0.4 ? 1 : 0;
  const { n, rot, st } = componentes(mask, w, h);
  const cands = [];
  for (let k = 1; k < n; k++) {
    const s = st[k];
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
    if (s.area < 40 || bw < 6 || bh < 6) continue;
    if (!(bw / bh > 0.55 && bw / bh < 1.8)) continue;
    // contorno: extremos de cada linha (centros dos pixels)
    const pts = [];
    for (let y = s.y0; y <= s.y1; y++) {
      let a = -1, b = -1;
      for (let x = s.x0; x <= s.x1; x++) if (rot[y * w + x] === k) { if (a < 0) a = x; b = x; }
      if (a >= 0) { pts.push([a, y]); if (b !== a) pts.push([b, y]); }
    }
    const casco = cascoConvexo(pts);
    const ret = retanguloMinimo(casco);
    if (ret <= 0) continue;
    const extensao = s.area / ret;
    const solidez = s.area / Math.max(areaPoligono(casco), 1);
    if (extensao < 0.86 || solidez < 0.93) continue;
    cands.push({ c: [s.sx / s.area, s.sy / s.area], lado: Math.sqrt(s.area) });
  }
  return cands;
}

function ordenarQuad(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const p = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let ini = 0;
  for (let i = 1; i < p.length; i++) if (p[i][0] + p[i][1] < p[ini][0] + p[ini][1]) ini = i;
  return p.slice(ini).concat(p.slice(0, ini));
}

function convexo(q) {
  let sinal = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (z !== 0) { if (sinal && Math.sign(z) !== sinal) return false; sinal = Math.sign(z); }
  }
  return true;
}

function quadrilateros(cands) {
  const vistos = new Set(), saida = [];
  const ordem = cands.slice().sort((a, b) => b.lado - a.lado);
  for (const ref of ordem) {
    const s = ref.lado;
    const grupo = cands.filter(c => c.lado >= 0.72 * s && c.lado <= 1.38 * s);
    if (grupo.length < 4) continue;
    const casco = cascoConvexo(grupo.map(c => c.c)).slice(0, 12);
    const m = casco.length;
    for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) for (let c = b + 1; c < m; c++) for (let e = c + 1; e < m; e++) {
      const q = ordenarQuad([casco[a], casco[b], casco[c], casco[e]]);
      const chave = q.map(p => Math.round(p[0]) + "," + Math.round(p[1])).join(";");
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const lados = [0, 1, 2, 3].map(i => dist(q[(i + 1) % 4], q[i]));
      if (Math.min(...lados) < 5 * s) continue;  // como no corrigir.py
      let ok = true;
      for (let i = 0; i < 4; i++) {
        const p0 = q[(i + 3) % 4], p1 = q[i], p2 = q[(i + 1) % 4];
        const ax = p0[0] - p1[0], ay = p0[1] - p1[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
        const cos = Math.abs((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)));
        ok = ok && cos < 0.45;
      }
      if (ok && convexo(q)) saida.push({ area: areaPoligono(q), q, s });
    }
  }
  saida.sort((a, b) => b.area - a.area);
  return saida;
}

function escuridaoMedia(escuro, M, centro, meio) {
  const { w, h, d } = escuro;
  let soma = 0, n = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const dx = -meio + (2 * meio * i) / 4, dy = -meio + (2 * meio * j) / 4;
    const [x, y] = mapear(M, [centro[0] + dx, centro[1] + dy]);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
    soma += d[yi * w + xi]; n++;
  }
  return soma / n;
}

function posicoesBits(largura, K) {
  const ini = largura / 2 - (K.BITS - 1) * 3.7 / 2;
  const out = [];
  for (let i = 0; i < K.BITS; i++) out.push([ini + i * 3.7, K.centro_marcador]);
  return out;
}

function lerCodigo(escuro, quad, pacote) {
  const K = pacote.constantes, c = K.centro_marcador;
  let reserva = null;
  for (let r = 0; r < 4; r++) {
    const q = quad.slice(r).concat(quad.slice(0, r));
    const largImg = (dist(q[1], q[0]) + dist(q[2], q[3])) / 2;
    const altImg = (dist(q[3], q[0]) + dist(q[2], q[1])) / 2;
    for (const largura of [95, 195]) {
      const dmm = largura - 2 * c, amm = dmm * altImg / largImg;
      const M = homografia([[c, c], [c + dmm, c], [c + dmm, c + amm], [c, c + amm]], q);
      const bits = posicoesBits(largura, K).map(p => escuridaoMedia(escuro, M, p, K.BIT * 0.3) > 0.5 ? 1 : 0);
      const dec = decodificar(bits);
      if (!dec) continue;
      if (dec[0] === pacote.hash && Math.abs(pacote.geo.largura - largura) < 0.01) return { hash: dec[0], indice: dec[1], q };
      reserva = reserva || { hash: dec[0], indice: dec[1], q };
    }
  }
  return reserva;
}

function localizar(gray, pacote) {
  const escala = Math.min(1, 2400 / Math.max(gray.w, gray.h));
  const peq = escala < 1 ? redimensionar(gray, Math.round(gray.w * escala), Math.round(gray.h * escala)) : gray;
  const escuro = normalizar(peq, Math.max(peq.w, peq.h) / 12);
  const cands = candidatosMarcador(escuro);
  const quads = quadrilateros(cands);
  for (let t = 0; t < quads.length && t <= 60; t++) {
    const { q, s: lado } = quads[t];
    const lido = lerCodigo(escuro, q, pacote);
    if (!lido) continue;
    if (lido.hash !== pacote.hash)
      return { erro: "Esta folha é de outra prova (ou de uma versão gerada de novo depois de impressa). Abra o arquivo da prova certa." };
    const geo = pacote.geo, c = pacote.constantes.centro_marcador, W = geo.largura;
    const M = homografia(geo.cantos, lido.q);
    const esq = [lido.q[0]], dir = [lido.q[1]];
    for (const y of geo.laterais) {
      for (const [x, lista] of [[c, esq], [W - c, dir]]) {
        const prev = mapear(M, [x, y]);
        const perto = cands.filter(k => Math.abs(k.lado - lado) < 0.4 * lado && dist(k.c, prev) < 1.2 * lado);
        if (perto.length) { perto.sort((a, b) => dist(a.c, prev) - dist(b.c, prev)); lista.push(perto[0].c); }
        else lista.push(prev);
      }
    }
    esq.push(lido.q[3]); dir.push(lido.q[2]);
    return { indice: lido.indice, esq: esq.map(p => [p[0] / escala, p[1] / escala]), dir: dir.map(p => [p[0] / escala, p[1] / escala]) };
  }
  return null;
}

// Folha retificada (PX_MM px/mm), faixa por faixa entre os marcadores laterais.
function endireitar(gray, loc, geo, c) {
  const W = geo.largura, H = geo.altura;
  const ys = [geo.cantos[0][1], ...geo.laterais, geo.cantos[3][1]];
  const tw = Math.round(W * PX_MM), th = Math.round(H * PX_MM);
  const out = img(tw, th, Uint8Array, 255);
  const { w, h, d } = gray;
  for (let i = 0; i < ys.length - 1; i++) {
    const src = [[c * PX_MM, ys[i] * PX_MM], [(W - c) * PX_MM, ys[i] * PX_MM], [(W - c) * PX_MM, ys[i + 1] * PX_MM], [c * PX_MM, ys[i + 1] * PX_MM]];
    const dst = [loc.esq[i], loc.dir[i], loc.dir[i + 1], loc.esq[i + 1]];
    const M = homografia(src, dst);
    const y0 = i === 0 ? 0 : Math.round(ys[i] * PX_MM);
    const y1 = i === ys.length - 2 ? th : Math.round(ys[i + 1] * PX_MM);
    for (let y = y0; y < y1; y++) for (let x = 0; x < tw; x++) {
      const z = M[6] * x + M[7] * y + M[8];
      const fx = (M[0] * x + M[1] * y + M[2]) / z, fy = (M[3] * x + M[4] * y + M[5]) / z;
      const x0 = Math.floor(fx), y0_ = Math.floor(fy);
      if (x0 < 0 || y0_ < 0 || x0 + 1 >= w || y0_ + 1 >= h) continue;
      const tx = fx - x0, ty = fy - y0_, k = y0_ * w + x0;
      const v = (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + w] * (1 - tx) + d[k + w + 1] * tx) * ty;
      out.d[y * tw + x] = Math.round(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Marcações
// ---------------------------------------------------------------------------

function preenchimento(escuro, ref, xmm, ymm, raio) {
  const r = Math.floor(raio * 0.6 * PX_MM);
  const cx = Math.round(xmm * PX_MM), cy = Math.round(ymm * PX_MM);
  const { w, h, d } = escuro;
  let melhor = 0, centro = 0;
  for (const dx of [-6, -3, 0, 3, 6]) for (const dy of [-6, -3, 0, 3, 6]) {
    const x0 = cx + dx - r, y0 = cy + dy - r;
    if (x0 < 0 || y0 < 0 || x0 + 2 * r + 1 > w || y0 + 2 * r + 1 > h) continue;
    let s = 0, n = 0;
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      if (xx * xx + yy * yy > r * r) continue;
      s += d[(y0 + r + yy) * w + x0 + r + xx]; n++;
    }
    const v = s / n;
    if (dx === 0 && dy === 0) centro = v;
    melhor = Math.max(melhor, v);
  }
  return Math.min(1, (centro > LIMIAR_DUVIDA * ref * 0.5 ? melhor : centro) / ref);
}

function classificar(valores, opcoes) {
  const marcadas = opcoes.filter((o, i) => valores[i] >= LIMIAR_MARCA);
  const duvidas = opcoes.filter((o, i) => valores[i] >= LIMIAR_DUVIDA && valores[i] < LIMIAR_MARCA);
  if (marcadas.length > 1) return [marcadas.join("+"), "múltipla"];
  if (marcadas.length === 1) return [marcadas[0], duvidas.length ? "dúvida" : ""];
  if (duvidas.length) return ["?", "dúvida"];
  return ["", ""];
}

function recorte(im, x0, y0, x1, y1) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(im.w, x1); y1 = Math.min(im.h, y1);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  const d = new im.d.constructor(w * h);
  for (let y = 0; y < h; y++) d.set(im.d.subarray((y0 + y) * im.w + x0, (y0 + y) * im.w + x0 + w), y * w);
  return { w, h, d };
}

// Lê a folha: devolve as marcações e os recortes do R.A. e do nome (para os modelos de escrita).
function lerFolha(gray, loc, pacote) {
  const geo = pacote.geo, K = pacote.constantes;
  const reta = endireitar(gray, loc, geo, K.centro_marcador);
  const escuro = normalizar(reta, 8 * PX_MM);
  const m = Math.floor(K.MARCADOR * 0.3 * PX_MM);
  const refs = geo.cantos.map(([x, y]) => {
    const r = recorte(escuro, Math.floor(x * PX_MM) - m, Math.floor(y * PX_MM) - m, Math.floor(x * PX_MM) + m, Math.floor(y * PX_MM) + m);
    return r.d.reduce((a, b) => a + b, 0) / Math.max(1, r.d.length);
  }).sort((a, b) => a - b);
  const ref = Math.max((refs[1] + refs[2]) / 2, 0.3);

  const marcado = geo.ra.length ? [] : geo.ra_caixas.map(() => "");
  const raMarcas = [];
  for (const coluna of geo.ra) {
    const vals = coluna.map(([x, y]) => preenchimento(escuro, ref, x, y, K.RAIO_RA));
    const [resp, sit] = classificar(vals, "0123456789".split(""));
    raMarcas.push({ coluna, vals });
    marcado.push(sit === "múltipla" ? "*" : (sit === "dúvida" && resp !== "?" ? "?" : resp));
  }
  const respostas = geo.questoes.map(q => {
    const vals = q.centros.map(([x, y]) => preenchimento(escuro, ref, x, y, K.RAIO));
    const [resp, sit] = classificar(vals, q.opcoes);
    return { n: q.n, resp, sit, vals, q };
  });
  const notas = (geo.notas || []).map(nq => {
    const partes = [], marcas = [];
    let sit = "";
    for (const g of nq.grupos) {
      const vals = g.centros.map(([x, y]) => preenchimento(escuro, ref, x, y, K.RAIO));
      marcas.push({ centros: g.centros, vals });
      const [resp, s] = classificar(vals, vals.map((_, i) => String(i)));
      if (s === "múltipla") sit = "duas notas marcadas";
      else if (resp === "?" || s === "dúvida") sit = sit || "marca fraca";
      partes.push(/^\d+$/.test(resp) ? g.valores[+resp] : null);
    }
    let valor;
    if (partes.every(v => v === null)) { valor = null; sit = sit || "sem nota"; }
    else {
      valor = Math.round(partes.reduce((a, v) => a + (v || 0), 0) * 100) / 100;
      if (valor > nq.max + 1e-9) sit = sit || "nota acima do valor da questão";
    }
    return { n: nq.n, valor: sit && sit !== "marca fraca" ? null : valor, sit, marcas };
  });
  // quadrinhos do R.A. (escuridão, para o modelo de dígitos)
  const caixasRA = geo.ra_caixas.map(([x0, y0, x1, y1]) => {
    const mm = 0.5;
    return recorte(escuro, Math.floor((x0 + mm) * PX_MM), Math.floor((y0 + mm) * PX_MM), Math.floor((x1 - mm) * PX_MM), Math.floor((y1 - mm) * PX_MM));
  });
  const [nx0, ny0, nx1, ny1] = geo.nome_caixa;
  const nome = recorte(reta, Math.floor((nx0 + 0.5) * PX_MM), Math.floor((ny0 + 0.5) * PX_MM), Math.floor((nx1 - 0.5) * PX_MM), Math.floor((ny1 - 0.5) * PX_MM));
  const nomeEscrito = { w: nome.w, h: nome.h, d: Uint8Array.from(nome.d) };
  for (let y = 0; y < Math.min(nome.h, Math.floor(2.6 * PX_MM)); y++)
    for (let x = 0; x < Math.min(nome.w, Math.floor(9 * PX_MM)); x++) nomeEscrito.d[y * nome.w + x] = 255;
  return { reta, marcado, raMarcas, respostas, notas, caixasRA, nomeEscrito };
}

// ---------------------------------------------------------------------------
// Dígito escrito: prepara a entrada 28×28 do modelo (igual ao corrigir.ler_digito)
// ---------------------------------------------------------------------------

function prepararDigito(reg) {
  const { w, h, d } = reg;
  if (!w || !h) return null;
  const tinta = new Uint8Array(w * h);
  for (let i = 0; i < tinta.length; i++) tinta[i] = d[i] > 0.30 ? 1 : 0;
  const { n, rot, st } = componentes(tinta, w, h);
  const manter = new Uint8Array(w * h);
  let total = 0;
  for (let i = 0; i < manter.length; i++) if (rot[i] && st[rot[i]].area >= 6) { manter[i] = 1; total++; }
  if (total < 0.03 * manter.length) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (manter[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const dw = x1 - x0 + 1, dh = y1 - y0 + 1;
  const dig = new Float32Array(dw * dh);
  let mx = 0;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const i = (y0 + y) * w + x0 + x;
    const v = d[i] * manter[i];
    dig[y * dw + x] = v; if (v > mx) mx = v;
  }
  mx = Math.max(mx, 1e-3);
  for (let i = 0; i < dig.length; i++) dig[i] = Math.min(1, Math.max(0, dig[i] / mx));
  const s = 20 / Math.max(dw, dh);
  const nw = Math.max(1, Math.round(dw * s)), nh = Math.max(1, Math.round(dh * s));
  const r = redimensionar({ w: dw, h: dh, d: dig }, nw, nh);
  let m00 = 0, m10 = 0, m01 = 0;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const v = r.d[y * nw + x]; m00 += v; m10 += x * v; m01 += y * v; }
  const cy = m00 ? m01 / m00 : nh / 2, cx = m00 ? m10 / m00 : nw / 2;
  const oy = Math.min(Math.max(Math.round(14 - cy), 0), 28 - nh), ox = Math.min(Math.max(Math.round(14 - cx), 0), 28 - nw);
  const tela = new Float32Array(28 * 28);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) tela[(oy + y) * 28 + ox + x] = r.d[y * nw + x];
  return tela;
}

// Nome escrito: recorta a escrita e prepara a entrada do modelo de texto (altura 48), como nomes.log_probs.
function prepararNome(gray) {
  const { w, h, d } = gray;
  if (!w || !h) return null;
  const fundo = dilatar(gray, 25);
  const tinta = new Uint8Array(w * h);
  for (let i = 0; i < tinta.length; i++) tinta[i] = d[i] < fundo.d[i] * 0.65 ? 1 : 0;
  const { rot, st } = componentes(tinta, w, h);
  let total = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (rot[i] && st[rot[i]].area >= 8) {
      total++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (total < 0.004 * w * h) return null;
  const m = Math.max(4, Math.floor(0.15 * (y1 - y0)));
  const corte = recorte(gray, Math.max(0, x0 - 2 * m), Math.max(0, y0 - m), Math.min(w, x1 + 2 * m + 1), Math.min(h, y1 + m + 1));
  const W = Math.max(48, Math.round(48 * corte.w / corte.h));
  const r = redimensionar(corte, W, 48);
  const t = new Float32Array(3 * 48 * W);
  for (let i = 0; i < 48 * W; i++) { const v = (r.d[i] / 255 - 0.5) / 0.5; t[i] = v; t[48 * W + i] = v; t[2 * 48 * W + i] = v; }
  return { dados: t, largura: W };
}

window.Leitura = { PX_MM, LIMIAR_MARCA, LIMIAR_DUVIDA, localizar, lerFolha, prepararDigito, prepararNome, recorte };
