/* =====================================================================
   ui-mao.js — Mão de cartas do jogador
   ---------------------------------------------------------------------
   - Cartas de Velocidade: selecionáveis (clique, toque ou teclado).
   - Cartas de Calor: "mortas", com chama + rótulo CALOR + listras,
     nunca identificadas só pela cor.
   - Teclado: setas movem o foco, Espaço seleciona, Enter confirma.
   ===================================================================== */

var UIMao = (function () {
  'use strict';

  var container = null;
  var idsAnteriores = [];   // para animar só as cartas que acabaram de chegar
  var INTERVALO_DISTRIBUIR = 70;   // ms entre uma carta nova e a próxima (animação e som)
  var idHover = null;       // carta sob o mouse (o som de hover toca só ao trocar de carta)

  // Avisa os efeitos sonoros (pasta audio/). Sem a pasta, o jogo segue sem som.
  function som(nome, dados) {
    if (window.EfeitosJogo) EfeitosJogo.avisar(nome, dados);
  }

  // Velocidade em ordem crescente e Calor no fim: facilita a leitura.
  function ordenar(mao) {
    return mao.slice().sort(function (a, b) {
      if (a.tipo !== b.tipo) return a.tipo === 'velocidade' ? -1 : 1;
      return a.valor - b.valor || a.id - b.id;
    });
  }

  // Nome temático de cada carta de Velocidade (impresso na carta)
  var NOMES = { 1: 'Tração', 2: 'Ritmo', 3: 'Embalo', 4: 'Pé no fundo' };

  // "leque": posição da carta na mão abre as cartas como numa mão de verdade
  function estiloLeque(indice, total) {
    var meio = (total - 1) / 2;
    var distancia = indice - meio;
    return ' style="--giro:' + (distancia * 2.2).toFixed(1) + 'deg; --desce:' + (distancia * distancia * 1.4).toFixed(1) + 'px"';
  }

  function htmlCarta(carta, selecionada, bloqueada, leque) {
    if (carta.tipo === 'calor') {
      return '<button type="button" class="carta carta-calor" data-id="' + carta.id + '" aria-disabled="true"' + leque +
        ' aria-label="Carta de Calor: carta morta, não pode ser jogada">' +
        '<span class="carta-face">' +
        '<span class="carta-topo"><span class="carta-icone">' + Icones.chama + '</span></span>' +
        arteDaCarta(carta) +
        '<span class="carta-nome">Superaquecido</span>' +
        '<span class="carta-tipo">Calor</span>' +
        '<span class="carimbo" aria-hidden="true">Carta morta</span>' +
        '</span></button>';
    }
    var chevrons = '';
    for (var i = 0; i < carta.valor; i++) chevrons += '<span class="chevron"></span>';
    return '<button type="button" class="carta carta-velocidade carta-valor-' + carta.valor + (selecionada ? ' selecionada' : '') + '"' +
      ' data-id="' + carta.id + '" aria-pressed="' + selecionada + '"' + (bloqueada ? ' aria-disabled="true"' : '') + leque +
      ' aria-label="Carta de Velocidade ' + carta.valor + ' (' + NOMES[carta.valor] + ')' + (selecionada ? ', selecionada' : '') + '">' +
      '<span class="carta-face">' +
      '<span class="carta-topo"><span class="carta-numero">' + carta.valor + '</span>' +
      '<span class="carta-chevrons" aria-hidden="true">' + chevrons + '</span></span>' +
      arteDaCarta(carta) +
      '<span class="carta-nome">' + NOMES[carta.valor] + '</span>' +
      '<span class="carta-tipo">Velocidade</span>' +
      '</span>' +
      '<span class="carta-marca" aria-hidden="true">' + Icones.check + '</span>' +
      '</button>';
  }

  function render(estado) {
    container = container || document.getElementById('mao');
    var instrucao = document.getElementById('instrucao-mao');
    if (!estado.jogo) { container.innerHTML = ''; return; }

    var focoAntes = document.activeElement && document.activeElement.closest && document.activeElement.closest('.carta');
    var idFoco = focoAntes ? focoAntes.getAttribute('data-id') : null;

    var bloqueada = !estado.ehMinhaVez();
    var mao = ordenar(estado.jogo.minha_mao);
    container.innerHTML = mao.map(function (carta, i) {
      return htmlCarta(carta, estado.selecionadas.indexOf(carta.id) !== -1, bloqueada, estiloLeque(i, mao.length));
    }).join('');
    container.classList.toggle('mao-bloqueada', bloqueada);

    // Animação de "distribuir" só nas cartas novas
    var botoes = container.querySelectorAll('.carta');
    var novas = 0;
    botoes.forEach(function (botao) {
      var id = Number(botao.getAttribute('data-id'));
      if (idsAnteriores.length && idsAnteriores.indexOf(id) === -1) {
        botao.classList.add('carta-nova');
        botao.style.animationDelay = novas * INTERVALO_DISTRIBUIR + 'ms';
        novas++;
      }
    });
    if (novas) som('cartas-chegando', { quantidade: novas, intervalo: INTERVALO_DISTRIBUIR });
    idsAnteriores = mao.map(function (c) { return c.id; });

    // Tabindex "itinerante": só uma carta entra na ordem do Tab; setas navegam.
    var alvo = (idFoco && container.querySelector('.carta[data-id="' + idFoco + '"]')) || botoes[0];
    botoes.forEach(function (b) { b.tabIndex = b === alvo ? 0 : -1; });
    if (idFoco && alvo) alvo.focus({ preventScroll: true });

    // Instrução acima das cartas
    var necessarias = estado.cartasNecessarias();
    if (estado.jogo.partida.status !== 'em_andamento') {
      instrucao.textContent = 'Corrida encerrada.';
    } else if (bloqueada) {
      instrucao.textContent = 'Aguarde a sua vez…';
    } else if (necessarias === 0) {
      instrucao.textContent = 'Sem cartas de Velocidade: você vai jogar 0 cartas.';
    } else {
      instrucao.innerHTML = 'Marcha ' + estado.marcha + ': escolha <strong>' + necessarias + '</strong> ' +
        (necessarias === 1 ? 'carta' : 'cartas') + ' <span class="contador-selecao">(' +
        estado.selecionadas.length + '/' + necessarias + ')</span>';
    }
  }

  // Animação de "jogar" as cartas escolhidas (antes da resposta do servidor)
  function animarJogada(ids) {
    ids.forEach(function (id) {
      var carta = container && container.querySelector('.carta[data-id="' + id + '"]');
      if (carta) carta.classList.add('carta-jogada');
    });
    som('cartas-jogadas', { quantidade: ids.length });
  }

  // Som de hover: a altura depende da posição da carta no leque (0 = esquerda, 1 = direita)
  function avisarHover(carta) {
    var botoes = Array.prototype.slice.call(container.querySelectorAll('.carta'));
    var indice = botoes.indexOf(carta);
    som('carta-hover', { posicao: botoes.length > 1 ? indice / (botoes.length - 1) : 0.5 });
  }

  function tremer() {
    if (!container) return;
    container.classList.remove('mao-tremor');
    void container.offsetWidth; // reinicia a animação CSS
    container.classList.add('mao-tremor');
  }

  // Liga cliques e teclado. Os callbacks vêm do main.js.
  function ligarEventos(aoClicarCarta, aoConfirmar) {
    container = document.getElementById('mao');

    container.addEventListener('click', function (evento) {
      var carta = evento.target.closest('.carta');
      if (carta) aoClicarCarta(Number(carta.getAttribute('data-id')));
    });

    // Passar o mouse pelas cartas. Só mouse: no toque, o "hover" chega junto com o
    // clique. A carta é lembrada pelo id porque a mão é redesenhada a cada clique.
    container.addEventListener('pointerover', function (evento) {
      var carta = evento.target.closest('.carta');
      if (evento.pointerType !== 'mouse' || !carta || carta.getAttribute('data-id') === idHover) return;
      idHover = carta.getAttribute('data-id');
      avisarHover(carta);
    });
    container.addEventListener('pointerleave', function () { idHover = null; });

    container.addEventListener('keydown', function (evento) {
      var atual = evento.target.closest('.carta');
      if (!atual) return;
      var botoes = Array.prototype.slice.call(container.querySelectorAll('.carta'));
      var indice = botoes.indexOf(atual);
      var proximo = null;

      if (evento.key === 'ArrowRight' || evento.key === 'ArrowDown') proximo = botoes[(indice + 1) % botoes.length];
      if (evento.key === 'ArrowLeft' || evento.key === 'ArrowUp') proximo = botoes[(indice - 1 + botoes.length) % botoes.length];
      if (evento.key === 'Home') proximo = botoes[0];
      if (evento.key === 'End') proximo = botoes[botoes.length - 1];

      if (proximo) {
        evento.preventDefault();
        botoes.forEach(function (b) { b.tabIndex = -1; });
        proximo.tabIndex = 0;
        proximo.focus();
        proximo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        avisarHover(proximo);   // pelas setas, o mesmo som do mouse
      } else if (evento.key === 'Enter') {
        // Enter confirma a jogada; Espaço (padrão do botão) seleciona a carta
        evento.preventDefault();
        aoConfirmar();
      }
    });
  }

  return {
    render: render,
    animarJogada: animarJogada,
    tremer: tremer,
    ligarEventos: ligarEventos
  };
})();
