// Liga a tela à conexão com o OneDrive (onedrive.js). Sem o identificador do aplicativo configurado,
// nada aparece e a página funciona como antes (abrir arquivos e exportar pelo Compartilhar).
"use strict";

(() => {
  const $ = (s) => document.querySelector(s);

  async function mostrarConexao() {
    const on = OneDrive.conectado();
    $("#od-conectar").textContent = on ? "Desconectar" : "Conectar ao OneDrive";
    $("#od-atualizar").hidden = !on;
    $("#od-enviar").hidden = !on;
    $("#od-quem").textContent = on ? "OneDrive conectado" : "OneDrive não conectado";
    if (on) {
      try { const q = await OneDrive.quemSou(); if (q) $("#od-quem").textContent = "Conectado como " + q; }
      catch (e) { if (e.precisaLogin) { OneDrive.desconectar(); return mostrarConexao(); } }
    }
    await sincronizarEnviar();
  }

  async function sincronizarEnviar() {
    const b = $("#od-enviar");
    if (!b || b.hidden || !pacote) return;
    b.disabled = !(await folhasDa(pacote.hash)).length;
  }

  async function atualizarProvas(silencioso) {
    if (!OneDrive.conectado()) return;
    try {
      if (!silencioso) status("Buscando as provas no OneDrive…", false, "lendo");
      const provas = await OneDrive.listarProvas();
      let novas = 0, atualizadas = 0;
      for (const { pacote: p } of provas) {
        if (!p || p.tipo !== "gerador-de-provas/celular") continue;
        const antes = await ler("pacotes", p.hash);
        if (antes && JSON.stringify(antes) === JSON.stringify(p)) continue;
        antes ? atualizadas++ : novas++;
        await guardar("pacotes", p);       // mesma prova: atualiza a turma; as folhas corrigidas ficam
      }
      await listarProvas();
      if (!silencioso || novas || atualizadas)
        status(provas.length ? `OneDrive: ${novas} prova(s) nova(s)` + (atualizadas ? `, ${atualizadas} atualizada(s)` : "") + "." :
          `Nenhuma prova na pasta ${OneDrive.PASTA_PROVAS} do OneDrive.`, false, "ok");
    } catch (e) {
      if (e.precisaLogin) { await mostrarConexao(); status("A conexão com o OneDrive expirou (a Microsoft pede novo login a cada 24 h). Toque em Conectar.", true); }
      else status("Não consegui ler o OneDrive: " + e.message, true);
    }
  }

  async function enviar() {
    try {
      status("Enviando os resultados ao OneDrive…", false, "lendo");
      const { nome, texto, marcar } = await montarExportacao();
      const onde = await OneDrive.enviarResultados(pacote, nome, texto);
      await marcar();
      status(`Resultados gravados no OneDrive, em ${onde}. No computador, arraste-os para o lancar.bat.`, false, "ok");
    } catch (e) {
      if (e.precisaLogin) { await mostrarConexao(); status("A conexão com o OneDrive expirou. Toque em Conectar e envie de novo.", true); }
      else status("Não consegui gravar no OneDrive: " + e.message + ". Use Exportar resultados.", true);
    }
  }

  window.addEventListener("load", async () => {
    if (!window.OneDrive || !OneDrive.configurado()) return;
    $("#od-cartao").hidden = false;
    // a lista de folhas muda: o botão de envio acompanha
    const listarOriginal = window.listar;
    window.listar = async (...a) => { const r = await listarOriginal(...a); await sincronizarEnviar(); return r; };
    $("#od-conectar").onclick = async () => {
      if (OneDrive.conectado()) {
        if (await perguntar("Desconectar do OneDrive?", "As provas e as folhas guardadas no aparelho continuam.", [{ rotulo: "Desconectar", valor: true }]))
          { OneDrive.desconectar(); await mostrarConexao(); }
        return;
      }
      try { await OneDrive.conectar(); } catch (e) { status(e.message, true); }
    };
    $("#od-atualizar").onclick = () => atualizarProvas(false);
    $("#od-enviar").onclick = enviar;
    try {
      if (await OneDrive.concluirLogin()) status("OneDrive conectado.", false, "ok");
    } catch (e) { status("Login no OneDrive não concluído: " + e.message, true); }
    await mostrarConexao();
    if (OneDrive.conectado()) atualizarProvas(true);
  });
})();
