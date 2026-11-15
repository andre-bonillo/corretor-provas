// Provas automáticas: ao abrir, a página busca as provas novas ou refeitas no repositório
// privado do professor no GitHub (para onde o gerador envia cada "… - Celular (….json").
// A chave de acesso (só leitura, só desse repositório) é colada uma vez e fica só neste aparelho.
"use strict";

(() => {
  const DONO = "andre-bonillo", REPO = "corretor-provas-dados", PASTA = "provas";
  const BASE = `https://api.github.com/repos/${DONO}/${REPO}`;
  const CHAVE = "corretor-github", ULTIMA = "corretor-github-ultima";
  const $ = (s) => document.querySelector(s);

  const lerChave = () => { try { return localStorage.getItem(CHAVE) || ""; } catch (e) { return ""; } };
  const gravarChave = (v) => { try { v ? localStorage.setItem(CHAVE, v) : localStorage.removeItem(CHAVE); } catch (e) {} };
  const lerUltima = () => { try { return +localStorage.getItem(ULTIMA) || 0; } catch (e) { return 0; } };
  const caminho = (p) => p.split("/").map(encodeURIComponent).join("/");
  let buscando = false;

  async function api(url, bruto) {
    const r = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: "Bearer " + lerChave(), "X-GitHub-Api-Version": "2022-11-28",
                 Accept: bruto ? "application/vnd.github.raw" : "application/vnd.github+json" },
    });
    if (r.status === 401) { const e = new Error("a chave do GitHub não vale mais (vencida ou apagada)"); e.chave = true; throw e; }
    if (!r.ok) { const e = new Error("o GitHub respondeu " + r.status); e.status = r.status; throw e; }
    return bruto ? r.text() : r.json();
  }

  // A chave dá acesso ao repositório? (o GitHub responde 404 quando a chave não inclui o repositório)
  async function conferirAcesso() {
    try { await api(BASE); }
    catch (e) {
      if (e.status === 404) { const x = new Error(`a chave não dá acesso ao repositório ${REPO}`); x.chave = true; throw x; }
      throw e;
    }
  }

  async function buscar(silencioso) {
    if (!lerChave() || buscando || !navigator.onLine) return;
    buscando = true;
    try {
      if (!silencioso) status("Buscando as provas no GitHub…", false, "lendo");
      let itens;
      try { itens = await api(`${BASE}/contents/${PASTA}`); }
      catch (e) { if (e.status !== 404) throw e; await conferirAcesso(); itens = []; }   // pasta ainda não criada
      const arquivos = itens.filter(i => i.type === "file" && / - Celular \(.*\)\.json$/i.test(i.name));
      let novas = 0, atualizadas = 0;
      for (const i of arquivos) {
        if ((await ler("config", "gh:" + i.name).catch(() => null)) === i.sha) continue;   // já visto nesta versão
        const p = JSON.parse(await api(`${BASE}/contents/${caminho(i.path)}`, true));
        if (p && p.tipo === "gerador-de-provas/celular") {
          const antes = await ler("pacotes", p.hash);
          if (!antes || JSON.stringify(antes) !== JSON.stringify(p)) {
            antes ? atualizadas++ : novas++;
            await guardar("pacotes", p);    // mesma prova (mesmo hash): atualiza; as folhas corrigidas ficam
          }
        }
        await guardar("config", i.sha, "gh:" + i.name);
      }
      try { localStorage.setItem(ULTIMA, String(Date.now())); } catch (e) {}
      mostrar();
      if (novas || atualizadas) {
        await listarProvas();
        status([novas && `${novas} prova(s) nova(s)`, atualizadas && `${atualizadas} atualizada(s)`].filter(Boolean).join(", ") +
          " recebida(s) do GitHub." + (atualizadas ? " As folhas já corrigidas foram mantidas." : ""), false, "ok");
      } else if (!silencioso) {
        status(arquivos.length ? "As provas do aparelho já estão em dia." : "Ainda não há provas no GitHub.", false, "ok");
      }
    } catch (e) {
      status("Não consegui buscar as provas no GitHub: " + e.message + ".", true);
    } finally {
      buscando = false;
    }
  }

  function mostrar() {
    const on = !!lerChave(), u = lerUltima();
    $("#gh-quem").textContent = on
      ? "Provas automáticas ligadas" + (u ? " · buscadas às " + new Date(u).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "")
      : "Provas automáticas desligadas";
    $("#gh-buscar").hidden = !on;
    $("#gh-ligar").textContent = on ? "Desligar" : "Ligar";
    if (on) $("#gh-campo").hidden = true;
  }

  window.addEventListener("load", () => {
    $("#gh-ligar").onclick = async () => {
      if (!lerChave()) { $("#gh-campo").hidden = !$("#gh-campo").hidden; if (!$("#gh-campo").hidden) $("#gh-chave").focus(); return; }
      if (await perguntar("Desligar as provas automáticas?", "A chave é apagada deste aparelho. As provas e as folhas guardadas continuam.",
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
      mostrar();
      await buscar(false);
    };
    $("#gh-buscar").onclick = () => buscar(false);
    mostrar();
    buscar(true);
  });

  // No iPhone, o app da tela de início volta do segundo plano sem recarregar: busca de novo ao reaparecer.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lerUltima() > 60 * 1000) buscar(true);
  });
})();
