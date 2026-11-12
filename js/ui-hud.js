/* =====================================================================
   ui-hud.js — Informações do jogo e tabuleiro do piloto
   ---------------------------------------------------------------------
   Topo (rodada, ordem da rodada, vez), câmbio em H, motor com cubos
   de Calor, pilhas de cartas, previsão (bloco de notas), botão
   ACELERAR, classificação e faixa de "quem está jogando".
   Tudo é desenhado a partir do EstadoUI.
   ===================================================================== */

var UIHud = (function () {
  'use strict';

  var motorAnterior = null;

  function $(id) { return document.getElementById(id); }

  function nomeDificuldade(d) {
    return { facil: 'fácil', medio: 'médio', dificil: 'difícil' }[d] || '';
  }

  function idDaVez(estado) {
    return estado.vezAnimada || estado.jogo.partida.turno_de;
  }

  /* ---------- Topo: rodada, ordem da rodada e vez ---------- */
  function renderTopo(estado) {
    var jogo = estado.jogo;
    var humano = estado.carroHumano();
    var idVez = idDaVez(estado);
    $('hud-rodada').textContent = jogo.partida.rodada;

    var carroVez = estado.buscarCarro(idVez);
    if (jogo.partida.status === 'finalizada') {
      $('hud-vez').textContent = 'Fim da corrida';
    } else if (carroVez) {
      $('hud-vez').innerHTML = seloCarroSVG(carroVez, 20) + '<span></span>';
      $('hud-vez').lastChild.textContent = carroVez.id === humano.id ? 'Você' : carroVez.nome;
    }

    // Trilha de ordem da rodada: fichas na ordem em que jogam
    var ordenados = jogo.carros.slice().sort(function (a, b) { return a.ordem - b.ordem; });
    var posVez = carroVez ? carroVez.ordem : 0;
    $('ordem-rodada').innerHTML = ordenados.map(function (c) {
      var classes = 'ordem-slot' + (c.id === idVez && jogo.partida.status === 'em_andamento' ? ' na-vez' : '') +
        (c.ordem < posVez ? ' ja-jogou' : '');
      return '<li class="' + classes + '" aria-label="' + c.ordem + 'º a jogar: ' + (c.id === humano.id ? 'você' : c.nome) + '">' +
        '<span class="ordem-pos" aria-hidden="true">' + c.ordem + '</span>' + seloCarroSVG(c, 26) + '</li>';
    }).join('');
  }

  /* ---------- Câmbio em H ---------- */
  function renderMarchas(estado) {
    var seletor = $('seletor-marcha');
    var humano = estado.carroHumano();
    var bloqueado = !estado.ehMinhaVez();
    seletor.innerHTML = estado.jogo.minhas_opcoes.marchas.map(function (op) {
      var info;
      if (!op.permitida) info = Icones.cadeado + '<span>bloq.</span>';
      else if (op.marcha === humano.marcha) info = '<span>atual</span>';
      else if (op.custo_calor > 0) info = '<span class="cubo-texto"></span><span>−' + op.custo_calor + '</span>';
      else info = '<span>grátis</span>';
      if (op.resfria && op.permitida) info += '<span class="icone-frio">' + Icones.floco + '</span>';

      var selecionada = op.marcha === estado.marcha;
      var classes = 'marcha-opcao' +
        (selecionada ? ' selecionada' : '') +
        (op.custo_calor > 0 && op.permitida ? ' com-custo' : '') +
        (op.marcha === humano.marcha ? ' atual' : '');
      var rotulo = 'Marcha ' + op.marcha +
        (op.marcha === humano.marcha ? ' (atual)' : '') +
        (op.permitida ? (op.custo_calor > 0 ? ', custa ' + op.custo_calor + ' Calor' : ', grátis') : ', bloqueada: ' + op.motivo) +
        (op.resfria ? ', resfria o motor' : '');
      return '<button type="button" class="' + classes + '" data-marcha="' + op.marcha + '"' +
        ' role="radio" aria-checked="' + selecionada + '" aria-label="' + rotulo + '"' +
        (op.permitida ? '' : ' title="' + op.motivo + '"') +
        (!op.permitida || bloqueado ? ' disabled' : '') + '>' +
        '<span class="marcha-numero">' + op.marcha + '</span>' +
        '<span class="marcha-info">' + info + '</span></button>';
    }).join('');
  }

  /* ---------- Motor: cubos de Calor ---------- */
  function renderMotor(estado) {
    var humano = estado.carroHumano();
    var maximo = CONFIG.REGRAS.CALOR_MOTOR;
    var motor = $('medidor-calor');
    var html = '';
    for (var i = 0; i < maximo; i++) {
      var cheio = i < humano.motor;
      var saiu = !cheio && motorAnterior !== null && i < motorAnterior;
      var chegou = cheio && motorAnterior !== null && i >= motorAnterior;
      html += '<span class="slot-calor' + (saiu ? ' queimando' : '') + '">' +
        (cheio ? '<span class="cubo-madeira' + (chegou ? ' chegando' : '') + '"></span>' : '') + '</span>';
    }
    motor.innerHTML = html;
    motor.setAttribute('aria-valuenow', humano.motor);
    motor.setAttribute('aria-valuetext', humano.motor + ' de ' + maximo + ' cubos de Calor no motor');
    motor.classList.toggle('motor-critico', humano.motor <= 1);
    $('motor-numero').textContent = humano.motor + '/' + maximo;
    motorAnterior = humano.motor;
  }

  /* ---------- Pilhas: baralho, descarte, calor na mão ---------- */
  function espessura(quantidade) {
    // cada carta vira 1px de "altura" da pilha (até 8)
    var camadas = [];
    for (var i = 1; i <= Math.min(8, quantidade); i++) {
      camadas.push(i + 'px ' + i + 'px 0 ' + (i % 2 ? '#D8CAAC' : '#FBF6EA'));
    }
    camadas.push('0 6px 10px rgba(0,0,0,.25)');
    return ' style="box-shadow:' + camadas.join(',') + '"';
  }

  function renderPilhas(estado) {
    var b = estado.jogo.baralho;
    $('info-baralho').innerHTML =
      '<div class="pilha" title="Cartas no baralho de compra">' +
      '<span class="pilha-cartas ' + (b.compra ? 'pilha-verso' : 'pilha-vazia') + '"' + (b.compra ? espessura(b.compra) : '') + '></span>' +
      '<span class="pilha-rotulo">Baralho <strong>' + b.compra + '</strong></span></div>' +
      '<div class="pilha" title="Cartas na pilha de descarte">' +
      '<span class="pilha-cartas ' + (b.descarte ? 'pilha-face' : 'pilha-vazia') + '"' + (b.descarte ? espessura(b.descarte) : '') + '></span>' +
      '<span class="pilha-rotulo">Descarte <strong>' + b.descarte + '</strong></span></div>' +
      '<div class="pilha pilha-calor" title="Cartas de Calor presas na sua mão (mortas)">' +
      '<span class="pilha-cartas">' + Icones.chama + '</span>' +
      '<span class="pilha-rotulo">Na mão <strong>' + b.calor_na_mao + '</strong></span></div>';
  }

  /* ---------- Previsão (bloco de notas) ---------- */
  function renderPrevisao(estado) {
    var caixa = $('previsao');
    var p = estado.previsao;
    var necessarias = estado.cartasNecessarias();

    if (!estado.ehMinhaVez()) {
      caixa.innerHTML = '<p class="previsao-vazia">A previsão aparece na sua vez.</p>';
      return;
    }
    if (p.situacao === 'carregando') {
      caixa.innerHTML = '<p class="previsao-vazia"><span class="spinner" aria-hidden="true"></span> Calculando…</p>';
      return;
    }
    if (p.situacao === 'erro') {
      caixa.innerHTML = '<p class="aviso aviso-perigo">' + Icones.alerta + ' <span></span></p>';
      caixa.querySelector('span').textContent = p.mensagem;
      return;
    }
    if (p.situacao !== 'ok') {
      var faltam = necessarias - estado.selecionadas.length;
      caixa.innerHTML = '<p class="previsao-vazia">Escolha ' + (faltam > 0 && faltam < necessarias ? 'mais ' + faltam : necessarias) +
        (faltam === 1 ? ' carta' : ' cartas') + ' para ver a previsão.</p>';
      return;
    }

    var d = p.dados;
    var avisos = [];
    if (d.derrapa) {
      avisos.push('<li class="aviso aviso-perigo">' + Icones.alerta + ' <span>Risco de derrapagem na curva ' +
        d.derrapagem.casa + ': precisa de ' + d.derrapagem.calor_necessario + ' Calor e terá ' + d.derrapagem.calor_disponivel + '.</span></li>');
    }
    if (d.calor_previsto > 0) {
      var partes = [];
      if (d.custo_marcha > 0) partes.push('câmbio −' + d.custo_marcha);
      d.curvas.forEach(function (c) { if (c.calor_pago > 0) partes.push('curva ' + c.casa + ' −' + c.calor_pago); });
      avisos.push('<li class="aviso aviso-calor">' + Icones.chama + ' <span>Vai pagar <strong>' + d.calor_previsto +
        '</strong> de Calor (' + partes.join(', ') + ').</span></li>');
    }
    d.curvas.forEach(function (c) {
      if (c.calor_pago === 0) {
        avisos.push('<li class="aviso aviso-ok">' + Icones.check + ' <span>Curva ' + c.casa + ' dentro do limite (' + c.limite + ').</span></li>');
      }
    });
    if (d.resfria) avisos.push('<li class="aviso aviso-frio">' + Icones.floco + ' <span>Marcha 1: o motor recupera 1 Calor.</span></li>');
    if (d.ajuste_ocupacao) {
      avisos.push('<li class="aviso">' + Icones.alerta + ' <span>Casa ' + Math.min(d.destino_pretendido, estado.jogo.pista.total_casas - 1) +
        ' ocupada: você para na casa ' + (d.vacuo ? d.vacuo.de : d.destino) + '.</span></li>');
    }
    if (d.vacuo) {
      var daFrente = estado.buscarCarro(d.vacuo.atras_de);
      avisos.push('<li class="aviso aviso-vacuo">' + Icones.velocidade + ' <span><strong>Rastro</strong> do ' + UITelas.escapar(daFrente.nome) +
        ': +' + (d.vacuo.para - d.vacuo.de) + ' casas (' + d.vacuo.de + ' → ' + d.vacuo.para + ').</span></li>');
    }
    if (d.chega) avisos.push('<li class="aviso aviso-ok">' + Icones.bandeira + ' <span><strong>Cruza a linha de chegada!</strong></span></li>');
    if (!avisos.length) avisos.push('<li class="aviso aviso-ok">' + Icones.check + ' <span>Pista livre, sem custo de Calor.</span></li>');

    caixa.innerHTML =
      '<div class="previsao-numeros">' +
      '<div><span class="rotulo">Velocidade</span><strong>' + d.velocidade + '</strong></div>' +
      '<div><span class="rotulo">Destino</span><strong>casa ' + d.destino + '</strong></div>' +
      '<div class="' + (d.calor_previsto > 0 ? 'numero-calor' : '') + '"><span class="rotulo">Calor</span><strong>' +
      (d.calor_previsto > 0 ? '−' + d.calor_previsto : '0') + '</strong></div>' +
      '</div><ul class="lista-avisos">' + avisos.join('') + '</ul>';
  }

  /* ---------- Botão ACELERAR ---------- */
  function renderBotao(estado) {
    var botao = $('botao-acelerar');
    var dica = $('dica-acao');
    var pronto = estado.podeConfirmar();
    var perigo = pronto && estado.previsao.dados && estado.previsao.dados.derrapa;
    botao.disabled = !pronto;
    botao.classList.toggle('perigo', !!perigo);

    if (estado.ocupado) {
      botao.innerHTML = '<span class="spinner" aria-hidden="true"></span> Aguarde';
      dica.textContent = 'Os rivais estão jogando…';
    } else if (!estado.ehMinhaVez()) {
      botao.innerHTML = 'Aguarde';
      dica.textContent = '';
    } else {
      botao.innerHTML = Icones.velocidade + (perigo ? ' Acelerar assim mesmo' : ' Acelerar');
      dica.textContent = pronto ? 'Atalho: Enter' : 'Escolha a marcha e as cartas.';
    }
  }

  /* ---------- Classificação ---------- */
  function renderClassificacao(estado) {
    var lista = $('classificacao');
    var jogo = estado.jogo;
    var idVez = idDaVez(estado);
    var ultima = jogo.pista.total_casas - 1;
    var ordenados = jogo.carros.slice().sort(function (a, b) {
      if (a.chegada_posicao && b.chegada_posicao) return a.chegada_posicao - b.chegada_posicao;
      return b.posicao - a.posicao || a.id - b.id;
    });
    lista.innerHTML = ordenados.map(function (c, i) {
      var humano = c.tipo === 'humano';
      var progresso = Math.round(c.posicao / ultima * 100);
      return '<li class="classif-item' + (humano ? ' humano' : '') + (c.id === idVez && jogo.partida.status === 'em_andamento' ? ' na-vez' : '') + '">' +
        '<span class="classif-pos">' + (i + 1) + 'º</span>' +
        seloCarroSVG(c, 28) +
        '<span class="classif-nome">' + UITelas.escapar(c.nome) +
        (humano ? ' <small>você</small>' : ' <small>' + nomeDificuldade(c.dificuldade) + '</small>') + '</span>' +
        '<span class="classif-barra" role="img" aria-label="' + progresso + '% da pista"><span style="width:' + progresso + '%;background:' + c.cor + '"></span></span>' +
        '<span class="classif-dados">' +
        '<span title="Casa">casa <strong>' + c.posicao + '</strong></span>' +
        '<span title="Marcha">marcha <strong>' + c.marcha + '</strong></span>' +
        '<span title="Calor no motor" class="dado-calor">' + Icones.chama + '<strong>' + c.motor + '</strong></span>' +
        (c.derrapagens ? '<span title="Derrapagens" class="dado-derrapagem">' + Icones.alerta + '<strong>' + c.derrapagens + '</strong></span>' : '') +
        '</span></li>';
    }).join('');
  }

  /* ---------- Faixa de quem está jogando ---------- */
  function banner(texto, tipo) {
    var el = $('banner-vez');
    el.className = 'banner-vez banner-' + (tipo || 'info');
    el.innerHTML = (tipo === 'bot' || tipo === 'carregando' ? '<span class="spinner" aria-hidden="true"></span>' : '') +
      '<span></span>';
    el.lastChild.textContent = texto;
  }

  function render(estado) {
    if (!estado.jogo) return;
    renderTopo(estado);
    renderMarchas(estado);
    renderMotor(estado);
    renderPilhas(estado);
    renderPrevisao(estado);
    renderBotao(estado);
    renderClassificacao(estado);
  }

  // Durante a animação dos eventos: atualiza só o que muda
  function renderParcial(estado) {
    if (!estado.jogo) return;
    renderTopo(estado);
    renderMotor(estado);
    renderClassificacao(estado);
  }

  function reiniciarMotor() { motorAnterior = null; }

  return {
    render: render,
    renderParcial: renderParcial,
    banner: banner,
    reiniciarMotor: reiniciarMotor
  };
})();
