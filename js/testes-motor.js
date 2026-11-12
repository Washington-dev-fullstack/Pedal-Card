/* =====================================================================
   testes-motor.js — Testes automáticos do motor de regras
   ---------------------------------------------------------------------
   Duas partes, usadas pelo testes.html:
   1. rodar(): corridas inteiras sem interface conferindo as INVARIANTES
      (coisas que nunca podem acontecer) e cenários de regra montados à mão.
   2. relatorioEquilibrio(): mede se o jogo está equilibrado (a largada não
      decide tudo, os bots gastam Calor, as dificuldades são diferentes)
      e compara com o motor original ("antes") e com as metas do briefing.
   ===================================================================== */

var TestesMotor = (function () {
  'use strict';

  var R = CONFIG.REGRAS;

  function contar(carro, tipo) {
    return ['compra', 'mao', 'descarte', 'motor'].reduce(function (soma, pilha) {
      return soma + carro[pilha].filter(function (c) { return c.tipo === tipo; }).length;
    }, 0);
  }

  function verificarInvariantes(partida, falhas, contexto) {
    var ocupadas = {};
    partida.carros.forEach(function (c) {
      var onde = contexto + ' carro ' + c.id;
      if (c.mao.length !== R.TAMANHO_MAO) falhas.push(onde + ': mão com ' + c.mao.length + ' cartas');
      if (contar(c, 'calor') !== R.CALOR_MOTOR) falhas.push(onde + ': total de Calor = ' + contar(c, 'calor'));
      if (contar(c, 'velocidade') !== R.VALORES_VELOCIDADE.length * R.COPIAS_POR_VALOR) falhas.push(onde + ': total de Velocidade errado');
      if (c.motor.some(function (x) { return x.tipo !== 'calor'; })) falhas.push(onde + ': carta de Velocidade no motor');
      if (c.posicao < 0 || c.posicao > partida.pista.total_casas - 1) falhas.push(onde + ': posição fora da pista ' + c.posicao);
      if (c.marcha < R.MARCHA_MIN || c.marcha > R.MARCHA_MAX) falhas.push(onde + ': marcha inválida ' + c.marcha);
      if (ocupadas[c.posicao]) falhas.push(contexto + ': dois carros na casa ' + c.posicao);
      ocupadas[c.posicao] = true;
    });
  }

  // Rastro (vácuo): anda para a frente, no máximo VACUO_CASAS casas, e nunca atravessa curva
  function verificarRastro(partida, eventos, falhas, contexto) {
    eventos.forEach(function (ev) {
      if (ev.tipo !== 'vacuo') return;
      var casas = ev.para - ev.de;
      if (casas < 1 || casas > R.VACUO_CASAS) falhas.push(contexto + ': rastro de ' + casas + ' casas');
      partida.pista.curvas.forEach(function (curva) {
        if (ev.de < curva.casa && ev.para >= curva.casa) falhas.push(contexto + ': rastro atravessou a curva ' + curva.casa);
      });
    });
  }

  function esperarErro(funcao, codigo, falhas, descricao) {
    try {
      funcao();
      falhas.push('Deveria recusar: ' + descricao);
    } catch (e) {
      if (!(e instanceof MotorRegras.ErroJogo) || e.codigo !== codigo) {
        falhas.push('Erro errado em "' + descricao + '": ' + (e.codigo || e));
      }
    }
  }

  function humanoDe(p) { return p.carros.find(function (c) { return c.tipo === 'humano'; }); }

  // Testes de jogadas inválidas (o servidor tem que bloquear)
  function testarValidacoes(falhas) {
    var p = MotorRegras.criarPartida(9999, { nome_jogador: 'Teste', num_bots: 2, dificuldade: 'medio', semente: 9999 });
    MotorRegras.iniciarCorrida(p);
    var h = humanoDe(p);
    var velocidade = h.mao.filter(function (c) { return c.tipo === 'velocidade'; });

    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 5, []); }, 'MARCHA_INVALIDA', falhas, 'marcha 5');
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 4, []); }, 'MARCHA_INVALIDA', falhas, 'pular 3 marchas (1 → 4)');
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 1, []); }, 'CARTAS_INVALIDAS', falhas, 'marcha 1 sem cartas');
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 2, [velocidade[0].id, velocidade[0].id]); }, 'CARTAS_INVALIDAS', falhas, 'carta repetida');
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 1, [123456]); }, 'CARTAS_INVALIDAS', falhas, 'carta que não está na mão');
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 2, [velocidade[0].id]); }, 'CARTAS_INVALIDAS', falhas, 'poucas cartas para a marcha');

    // Carta de Calor na mão não pode ser jogada
    h.mao[0] = h.motor.pop();
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 1, [h.mao[0].id]); }, 'CARTAS_INVALIDAS', falhas, 'jogar carta de Calor');

    // Pular 2 marchas com motor vazio
    var guardado = h.motor.splice(0);
    esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 3, [velocidade[0].id, velocidade[1].id, velocidade[2].id]); }, 'MARCHA_INVALIDA', falhas, 'pular 2 marchas sem Calor');
    h.motor = guardado;

    esperarErro(function () { MotorRegras.criarPartida(1, { nome_jogador: 'A', num_bots: 2, dificuldade: 'medio' }); }, 'NOME_INVALIDO', falhas, 'nome curto');
    esperarErro(function () { MotorRegras.criarPartida(1, { nome_jogador: 'Ana', num_bots: 3, dificuldade: 'medio' }); }, 'BOTS_INVALIDOS', falhas, '3 bots');
  }

  /* ---------- Cenários montados à mão ---------- */

  // Partida na pista clássica (curvas 10:5, 18:4, 26:6, 34:3 e 41:5) com o
  // humano jogando primeiro. "posicoes" = [humano, bot 1, bot 2 (opcional)].
  function montarCenario(posicoes) {
    var p = MotorRegras.criarPartida(8888, { nome_jogador: 'Teste', num_bots: posicoes.length - 1, dificuldade: 'dificil', semente: 8888 });
    p.pista = MotorRegras.pistaClassica();
    var h = humanoDe(p);
    var bots = p.carros.filter(function (c) { return c.tipo === 'bot'; });
    h.posicao = posicoes[0];
    bots.forEach(function (b, i) { b.posicao = posicoes[i + 1]; });
    p.ordem = [h.id].concat(bots.map(function (b) { return b.id; }));
    p.indiceVez = 0;
    p.turno_de = h.id;
    return { p: p, h: h, bot: bots[0], bot2: bots[1] };
  }

  // Dá ao carro uma mão que começa com as cartas pedidas; devolve os ids delas.
  function darMao(carro, valores) {
    var todas = carro.compra.concat(carro.mao, carro.descarte);
    var nova = [];
    valores.forEach(function (v) {
      var i = todas.findIndex(function (c) { return c.tipo === 'velocidade' && c.valor === v; });
      nova.push(todas.splice(i, 1)[0]);
    });
    carro.mao = nova.concat(todas.splice(0, R.TAMANHO_MAO - nova.length));
    carro.compra = todas;
    carro.descarte = [];
    return nova.map(function (c) { return c.id; });
  }

  function eventoDo(eventos, tipo, carroId) {
    return eventos.find(function (e) { return e.tipo === tipo && e.carro_id === carroId; });
  }

  // Regras originais: curva, derrapagem, resfriar e ocupação
  function testarCenarios(falhas) {
    // Curva: velocidade 7 na curva 10 (limite 5) paga 2 de Calor
    var c = montarCenario([5, 0]);
    c.h.marcha = 2;
    var ids = darMao(c.h, [4, 3]);
    var ev = MotorRegras.jogarTurnoHumano(c.p, 2, ids);
    var curva = eventoDo(ev, 'curva', c.h.id);
    if (!curva || curva.calor_pago !== 2) falhas.push('Cenário curva: esperava pagar 2 de Calor');
    if (c.h.posicao !== 12) falhas.push('Cenário curva: esperava casa 12, ficou ' + c.h.posicao);

    // Derrapagem: sem Calor no motor, para na casa 9 e volta para marcha 1
    c = montarCenario([5, 0]);
    c.h.marcha = 2;
    ids = darMao(c.h, [4, 3]);
    c.h.descarte = c.h.descarte.concat(c.h.motor.splice(0));
    MotorRegras.jogarTurnoHumano(c.p, 2, ids);
    if (c.h.posicao !== 9) falhas.push('Cenário derrapagem: esperava casa 9, ficou ' + c.h.posicao);
    if (c.h.derrapagens !== 1) falhas.push('Cenário derrapagem: contador não aumentou');

    // Resfriar: na marcha 1, Calor da mão volta ao motor
    c = montarCenario([5, 0]);
    c.h.marcha = 1;
    ids = darMao(c.h, [1]);
    var calor = c.h.motor.pop();
    c.h.mao[c.h.mao.length - 1] = calor;
    var motorAntes = c.h.motor.length;
    MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.motor.length !== motorAntes + 1) falhas.push('Cenário resfriar: motor não recebeu 1 Calor');

    // Ocupação: destino ocupado faz recuar para a casa livre anterior.
    // (O rival fica na casa 9, colado na curva 10, onde o rastro não vale;
    // assim o teste confere só a ocupação.)
    c = montarCenario([5, 9]);
    c.h.marcha = 1;
    ids = darMao(c.h, [4]);
    MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 8) falhas.push('Cenário ocupação: esperava casa 8, ficou ' + c.h.posicao);
  }

  // Regra nova: rastro (vácuo)
  function testarRastro(falhas) {
    // Rastro básico: para na 13, colado no rival da 14, e é puxado 3 casas até a 16
    var c = montarCenario([11, 14, 0]);
    c.h.marcha = 1;
    var ids = darMao(c.h, [2]);
    var ev = MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    var rastro = eventoDo(ev, 'vacuo', c.h.id);
    var mover = eventoDo(ev, 'mover', c.h.id);
    if (c.h.posicao !== 16) falhas.push('Rastro básico: esperava casa 16, ficou ' + c.h.posicao);
    if (!rastro || rastro.de !== 13 || rastro.para !== 16 || rastro.atras_de !== c.bot.id) falhas.push('Rastro básico: evento vacuo errado');
    if (!mover || mover.para !== 13) falhas.push('Rastro básico: o evento mover deve parar na casa 13 (antes do rastro)');
    if (ev.indexOf(rastro) < ev.indexOf(mover)) falhas.push('Rastro básico: o evento vacuo deve vir depois do mover');

    // Previsão mostra o mesmo rastro que o turno de verdade
    c = montarCenario([11, 14, 0]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    var previsao = MotorRegras.preverJogada(c.p, 1, ids);
    if (previsao.destino !== 16 || !previsao.vacuo || previsao.vacuo.de !== 13 || previsao.vacuo.para !== 16) {
      falhas.push('Rastro na previsão: esperava destino 16 com vacuo 13 → 16');
    }

    // Não atravessa curva: da 15 seria puxado até a 18 (curva), mas para na 17
    c = montarCenario([13, 16, 0]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 17) falhas.push('Rastro antes da curva: esperava casa 17, ficou ' + c.h.posicao);

    // Colado num carro que está antes da curva: não há casa livre na reta, sem rastro
    c = montarCenario([14, 17, 0]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    ev = MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 16 || eventoDo(ev, 'vacuo', c.h.id)) falhas.push('Rastro na boca da curva: esperava ficar na 16 sem rastro');

    // Casa livre mais distante: a 16 está ocupada, então o rastro leva até a 15
    c = montarCenario([11, 14, 16]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 15) falhas.push('Rastro com casa ocupada: esperava casa 15, ficou ' + c.h.posicao);

    // Bloqueado: todas as casas até a curva ocupadas, sem rastro
    c = montarCenario([14, 16, 17]);
    c.h.marcha = 1;
    ids = darMao(c.h, [1]);
    ev = MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 15 || eventoDo(ev, 'vacuo', c.h.id)) falhas.push('Rastro bloqueado: esperava ficar na 15 sem rastro');

    // Quem derrapa não pega rastro (mesmo com um carro colado na frente)
    c = montarCenario([5, 10, 0]);
    c.h.marcha = 2;
    ids = darMao(c.h, [4, 3]);
    c.h.descarte = c.h.descarte.concat(c.h.motor.splice(0));
    ev = MotorRegras.jogarTurnoHumano(c.p, 2, ids);
    if (c.h.posicao !== 9 || eventoDo(ev, 'vacuo', c.h.id)) falhas.push('Rastro após derrapagem: esperava ficar na 9 sem rastro');

    // Quem não andou não pega rastro: 13 e 14 ocupadas, fica na 12
    c = montarCenario([12, 13, 14]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    ev = MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 12 || eventoDo(ev, 'vacuo', c.h.id)) falhas.push('Rastro sem andar: esperava ficar na 12 sem rastro');

    // Ocupação + rastro: mira a 7 (ocupada), para na 6 e o rastro leva à 9
    c = montarCenario([5, 7, 0]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    ev = MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 9 || !eventoDo(ev, 'ajuste_ocupacao', c.h.id) || !eventoDo(ev, 'vacuo', c.h.id)) {
      falhas.push('Ocupação + rastro: esperava ajuste para a 6 e rastro até a 9, ficou ' + c.h.posicao);
    }

    // Rastro até a chegada: para na 44 colado no rival da 45 e cruza a chegada
    c = montarCenario([42, 45, 0]);
    c.h.marcha = 1;
    ids = darMao(c.h, [2]);
    MotorRegras.jogarTurnoHumano(c.p, 1, ids);
    if (c.h.posicao !== 47 || c.p.vencedor_carro_id !== c.h.id) falhas.push('Rastro na chegada: esperava vencer na casa 47');
  }

  // Semente: mesma semente = mesma corrida; semente_pista = mesma pista
  function testarSemente(falhas) {
    function corridaCompleta(semente) {
      var p = MotorRegras.criarPartida(1, { nome_jogador: 'Teste', num_bots: 2, dificuldade: 'medio', semente: semente });
      MotorRegras.iniciarCorrida(p);
      var h = humanoDe(p);
      var guarda = 0;
      while (p.status === 'em_andamento' && guarda++ < 300) {
        var e = MotorRegras.escolherJogadaBot(p, h);
        MotorRegras.jogarTurnoHumano(p, e.marcha, e.cartas);
      }
      return JSON.stringify({ pista: p.pista, jogadas: p.jogadas, vencedor: p.vencedor_carro_id });
    }
    if (corridaCompleta(4242) !== corridaCompleta(4242)) falhas.push('Semente: a mesma semente gerou corridas diferentes');
    if (corridaCompleta(4242) === corridaCompleta(4243)) falhas.push('Semente: sementes diferentes geraram a mesma corrida');

    var a = MotorRegras.criarPartida(1, { nome_jogador: 'Teste', num_bots: 1, dificuldade: 'medio', semente: 11, semente_pista: 123456 });
    var b = MotorRegras.criarPartida(2, { nome_jogador: 'Teste', num_bots: 1, dificuldade: 'medio', semente: 22, semente_pista: 123456 });
    if (JSON.stringify(a.pista) !== JSON.stringify(b.pista)) falhas.push('Semente: a mesma semente_pista gerou pistas diferentes');
    var classica = MotorRegras.criarPartida(3, { nome_jogador: 'Teste', num_bots: 1, dificuldade: 'medio', semente_pista: 1 });
    if (JSON.stringify(classica.pista.curvas) !== JSON.stringify(R.CURVAS)) falhas.push('Semente: semente_pista 1 deveria ser a pista clássica');
  }

  // Bots: gastam Calor quando vale, erram sem derrapar de propósito
  function testarBots(falhas) {
    // Bot difícil paga Calor para cruzar a chegada: da 38, velocidade 9 passa
    // pela curva 41 (limite 5) pagando 4 e vence na hora
    var c = montarCenario([0, 38]);
    c.bot.marcha = 3;
    darMao(c.bot, [4, 3, 2, 1, 1, 1]);
    var escolha = MotorRegras.escolherJogadaBot(c.p, c.bot);
    var cartas = escolha.cartas.map(function (id) { return c.bot.mao.find(function (x) { return x.id === id; }); });
    var sim = MotorRegras.simularJogada(c.p, c.bot, escolha.marcha, cartas);
    if (!sim.chegou || sim.calorTotal === 0) falhas.push('Bot difícil: deveria gastar Calor para cruzar a chegada neste turno');

    // Fácil e médio erram de propósito, mas nunca escolhem derrapar quando há jogada segura
    ['facil', 'medio'].forEach(function (dificuldade) {
      var d = montarCenario([0, 6]);
      d.bot.dificuldade = dificuldade;
      d.bot.marcha = 3;
      darMao(d.bot, [4, 4, 4, 3, 3, 1, 1]);
      d.bot.descarte = d.bot.descarte.concat(d.bot.motor.splice(0)); // motor vazio: curva 10 a mais de 5 derrapa
      var tipos = {};
      for (var i = 0; i < 60; i++) {
        var e = MotorRegras.escolherJogadaBot(d.p, d.bot);
        var cs = e.cartas.map(function (id) { return d.bot.mao.find(function (x) { return x.id === id; }); });
        var s = MotorRegras.simularJogada(d.p, d.bot, e.marcha, cs);
        if (s.derrapou) { falhas.push('Bot ' + dificuldade + ': escolheu derrapar tendo jogada segura'); break; }
        tipos[e.marcha + ':' + cs.map(function (x) { return x.valor; }).join(',')] = true;
      }
      if (Object.keys(tipos).length < 2) falhas.push('Bot ' + dificuldade + ': deveria variar a jogada (erro de propósito)');
    });
  }

  // Pistas sorteadas: espaçamento das curvas e limites dentro das regras
  function testarPistas(falhas) {
    var S = R.PISTA_SORTEIO;
    var formatos = {};
    for (var n = 0; n < 500; n++) {
      var pista = MotorRegras.criarPartida(n + 1, { nome_jogador: 'Teste', num_bots: 1, dificuldade: 'medio', semente: n + 1 }).pista;
      var casas = pista.curvas.map(function (c) { return c.casa; });
      formatos[casas.join(',')] = true;
      if (!R.PISTA_ALEATORIA) continue;
      if (casas.length < S.CURVAS_MIN || casas.length > S.CURVAS_MAX) falhas.push('Pista ' + n + ': ' + casas.length + ' curvas');
      if (!MotorRegras.curvasValidas(casas)) falhas.push('Pista ' + n + ': curvas mal espaçadas ' + casas.join(','));
      pista.curvas.forEach(function (c) {
        if (c.limite < S.LIMITE_MIN || c.limite > S.LIMITE_MAX) falhas.push('Pista ' + n + ': limite ' + c.limite);
      });
      if (!pista.nome || !pista.semente) falhas.push('Pista ' + n + ': sem nome ou semente');
    }
    return Object.keys(formatos).length;
  }

  function rodar(quantidade) {
    var falhas = [];
    var vitorias = {};
    var rodadas = 0;
    var derrapagens = 0;
    var rastros = 0;
    var maiorRodada = 0;
    var tempoBot = { total: 0, jogadas: 0, maximo: 0 };

    testarValidacoes(falhas);
    testarCenarios(falhas);
    testarRastro(falhas);
    testarSemente(falhas);
    testarBots(falhas);
    var pistasDiferentes = testarPistas(falhas);

    for (var n = 0; n < quantidade; n++) {
      var dificuldade = ['facil', 'medio', 'dificil'][n % 3];
      var p = MotorRegras.criarPartida(n + 1, { nome_jogador: 'Simulado', num_bots: n % 4 === 0 ? 1 : 2, dificuldade: dificuldade, semente: n + 1 });
      verificarRastro(p, MotorRegras.iniciarCorrida(p), falhas, 'Corrida ' + (n + 1) + ' largada');
      verificarInvariantes(p, falhas, 'Corrida ' + (n + 1) + ' largada');

      var anteriores = {};
      var turnos = 0;
      while (p.status === 'em_andamento') {
        var humano = humanoDe(p);
        var inicio = performance.now();
        var escolha = MotorRegras.escolherJogadaBot(p, humano); // o "humano" joga como bot difícil
        var tempo = performance.now() - inicio;
        tempoBot.total += tempo;
        tempoBot.jogadas++;
        tempoBot.maximo = Math.max(tempoBot.maximo, tempo);

        p.carros.forEach(function (c) { anteriores[c.id] = c.posicao; });
        var eventos = MotorRegras.jogarTurnoHumano(p, escolha.marcha, escolha.cartas);
        p.carros.forEach(function (c) {
          if (c.posicao < anteriores[c.id]) falhas.push('Corrida ' + (n + 1) + ': carro ' + c.id + ' andou para trás');
        });
        rastros += eventos.filter(function (e) { return e.tipo === 'vacuo'; }).length;
        verificarRastro(p, eventos, falhas, 'Corrida ' + (n + 1) + ' rodada ' + p.rodada);
        verificarInvariantes(p, falhas, 'Corrida ' + (n + 1) + ' rodada ' + p.rodada);
        if (++turnos > 300) { falhas.push('Corrida ' + (n + 1) + ' não terminou'); break; }
      }

      // Depois do fim, nenhuma jogada é aceita
      esperarErro(function () { MotorRegras.jogarTurnoHumano(p, 1, []); }, 'PARTIDA_ENCERRADA', falhas, 'jogar após o fim');

      var vencedor = p.carros.find(function (c) { return c.id === p.vencedor_carro_id; });
      var chave = vencedor.tipo === 'humano' ? 'humano (bot difícil)' : 'bot ' + dificuldade;
      vitorias[chave] = (vitorias[chave] || 0) + 1;
      rodadas += p.rodada;
      maiorRodada = Math.max(maiorRodada, p.rodada);
      derrapagens += p.carros.reduce(function (s, c) { return s + c.derrapagens; }, 0);
    }

    if (tempoBot.maximo > 50) falhas.push('Bot difícil demorou ' + tempoBot.maximo.toFixed(0) + ' ms numa jogada (limite: 50 ms)');

    var relatorio = [
      'Corridas simuladas: ' + quantidade,
      'Rodadas por corrida: média ' + (rodadas / quantidade).toFixed(1) + ', máximo ' + maiorRodada,
      'Derrapagens por corrida (todos os carros): ' + (derrapagens / quantidade).toFixed(2),
      'Rastros (vácuo) por corrida: ' + (rastros / quantidade).toFixed(2),
      'Vitórias: ' + Object.keys(vitorias).map(function (k) { return k + ' = ' + vitorias[k]; }).join(', '),
      'Tempo do bot difícil por jogada: média ' + (tempoBot.total / tempoBot.jogadas).toFixed(2) + ' ms, máximo ' + tempoBot.maximo.toFixed(1) + ' ms',
      'Pistas sorteadas: ' + pistasDiferentes + ' traçados diferentes em 500 partidas',
      'Validações de jogadas inválidas e cenários de regra: ' + (falhas.length ? 'ver problemas' : 'ok')
    ];
    return { falhas: falhas, relatorio: relatorio };
  }

  /* =====================================================================
     RELATÓRIO DE EQUILÍBRIO
     ===================================================================== */

  // Jogador de referência: a avaliação ORIGINAL dos bots (antes da Etapa 1),
  //   nota = avanço − 0,5 × Calor líquido − 100 × derrapagem,
  // sempre com a melhor nota. Fica CONGELADA aqui para servir de régua: se
  // os bots mudarem, a régua não muda. Ela joga pelas regras atuais, porque
  // usa a simularJogada() do motor.
  function combinacoes(lista, k) {
    if (k === 0) return [[]];
    var resultado = [];
    for (var i = 0; i <= lista.length - k; i++) {
      combinacoes(lista.slice(i + 1), k - 1).forEach(function (resto) {
        resultado.push([lista[i]].concat(resto));
      });
    }
    return resultado;
  }

  function jogadaReferencia(partida, carro) {
    var velocidadeNaMao = carro.mao.filter(function (c) { return c.tipo === 'velocidade'; });
    var vistas = {};
    var melhor = null;
    MotorRegras.opcoesDeMarcha(carro).forEach(function (op) {
      if (!op.permitida) return;
      var n = Math.min(op.marcha, velocidadeNaMao.length);
      combinacoes(velocidadeNaMao, n).forEach(function (combo) {
        // Cartas de mesmo valor dão o mesmo resultado: avalia só a primeira
        var chave = op.marcha + ':' + combo.map(function (c) { return c.valor; }).sort().join(',');
        if (vistas[chave]) return;
        vistas[chave] = true;
        var sim = MotorRegras.simularJogada(partida, carro, op.marcha, combo);
        var calorLiquido = sim.calorTotal - (sim.resfria ? 1 : 0);
        var nota = (sim.final - sim.inicial) - 0.5 * calorLiquido - 100 * (sim.derrapou ? 1 : 0);
        if (!melhor || nota > melhor.nota) {
          melhor = { nota: nota, marcha: op.marcha, cartas: combo.map(function (c) { return c.id; }) };
        }
      });
    });
    return melhor;
  }

  // Cenários do relatório. "todos" = quem pilota todos os carros; sem "todos",
  // o carro 1 é o jogador de referência e os outros são bots da dificuldade.
  var CENARIOS = [
    { id: 'iguais3', nome: '3 carros iguais (bot difícil)', bots: 2, dificuldade: 'dificil', todos: 'bot' },
    { id: 'iguais2', nome: '2 carros iguais (bot difícil)', bots: 1, dificuldade: 'dificil', todos: 'bot' },
    { id: 'ref3', nome: '3 jogadores de referência', bots: 2, dificuldade: 'dificil', todos: 'referencia' },
    { id: 'ref2', nome: '2 jogadores de referência', bots: 1, dificuldade: 'dificil', todos: 'referencia' },
    { id: 'facil', nome: 'Referência × 2 bots fáceis', bots: 2, dificuldade: 'facil' },
    { id: 'medio', nome: 'Referência × 2 bots médios', bots: 2, dificuldade: 'medio' },
    { id: 'dificil', nome: 'Referência × 2 bots difíceis', bots: 2, dificuldade: 'dificil' }
  ];
  var SEMENTE_BASE = 100000;  // a corrida i de todo cenário usa a semente SEMENTE_BASE + i

  // Corre uma corrida inteira. Truque: todos os carros viram "humano", assim o
  // motor devolve a vez a cada turno e o teste escolhe a jogada de cada carro.
  function correrCorrida(cenario, semente) {
    var p = MotorRegras.criarPartida(semente, {
      nome_jogador: 'Referência', num_bots: cenario.bots, dificuldade: cenario.dificuldade, semente: semente
    });
    var idReferencia = p.carros[0].id;
    var piloto = {};
    p.carros.forEach(function (c) {
      var referencia = cenario.todos === 'referencia' || (!cenario.todos && c.id === idReferencia);
      piloto[c.id] = referencia ? jogadaReferencia : MotorRegras.escolherJogadaBot;
      c.dificuldade = referencia ? null : cenario.dificuldade;
      c.tipo = 'humano';
    });

    var grid = {};
    p.carros.forEach(function (c) { grid[c.id] = c.posicao; });
    var ordens = [p.ordem.join(',')];
    var rodada = p.rodada;
    var turnos = 0;
    while (p.status === 'em_andamento' && turnos++ < 400) {
      var carro = MotorRegras.carroDaVez(p);
      var escolha = piloto[carro.id](p, carro);
      MotorRegras.jogarTurnoHumano(p, escolha.marcha, escolha.cartas);
      if (p.rodada !== rodada) {
        rodada = p.rodada;
        ordens.push(p.ordem.join(','));
      }
    }
    // A ordem na bandeirada também conta (ultrapassagem na última rodada)
    ordens.push(p.carros.slice().sort(function (a, b) { return a.chegada_posicao - b.chegada_posicao; })
      .map(function (c) { return c.id; }).join(','));

    var mudancas = 0;
    var trocouLider = false;
    for (var i = 1; i < ordens.length; i++) {
      if (ordens[i] !== ordens[i - 1]) mudancas++;
      if (ordens[i].split(',')[0] !== ordens[i - 1].split(',')[0]) trocouLider = true;
    }
    return { p: p, grid: grid, idReferencia: idReferencia, mudancas: mudancas, trocouLider: trocouLider };
  }

  function novoAcumulador() {
    return {
      corridas: 0, pole: 0, mudancas: 0, trocasLider: 0, rodadas: 0, vitoriasReferencia: 0,
      bots: 0, calorBots: 0, motorCheioBots: 0, derrapagensBots: 0,
      marchas: [0, 0, 0, 0, 0], jogadasBots: 0
    };
  }

  function acumular(a, r) {
    var p = r.p;
    var ultimaDoGrid = p.carros.length - 1; // pole = casa 2 com 3 carros, casa 1 com 2
    a.corridas++;
    if (r.grid[p.vencedor_carro_id] === ultimaDoGrid) a.pole++;
    a.mudancas += r.mudancas;
    if (r.trocouLider) a.trocasLider++;
    a.rodadas += p.rodada;
    if (p.vencedor_carro_id === r.idReferencia) a.vitoriasReferencia++;

    // Bots = todos os carros que não são o jogador de referência
    p.carros.forEach(function (c) {
      if (c.dificuldade === null) return;
      a.bots++;
      a.calorBots += p.jogadas.filter(function (j) { return j.carro_id === c.id; })
        .reduce(function (s, j) { return s + j.calor_pago; }, 0);
      if (c.motor.length === R.CALOR_MOTOR) a.motorCheioBots++;
      a.derrapagensBots += c.derrapagens;
    });
    p.jogadas.forEach(function (j) {
      var carro = p.carros.find(function (c) { return c.id === j.carro_id; });
      if (carro.dificuldade === null) return;
      a.marchas[j.marcha]++;
      a.jogadasBots++;
    });
  }

  function fechar(a) {
    function pct(x, total) { return total ? 100 * x / total : 0; }
    return {
      pole: pct(a.pole, a.corridas),
      mudancas: a.mudancas / a.corridas,
      trocasLider: pct(a.trocasLider, a.corridas),
      rodadas: a.rodadas / a.corridas,
      vitoriasReferencia: pct(a.vitoriasReferencia, a.corridas),
      calorBots: a.bots ? a.calorBots / a.bots : 0,
      motorCheioBots: pct(a.motorCheioBots, a.bots),
      derrapagensBots: a.bots ? a.derrapagensBots / a.bots : 0,
      marchas: a.marchas.slice(1).map(function (m) { return pct(m, a.jogadasBots); })
    };
  }

  // "Antes": o mesmo relatório rodado no motor original, antes de qualquer
  // mudança de regra (1.500 corridas por cenário, sem semente).
  var ANTES = {
    iguais3: { pole: 87.3, mudancas: 0.24, trocasLider: 14, rodadas: 9.32, calorBots: 0.19, motorCheioBots: 100, derrapagensBots: 0, marchas: [41, 55, 4, 0] },
    iguais2: { pole: 91.0, mudancas: 0.11, trocasLider: 10, rodadas: 9.45 },
    ref3: { pole: 68.3, mudancas: 1.08, trocasLider: 42, rodadas: 8.31 },
    ref2: { pole: 72.2, mudancas: 0.50, trocasLider: 37, rodadas: 8.50 },
    facil: { vitoriasReferencia: 94.2, calorBots: 3.97, motorCheioBots: 25, derrapagensBots: 1.69, rodadas: 8.59 },
    medio: { vitoriasReferencia: 89.5, calorBots: 0.21, motorCheioBots: 99, derrapagensBots: 0, rodadas: 8.57 },
    dificil: { vitoriasReferencia: 90.7, calorBots: 0.16, motorCheioBots: 100, derrapagensBots: 0, rodadas: 8.57, marchas: [39, 57, 5, 0] }
  };

  // Linhas do relatório: métrica, cenário, campo, formato e meta (se houver)
  var LINHAS = [
    { grupo: 'Largada' },
    { nome: 'Pole vence — 3 carros iguais (bot difícil)', cenario: 'iguais3', campo: 'pole', formato: '%', meta: '≤ 45%', passa: function (v) { return v <= 45; } },
    { nome: 'Pole vence — 3 jogadores de referência', cenario: 'ref3', campo: 'pole', formato: '%', meta: '≤ 45%', passa: function (v) { return v <= 45; } },
    { nome: 'Pole vence — 2 carros iguais (bot difícil)', cenario: 'iguais2', campo: 'pole', formato: '%', meta: '≤ 60%', passa: function (v) { return v <= 60; } },
    { nome: 'Pole vence — 2 jogadores de referência', cenario: 'ref2', campo: 'pole', formato: '%', meta: '≤ 60%', passa: function (v) { return v <= 60; } },
    { grupo: 'Disputa' },
    { nome: 'Rodadas em que a ordem muda, por corrida — 3 iguais (bot difícil)', cenario: 'iguais3', campo: 'mudancas', formato: '0.00', meta: '≥ 2', passa: function (v) { return v >= 2; } },
    { nome: 'Rodadas em que a ordem muda, por corrida — 3 jogadores de referência', cenario: 'ref3', campo: 'mudancas', formato: '0.00', meta: '≥ 2', passa: function (v) { return v >= 2; } },
    { nome: 'Corridas com troca de liderança — 3 iguais (bot difícil)', cenario: 'iguais3', campo: 'trocasLider', formato: '%' },
    { nome: 'Rodadas por corrida — 3 iguais (bot difícil)', cenario: 'iguais3', campo: 'rodadas', formato: '0.0', meta: '7 a 10', passa: function (v) { return v >= 7 && v <= 10; } },
    { grupo: 'Calor dos bots' },
    { nome: 'Calor gasto por corrida — bot difícil', cenario: 'dificil', campo: 'calorBots', formato: '0.0', meta: '≥ 4', passa: function (v) { return v >= 4; } },
    { nome: 'Motor cheio na chegada — bot difícil', cenario: 'dificil', campo: 'motorCheioBots', formato: '%', meta: '< 20%', passa: function (v) { return v < 20; } },
    { nome: 'Calor gasto por corrida — bot médio', cenario: 'medio', campo: 'calorBots', formato: '0.0' },
    { nome: 'Motor cheio na chegada — bot médio', cenario: 'medio', campo: 'motorCheioBots', formato: '%' },
    { nome: 'Calor gasto por corrida — bot fácil', cenario: 'facil', campo: 'calorBots', formato: '0.0' },
    { nome: 'Motor cheio na chegada — bot fácil', cenario: 'facil', campo: 'motorCheioBots', formato: '%' },
    { grupo: 'Dificuldade (jogador de referência contra 2 bots)' },
    { nome: 'Referência vence — bots fáceis', cenario: 'facil', campo: 'vitoriasReferencia', formato: '%', meta: '≥ 75%', passa: function (v) { return v >= 75; } },
    { nome: 'Referência vence — bots médios', cenario: 'medio', campo: 'vitoriasReferencia', formato: '%', meta: '45 a 65%', passa: function (v) { return v >= 45 && v <= 65; } },
    { nome: 'Referência vence — bots difíceis', cenario: 'dificil', campo: 'vitoriasReferencia', formato: '%', meta: '≤ 40%', passa: function (v) { return v <= 40; } },
    { nome: 'Derrapagens por corrida — cada bot fácil', cenario: 'facil', campo: 'derrapagensBots', formato: '0.00' },
    { nome: 'Derrapagens por corrida — cada bot médio', cenario: 'medio', campo: 'derrapagensBots', formato: '0.00' },
    { nome: 'Derrapagens por corrida — cada bot difícil', cenario: 'dificil', campo: 'derrapagensBots', formato: '0.00' },
    { nome: 'Uso das marchas 1/2/3/4 — bot difícil', cenario: 'dificil', campo: 'marchas', formato: 'marchas' }
  ];

  function formatar(valor, formato) {
    if (valor === undefined || valor === null) return '—';
    if (formato === '%') return valor.toFixed(1).replace('.', ',') + '%';
    if (formato === 'marchas') return valor.map(function (m) { return Math.round(m) + '%'; }).join(' / ');
    var casas = formato === '0.00' ? 2 : 1;
    return valor.toFixed(casas).replace('.', ',');
  }

  function montarLinhas(resultados) {
    return LINHAS.map(function (l) {
      if (l.grupo) return { grupo: l.grupo };
      var agora = resultados[l.cenario][l.campo];
      var antes = ANTES[l.cenario] ? ANTES[l.cenario][l.campo] : undefined;
      return {
        nome: l.nome,
        antes: formatar(antes, l.formato),
        agora: formatar(agora, l.formato),
        meta: l.meta || '',
        resultado: l.passa ? (l.passa(agora) ? 'PASSOU' : 'FALHOU') : ''
      };
    });
  }

  // Roda os cenários aos pouquinhos (uns 40 ms por vez), para o navegador
  // não travar, e avisa o progresso. A corrida i de todos os cenários usa a
  // mesma semente (mesma pista), então elas rodam juntas e os bots montam
  // a tabela de turnos uma vez só por pista. Devolve uma Promise com as
  // linhas do relatório e os números brutos de cada cenário.
  function relatorioEquilibrio(corridasPorCenario, aoProgredir) {
    return new Promise(function (resolve) {
      var acumuladores = {};
      CENARIOS.forEach(function (c) { acumuladores[c.id] = novoAcumulador(); });
      var feitas = 0;
      var inicio = Date.now();

      function passo() {
        var fatia = Date.now();
        while (feitas < corridasPorCenario && Date.now() - fatia < 40) {
          CENARIOS.forEach(function (c) {
            acumular(acumuladores[c.id], correrCorrida(c, SEMENTE_BASE + feitas));
          });
          feitas++;
        }
        if (feitas < corridasPorCenario) {
          if (aoProgredir) aoProgredir(feitas / corridasPorCenario);
          setTimeout(passo, 0);
          return;
        }
        var resultados = {};
        CENARIOS.forEach(function (c) { resultados[c.id] = fechar(acumuladores[c.id]); });
        resolve({
          linhas: montarLinhas(resultados),
          resultados: resultados,
          cenarios: CENARIOS,
          segundos: (Date.now() - inicio) / 1000
        });
      }
      passo();
    });
  }

  return { rodar: rodar, relatorioEquilibrio: relatorioEquilibrio };
})();
