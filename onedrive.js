// Conexão com o OneDrive pessoal do professor (Microsoft Graph), com código próprio:
// login OAuth 2.0 com PKCE (sem segredo; padrão para páginas), leitura das provas da pasta única
// e gravação dos resultados na pasta de cada prova. Os dados vão do celular direto ao OneDrive.
"use strict";

const OneDrive = (() => {
  // Identificador do aplicativo registrado no portal da Microsoft (não é senha: é público por natureza).
  const CLIENT_ID = "";
  const AUTORIDADE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
  const ESCOPOS = "Files.ReadWrite offline_access User.Read";
  const PASTA_PROVAS = "Profissional/Aulas/Corretor de provas";
  const GRAPH = "https://graph.microsoft.com/v1.0";
  const CHAVE = "corretor-onedrive";
  const REDIRECT = new URL(".", location.href).href;

  const configurado = () => !!CLIENT_ID;
  const lerEstado = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch (e) { return {}; } };
  const gravarEstado = (e) => localStorage.setItem(CHAVE, JSON.stringify(e));

  function aleatorio(n = 32) {
    const b = new Uint8Array(n); crypto.getRandomValues(b);
    return base64url(b);
  }
  function base64url(bytes) {
    let s = ""; for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function desafio(verificador) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador));
    return base64url(new Uint8Array(h));
  }

  // Leva à página de login da Microsoft; ela volta para esta página com ?code=…
  async function conectar() {
    if (!configurado()) throw new Error("A conexão com o OneDrive ainda não foi configurada.");
    const verificador = aleatorio(48), estado = aleatorio(16);
    gravarEstado({ ...lerEstado(), verificador, estado });
    const u = new URL(AUTORIDADE + "/authorize");
    u.search = new URLSearchParams({
      client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT, scope: ESCOPOS,
      state: estado, code_challenge: await desafio(verificador), code_challenge_method: "S256", prompt: "select_account",
    });
    location.assign(u.href);
  }

  async function pedirToken(corpo) {
    const r = await fetch(AUTORIDADE + "/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: ESCOPOS, ...corpo }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || "falha no login");
    const e = lerEstado();
    gravarEstado({ ...e, acesso: j.access_token, refresh: j.refresh_token || e.refresh, expira: Date.now() + (j.expires_in - 120) * 1000,
                   verificador: undefined, estado: undefined });
  }

  // Ao abrir a página: conclui o login se ela voltou da Microsoft. Devolve true se acabou de conectar.
  async function concluirLogin() {
    const p = new URLSearchParams(location.search);
    if (!p.has("code") && !p.has("error")) return false;
    history.replaceState(null, "", location.pathname);
    if (p.has("error")) throw new Error(p.get("error_description") || p.get("error"));
    const e = lerEstado();
    if (!e.verificador || p.get("state") !== e.estado) throw new Error("Login interrompido. Tente conectar de novo.");
    await pedirToken({ grant_type: "authorization_code", code: p.get("code"), code_verifier: e.verificador });
    return true;
  }

  async function token() {
    const e = lerEstado();
    if (e.acesso && Date.now() < e.expira) return e.acesso;
    if (!e.refresh) return null;
    try { await pedirToken({ grant_type: "refresh_token", refresh_token: e.refresh }); return lerEstado().acesso; }
    catch (err) { gravarEstado({}); return null; }   // a Microsoft pede novo login a cada 24 h em páginas
  }

  const conectado = () => !!lerEstado().refresh;
  function desconectar() { gravarEstado({}); }

  async function graph(caminho, opc = {}) {
    const t = await token();
    if (!t) { const e = new Error("Conecte-se ao OneDrive de novo."); e.precisaLogin = true; throw e; }
    const r = await fetch(caminho.startsWith("http") ? caminho : GRAPH + caminho,
      { ...opc, headers: { Authorization: "Bearer " + t, ...(opc.headers || {}) } });
    if (r.status === 401) { gravarEstado({ ...lerEstado(), acesso: null, expira: 0 }); }
    if (!r.ok) {
      let msg = r.status + "";
      try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) { /* sem corpo */ }
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return r;
  }

  const caminhoGraph = (p) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

  async function quemSou() {
    const j = await (await graph("/me?$select=displayName,userPrincipalName")).json();
    return j.displayName || j.userPrincipalName || "";
  }

  // Provas da pasta única: [{nome, modificado, pacote}]
  async function listarProvas() {
    let url = `/me/drive/root:/${caminhoGraph(PASTA_PROVAS)}:/children?$top=200&$select=name,lastModifiedDateTime,file`;
    const itens = [];
    while (url) {
      const j = await (await graph(url)).json();
      itens.push(...j.value);
      url = j["@odata.nextLink"] || null;
    }
    const provas = itens.filter(i => i.file && / - Celular \(.*\)\.json$/i.test(i.name));
    const saida = [];
    for (const i of provas) {
      const r = await graph(`/me/drive/root:/${caminhoGraph(PASTA_PROVAS + "/" + i.name)}:/content`);
      try { saida.push({ nome: i.name, modificado: i.lastModifiedDateTime, pacote: await r.json() }); }
      catch (e) { /* arquivo inválido: ignora */ }
    }
    return saida;
  }

  // Grava o arquivo de resultados na pasta da prova (ou na pasta única, se a prova não informar a pasta).
  async function enviarResultados(pacote, nomeArquivo, texto) {
    const pasta = pacote.pasta_onedrive || PASTA_PROVAS;
    const caminho = caminhoGraph(pasta + "/" + nomeArquivo);
    const dados = new TextEncoder().encode(texto);
    if (dados.length < 4 * 1024 * 1024) {
      await graph(`/me/drive/root:/${caminho}:/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: dados });
    } else {
      // arquivos grandes: sessão de envio em partes (múltiplas de 320 KiB)
      const s = await (await graph(`/me/drive/root:/${caminho}:/createUploadSession`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
      })).json();
      const PARTE = 320 * 1024 * 10;
      for (let ini = 0; ini < dados.length; ini += PARTE) {
        const fim = Math.min(dados.length, ini + PARTE);
        const r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${ini}-${fim - 1}/${dados.length}` }, body: dados.slice(ini, fim) });
        if (!r.ok && r.status !== 202) throw new Error("falha no envio (" + r.status + ")");
      }
    }
    return pasta + "/" + nomeArquivo;
  }

  return { configurado, conectar, concluirLogin, conectado, desconectar, quemSou, listarProvas, enviarResultados, PASTA_PROVAS };
})();

window.OneDrive = OneDrive;
