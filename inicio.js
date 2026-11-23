// Tela Início: resumo das provas, das disciplinas e do calendário (vista "inicio" da tela inicial).
// Usa os dados que a tela inicial já carregou (dadosLista) e as funções do app.js.
// Em telas largas (iPad), duas colunas: calendário do mês e próximas datas | em correção e disciplinas.
// No iPhone, tudo numa coluna.
//
// Entregas de trabalho: lidas da lista guardada no aparelho (IndexedDB, loja "config", chave "trabalhos"):
//   [{ data: "aaaa-mm-dd" ou "dd/mm/aaaa", titulo: "Trabalho 2", disciplina, sigla, instituicao }]
// A captura dos trabalhos (de onde vem essa lista) ainda será definida; quem gravar a lista deve
// disparar window.dispatchEvent(new Event("trabalhos-mudaram")).
"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  const hoje = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
  const dias = (d) => Math.round((d - hoje()) / 86400000);
  const quando = (n) => n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n > 1 ? `em ${n} dias` : `há ${-n} dias`;
  const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
  const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  // ------------------------------------------------------------ entregas de trabalho
  let trabalhos = [];
  const dataDoTrabalho = (t) => {
    let m = String(t.data || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
    m = String(t.data || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : null;
  };
  async function carregarTrabalhos() {
    const lista = await ler("config", "trabalhos").catch(() => null);
    trabalhos = (Array.isArray(lista) ? lista : []).map(t => ({ ...t, _d: dataDoTrabalho(t) })).filter(t => t._d);
    if (modoProvas === "inicio" && dadosLista) desenharProvas();
  }
  window.addEventListener("trabalhos-mudaram", carregarTrabalhos);
  window.addEventListener("load", carregarTrabalhos);

  function irModo(m, extra = {}) {
    if (extra.disc !== undefined) filtro = { inst: "", disc: extra.disc };
    modoProvas = m; diaSel = extra.dia || "";
    if (extra.dia) { const d = new Date(extra.dia + "T12:00"); mesCal = new Date(d.getFullYear(), d.getMonth(), 1); }
    salvarFiltro(); desenharProvas(); window.scrollTo(0, 0);
    if (window.Navegacao) Navegacao.marcar();
  }

  function cartao(titulo, link, modo, classe = "") {
    const c = document.createElement("div"); c.className = "cartao ini-cartao " + classe;
    c.innerHTML = `<div class="titulo-linha"><span class="rotulo">${titulo}</span>${link ? `<button class="mini" type="button">${link}</button>` : ""}</div><div class="ini-corpo"></div>`;
    if (link) c.querySelector(".mini").onclick = () => irModo(modo);
    return c;
  }

  const htmlData = (d, classe = "") => `<span class="ini-data ${classe}">${d ? `<b>${d.getDate()}</b><small>${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small>` : "<b>–</b>"}</span>`;

  function linhaProva(p, direita, extra = "") {
    const b = document.createElement("button"); b.type = "button"; b.className = "ini-linha";
    const i = infoProva(p);
    b.innerHTML = `${htmlData(dataDe(p))}
      <span class="ini-meio"><span class="ini-nome">${esc(i.sigla ? i.sigla + " · " + i.rotulo : nomeProva(p))}</span>
      <small>${esc(i.disciplina)}${i.inst ? " · " + esc(i.inst) : ""}${p.hora ? " · " + esc(p.hora) : ""}</small>${extra}</span>
      <span class="ini-dir">${direita}</span>`;
    b.onclick = () => abrirPacote(p);
    return b;
  }

  function linhaTrabalho(t) {
    const b = document.createElement("button"); b.type = "button"; b.className = "ini-linha";
    const n = dias(t._d);
    b.innerHTML = `${htmlData(t._d, "trabalho")}
      <span class="ini-meio"><span class="ini-nome">${esc([t.sigla, t.titulo || "Trabalho"].filter(Boolean).join(" · "))}</span>
      <small>Entrega${t.disciplina ? " · " + esc(t.disciplina) : ""}${t.instituicao ? " · " + esc(t.instituicao) : ""}</small></span>
      <span class="ini-dir"><span class="etiqueta trabalho">${quando(n)}</span></span>`;
    b.onclick = () => irModo("calendario", { dia: isoDia(t._d) });
    return b;
  }

  // calendário do mês: dias de prova pintados, entregas de trabalho com um ponto laranja
  function miniCalendario(ps) {
    const c = cartao("Calendário", "Abrir", "calendario", "ini-cal");
    const h = hoje(), ano = h.getFullYear(), mes = h.getMonth();
    const provasDia = {}, trabDia = {};
    for (const p of ps) { const d = dataDe(p); if (d) (provasDia[isoDia(d)] = provasDia[isoDia(d)] || []).push(p); }
    for (const t of trabalhos) (trabDia[isoDia(t._d)] = trabDia[isoDia(t._d)] || []).push(t);
    const primeiro = new Date(ano, mes, 1).getDay(), total = new Date(ano, mes + 1, 0).getDate();
    let html = `<div class="ini-mes">${maiuscula(h.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}</div><div class="ini-grade">` +
      SEMANA.map(s => `<span class="ini-sem">${s}</span>`).join("") + "<span></span>".repeat(primeiro);
    for (let d = 1; d <= total; d++) {
      const k = isoDia(new Date(ano, mes, d, 12)), pv = provasDia[k] || [], tb = trabDia[k] || [];
      const dica = [...pv.map(p => "Prova: " + infoProva(p).sigla + " · " + infoProva(p).rotulo), ...tb.map(t => "Entrega: " + [t.sigla, t.titulo].filter(Boolean).join(" · "))].join("\n");
      html += `<button type="button" data-dia="${k}" title="${esc(dica)}" class="${[d === h.getDate() ? "hoje" : "", pv.length ? "tem" : "", tb.length ? "entrega" : ""].join(" ")}">${d}</button>`;
    }
    html += `</div><div class="ini-legenda"><span><i class="lg-prova"></i>prova</span>${trabalhos.length ? `<span><i class="lg-entrega"></i>entrega de trabalho</span>` : ""}</div>`;
    c.querySelector(".ini-corpo").innerHTML = html;
    for (const b of c.querySelectorAll("[data-dia]"))
      b.onclick = () => irModo("calendario", { dia: provasDia[b.dataset.dia] || trabDia[b.dataset.dia] ? b.dataset.dia : "" });
    return c;
  }

  async function avisoSoNoAparelho(el) {
    if (!window.Sincronia || !Sincronia.ligada()) return;
    const n = await Sincronia.soNoAparelho().catch(() => null);
    if (!n) return;
    el.textContent = `${n} folha(s) corrigida(s) só neste aparelho, ainda não enviada(s) ao GitHub. Não apague o app da tela de início antes de sincronizar ou exportar.`;
    el.hidden = false;
  }
  window.addEventListener("sincronia-mudou", () => {
    const el = document.querySelector("#vista-inicio .ini-alerta");
    if (el) { el.hidden = true; avisoSoNoAparelho(el); }
  });

  window.desenharInicio = function desenharInicio() {
    const caixa = $("#vista-inicio"); caixa.innerHTML = ""; caixa.className = "ini";
    const { ps, porHash, pendentes } = dadosLista;
    const nTurmas = window.Turmas ? Turmas.lista().length : 0;
    if (!ps.length && !nTurmas) return;
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
    topo.innerHTML = `<div class="ini-hoje">${esc(maiuscula(diaLongo(h)))}</div>
      <div class="ini-numeros">
        <button type="button" data-ir-modo="lista"><b>${ps.length}</b><small>provas</small></button>
        <button type="button" data-ir-modo="disciplinas"><b>${nTurmas || discs.length}</b><small>${nTurmas ? "turmas" : "disciplinas"}</small></button>
        <div><b>${feitasTot}</b><small>corrigidas</small></div>
        <div><b>${faltamTot}</b><small>a corrigir</small></div>
      </div>`;
    for (const b of topo.querySelectorAll("[data-ir-modo]")) b.onclick = () => irModo(b.dataset.irModo);

    // próximas datas: provas e entregas de trabalho, em ordem
    const datas = [
      ...ps.filter(p => { const d = dataDe(p); return d && d >= h; }).map(p => ({ d: dataDe(p), p })),
      ...trabalhos.filter(t => t._d >= h).map(t => ({ d: t._d, t })),
    ].sort((a, b) => a.d - b.d);
    const cProx = cartao(trabalhos.length ? "Próximas provas e entregas" : "Próximas provas", "", "calendario");
    for (const x of datas.slice(0, 5)) {
      if (x.t) { cProx.querySelector(".ini-corpo").appendChild(linhaTrabalho(x.t)); continue; }
      const n = dias(x.d);
      cProx.querySelector(".ini-corpo").appendChild(linhaProva(x.p, `<span class="etiqueta${n <= 1 ? " alerta" : ""}">${quando(n)}</span>`));
    }
    if (!datas.length) cProx.querySelector(".ini-corpo").innerHTML = `<div class="ini-vazio">Nada marcado daqui para a frente.</div>`;
    else if (datas.length > 5) cProx.querySelector(".ini-corpo").insertAdjacentHTML("beforeend", `<div class="ini-vazio">e mais ${datas.length - 5}</div>`);

    // em correção
    const emCorrecao = ps.filter(p => {
      const suas = porHash[p.hash] || [], d = dataDe(p), total = totalAlunos(p);
      const aplicada = suas.length || (d && d <= h);
      return (aplicada && corrigidas(suas) < total) || pendentes[p.hash];
    }).sort((a, b) => (dataDe(b) || 0) - (dataDe(a) || 0));
    const cCor = cartao("Em correção", "Provas", "lista");
    for (const p of emCorrecao.slice(0, 5)) {
      const suas = porHash[p.hash] || [], total = totalAlunos(p), feitas = corrigidas(suas);
      const barra = `<span class="barra-prog ini-prog"><i style="width:${total ? Math.min(100, 100 * feitas / total) : 0}%"></i></span>`;
      cCor.querySelector(".ini-corpo").appendChild(linhaProva(p,
        `<span class="ini-conta"><b>${feitas}</b>/${total}</span>` + (pendentes[p.hash] ? `<span class="etiqueta alerta">${pendentes[p.hash]} sem exportar</span>` : ""), barra));
    }
    if (!emCorrecao.length) cCor.querySelector(".ini-corpo").innerHTML = `<div class="ini-vazio">Nenhuma prova esperando correção.</div>`;

    // disciplinas
    const cDisc = cartao("Disciplinas", "Ver todas", "disciplinas");
    for (const [k, { info, provas }] of discs) {
      const prox = provas.find(p => { const d = dataDe(p); return d && d >= h; });
      const b = document.createElement("button"); b.type = "button"; b.className = "ini-linha";
      b.innerHTML = `<span class="ini-meio"><span class="ini-nome">${esc(info.disciplina)}</span>
        <small>${esc([info.inst, info.turma].filter(Boolean).join(" · "))}${prox ? " · próxima: " + esc(infoProva(prox).rotulo) + " em " + diaBR(dataDe(prox)) : ""}</small></span>
        <span class="ini-dir"><span class="ini-conta"><b>${provas.length}</b> prova${provas.length > 1 ? "s" : ""}</span></span>`;
      b.onclick = () => irModo("lista", { disc: k });
      cDisc.querySelector(".ini-corpo").appendChild(b);
    }

    // duas colunas no iPad (uma só no iPhone): calendário e próximas datas | em correção e disciplinas
    const col = (...els) => { const d = document.createElement("div"); d.className = "ini-col"; d.append(...els); return d; };
    const grade = document.createElement("div"); grade.className = "ini-grade-quadros";
    const cAulas = window.Turmas ? Turmas.cartaoProximasAulas() : null;     // agenda das turmas (turmas.js)
    grade.append(col(...[cAulas, miniCalendario(ps), cProx].filter(Boolean)), col(cCor, cDisc));
    // aviso fixo: folhas que ainda não chegaram ao GitHub (somem do aparelho se o atalho for apagado)
    const alerta = document.createElement("div"); alerta.className = "ini-alerta"; alerta.hidden = true;
    caixa.append(topo, alerta, grade);
    avisoSoNoAparelho(alerta);
  };
})();
