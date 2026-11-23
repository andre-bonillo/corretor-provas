// Turmas: agenda, alunos e notas, aulas e material de apoio de cada turma.
// Os dados vêm do computador (pacote_turma.py → repositório privado, pasta turmas/); o github.js
// os recebe e guarda no aparelho (IndexedDB, loja "config", chaves "turmas" e "agendas").
// Esta página só mostra: nada aqui altera as planilhas, as pastas ou a agenda.
// Cores das instituições (contorno dos cartões): vermelho para a Libertas, azul para a Unifeg.
"use strict";

(() => {
  const $ = (s) => document.querySelector(s);
  let turmas = [], agendas = [];
  let aberta = null, abaTurma = "agenda", aulaAberta = null, verRoteiro = false, alunoAberto = "";

  const normSigla = (s) => String(s || "").toLowerCase().split(/[\s_]+/).filter(t => t && t !== "e").join("");
  const classeInst = (inst) => ({ Libertas: "inst-libertas", Unifeg: "inst-unifeg" }[inst] || "");
  const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const dataEv = (e) => new Date(e.data + "T" + (e.inicio || "12:00"));
  const fimEv = (e) => new Date(e.data + "T" + (e.fim || e.inicio || "23:59"));
  const semana = (d) => d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const nomeTurma = (t) => `${t.sigla} · ${t.periodo}º período`;
  const rotuloEv = (e) => e.tipo === "sem aula" ? "Sem aula" : e.tipo === "aula" ? "Aula" : (e.rotulo || "Evento");

  async function carregar() {
    turmas = (await ler("config", "turmas").catch(() => null)) || [];
    agendas = (await ler("config", "agendas").catch(() => null)) || [];
    turmas.sort((a, b) => a.instituicao.localeCompare(b.instituicao) || a.periodo - b.periodo || a.sigla.localeCompare(b.sigla, "pt"));
  }

  function provasDa(t) {
    if (!dadosLista) return [];
    return dadosLista.ps.filter(p => {
      const i = infoProva(p);
      return i.inst === t.instituicao && normSigla(i.sigla) === normSigla(t.sigla) && (!i.semestre || i.semestre === t.semestre);
    }).sort((a, b) => (dataDe(a) || 0) - (dataDe(b) || 0));
  }

  // eventos que ainda não terminaram (aulas, provas e eventos da instituição), de todas as turmas
  function proximosEventos(n = 6) {
    const agora = new Date(), lista = [];
    for (const t of turmas) for (const e of t.agenda || []) if (e.tipo !== "sem aula" && fimEv(e) >= agora) lista.push({ e, t });
    for (const a of agendas) for (const e of a.agenda || []) if (fimEv(e) >= agora) lista.push({ e, inst: a.instituicao });
    return lista.sort((x, y) => dataEv(x.e) - dataEv(y.e)).slice(0, n);
  }
  const proximaDa = (t, tipo) => (t.agenda || []).find(e => (!tipo ? e.tipo !== "sem aula" : e.tipo === tipo) && fimEv(e) >= new Date());

  // ------------------------------------------------------------------ peças comuns
  const caixaData = (d, classe = "") =>
    `<span class="ini-data ${classe}"><b>${d.getDate()}</b><small>${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>`;

  function capaTurma(t) {
    return `<div class="capa" style="--h:${corDa(t.disciplina)}"><span>${esc(t.sigla)}</span><small>${t.periodo}P</small></div>`;
  }

  function quandoTexto(e) {
    const d = dataEv(e);
    return `${semana(d)} ${diaBR(d)}${e.inicio ? " · " + e.inicio + (e.fim ? "–" + e.fim : "") : ""}`;
  }

  // linha da agenda (Início e aba Agenda)
  function linhaEvento(x, comTurma) {
    const { e, t } = x, inst = t ? t.instituicao : x.inst;
    const b = document.createElement("button"); b.type = "button"; b.className = "ini-linha ev-" + e.tipo.replace(" ", "-");
    const titulo = comTurma && t ? `${t.sigla} · ${t.periodo}P — ${rotuloEv(e)}` : (t ? rotuloEv(e) : e.rotulo || e.titulo);
    const meioDia = new Date(); meioDia.setHours(12, 0, 0, 0);
    const dias = Math.round((new Date(e.data + "T12:00") - meioDia) / 86400000);
    const etq = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : dias > 1 && dias < 7 ? `em ${dias} dias` : "";
    b.innerHTML = `${caixaData(dataEv(e), classeInst(inst))}
      <span class="ini-meio"><span class="ini-nome">${esc(titulo)}</span>
      <small>${esc(quandoTexto(e))}${comTurma ? " · " + esc(inst || "") : ""}</small></span>
      <span class="ini-dir">${e.tipo === "prova" ? `<span class="etiqueta alerta">prova</span>` : ""}${etq && e.tipo !== "sem aula" ? `<span class="etiqueta">${etq}</span>` : ""}</span>`;
    if (t) b.onclick = () => abrir(t.id, "agenda");
    else b.disabled = true;
    return b;
  }

  // ------------------------------------------------------------------ cartões das turmas (vista Turmas)
  function cartaoTurma(t) {
    const div = document.createElement("div");
    div.className = "cartao disciplina turma " + classeInst(t.instituicao);
    const aula = proximaDa(t, "aula"), prova = proximaDa(t, "prova"), provas = provasDa(t);
    div.innerHTML = `<button type="button" class="disc-topo turma-topo">${capaTurma(t)}<div><div class="nome">${esc(t.disciplina)}</div>
        <div class="disc">${esc([t.instituicao, t.periodo + "º período", t.semestre].join(" · "))}</div></div></button>
      <div class="turma-prox">
        ${aula ? `<div><span>Próxima aula</span><b>${esc(quandoTexto(aula))}</b></div>` : ""}
        ${prova ? `<div><span>Próxima prova</span><b>${esc(prova.rotulo || "Prova")} · ${esc(quandoTexto(prova))}</b></div>` : ""}
      </div>
      <div class="turma-botoes">
        <button type="button" class="mini" data-t="agenda">Agenda</button>
        <button type="button" class="mini" data-t="alunos">${t.alunos.length} alunos</button>
        <button type="button" class="mini" data-t="aulas">${t.aulas.length} aulas</button>
        <button type="button" class="mini" data-t="provas">${provas.length} prova${provas.length === 1 ? "" : "s"}</button>
      </div>`;
    div.querySelector(".turma-topo").onclick = () => abrir(t.id, "agenda");
    botaoAcessivel(div.querySelector(".turma-topo"));
    for (const b of div.querySelectorAll("[data-t]")) b.onclick = () => abrir(t.id, b.dataset.t);
    return div;
  }

  // chamado pelo desenharDisciplinas (app.js): desenha as turmas e devolve as provas que já entraram nelas
  function desenharCartoes(caixa, instFiltro) {
    const usadas = new Set();
    for (const t of turmas) {
      if (instFiltro && t.instituicao !== instFiltro) continue;
      caixa.appendChild(cartaoTurma(t));
      for (const p of provasDa(t)) usadas.add(p.hash);
    }
    return usadas;
  }

  // ------------------------------------------------------------------ tela da turma
  function abrir(id, qualAba) {
    const t = turmas.find(x => x.id === id);
    if (!t) return;
    aberta = t; abaTurma = qualAba || "agenda"; aulaAberta = null; alunoAberto = "";
    $("#turma-busca").value = "";
    desenhar();
    irPara("turma");
  }

  function desenhar() {
    const t = aberta;
    if (!t) return;
    $("#turma-titulo").textContent = t.disciplina;
    $("#turma-info").textContent = [t.instituicao, t.periodo + "º período", t.semestre].join(" · ");
    $("#tela-turma").className = "tela " + classeInst(t.instituicao);
    for (const b of document.querySelectorAll("#turma-abas button")) b.classList.toggle("ativo", b.dataset.taba === abaTurma);
    $("#turma-busca-campo").hidden = abaTurma !== "alunos";
    const corpo = $("#turma-corpo"); corpo.innerHTML = "";
    if (abaTurma === "agenda") desenharAgenda(t, corpo);
    else if (abaTurma === "alunos") desenharAlunosTurma(t, corpo);
    else if (abaTurma === "aulas") aulaAberta ? desenharAula(t, corpo) : desenharAulas(t, corpo);
    else desenharProvasTurma(t, corpo);
  }

  function desenharAgenda(t, corpo) {
    const geral = agendas.filter(a => a.instituicao === t.instituicao && a.semestre === t.semestre).flatMap(a => a.agenda || []);
    const evs = [...(t.agenda || []).map(e => ({ e, t })), ...geral.map(e => ({ e, inst: t.instituicao }))]
      .sort((a, b) => dataEv(a.e) - dataEv(b.e));
    if (!t.agenda_lida) corpo.insertAdjacentHTML("beforeend", `<p class="turma-conta">A agenda do iCloud não pôde ser lida na última atualização.</p>`);
    if (!evs.length) { corpo.insertAdjacentHTML("beforeend", `<div class="vazio">Nada desta turma na agenda.</div>`); return; }
    const corte = hoje(), futuros = evs.filter(x => dataEv(x.e) >= corte), passados = evs.filter(x => dataEv(x.e) < corte);
    const aulas = evs.filter(x => x.e.tipo === "aula"), dadas = aulas.filter(x => fimEv(x.e) < new Date()).length;
    corpo.insertAdjacentHTML("beforeend", `<p class="turma-conta">${dadas} de ${aulas.length} aulas já dadas neste semestre.</p>`);
    const bloco = (titulo, lista) => {
      const c = document.createElement("div"); c.className = "cartao ini-cartao";
      c.innerHTML = `<div class="titulo-linha"><span class="rotulo">${titulo}</span></div><div class="ini-corpo"></div>`;
      for (const x of lista) c.querySelector(".ini-corpo").appendChild(linhaEvento(x, false));
      return c;
    };
    corpo.appendChild(futuros.length ? bloco("Próximas", futuros) : Object.assign(document.createElement("div"), { className: "vazio", textContent: "Nada marcado daqui para a frente." }));
    if (passados.length) {
      const det = document.createElement("details"); det.className = "turma-passados";
      det.innerHTML = `<summary>Anteriores (${passados.length})</summary>`;
      det.appendChild(bloco("Anteriores", passados.reverse()));
      corpo.appendChild(det);
    }
  }

  // Alunos e notas: as colunas da planilha da turma, agrupadas como nela (1º bimestre, 2º bimestre…)
  const PRINCIPAIS = /^(prova \d|trabalho [\d.]+|3ª prova|média final|nota final)$/i;
  const valorBR = (v) => typeof v === "number" ? numBR(v) : String(v ?? "");

  function desenharAlunosTurma(t, corpo) {
    const busca = Identificacao.normalizarNome($("#turma-busca").value || ""), buscaRa = ($("#turma-busca").value || "").trim();
    const ul = document.createElement("ul"); ul.className = "itens turma-alunos";
    for (const a of t.alunos) {
      if (busca && !Identificacao.normalizarNome(a.nome).includes(busca) && !(buscaRa && String(a.ra).includes(buscaRa))) continue;
      const fichas = t.colunas.map((c, j) => PRINCIPAIS.test(c.nome) && a.notas[j] !== "" ? `<span class="nota-ficha">${esc(c.nome.replace(/^Prova\s*/i, "P").replace(/^Trabalho\s*/i, "T"))} <b>${esc(valorBR(a.notas[j]))}</b></span>` : "").join("");
      const li = document.createElement("li"); li.className = "toque";
      li.innerHTML = `<div class="nome"><span>${esc(a.nome)}</span><small>${a.ra ? "R.A. " + esc(a.ra) : "sem R.A."}</small><div class="notas-aluno">${fichas}</div></div>`;
      li.onclick = () => { alunoAberto = alunoAberto === a.nome ? "" : a.nome; desenhar(); };
      botaoAcessivel(li); li.setAttribute("aria-expanded", alunoAberto === a.nome ? "true" : "false");
      ul.appendChild(li);
      if (alunoAberto === a.nome) {
        const det = document.createElement("li"); det.className = "turma-detalhe";
        let html = "", grupo = null;
        t.colunas.forEach((c, j) => {
          if (c.grupo !== grupo) { grupo = c.grupo; html += `${html ? "</dl>" : ""}<div class="det-grupo">${esc(grupo || "Notas")}</div><dl>`; }
          html += `<dt>${esc(c.nome)}</dt><dd>${a.notas[j] === "" ? "–" : esc(valorBR(a.notas[j]))}</dd>`;
        });
        det.innerHTML = `<div class="nome">${html}</dl></div>`;
        ul.appendChild(det);
      }
    }
    if (!ul.children.length) ul.innerHTML = `<li><div class="vazio">${t.alunos.length ? "Nenhum aluno encontrado." : "A planilha da turma ainda não tem alunos."}</div></li>`;
    corpo.insertAdjacentHTML("beforeend", `<p class="turma-conta">${t.alunos.length} alunos · notas da planilha da turma. Toque num aluno para ver todas as colunas.</p>`);
    corpo.appendChild(ul);
  }

  // Aulas: lista com ementa e tópicos; o texto da aula e o roteiro ao tocar
  function htmlBlocos(blocos, pular) {
    let html = "", i = 0;
    for (const b of blocos) {
      const tx = b[b.length - 1];
      if (i++ < 4 && pular && pular(tx)) continue;
      if (b[0] === "h") html += `<h3>${esc(tx)}</h3>`;
      else if (b[0] === "l") html += `<div class="tp-l n${Math.min(b[1], 4)}">${esc(tx)}</div>`;
      else html += `<p>${esc(tx)}</p>`;
    }
    return html;
  }
  const cabecalhoDoc = (t) => (tx) => /^(roteiro\s*[–-]\s*)?aula\b/i.test(tx) || tx === t.disciplina || /semestre$/i.test(tx);

  function desenharAulas(t, corpo) {
    if (t.plano && t.plano.length) {
      const det = document.createElement("details"); det.className = "cartao turma-plano";
      det.innerHTML = `<summary>Plano de curso</summary><div class="doc">${htmlBlocos(t.plano)}</div>`;
      corpo.appendChild(det);
    }
    const ul = document.createElement("ul"); ul.className = "itens";
    t.aulas.forEach((a, k) => {
      const li = document.createElement("li"); li.className = "toque";
      const tops = (a.topicos || []).map(x => x.replace(/^[IVXLC]+\.\s*/, "")).join(" · ");
      li.innerHTML = `<div class="nome"><span>${esc(a.titulo)}</span><small>${esc(a.ementa || tops || (a.aula ? "" : "Só o roteiro"))}</small></div>`;
      li.onclick = () => { aulaAberta = k; verRoteiro = !a.aula; desenhar(); window.scrollTo(0, 0); };
      botaoAcessivel(li);
      ul.appendChild(li);
    });
    if (!t.aulas.length) ul.innerHTML = `<li><div class="vazio">Nenhuma aula na pasta da disciplina.</div></li>`;
    corpo.appendChild(ul);
    if (t.materiais && t.materiais.length) {
      const det = document.createElement("details"); det.className = "cartao turma-material";
      det.innerHTML = `<summary>Material de apoio (${t.materiais.length})</summary><ul>${t.materiais.map(m => `<li>${esc(m)}</li>`).join("")}</ul>
        <p class="ajuda">Os arquivos ficam na pasta “Material de apoio” da disciplina, no OneDrive.</p>`;
      corpo.appendChild(det);
    }
  }

  function desenharAula(t, corpo) {
    const a = t.aulas[aulaAberta];
    if (!a) { aulaAberta = null; desenharAulas(t, corpo); return; }
    const topo = document.createElement("div"); topo.className = "aula-topo";
    topo.innerHTML = `<button type="button" class="mini">‹ Aulas</button><b>${esc(a.titulo)}</b>`;
    topo.querySelector("button").onclick = () => { aulaAberta = null; desenhar(); };
    corpo.appendChild(topo);
    if (a.aula && a.roteiro) {
      const seg = document.createElement("div"); seg.className = "segmentos";
      seg.innerHTML = `<button type="button" class="${verRoteiro ? "" : "ativo"}" data-v="0">Aula</button><button type="button" class="${verRoteiro ? "ativo" : ""}" data-v="1">Roteiro</button>`;
      for (const b of seg.querySelectorAll("button")) b.onclick = () => { verRoteiro = b.dataset.v === "1"; desenhar(); };
      corpo.appendChild(seg);
    }
    const doc = document.createElement("div"); doc.className = "cartao doc";
    doc.innerHTML = htmlBlocos(verRoteiro ? a.roteiro : a.aula, cabecalhoDoc(t)) || `<div class="vazio">Arquivo vazio.</div>`;
    corpo.appendChild(doc);
    const nav = document.createElement("div"); nav.className = "aula-nav";
    const ant = t.aulas[aulaAberta - 1], prox = t.aulas[aulaAberta + 1];
    nav.innerHTML = `${ant ? `<button type="button" class="mini" data-d="-1">‹ ${esc(ant.titulo)}</button>` : "<span></span>"}${prox ? `<button type="button" class="mini" data-d="1">${esc(prox.titulo)} ›</button>` : ""}`;
    for (const b of nav.querySelectorAll("button")) b.onclick = () => { aulaAberta += +b.dataset.d; verRoteiro = !t.aulas[aulaAberta].aula; desenhar(); window.scrollTo(0, 0); };
    corpo.appendChild(nav);
  }

  function desenharProvasTurma(t, corpo) {
    const ps = provasDa(t);
    const marcadas = (t.agenda || []).filter(e => e.tipo === "prova");
    if (ps.length) {
      const ul = document.createElement("ul"); ul.className = "lista-provas";
      for (const p of ps) ul.appendChild(liProva(p));
      corpo.appendChild(ul);
    } else {
      corpo.insertAdjacentHTML("beforeend", `<div class="vazio">Nenhuma prova desta turma neste aparelho.</div>`);
    }
    if (marcadas.length) {
      const c = document.createElement("div"); c.className = "cartao ini-cartao";
      c.innerHTML = `<div class="titulo-linha"><span class="rotulo">Provas na agenda</span></div><div class="ini-corpo"></div>`;
      for (const e of marcadas) c.querySelector(".ini-corpo").appendChild(linhaEvento({ e, t }, false));
      corpo.appendChild(c);
    }
  }

  // ------------------------------------------------------------------ início
  function cartaoProximasAulas() {
    if (!turmas.length && !agendas.length) return null;
    const c = document.createElement("div"); c.className = "cartao ini-cartao";
    c.innerHTML = `<div class="titulo-linha"><span class="rotulo">Próximas aulas</span><button class="mini" type="button">Turmas</button></div><div class="ini-corpo"></div>`;
    c.querySelector(".mini").onclick = () => { if (window.Navegacao) Navegacao.irModo("disciplinas"); };
    const lista = proximosEventos(6);
    for (const x of lista) c.querySelector(".ini-corpo").appendChild(linhaEvento(x, true));
    if (!lista.length) c.querySelector(".ini-corpo").innerHTML = `<div class="ini-vazio">Nada marcado daqui para a frente.</div>`;
    return c;
  }

  window.Turmas = { lista: () => turmas, provasDa, desenharCartoes, cartaoProximasAulas, abrir, classeInst, carregar };

  window.addEventListener("turmas-mudaram", async () => {
    await carregar();
    if (aberta) { aberta = turmas.find(t => t.id === aberta.id) || null; if (aberta && document.body.dataset.tela === "turma") desenhar(); }
    if (dadosLista && typeof desenharProvas === "function") desenharProvas();
  });
  window.addEventListener("load", async () => {
    $("#turma-voltar").onclick = () => irPara("provas");
    for (const b of document.querySelectorAll("#turma-abas button")) b.onclick = () => { abaTurma = b.dataset.taba; aulaAberta = null; desenhar(); };
    $("#turma-busca").oninput = () => { alunoAberto = ""; desenhar(); };
    await carregar();
    if (dadosLista && typeof desenharProvas === "function") desenharProvas();
  });
})();
