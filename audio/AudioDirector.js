/* =====================================================================
   AudioDirector.js — A trilha sonora do jogo, composta em código
   ---------------------------------------------------------------------
   Não existe nenhum arquivo de áudio: cada nota é sintetizada na hora
   com a Web Audio API. O estilo é o das trilhas de corrida dos anos
   60–70 (Grand Prix): jazz elegante, orquestra leve, cinema europeu.

   API (o jogo só precisa disto):
     AudioDirector.init()            liga o som. Chamar num clique ou tecla:
                                     o navegador bloqueia som sem um gesto.
     AudioDirector.setScene(nome)    'menu' | 'planning' | 'pushing' |
                                     'overheat' | 'finalLap' | 'victory'
     AudioDirector.setHeat(0..1)     calor do motor: na cena 'pushing' muda
                                     o andamento, a densidade e o brilho
     AudioDirector.setVolume(0..1)   volume da música
     AudioDirector.mute() / unmute() silencia / devolve o som
     AudioDirector.setLightMode(bool) modo leve, para computadores fracos
   Extras para o painel de teste:
     stop(), getInfo(), previewMotif(instrumento), renderOffline(cena, segundos)

   Como a música é montada:
     1. RELÓGIO: a cada 25 ms um "pulso" olha o relógio do áudio
        (AudioContext.currentTime) e agenda o que vai soar nos próximos
        0,2 s. As notas são marcadas no relógio do áudio, que é preciso;
        o setInterval só serve para acordar o agendador.
     2. CENA: no começo de cada compasso, a cena "compõe" as notas daquele
        compasso (baixo, piano, vibrafone...) e coloca tudo numa fila.
     3. INSTRUMENTOS: cada nota da fila vira osciladores + filtros +
        envelope de volume, ligados ao canal do instrumento.
     4. MESA DE SOM:
          canal -> fader da camada -> FITA -> volume -> caixas de som
               \-> envio de reverb -> SALA -/
        A fita dá o ar de gravação antiga: wow/flutter, saturação leve,
        agudos suaves e um chiado bem baixinho.

   Trocas de cena: setScene só "pede" a cena. A troca acontece no começo
   do próximo compasso: a camada nova sobe enquanto a velha desce (1–2 s).
   Cada cena toca um mínimo de compassos antes de sair, para a música não
   ficar pulando quando o jogo muda de ideia rápido.

   Mapa do arquivo: AJUSTES · ESTADO · LEITMOTIV · HARMONIA · UTILITÁRIOS ·
   MESA DE SOM · INSTRUMENTOS · CAMADAS · ESCRITOR · RELÓGIO · CENAS ·
   MÚSICA GRAVADA (mp3) · API
   ===================================================================== */

var AudioDirector = (function () {
  'use strict';

  /* ============================ AJUSTES ============================ */

  var ANTECEDENCIA = 0.2;   // s: o agendador marca as notas com esta folga
  var PULSO_MS = 25;        // ms: de quanto em quanto tempo o agendador acorda
  var MAX_VOZES = 40;       // notas soando juntas, no máximo (protege o processador)
  var MAX_VOZES_LEVE = 24;  // o mesmo limite no modo leve (computadores mais fracos)
  var FADE_ENTRADA = 1.5;   // s para uma cena aparecer (cada cena pode ter o seu)
  var FADE_SAIDA = 1.5;     // s para uma cena sumir
  var CAUDA = 2.5;          // s de reverb que ainda soam depois da última nota
  var VOLUME_PADRAO = 0.65; // deixa espaço para os efeitos sonoros (audio/Efeitos.js, padrão 85%)
  var GANHO_SAIDA = 2;      // compensa a saturação da fita, que segura os picos
  var TETO = 0.9;           // o som nunca passa disto (1 = o máximo da placa de som)
  var CHIADO = 0.005;       // volume do chiado de fita (bem discreto)
  var WOW = 0.0009;         // quanto a fita "oscila" (cada cena pode multiplicar)

  // Canais da mesa: volume, posição no estéreo (-1 esquerda, 1 direita)
  // e quanto do som vai para a sala (reverb). Lembra um palco de jazz.
  var CANAIS = {
    baixo:     { ganho: 0.32, pan: -0.05, sala: 0.10 },
    piano:     { ganho: 0.64, pan: -0.28, sala: 0.25 },
    vibrafone: { ganho: 0.77, pan:  0.32, sala: 0.38 },
    bateria:   { ganho: 1.5,  pan:  0.12, sala: 0.20 },
    metais:    { ganho: 0.55, pan:  0.22, sala: 0.30 },
    cordas:    { ganho: 0.75, pan: -0.12, sala: 0.50 }
  };

  // Humanização: quanto cada músico pode adiantar ou atrasar (em segundos)
  var FOLGA = { baixo: 0.004, piano: 0.008, vibrafone: 0.007, bateria: 0.005, metais: 0.01, cordas: 0.012 };

  /* ============================= ESTADO ============================= */

  var S = null;             // o "estúdio": contexto de áudio, mesa, relógio, fila e camadas
  var cenaPedida = null;    // cena que o jogo pediu (vale até antes do init)
  var volume = VOLUME_PADRAO;
  var mudo = false;
  var calor = 0;            // 0 a 1: quanto do motor o jogador já gastou (ou vai gastar)
  var leve = false;         // modo leve: menos vozes e instrumentos mais simples

  /* ========================== O LEITMOTIV ==========================
     "O Motor": Ré3 – Fá3 – Sol3 – Lá3, em Ré dórico.
     Ritmo: colcheia, colcheia, colcheia, semínima (½ ½ ½ 1 tempo).
     As notas estão em números MIDI: Lá4 = 69 (440 Hz), +1 = meio tom,
     +12 = uma oitava acima. Ré3 = 50.
     ================================================================== */
  var MOTIVO = {
    dorico:        [50, 53, 55, 57],   // Ré Fá Sol Lá: o tema de sempre
    maior:         [50, 54, 55, 57],   // Ré Fá# Sol Lá: clímax da reta final e vitória
    superaquecido: [50, 53, 55, 56],   // Ré Fá Sol Láb: o motor engasgando
    ritmo:         [0.5, 0.5, 0.5, 1]
  };

  /* =========================== HARMONIA ===========================
     Ré dórico usa as mesmas notas de Dó maior; o Si natural é a "cor"
     do modo (o que o diferencia de Ré menor comum).
     raiz: nota do baixo · tons: intervalos do acorde (para o baixo andar)
     voz: como o piano toca o acorde, sem a raiz (que fica com o baixo)
     ================================================================== */
  var ESCALA = [0, 2, 4, 5, 7, 9, 11];   // Dó Ré Mi Fá Sol Lá Si

  var ACORDES = {
    Dm9:     { raiz: 38, tons: [0, 3, 7, 10], voz: [53, 57, 60, 64] },   // Fá Lá Dó Mi
    G13:     { raiz: 43, tons: [0, 4, 7, 10], voz: [53, 57, 59, 64] },   // Fá Lá Si Mi
    Em7:     { raiz: 40, tons: [0, 3, 7, 10], voz: [55, 59, 62, 64] },   // Sol Si Ré Mi
    'Em7/D': { raiz: 38, tons: [0, 2, 5, 9],  voz: [55, 59, 62, 64] },   // Mi menor sobre o Ré (pedal)
    A9sus4:  { raiz: 45, tons: [0, 5, 7, 10], voz: [55, 59, 62, 64] },   // Sol Si Ré Mi
    Fmaj9:   { raiz: 41, tons: [0, 4, 7, 11], voz: [57, 60, 64, 67] },   // Lá Dó Mi Sol
    Cmaj9:   { raiz: 36, tons: [0, 4, 7, 11], voz: [52, 55, 59, 62] }    // Mi Sol Si Ré
  };

  /* ========================== UTILITÁRIOS ========================== */

  function frequencia(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function limitar(valor, min, max) { return Math.min(max, Math.max(min, valor)); }
  function sortear(min, max) { return min + Math.random() * (max - min); }
  function escolher(lista) { return lista[Math.floor(Math.random() * lista.length)]; }
  function naEscala(midi) { return ESCALA.indexOf(((midi % 12) + 12) % 12) !== -1; }

  // Nota da escala vizinha: direcao +1 = a de cima, -1 = a de baixo
  function vizinhaNaEscala(midi, direcao) {
    var m = midi + direcao;
    while (!naEscala(m)) m += direcao;
    return m;
  }

  // Traz a nota para a extensão do contrabaixo (Mi1 = 28 a Ré3 = 50)
  function noRegistroDoBaixo(midi) {
    while (midi > 50) midi -= 12;
    while (midi < 28) midi += 12;
    return midi;
  }

  // A raiz do acorde na oitava confortável do baixo (Lá1 a Dó3) mais perto da referência
  function oitavaPerto(midi, referencia) {
    var melhor = null;
    for (var m = noRegistroDoBaixo(midi) - 12; m <= 50; m += 12) {
      if (m < 33 || m > 48) continue;
      if (melhor === null || Math.abs(m - referencia) < Math.abs(melhor - referencia)) melhor = m;
    }
    return melhor === null ? noRegistroDoBaixo(midi) : melhor;
  }

  function filtro(ctx, tipo, freq, q) {
    var f = ctx.createBiquadFilter();
    f.type = tipo;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // Leva um parâmetro até "alvo" a partir de "inicio", em cerca de "duracao"
  // segundos (curva suave, chega a 99% no fim). Usamos setTargetAtTime porque
  // ele parte do valor que o parâmetro tem naquele instante. Uma rampa linear
  // marcada no futuro pode "pular" quando não há um ponto de partida marcado
  // (os testes acharam isso: um buraco no som logo antes das trocas de cena).
  function rampa(param, alvo, inicio, duracao) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(inicio);
    else param.cancelScheduledValues(inicio);
    param.setTargetAtTime(alvo, inicio, duracao / 5);
  }

  // Envelope de nota percutida (baixo, piano, vibrafone): sobe rápido, perde o
  // brilho do ataque, vai morrendo sozinha e é abafada no fim da duração.
  // Devolve a hora em que o som acabou (para desligar os osciladores).
  function envelopePercussivo(param, t, ataque, pico, quedaRapida, nivel, quedaLenta, corte, soltura) {
    var t1 = t + ataque;
    corte = Math.max(corte, t1 + 0.01);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(pico, t1);
    param.setTargetAtTime(pico * nivel, t1, quedaRapida);
    var t2 = t1 + quedaRapida * 3;
    if (t2 < corte) param.setTargetAtTime(0, t2, quedaLenta);
    param.setTargetAtTime(0, corte, soltura);
    return corte + soltura * 6;
  }

  // Envelope de nota sustentada (cordas, metais): sobe em "ataque", segura
  // (caindo até "sustentacao" do pico) e solta no fim.
  function envelopeSustentado(param, t, ataque, pico, sustentacao, fim, soltura) {
    var t1 = t + ataque;
    fim = Math.max(fim, t1 + 0.01);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(pico, t1);
    if (sustentacao < 1) param.setTargetAtTime(pico * sustentacao, t1, 0.15);
    param.setTargetAtTime(0, fim, soltura);
    return fim + soltura * 6;
  }

  /* ========================== MESA DE SOM ========================== */

  function montarMesa(ctx) {
    var m = {};
    m.ruido = criarRuido(ctx, 2);          // ruído branco: escovinha, sopro, chiado
    m.ondas = criarOndasDoPiano(ctx);

    // FITA: toda a música entra aqui
    m.fita = ctx.createGain();

    // SALA: reverb com uma resposta ao impulso gerada em código
    m.sala = ctx.createGain();             // entrada dos envios de reverb
    var reverb = ctx.createConvolver();
    reverb.buffer = criarRespostaDaSala(ctx, 1.8, 1.5);
    m.retornoSala = ctx.createGain();
    m.retornoSala.gain.value = 0.5;
    m.sala.connect(reverb);
    reverb.connect(m.retornoSala);
    m.retornoSala.connect(m.fita);

    // Wow e flutter: um atraso que oscila devagar faz a afinação "respirar"
    // como numa fita antiga (no máximo uns 5 centésimos de semitom)
    var atraso = ctx.createDelay(0.05);
    atraso.delayTime.value = 0.01;
    m.wow = ligarLfo(ctx, 0.33, WOW, atraso.delayTime);   // wow: lento (a cena pode aumentar)
    ligarLfo(ctx, 6.3, 0.00002, atraso.delayTime);        // flutter: rápido e mínimo

    // Equalização "vintage": tira o grave inútil e o agudo áspero
    var semGraves = filtro(ctx, 'highpass', 35, 0.7);
    var semAgudos = filtro(ctx, 'lowpass', 7500, 0.5);

    // Saturação leve de fita: arredonda os picos e esquenta o som. A curva tem
    // um teto: com o volume no máximo, a saída nunca passa de TETO (assim o
    // som nunca chega a distorcer na placa de som)
    var saturacao = ctx.createWaveShaper();
    saturacao.curve = curvaDaFita(GANHO_SAIDA / TETO);
    m.curvaBaixo = curvaSuave(2);          // a "madeira" do contrabaixo (ver tocarBaixo)

    m.volume = ctx.createGain();
    m.volume.gain.value = 0;

    m.fita.connect(atraso);
    atraso.connect(semGraves);
    semGraves.connect(semAgudos);
    semAgudos.connect(saturacao);
    saturacao.connect(m.volume);
    m.volume.connect(ctx.destination);

    // Chiado de fita: ruído filtrado bem baixo, só enquanto há música
    m.chiado = ctx.createGain();
    m.chiado.gain.value = 0;
    var fonte = ctx.createBufferSource();
    fonte.buffer = m.ruido;
    fonte.loop = true;
    var cor = filtro(ctx, 'bandpass', 5000, 0.5);
    fonte.connect(cor);
    cor.connect(m.chiado);
    m.chiado.connect(m.volume);
    fonte.start();
    return m;
  }

  // Oscilador lento que mexe num parâmetro (LFO). Devolve o ganho, que
  // controla o quanto ele mexe.
  function ligarLfo(ctx, freq, profundidade, param) {
    var lfo = ctx.createOscillator();
    var ganho = ctx.createGain();
    lfo.frequency.value = freq;
    ganho.gain.value = profundidade;
    lfo.connect(ganho);
    ganho.connect(param);
    lfo.start();
    return ganho;
  }

  function criarRuido(ctx, segundos) {
    var tamanho = Math.floor(ctx.sampleRate * segundos);
    var buffer = ctx.createBuffer(1, tamanho, ctx.sampleRate);
    var dados = buffer.getChannelData(0);
    for (var i = 0; i < tamanho; i++) dados[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // Resposta ao impulso de uma sala: ruído que morre aos poucos (-60 dB em
  // "rt60" segundos) e vai ficando mais abafado, com algumas reflexões
  // iniciais das paredes. Cada canal é diferente, para soar em estéreo.
  function criarRespostaDaSala(ctx, duracao, rt60) {
    var taxa = ctx.sampleRate;
    var tamanho = Math.floor(taxa * duracao);
    var preAtraso = Math.floor(0.015 * taxa);
    var queda = Math.exp(-6.9 / (rt60 * taxa));        // multiplicador por amostra
    var buffer = ctx.createBuffer(2, tamanho, taxa);
    for (var canal = 0; canal < 2; canal++) {
      var dados = buffer.getChannelData(canal);
      var amplitude = 1;
      var filtrado = 0;
      for (var i = preAtraso; i < tamanho; i++) {
        var brilho = 0.9 - 0.75 * (i - preAtraso) / (tamanho - preAtraso);
        filtrado += ((Math.random() * 2 - 1) - filtrado) * brilho;   // passa-baixa que vai fechando
        dados[i] = filtrado * amplitude;
        amplitude *= queda;
      }
      [0.011, 0.019, 0.027, 0.037, 0.049].forEach(function (segundos, k) {
        var posicao = preAtraso + Math.floor((segundos + canal * 0.003) * taxa);
        if (posicao < tamanho) dados[posicao] += (k % 2 ? -1 : 1) * (0.6 - k * 0.09);
      });
    }
    return buffer;
  }

  // Curva da saturação: tanh suave, com ganho 1 nos sinais baixos
  function curvaDaFita(k) {
    var pontos = 2048;
    var curva = new Float32Array(pontos);
    for (var i = 0; i < pontos; i++) {
      var x = (i / (pontos - 1)) * 2 - 1;
      curva[i] = Math.tanh(k * x) / k;
    }
    return curva;
  }

  // Curva que arredonda a onda sem mudar o volume máximo (-1 a 1)
  function curvaSuave(k) {
    var pontos = 1024;
    var curva = new Float32Array(pontos);
    for (var i = 0; i < pontos; i++) {
      var x = (i / (pontos - 1)) * 2 - 1;
      curva[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curva;
  }

  // Ondas do piano: "corpo" (harmônicos graves, longos) e "brilho" (harmônicos
  // agudos, que somem logo depois do martelo). Cada número é o volume de um harmônico.
  function criarOndasDoPiano(ctx) {
    function onda(harmonicos) {
      var real = new Float32Array(harmonicos.length + 1);
      var imag = new Float32Array(harmonicos.length + 1);
      harmonicos.forEach(function (volume, i) { imag[i + 1] = volume; });
      return ctx.createPeriodicWave(real, imag);
    }
    return {
      corpo: onda([1, 0.45, 0.22, 0.12, 0.05]),
      brilho: onda([0, 0, 0.35, 0.3, 0.22, 0.15, 0.1, 0.07, 0.05, 0.03])
    };
  }

  /* ========================== INSTRUMENTOS ==========================
     Cada função recebe o destino (o canal do instrumento), a hora t no
     relógio do áudio, a nota MIDI, a duração em segundos e a força
     (0 a 1). Devolve a hora em que o som termina.
     Nota MIDI "quebrada" (ex.: 50,1) é uma nota levemente desafinada.
     ================================================================== */

  // CONTRABAIXO ACÚSTICO: triângulo (a nota, levemente "engrossado") + senoide uma
  // oitava acima (o 2º harmônico da corda: faz o baixo aparecer até em caixinha de
  // notebook, que não toca o grave), "puxada" de corda e passa-baixa
  function tocarBaixo(destino, t, midi, dur, vel) {
    var ctx = S.ctx;
    var f = frequencia(midi);
    var triangulo = ctx.createOscillator();
    var senoide = ctx.createOscillator();
    triangulo.type = 'triangle';
    senoide.type = 'sine';
    triangulo.frequency.value = f;
    senoide.frequency.value = f * 2;
    [triangulo, senoide].forEach(function (o) {
      o.detune.setValueAtTime(12, t);          // a corda puxada sai um tiquinho acima
      o.detune.setTargetAtTime(0, t, 0.03);    // ...e assenta na nota
    });
    var madeira = ctx.createWaveShaper();      // saturação leve: mais harmônicos, som de corda
    madeira.curve = S.mesa.curvaBaixo;
    var corpo = ctx.createGain();
    var harmonico = ctx.createGain();
    // filtro fixo (filtro que se mexe a cada nota pesa no processador); o
    // "estalo" do ataque vem do harmônico, que morre mais rápido que o corpo
    var passaBaixa = filtro(ctx, 'lowpass', 850 + 400 * vel, 1.2);
    var fim = Math.max(
      envelopePercussivo(corpo.gain, t, 0.006, 0.5 * vel, 0.12, 0.55, 1.2, t + dur, 0.05),
      envelopePercussivo(harmonico.gain, t, 0.006, 0.28 * vel, 0.08, 0.5, 0.6, t + dur, 0.05)
    );

    triangulo.connect(madeira);
    madeira.connect(corpo);
    senoide.connect(harmonico);
    corpo.connect(passaBaixa);
    harmonico.connect(passaBaixa);
    passaBaixa.connect(destino);
    triangulo.start(t);
    senoide.start(t);
    triangulo.stop(fim);
    senoide.stop(fim);
    tocarRuido(destino, t, 'lowpass', 1300, 0.8, 0.002, 0.12 * vel, 0.012);   // o "tum" do dedo
    return fim;
  }

  // PIANO: harmônicos somados, queda longa (mais longa nas notas graves)
  function tocarPiano(destino, t, midi, dur, vel) {
    var ctx = S.ctx;
    var f = frequencia(midi);
    var grave = limitar((76 - midi) / 40, 0, 1);
    var quedaLenta = 0.8 + 2.4 * grave;
    var saida = filtro(ctx, 'lowpass', Math.min(9000, 900 + f * 4 + 4000 * vel), 0.5);
    saida.connect(destino);

    var corpo = ctx.createGain();
    var brilho = ctx.createGain();
    corpo.connect(saida);
    brilho.connect(saida);
    // duas cordas por nota, levemente desafinadas entre si: o "brilho vivo" do
    // piano (no modo leve, uma corda só)
    var cordas = [
      oscPeriodico(ctx, S.mesa.ondas.corpo, f, 0, corpo),
      oscPeriodico(ctx, S.mesa.ondas.brilho, f, -1, brilho)
    ];
    if (!leve) cordas.push(oscPeriodico(ctx, S.mesa.ondas.corpo, f, sortear(1, 2.5), corpo));
    var fim = Math.max(
      envelopePercussivo(corpo.gain, t, 0.003, 0.16 * vel * (leve ? 1.5 : 1), 0.15, 0.5, quedaLenta, t + dur, 0.1),
      envelopePercussivo(brilho.gain, t, 0.002, 0.12 * vel * (0.5 + vel), 0.05, 0.2, 0.4, t + dur, 0.08)
    );
    cordas.forEach(function (o) { o.start(t); o.stop(fim); });
    return fim;
  }

  function oscPeriodico(ctx, onda, f, desafino, destino) {
    var o = ctx.createOscillator();
    o.setPeriodicWave(onda);
    o.frequency.value = f;
    o.detune.value = desafino;
    o.connect(destino);
    return o;
  }

  // VIBRAFONE: senoides nos modos da lâmina, queda longa e o tremolo do motor
  function tocarVibrafone(destino, t, midi, dur, vel) {
    var ctx = S.ctx;
    var f = frequencia(midi);
    // tremolo: o ventilador do vibrafone faz o volume ondular ~5 vezes por segundo
    var tremolo = ctx.createGain();
    tremolo.gain.value = 0.8;
    var lfo = ctx.createOscillator();
    var profundidade = ctx.createGain();
    lfo.frequency.value = 5.2;
    profundidade.gain.value = 0.2;
    lfo.connect(profundidade);
    profundidade.connect(tremolo.gain);
    tremolo.connect(destino);

    var parciais = [
      // [múltiplo da frequência, volume, queda rápida, nível, queda lenta]
      [1, 0.36, 0.25, 0.7, 2.4],    // fundamental: canta por bastante tempo
      [4, 0.1, 0.06, 0.3, 0.5],     // duas oitavas acima: o "metal" da lâmina
      [9.9, 0.04, 0.012, 0, 0.1]    // estalo da baqueta
    ];
    var fim = t + dur;
    var osciladores = [];
    parciais.forEach(function (p) {
      if (f * p[0] > 15000) return;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.frequency.value = f * p[0];
      o.connect(g);
      g.connect(tremolo);
      fim = Math.max(fim, envelopePercussivo(g.gain, t, 0.002, p[1] * vel, p[2], p[3], p[4], t + dur, 0.2));
      osciladores.push(o);
    });
    osciladores.forEach(function (o) { o.start(t); o.stop(fim); });
    lfo.start(t);
    lfo.stop(fim);
    return fim;
  }

  // BATERIA: escovinha, pratos e efeitos são ruído filtrado com envelope
  // curto; o bumbo e o tímpano são "peles" afinadas (osciladores).
  function tocarBateria(destino, t, peca, vel, midi) {
    switch (peca) {
      case 'varrida':   // escovinha arrastando em círculo na pele: "chhh"
        var r = tocarRuido(destino, t, 'bandpass', 2400, 0.7, 0.08, 0.12 * vel, 0.1);
        r.filtro.frequency.setValueAtTime(2400, t);
        r.filtro.frequency.linearRampToValueAtTime(3800, t + 0.3);
        return r.fim;
      case 'batida':    // escovinha batendo na caixa
        return tocarRuido(destino, t, 'bandpass', 1900, 0.9, 0.002, 0.3 * vel, 0.045).fim;
      case 'chimbal':   // chimbal fechado com o pé: "tchic"
        return tocarRuido(destino, t, 'highpass', 7000, 0.7, 0.001, 0.14 * vel, 0.02).fim;
      case 'bumbo':     // bumbo de feltro: mais sentido do que ouvido
        return tocarBumbo(destino, t, vel);
      case 'prato':     // prato de condução (ride): "tin"
        return tocarRuido(destino, t, 'bandpass', 6500, 1.2, 0.002, 0.1 * vel, 0.18).fim;
      case 'pratoAberto':      // prato de ataque: "tsshh" longo
        tocarRuido(destino, t, 'bandpass', 8000, 0.9, 0.002, 0.08 * vel, 0.25);
        return tocarRuido(destino, t, 'highpass', 4000, 0.7, 0.003, 0.14 * vel, 0.6).fim;
      case 'pratoCrescendo':   // prato que cresce durante 1,2 s (prepara o acorde final)
        return tocarRuido(destino, t, 'highpass', 3500, 0.7, 1.2, 0.14 * vel, 0.12).fim;
      case 'timbale':   // tímpano afinado (a nota vem em "midi")
        return tocarTimbale(destino, t, midi || 38, vel);
      case 'tique':     // metal quente esfriando: "tic"
        return tocarRuido(destino, t, 'bandpass', sortear(4000, 5500), 12, 0.001, 0.9 * vel, 0.012).fim;
      case 'engasgo':   // o motor engasgando: um ronco grave que "tosse"
        return tocarEngasgo(destino, t, vel);
      case 'ronco':     // ronco grave e contínuo do motor, bem baixo
        return tocarRuido(destino, t, 'lowpass', 110, 1, 0.6, 0.35 * vel, 1.2).fim;
    }
    return t;
  }

  // Ruído filtrado com envelope: a peça básica da bateria e dos efeitos
  function tocarRuido(destino, t, tipo, freq, q, ataque, pico, queda) {
    var ctx = S.ctx;
    var fonte = ctx.createBufferSource();
    fonte.buffer = S.mesa.ruido;
    fonte.loop = true;
    var f = filtro(ctx, tipo, freq, q);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pico, t + ataque);
    g.gain.setTargetAtTime(0, t + ataque, queda);
    fonte.connect(f);
    f.connect(g);
    g.connect(destino);
    var fim = t + ataque + queda * 5;
    fonte.start(t, Math.random() * S.mesa.ruido.duration);   // cada batida pega um trecho diferente
    fonte.stop(fim);
    return { filtro: f, fim: fim };
  }

  function tocarBumbo(destino, t, vel) {
    var ctx = S.ctx;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * vel, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.005, 0.09);
    o.connect(g);
    g.connect(destino);
    var fim = t + 0.7;
    o.start(t);
    o.stop(fim);
    tocarRuido(destino, t, 'lowpass', 300, 0.7, 0.003, 0.15 * vel, 0.03);
    return fim;
  }

  // TÍMPANO: a pele afinada (o modo principal e o modo 1,5 vez mais agudo)
  // e o golpe da baqueta
  function tocarTimbale(destino, t, midi, vel) {
    var ctx = S.ctx;
    var f = frequencia(midi);
    var fim = t + 2.5;
    [[1, 0.5, 0.55], [1.5, 0.2, 0.3]].forEach(function (modo) {   // [múltiplo, volume, queda]
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.frequency.setValueAtTime(f * modo[0] * 1.015, t);                // a pele estica com o golpe...
      o.frequency.exponentialRampToValueAtTime(f * modo[0], t + 0.12);   // ...e volta à afinação
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(modo[1] * vel, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, modo[2]);
      o.connect(g);
      g.connect(destino);
      o.start(t);
      o.stop(fim);
    });
    tocarRuido(destino, t, 'lowpass', 700, 0.8, 0.002, 0.25 * vel, 0.03);
    return fim;
  }

  // ENGASGO: ruído grave com o volume "tossindo" (um oscilador quadrado
  // abre e fecha o som, cada vez mais devagar)
  function tocarEngasgo(destino, t, vel) {
    var ctx = S.ctx;
    var fonte = ctx.createBufferSource();
    fonte.buffer = S.mesa.ruido;
    fonte.loop = true;
    var grave = filtro(ctx, 'lowpass', 380, 2);
    var tosse = ctx.createGain();
    tosse.gain.value = 0.5;
    var lfo = ctx.createOscillator();
    var profundidade = ctx.createGain();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(16, t);
    lfo.frequency.linearRampToValueAtTime(8, t + 0.7);
    profundidade.gain.value = 0.5;
    lfo.connect(profundidade);
    profundidade.connect(tosse.gain);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.05);
    g.gain.setTargetAtTime(0, t + 0.05, 0.22);
    fonte.connect(grave);
    grave.connect(tosse);
    tosse.connect(g);
    g.connect(destino);
    var fim = t + 1.3;
    fonte.start(t, Math.random() * S.mesa.ruido.duration);
    fonte.stop(fim);
    lfo.start(t);
    lfo.stop(fim);
    return fim;
  }

  // TROMPETE COM SURDINA / METAIS: dente-de-serra filtrada, ataque macio.
  // op.surdina === false -> metal aberto (seção de metais)
  function tocarMetal(destino, t, midi, dur, vel, op) {
    var ctx = S.ctx;
    var f = frequencia(midi);
    var surdina = !op || op.surdina !== false;
    var saida = ctx.createGain();
    var fim = envelopeSustentado(saida.gain, t, 0.05, 0.22 * vel, 0.85, t + dur, 0.07);
    saida.connect(destino);

    // vibrato que só aparece se a nota durar
    var vibrato = ctx.createOscillator();
    var profundidade = ctx.createGain();
    vibrato.frequency.value = 5.3;
    profundidade.gain.setValueAtTime(0, t);
    profundidade.gain.linearRampToValueAtTime(0, t + 0.3);
    profundidade.gain.linearRampToValueAtTime(14, t + 0.8);
    vibrato.connect(profundidade);

    var entradas;
    if (surdina) {
      // surdina "harmon": sem graves, com um "nariz" forte perto de 1,6 kHz
      var corteGrave = filtro(ctx, 'highpass', 550, 0.7);
      var nariz = filtro(ctx, 'peaking', 1600, 1.6);
      nariz.gain.value = 12;
      var corteAgudo = filtro(ctx, 'lowpass', 4200, 0.7);
      corteGrave.connect(nariz);
      nariz.connect(corteAgudo);
      corteAgudo.connect(saida);
      entradas = [corteGrave];
    } else {
      // metal aberto: um caminho "corpo" (filtro baixo) e um caminho "brilho"
      // (filtro alto) que aparece no ataque e diminui: o sopro ganhando força.
      // Filtros fixos + envelope de volume pesam menos que um filtro que se mexe.
      var corpo = filtro(ctx, 'lowpass', 900 + 900 * vel, 0.8);
      var brilho = filtro(ctx, 'lowpass', 2600 + 2400 * vel, 0.8);
      var abertura = ctx.createGain();
      abertura.gain.setValueAtTime(0, t);
      abertura.gain.linearRampToValueAtTime(0.5, t + 0.06);
      abertura.gain.setTargetAtTime(0.15, t + 0.06, 0.15);
      corpo.connect(saida);
      brilho.connect(abertura);
      abertura.connect(saida);
      entradas = [corpo, brilho];
    }
    (surdina ? [0] : [-6, 6]).forEach(function (desafino) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.setValueAtTime(desafino - 35, t);       // entra um pouco abaixo...
      o.detune.setTargetAtTime(desafino, t, 0.035);    // ...e "sobe" para a nota, jeito de jazz
      profundidade.connect(o.detune);
      entradas.forEach(function (entrada) { o.connect(entrada); });
      o.start(t);
      o.stop(fim);
    });
    vibrato.start(t);
    vibrato.stop(fim);
    tocarRuido(destino, t, 'bandpass', 1800, 1.2, 0.02, 0.06 * vel, 0.04);   // um fio de ar no começo
    return fim;
  }

  // CORDAS: três dentes-de-serra levemente desafinados (um naipe).
  // op.estilo 'staccato' = notas curtas e secas (arco saltado);
  // op.ataque e op.soltura (s) mudam o jeito do arco;
  // op.espalho abre a desafinação entre os músicos (2 = o dobro).
  function tocarCordas(destino, t, midi, dur, vel, op) {
    op = op || {};
    var ctx = S.ctx;
    var f = frequencia(midi);
    var staccato = op.estilo === 'staccato';
    var espalho = op.espalho || 1;
    var brilho = filtro(ctx, 'lowpass', Math.min(9000, (staccato ? 1800 : 1200) + f * 2 + 1800 * vel), 0.6);
    var semGraves = filtro(ctx, 'highpass', midi < 55 ? 60 : 140, 0.6);
    var saida = ctx.createGain();
    var fim = staccato
      ? envelopePercussivo(saida.gain, t, 0.006, 0.17 * vel * (leve ? 1.4 : 1), 0.05, 0.35, 0.2, t + dur, op.soltura || 0.04)
      : envelopeSustentado(saida.gain, t, op.ataque || 0.5, 0.1 * vel, 1, t + dur, op.soltura || 0.3);
    brilho.connect(semGraves);
    semGraves.connect(saida);
    saida.connect(destino);
    // nota curta: dois músicos já bastam (no modo leve, um só); nota longa: três
    var musicos = staccato ? (leve ? [0] : [-7, 7]) : [-9, 1, 10];
    musicos.forEach(function (cents, i) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents * espalho + sortear(-2, 2);
      o.connect(brilho);
      o.start(t + i * 0.0015);     // cada músico do naipe ataca um tiquinho diferente
      o.stop(fim);
    });
    return fim;
  }

  // Tabela usada pelo agendador: nome do instrumento -> função que toca
  var TOCAR = {
    baixo:     function (destino, t, ev) { return tocarBaixo(destino, t, ev.midi, ev.dur, ev.vel); },
    piano:     function (destino, t, ev) { return tocarPiano(destino, t, ev.midi, ev.dur, ev.vel); },
    vibrafone: function (destino, t, ev) { return tocarVibrafone(destino, t, ev.midi, ev.dur, ev.vel); },
    bateria:   function (destino, t, ev) { return tocarBateria(destino, t, ev.peca, ev.vel, ev.midi); },
    metais:    function (destino, t, ev) { return tocarMetal(destino, t, ev.midi, ev.dur, ev.vel, ev.op); },
    cordas:    function (destino, t, ev) { return tocarCordas(destino, t, ev.midi, ev.dur, ev.vel, ev.op); }
  };

  /* ============================ CAMADAS ============================
     Uma camada = um canal por instrumento + um fader geral (e um fader
     para o que vai ao reverb) + um filtro de "brilho". Cada cena toca
     na sua camada.
     ================================================================== */

  function criarCamada(est, nome) {
    var ctx = est.ctx;
    var camada = {
      nome: nome,
      cena: nome ? CENAS[nome] : null,
      compasso: 0,          // quantos compassos esta camada já compôs
      memoria: {},          // anotações da cena entre compassos (ex.: última nota do baixo)
      canais: {},
      saindo: false,
      fimFade: Infinity,
      morta: false
    };
    camada.fader = ctx.createGain();
    camada.tom = filtro(ctx, 'lowpass', 18000, 0.7);   // o "brilho" da cena (ver e.brilho)
    camada.faderSala = ctx.createGain();
    camada.fader.gain.value = 0;
    camada.faderSala.gain.value = 0;
    camada.fader.connect(camada.tom);
    camada.tom.connect(est.mesa.fita);
    camada.faderSala.connect(est.mesa.sala);

    Object.keys(CANAIS).forEach(function (instrumento) {
      var ajuste = CANAIS[instrumento];
      var entrada = ctx.createGain();
      var envio = ctx.createGain();
      entrada.gain.value = ajuste.ganho;
      envio.gain.value = ajuste.sala;
      var saida = entrada;
      if (ctx.createStereoPanner) {
        saida = ctx.createStereoPanner();
        saida.pan.value = ajuste.pan;
        entrada.connect(saida);
      }
      saida.connect(camada.fader);
      saida.connect(envio);
      envio.connect(camada.faderSala);
      camada.canais[instrumento] = entrada;
    });
    return camada;
  }

  function sairDaCamada(camada, inicio, duracao) {
    camada.saindo = true;
    camada.fimFade = inicio + duracao;
    rampa(camada.fader.gain, 0, inicio, duracao);
    rampa(camada.faderSala.gain, 0, inicio, duracao);
  }

  function removerCamada(camada) {
    camada.morta = true;
    camada.fader.disconnect();
    camada.tom.disconnect();
    camada.faderSala.disconnect();
    S.camadas.splice(S.camadas.indexOf(camada), 1);
  }

  // A camada da cena que está valendo (a mais nova que não está saindo)
  function cenaAtiva() {
    for (var i = S.camadas.length - 1; i >= 0; i--) {
      if (!S.camadas[i].saindo) return S.camadas[i];
    }
    return null;
  }

  function temMusica() { return !!(S && cenaAtiva()); }

  /* ============================ ESCRITOR ============================
     A cena escreve as notas em "tempos" do compasso (0 = o 1, 2.5 = o
     "e" do 3). O escritor converte para segundos, aplica o swing e a
     humanização e coloca a nota na fila do agendador.
     ================================================================== */

  function criarEscritor(camada, inicio, spb, swing) {
    function hora(tempo) {
      var inteiro = Math.floor(tempo + 1e-6);
      var fracao = tempo - inteiro;
      // swing: a colcheia do contratempo cai um pouco depois (o "balanço" do jazz)
      if (swing && Math.abs(fracao - 0.5) < 1e-6) fracao = swing;
      return inicio + (inteiro + fracao) * spb;
    }

    function agendar(instrumento, tempo, evento, deslocamento) {
      // staccato pede precisão: quase nenhuma folga de tempo
      var folga = evento.op && evento.op.estilo === 'staccato' ? 0.003 : (FOLGA[instrumento] || 0);
      evento.inst = instrumento;
      evento.camada = camada;
      evento.t = hora(tempo) + (deslocamento || 0) + sortear(-1, 1) * folga;
      evento.vel = limitar(evento.vel * sortear(0.93, 1.07), 0.01, 1);
      S.fila.push(evento);
    }

    var e = {
      spb: spb,
      memoria: camada.memoria,
      calor: calor,                // calor do motor (0 a 1), para as cenas que reagem a ele
      compasso: camada.compasso,   // quantos compassos a cena já tocou

      nota: function (instrumento, tempo, midi, duracao, vel, op) {
        agendar(instrumento, tempo, {
          midi: midi, dur: duracao * spb, vel: vel, op: op || null,
          importante: instrumento === 'baixo' || !!(op && op.importante)
        });
      },

      // arpejo: segundos entre uma nota e outra do acorde (dedos "rolando")
      acorde: function (instrumento, tempo, notas, duracao, vel, arpejo, op) {
        notas.forEach(function (midi, i) {
          agendar(instrumento, tempo, { midi: midi, dur: duracao * spb, vel: vel, op: op || null }, i * (arpejo || 0));
        });
      },

      // peças da bateria; o tímpano recebe a nota em "midi"
      bateria: function (peca, tempo, vel, midi) {
        agendar('bateria', tempo, { peca: peca, vel: vel, midi: midi });
      },

      // O leitmotiv. op: transpor (semitons), vel, variante ('dorico' | 'maior' |
      // 'superaquecido'), desde e notas (pedaços: de qual nota começa e quantas
      // toca), sustentar (tempos da última nota), curto (staccato) e extra
      // (opções do instrumento).
      motivo: function (instrumento, tempo, op) {
        op = op || {};
        var notas = MOTIVO[op.variante || 'dorico'];
        var desde = op.desde || 0;
        var ate = Math.min(notas.length, desde + (op.notas || notas.length));
        var vel = op.vel || 0.5;
        var posicao = tempo;
        for (var i = desde; i < ate; i++) {
          var ultima = i === notas.length - 1;
          var duracao = op.curto ? 0.3 : (ultima && op.sustentar ? op.sustentar : MOTIVO.ritmo[i] * 0.9);
          var acento = ultima ? 1.1 : (i === 0 ? 1 : 0.85);   // a nota de chegada pesa mais
          var extra = Object.assign({ importante: true }, op.extra);
          e.nota(instrumento, posicao, notas[i] + (op.transpor || 0), duracao, vel * acento, extra);
          posicao += MOTIVO.ritmo[i];
        }
      },

      // "Brilho" da cena: abre ou fecha o passa-baixa da camada (em Hz) ao
      // longo do compasso. No primeiro compasso, já começa no valor certo.
      // Se o valor não mudou, não agenda nada (filtro parado gasta menos).
      brilho: function (hz) {
        var param = camada.tom.frequency;
        if (camada.brilhoAtual === hz) return;
        if (camada.brilhoAtual === undefined) {
          param.setValueAtTime(hz, inicio);
        } else {
          param.setValueAtTime(camada.brilhoAtual, inicio);
          param.linearRampToValueAtTime(hz, inicio + 4 * spb);
        }
        camada.brilhoAtual = hz;
      }
    };
    return e;
  }

  /* ======================== RELÓGIO (AGENDADOR) ========================
     O pulso roda a cada 25 ms, mas quem manda no tempo é o relógio do
     áudio: o agendador marca tudo que vai soar nos próximos 0,2 s. Se o
     navegador atrasar um pulso, as notas já estão marcadas e não atrasam.
     ==================================================================== */

  function pulso() {
    if (!S || S.ctx.state !== 'running') return;
    var agora = S.ctx.currentTime;
    var limite = agora + ANTECEDENCIA;

    // 1. compõe os compassos que começam dentro da janela
    while (cenaAtiva() && S.relogio.proximoCompasso < limite) comporCompasso();
    // 2. transforma em som as notas que caem dentro da janela
    despachar(limite, agora);
    // 3. faxina: tira as camadas que já terminaram de sumir
    S.camadas.filter(function (c) { return c.saindo && agora > c.fimFade + 0.1; }).forEach(removerCamada);
    // 4. silêncio total? suspende o áudio para não gastar processador
    if (!temMusica() && agora > S.silencioAte) ajustarContexto();
  }

  function comporCompasso() {
    var relogio = S.relogio;
    var inicio = relogio.proximoCompasso;
    var camada = cenaAtiva();

    // 1. O jogo pediu outra cena? A troca só acontece aqui, no começo de um compasso.
    if (cenaPedida !== camada.nome && podeTrocar(camada)) {
      camada = trocarCena(cenaPedida, inicio);
      if (!camada) return;                       // a cena nova é uma música gravada (mp3)
    }

    // 2. Cena que toca uma vez só (vitória) chegou ao fim: deixa o último
    // acorde soar e, depois dele, a fita para de chiar
    var cena = camada.cena;
    if (cena.repetir === false && camada.compasso >= cena.compassos) {
      camada.saindo = true;
      camada.fimFade = inicio + 8;
      rampa(S.mesa.chiado.gain, 0, inicio + 3, 2);
      return;
    }

    // 3. Andamento deste compasso (fixo ou calculado pela cena)
    relogio.bpm = cena.andamento ? cena.andamento(camada, relogio.bpm) : cena.bpm;
    var spb = 60 / relogio.bpm;                    // segundos por tempo

    // 4. A cena escreve as notas do compasso
    var n = posicaoNoCiclo(camada);
    var ciclo = Math.floor(camada.compasso / cena.compassos);   // quantas voltas o ciclo já deu
    cena.compor(criarEscritor(camada, inicio, spb, cena.swing), n, ciclo);
    camada.compasso++;

    // histórico curto, para o painel saber em que compasso e tempo estamos
    relogio.historico.push({ inicio: inicio, spb: spb, cena: camada.nome, compasso: n, total: cena.compassos });
    if (relogio.historico.length > 6) relogio.historico.shift();

    relogio.proximoCompasso = inicio + 4 * spb;    // compasso 4/4
    S.fila.sort(function (a, b) { return a.t - b.t; });
  }

  // A cena atual já tocou o mínimo de compassos? (as "urgentes" não esperam)
  function podeTrocar(camada) {
    var nova = CENAS[cenaPedida];
    return (nova && nova.urgente) || camada.compasso >= (camada.cena.minimo || 1);
  }

  // Compasso dentro do ciclo da cena. Cenas com introdução (como a reta
  // final) repetem só a partir do compasso cena.loopDesde.
  function posicaoNoCiclo(camada) {
    var cena = camada.cena;
    var desde = cena.loopDesde || 0;
    if (camada.compasso < cena.compassos) return camada.compasso;
    return desde + (camada.compasso - desde) % (cena.compassos - desde);
  }

  function despachar(limite, agora) {
    while (S.fila.length && S.fila[0].t < limite) {
      var ev = S.fila.shift();
      if (ev.camada.morta) continue;
      var t = Math.max(ev.t, agora + 0.005);
      // limite de vozes: esquece as notas que já acabaram; se ainda estiver
      // cheio, só passa o que é importante (baixo e motivo)
      S.fimVozes = S.fimVozes.filter(function (fim) { return fim > t; });
      if (S.fimVozes.length >= (leve ? MAX_VOZES_LEVE : MAX_VOZES) && !ev.importante) {
        S.descartadas++;
        continue;
      }
      var fim = TOCAR[ev.inst](ev.camada.canais[ev.inst], t, ev);
      S.fimVozes.push(fim);
      S.silencioAte = Math.max(S.silencioAte, fim + CAUDA);
    }
  }

  /* ============================== CENAS ==============================
     Cada cena é um objeto com:
       bpm        andamento (ou andamento(camada, bpmAtual), se variar)
       swing      0 = colcheias retas; 0,6 = o balanço do jazz
       compassos  tamanho do ciclo; loopDesde = de onde o ciclo recomeça
       repetir    false = toca uma vez só e termina (vitória)
       minimo     compassos que a cena toca antes de deixar outra entrar
       urgente    true = entra no próximo compasso, sem esperar o mínimo
       entrada    segundos do fade de entrada (padrão 1,5)
       volume     volume da cena na mixagem (padrão 1): segura as cenas
                  cheias (reta final, vitória) perto do volume das calmas
       fita       quanto a fita oscila (wow) nesta cena (padrão 1)
       compor(e, n, ciclo)  escreve as notas do compasso n com o escritor e
     ==================================================================== */

  var CENAS = {};

  // ---------- Peças de acompanhamento usadas pelas cenas ----------

  // Baixo em "dois tempos": raiz no 1 e quinta abaixo no 3. Se o acorde vai
  // mudar, o tempo 4 vira uma nota de passagem que leva ao próximo acorde.
  function baixoDoisTempos(e, acorde, proximo, vel) {
    var raiz = oitavaPerto(acorde.raiz, e.memoria.baixo || 38);
    var quinta = raiz - 5 >= 31 ? raiz - 5 : raiz + 7;
    e.nota('baixo', 0, raiz, 1.9, vel);
    if (proximo === acorde) {
      e.nota('baixo', 2, quinta, 1.9, vel * 0.85);
      e.memoria.baixo = raiz;
      return;
    }
    var alvo = oitavaPerto(proximo.raiz, quinta);
    var passagem = vizinhaNaEscala(alvo, alvo > quinta ? -1 : 1);
    if (passagem === quinta) passagem = vizinhaNaEscala(alvo, alvo > quinta ? 1 : -1);
    e.nota('baixo', 2, quinta, 0.95, vel * 0.85);
    e.nota('baixo', 3, passagem, 0.95, vel * 0.8);
    e.memoria.baixo = alvo;
  }

  // Baixo "caminhando": uma nota por tempo (raiz, notas do acorde e uma
  // nota de aproximação para o próximo acorde)
  function baixoCaminhando(e, acorde, proximo, vel) {
    var raiz = oitavaPerto(acorde.raiz, e.memoria.baixo || 38);
    var tons = acorde.tons.map(function (intervalo) { return noRegistroDoBaixo(raiz + intervalo); });
    var segunda = escolher([tons[1], tons[2]]);
    var opcoes = [tons[2], tons[3], noRegistroDoBaixo(raiz + 12)].filter(function (m) {
      return m !== segunda && m % 12 !== proximo.raiz % 12;
    });
    var terceira = opcoes.length ? escolher(opcoes) : tons[2];
    var alvo = oitavaPerto(proximo.raiz, terceira);
    var direcao = alvo > terceira ? -1 : 1;
    var aproximacao = Math.random() < 0.5 ? alvo + direcao : vizinhaNaEscala(alvo, direcao);
    if (aproximacao === terceira) aproximacao = alvo - direcao;
    [raiz, segunda, terceira, aproximacao].forEach(function (midi, i) {
      e.nota('baixo', i, midi, 0.92, i === 0 ? vel : vel * 0.85);
    });
    e.memoria.baixo = alvo;
  }

  // Escovinha: varrida em todos os tempos; batida e chimbal no 2 e no 4
  function escovinha(e, vel) {
    for (var tempo = 0; tempo < 4; tempo++) {
      e.bateria('varrida', tempo, vel);
      if (tempo === 1 || tempo === 3) {
        e.bateria('batida', tempo, vel * 0.8);
        e.bateria('chimbal', tempo, vel * 0.7);
      }
    }
    if (Math.random() < 0.3) e.bateria('batida', 3.5, vel * 0.3);   // nota-fantasma no "e" do 4
  }

  // Escovinha mais leve: varridas, chimbal no 2 e no 4, batida só no 4 e uma
  // varrida suave no "e" do 4, que emenda um compasso no outro
  function escovinhaLeve(e, vel, comBatida) {
    for (var tempo = 0; tempo < 4; tempo++) {
      e.bateria('varrida', tempo, tempo % 2 ? vel * 0.85 : vel);
      if (tempo === 1 || tempo === 3) e.bateria('chimbal', tempo, vel * 0.6);
    }
    e.bateria('varrida', 3.5, vel * 0.6);
    if (comBatida) e.bateria('batida', 3, vel * 0.6);
  }

  // Ritmos de acompanhamento do piano: [tempo, duração] de cada acorde
  var RITMOS_PIANO = {
    antesDoMotivo:  [[[0, 1.6]]],                // um acorde só, que acaba antes do motivo
    depoisDoMotivo: [[[1.5, 2]]],                // deixa o motivo pousar sozinho no 1
    livre: [
      [[0, 1.6]],                // um acorde no 1
      [[0, 0.8], [1.5, 1.5]],    // "Charleston": no 1 e no "e" do 2
      [[1.5, 2]],                // só no "e" do 2, flutuando
      [[0, 1], [2.5, 1.2]],      // no 1 e no "e" do 3
      []                         // às vezes o piano só escuta
    ],
    calmo:    [[[0, 2.5]], [[0, 2.5]], [[1.5, 2]], []],   // 1º compasso de um acorde longo
    resposta: [[], [], [[2.5, 1]], [[0, 1.2]]]            // 2º compasso: quase sempre só escuta
  };

  function pianoComping(e, acorde, estilo, vel) {
    escolher(RITMOS_PIANO[estilo]).forEach(function (golpe, i) {
      e.acorde('piano', golpe[0], acorde.voz, golpe[1], i === 0 ? vel : vel * 0.85, 0.012);
    });
  }

  var STACCATO = { estilo: 'staccato' };
  var METAL_ABERTO = { surdina: false };

  // ---------- MENU: quase escondido, vibrafone e piano, 85 BPM ----------
  // Forma A–A' de 16 compassos (~45 s). Na parte A, trio de jazz com
  // vibrafone; na A', as cordas entram com uma linha que desce devagar.
  var MENU = {
    harmonia: [
      'Dm9', 'Dm9', 'G13', 'G13', 'Dm9', 'Dm9', 'Em7', 'A9sus4',        // A
      'Fmaj9', 'Em7', 'Dm9', 'G13', 'Fmaj9', 'Em7', 'A9sus4', 'A9sus4'  // A'
    ],
    // compasso: notas (melodia em cima, sexta/terça embaixo) e duração em tempos
    cordas: {
      8:  { notas: [76, 67], tempos: 8 },   // Mi5 + Sol4
      10: { notas: [74, 65], tempos: 8 },   // Ré5 + Fá4
      12: { notas: [72, 64], tempos: 4 },   // Dó5 + Mi4
      13: { notas: [71, 62], tempos: 4 },   // Si4 + Ré4
      14: { notas: [69, 62], tempos: 8 }    // Lá4 + Ré4
    }
  };

  CENAS.menu = {
    bpm: 85,
    swing: 0.62,      // 0,5 = colcheias retas; 0,67 = tercina (swing cheio)
    compassos: 16,
    minimo: 1,
    urgente: true,    // voltar ao menu (ou perder a corrida) troca a música logo
    compor: function (e, n, ciclo) {
      var acorde = ACORDES[MENU.harmonia[n]];
      var proximo = ACORDES[MENU.harmonia[(n + 1) % 16]];

      // BAIXO: dois tempos; nos últimos 4 compassos ele caminha de volta ao começo
      if (n < 12) baixoDoisTempos(e, acorde, proximo, 0.75);
      else baixoCaminhando(e, acorde, proximo, 0.7);

      // ESCOVINHA, e um bumbo de feltro marcando o começo de cada metade
      escovinha(e, 0.55);
      if (n === 0 || n === 8) e.bateria('bumbo', 0, 0.35);

      // MOTIVO, quase escondido: entra em anacruse (no "e" do 3) e pousa no
      // 1 do compasso seguinte. Ciclos pares: vibrafone; ímpares: piano,
      // no registro original (Ré3).
      var motivoNoPiano = false;
      if (n === 0 || n === 7) {
        if (ciclo % 2 === 0) {
          e.motivo('vibrafone', 2.5, { transpor: 12, vel: 0.45, sustentar: 3 });
        } else {
          e.motivo('piano', 2.5, { vel: 0.42, sustentar: 2 });
          motivoNoPiano = true;
        }
      }
      if (n === 14) e.motivo('vibrafone', 2.5, { transpor: 12, vel: 0.32, notas: 3 });   // incompleto: fica no ar
      if (n === 2) {                         // o "suspiro" do dórico: Si natural descendo para Lá
        e.nota('vibrafone', 1, 71, 1.5, 0.3);
        e.nota('vibrafone', 2.5, 69, 2.5, 0.27);
      }

      // PIANO: poucos acordes, macios, deixando espaço para o motivo
      var estilo = 'livre';
      if (n === 0 || n === 7 || n === 14) estilo = 'antesDoMotivo';
      else if (e.memoria.pousoNoPiano) estilo = 'depoisDoMotivo';
      pianoComping(e, acorde, estilo, n < 8 ? 0.36 : 0.32);
      e.memoria.pousoNoPiano = motivoNoPiano;

      // CORDAS: na segunda metade, Mi–Ré–Dó–Si–Lá descendo, com a sexta embaixo
      var linha = MENU.cordas[n];
      if (linha) {
        linha.notas.forEach(function (midi, i) {
          e.nota('cordas', 0, midi, linha.tempos + 0.6, i === 0 ? 0.3 : 0.24, { ataque: 1.6, soltura: 0.5 });
        });
      }
    }
  };

  // ---------- PLANEJAMENTO (planning): calmo, 80 BPM, só pedaços do motivo ----------
  // Feito para tocar muito tempo sem cansar: um acorde a cada 2 compassos,
  // muito espaço, e o arranjo muda a cada volta do ciclo (só o trio; trio +
  // vibrafone; trio + cordas). O motivo nunca aparece inteiro: só pedaços,
  // no baixo e no piano, em lugares sorteados a cada volta.
  var PLANEJAMENTO = {
    harmonia: [
      'Dm9', 'Dm9', 'Em7/D', 'Em7/D', 'Fmaj9', 'Fmaj9', 'G13', 'G13',
      'Fmaj9', 'Fmaj9', 'Em7', 'Em7', 'Cmaj9', 'Cmaj9', 'A9sus4', 'A9sus4'
    ],
    // pedaços do motivo: compasso -> tempo de entrada, nota inicial e quantas notas
    pedacos: {
      baixo: {
        1: { tempo: 2.5, desde: 0, notas: 3 },   // Ré Fá Sol... e o Lá não vem
        7: { tempo: 2.5, desde: 1, notas: 3 },   // Fá Sol Lá
        9: { tempo: 3, desde: 0, notas: 2 }      // Ré Fá, que cai no Mi do compasso seguinte
      },
      piano: {
        5: { tempo: 2.5, desde: 0, notas: 3 },   // Ré Fá Sol, sobre o Fá maior
        7: { tempo: 3, desde: 0, notas: 2 }      // Ré Fá, sobre o Sol
      }
    },
    // a cada volta, uma destas combinações de pedaços é sorteada
    combinacoes: [
      { baixo: [1], piano: [5] }, { baixo: [7], piano: [5] }, { baixo: [9], piano: [] },
      { baixo: [1, 9], piano: [] }, { baixo: [], piano: [7] }, { baixo: [7], piano: [] }
    ],
    // brilho do vibrafone (2ª volta) e colchão de cordas (3ª volta): compasso -> notas
    vibrafone: { 0: [69, 76], 4: [67, 76], 8: [69, 76], 12: [67, 74] },
    cordas: { 0: [60, 64], 2: [59, 64], 4: [60, 64], 6: [59, 64], 8: [60, 64], 10: [59, 62], 12: [59, 62], 14: [59, 62] }
  };

  CENAS.planning = {
    bpm: 80,
    swing: 0.6,
    compassos: 16,
    minimo: 2,
    compor: function (e, n, ciclo) {
      var acorde = ACORDES[PLANEJAMENTO.harmonia[n]];
      var proximo = ACORDES[PLANEJAMENTO.harmonia[(n + 1) % 16]];
      var mem = e.memoria;
      if (n === 0 || !mem.pedacos) mem.pedacos = escolher(PLANEJAMENTO.combinacoes);
      var pedacoBaixo = mem.pedacos.baixo.indexOf(n) !== -1 ? PLANEJAMENTO.pedacos.baixo[n] : null;
      var pedacoPiano = mem.pedacos.piano.indexOf(n) !== -1 ? PLANEJAMENTO.pedacos.piano[n] : null;

      // BAIXO: notas longas; no fim de cada acorde, leva ao próximo
      var raiz = oitavaPerto(acorde.raiz, mem.baixo || 38);
      if (pedacoBaixo) {
        e.nota('baixo', 0, raiz, 2.3, 0.68);
        e.motivo('baixo', pedacoBaixo.tempo, {
          transpor: -12, desde: pedacoBaixo.desde, notas: pedacoBaixo.notas, vel: 0.62
        });
        mem.baixo = MOTIVO.dorico[pedacoBaixo.desde + pedacoBaixo.notas - 1] - 12;
      } else if (n % 2 === 0 && Math.random() < 0.5) {
        e.nota('baixo', 0, raiz, 3.6, 0.68);       // uma nota só, o compasso inteiro
        mem.baixo = raiz;
      } else {
        baixoDoisTempos(e, acorde, n % 2 === 0 ? acorde : proximo, 0.65);
      }

      // ESCOVINHA bem leve (sem batidas nos compassos 9 a 12, para respirar)
      escovinhaLeve(e, 0.5, n < 8 || n >= 12);

      // PIANO: acordes espaçados; às vezes um pedaço do motivo na mão direita
      if (pedacoPiano) {
        pianoComping(e, acorde, 'antesDoMotivo', 0.3);
        e.motivo('piano', pedacoPiano.tempo, {
          transpor: 12, desde: pedacoPiano.desde, notas: pedacoPiano.notas, vel: 0.36
        });
      } else {
        pianoComping(e, acorde, n % 2 === 0 ? 'calmo' : 'resposta', 0.32);
      }

      // ARRANJO que muda a cada volta do ciclo: só o trio; + vibrafone; + cordas
      var variacao = ciclo % 3;
      var brilho = PLANEJAMENTO.vibrafone[n];
      if (variacao === 1 && brilho) e.acorde('vibrafone', 0, brilho, 8, 0.2, 0.03);
      var colchao = PLANEJAMENTO.cordas[n];
      if (variacao === 2 && colchao) {
        colchao.forEach(function (midi) { e.nota('cordas', 0, midi, 8.5, 0.22, { ataque: 2, soltura: 0.6 }); });
      }
    }
  };

  // ---------- PRESSÃO (pushing): gastando calor, 105 a 115 BPM ----------
  // Cordas e piano em staccato sobre um Ré pedal (o "motor"). Quanto mais
  // calor, mais rápido (accelerando), mais notas por compasso e mais brilho.
  var PRESSAO = {
    harmonia: ['Dm', 'Dm', 'C/D', 'Dm', 'Dm', 'Dm', 'G/D', 'C/D'],
    // ostinato das cordas (8 colcheias): o Ré pedal alternando com as notas do motivo
    ostinato: {
      'Dm':  [62, 65, 62, 67, 62, 69, 62, 67],   // Ré Fá Ré Sol Ré Lá Ré Sol
      'C/D': [62, 64, 62, 67, 62, 72, 62, 67],   // Ré Mi Ré Sol Ré Dó Ré Sol
      'G/D': [62, 67, 62, 71, 62, 69, 62, 67]    // Ré Sol Ré Si Ré Lá Ré Sol
    },
    // golpes do piano: Ré3 (o pedal) + a tríade de cima
    piano: {
      'Dm':  [50, 65, 69, 74],
      'C/D': [50, 64, 67, 72],
      'G/D': [50, 67, 71, 74]
    },
    // em que tempos o piano bate, conforme o calor (baixo, médio, alto)
    golpes: [[0, 2], [0, 1.5, 3], [0, 0.5, 1.5, 2.5, 3.5]]
  };

  CENAS.pushing = {
    bpm: 105,
    swing: 0,
    compassos: 8,
    minimo: 2,
    entrada: 0.6,
    volume: 0.8,
    // 105 BPM sem calor, 115 com o motor no limite; muda no máximo 2 BPM por
    // compasso, para acelerar aos poucos (accelerando)
    andamento: function (camada, bpmAtual) {
      var alvo = 105 + 10 * calor;
      if (camada.compasso === 0) return alvo;
      return bpmAtual + limitar(alvo - bpmAtual, -2, 2);
    },
    compor: function (e, n) {
      var acorde = PRESSAO.harmonia[n];
      var celula = PRESSAO.ostinato[acorde];
      var nivel = e.calor < 0.34 ? 0 : (e.calor < 0.67 ? 1 : 2);   // densidade: 0, 1 ou 2
      var forca = 0.5 + 0.3 * e.calor;
      var fraseNova = n % 4 === 0;      // começo de frase: o motivo aparece inteiro
      e.brilho(2200 + 7000 * e.calor);

      // BAIXO: o "motor", Ré pedal (semínimas; colcheias com o motor quente)
      var tempo;
      for (tempo = 0; tempo < 4; tempo++) {
        if (nivel === 0) {
          e.nota('baixo', tempo, tempo === 3 ? 33 : 38, 0.85, tempo === 0 ? 0.8 : 0.66);
        } else {
          e.nota('baixo', tempo, 38, 0.42, tempo % 2 ? 0.64 : 0.8);
          e.nota('baixo', tempo + 0.5, tempo === 3 ? 36 : (nivel === 2 ? 50 : 38), 0.42, 0.56);
        }
      }

      // CORDAS em staccato: o motivo no começo da frase, depois o ostinato
      // (semínimas -> colcheias -> semicolcheias, conforme o calor)
      var primeira = 0;
      if (fraseNova) {
        e.motivo('cordas', 0, { transpor: 24, vel: forca, curto: true, extra: STACCATO });
        primeira = 4;
      }
      for (var i = primeira; i < 8; i++) {
        var nota = celula[i];
        if (nivel === 0) {
          if (i % 2 === 1) e.nota('cordas', (i - 1) / 2, nota, 0.5, forca * 0.85, STACCATO);
        } else {
          e.nota('cordas', i / 2, nota, 0.4, forca * (i % 2 ? 0.75 : 0.9), STACCATO);
          if (nivel === 2) e.nota('cordas', i / 2 + 0.25, nota + (i % 2 ? 12 : 0), 0.2, forca * 0.6, STACCATO);
        }
      }

      // PIANO staccato: golpes na tríade; no começo da frase, o motivo em oitavas
      var golpes = PRESSAO.golpes[nivel];
      if (fraseNova) {
        e.motivo('piano', 0, { transpor: 12, vel: forca, curto: true });
        e.motivo('piano', 0, { vel: forca * 0.8, curto: true });
        golpes = golpes.filter(function (t) { return t >= 2; });
      }
      golpes.forEach(function (t, k) {
        e.acorde('piano', t, PRESSAO.piano[acorde], 0.3, forca * (k ? 0.75 : 0.9), 0.004);
      });

      // BATERIA: prato de condução, caixa no 2 e no 4, bumbo
      for (tempo = 0; tempo < 4; tempo++) {
        e.bateria('prato', tempo, 0.45 + 0.25 * e.calor);
        if (nivel >= 1) e.bateria('prato', tempo + 0.5, 0.28 + 0.2 * e.calor);
        if (tempo === 1 || tempo === 3) e.bateria('batida', tempo, nivel === 0 ? 0.4 : 0.6);
      }
      e.bateria('bumbo', 0, 0.55);
      if (nivel >= 1) e.bateria('bumbo', 2, 0.45);
      if (nivel === 2) {
        e.bateria('bumbo', 2.5, 0.35);
        e.bateria('chimbal', 1.5, 0.45);
        e.bateria('chimbal', 3.5, 0.45);
      }

      // TROMPETE com surdina, só com o motor bem quente: um chamado no fim da frase
      if (nivel === 2 && n % 4 === 3) {
        e.motivo('metais', 1.5, { transpor: 24, vel: 0.55, notas: 3, extra: { surdina: true } });
      }
    }
  };

  // ---------- SUPERAQUECIDO (overheat): 70 BPM, grave e desafinado ----------
  // O motor sofrendo: Ré pedal grave, o motivo com Láb no lugar do Lá,
  // pausas irregulares (notas que "falham"), afinação torta e barulhos
  // mecânicos discretos: metal estalando, engasgos e um ronco grave.
  function torto() { return sortear(-0.12, 0.12); }   // até 12 centésimos fora do tom

  CENAS.overheat = {
    bpm: 70,
    swing: 0,
    compassos: 8,
    minimo: 2,
    entrada: 0.8,
    fita: 3,            // a fita "derrete": oscila 3 vezes mais
    compor: function (e, n) {
      e.brilho(1300);

      // BAIXO: Ré grave e comprido; no fim da frase cai para o Láb (o trítono)
      e.nota('baixo', 0, (n % 4 === 3 ? 44 : 38) - 0.1, 3.8, 0.7);

      // CORDAS GRAVES: um colchão azedo (Ré + Fá), bem desafinado
      if (n % 2 === 0) {
        [50, 53].forEach(function (midi) {
          e.nota('cordas', 0, midi + torto(), 7.6, 0.24, { ataque: 1.2, soltura: 0.6, espalho: 2.5 });
        });
      }

      // MOTIVO superaquecido (Ré Fá Sol Láb), engasgando
      if (n === 1 || n === 5) motivoEngasgado(e);

      // PIANO: trítono grave (Ré + Láb) em lugar imprevisível; às vezes um "pingo" agudo
      if (Math.random() < 0.7) e.acorde('piano', escolher([0.5, 1.5, 2.75]), [38 + torto(), 44 + torto()], 1.5, 0.32, 0.02);
      if (Math.random() < 0.3) e.nota('piano', escolher([1, 3.25]), 80 + torto(), 1, 0.16);

      // MOTOR: batida surda (como um coração), tiques de metal, engasgos e ronco
      e.bateria('bumbo', 0, 0.45);
      if (Math.random() < 0.4) e.bateria('bumbo', 1.5, 0.28);
      var tiques = 1 + Math.floor(Math.random() * 3);
      for (var k = 0; k < tiques; k++) e.bateria('tique', sortear(0, 3.9), sortear(0.3, 0.6));
      if (n % 4 === 2) e.bateria('engasgo', escolher([1.5, 2.5]), 0.5);
      if (n % 2 === 0) e.bateria('ronco', 0, 0.4);
    }
  };

  // O motivo superaquecido com falhas: às vezes uma nota do meio não sai,
  // às vezes o tempo hesita (atrasa um quarto de tempo)
  function motivoEngasgado(e) {
    var tempo = escolher([0, 0.5]);
    MOTIVO.superaquecido.forEach(function (midi, i) {
      if ((i === 1 || i === 2) && Math.random() < 0.25) {
        tempo += MOTIVO.ritmo[i];          // a nota falha: fica a pausa
        return;
      }
      e.nota('cordas', tempo, midi + torto(), i === 3 ? 2.5 : 0.6, 0.45,
        { ataque: 0.1, soltura: 0.5, espalho: 2, importante: true });
      tempo += MOTIVO.ritmo[i] + (Math.random() < 0.35 ? 0.25 : 0);
    });
  }

  // ---------- RETA FINAL (finalLap): 125 BPM, metais e cordas, crescendo ----------
  // Compassos 0-3: os motores (baixo e cordas martelando em Ré menor).
  // 4-7: a tensão sobe (Sib, Dó, Lá) e os metais entram, com o motivo
  // ainda em Ré dórico. 8-15: clímax em Ré MAIOR, com o motivo Ré–Fá#–Sol–Lá
  // nos metais. Depois o ciclo repete só o clímax (loopDesde: 8).
  var RETA_FINAL = {
    harmonia: ['Dm', 'Dm', 'Dm', 'Dm', 'Bb', 'C', 'Bb', 'A',
               'D', 'G', 'D', 'A', 'Bm', 'G', 'A', 'D'],
    raiz: { Dm: 38, Bb: 34, C: 36, A: 33, D: 38, G: 43, Bm: 35 },
    ostinato: {
      Dm: [62, 65, 62, 67, 62, 69, 62, 67],
      Bb: [62, 65, 62, 70, 62, 69, 62, 65],
      C:  [62, 64, 62, 67, 62, 72, 62, 67],
      A:  [64, 69, 64, 73, 64, 69, 64, 67],
      D:  [62, 66, 67, 69, 62, 66, 67, 69],   // o motivo em Ré maior, virando ostinato
      G:  [62, 67, 71, 67, 62, 67, 71, 74],
      Bm: [62, 66, 71, 66, 62, 66, 71, 74]
    },
    metais: {
      Dm: [57, 62, 65], Bb: [58, 62, 65], C: [60, 64, 67], A: [57, 61, 64],
      D: [57, 62, 66], G: [59, 62, 67], Bm: [59, 62, 66]
    },
    // violinos sustentados: uma nota longa por compasso, subindo até o clímax
    violinos: { 2: 69, 3: 69, 4: 74, 5: 76, 6: 77, 7: 76, 8: 78, 9: 79, 10: 78, 11: 76, 12: 74, 13: 79, 14: 81, 15: 78 }
  };

  CENAS.finalLap = {
    bpm: 125,
    swing: 0,
    compassos: 16,
    loopDesde: 8,
    minimo: 4,
    entrada: 0.6,
    volume: 0.67,
    compor: function (e, n) {
      var acorde = RETA_FINAL.harmonia[n];
      var etapa = n < 4 ? 0 : (n < 8 ? 1 : 2);            // 0 = motores, 1 = tensão, 2 = clímax
      var forca = [0.5, 0.62, 0.75][etapa];
      e.brilho(etapa === 2 ? 12000 : 1800 + 700 * n);    // o som vai "abrindo" até o clímax

      // BAIXO: colcheias na raiz, o motor a toda
      var raiz = RETA_FINAL.raiz[acorde];
      var i;
      for (i = 0; i < 8; i++) {
        e.nota('baixo', i / 2, i === 7 && etapa < 2 ? raiz + 12 : raiz, 0.42, i % 2 ? 0.6 : 0.78);
      }

      // CORDAS: ostinato em staccato + violinos sustentados por cima
      var celula = RETA_FINAL.ostinato[acorde];
      for (i = 0; i < 8; i++) e.nota('cordas', i / 2, celula[i], 0.4, forca * (i % 2 ? 0.72 : 0.88), STACCATO);
      var violino = RETA_FINAL.violinos[n];
      if (violino) e.nota('cordas', 0, violino, 4, forca * 0.85, { ataque: 0.25, soltura: 0.3 });

      // METAIS: golpes a partir da etapa 1; o motivo em Ré dórico (compasso 4)
      // e, no clímax, em Ré MAIOR (compassos 8 e 12)
      if (n === 4) {
        e.motivo('metais', 0, { transpor: 12, vel: 0.6, sustentar: 2, extra: METAL_ABERTO });
      } else if (n === 8 || n === 12) {
        e.motivo('metais', 0, { variante: 'maior', transpor: 12, vel: 0.8, sustentar: 2, extra: METAL_ABERTO });
        e.motivo('metais', 0, { variante: 'maior', vel: 0.7, sustentar: 2, extra: METAL_ABERTO });
        if (n === 8) e.motivo('vibrafone', 0, { variante: 'maior', transpor: 24, vel: 0.35, sustentar: 2 });
      } else if (etapa >= 1) {
        var voz = RETA_FINAL.metais[acorde];
        e.acorde('metais', 0, voz, 1.2, forca, 0, METAL_ABERTO);
        e.acorde('metais', 2.5, voz, 0.8, forca * 0.85, 0, METAL_ABERTO);
      }

      // BATERIA: prato, caixa no 2 e no 4, bumbo; rufada antes do clímax
      for (var tempo = 0; tempo < 4; tempo++) {
        e.bateria('prato', tempo, 0.5);
        if (etapa >= 1) e.bateria('prato', tempo + 0.5, 0.32);
        if (tempo === 1 || tempo === 3) e.bateria('batida', tempo, etapa === 0 ? 0.42 : 0.6);
      }
      e.bateria('bumbo', 0, 0.6);
      e.bateria('bumbo', 2, 0.5);
      if (n === 7) {
        for (var r = 0; r < 8; r++) e.bateria('batida', 2 + r * 0.25, 0.3 + r * 0.08);   // rufada crescendo
      }
      if (n === 8 || n === 12) {
        e.bateria('pratoAberto', 0, 0.8);
        e.bateria('timbale', 0, 0.85, 38);
      }
    }
  };

  // ---------- VITÓRIA (victory): fanfarra em Ré maior, 110 BPM ----------
  // O motivo completo e resolvido (Ré Fá# Sol Lá e o Ré de cima), metais,
  // cordas e tímpano, e um final conclusivo: toca uma vez só e termina,
  // segurando o andamento nos dois últimos compassos (ritardando).
  var VITORIA = {
    // linha das cordas: compasso -> [tempo, nota, duração]
    cordas: {
      1: [[0, 71, 1], [1, 69, 1], [2, 73, 1], [3, 76, 1]],   // Si Lá | Dó# Mi
      3: [[0, 74, 1], [1, 73, 1], [2, 71, 1], [3, 69, 1]],   // Ré Dó# | Si Lá
      4: [[0, 67, 1], [1, 66, 1], [2, 64, 1], [3, 73, 1]],   // Sol Fá# | Mi Dó#
      6: [[0, 74, 2], [2, 73, 2]],                           // Ré ... Dó# (pede o Ré final)
      7: [[0, 76, 4]]                                        // Mi sustentado sobre o Lá
    },
    // acordes dos metais: compasso -> [tempo, notas, duração]
    metais: {
      1: [[0, [55, 59, 62], 1.9], [2, [57, 61, 64], 1.9]],             // Sol | Lá
      3: [[0, [59, 62, 66], 1.9], [2, [59, 62, 67], 1.9]],             // Si menor | Sol
      4: [[0, [55, 59, 62, 64], 1.9], [2, [55, 61, 64, 69], 1.9]],     // Mi menor 7 | Lá 7
      6: [[0, [55, 59, 62, 67], 1.9], [2, [55, 61, 64, 69], 1.9]],     // Sol | Lá 7
      7: [[0, [55, 62, 64, 69], 1.9], [2, [55, 61, 64, 69], 2]]        // Lá 7 sus4 -> Lá 7
    },
    // baixo: compasso -> [nota no 1, nota no 3]
    baixo: { 0: [38, 33], 1: [43, 45], 2: [38, 42], 3: [35, 43], 4: [40, 33], 5: [38], 6: [43, 45], 7: [33, 33] }
  };

  CENAS.victory = {
    bpm: 110,
    swing: 0,
    compassos: 9,
    repetir: false,     // toca uma vez e termina
    urgente: true,      // entra no próximo compasso, seja qual for a cena
    entrada: 0.05,      // a fanfarra entra de uma vez, sem fade
    volume: 0.58,
    andamento: function (camada) {
      return [110, 110, 110, 110, 110, 110, 110, 100, 90][camada.compasso] || 90;
    },
    compor: function (e, n) {
      e.brilho(12000);
      (VITORIA.cordas[n] || []).forEach(function (nota) {
        e.nota('cordas', nota[0], nota[1], nota[2], 0.55, { ataque: 0.08, soltura: 0.25 });
      });
      (VITORIA.metais[n] || []).forEach(function (golpe) {
        e.acorde('metais', golpe[0], golpe[1], golpe[2], 0.6, 0.006, METAL_ABERTO);
      });
      var baixo = VITORIA.baixo[n];
      if (baixo) {
        e.nota('baixo', 0, baixo[0], 1.9, 0.8);
        if (baixo[1]) e.nota('baixo', 2, baixo[1], 1.9, 0.72);
      }

      if (n === 0) {   // a fanfarra: o motivo completo, resolvendo no Ré de cima
        motivoCompleto(e, 12, 0.8);
        motivoCompleto(e, 0, 0.7);
        e.acorde('cordas', 0, [62, 66, 69, 74], 4, 0.55, 0, { ataque: 0.05, soltura: 0.3 });
        e.bateria('timbale', 0, 0.9, 38);
        e.bateria('pratoAberto', 0, 0.7);
        e.bateria('bumbo', 0, 0.6);
      }
      if (n === 2) {   // o motivo uma terça acima (Fá# Lá Si Dó#), resolvendo no Ré
        [[0, 66], [0.5, 69], [1, 71], [1.5, 73]].forEach(function (nota, i) {
          e.nota('metais', nota[0], nota[1], i === 3 ? 0.9 : 0.45, 0.7, METAL_ABERTO);
        });
        e.nota('metais', 2.5, 74, 1.5, 0.75, METAL_ABERTO);
        e.acorde('cordas', 0, [66, 69, 74], 4, 0.45, 0, { ataque: 0.1, soltura: 0.3 });
        e.bateria('timbale', 0, 0.7, 38);
      }
      if (n === 5) {   // todos juntos: o motivo no alto e, no baixo, subindo até o Sol
        e.motivo('metais', 0, { variante: 'maior', transpor: 12, vel: 0.75, sustentar: 1.5, extra: METAL_ABERTO });
        e.motivo('vibrafone', 0, { variante: 'maior', transpor: 24, vel: 0.4, sustentar: 2 });
        e.acorde('cordas', 0, [62, 66, 69], 2, 0.45, 0, { ataque: 0.08 });
        e.motivo('baixo', 2, { variante: 'maior', transpor: -12, vel: 0.75 });
        e.bateria('pratoAberto', 0, 0.5);
        e.bateria('timbale', 0, 0.7, 38);
      }
      if (n >= 1 && n <= 6) {   // pulso elegante: bumbo no 1, caixa leve no 2 e no 4
        e.bateria('bumbo', 0, 0.4);
        e.bateria('batida', 1, 0.32);
        e.bateria('batida', 3, 0.32);
      }
      if (n === 6) {
        for (var r = 0; r < 8; r++) e.bateria('batida', 2 + r * 0.25, 0.25 + r * 0.08);   // rufada
      }
      if (n === 7) {   // o Lá (dominante) segurando; tímpano e prato crescendo até o final
        e.bateria('timbale', 0, 0.75, 33);
        e.bateria('timbale', 2, 0.85, 33);
        e.bateria('pratoCrescendo', 2, 0.8);
      }
      if (n === 8) {   // o acorde final de Ré maior, com o Ré de cima (a resolução do motivo)
        e.acorde('metais', 0, [50, 57, 62, 66, 69, 74], 6, 0.7, 0.008, METAL_ABERTO);
        e.acorde('cordas', 0, [62, 66, 69, 74, 78], 6, 0.6, 0, { ataque: 0.06, soltura: 0.8 });
        e.nota('baixo', 0, 38, 6, 0.85);
        [74, 78, 81, 86].forEach(function (midi, i) { e.nota('vibrafone', i * 0.25, midi, 5, 0.38); });
        e.bateria('timbale', 0, 0.95, 38);
        e.bateria('pratoAberto', 0, 0.8);
        e.bateria('bumbo', 0, 0.65);
      }
    }
  };

  // O motivo completo e resolvido: Ré Fá# Sol Lá (colcheias e semínima) e o Ré de cima
  function motivoCompleto(e, transpor, vel) {
    e.motivo('metais', 0, { variante: 'maior', transpor: transpor, vel: vel, sustentar: 1, extra: METAL_ABERTO });
    e.nota('metais', 2.5, 62 + transpor, 1.5, vel * 1.1, { surdina: false, importante: true });
  }

  /* ===================== MÚSICA GRAVADA (mp3, opcional) =====================
     Para trocar a versão gerada de uma cena por uma gravação: coloque o
     arquivo em assets/audio/<cena>.mp3 (ex.: assets/audio/victory.mp3) e
     escreva o nome da cena na lista MP3 abaixo. Se o arquivo faltar ou não
     abrir, a cena toca a versão gerada (troca automática).
     Por que uma lista, e não procurar sozinho? Abrindo por file://, o
     código não consegue ver o que tem na pasta, e procurar um arquivo que
     não existe deixa um erro vermelho no console. Com a lista vazia, nada
     é procurado.
     A gravação toca num <audio> comum (fora da mesa de som), com o fade
     feito em JavaScript (20 passos por segundo).
     ========================================================================== */

  var MP3 = [];                    // ex.: ['menu', 'victory']
  var PASTA_MP3 = 'assets/audio/';
  var gravadas = {};               // cena -> { el: <audio>, ok: true quando o arquivo abriu }
  var faixas = [];                 // gravações tocando: { nome, el, ganho, alvo, passo }
  var relogioFaixas = null;

  MP3.forEach(function (nome) {
    var el = new Audio();
    el.preload = 'auto';
    el.loop = !CENAS[nome] || CENAS[nome].repetir !== false;
    gravadas[nome] = { el: el, ok: false };
    el.addEventListener('canplaythrough', function () { gravadas[nome].ok = true; });
    el.addEventListener('error', function () {
      gravadas[nome].ok = false;
      console.warn('[AudioDirector] Não abriu ' + PASTA_MP3 + nome + '.mp3: a cena usa a música gerada.');
    });
    el.src = PASTA_MP3 + nome + '.mp3';
  });

  function gravadaPronta(nome) {
    return !S.offline && !!(gravadas[nome] && gravadas[nome].ok);
  }

  function tocarElemento(el) {
    var tocando = el.play();
    if (tocando && tocando.catch) tocando.catch(function () {});
  }

  // Começa a gravação daqui a "atraso" segundos (o começo do compasso)
  function tocarGravada(nome, atraso) {
    var el = gravadas[nome].el;
    faixas = faixas.filter(function (f) { return f.el !== el; });
    var faixa = { nome: nome, el: el, ganho: 0, alvo: 0, passo: 0 };
    faixas.push(faixa);
    setTimeout(function () {
      if (faixas.indexOf(faixa) === -1) return;      // foi trocada antes de começar
      el.currentTime = 0;
      el.volume = 0;
      tocarElemento(el);
      fadeDaFaixa(faixa, 1, FADE_ENTRADA);
    }, atraso * 1000);
  }

  function calarGravadas(segundos, atraso) {
    if (S && S.offline) return;
    faixas.forEach(function (faixa) {
      setTimeout(function () { fadeDaFaixa(faixa, 0, segundos); }, atraso * 1000);
    });
  }

  function fadeDaFaixa(faixa, alvo, segundos) {
    faixa.alvo = alvo;
    faixa.passo = Math.abs(alvo - faixa.ganho) / Math.max(1, segundos * 20);
    if (!relogioFaixas) relogioFaixas = setInterval(andarFaixas, 50);
  }

  function andarFaixas() {
    faixas.slice().forEach(function (faixa) {
      if (faixa.ganho < faixa.alvo) faixa.ganho = Math.min(faixa.alvo, faixa.ganho + faixa.passo);
      else faixa.ganho = Math.max(faixa.alvo, faixa.ganho - faixa.passo);
      faixa.el.volume = faixa.ganho * volumeDasFaixas();
      if (faixa.alvo === 0 && faixa.ganho === 0) {
        faixa.el.pause();
        faixas.splice(faixas.indexOf(faixa), 1);
      }
    });
    var paradas = faixas.every(function (f) { return f.ganho === f.alvo; });
    if (paradas) {
      clearInterval(relogioFaixas);
      relogioFaixas = null;
    }
  }

  function volumeDasFaixas() { return mudo ? 0 : volume * volume; }

  // A gravação que está valendo (subindo ou tocando, e que não acabou)
  function faixaAtiva() {
    for (var i = faixas.length - 1; i >= 0; i--) {
      if (faixas[i].alvo > 0 && !faixas[i].el.ended) return faixas[i];
    }
    return null;
  }

  /* ============================ API PÚBLICA ============================ */

  function criarEstudio(ctx) {
    var est = {
      ctx: ctx,
      mesa: montarMesa(ctx),
      relogio: { proximoCompasso: 0, bpm: 0, historico: [] },
      fila: [],           // notas compostas esperando a hora de soar
      camadas: [],        // cenas tocando (numa troca, duas ao mesmo tempo)
      fimVozes: [],       // quando termina cada nota agendada (limite de vozes)
      descartadas: 0,     // notas puladas por causa do limite de vozes
      silencioAte: 0,     // depois disso nada mais soa: dá para suspender o áudio
      offline: false      // true nos testes com renderOffline (sem mp3)
    };
    est.previa = criarCamada(est, null);   // camada fixa, para as prévias do painel
    est.previa.fader.gain.value = 1;
    est.previa.faderSala.gain.value = 1;
    return est;
  }

  // Liga o som. Precisa ser chamada dentro de um clique ou tecla (regra de
  // autoplay dos navegadores). Pode ser chamada várias vezes sem problema.
  function init() {
    var Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return Promise.resolve(false);   // navegador sem Web Audio: o jogo segue mudo
    if (!S) {
      var ctx;
      try {
        ctx = new Contexto({ latencyHint: 'playback' });   // música não precisa de latência baixa
      } catch (erro) {
        ctx = new Contexto();
      }
      S = criarEstudio(ctx);
      aplicarVolume(0.3);
      setInterval(pulso, PULSO_MS);
      document.addEventListener('visibilitychange', aoMudarVisibilidade);
      if (cenaPedida) iniciarCena(cenaPedida);
    }
    return ajustarContexto();
  }

  // Liga ou suspende o áudio conforme a necessidade: aba escondida, mudo ou
  // silêncio total = suspenso (não gasta processador).
  function ajustarContexto() {
    if (!S) return Promise.resolve(false);
    var ctx = S.ctx;
    var querSom = !document.hidden && !mudo && (temMusica() || ctx.currentTime < S.silencioAte);
    if (querSom && ctx.state !== 'running') {
      return ctx.resume().then(function () { return true; }, function () { return false; });
    }
    if (!querSom && ctx.state === 'running') {
      return ctx.suspend().then(function () { return false; }, function () { return false; });
    }
    return Promise.resolve(ctx.state === 'running');
  }

  function aoMudarVisibilidade() {
    faixas.forEach(function (faixa) {
      if (document.hidden) faixa.el.pause();
      else if (faixa.alvo > 0 && !faixa.el.ended) tocarElemento(faixa.el);
    });
    ajustarContexto();
  }

  // Começa uma cena com o relógio parado (nada tocando): começa já
  function iniciarCena(nome) {
    S.relogio.proximoCompasso = S.ctx.currentTime + 0.1;
    trocarCena(nome, S.relogio.proximoCompasso);
  }

  // Troca de cena no tempo "inicio" (um começo de compasso): quem está
  // tocando desce, a cena nova sobe. Devolve a camada nova (ou null, se a
  // cena for tocar uma gravação mp3).
  function trocarCena(nome, inicio) {
    S.camadas.forEach(function (c) { if (!c.saindo) sairDaCamada(c, inicio, FADE_SAIDA); });
    var atraso = Math.max(0, inicio - S.ctx.currentTime);
    calarGravadas(FADE_SAIDA, atraso);
    if (gravadaPronta(nome)) {
      rampa(S.mesa.chiado.gain, 0, inicio, FADE_SAIDA);
      tocarGravada(nome, atraso);
      return null;
    }
    var cena = CENAS[nome];
    var entrada = cena.entrada || FADE_ENTRADA;
    var nivel = cena.volume || 1;
    var nova = criarCamada(S, nome);
    // a cena nova já entra audível no 1 do compasso (um quarto do volume) e
    // cresce, enquanto a antiga desce por baixo: a troca não deixa buraco
    [nova.fader.gain, nova.faderSala.gain].forEach(function (param) {
      param.setValueAtTime(nivel * 0.25, inicio);
      param.linearRampToValueAtTime(nivel, inicio + entrada);
    });
    rampa(S.mesa.wow.gain, WOW * (cena.fita || 1), inicio, 2);
    rampa(S.mesa.chiado.gain, CHIADO, inicio, 2);
    S.camadas.push(nova);
    return nova;
  }

  function setScene(nome) {
    if (!CENAS[nome]) {
      console.warn('[AudioDirector] Cena desconhecida: "' + nome + '".');
      return;
    }
    if (nome === cenaPedida) return;        // já é a cena pedida (ou já tocou, no caso da vitória)
    cenaPedida = nome;
    if (!S) return;                         // ainda sem som: a cena começa no init()
    if (!cenaAtiva()) iniciarCena(nome);    // nada tocando (ou só um mp3): começa já
    ajustarContexto();                      // com música tocando, a troca é no próximo compasso
  }

  // Para a música com um fade (o áudio é suspenso sozinho depois do silêncio)
  function stop() {
    cenaPedida = null;
    if (!S) return;
    var agora = S.ctx.currentTime;
    S.camadas.forEach(function (c) { if (!c.saindo) sairDaCamada(c, agora, FADE_SAIDA); });
    rampa(S.mesa.chiado.gain, 0, agora, FADE_SAIDA);
    calarGravadas(FADE_SAIDA, 0);
  }

  function setHeat(valor) {
    calor = limitar(Number(valor) || 0, 0, 1);   // vale a partir do próximo compasso
  }

  // Modo leve, para computadores mais fracos: menos notas ao mesmo tempo
  // (24 em vez de 40), cordas curtas e piano mais simples. Vale para as
  // próximas notas; a música não para.
  function setLightMode(ligado) {
    leve = !!ligado;
  }

  // Curva quadrática: o controle de volume fica mais natural ao ouvido
  function aplicarVolume(suavidade) {
    faixas.forEach(function (faixa) { faixa.el.volume = faixa.ganho * volumeDasFaixas(); });
    if (!S) return;
    var alvo = mudo ? 0 : volume * volume * GANHO_SAIDA;
    var param = S.mesa.volume.gain;
    var agora = S.ctx.currentTime;
    param.cancelScheduledValues(agora);
    param.setTargetAtTime(alvo, agora, suavidade);
  }

  function setVolume(valor) {
    volume = limitar(Number(valor) || 0, 0, 1);
    aplicarVolume(0.05);
  }

  function mute() {
    mudo = true;
    aplicarVolume(0.06);
    setTimeout(ajustarContexto, 400);   // suspende o áudio depois que o volume chegou a zero
  }

  function unmute() {
    mudo = false;
    ajustarContexto();
    aplicarVolume(0.08);
  }

  // Situação atual, para o painel de teste
  function getInfo() {
    var info = {
      iniciado: !!S, estado: S ? S.ctx.state : 'desligado', cenaPedida: cenaPedida,
      cena: null, gravada: false, bpm: 0, compasso: 0, totalCompassos: 0, tempo: 0,
      vozes: 0, descartadas: 0, volume: volume, mudo: mudo, calor: calor, leve: leve
    };
    var faixa = faixaAtiva();
    if (faixa) {
      info.cena = faixa.nome;
      info.gravada = true;
    }
    if (!S) return info;
    var ctx = S.ctx;
    info.vozes = S.fimVozes.filter(function (fim) { return fim > ctx.currentTime; }).length;
    info.descartadas = S.descartadas;
    if (!temMusica()) return info;        // parada (ou terminando o fade de saída)
    // o que está saindo na caixa de som agora (descontando o atraso da saída)
    var ouvindo = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    var historico = S.relogio.historico;
    for (var i = historico.length - 1; i >= 0; i--) {
      var c = historico[i];
      if (c.inicio <= ouvindo && ouvindo < c.inicio + 4 * c.spb) {
        info.cena = c.cena;
        info.bpm = Math.round(60 / c.spb);
        info.compasso = c.compasso + 1;
        info.totalCompassos = c.total;
        info.tempo = Math.floor((ouvindo - c.inicio) / c.spb) + 1;
        break;
      }
    }
    return info;
  }

  // O motivo tocado sozinho num instrumento, no registro de cada um
  // (as forças foram medidas para as prévias soarem com volume parecido)
  var PREVIAS = {
    piano:     function (e) {   // em oitavas, como um pianista apresentaria o tema
      e.motivo('piano', 0, { vel: 0.6, sustentar: 2 });
      e.motivo('piano', 0, { transpor: 12, vel: 0.5, sustentar: 2 });
    },
    vibrafone: function (e) { e.motivo('vibrafone', 0, { transpor: 12, vel: 0.5, sustentar: 3 }); },
    baixo:     function (e) { e.motivo('baixo', 0, { transpor: -12, vel: 0.75, sustentar: 1.5 }); },
    bateria:   function (e) {   // o ritmo do motivo na escovinha, sobre as varridas
      [0, 0.5, 1, 1.5].forEach(function (tempo, i) { e.bateria('batida', tempo, i === 3 ? 1 : 0.8); });
      [0, 1, 2].forEach(function (tempo) { e.bateria('varrida', tempo, 0.8); });
      e.bateria('chimbal', 1, 0.8);
    },
    trompete:  function (e) {
      e.motivo('metais', 0, { transpor: 12, vel: 0.6, sustentar: 1.5, extra: { surdina: true } });
    },
    metais:    function (e) {
      e.motivo('metais', 0, { vel: 0.55, sustentar: 1.5, extra: METAL_ABERTO });
      e.motivo('metais', 0, { transpor: 12, vel: 0.45, sustentar: 1.5, extra: METAL_ABERTO });
    },
    cordas:    function (e) {
      var arco = { ataque: 0.05, soltura: 0.25 };
      e.motivo('cordas', 0, { vel: 0.6, sustentar: 1.6, extra: arco });
      e.motivo('cordas', 0, { transpor: 12, vel: 0.5, sustentar: 1.6, extra: arco });
    }
  };

  // Toca o motivo num instrumento. Com música tocando, entra no próximo
  // tempo e no balanço da cena, para não atravessar o ritmo.
  function previewMotif(instrumento) {
    if (!S || !PREVIAS[instrumento]) return;
    var ativa = cenaAtiva();
    var spb = 60 / (ativa ? S.relogio.bpm : CENAS.menu.bpm);
    var inicio = ativa ? proximoTempo() : S.ctx.currentTime + 0.08;
    PREVIAS[instrumento](criarEscritor(S.previa, inicio, spb, ativa ? ativa.cena.swing : 0));
    S.fila.sort(function (a, b) { return a.t - b.t; });
    S.silencioAte = Math.max(S.silencioAte, inicio + 4 * spb + CAUDA);
    ajustarContexto();
  }

  function proximoTempo() {
    var agora = S.ctx.currentTime + 0.05;
    var historico = S.relogio.historico;
    for (var i = historico.length - 1; i >= 0; i--) {
      var c = historico[i];
      if (c.inicio <= agora) return c.inicio + Math.ceil((agora - c.inicio) / c.spb) * c.spb;
    }
    return agora;
  }

  // Gera "segundos" de uma cena sem tocar nada (contexto offline) e devolve
  // uma Promise com o AudioBuffer. Usada nos testes de volume e desempenho.
  // opcoes: volume (0..1), solo ('baixo', 'piano'...), chiado (false), sala (0..1),
  //         previa ('piano', 'trompete'...: grava só a prévia do motivo, sem cena),
  //         calor (0..1) e trocas: [{ aos: segundos, cena: 'pushing', calor: 0.5 }]
  //         para testar as trocas de cena como se o jogo pedisse.
  // Como ao vivo, as notas são agendadas aos poucos: a cada segundo de áudio
  // o render pausa, recebe o trecho seguinte e continua.
  function renderOffline(nomeCena, segundos, opcoes) {
    opcoes = opcoes || {};
    var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var taxa = 44100;
    var ctx = new Offline(2, Math.ceil(segundos * taxa), taxa);
    var trocas = (opcoes.trocas || []).slice();
    var sessao = {
      estudio: criarEstudio(ctx),
      cena: nomeCena,
      calor: opcoes.calor === undefined ? calor : opcoes.calor
    };
    sessao.estudio.offline = true;

    // Roda "tarefa" com o estúdio offline no lugar do de verdade e depois devolve tudo
    function noEstudioOffline(tarefa) {
      var real = { estudio: S, cena: cenaPedida, calor: calor };
      S = sessao.estudio;
      cenaPedida = sessao.cena;
      calor = sessao.calor;
      try {
        tarefa();
      } finally {
        sessao.cena = cenaPedida;
        sessao.calor = calor;
        S = real.estudio;
        cenaPedida = real.cena;
        calor = real.calor;
      }
    }

    // O mesmo trabalho do pulso ao vivo: compõe e agenda o que soa até "limite"
    function agendarAte(limite) {
      noEstudioOffline(function () {
        var agora = S.ctx.currentTime;
        S.camadas.filter(function (c) { return c.saindo && agora > c.fimFade + 0.1; }).forEach(removerCamada);
        while (cenaAtiva() && S.relogio.proximoCompasso < limite) {
          while (trocas.length && trocas[0].aos <= S.relogio.proximoCompasso) {
            var troca = trocas.shift();
            if (troca.calor !== undefined) calor = troca.calor;
            if (troca.cena) cenaPedida = troca.cena;
          }
          comporCompasso();
        }
        despachar(limite, agora);
      });
    }

    noEstudioOffline(function () {
      var v = opcoes.volume === undefined ? volume : opcoes.volume;
      S.mesa.volume.gain.value = v * v * GANHO_SAIDA;
      if (opcoes.sala !== undefined) S.mesa.retornoSala.gain.value = opcoes.sala;
      if (opcoes.previa) {
        PREVIAS[opcoes.previa](criarEscritor(S.previa, 0.1, 60 / CENAS.menu.bpm, 0));
        S.fila.sort(function (a, b) { return a.t - b.t; });
        return;
      }
      iniciarCena(nomeCena);
      if (opcoes.chiado === false) {
        S.mesa.chiado.gain.cancelScheduledValues(0);
        S.mesa.chiado.gain.value = 0;
      }
      if (opcoes.solo) {
        var canais = cenaAtiva().canais;
        Object.keys(canais).forEach(function (nome) {
          if (nome !== opcoes.solo) canais[nome].gain.value = 0;
        });
      }
    });

    agendarAte(1 + ANTECEDENCIA);
    for (var t = 1; t < segundos; t++) {
      (function (momento) {
        ctx.suspend(momento).then(function () {
          agendarAte(momento + 1 + ANTECEDENCIA);
          ctx.resume();
        });
      })(t);
    }
    return ctx.startRendering();
  }

  return {
    init: init,
    setScene: setScene,
    setHeat: setHeat,
    setVolume: setVolume,
    mute: mute,
    unmute: unmute,
    setLightMode: setLightMode,
    // extras do painel de teste
    stop: stop,
    getInfo: getInfo,
    previewMotif: previewMotif,
    renderOffline: renderOffline
  };
})();
