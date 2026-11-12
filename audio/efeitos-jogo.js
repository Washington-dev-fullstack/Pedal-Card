/* =====================================================================
   efeitos-jogo.js — Liga os efeitos sonoros aos momentos do jogo
   ---------------------------------------------------------------------
   O Efeitos.js sabe tocar sons, mas não sabe nada do jogo. Este arquivo
   é o "tradutor" (como o trilha-jogo.js é para a música): o jogo avisa
   o que aconteceu e aqui se decide qual som tocar, com que força, de
   que lado (pan) e se é o seu carro ou o de um bot.

   O jogo avisa com uma linha:  EfeitosJogo.avisar('nome', dados)
     main.js        cartas (selecionar, desmarcar, carta morta), marcha,
                    previsão, acelerar, inválido, erro, sua vez
     ui-mao.js      hover nas cartas, cartas jogadas, cartas chegando
     ui-eventos.js  cada lance da corrida, ANTES da animação dele
     ui-telas.js    cartaz da prova saindo, semáforo, bandeirada, pódio, abrir janela
   E escuta sozinho: cliques em botões (.botao), troca de opções (rádios
   e caixas de marcar) e o fechamento das janelas (<dialog>).

   Regras de conforto que moram aqui (as do som em si estão no Efeitos.js):
     - o carro de um bot soa "do outro lado da mesa" (mais baixo e abafado);
     - o risco de derrapagem só soa quando aparece, não a cada previsão;
     - "Sua vez" não toca logo depois do "VAI!" do semáforo.
   Se algo der errado aqui, o erro vai para o console e o jogo segue.
   ===================================================================== */

var EfeitosJogo = (function () {
  'use strict';

  var MOTIVO = [74, 77, 79, 81];      // Ré5 Fá5 Sol5 Lá5: o motivo "O Motor" da trilha
  var PAN_PISTA = 0.6;                // o quanto o som segue o carro de um lado a outro (1 = tudo)
  var PONTOS_CAMINHO = 24;            // pontos usados para o som acompanhar o movimento
  var SILENCIO_APOS_LARGADA = 1500;   // ms: "Sua vez" não toca logo depois do "VAI!"
  var ATRASO_SUA_VEZ = 0.25;          // s: a faixa "Sua vez" termina de descer (banner-descer, animacoes.css)
                                      // e o som vem depois das cartas novas, não em cima delas
  var TIMBRES_BOTS = [0.88, 1.13];    // o ronco de cada bot (o seu carro é 1)

  var riscoAnterior = false;          // a última previsão mostrava risco de derrapagem?
  var largadaEm = -Infinity;          // quando tocou o "VAI!" (ms)

  // O navegador só deixa tocar som depois que a pessoa clica ou aperta uma
  // tecla. O som é ligado no primeiro gesto (como na trilha).
  function liberarSom() {
    Efeitos.init();
  }

  ['pointerdown', 'keydown', 'touchend'].forEach(function (tipo) {
    document.addEventListener(tipo, liberarSom, true);
  });

  function tocar(nome, opcoes) {
    Efeitos.tocar(nome, opcoes);
  }

  function agora() {
    return window.performance ? performance.now() : Date.now();
  }

  function reduzirMovimento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ------------------------- Cartas e carros ------------------------- */

  // A nota da carta escolhida: as notas sobem pelo motivo e a carta que
  // completa a seleção cai sempre no Lá (ouvido: "a jogada está pronta").
  // Ex.: marcha 2 -> Sol, Lá · marcha 4 -> Ré, Fá, Sol, Lá.
  function notaDaSelecao(ordem, total) {
    var i = MOTIVO.length - total + ordem - 1;
    return MOTIVO[Math.max(0, Math.min(MOTIVO.length - 1, i))];
  }

  // Seu carro soa perto; o de um bot, distante e com ronco próprio
  function somDoCarro(carro) {
    if (!carro || carro.tipo === 'humano') return { distante: false, timbre: 1 };
    var jogo = window.EstadoUI && EstadoUI.jogo;
    var bots = jogo ? jogo.carros.filter(function (c) { return c.tipo !== 'humano'; }) : [];
    var i = bots.map(function (c) { return c.id; }).indexOf(carro.id);
    return { distante: true, timbre: TIMBRES_BOTS[i] || TIMBRES_BOTS[0] };
  }

  // Lado do som (-PAN_PISTA a PAN_PISTA) de uma casa da pista
  function panDaCasa(casa) {
    return window.UIPista && UIPista.panDaCasa ? UIPista.panDaCasa(casa) * PAN_PISTA : 0;
  }

  // Opções de um som que vem de um carro: perto/distante, timbre e lado
  function opcoesDoCarro(carro, extra) {
    var som = somDoCarro(carro);
    var opcoes = { distante: som.distante, timbre: som.timbre, pan: carro ? panDaCasa(carro.posicao) : 0 };
    Object.keys(extra || {}).forEach(function (chave) { opcoes[chave] = extra[chave]; });
    return opcoes;
  }

  // Movimento e rastro: o som recebe a duração da animação e o caminho do
  // carro (posição e lado ao longo do tempo), com a mesma suavização da
  // animação: o ronco sobe quando o carro acelera e cai quando ele freia.
  function mover(nome, ev, carro) {
    if (ev.de === ev.para) return;
    var caminho = [];
    var pans = [];
    for (var i = 0; i < PONTOS_CAMINHO; i++) {
      var posicao = UIPista.suavizar(i / (PONTOS_CAMINHO - 1));
      caminho.push(posicao);
      pans.push(panDaCasa(ev.de + (ev.para - ev.de) * posicao));
    }
    tocar(nome, opcoesDoCarro(carro, {
      duracao: UIPista.duracaoMovimento(ev.de, ev.para) / 1000,
      casas: ev.para - ev.de,
      caminho: caminho,
      pans: pans,
      pan: pans[0]
    }));
  }

  /* ---------------------- Os lances da corrida ---------------------- */

  // Chamado por UIEventos.reproduzir() no começo de cada lance, junto com a animação
  function lanceDaCorrida(ev, carro) {
    var bot = somDoCarro(carro).distante;
    switch (ev.tipo) {
      case 'marcha':
        if (ev.calor_pago > 0) tocar('calor', opcoesDoCarro(carro, { quantidade: ev.calor_pago }));
        // a sua marcha já soou quando você a escolheu; a do bot é a única pista da jogada dele
        if (bot && ev.de !== ev.para) tocar('marcha', opcoesDoCarro(carro, { sobe: ev.para > ev.de }));
        break;
      case 'resfriar':
        tocar('resfriar', opcoesDoCarro(carro));
        break;
      case 'cartas_jogadas':
        if (bot && ev.valores.length) tocar('cartas-jogadas', opcoesDoCarro(carro, { quantidade: ev.valores.length }));
        break;
      case 'mover':
        mover('movimento', ev, carro);
        break;
      case 'vacuo':
        mover('rastro', ev, carro);
        break;
      case 'curva':
        if (ev.calor_pago > 0) tocar('calor', opcoesDoCarro(carro, { quantidade: ev.calor_pago }));
        else if (!bot) tocar('curva-perfeita', opcoesDoCarro(carro));
        break;
      case 'derrapagem':
        tocar('derrapagem', opcoesDoCarro(carro));
        break;
      case 'compra':   // só o seu descarte: o do bot é pouca informação e fica no log
        if (ev.reembaralhou && !bot) tocar('reembaralhar', opcoesDoCarro(carro));
        break;
      case 'nova_rodada':
        tocar('nova-rodada');
        break;
    }
  }

  function humanoVenceu() {
    var jogo = window.EstadoUI && EstadoUI.jogo;
    if (!jogo) return true;
    var vencedor = EstadoUI.buscarCarro(jogo.partida.vencedor_carro_id);
    return !!(vencedor && vencedor.tipo === 'humano');
  }

  function corridaEmAndamento() {
    var jogo = window.EstadoUI && EstadoUI.jogo;
    return !jogo || jogo.partida.status === 'em_andamento';
  }

  function quantosCarros() {
    var jogo = window.EstadoUI && EstadoUI.jogo;
    return jogo ? jogo.carros.length : 3;
  }

  /* ------------------------ O que o jogo avisa ------------------------ */

  var AVISOS = {
    // Cartas
    'carta-hover': function (d) {
      if (window.EstadoUI && EstadoUI.ehMinhaVez()) tocar('carta-hover', { posicao: d.posicao });
    },
    'carta-selecionada': function (d) { tocar('carta-selecionar', { nota: notaDaSelecao(d.ordem, d.total) }); },
    'carta-desmarcada': function () { tocar('carta-desmarcar'); },
    'carta-morta': function () { tocar('carta-morta'); },
    'cartas-jogadas': function (d) { if (d.quantidade > 0) tocar('cartas-jogadas', { quantidade: d.quantidade }); },
    'cartas-chegando': function (d) {   // o mesmo intervalo da animação de distribuir
      if (!corridaEmAndamento()) return;   // na bandeirada, as cartas novas não importam mais
      for (var i = 0; i < d.quantidade; i++) tocar('carta-chegando', { atraso: i * d.intervalo / 1000 });
    },

    // Câmbio e decisão
    'marcha': function (d) { tocar('marcha', { sobe: d.para > d.de }); },
    'previsao': function (d) {   // d = dados da previsão, ou nada quando ela some
      var risco = !!(d && d.derrapa);
      if (risco && !riscoAnterior) tocar('risco-derrapagem');
      riscoAnterior = risco;
    },
    'acelerar': function (d) { tocar('acelerar', { marcha: d.marcha }); },
    'invalido': function () { tocar('invalido'); },
    'erro': function () { tocar('erro'); },

    // Corrida e ritmo da partida
    'lance': function (d) { lanceDaCorrida(d.ev, d.carro); },
    'cartaz-saindo': function () { tocar('modal-abrir'); },   // a mesma folha deslizando das janelas
    'semaforo': function () { tocar('semaforo'); },
    'semaforo-vai': function () {
      largadaEm = agora();
      tocar('semaforo-vai', { carros: quantosCarros() });
    },
    'sua-vez': function () {
      if (agora() - largadaEm > SILENCIO_APOS_LARGADA) tocar('sua-vez', { atraso: ATRASO_SUA_VEZ });
    },
    'bandeirada': function () { tocar('bandeirada', { venceu: humanoVenceu() }); },
    'podio': function (d) { tocar('podio', { lugares: d.lugares, semAnimacao: reduzirMovimento() }); },

    // Interface
    'janela-aberta': function () { tocar('modal-abrir'); }
  };

  function avisar(nome, dados) {
    var acao = AVISOS[nome];
    if (!acao) {
      console.warn('[EfeitosJogo] Aviso desconhecido: "' + nome + '".');
      return;
    }
    try {
      acao(dados || {});
    } catch (erro) {   // o som nunca trava o jogo
      console.warn('[EfeitosJogo] ' + nome + ': ' + erro.message);
    }
  }

  /* -------------------- O que este arquivo escuta -------------------- */
  // Um elemento dentro de [data-sem-som] não ganha estes sons automáticos
  // (ex.: a página de audição, onde cada botão já toca o seu efeito).

  // Botões: um "tock" de cartão. ACELERAR e os "fechar" das janelas têm som próprio.
  document.addEventListener('click', function (evento) {
    var botao = evento.target.closest && evento.target.closest('.botao');
    if (!botao || botao.disabled || botao.id === 'botao-acelerar' || botao.hasAttribute('data-fechar-modal')) return;
    if (botao.closest('[data-sem-som]')) return;
    tocar('botao');
  });

  // Opções (rivais, dificuldade, caixas de marcar): um tique pequeno, mais
  // agudo nas opções da direita. "Efeitos ligados" toca a sua própria amostra.
  document.addEventListener('change', function (evento) {
    var alvo = evento.target;
    if (!alvo.matches || !alvo.matches('input[type=radio], input[type=checkbox]') || alvo.hasAttribute('data-efeitos')) return;
    if (alvo.closest('[data-sem-som]')) return;
    var grupo = alvo.name ? document.getElementsByName(alvo.name) : [alvo];
    tocar('opcao', { indice: Math.max(0, Array.prototype.indexOf.call(grupo, alvo)) });
  });

  // Janelas (<dialog>): o evento "close" não sobe pela página, então é
  // escutado na fase de captura. Vale para o X, para o Esc e para o clique fora.
  document.addEventListener('close', function (evento) {
    if (evento.target.tagName === 'DIALOG') tocar('modal-fechar');
  }, true);

  return {
    avisar: avisar,
    // usados nos testes (efeitos.html)
    notaDaSelecao: notaDaSelecao,
    somDoCarro: somDoCarro
  };
})();
