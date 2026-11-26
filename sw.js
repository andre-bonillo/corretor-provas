// Guarda a página e os modelos no aparelho, para funcionar sem internet e abrir rápido com sinal fraco.
const VERSAO = "corretor-v30";
// Arquivos leves do app: mudam a cada versão.
const ARQUIVOS = ["./", "index.html", "tema-inicial.js", "app.js", "leitura.js", "identificacao.js", "ao_vivo.js", "onedrive.js", "nuvem.js", "github.js", "inicio.js", "turmas.js", "navegacao.js", "manifest.webmanifest", "icone.png", "icone-180.png"];
// Arquivos pesados (biblioteca e modelos de leitura, uns 23 MB): quase nunca mudam. Ficam num cache próprio,
// que não é apagado a cada versão nova do app. SE UM DELES MUDAR, troque o nome abaixo (pesados-2, pesados-3…).
const PESADOS = "corretor-pesados-1";
const ARQUIVOS_PESADOS = ["vendor/ort.wasm.min.js", "vendor/ort-wasm-simd-threaded.mjs", "vendor/ort-wasm-simd-threaded.wasm",
  "modelos/mnist-12.onnx", "modelos/latin_PP-OCRv5_rec_mobile.onnx", "modelos/ppocrv5_latin_dict.txt"];
const ESPERA_REDE = 3000;   // com sinal fraco, depois de 3 s usa a cópia guardada

const ehPesado = (url) => /\/(vendor|modelos)\//.test(new URL(url).pathname);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    await c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: "reload" })));
    // os pesados: só baixa o que ainda não está guardado; uma falha aqui não impede a instalação
    const p = await caches.open(PESADOS);
    await Promise.all(ARQUIVOS_PESADOS.map(async (u) => {
      try {
        if (await p.match(u)) return;
        const antigo = await caches.match(u);                      // já guardado por uma versão anterior: reaproveita
        if (antigo) await p.put(u, antigo); else await p.add(new Request(u, { cache: "reload" }));
      } catch (err) {}
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO && k !== PESADOS).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;   // GitHub, login e OneDrive: sempre pela rede

  // pesados: a cópia guardada primeiro; só vai à rede se ainda não tiver
  if (ehPesado(e.request.url)) {
    e.respondWith(caches.open(PESADOS).then(async (p) => {
      const guardado = await p.match(e.request, { ignoreSearch: true });
      if (guardado) return guardado;
      const r = await fetch(e.request);
      if (r.ok) p.put(e.request, r.clone());
      return r;
    }));
    return;
  }

  // leves: rede primeiro (pega atualizações), mas no máximo 3 s; depois, a cópia guardada.
  // "no-cache": sempre pergunta ao servidor se o arquivo mudou, sem esperar os 10 minutos de cache do GitHub Pages.
  e.respondWith((async () => {
    const guardado = await caches.match(e.request, { ignoreSearch: true });
    const daRede = fetch(e.request.url, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); }
      return r;
    });
    if (!guardado) return daRede;                                   // primeira vez: espera a rede
    daRede.catch(() => {});                                         // a rede pode falhar depois; a cópia já basta
    const limite = new Promise((ok) => setTimeout(() => ok(guardado), ESPERA_REDE));
    try {
      const r = await Promise.race([daRede, limite]);
      return r.ok ? r : guardado;
    } catch (err) {
      return guardado;                                              // sem internet
    }
  })());
});
