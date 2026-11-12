/* =====================================================================
   Efeitos.js — Os efeitos sonoros do jogo, criados em código
   ---------------------------------------------------------------------
   Como a trilha (AudioDirector.js), nenhum som vem de arquivo: cada
   efeito é montado na hora com a Web Audio API, a partir de ruído,
   osciladores, filtros e envelopes de volume. Este arquivo NÃO sabe
   nada do jogo: quem decide quando tocar é o efeitos-jogo.js.

   API:
     Efeitos.init()               liga o som. Chamar num clique ou tecla:
                                  o navegador bloqueia som sem um gesto.
     Efeitos.tocar(nome, opcoes)  toca um efeito. Opções que todos aceitam:
                                    forca     multiplica o volume (1 = normal)
                                    pan       -1 esquerda … 1 direita
                                    atraso    segundos até começar
                                    distante  true = carro de bot (mais baixo e abafado)
                                  e as opções de cada som (ver RECEITAS).
     Efeitos.setVolume(0..1) · mute() · unmute() · setLightMode(bool)
   Extras para a página de audição (efeitos.html):
     lista(), getInfo(), renderOffline(nome, opcoes, extra)

   Identidade: uma mesa de colecionador à noite. Os sons são de
   MATERIAIS (cartolina, madeira, baquelite e metal, feltro), com uma
   camada discreta de "cinema de corrida" (ronco filtrado, pneu, ar).
   Toda nota fica em Ré dórico, a escala da trilha: os efeitos nunca
   desafinam com a música.

   Como um efeito toca (função tocarNo):
     1. CONFORTO: intervalo mínimo entre repetições do mesmo som;
        "habituação" (repetido muitas vezes seguidas, vai ficando mais
        baixo); limite de vozes (o som menos importante cede a vez).
     2. VOZ: um ganho (o nível do som, com uma pequena variação) e um
        pan, ligados ao barramento do som. A RECEITA monta as PEÇAS
        (papel, madeira, malho, ronco...) dentro da voz.
     3. MESA DE SOM:
          voz -> barramento (interface · mesa · pista · destaque) -> soma
                        \-> envio para a SALA (reverb curto) ----/
          soma -> corta-graves -> curva de segurança (teto -1 dBFS) -> volume -> caixas
        Um "momento" (derrapagem, semáforo, bandeirada) abaixa a
        interface e a mesa enquanto toca, para ele ficar claro.

   Níveis de presença (volume percebido de cada som, com o volume em 100%):
     sussurro -41 dBFS · toque -32 · ação -26 · momento -20   (ver NIVEIS)
   Cada receita foi medida (página efeitos.html, "Calcular ajustes") e
   tem um "ajuste" em dB que leva o seu volume para o nível dela.

   Mapa do arquivo: AJUSTES · ESTADO · UTILITÁRIOS · MESA DE SOM ·
   PEÇAS · RECEITAS · VOZES · CONTEXTO · API
   ===================================================================== */

var Efeitos = (function () {
  'use strict';

  /* ============================ AJUSTES ============================ */

  var VOLUME_PADRAO = 0.85;   // com a música em 65% (AudioDirector.js): o equilíbrio ouvido pela equipe
  var TETO = 0.89;            // -1 dBFS: o som nunca passa disto
  var JOELHO = 0.5;           // acima disto a curva de segurança começa a arredondar
  var MAX_VOZES = 24;         // efeitos soando juntos, no máximo
  var MAX_VOZES_LEVE = 12;    // o mesmo no modo leve (computadores mais fracos)
  var DESCANSO = 6;           // s de silêncio até suspender o áudio (economiza processador)
  var ABAIXAR = -4;           // dB: quanto a interface e a mesa abaixam durante um momento
  var DISTANTE = -6;          // dB: carro de bot, "do outro lado da mesa"
  var CORTE_DISTANTE = 2200;  // Hz: o bot também soa mais abafado
  var VARIACAO_DB = 1.5;      // cada repetição sai até 1,5 dB mais forte ou mais fraca

  // Níveis de presença, com o volume em 100%:
  //   volume   o "volume percebido" desejado: RMS (dBFS) do trecho de 50 ms mais forte.
  //            Medir pelo pico enganaria: um clique de 20 ms e uma nota de 1 s com o
  //            mesmo pico soam muito diferentes.
  //   picoMax  o pico nunca passa disto (um som muito seco fica um pouco abaixo do volume)
  //   prioridade  quem cede a vez no limite de vozes (o menor)
  // No volume padrão (efeitos 85%, música 65%), em relação à trilha: sussurro ~15 dB
  // abaixo, toque ~6 dB abaixo, ação no nível da música, momento ~6 dB acima.
  var NIVEIS = {
    sussurro: { volume: -41, picoMax: -26, prioridade: 0 },
    toque:    { volume: -32, picoMax: -16, prioridade: 1 },
    acao:     { volume: -26, picoMax: -12, prioridade: 2 },
    momento:  { volume: -20, picoMax: -6,  prioridade: 3 }
  };

  // Barramentos e quanto de cada um vai para a sala (reverb curto)
  var BARRAMENTOS = { interface: 0.05, mesa: 0.12, pista: 0.16, destaque: 0.22 };

  // Habituação: depois de LIVRES repetições dentro da JANELA (s), cada
  // repetição extra perde PASSO dB, até o MINIMO
  var HABITUACAO = { janela: 1, livres: 4, passo: -1.5, minimo: -6 };

  /* ============================= ESTADO ============================= */

  var S = null;               // o "estúdio" ao vivo: contexto, mesa, vozes...
  var volume = VOLUME_PADRAO;
  var mudo = false;
  var leve = false;
  var avisos = {};            // mensagens de erro já mostradas (cada uma só uma vez)
  var vigia = null;           // temporizador que suspende o áudio no silêncio

  /* ========================== UTILITÁRIOS ========================== */

  function dB(valor) { return Math.pow(10, valor / 20); }
  function frequencia(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function sortear(min, max) { return min + Math.random() * (max - min); }
  function limitar(valor, min, max) { return Math.min(max, Math.max(min, valor)); }

  function avisarUmaVez(mensagem) {
    if (avisos[mensagem]) return;
    avisos[mensagem] = true;
    console.warn('[Efeitos] ' + mensagem);
  }

  // Lista de n valores: fn recebe a posição s (0 a 1) e devolve o valor
  function curva(n, fn) {
    var lista = new Float32Array(n);
    for (var i = 0; i < n; i++) lista[i] = fn(i / (n - 1));
    return lista;
  }

  // Envelope de um golpe: sobe em "ataque" até "pico" e some em "queda"
  // (curva exponencial, como um som natural). Devolve a hora do fim.
  function golpe(param, t, ataque, pico, queda) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(Math.max(0.0002, pico), t + ataque);
    param.exponentialRampToValueAtTime(0.0001, t + ataque + queda);
    param.setValueAtTime(0, t + ataque + queda);
    return t + ataque + queda;
  }

  function filtro(ctx, tipo, freq, q, destino) {
    var f = ctx.createBiquadFilter();
    f.type = tipo;
    f.frequency.value = freq;
    f.Q.value = q;
    if (destino) f.connect(destino);
    return f;
  }

  // Ruído filtrado numa faixa estreita fica bem mais baixo que o ruído
  // inteiro. Este fator compensa, para "forca 1" soar parecido em
  // qualquer faixa (médio e agudo, estreito e largo).
  function compensar(centro, q) {
    return limitar(Math.sqrt(q * 11000 / centro), 1, 6);
  }

  // Curva de saturação suave (a mesma ideia da fita da trilha)
  function curvaSuave(k) {
    return curva(1024, function (s) {
      var x = s * 2 - 1;
      return Math.tanh(k * x) / Math.tanh(k);
    });
  }

  /* ========================== MESA DE SOM ========================== */

  function criarEstudio(ctx) {
    var est = {
      ctx: ctx,
      ruido: criarRuido(ctx, 2),
      curvaMotor: curvaSuave(2.5),
      vozes: [],            // { inicio, fim, prioridade, saida }
      ultimos: {},          // som -> quando tocou por último (intervalo mínimo)
      recentes: {},         // som -> horas das últimas repetições (habituação)
      variantes: {},        // última variante sorteada de cada lista (para não repetir)
      fimMaisTarde: 0,      // quando termina o último som agendado
      picoDeVozes: 0,       // o máximo de vozes que soaram juntas (para os testes)
      abaixadoAte: 0,       // até quando a interface e a mesa ficam mais baixas
      offline: false,       // true nos testes com renderOffline
      leve: undefined       // só nos testes offline; ao vivo vale a variável "leve"
    };
    est.mesa = montarMesa(ctx);
    return est;
  }

  function montarMesa(ctx) {
    var m = { barramentos: {} };
    m.soma = ctx.createGain();

    // SALA: um reverb curto, de quarto com a mesa e o abajur
    m.envio = ctx.createGain();
    m.sala = ctx.createConvolver();
    m.sala.buffer = criarRespostaDaSala(ctx, 0.6, 0.38);
    m.envio.connect(m.sala);
    m.sala.connect(m.soma);
    m.salaLigada = true;

    // BARRAMENTOS: cada um é um "fader" (para abaixar num momento) com o seu envio para a sala
    Object.keys(BARRAMENTOS).forEach(function (nome) {
      var fader = ctx.createGain();
      var envio = ctx.createGain();
      envio.gain.value = BARRAMENTOS[nome];
      fader.connect(m.soma);
      fader.connect(envio);
      envio.connect(m.envio);
      m.barramentos[nome] = fader;
    });

    // SAÍDA: tira o grave inútil e garante o teto (nada de estalo ou distorção dura)
    var semGraves = filtro(ctx, 'highpass', 40, 0.7);
    var seguranca = ctx.createWaveShaper();
    seguranca.curve = curvaDeSeguranca();
    m.volume = ctx.createGain();
    m.volume.gain.value = 0;
    m.soma.connect(semGraves);
    semGraves.connect(seguranca);
    seguranca.connect(m.volume);
    m.volume.connect(ctx.destination);
    return m;
  }

  // Até o JOELHO o som passa igual; acima dele é arredondado aos poucos e
  // nunca passa do TETO. Só entra em ação se muitos sons somarem juntos.
  function curvaDeSeguranca() {
    return curva(4096, function (s) {
      var x = s * 2 - 1;
      var a = Math.abs(x);
      var y = a <= JOELHO ? a : JOELHO + (TETO - JOELHO) * Math.tanh((a - JOELHO) / (TETO - JOELHO));
      return x < 0 ? -y : y;
    });
  }

  // Modo leve: a sala sai da mesa (o reverb é a parte que mais gasta processador)
  function ligarSala(est, ligada) {
    var m = est.mesa;
    if (ligada === m.salaLigada) return;
    if (ligada) m.envio.connect(m.sala);
    else m.envio.disconnect(m.sala);
    m.salaLigada = ligada;
  }

  function criarRuido(ctx, segundos) {
    var tamanho = Math.floor(ctx.sampleRate * segundos);
    var buffer = ctx.createBuffer(1, tamanho, ctx.sampleRate);
    var dados = buffer.getChannelData(0);
    for (var i = 0; i < tamanho; i++) dados[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // Resposta ao impulso de um quarto pequeno: ruído que morre aos poucos e
  // vai ficando abafado, com reflexões bem próximas (a mesa, a cúpula do abajur)
  function criarRespostaDaSala(ctx, duracao, rt60) {
    var taxa = ctx.sampleRate;
    var tamanho = Math.floor(taxa * duracao);
    var preAtraso = Math.floor(0.006 * taxa);
    var queda = Math.exp(-6.9 / (rt60 * taxa));
    var buffer = ctx.createBuffer(2, tamanho, taxa);
    for (var canal = 0; canal < 2; canal++) {
      var dados = buffer.getChannelData(canal);
      var amplitude = 1;
      var filtrado = 0;
      for (var i = preAtraso; i < tamanho; i++) {
        var brilho = 0.7 - 0.6 * (i - preAtraso) / (tamanho - preAtraso);
        filtrado += ((Math.random() * 2 - 1) - filtrado) * brilho;
        dados[i] = filtrado * amplitude;
        amplitude *= queda;
      }
      [0.004, 0.009, 0.013, 0.021].forEach(function (segundos, k) {
        var posicao = preAtraso + Math.floor((segundos + canal * 0.002) * taxa);
        if (posicao < tamanho) dados[posicao] += (k % 2 ? -1 : 1) * (0.5 - k * 0.08);
      });
    }
    return buffer;
  }

  /* ============================== PEÇAS ==============================
     Blocos de construção dos sons. Cada peça recebe a voz "v" (contexto,
     estúdio, saída, modo leve e a variação sorteada para esta vez:
     v.brilho ±10% e v.afinacao ±3%), a hora t e os seus ajustes. O
     último parâmetro, "destino", é opcional (padrão: a saída da voz).
     ==================================================================== */

  // RUÍDO: a matéria-prima de papel, feltro, ar e pneu. Começa num trecho
  // sorteado do buffer, então nunca soa duas vezes igual.
  function fonteDeRuido(v, t, dur, destino, velocidade) {
    var fonte = v.ctx.createBufferSource();
    fonte.buffer = v.est.ruido;
    fonte.loop = true;
    fonte.playbackRate.value = (velocidade || 1) * v.afinacao;
    fonte.connect(destino);
    fonte.start(t, Math.random() * fonte.buffer.duration);
    fonte.stop(t + dur + 0.01);
    return fonte;
  }

  // PAPEL (cartolina): ruído numa faixa estreita. "varrer: [de, para]" faz
  // a faixa andar, como uma carta deslizando.
  // o: { centro, q, ataque, queda, forca, varrer }
  function papel(v, t, o, destino) {
    var q = o.q || 1;
    var centro = (o.centro || o.varrer[0]) * v.brilho;
    var forca = o.forca === undefined ? 1 : o.forca;
    var g = v.ctx.createGain();
    g.gain.value = 0;
    g.connect(destino || v.saida);
    var faixa = filtro(v.ctx, 'bandpass', centro, q, g);
    if (o.varrer) {
      faixa.frequency.setValueAtTime(o.varrer[0] * v.brilho, t);
      faixa.frequency.exponentialRampToValueAtTime(o.varrer[1] * v.brilho, t + o.ataque + o.queda);
    }
    fonteDeRuido(v, t, o.ataque + o.queda, faixa);
    return golpe(g.gain, t, o.ataque, forca * compensar(centro, q), o.queda);
  }

  // TOM: um oscilador com envelope de golpe
  function tom(v, t, freq, tipo, ataque, pico, queda, destino) {
    var osc = v.ctx.createOscillator();
    osc.type = tipo;
    osc.frequency.value = freq;
    var g = v.ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(destino || v.saida);
    var fim = golpe(g.gain, t, ataque, pico, queda);
    osc.start(t);
    osc.stop(fim + 0.02);
    return { osc: osc, ganho: g, fim: fim };
  }

  // MALHO: nota de baqueta macia, parente do vibrafone da trilha.
  // A nota (senoide) + o 2º modo da barra (quase 4x, some logo) + a batida
  // da baqueta. A afinação nunca varia: a nota fica sempre em Ré dórico.
  // o: { abafado (madeira seca, curto), queda }
  function malho(v, t, midi, forca, o, destino) {
    o = o || {};
    var f = frequencia(midi);
    var queda = o.queda || (o.abafado ? 0.35 : 1.1);
    var brilho = o.abafado ? 1100 : 2400 + 2000 * forca * v.brilho;
    var corte = filtro(v.ctx, 'lowpass', brilho, 0.6, destino || v.saida);
    tom(v, t, f, 'sine', 0.004, 0.75 * forca, queda, corte);
    if (!o.abafado) tom(v, t, f * 3.98, 'sine', 0.002, 0.16 * forca * v.brilho, queda * 0.16, corte);
    papel(v, t, { centro: 1500, q: 0.8, ataque: 0.001, queda: 0.012, forca: 0.12 * forca }, corte);
    return t + 0.004 + queda;
  }

  // MADEIRA e METAL: "modos" de vibração (senoides com afinação inarmônica)
  // que somem rápido, mais o estalo do impacto. Os modos agudos somem antes.
  var MODOS_MADEIRA = [[1, 1], [2.57, 0.42], [4.42, 0.2]];
  var MODOS_METAL = [[1, 1], [2.33, 0.6], [3.5, 0.38], [5.1, 0.2]];

  function modos(v, t, f, forca, queda, lista, destino) {
    lista.forEach(function (m) {
      tom(v, t, f * m[0] * v.afinacao, 'sine', 0.0008, m[1] * forca, queda / Math.sqrt(m[0]), destino);
    });
    papel(v, t, { centro: Math.min(6000, f * 2), q: 1.2, ataque: 0.0005, queda: 0.006, forca: 0.3 * forca }, destino);
    return t + queda;
  }

  function madeira(v, t, f, forca, queda, destino) {
    return modos(v, t, f, forca, queda || 0.05, MODOS_MADEIRA, destino);
  }

  function metal(v, t, f, forca, queda, destino) {
    return modos(v, t, f, forca, queda || 0.09, MODOS_METAL, destino);
  }

  // BAQUE: o "corpo" de um impacto: senoide grave que cai de afinação + ruído abafado
  function baque(v, t, f, forca, queda, destino) {
    queda = queda || 0.06;
    var r = tom(v, t, f * 1.6, 'sine', 0.001, forca, queda, destino);
    r.osc.frequency.setValueAtTime(f * 1.6, t);
    r.osc.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    var g = v.ctx.createGain();
    g.gain.value = 0;
    g.connect(destino || v.saida);
    fonteDeRuido(v, t, queda, filtro(v.ctx, 'lowpass', Math.max(200, f * 4), 0.7, g));
    golpe(g.gain, t, 0.001, 0.35 * forca, queda * 0.5);
    return t + queda;
  }

  // AR: um sopro que cresce e passa; a faixa do ruído sobe até o pico e desce.
  // o: { dur, faixa: [de, pico, ate], q, forca, picoEm (0 a 1) }
  function ar(v, t, o, destino) {
    var q = o.q || 1;
    var picoEm = o.picoEm || 0.5;
    var g = v.ctx.createGain();
    g.gain.value = 0;
    g.connect(destino || v.saida);
    var faixa = filtro(v.ctx, 'bandpass', o.faixa[0], q, g);
    faixa.frequency.setValueAtTime(o.faixa[0], t);
    faixa.frequency.exponentialRampToValueAtTime(o.faixa[1], t + o.dur * picoEm);
    faixa.frequency.exponentialRampToValueAtTime(o.faixa[2], t + o.dur);
    var pico = (o.forca === undefined ? 1 : o.forca) * compensar(o.faixa[1], q);
    g.gain.setValueCurveAtTime(curva(32, function (s) {
      var x = s < picoEm ? s / picoEm : (1 - s) / (1 - picoEm);
      return pico * Math.pow(Math.sin(x * Math.PI / 2), 2);
    }), t, o.dur);
    fonteDeRuido(v, t, o.dur, faixa);
    return t + o.dur;
  }

  // RONCO: o motor, filtrado e distante ("cinema de corrida", não simulador).
  // "giros" é uma lista de 0 a 1 ao longo do som: o giro sobe a afinação,
  // abre o filtro e aumenta o volume, como um motor de verdade.
  // o: { timbre (multiplica a afinação: cada carro tem o seu), subida (Hz), forca }
  function ronco(v, t, dur, giros, o, destino) {
    var ctx = v.ctx;
    var n = giros.length;
    var base = 46 * (o.timbre || 1);
    var subida = o.subida || 80;
    var forca = o.forca === undefined ? 1 : o.forca;
    var freq = new Float32Array(n);
    var corte = new Float32Array(n);
    var vol = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var g = 0.12 + 0.88 * giros[i];                        // nunca abaixo da marcha lenta
      var s = i / (n - 1);
      var borda = Math.max(0, Math.min(1, s / 0.08, (1 - s) / 0.12));   // entra e sai sem estalo
      freq[i] = base + subida * g;
      corte[i] = 300 + 1500 * g;
      vol[i] = (0.3 + 0.7 * g) * borda * forca;
    }
    var saida = ctx.createGain();
    saida.gain.value = 0;
    saida.connect(destino || v.saida);
    saida.gain.setValueCurveAtTime(vol, t, dur);
    var abertura = filtro(ctx, 'lowpass', corte[0], 2, saida);
    abertura.frequency.setValueCurveAtTime(corte, t, dur);
    var saturacao = ctx.createWaveShaper();
    saturacao.curve = v.est.curvaMotor;
    saturacao.connect(abertura);

    // dois dentes de serra quase iguais (o "batimento" engrossa o som) e um grave meia oitava abaixo
    var camadas = v.leve ? [[1, 'sawtooth', 0.7]]
      : [[1, 'sawtooth', 0.5], [1.007, 'sawtooth', 0.4], [0.5, 'square', 0.3]];
    camadas.forEach(function (c) {
      var osc = ctx.createOscillator();
      osc.type = c[1];
      osc.frequency.setValueCurveAtTime(freq.map(function (f) { return f * c[0]; }), t, dur);
      var ganho = ctx.createGain();
      ganho.gain.value = c[2];
      osc.connect(ganho);
      ganho.connect(saturacao);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });

    if (!v.leve) {   // o sopro do escapamento
      var sopro = ctx.createGain();
      sopro.gain.value = 0.35;
      sopro.connect(saida);
      fonteDeRuido(v, t, dur, filtro(ctx, 'bandpass', 700, 0.8, sopro));
    }
    return t + dur;
  }

  // FELTRO: a miniatura deslizando no tabuleiro; o chiado acompanha a velocidade
  function deslize(v, t, dur, giros, forca, destino) {
    var g = v.ctx.createGain();
    g.gain.value = 0;
    g.connect(destino || v.saida);
    var pico = forca * compensar(650, 0.6);
    g.gain.setValueCurveAtTime(giros.map(function (x) { return x * pico; }), t, dur);
    var abafado = filtro(v.ctx, 'lowpass', 1800, 0.7, g);
    fonteDeRuido(v, t, dur, filtro(v.ctx, 'bandpass', 650, 0.6, abafado));
    return t + dur;
  }

  // PNEU: o pneu "canta" (um tom que treme e cai de afinação conforme o
  // carro perde velocidade) + ruído áspero. Bem filtrado: chiado, nunca apito.
  function pneu(v, t, dur, forca, destino) {
    var ctx = v.ctx;
    var af = v.afinacao;
    var saida = ctx.createGain();
    saida.gain.value = 0;
    saida.connect(destino || v.saida);
    var trepida = ctx.createGain();            // o "trepidar" do pneu: volume que treme
    trepida.gain.value = 0.75;
    trepida.connect(saida);
    var lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 21 * af;
    var profundidade = ctx.createGain();
    profundidade.gain.value = 0.25;
    lfo.connect(profundidade);
    profundidade.connect(trepida.gain);
    var abafar = filtro(ctx, 'lowpass', 2600, 0.7, trepida);
    var canto = filtro(ctx, 'bandpass', 1100 * af, 5, abafar);
    canto.frequency.setValueAtTime(1100 * af, t);
    canto.frequency.exponentialRampToValueAtTime(720 * af, t + dur);

    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1080 * af, t);
    osc.frequency.exponentialRampToValueAtTime(700 * af, t + dur);
    var vibrato = ctx.createOscillator();
    vibrato.frequency.value = 7.3;
    var largura = ctx.createGain();
    largura.gain.value = 28;
    vibrato.connect(largura);
    largura.connect(osc.frequency);
    var nivelCanto = ctx.createGain();
    nivelCanto.gain.value = 0.5;
    osc.connect(nivelCanto);
    nivelCanto.connect(canto);
    var aspero = ctx.createGain();
    aspero.gain.value = 1.4;
    aspero.connect(canto);
    fonteDeRuido(v, t, dur, aspero);

    [osc, vibrato, lfo].forEach(function (o) { o.start(t); o.stop(t + dur + 0.02); });
    var pico = forca * 1.6;
    saida.gain.setValueAtTime(0, t);
    saida.gain.linearRampToValueAtTime(pico, t + 0.03);
    saida.gain.linearRampToValueAtTime(pico * 0.7, t + dur * 0.6);
    saida.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return t + dur;
  }

  // BANDEIRA tremulando: ruído grave-médio que "bate" várias vezes por segundo
  function tremular(v, t, dur, forca, destino) {
    var ctx = v.ctx;
    var saida = ctx.createGain();
    saida.gain.value = 0;
    saida.connect(destino || v.saida);
    var bate = ctx.createGain();
    bate.gain.value = 0.55;
    bate.connect(saida);
    var lfo = ctx.createOscillator();
    lfo.frequency.value = sortear(8, 9.5);
    var profundidade = ctx.createGain();
    profundidade.gain.value = 0.45;
    lfo.connect(profundidade);
    profundidade.connect(bate.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
    var pano = ctx.createGain();
    pano.gain.value = compensar(700, 0.7);
    pano.connect(bate);
    fonteDeRuido(v, t, dur, filtro(ctx, 'bandpass', 700, 0.7, pano));
    if (!v.leve) {   // o "estalo" do tecido, mais agudo e baixinho
      var tecido = ctx.createGain();
      tecido.gain.value = 0.3 * compensar(2600, 1.2);
      tecido.connect(bate);
      fonteDeRuido(v, t, dur, filtro(ctx, 'bandpass', 2600, 1.2, tecido));
    }
    saida.gain.setValueAtTime(0, t);
    saida.gain.linearRampToValueAtTime(forca, t + 0.15);
    saida.gain.setValueAtTime(forca, t + dur - 0.5);
    saida.gain.linearRampToValueAtTime(0, t + dur);
    return t + dur;
  }

  // METAIS: um naipe bem suave (dentes de serra filtrados, ataque lento)
  function metais(v, t, midi, dur, forca, destino) {
    var ctx = v.ctx;
    var f = frequencia(midi);
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(destino || v.saida);
    var corte = filtro(ctx, 'lowpass', 1300, 0.7, g);
    [1, 1.004].forEach(function (mult) {
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f * mult;
      osc.connect(corte);
      osc.start(t);
      osc.stop(t + dur + 0.25);
    });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(forca, t + 0.04);
    g.gain.linearRampToValueAtTime(forca * 0.8, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    return t + dur + 0.2;
  }

  // LÂMPADA do semáforo: um tom quente e firme que se segura e apaga
  function lampada(v, t, midi, segura, forca) {
    var ctx = v.ctx;
    var f = frequencia(midi);
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(v.saida);
    var corte = filtro(ctx, 'lowpass', 2600, 0.7, g);
    [['sine', 1], ['triangle', 0.3]].forEach(function (c) {
      var osc = ctx.createOscillator();
      osc.type = c[0];
      osc.frequency.value = f;
      var nivel = ctx.createGain();
      nivel.gain.value = c[1];
      osc.connect(nivel);
      nivel.connect(corte);
      osc.start(t);
      osc.stop(t + segura + 0.35);
    });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(forca, t + 0.008);
    g.gain.linearRampToValueAtTime(forca * 0.8, t + segura);
    g.gain.exponentialRampToValueAtTime(0.0001, t + segura + 0.3);
    return t + segura + 0.3;
  }

  // RELÉ: o clique seco de um interruptor
  function rele(v, t, forca) {
    papel(v, t, { centro: 1200, q: 1, ataque: 0.0005, queda: 0.012, forca: 0.6 * forca });
    return baque(v, t, 160, 0.4 * forca, 0.03);
  }

  // Sorteia um item da lista, sem repetir o da vez anterior (mesma "chave")
  function variante(v, chave, lista) {
    var anterior = v.est.variantes[chave];
    var i;
    do { i = Math.floor(Math.random() * lista.length); } while (lista.length > 1 && i === anterior);
    v.est.variantes[chave] = i;
    return lista[i];
  }

  // Velocidade (0 a 1) em cada ponto de um caminho (posições de 0 a 1 ao longo do tempo)
  function velocidades(caminho) {
    var n = caminho.length;
    var lista = new Float32Array(n);
    var maior = 0;
    for (var i = 0; i < n; i++) {
      lista[i] = Math.abs(caminho[Math.min(n - 1, i + 1)] - caminho[Math.max(0, i - 1)]);
      maior = Math.max(maior, lista[i]);
    }
    for (var j = 0; j < n; j++) lista[j] = maior > 0 ? lista[j] / maior : 0;
    return lista;
  }

  // Caminho padrão (sem a pista, ex.: na página de audição): a mesma
  // suavização da animação do carro (acelera no começo, freia no fim)
  function caminhoPadrao() {
    return curva(24, function (s) { return s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2; });
  }

  // O pan da voz acompanha o carro na tela (lista de -1 a 1 ao longo do tempo)
  function acompanharPan(v, t, dur, pans) {
    if (!v.pan || !pans || pans.length < 2) return;
    v.pan.setValueCurveAtTime(Float32Array.from(pans, function (p) { return limitar(p, -1, 1); }), t, dur);
  }

  /* ============================= RECEITAS =============================
     Cada som: grupo e "quando" (para a página de audição), barramento,
     nível, intervalo mínimo entre repetições (s), duração máxima (s, ou
     função das opções), ajuste (dB, medido: leva o pico para o nível) e
     a função tocar(v, t, o), que monta o som e devolve a hora do fim.
     ==================================================================== */

  // O motivo "O Motor" da trilha (Ré Fá Sol Lá), em Ré5
  var NOTA_PADRAO = 74;

  var SONS = {

    /* ---------------------------- Cartas ---------------------------- */

    'carta-hover': {
      grupo: 'Cartas', quando: 'Mouse ou setas passando por uma carta (na sua vez)',
      barramento: 'mesa', nivel: 'sussurro', intervalo: 0.06, duracao: 0.08, ajuste: 16,
      // o.posicao: 0 = carta da esquerda … 1 = da direita (mais aguda)
      tocar: function (v, t, o) {
        var posicao = o.posicao === undefined ? 0.5 : o.posicao;
        return papel(v, t, { centro: 2600 + 1800 * posicao, q: 1.4, ataque: 0.012, queda: 0.05 });
      }
    },

    'carta-selecionar': {
      grupo: 'Cartas', quando: 'Selecionar uma carta (a nota segue o motivo; a última é sempre Lá)',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.04, duracao: 1.2, ajuste: 14.5,
      // o.nota: nota MIDI do malho (Ré5 74, Fá5 77, Sol5 79, Lá5 81)
      tocar: function (v, t, o) {
        papel(v, t, { varrer: [1800, 3800], q: 0.9, ataque: 0.002, queda: 0.03, forca: 0.5 });
        baque(v, t, 190, 0.3, 0.03);
        return malho(v, t + 0.012, o.nota || NOTA_PADRAO, 0.55);
      }
    },

    'carta-desmarcar': {
      grupo: 'Cartas', quando: 'Desmarcar uma carta (papel assentando, sem nota)',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.04, duracao: 0.12, ajuste: 19,
      tocar: function (v, t) {
        baque(v, t, 140, 0.35, 0.05);
        return papel(v, t, { varrer: [1400, 700], q: 0.8, ataque: 0.006, queda: 0.07, forca: 0.8 });
      }
    },

    'carta-morta': {
      grupo: 'Cartas', quando: 'Clicar numa carta de Calor (carta morta)',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.2, duracao: 0.4, ajuste: 12,
      tocar: function (v, t) {
        papel(v, t, { centro: 500, q: 0.7, ataque: 0.003, queda: 0.07, forca: 0.6 });
        baque(v, t, 105, 0.8, 0.12);
        return malho(v, t, 50, 0.45, { abafado: true });
      }
    },

    'cartas-jogadas': {
      grupo: 'Cartas', quando: 'ACELERAR: as cartas escolhidas voam da mão (ou um bot joga as dele)',
      barramento: 'mesa', nivel: 'acao', intervalo: 0.08, duracao: 0.5, ajuste: 10.5,
      // o.quantidade: quantas cartas (1 a 4). A animação acelera no fim: o sopro cresce até ~0,25 s
      tocar: function (v, t, o) {
        var n = limitar(o.quantidade || 1, 1, 4);
        var forca = 1 / Math.pow(n, 0.35);
        var fim = t;
        for (var i = 0; i < n; i++) {
          var ti = t + i * 0.02 + sortear(-0.005, 0.005);
          papel(v, ti, { centro: 3000, q: 1.5, ataque: 0.0008, queda: 0.008, forca: 0.5 * forca });
          fim = papel(v, ti, { varrer: [1200, 3800], q: 0.9, ataque: 0.22, queda: 0.15, forca: 0.7 * forca });
        }
        return fim;
      }
    },

    'carta-chegando': {
      grupo: 'Cartas', quando: 'Carta nova chegando na mão (desliza e pousa)',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.05, duracao: 0.35, ajuste: 19.5,
      tocar: function (v, t) {
        papel(v, t, { varrer: [1600, 2600], q: 0.7, ataque: 0.05, queda: 0.16, forca: 0.45 });
        papel(v, t + 0.24, { centro: 2200, q: 1, ataque: 0.001, queda: 0.02, forca: 0.8 });
        return baque(v, t + 0.24, 210, 0.3, 0.04);
      }
    },

    'reembaralhar': {
      grupo: 'Cartas', quando: 'O descarte foi reembaralhado',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.5, duracao: 0.75, ajuste: 21.5,
      tocar: function (v, t) {
        // as cartas batendo umas nas outras: rápidas no meio, mais lentas nas pontas
        var ti = t;
        var total = 26;
        for (var i = 0; i < total; i++) {
          papel(v, ti, { centro: sortear(2900, 4100), q: 2, ataque: 0.0005, queda: 0.006, forca: sortear(0.4, 0.7) });
          ti += 0.022 - 0.012 * Math.sin(Math.PI * i / total);
        }
        papel(v, t, { centro: 2500, q: 0.6, ataque: 0.05, queda: 0.35, forca: 0.2 });
        // o maço é acertado e bate na mesa
        papel(v, t + 0.5, { varrer: [900, 2000], q: 0.8, ataque: 0.03, queda: 0.1, forca: 0.4 });
        return baque(v, t + 0.62, 170, 0.45, 0.06);
      }
    },

    /* ----------------------- Câmbio e decisão ----------------------- */

    'marcha': {
      grupo: 'Câmbio e decisão', quando: 'Trocar de marcha: a manopla encaixa no H',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.05, duracao: 0.2, ajuste: 17.5,
      // o.sobe: subir de marcha soa um pouco mais brilhante que reduzir
      tocar: function (v, t, o) {
        var brilho = o.sobe === false ? 0.94 : 1.06;
        papel(v, t, { centro: 2200, q: 1.2, ataque: 0.001, queda: 0.015, forca: 0.25 });   // sai do encaixe
        metal(v, t + 0.04, 1180 * brilho, 0.5, 0.08);
        return baque(v, t + 0.04, 95, 0.6, 0.06);
      }
    },

    'risco-derrapagem': {
      grupo: 'Câmbio e decisão', quando: 'A previsão passou a mostrar risco de derrapagem',
      barramento: 'interface', nivel: 'toque', intervalo: 0.3, duracao: 0.55, ajuste: 14,
      tocar: function (v, t) {   // Fá–Si: o intervalo tenso que a própria escala tem
        malho(v, t, 65, 0.7, { abafado: true });
        return malho(v, t + 0.13, 59, 0.8, { abafado: true });
      }
    },

    'acelerar': {
      grupo: 'Câmbio e decisão', quando: 'ACELERAR: batida do botão + acelerador (mais forte nas marchas altas)',
      barramento: 'pista', nivel: 'acao', intervalo: 0.2, duracao: 0.85, ajuste: 9,
      // o.marcha: 1 a 4
      tocar: function (v, t, o) {
        var marcha = limitar(o.marcha || 2, 1, 4);
        baque(v, t, 120, 0.5, 0.05);
        papel(v, t, { centro: 1800, q: 1, ataque: 0.001, queda: 0.01, forca: 0.35 });
        var topo = 0.55 + 0.1 * marcha;
        var dur = 0.35 + 0.1 * marcha;
        var giros = curva(24, function (s) { return s < 0.3 ? topo * Math.sin(s / 0.3 * Math.PI / 2) : topo * (1 - (s - 0.3) / 0.7); });
        return ronco(v, t + 0.03, dur, giros, { subida: 90, forca: 0.72 + 0.03 * marcha });
      }
    },

    /* ---------------------------- Corrida ---------------------------- */

    'movimento': {
      grupo: 'Corrida', quando: 'Carro andando: deslize no feltro + ronco que acompanha a animação',
      barramento: 'pista', nivel: 'acao', intervalo: 0.05, ajuste: 7,
      duracao: function (o) { return Math.max(0.35, o.duracao === undefined ? 1.2 : o.duracao) + 0.1; },
      // o: duracao (s, a da animação; 0 = sem animação), casas, caminho (posição 0..1
      //    ao longo do tempo), pans (-1..1 ao longo do tempo), timbre (o ronco de cada carro)
      tocar: function (v, t, o) {
        var casas = o.casas || 4;
        var dur = o.duracao === undefined ? 1.2 : o.duracao;
        if (dur < 0.2) {   // sem animação (movimento reduzido): só um toque de acelerador e a peça assentando
          ronco(v, t, 0.3, curva(12, function (s) { return Math.sin(s * Math.PI) * 0.6; }), { timbre: o.timbre, forca: 1 });
          return madeira(v, t + 0.28, 330, 0.3, 0.05);
        }
        var giros = velocidades(o.caminho || caminhoPadrao());
        acompanharPan(v, t, dur, o.pans);
        var forca = 0.6 + 0.04 * Math.min(casas, 10);
        ronco(v, t, dur, giros, { timbre: o.timbre, subida: 40 + 6 * Math.min(casas, 12), forca: forca });
        deslize(v, t, dur, giros, 0.4 * forca);
        return madeira(v, t + dur - 0.01, 330, 0.25, 0.05);   // a miniatura assenta na casa
      }
    },

    'rastro': {
      grupo: 'Corrida', quando: 'Rastro (vácuo): o carro é puxado pelo ar do carro da frente',
      barramento: 'pista', nivel: 'acao', intervalo: 0.1, ajuste: 10,
      duracao: function (o) { return Math.max(0.3, o.duracao === undefined ? 0.8 : o.duracao) + 0.1; },
      // mesmas opções do movimento
      tocar: function (v, t, o) {
        var dur = Math.max(0.3, o.duracao === undefined ? 0.8 : o.duracao);
        var giros = velocidades(o.caminho || caminhoPadrao());
        acompanharPan(v, t, dur, o.pans);
        ar(v, t, { dur: dur, faixa: [500, 2400, 900], q: 1.1, forca: 0.9, picoEm: 0.55 });
        if (!v.leve) ar(v, t, { dur: dur * 0.9, faixa: [2500, 5200, 3000], q: 2.5, forca: 0.25, picoEm: 0.5 });
        deslize(v, t, dur, giros, 0.25);
        return madeira(v, t + dur - 0.01, 330, 0.2, 0.05);
      }
    },

    'curva-perfeita': {
      grupo: 'Corrida', quando: 'Curva feita dentro do limite (só o seu carro)',
      barramento: 'pista', nivel: 'acao', intervalo: 0.3, duracao: 1.25, ajuste: 11.5,
      tocar: function (v, t) {   // Ré5 -> Lá5, com um Ré6 bem leve por cima
        malho(v, t, 74, 0.6);
        malho(v, t + 0.09, 86, 0.15);
        return malho(v, t + 0.09, 81, 0.75);
      }
    },

    'calor': {
      grupo: 'Corrida', quando: 'Pagar Calor: cubos de madeira saltando do carro + chiado',
      barramento: 'pista', nivel: 'acao', intervalo: 0.1, duracao: 0.9, ajuste: 17,
      // o.quantidade: Calor pago. Um estalo por cubo da animação (2 por Calor, até 8), 60 ms entre eles
      tocar: function (v, t, o) {
        var cubos = limitar((o.quantidade || 1) * 2, 2, 8);
        var fim = t;
        for (var i = 0; i < cubos; i++) {
          var ti = t + i * 0.06 + sortear(-0.005, 0.005);
          fim = madeira(v, ti, variante(v, 'cubo', [1650, 1900, 2200, 2500]), sortear(0.55, 0.75), 0.045);
        }
        papel(v, t, { centro: 6000, q: 0.5, ataque: 0.02, queda: 0.5, forca: 0.18 });   // o calor chiando
        if (!v.leve) {   // estalinhos do chiado
          for (var k = 0; k < 6; k++) papel(v, t + sortear(0.03, 0.4), { centro: 5000, q: 1.5, ataque: 0.0005, queda: 0.003, forca: 0.25 });
        }
        return Math.max(fim, t + 0.52);
      }
    },

    'resfriar': {
      grupo: 'Corrida', quando: 'Resfriar (+1 Calor): um cubo volta ao motor, com um brilho frio',
      barramento: 'pista', nivel: 'acao', intervalo: 0.2, duracao: 1.15, ajuste: 17,
      tocar: function (v, t) {
        madeira(v, t, 1400, 0.6, 0.05);
        baque(v, t, 260, 0.25, 0.05);
        // brilho frio: ar agudo subindo + Mi6 e Lá6 de vidro, bem baixinhos
        ar(v, t + 0.04, { dur: 0.55, faixa: [4000, 8000, 6500], q: 2, forca: 0.3, picoEm: 0.3 });
        tom(v, t + 0.05, frequencia(88), 'sine', 0.04, 0.12, 0.9);
        tom(v, t + 0.09, frequencia(93), 'sine', 0.04, 0.09, 1);
        return t + 1.1;
      }
    },

    'derrapagem': {
      grupo: 'Corrida', quando: 'Derrapagem: pneu chiando + baque (o som mais forte da jogada)',
      barramento: 'pista', nivel: 'momento', intervalo: 0.5, duracao: 1, ajuste: 11,
      tocar: function (v, t) {
        pneu(v, t, 0.85, 0.8);
        var arrasto = v.ctx.createGain();   // o carro arrastando de lado
        arrasto.gain.value = 0;
        arrasto.connect(v.saida);
        fonteDeRuido(v, t, 0.75, filtro(v.ctx, 'lowpass', 900, 0.7, arrasto));
        golpe(arrasto.gain, t, 0.02, 0.5, 0.7);
        baque(v, t + 0.06, 70, 0.9, 0.18);
        madeira(v, t + 0.06, 240, 0.3, 0.08);
        return t + 0.9;
      }
    },

    /* ----------------------- Ritmo da partida ----------------------- */

    'semaforo': {
      grupo: 'Ritmo da partida', quando: 'Semáforo: cada luz vermelha (relé + tom quente em Ré5)',
      barramento: 'destaque', nivel: 'momento', intervalo: 0.3, duracao: 0.55, ajuste: 6,
      tocar: function (v, t) {
        rele(v, t, 1);
        return lampada(v, t + 0.005, 74, 0.18, 0.8);
      }
    },

    'semaforo-vai': {
      grupo: 'Ritmo da partida', quando: 'Semáforo verde: Ré6 + todos os motores acelerando',
      barramento: 'destaque', nivel: 'momento', intervalo: 0.5, duracao: 1.5, ajuste: 2,
      // o.carros: quantos carros no grid (2 ou 3)
      tocar: function (v, t, o) {
        rele(v, t, 1);
        lampada(v, t + 0.005, 86, 0.25, 0.8);
        var carros = limitar(o.carros || 3, 1, 3);
        var lados = [0, -0.35, 0.35];
        var timbres = [1, 0.88, 1.13];
        var giros = curva(32, function (s) { return s < 0.25 ? 0.95 * Math.sin(s / 0.25 * Math.PI / 2) : 0.95 - 0.45 * (s - 0.25) / 0.75; });
        var fim = t;
        for (var i = 0; i < carros; i++) {
          var destino = v.saida;
          if (v.ctx.createStereoPanner) {
            destino = v.ctx.createStereoPanner();
            destino.pan.value = lados[i];
            destino.connect(v.saida);
          }
          fim = ronco(v, t + 0.04 + i * 0.06, 1.3, giros, { timbre: timbres[i], subida: 95, forca: 0.5 }, destino);
        }
        return fim;
      }
    },

    'sua-vez': {
      grupo: 'Ritmo da partida', quando: '"Sua vez" (depois que os rivais jogam)',
      barramento: 'interface', nivel: 'toque', intervalo: 1, duracao: 1.25, ajuste: 12.5,
      tocar: function (v, t) {   // Lá4 -> Ré5: "pode jogar", sem susto
        malho(v, t, 69, 0.55);
        return malho(v, t + 0.12, 74, 0.7);
      }
    },

    'nova-rodada': {
      grupo: 'Ritmo da partida', quando: 'Começo de uma nova rodada (um Ré grave e suave)',
      barramento: 'destaque', nivel: 'sussurro', intervalo: 1, duracao: 1.65, ajuste: 12,
      tocar: function (v, t) {
        malho(v, t, 50, 0.35, { queda: 1.6 });
        return malho(v, t, 62, 0.6, { queda: 1.6 });
      }
    },

    'bandeirada': {
      grupo: 'Ritmo da partida', quando: 'Bandeirada: bandeira tremulando + o motivo (Ré maior se você venceu)',
      barramento: 'destaque', nivel: 'momento', intervalo: 2, duracao: 2.3, ajuste: 9.5,
      // o.venceu: true = motivo em Ré maior, com metais; false = motivo dórico descendo, gentil
      tocar: function (v, t, o) {
        tremular(v, t, 2.1, 0.5);
        if (o.venceu !== false) {
          var notas = [74, 78, 79, 81];   // Ré Fá# Sol Lá: a mesma virada da trilha na vitória
          notas.forEach(function (nota, i) {
            var ti = t + 0.1 + i * 0.15;
            var ultima = i === notas.length - 1;
            malho(v, ti, nota, 0.7, ultima ? { queda: 1.6 } : null);
            metais(v, ti, nota - 12, ultima ? 0.9 : 0.13, 0.25);
          });
          malho(v, t + 0.55, 74, 0.4, { queda: 1.6 });   // o acorde de Ré maior no fim
          malho(v, t + 0.55, 78, 0.35, { queda: 1.6 });
        } else {
          [69, 67, 65, 62].forEach(function (nota, i) {   // Lá Sol Fá Ré
            malho(v, t + 0.1 + i * 0.22, nota, 0.7, i === 3 ? { queda: 1.5 } : null);
          });
          malho(v, t + 0.76, 57, 0.45, { queda: 1.5 });
        }
        return t + 2.15;
      }
    },

    'podio': {
      grupo: 'Ritmo da partida', quando: 'Tela de fim: cada bloco do pódio assenta (o do 1º lugar mais brilhante)',
      barramento: 'mesa', nivel: 'toque', intervalo: 0.5, duracao: 1, ajuste: 13.5,
      // o.lugares: colocações no pódio, ex.: [1, 2, 3]; o.semAnimacao: os blocos aparecem
      // de uma vez, então soa um baque só (o do 1º lugar)
      tocar: function (v, t, o) {
        var tempos = { 1: 0.87, 2: 0.62, 3: 0.52 };   // fim da subida de cada bloco (animacoes.css)
        var fim = t;
        (o.semAnimacao ? [1] : o.lugares || [1, 2, 3]).forEach(function (lugar) {
          var tl = t + (o.semAnimacao ? 0 : tempos[lugar] || 0.5) + sortear(-0.004, 0.004);
          var primeiro = lugar === 1;
          baque(v, tl, primeiro ? 120 : 140, primeiro ? 0.9 : 0.65, 0.12);
          fim = Math.max(fim, madeira(v, tl, primeiro ? 640 : 520, primeiro ? 0.7 : 0.5, 0.09));
        });
        return fim;
      }
    },

    /* --------------------------- Interface --------------------------- */

    'botao': {
      grupo: 'Interface', quando: 'Botões (Largar, Regras, Ranking, Revanche, Sair...)',
      barramento: 'interface', nivel: 'toque', intervalo: 0.05, duracao: 0.1, ajuste: 19,
      tocar: function (v, t) {   // "tock" de cartão
        papel(v, t, { centro: 1700, q: 1.1, ataque: 0.001, queda: 0.018, forca: 0.7 });
        madeira(v, t, 900, 0.15, 0.03);
        return baque(v, t, 210, 0.5, 0.035);
      }
    },

    'opcao': {
      grupo: 'Interface', quando: 'Escolher uma opção (rivais, dificuldade, caixas de marcar)',
      barramento: 'interface', nivel: 'sussurro', intervalo: 0.04, duracao: 0.05, ajuste: 21,
      // o.indice: posição da opção no grupo (as da direita soam um pouco mais agudas)
      tocar: function (v, t, o) {
        return madeira(v, t, 1500 * (1 + 0.06 * (o.indice || 0)), 0.5, 0.025);
      }
    },

    'modal-abrir': {
      grupo: 'Interface', quando: 'Abrir o livro de regras ou o ranking, e o cartaz da prova saindo (folha deslizando)',
      barramento: 'interface', nivel: 'toque', intervalo: 0.2, duracao: 0.3, ajuste: 14.5,
      tocar: function (v, t) {
        papel(v, t, { varrer: [900, 2800], q: 0.7, ataque: 0.06, queda: 0.2, forca: 0.7 });
        papel(v, t + 0.2, { centro: 1300, q: 0.9, ataque: 0.002, queda: 0.04, forca: 0.5 });
        return baque(v, t + 0.2, 150, 0.3, 0.05);
      }
    },

    'modal-fechar': {
      grupo: 'Interface', quando: 'Fechar o livro de regras ou o ranking (folha dobrando)',
      barramento: 'interface', nivel: 'toque', intervalo: 0.2, duracao: 0.2, ajuste: 22,
      tocar: function (v, t) {
        papel(v, t, { varrer: [2600, 1100], q: 0.8, ataque: 0.02, queda: 0.12, forca: 0.55 });
        return baque(v, t + 0.1, 140, 0.25, 0.05);
      }
    },

    'invalido': {
      grupo: 'Interface', quando: 'Ação inválida (carta a mais, fora da vez, marcha bloqueada...)',
      barramento: 'interface', nivel: 'toque', intervalo: 0.25, duracao: 0.2, ajuste: 18,
      tocar: function (v, t) {   // batidinha dupla de madeira grave: "não dá", sem bronca
        baque(v, t, 110, 0.3, 0.05);
        madeira(v, t, 420, 0.8, 0.07);
        return madeira(v, t + 0.085, 380, 0.65, 0.07);
      }
    },

    'erro': {
      grupo: 'Interface', quando: 'Erro de rede (duas notas descendo, abafadas)',
      barramento: 'interface', nivel: 'toque', intervalo: 0.5, duracao: 0.55, ajuste: 16,
      tocar: function (v, t) {
        malho(v, t, 69, 0.6, { abafado: true });
        return malho(v, t + 0.16, 65, 0.6, { abafado: true });
      }
    },

    'amostra': {
      grupo: 'Interface', quando: 'Ligar os efeitos ou mexer no volume deles (para ouvir o nível)',
      barramento: 'interface', nivel: 'toque', intervalo: 0.12, duracao: 1.2, ajuste: 15,
      tocar: function (v, t) {
        papel(v, t, { varrer: [1800, 3800], q: 0.9, ataque: 0.002, queda: 0.03, forca: 0.5 });
        return malho(v, t + 0.012, 81, 0.55);
      }
    }
  };

  function duracaoDe(som, opcoes) {
    return typeof som.duracao === 'function' ? som.duracao(opcoes || {}) : som.duracao;
  }

  /* ============================== VOZES ============================== */

  // Monta e agenda um som no estúdio "est". Devolve true se tocou.
  // "cru" (só nos testes): a receita pura a -20 dB (sem nível, ajuste nem
  // variação), para medir o pico dela sem encostar na curva de segurança.
  var NIVEL_CRU = -20;

  function tocarNo(est, nome, opcoes, cru) {
    var som = SONS[nome];
    if (!som) {
      avisarUmaVez('Som desconhecido: "' + nome + '".');
      return false;
    }
    var o = opcoes || {};
    var ctx = est.ctx;
    var t = ctx.currentTime + 0.012 + Math.max(0, o.atraso || 0);

    // 1. Intervalo mínimo: o mesmo som não toca duas vezes quase juntas
    var ultimo = est.ultimos[nome];
    if (ultimo !== undefined && Math.abs(t - ultimo) < som.intervalo) return false;

    // 2. Habituação: repetido muitas vezes seguidas, vai ficando mais baixo
    var recentes = (est.recentes[nome] || []).filter(function (x) { return Math.abs(t - x) < HABITUACAO.janela; });
    recentes.push(t);
    est.recentes[nome] = recentes;
    est.ultimos[nome] = t;
    var habituacao = Math.max(HABITUACAO.minimo, HABITUACAO.passo * Math.max(0, recentes.length - HABITUACAO.livres));

    // 3. Limite de vozes: se está cheio, o som menos importante cede a vez
    var nivel = NIVEIS[som.nivel];
    if (!abrirVaga(est, nivel.prioridade, t)) return false;

    // 4. A voz: ganho (nível + variação) -> [abafado, se for bot] -> pan -> barramento
    var forca = o.forca === undefined ? 1 : o.forca;
    var db = cru ? NIVEL_CRU : nivel.volume + som.ajuste + habituacao + (o.distante ? DISTANTE : 0) + sortear(-VARIACAO_DB, VARIACAO_DB);
    var saida = ctx.createGain();
    saida.gain.value = dB(db) * forca;
    var elos = [saida];
    if (o.distante) elos.push(filtro(ctx, 'lowpass', CORTE_DISTANTE, 0.7));
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = limitar(o.pan || 0, -1, 1);
      elos.push(pan);
    }
    for (var i = 0; i < elos.length - 1; i++) elos[i].connect(elos[i + 1]);
    elos[elos.length - 1].connect(est.mesa.barramentos[som.barramento]);

    var v = {
      ctx: ctx,
      est: est,
      saida: saida,
      pan: pan ? pan.pan : null,
      leve: est.leve === undefined ? leve : est.leve,
      brilho: cru ? 1 : sortear(0.9, 1.1),
      afinacao: cru ? 1 : sortear(0.97, 1.03)
    };
    var fim;
    try {
      fim = som.tocar(v, t, o);
    } catch (erro) {   // uma receita com defeito nunca trava o jogo
      avisarUmaVez('Falha ao tocar "' + nome + '": ' + erro.message);
      saida.disconnect();
      return false;
    }
    fim = Math.max(t, fim || t);
    est.vozes.push({ inicio: t, fim: fim, prioridade: nivel.prioridade, saida: saida });
    est.picoDeVozes = Math.max(est.picoDeVozes, vozesEm(est, t).length);
    est.fimMaisTarde = Math.max(est.fimMaisTarde, fim);
    if (som.nivel === 'momento') abaixar(est, t, fim);
    if (!est.offline) {   // desliga a voz da mesa quando o som (e a sala) terminar
      setTimeout(function () {
        elos.forEach(function (elo) { elo.disconnect(); });
      }, (fim - ctx.currentTime + 1) * 1000);
    }
    return true;
  }

  // As vozes que estão soando no instante t
  function vozesEm(est, t) {
    return est.vozes.filter(function (voz) { return voz.inicio <= t + 0.001 && voz.fim > t; });
  }

  // Abre lugar para um som que começa em t. Se já há o máximo de vozes
  // soando nesse instante, a de menor prioridade cede (entre as iguais, a
  // mais antiga). Devolve false se o som novo não tem lugar.
  function abrirVaga(est, prioridade, t) {
    var agora = est.ctx.currentTime;
    est.vozes = est.vozes.filter(function (voz) { return voz.fim > agora; });   // esquece as que já acabaram
    var soando = vozesEm(est, t);
    var maximo = (est.leve === undefined ? leve : est.leve) ? MAX_VOZES_LEVE : MAX_VOZES;
    if (soando.length < maximo) return true;
    var alvo = null;
    soando.forEach(function (voz) {
      if (voz.prioridade >= prioridade) return;
      if (!alvo || voz.prioridade < alvo.prioridade || (voz.prioridade === alvo.prioridade && voz.inicio < alvo.inicio)) alvo = voz;
    });
    if (alvo) {
      alvo.saida.gain.setTargetAtTime(0, Math.max(t, agora), 0.015);   // some em ~50 ms, sem estalo
      est.vozes.splice(est.vozes.indexOf(alvo), 1);
      return true;
    }
    return prioridade >= NIVEIS.momento.prioridade;   // um momento sempre toca
  }

  // Um momento abaixa a interface e a mesa enquanto toca
  function abaixar(est, t, fim) {
    est.abaixadoAte = Math.max(est.abaixadoAte, fim);
    ['interface', 'mesa'].forEach(function (nome) {
      var param = est.mesa.barramentos[nome].gain;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(dB(ABAIXAR), t, 0.04);
      param.setTargetAtTime(1, est.abaixadoAte, 0.2);
    });
  }

  /* ============================ CONTEXTO ============================ */

  // Liga ou suspende o áudio conforme a necessidade: efeitos desligados,
  // aba escondida ou alguns segundos de silêncio = suspenso (não gasta processador)
  function ajustarContexto() {
    if (!S) return;
    var ctx = S.ctx;
    var querSom = !mudo && !document.hidden && ctx.currentTime < S.fimMaisTarde + DESCANSO;
    if (querSom && ctx.state === 'suspended') ctx.resume().catch(function () {});
    if (!querSom && ctx.state === 'running') ctx.suspend().catch(function () {});
    clearTimeout(vigia);
    if (querSom) vigia = setTimeout(ajustarContexto, (S.fimMaisTarde + DESCANSO - ctx.currentTime) * 1000 + 200);
  }

  function aplicarVolume(suavidade) {
    if (!S) return;
    var param = S.mesa.volume.gain;
    var agora = S.ctx.currentTime;
    param.cancelScheduledValues(agora);
    param.setTargetAtTime(mudo ? 0 : volume * volume, agora, suavidade);   // curva quadrática: mais natural ao ouvido
  }

  /* =============================== API =============================== */

  // Liga o som. Precisa ser chamada dentro de um clique ou tecla (regra de
  // autoplay dos navegadores). Pode ser chamada várias vezes sem problema.
  function init() {
    var Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;   // navegador sem Web Audio: o jogo segue sem efeitos
    if (!S) {
      var ctx;
      try {
        ctx = new Contexto({ latencyHint: 'interactive' });   // efeito precisa responder ao clique na hora
      } catch (erro) {
        ctx = new Contexto();
      }
      S = criarEstudio(ctx);
      S.fimMaisTarde = ctx.currentTime;   // fica ligado uns segundos, pronto para o primeiro som
      ligarSala(S, !leve);
      aplicarVolume(0.02);
      document.addEventListener('visibilitychange', ajustarContexto);
    }
    ajustarContexto();
  }

  function tocar(nome, opcoes) {
    if (!S || mudo || document.hidden) return false;   // aba escondida: o som é descartado, não acumulado
    var tocou = tocarNo(S, nome, opcoes);
    if (tocou) ajustarContexto();
    return tocou;
  }

  function setVolume(valor) {
    volume = limitar(Number(valor) || 0, 0, 1);
    aplicarVolume(0.05);
  }

  function mute() {
    mudo = true;
    aplicarVolume(0.04);
    setTimeout(ajustarContexto, 300);   // suspende depois que o volume chegou a zero
  }

  function unmute() {
    mudo = false;
    if (S) S.fimMaisTarde = Math.max(S.fimMaisTarde, S.ctx.currentTime);
    ajustarContexto();
    aplicarVolume(0.05);
  }

  // Modo leve: sem sala, menos camadas nos sons e no máximo 12 vozes
  function setLightMode(ligado) {
    leve = !!ligado;
    if (S) ligarSala(S, !leve);
  }

  function getInfo() {
    var agora = S ? S.ctx.currentTime : 0;
    return {
      iniciado: !!S,
      teto: TETO,
      nivelCru: NIVEL_CRU,
      estado: S ? S.ctx.state : 'desligado',
      volume: volume,
      mudo: mudo,
      leve: leve,
      vozes: S ? S.vozes.filter(function (voz) { return voz.fim > agora; }).length : 0
    };
  }

  // Os sons e o que se sabe de cada um (para a página de audição)
  function lista() {
    return Object.keys(SONS).map(function (nome) {
      var som = SONS[nome];
      return {
        nome: nome, grupo: som.grupo, quando: som.quando, nivel: som.nivel, volume: NIVEIS[som.nivel].volume,
        picoMax: NIVEIS[som.nivel].picoMax, ajuste: som.ajuste, barramento: som.barramento, duracao: duracaoDe(som, {})
      };
    });
  }

  // Gera sons sem tocar nada (contexto offline) e devolve uma Promise com o
  // AudioBuffer. Usada para medir e verificar cada som.
  //   alvo: o nome de um som, ou uma sequência [{ nome, opcoes, atraso }, ...]
  //   extra: cru (true = receita pura a -20 dB, sem nível e sem variação),
  //          volume (0..1), leve (true/false), segundos (duração do render),
  //          vezes e espaco (s): repete o som, para testar o conforto.
  // O buffer volta com "resultados" (tocou ou não, um por som pedido) e
  // "picoDeVozes" (o máximo de vozes soando juntas).
  function renderOffline(alvo, opcoes, extra) {
    extra = extra || {};
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return Promise.reject(new Error('Navegador sem áudio offline.'));
    var sequencia = Array.isArray(alvo) ? alvo : [];
    if (!Array.isArray(alvo)) {
      for (var i = 0; i < (extra.vezes || 1); i++) sequencia.push({ nome: alvo, opcoes: opcoes, atraso: i * (extra.espaco || 0) });
    }
    var desconhecido = sequencia.filter(function (item) { return !SONS[item.nome]; })[0];
    if (desconhecido) return Promise.reject(new Error('Som desconhecido: "' + desconhecido.nome + '".'));

    var taxa = 44100;
    var segundos = extra.segundos || 0.8 + Math.max.apply(null, sequencia.map(function (item) {
      return (item.atraso || 0) + duracaoDe(SONS[item.nome], item.opcoes);
    }));
    var ctx = new Offline(2, Math.ceil(segundos * taxa), taxa);
    var est = criarEstudio(ctx);
    est.offline = true;
    est.leve = extra.leve === undefined ? leve : !!extra.leve;
    ligarSala(est, !est.leve);
    est.mesa.volume.gain.value = extra.volume === undefined ? 1 : extra.volume * extra.volume;
    var resultados = sequencia.map(function (item) {
      var o = {};
      Object.keys(item.opcoes || {}).forEach(function (k) { o[k] = item.opcoes[k]; });
      o.atraso = (o.atraso || 0) + (item.atraso || 0);
      return tocarNo(est, item.nome, o, extra.cru);
    });
    return ctx.startRendering().then(function (buffer) {
      buffer.resultados = resultados;
      buffer.picoDeVozes = est.picoDeVozes;
      return buffer;
    });
  }

  return {
    init: init,
    tocar: tocar,
    setVolume: setVolume,
    mute: mute,
    unmute: unmute,
    setLightMode: setLightMode,
    // extras da página de audição
    getInfo: getInfo,
    lista: lista,
    renderOffline: renderOffline
  };
})();
