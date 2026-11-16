// Tela Início: resumo das provas, das disciplinas e do calendário (vista "inicio" da tela inicial).
// Usa os dados que a tela inicial já carregou (dadosLista) e as funções do app.js.
"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  const hoje = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
  const dias = (d) => Math.round((d - hoje()) / 86400000);
  const quando = (n) => n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n > 1 ? `em ${n} dias` : `há ${-n} dias`;

  function irModo(m, disc) {
    if (disc !== undefined) filtro = { inst: "", disc };
    modoProvas = m; diaSel = ""; salvarFiltro(); desenharProvas(); window.scrollTo(0, 0);
    if (window.Navegacao) Navegacao.marcar();
  }

  function cartao(titulo, link, modo) {
    const c = document.createElement("div"); c.className = "cartao ini-cartao";
    c.innerHTML = `<div class="titulo-linha"><span class="rotulo">${titulo}</span>${link ? `<button class="mini" type="button">${link}</button>` : ""}</div><div class="ini-corpo"></div>`;
    if (link) c.querySelector(".mini").onclick = () => irModo(modo);
    return c;
  }

  function linhaProva(p, direita, extra = "") {
    const b = document.createElement("button"); b.type = "button"; b.className = "ini-linha";
    const d = dataDe(p), i = infoProva(p);
    b.innerHTML = `<span class="ini-data">${d ? `<b>${d.getDate()}</b><small>${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small>` : "<b>–</b>"}</span>
      <span class="ini-meio"><span class="ini-nome">${esc(i.sigla ? i.sigla + " · " + i.rotulo : nomeProva(p))}</span>
      <small>${esc(i.disciplina)}${i.inst ? " · " + esc(i.inst) : ""}</small>${extra}</span>
      <span class="ini-dir">${direita}</span>`;
    b.onclick = () => abrirPacote(p);
    return b;
  }

  window.desenharInicio = function desenharInicio() {
    const caixa = $("#vista-inicio"); caixa.innerHTML = "";
    const { ps, porHash, pendentes } = dadosLista;
    if (!ps.length) return;
    const h = hoje();

    // números
    let feitasTot = 0, faltamTot = 0;
    for (const p of ps) {
      const feitas = corrigidas(porHash[p.hash] || []), total = totalAlunos(p), d = dataDe(p);
      feitasTot += feitas;
      if (!d || d <= h) faltamTot += Math.max(0, total - feitas);          // só provas já aplicadas
    }
    const discs = gruposDisciplina(ps);
    const topo = document.createElement("div"); topo.className = "ini-topo";
    const hojeTxt = diaLongo(h);
    topo.innerHTML = `<div class="ini-hoje">${esc(hojeTxt.charAt(0).toUpperCase() + hojeTxt.slice(1))}</div>
      <div class="ini-numeros">
        <button type="button" data-ir-modo="lista"><b>${ps.length}</b><small>provas</small></button>
        <button type="button" data-ir-modo="disciplinas"><b>${discs.length}</b><small>disciplinas</small></button>
        <div><b>${feitasTot}</b><small>folhas corrigidas</small></div>
        <div><b>${faltamTot}</b><small>a corrigir</small></div>
      </div>`;
    for (const b of topo.querySelectorAll("[data-ir-modo]")) b.onclick = () => irModo(b.dataset.irModo);
    caixa.appendChild(topo);

    // próximas provas (calendário)
    const proximas = ps.filter(p => { const d = dataDe(p); return d && d >= h; }).sort((a, b) => dataDe(a) - dataDe(b));
    const cProx = cartao("Próximas provas", "Calendário", "calendario");
    const corpo = cProx.querySelector(".ini-corpo");
    for (const p of proximas.slice(0, 4)) {
      const n = dias(dataDe(p));
      corpo.appendChild(linhaProva(p, `<span class="etiqueta${n <= 1 ? " alerta" : ""}">${quando(n)}</span>`, p.hora ? `<small>${esc(p.hora)}</small>` : ""));
    }
    if (!proximas.length) corpo.innerHTML = `<div class="ini-vazio">Nenhuma prova marcada daqui para a frente.</div>`;
    else if (proximas.length > 4) corpo.insertAdjacentHTML("beforeend", `<div class="ini-vazio">e mais ${proximas.length - 4}</div>`);
    caixa.appendChild(cProx);

    // em correção: já aplicadas (ou com folhas) e ainda incompletas, ou com folhas sem exportar
    const emCorrecao = ps.filter(p => {
      const suas = porHash[p.hash] || [], d = dataDe(p), total = totalAlunos(p);
      const aplicada = suas.length || (d && d <= h);
      return (aplicada && corrigidas(suas) < total) || pendentes[p.hash];
    }).sort((a, b) => (dataDe(b) || 0) - (dataDe(a) || 0));
    if (emCorrecao.length) {
      const cCor = cartao("Em correção", "Provas", "lista");
      for (const p of emCorrecao.slice(0, 5)) {
        const suas = porHash[p.hash] || [], total = totalAlunos(p), feitas = corrigidas(suas);
        const barra = `<span class="barra-prog ini-prog"><i style="width:${total ? Math.min(100, 100 * feitas / total) : 0}%"></i></span>`;
        cCor.querySelector(".ini-corpo").appendChild(linhaProva(p,
          `<span class="ini-conta"><b>${feitas}</b>/${total}</span>` + (pendentes[p.hash] ? `<span class="etiqueta alerta">${pendentes[p.hash]} sem exportar</span>` : ""), barra));
      }
      caixa.appendChild(cCor);
    }

    // disciplinas
    const cDisc = cartao("Disciplinas", "Ver todas", "disciplinas");
    for (const [k, { info, provas }] of discs) {
      const prox = provas.find(p => { const d = dataDe(p); return d && d >= h; });
      const b = document.createElement("button"); b.type = "button"; b.className = "ini-linha";
      b.innerHTML = `${htmlCapa(provas[0], "capa ini-capa")}<span class="ini-meio"><span class="ini-nome">${esc(info.disciplina)}</span>
        <small>${esc([info.inst, info.turma].filter(Boolean).join(" · "))}${prox ? " · próxima: " + esc(infoProva(prox).rotulo) + " em " + diaBR(dataDe(prox)) : ""}</small></span>
        <span class="ini-dir"><span class="ini-conta"><b>${provas.length}</b> prova${provas.length > 1 ? "s" : ""}</span></span>`;
      b.onclick = () => irModo("lista", k);
      cDisc.querySelector(".ini-corpo").appendChild(b);
    }
    caixa.appendChild(cDisc);
  };
})();
