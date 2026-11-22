// Sincronização pelo repositório privado do professor no GitHub (corretor-provas-dados):
//  - provas/      "… - Celular (….json" enviados pelo gerador; a página busca os novos ou refeitos;
//  - resultados/  uma folha corrigida por arquivo (resultados/<hash da prova>/<chave>.json), enviada
//                 por cada aparelho e recebida pelos outros e pelo computador (sincronizar_celular.py).
// A chave da folha vem do nome do aluno (resumo SHA-1, sem o nome no caminho): a mesma folha corrigida
// em dois aparelhos cai no mesmo arquivo, e vale a correção mais recente. Folha apagada vira marca
// {apagada: true}, para sair também dos outros aparelhos. Remover uma prova do aparelho não apaga nada.
// A chave de acesso (Contents: leitura e escrita, só desse repositório) fica só neste aparelho.
"use strict";

(() => {
  const DONO = "andre-bonillo", REPO = "corretor-provas-dados", RAMO = "main";
  const BASE = `https://api.github.com/repos/${DONO}/${REPO}`;
  const CHAVE = "corretor-github", ULTIMA = "corretor-github-ultima";
  const $ = (s) => document.querySelector(s);

  const lerChave = () => { try { return localStorage.getItem(CHAVE) || ""; } catch (e) { return ""; } };
  const gravarChave = (v) => { try { v ? localStorage.setItem(CHAVE, v) : localStorage.removeItem(CHAVE); } catch (e) {} };
  const lerUltima = () => { try { return +localStorage.getItem(ULTIMA) || 0; } catch (e) { return 0; } };
  const caminho = (p) => p.split("/").map(encodeURIComponent).join("/");
  let rodando = false, deNovo = false, semEscrita = false, avisouEscrita = false;

  function erro(msg, extra) { return Object.assign(new Error(msg), extra || {}); }

  async function api(url, opc = {}) {
    const r = await fetch(url, {
      cache: "no-store", method: opc.method || "GET", body: opc.body,
      headers: { Authorization: "Bearer " + lerChave(), "X-GitHub-Api-Version": "2022-11-28",
                 Accept: opc.bruto ? "application/vnd.github.raw" : "application/vnd.github+json",
                 ...(opc.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (r.status === 401) throw erro("a chave do GitHub não vale mais (vencida ou apagada)", { chave: true });
    if (!r.ok) throw erro("o GitHub respondeu " + r.status, { status: r.status });
    return opc.bruto ? r.text() : r.json();
  }

  async function conferirAcesso() {
    try { await api(BASE); }
    catch (e) {
      if (e.status === 404) throw erro(`a chave não dá acesso ao repositório ${REPO}`, { chave: true });
      throw e;
    }
  }

  // Todos os arquivos do repositório numa chamada: [{path, sha}]
  async function arvore() {
    try { return (await api(`${BASE}/git/trees/${RAMO}?recursive=1`)).tree.filter(i => i.type === "blob"); }
    catch (e) { if (e.status === 404 || e.status === 409) { await conferirAcesso(); return []; } throw e; }   // repositório vazio
  }

  function base64(texto) {
    const b = new TextEncoder().encode(texto);
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function enviar(path, obj, sha, msg) {
    const corpo = { message: msg, content: base64(JSON.stringify(obj)), branch: RAMO, ...(sha ? { sha } : {}) };
    const r = await api(`${BASE}/contents/${caminho(path)}`, { method: "PUT", body: JSON.stringify(corpo) });
    return r.content.sha;
  }

  // ---------------------------------------------------------------- folhas
  async function chaveDa(f) {
    if (!f.nome) return "u-" + f.uid;
    const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(Identificacao.normalizarNome(f.nome)));
    return "n-" + [...new Uint8Array(h)].slice(0, 10).map(x => x.toString(16).padStart(2, "0")).join("");
  }
  // a folha recebida guarda o arquivo de onde veio (gh); a corrigida aqui usa a chave calculada
  const caminhoDa = async (f) => f.gh || `resultados/${f.hash}/${await chaveDa(f)}.json`;
  const semId = (f) => { const c = { ...f }; delete c.id; return c; };
  const novaUid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  async function apagadasPendentes() { return (await ler("config", "gh-apagadas").catch(() => null)) || []; }

  window.addEventListener("folha-apagada", async (e) => {
    if (!lerChave()) return;
    const f = e.detail;
    if (!f.nome && !f.uid) return;                       // nunca foi enviada
    const lista = await apagadasPendentes();
    lista.push({ path: await caminhoDa(f), hash: f.hash, quando: new Date().toISOString() });
    await guardar("config", lista, "gh-apagadas");
    agendar();
  });
  window.addEventListener("folhas-mudaram", () => { if (lerChave()) agendar(); });

  let espera = null;
  function agendar() { clearTimeout(espera); espera = setTimeout(() => sincronizar(true), 1500); }

  async function sincronizarFolhas(itens) {
    const hashes = new Set((await todos("pacotes")).map(p => String(p.hash)));   // o hash é número; a pasta, texto
    const res = { recebidas: 0, apagadas: 0, enviadas: 0, conflitos: [], falhas: 0 };
    const remoto = {};
    for (const i of itens) {
      const m = i.path.match(/^resultados\/([^/]+)\/[^/]+\.json$/);
      if (m && hashes.has(m[1])) remoto[i.path] = i.sha;
    }
    // folhas sem nome ganham um identificador fixo (para ter arquivo próprio)
    let locais = (await todos("folhas")).filter(f => hashes.has(String(f.hash)));
    for (const f of locais) if (!f.nome && !f.uid) { f.uid = novaUid(); await guardar("folhas", f); }
    const porCaminho = {};
    for (const f of locais) porCaminho[await caminhoDa(f)] = f;

    // 1. apagadas aqui: marca no GitHub
    let pend = await apagadasPendentes();
    const restantes = [];
    for (const a of pend) {
      if (!hashes.has(String(a.hash)) || !remoto[a.path] || porCaminho[a.path]) continue;   // nunca enviada, ou já há folha nova
      if (semEscrita) { restantes.push(a); continue; }
      try {
        const sha = await enviar(a.path, { hash: a.hash, apagada: true, quando: a.quando }, remoto[a.path], "Folha apagada no celular");
        remoto[a.path] = sha;
        await guardar("config", { sha, quando: a.quando }, "ghf:" + a.path);
      } catch (e) { if (e.status === 403) semEscrita = true; restantes.push(a); res.falhas++; }
    }
    await guardar("config", restantes, "gh-apagadas");
    const apagandoAqui = new Set(restantes.map(a => a.path));

    // 2. recebe o que mudou no GitHub
    for (const [path, sha] of Object.entries(remoto)) {
      const visto = await ler("config", "ghf:" + path).catch(() => null);
      if ((visto && visto.sha === sha) || apagandoAqui.has(path)) continue;
      const r = JSON.parse(await api(`${BASE}/contents/${caminho(path)}`, { bruto: true }));
      const loc = porCaminho[path];
      const mudouAqui = loc && (!visto || visto.quando !== loc.quando);
      if (r.apagada) {
        if (loc && loc.quando <= r.quando) { await apagar("folhas", loc.id); delete porCaminho[path]; res.apagadas++; }
      } else if (!loc) {
        await guardar("folhas", { ...semId(r), gh: path }); res.recebidas++;
      } else if (r.quando > loc.quando) {
        if (mudouAqui) res.conflitos.push(r.nome || "folha sem nome");
        await guardar("folhas", { ...semId(r), gh: path, id: loc.id }); res.recebidas++;
        porCaminho[path] = { ...r, gh: path, id: loc.id };
      } else if (r.quando < loc.quando && visto && visto.sha !== sha) {
        res.conflitos.push(loc.nome || "folha sem nome");          // a daqui é mais nova: vai substituir a outra
      }
      await guardar("config", { sha, quando: r.quando }, "ghf:" + path);
    }

    // 3. envia as folhas novas ou mudadas aqui
    if (!semEscrita) {
      for (const [path, f] of Object.entries(porCaminho)) {
        const visto = await ler("config", "ghf:" + path).catch(() => null);
        if (visto && visto.quando === f.quando) continue;
        try {
          const sha = await enviar(path, semId(f), remoto[path], "Folha corrigida no celular");
          remoto[path] = sha;
          await guardar("config", { sha, quando: f.quando }, "ghf:" + path);
          res.enviadas++;
        } catch (e) {
          if (e.status === 403) { semEscrita = true; break; }
          res.falhas++;                                              // 409/422: outro aparelho mexeu; resolve na próxima
        }
      }
    }

    // 4. folhas já guardadas no GitHub contam como exportadas (o aviso de "não exportadas" some)
    if (!semEscrita && !res.falhas) {
      const fs = (await todos("folhas")).filter(f => hashes.has(String(f.hash)));
      for (const h of hashes) {
        const daProva = fs.filter(f => String(f.hash) === h);
        if (!daProva.length) continue;
        const quando = daProva.map(f => f.quando).sort().pop();
        const exp = await ler("config", "exportado:" + h).catch(() => null);
        if (!exp || exp.quando < quando) await guardar("config", { quando, n: daProva.length, github: true }, "exportado:" + daProva[0].hash);
      }
    }
    return res;
  }

  // ---------------------------------------------------------------- provas
  async function receberProvas(itens) {
    const arquivos = itens.filter(i => /^provas\/[^/]+ - Celular \(.*\)\.json$/i.test(i.path));
    let novas = 0, atualizadas = 0;
    for (const i of arquivos) {
      const nome = i.path.slice("provas/".length);
      if ((await ler("config", "gh:" + nome).catch(() => null)) === i.sha) continue;   // já visto nesta versão
      const p = JSON.parse(await api(`${BASE}/contents/${caminho(i.path)}`, { bruto: true }));
      if (p && p.tipo === "gerador-de-provas/celular") {
        const antes = await ler("pacotes", p.hash);
        if (!antes || JSON.stringify(antes) !== JSON.stringify(p)) {
          antes ? atualizadas++ : novas++;
          await guardar("pacotes", p);    // mesma prova (mesmo hash): atualiza; as folhas corrigidas ficam
        }
      }
      await guardar("config", i.sha, "gh:" + nome);
    }
    return { novas, atualizadas, total: arquivos.length };
  }

  // ---------------------------------------------------------------- turmas (só leitura)
  // turmas/*.json: agenda, alunos e notas, aulas de cada turma (pacote_turma.py, no computador).
  // Guardadas em config "turmas" e "agendas"; o que sumiu do repositório sai também do aparelho.
  async function receberTurmas(itens) {
    const arquivos = itens.filter(i => /^turmas\/[^/]+\.json$/i.test(i.path));
    const vistos = (await ler("config", "gh-turmas").catch(() => null)) || {};
    // nada mudou no GitHub (o caso comum, a cada folha guardada): não relê nem regrava nada
    if (arquivos.length === Object.keys(vistos).length && arquivos.every(i => vistos[i.path] === i.sha)) return false;
    let turmas = (await ler("config", "turmas").catch(() => null)) || [];
    let agendas = (await ler("config", "agendas").catch(() => null)) || [];
    const agora = {};
    let mudou = false;
    for (const i of arquivos) {
      agora[i.path] = i.sha;
      if (vistos[i.path] === i.sha) continue;
      const p = JSON.parse(await api(`${BASE}/contents/${caminho(i.path)}`, { bruto: true }));
      if (p && p.tipo === "gerador-de-provas/turma") {
        turmas = turmas.filter(t => t._path !== i.path && t.id !== p.id).concat({ ...p, _path: i.path });
        mudou = true;
      } else if (p && p.tipo === "gerador-de-provas/agenda") {
        agendas = agendas.filter(a => a._path !== i.path).concat({ ...p, _path: i.path });
        mudou = true;
      }
    }
    const antes = turmas.length + agendas.length;
    turmas = turmas.filter(t => agora[t._path]);
    agendas = agendas.filter(a => agora[a._path]);
    if (turmas.length + agendas.length !== antes) mudou = true;
    if (mudou) { await guardar("config", turmas, "turmas"); await guardar("config", agendas, "agendas"); }
    await guardar("config", agora, "gh-turmas");
    if (mudou) window.dispatchEvent(new Event("turmas-mudaram"));
    return mudou;
  }

  // ---------------------------------------------------------------- tudo
  async function sincronizar(silencioso) {
    if (!lerChave() || !navigator.onLine) return;
    if (rodando) { deNovo = true; return; }
    rodando = true;
    try {
      if (!silencioso) status("Sincronizando com o GitHub…", false, "lendo");
      const itens = await arvore();
      const p = await receberProvas(itens);
      const f = await sincronizarFolhas(itens);
      try { await receberTurmas(itens); }                 // uma falha aqui não atrapalha as provas e as folhas
      catch (e) { if (e.chave) throw e; console.warn("turmas:", e); }
      try { localStorage.setItem(ULTIMA, String(Date.now())); } catch (e) {}
      mostrar();
      if (p.novas || p.atualizadas || f.recebidas || f.apagadas) {
        await listarProvas();
        if (typeof pacote !== "undefined" && pacote && !$("#tela-prova").hidden) await listar();
      }
      const partes = [p.novas && `${p.novas} prova(s) nova(s)`, p.atualizadas && `${p.atualizadas} prova(s) atualizada(s)`,
                      f.recebidas && `${f.recebidas} folha(s) recebida(s) de outro aparelho`, f.apagadas && `${f.apagadas} folha(s) apagada(s) em outro aparelho`].filter(Boolean);
      if (semEscrita && !avisouEscrita) {
        avisouEscrita = true;
        status("As folhas não estão sendo enviadas: a chave do GitHub só permite leitura. No GitHub, edite a chave e mude Contents para “Read and write”.", true);
      } else if (f.conflitos.length) {
        status(`Corrigida em dois aparelhos: ${f.conflitos.join(", ")}. Ficou a correção mais recente; confira.`, true);
      } else if (partes.length) {
        status(partes.join(", ") + ".", false, "ok");
      } else if (!silencioso) {
        status(f.enviadas ? `${f.enviadas} folha(s) enviada(s) ao GitHub.` : "Tudo em dia.", false, "ok");
      }
    } catch (e) {
      if (!silencioso || e.chave) status("Não consegui sincronizar com o GitHub: " + e.message + ".", true);
    } finally {
      rodando = false;
      if (deNovo) { deNovo = false; agendar(); }
    }
  }

  function mostrar() {
    const on = !!lerChave(), u = lerUltima();
    $("#gh-quem").textContent = on
      ? "Sincronização ligada" + (u ? " · " + new Date(u).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "")
      : "Provas automáticas desligadas";
    $("#gh-buscar").hidden = !on;
    $("#gh-ligar").textContent = on ? "Desligar" : "Ligar";
    if (on) $("#gh-campo").hidden = true;
  }

  window.Sincronia = { ligada: () => !!lerChave(), sincronizar };

  window.addEventListener("load", () => {
    $("#gh-ligar").onclick = async () => {
      if (!lerChave()) { $("#gh-campo").hidden = !$("#gh-campo").hidden; if (!$("#gh-campo").hidden) $("#gh-chave").focus(); return; }
      if (await perguntar("Desligar a sincronização?", "A chave é apagada deste aparelho. As provas e as folhas guardadas continuam.",
                          [{ rotulo: "Desligar", valor: true }])) { gravarChave(""); mostrar(); }
    };
    $("#gh-salvar").onclick = async () => {
      const v = $("#gh-chave").value.trim();
      if (!v) return status("Cole a chave do GitHub no campo.", true);
      gravarChave(v);
      try {
        status("Conferindo a chave…", false, "lendo");
        await conferirAcesso();
      } catch (e) {
        gravarChave("");
        mostrar();
        return status("Chave não aceita: " + e.message + ". Confira se copiou a chave inteira.", true);
      }
      $("#gh-chave").value = "";
      semEscrita = false; avisouEscrita = false;
      mostrar();
      await sincronizar(false);
    };
    $("#gh-buscar").onclick = () => { semEscrita = false; avisouEscrita = false; sincronizar(false); };
    mostrar();
    sincronizar(true);
  });

  // No iPhone, o app da tela de início volta do segundo plano sem recarregar: sincroniza ao reaparecer.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lerUltima() > 60 * 1000) sincronizar(true);
  });
})();
