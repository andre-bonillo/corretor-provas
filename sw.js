// Guarda a página e os modelos no aparelho, para funcionar sem internet.
const VERSAO = "corretor-v4";
const ARQUIVOS = ["./", "index.html", "app.js", "leitura.js", "identificacao.js", "ao_vivo.js", "onedrive.js", "nuvem.js", "manifest.webmanifest", "icone.png",
  "vendor/ort.wasm.min.js", "vendor/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.wasm",
  "modelos/mnist-12.onnx", "modelos/latin_PP-OCRv5_rec_mobile.onnx", "modelos/ppocrv5_latin_dict.txt"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// rede primeiro (pega atualizações); sem rede, usa a cópia guardada
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;   // login e OneDrive: sempre pela rede
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(VERSAO).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
