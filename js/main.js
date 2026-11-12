/* =====================================================================
   main.js — Liga tudo: botões, formulário, teclado e fluxo da partida
   ---------------------------------------------------------------------
   Fluxo principal:
     iniciarPartida()  -> Api.iniciarPartida -> cartaz da prova -> semáforo -> sua vez
     escolher marcha/cartas -> atualizarPrevisao() -> Api.preverJogada
     confirmarJogada() -> Api.jogarTurno -> reproduz eventos -> sua vez
     fim da corrida    -> tela de fim + ranking + histórico
   ===================================================================== */

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Avisa os efeitos sonoros (pasta audio/). Sem a pasta, o jogo segue sem som.
  function som(nome, dados) {
    if (window.EfeitosJogo) EfeitosJogo.avisar(nome, dados);
  }

  var temporizadorPrevisao = null;
  var contadorPrevisao = 0;   // descarta respostas antigas da previsão

  /* =========================== TELA INICIAL =========================== */

  function lerFormulario() {
    var form = $('form-inicio');
    return {
      nome: form.elements.nome.value.trim(),
      numBots: Number(form.elements.bots.value),
      dificuldade: form.elements.dificuldade.value
    };
  }

  function validarNome(nome) {
    var erro = $('erro-nome');
    var campo = $('nome-jogador');
    var mensagem = '';
    if (nome.length < 2) mensagem = 'Digite um nome com pelo menos 2 caracteres.';
    else if (nome.length > 20) mensagem = 'Use no máximo 20 caracteres.';
    erro.textContent = mensagem;
    erro.hidden = !mensagem;
    campo.setAttribute('aria-invalid', mensagem ? 'true' : 'false');
    if (mensagem) campo.focus();
    return !mensagem;
  }

  async function iniciarPartida() {
    var config = EstadoUI.config;
    var botao = $('botao-jogar');
    var textoOriginal = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Preparando o grid…';

    var resposta;
    try {
      resposta = await Api.iniciarPartida({
        nome_jogador: config.nome,
        num_bots: config.numBots,
        dificuldade: config.dificuldade
      });
    } catch (erro) {
      botao.disabled = false;
      botao.innerHTML = textoOriginal;
      if (EstadoUI.tela !== 'inicial') UITelas.mostrar('inicial');
      som('erro');
      UITelas.toast(erro.mensagem, 'erro', erro.rede ? { texto: 'Tentar de novo', funcao: iniciarPartida } : null);
      return;
    }

    // O cartaz da prova pousa sobre a tela e cobre a troca para o tabuleiro.
    // O botão só volta depois dele, para não largar duas vezes.
    var nomePista = resposta.pista.nome || 'Circuito da Serra';
    await UITelas.abrirCartaz({ circuito: nomePista, pilotos: resposta.carros.length, curvas: resposta.pista.curvas.length });
    botao.disabled = false;
    botao.innerHTML = textoOriginal;

    // Monta a tela de jogo. Usamos uma CÓPIA para desenhar o grid, porque
    // ela será alterada durante a animação; a resposta original fica intacta.
    EstadoUI.reiniciar();
    EstadoUI.aplicarEstado(JSON.parse(JSON.stringify(resposta)));
    EstadoUI.ocupado = true;
    UIHud.reiniciarMotor();
    UIEventos.limparLog();
    UITelas.mostrar('jogo');

    var humano = EstadoUI.carroHumano();
    UIPista.criar($('pista'), resposta.pista, humano.id);

    // Se bots largaram na frente e já jogaram, os carros começam no grid
    // (a casa "de" do primeiro movimento de cada um) e a animação mostra a jogada.
    var eventos = resposta.eventos || [];
    var carrosNoGrid = EstadoUI.jogo.carros.map(function (c) {
      var primeiro = eventos.find(function (ev) { return ev.tipo === 'mover' && ev.carro_id === c.id; });
      c.posicao = primeiro ? primeiro.de : c.posicao;
      return c;
    });
    carrosNoGrid.forEach(function (c) {
      var bot = eventos.some(function (ev) { return ev.carro_id === c.id && ev.tipo === 'marcha'; });
      if (bot) { c.marcha = 1; c.motor = CONFIG.REGRAS.CALOR_MOTOR; }
    });
    UIPista.posicionarCarros(carrosNoGrid);
    EstadoUI.render();
    UIHud.banner('Prepare-se para a largada!', 'info');
    UIEventos.adicionarLog('Rodada 1', 'log-rodada');
    UIEventos.adicionarLog('Grid formado: ' + (resposta.carros.length - 1) + (resposta.carros.length > 2 ? ' rivais' : ' rival') +
      ', dificuldade ' + { facil: 'fácil', medio: 'médio', dificil: 'difícil' }[config.dificuldade] + '.', '');
    UIEventos.adicionarLog('Pista de hoje: ' + nomePista + ', com ' + resposta.pista.curvas.length + ' curvas.', '');

    await UITelas.fecharCartaz();
    await UITelas.semaforo();
    if (eventos.length) await UIEventos.reproduzir(eventos);

    EstadoUI.aplicarEstado(resposta);
    EstadoUI.ocupado = false;
    UIPista.posicionarCarros(EstadoUI.jogo.carros);
    comecarMinhaVez();
  }

  /* ============================ SUA VEZ ============================ */

  function comecarMinhaVez() {
    UIHud.banner('Sua vez', 'humano');
    som('sua-vez');
    EstadoUI.render();
    atualizarPrevisao();
    var primeiraCarta = document.querySelector('#mao .carta');
    if (primeiraCarta && EstadoUI.tela === 'jogo' && !document.querySelector('dialog[open]')) {
      primeiraCarta.focus({ preventScroll: true });
    }
  }

  function escolherMarcha(marcha) {
    if (!EstadoUI.ehMinhaVez()) return;
    var opcao = EstadoUI.opcaoMarcha(marcha);
    if (!opcao || !opcao.permitida) {
      som('invalido');
      UITelas.toast(opcao ? opcao.motivo : 'Marcha inválida.', 'aviso');
      return;
    }
    if (marcha !== EstadoUI.marcha) som('marcha', { de: EstadoUI.marcha, para: marcha });
    EstadoUI.marcha = marcha;
    // se tinha mais cartas selecionadas do que a nova marcha permite, corta o excesso
    var necessarias = EstadoUI.cartasNecessarias();
    if (EstadoUI.selecionadas.length > necessarias) {
      EstadoUI.selecionadas = EstadoUI.selecionadas.slice(0, necessarias);
    }
    atualizarPrevisao();
  }

  function clicarCarta(cartaId) {
    if (!EstadoUI.ehMinhaVez()) {
      som('invalido');
      UITelas.toast('Aguarde a sua vez.', 'info');
      return;
    }
    var carta = EstadoUI.jogo.minha_mao.find(function (c) { return c.id === cartaId; });
    if (!carta) return;
    if (carta.tipo === 'calor') {
      som('carta-morta');
      UITelas.toast('Cartas de Calor são "mortas": não podem ser jogadas. Use a marcha 1 para devolvê-las ao motor.', 'aviso');
      UIMao.tremer();
      return;
    }

    var indice = EstadoUI.selecionadas.indexOf(cartaId);
    var necessarias = EstadoUI.cartasNecessarias();
    if (indice !== -1) {
      EstadoUI.selecionadas.splice(indice, 1);
      som('carta-desmarcada');
    } else if (EstadoUI.selecionadas.length < necessarias) {
      EstadoUI.selecionadas.push(cartaId);
      som('carta-selecionada', { ordem: EstadoUI.selecionadas.length, total: necessarias });
    } else if (necessarias === 1) {
      EstadoUI.selecionadas = [cartaId]; // na marcha 1, clicar em outra carta troca a escolha
      som('carta-selecionada', { ordem: 1, total: 1 });
    } else {
      som('invalido');
      UIMao.tremer();
      UITelas.toast('Na marcha ' + EstadoUI.marcha + ' você joga ' + necessarias + ' cartas. Desmarque uma para trocar.', 'aviso');
      return;
    }
    atualizarPrevisao();
  }

  // Pede a previsão ao "servidor" quando a seleção está completa.
  function atualizarPrevisao() {
    clearTimeout(temporizadorPrevisao);
    contadorPrevisao++;
    var humano = EstadoUI.carroHumano();

    if (!EstadoUI.ehMinhaVez() || EstadoUI.selecionadas.length !== EstadoUI.cartasNecessarias()) {
      EstadoUI.previsao = { situacao: 'vazia', dados: null, mensagem: '' };
      UIPista.esconderPrevisao();
      som('previsao', null);
      EstadoUI.render();
      return;
    }

    EstadoUI.previsao = { situacao: 'carregando', dados: null, mensagem: '' };
    EstadoUI.render();
    var meuNumero = contadorPrevisao;

    temporizadorPrevisao = setTimeout(async function () {
      try {
        var dados = await Api.preverJogada({
          partida_id: EstadoUI.partidaId,
          marcha: EstadoUI.marcha,
          cartas: EstadoUI.selecionadas.slice()
        });
        if (meuNumero !== contadorPrevisao) return; // a seleção mudou nesse meio-tempo
        EstadoUI.previsao = { situacao: 'ok', dados: dados, mensagem: '' };
        var tipo = dados.derrapa ? 'perigo' : (dados.calor_previsto > 0 ? 'alerta' : 'ok');
        UIPista.mostrarPrevisao(humano.posicao, dados.destino, tipo, dados.vacuo ? 'rastro +' + (dados.vacuo.para - dados.vacuo.de) : '');
        som('previsao', dados);
      } catch (erro) {
        if (meuNumero !== contadorPrevisao) return;
        EstadoUI.previsao = { situacao: 'erro', dados: null, mensagem: erro.mensagem };
        UIPista.esconderPrevisao();
        som('previsao', null);
      }
      EstadoUI.render();
    }, 120);
  }

  async function confirmarJogada() {
    if (!EstadoUI.podeConfirmar()) {
      if (EstadoUI.ehMinhaVez()) {
        som('invalido');
        var faltam = EstadoUI.cartasNecessarias() - EstadoUI.selecionadas.length;
        UITelas.toast(faltam > 0 ? 'Escolha mais ' + faltam + (faltam === 1 ? ' carta.' : ' cartas.') : 'Aguarde a previsão da jogada.', 'aviso');
      }
      return;
    }
    contadorPrevisao++; // ignora previsões que ainda estejam a caminho
    var jogada = {
      partida_id: EstadoUI.partidaId,
      marcha: EstadoUI.marcha,
      cartas: EstadoUI.selecionadas.slice()
    };

    EstadoUI.ocupado = true;
    UIHud.banner('Enviando jogada…', 'carregando');
    som('acelerar', { marcha: jogada.marcha });
    EstadoUI.render();
    UIMao.animarJogada(jogada.cartas);

    var resposta;
    try {
      resposta = await Api.jogarTurno(jogada);
    } catch (erro) {
      // Erro nunca trava o jogo: mostra a mensagem e mantém a seleção
      EstadoUI.ocupado = false;
      UIHud.banner('Sua vez', 'humano');
      EstadoUI.render();
      atualizarPrevisao();
      som('erro');
      UITelas.toast(erro.mensagem, 'erro', erro.rede ? { texto: 'Tentar de novo', funcao: confirmarJogada } : null);
      return;
    }

    EstadoUI.selecionadas = [];
    UIPista.esconderPrevisao();
    await UIEventos.reproduzir(resposta.eventos);

    EstadoUI.aplicarEstado(resposta.estado);
    UIPista.posicionarCarros(EstadoUI.jogo.carros);

    if (EstadoUI.jogo.partida.status === 'finalizada') {
      EstadoUI.render();
      await terminarCorrida();
    } else {
      EstadoUI.ocupado = false;
      comecarMinhaVez();
    }
  }

  /* ========================= FIM DA CORRIDA ========================= */

  async function terminarCorrida() {
    var jogo = EstadoUI.jogo;
    var vencedor = EstadoUI.buscarCarro(jogo.partida.vencedor_carro_id);
    UIHud.banner('Bandeirada!', 'info');
    await UITelas.bandeirada(vencedor.tipo === 'humano' ? 'VOCÊ VENCEU!' : vencedor.nome.toUpperCase() + ' VENCEU!');
    EstadoUI.ocupado = false;
    UITelas.mostrar('fim');
    UITelas.renderFim(jogo);
    carregarRankingFim();
    carregarHistoricoFim();
  }

  async function carregarRankingFim() {
    var caixa = $('ranking-fim');
    UITelas.carregando(caixa, 'Consultando ranking…');
    try {
      var resposta = await Api.ranking(10);
      UITelas.renderRanking(caixa, resposta.jogadores, EstadoUI.config.nome);
    } catch (erro) {
      UITelas.erroComRetry(caixa, erro.mensagem, carregarRankingFim);
    }
  }

  async function carregarHistoricoFim() {
    var caixa = $('historico-fim');
    UITelas.carregando(caixa, 'Carregando jogadas…');
    try {
      var resposta = await Api.historico(EstadoUI.partidaId);
      UITelas.renderHistorico(caixa, resposta.jogadas);
    } catch (erro) {
      UITelas.erroComRetry(caixa, erro.mensagem, carregarHistoricoFim);
    }
  }

  async function abrirRanking() {
    var caixa = $('ranking-modal-conteudo');
    UITelas.abrirModal('modal-ranking');
    UITelas.carregando(caixa, 'Consultando ranking…');
    try {
      var resposta = await Api.ranking(10);
      UITelas.renderRanking(caixa, resposta.jogadores, EstadoUI.config.nome);
    } catch (erro) {
      UITelas.erroComRetry(caixa, erro.mensagem, abrirRanking);
    }
  }

  function voltarAoInicio() {
    EstadoUI.reiniciar();
    UITelas.mostrar('inicial');
  }

  /* ============================ EVENTOS ============================ */

  function ligarEventos() {
    $('form-inicio').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var dados = lerFormulario();
      if (!validarNome(dados.nome)) return;
      EstadoUI.config = dados;
      iniciarPartida();
    });
    $('nome-jogador').addEventListener('input', function () {
      if (!$('erro-nome').hidden) validarNome(this.value.trim());
    });

    $('botao-regras-inicio').addEventListener('click', function () { UITelas.abrirModal('modal-regras'); });
    $('botao-regras-jogo').addEventListener('click', function () { UITelas.abrirModal('modal-regras'); });
    $('botao-ranking-inicio').addEventListener('click', abrirRanking);
    document.querySelectorAll('[data-fechar-modal]').forEach(function (botao) {
      botao.addEventListener('click', function () { UITelas.fecharModal(botao.getAttribute('data-fechar-modal')); });
    });
    // clicar fora da caixa do modal também fecha
    document.querySelectorAll('dialog').forEach(function (modal) {
      modal.addEventListener('click', function (evento) {
        if (evento.target === modal) UITelas.fecharModal(modal.id);
      });
    });

    $('seletor-marcha').addEventListener('click', function (evento) {
      var botao = evento.target.closest('.marcha-opcao');
      if (botao && !botao.disabled) escolherMarcha(Number(botao.getAttribute('data-marcha')));
    });
    UIMao.ligarEventos(clicarCarta, confirmarJogada);
    $('botao-acelerar').addEventListener('click', confirmarJogada);

    $('botao-sair').addEventListener('click', function () {
      if (EstadoUI.ocupado) return;
      if (window.confirm('Abandonar a corrida? O progresso desta partida será perdido.')) voltarAoInicio();
    });
    $('botao-nova-partida').addEventListener('click', function () {
      UITelas.mostrar('inicial');
      iniciarPartida();
    });
    $('botao-voltar-inicio').addEventListener('click', voltarAoInicio);

    // Atalhos de teclado na tela de jogo: 1 a 4 escolhem a marcha
    document.addEventListener('keydown', function (evento) {
      if (EstadoUI.tela !== 'jogo' || document.querySelector('dialog[open]')) return;
      if (evento.target.tagName === 'INPUT' || evento.ctrlKey || evento.altKey || evento.metaKey) return;
      if (/^[1-4]$/.test(evento.key)) {
        evento.preventDefault();
        escolherMarcha(Number(evento.key));
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    ligarEventos();
    UITelas.mostrar('inicial');
  });
})();
