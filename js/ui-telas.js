/* =====================================================================
   ui-telas.js — Telas, modais, avisos (toasts) e efeitos de tela
   ---------------------------------------------------------------------
   Telas: inicial, jogo e fim. Modais: regras e ranking (<dialog>).
   Também: cartaz da prova, semáforo de largada, bandeirada, pódio,
   ranking e histórico.
   ===================================================================== */

var UITelas = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Avisa os efeitos sonoros (pasta audio/). Sem a pasta, o jogo segue sem som.
  function som(nome, dados) {
    if (window.EfeitosJogo) EfeitosJogo.avisar(nome, dados);
  }

  function reduzirMovimento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function pausa(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Escapa texto digitado pelo usuário antes de colocar em innerHTML
  function escapar(texto) {
    return String(texto).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Telas ---------- */
  function mostrar(nome) {
    document.querySelectorAll('.tela').forEach(function (tela) {
      tela.hidden = tela.id !== 'tela-' + nome;
    });
    EstadoUI.tela = nome;
    if (window.TrilhaJogo) TrilhaJogo.telaMudou(nome);   // avisa a trilha sonora (pasta audio/)
    window.scrollTo(0, 0);
    // leva o foco para o título da tela (ajuda quem usa leitor de tela)
    var titulo = document.querySelector('#tela-' + nome + ' [data-foco-inicial]');
    if (titulo) titulo.focus({ preventScroll: true });
  }

  /* ---------- Modais ---------- */
  // (o som de fechar vem do evento "close" da janela, escutado em audio/efeitos-jogo.js)
  function abrirModal(id) {
    var modal = $(id);
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    som('janela-aberta');
  }

  function fecharModal(id) {
    var modal = $(id);
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  /* ---------- Toasts (avisos rápidos) ---------- */
  // tipo: info | sucesso | erro | perigo | aviso
  // acao (opcional): { texto, funcao } — ex.: botão "Tentar de novo"
  function toast(mensagem, tipo, acao) {
    var area = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast toast-' + (tipo || 'info');
    el.setAttribute('role', tipo === 'erro' || tipo === 'perigo' ? 'alert' : 'status');
    var icone = { erro: Icones.alerta, perigo: Icones.alerta, sucesso: Icones.check, aviso: Icones.alerta }[tipo] || Icones.interrogacao;
    el.innerHTML = '<span class="toast-icone">' + icone + '</span><span class="toast-texto"></span>';
    el.querySelector('.toast-texto').textContent = mensagem;

    if (acao) {
      var botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'botao botao-pequeno';
      botao.textContent = acao.texto;
      botao.addEventListener('click', function () { el.remove(); acao.funcao(); });
      el.appendChild(botao);
    }
    var fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'toast-fechar';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.innerHTML = '&times;';
    fechar.addEventListener('click', function () { el.remove(); });
    el.appendChild(fechar);

    area.appendChild(el);
    while (area.children.length > 3) area.removeChild(area.firstChild);
    // com botão de ação, o aviso fica até o jogador decidir
    if (!acao) setTimeout(function () { el.classList.add('saindo'); setTimeout(function () { el.remove(); }, 300); }, 4200);
  }

  /* ---------- Efeitos ---------- */
  function tremerPista() {
    var area = document.querySelector('.area-pista');
    area.classList.remove('tremor');
    void area.offsetWidth;
    area.classList.add('tremor');
  }

  // Cartaz da prova: pousa na mesa e cobre a troca da tela inicial para o
  // tabuleiro, que é montado por baixo dele. Os tempos batem com as
  // animações do cartaz (animacoes.css).
  var cartazPousouEm = 0;

  function temposCartaz() {
    return reduzirMovimento()
      ? { entrada: 200, leitura: 600, saida: 200 }
      : { entrada: 450, leitura: 700, saida: 400 };
  }

  // info: { circuito, pilotos, curvas }. Resolve quando o cartaz já pousou.
  async function abrirCartaz(info) {
    var caixa = $('cartaz-largada');
    caixa.classList.remove('saindo');
    caixa.hidden = false;
    // o texto entra depois de mostrar a caixa, para o leitor de tela anunciar
    caixa.querySelector('.cartaz-circuito').textContent = info.circuito;
    caixa.querySelector('.cartaz-detalhes').textContent = info.pilotos + ' pilotos · ' + info.curvas + ' curvas';
    await pausa(temposCartaz().entrada);
    cartazPousouEm = Date.now();
  }

  // O cartaz fica o tempo de leitura (contado de quando pousou, não de
  // quando o tabuleiro ficou pronto) e então desliza para fora.
  async function fecharCartaz() {
    var caixa = $('cartaz-largada');
    var tempos = temposCartaz();
    await pausa(Math.max(0, tempos.leitura - (Date.now() - cartazPousouEm)));
    caixa.classList.add('saindo');
    som('cartaz-saindo');
    await pausa(tempos.saida);
    caixa.hidden = true;
    caixa.classList.remove('saindo');
  }

  // Semáforo de largada: 3 luzes vermelhas, depois verde "VAI!"
  async function semaforo() {
    var caixa = $('semaforo');
    var luzes = caixa.querySelectorAll('.luz');
    var texto = caixa.querySelector('.semaforo-texto');
    var tempo = reduzirMovimento() ? 250 : 650;
    luzes.forEach(function (l) { l.className = 'luz'; });
    caixa.hidden = false;
    for (var i = 0; i < 3; i++) {
      texto.textContent = String(3 - i);
      luzes[i].classList.add('vermelha');
      som('semaforo');
      await pausa(tempo);
    }
    luzes.forEach(function (l) { l.className = 'luz verde'; });
    texto.textContent = 'VAI!';
    som('semaforo-vai');
    await pausa(tempo);
    caixa.hidden = true;
  }

  async function bandeirada(texto) {
    var caixa = $('bandeirada');
    caixa.querySelector('.bandeirada-texto').textContent = texto;
    caixa.hidden = false;
    som('bandeirada');
    await pausa(reduzirMovimento() ? 900 : 2200);
    caixa.hidden = true;
  }

  function confete() {
    var area = $('confete');
    area.innerHTML = '';
    if (reduzirMovimento()) return;
    var cores = ['#C63A2B', '#1F6FA0', '#2A9D5C', '#F2B35B', '#F7EEDB', '#E0702F'];
    for (var i = 0; i < 70; i++) {
      var p = document.createElement('span');
      p.className = 'confete-peca';
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cores[i % cores.length];
      p.style.animationDelay = Math.random() * 1.2 + 's';
      p.style.animationDuration = 2.4 + Math.random() * 1.8 + 's';
      p.style.setProperty('--giro', Math.round(Math.random() * 720 - 360) + 'deg');
      area.appendChild(p);
    }
    setTimeout(function () { area.innerHTML = ''; }, 5500);
  }

  /* ---------- Tela de fim ---------- */
  function renderFim(jogo) {
    var r = jogo.resultado;
    var humano = r.classificacao.find(function (c) { return c.tipo === 'humano'; });
    var venceu = humano.colocacao === 1;

    $('fim-titulo').textContent = venceu ? 'VITÓRIA!' : 'BANDEIRADA!';
    $('fim-subtitulo').textContent = venceu
      ? 'Você cruzou a chegada em primeiro em ' + r.rodadas + ' rodadas!'
      : 'Você terminou em ' + humano.colocacao + 'º lugar. Que tal uma revanche?';
    $('tela-fim').classList.toggle('fim-vitoria', venceu);

    // Pódio na ordem visual 2º - 1º - 3º
    var ordemVisual = [2, 1, 3];
    $('podio').innerHTML = ordemVisual.map(function (colocacao) {
      var c = r.classificacao.find(function (x) { return x.colocacao === colocacao; });
      if (!c) return '';
      // a miniatura do carro (render 3/4) sobe no degrau; sem imagem, fica só o selo
      var pintura = pinturaDoCarro(c.cor);
      var miniatura = pintura ? '<img class="podio-carro" src="assets/carros/carro-' + pintura + '-34.webp" alt="" aria-hidden="true">' : '';
      return '<div class="podio-lugar podio-' + colocacao + (c.tipo === 'humano' ? ' podio-humano' : '') + '">' +
        '<div class="podio-piloto">' + miniatura + seloCarroSVG(c, 34) +
        '<span class="podio-nome">' + escapar(c.tipo === 'humano' ? c.nome + ' (você)' : c.nome) + '</span>' +
        '<span class="podio-pontos">' + c.pontos + (c.pontos === 1 ? ' ponto' : ' pontos') + '</span></div>' +
        '<div class="podio-bloco"><span class="podio-numero">' + colocacao + 'º</span>' +
        (colocacao === 1 ? '<span class="podio-trofeu">' + Icones.trofeu + '</span>' : '') + '</div></div>';
    }).join('');
    som('podio', { lugares: r.classificacao.map(function (c) { return c.colocacao; }).filter(function (n) { return n <= 3; }) });

    $('tabela-estatisticas').innerHTML =
      '<caption class="sr-only">Estatísticas finais da corrida</caption>' +
      '<thead><tr><th scope="col">Piloto</th><th scope="col">Lugar</th><th scope="col">Casa</th>' +
      '<th scope="col" title="Calor restante no motor">Calor</th><th scope="col" title="Derrapagens">Derrap.</th><th scope="col">Pontos</th></tr></thead><tbody>' +
      r.classificacao.map(function (c) {
        return '<tr' + (c.tipo === 'humano' ? ' class="linha-humano"' : '') + '>' +
          '<th scope="row">' + seloCarroSVG(c, 20) + ' ' + escapar(c.nome) + '</th>' +
          '<td>' + c.colocacao + 'º</td><td>' + c.posicao + '</td><td>' + c.motor + '</td>' +
          '<td>' + c.derrapagens + '</td><td>' + c.pontos + '</td></tr>';
      }).join('') + '</tbody>';
    $('fim-rodadas').textContent = r.rodadas;

    if (venceu) confete();
  }

  function renderRanking(container, jogadores, nomeDestaque) {
    if (!jogadores.length) {
      container.innerHTML = '<p class="vazio">Nenhuma corrida registrada ainda.</p>';
      return;
    }
    container.innerHTML =
      '<table class="tabela-ranking"><caption class="sr-only">Ranking de pilotos</caption>' +
      '<thead><tr><th scope="col">#</th><th scope="col">Piloto</th><th scope="col">Vitórias</th>' +
      '<th scope="col">Corridas</th><th scope="col">Melhor (rodadas)</th></tr></thead><tbody>' +
      jogadores.map(function (j, i) {
        var destaque = nomeDestaque && j.nome.toLowerCase() === nomeDestaque.toLowerCase();
        return '<tr' + (destaque ? ' class="linha-humano"' : '') + '>' +
          '<td>' + (i === 0 ? '<span class="medalha">' + Icones.trofeu + '</span>' : i + 1) + '</td>' +
          '<th scope="row">' + escapar(j.nome) + '</th><td>' + j.vitorias + '</td><td>' + j.corridas + '</td>' +
          '<td>' + (j.melhor_rodada === null ? '—' : j.melhor_rodada) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderHistorico(container, jogadas) {
    var minhas = jogadas.filter(function (j) { return j.tipo === 'humano'; });
    if (!minhas.length) {
      container.innerHTML = '<p class="vazio">Sem jogadas registradas.</p>';
      return;
    }
    container.innerHTML =
      '<table class="tabela-historico"><caption class="sr-only">Suas jogadas nesta corrida</caption>' +
      '<thead><tr><th scope="col">Rodada</th><th scope="col">Marcha</th><th scope="col">Veloc.</th>' +
      '<th scope="col">Casas</th><th scope="col">Calor</th><th scope="col">Derrapou</th></tr></thead><tbody>' +
      minhas.map(function (j) {
        return '<tr><td>' + j.rodada + '</td><td>' + j.marcha + '</td><td>' + j.velocidade + '</td>' +
          '<td>' + j.posicao_inicial + ' → ' + j.posicao_final + '</td><td>' + (j.calor_pago ? '−' + j.calor_pago : '0') + '</td>' +
          '<td>' + (j.derrapou ? '<span class="tag-perigo">' + Icones.alerta + ' sim</span>' : 'não') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function carregando(container, texto) {
    container.innerHTML = '<p class="vazio"><span class="spinner" aria-hidden="true"></span> ' + (texto || 'Carregando…') + '</p>';
  }

  function erroComRetry(container, mensagem, funcao) {
    container.innerHTML = '<p class="aviso aviso-perigo">' + Icones.alerta + ' <span></span></p>' +
      '<button type="button" class="botao botao-pequeno">Tentar de novo</button>';
    container.querySelector('span').textContent = mensagem;
    container.querySelector('button').addEventListener('click', funcao);
  }

  return {
    mostrar: mostrar,
    abrirModal: abrirModal,
    fecharModal: fecharModal,
    toast: toast,
    tremerPista: tremerPista,
    abrirCartaz: abrirCartaz,
    fecharCartaz: fecharCartaz,
    semaforo: semaforo,
    bandeirada: bandeirada,
    renderFim: renderFim,
    renderRanking: renderRanking,
    renderHistorico: renderHistorico,
    carregando: carregando,
    erroComRetry: erroComRetry,
    escapar: escapar
  };
})();
