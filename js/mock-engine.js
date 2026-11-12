/* =====================================================================
   mock-engine.js — Motor de regras do Pedal Card (seção 5 do briefing)
   ---------------------------------------------------------------------
   Aqui mora TODA a lógica do jogo: baralhos, marchas, curvas, calor,
   derrapagem, rastro (o vácuo do jogo), ordem dos turnos, bots e fim
   da corrida.
   A interface NUNCA aplica regras sozinha: ela pergunta para a API,
   e a API (mock-api.js) usa este motor.
   Na Fase 2 este arquivo será "traduzido" para PHP (Regras.php/Bots.php).

   Estrutura de um carro guardado em memória:
   {
     id, nome, tipo ('humano' | 'bot'), dificuldade, cor, forma, numero,
     posicao, marcha, derrapagens, chegada_posicao, pontos, ordem,
     compra: [cartas], mao: [cartas], descarte: [cartas], motor: [cartas]
   }
   Uma carta é: { id, tipo: 'velocidade' | 'calor', valor }

   Sorte com semente: cada partida guarda uma "semente" e todo sorteio
   (baralhos, grid, pista, erros dos bots) sai de um gerador que parte
   dela; Math.random só é usado para criar a semente quando ninguém
   informa uma. Mesma semente + mesmas jogadas = mesma corrida, o que
   deixa os testes reproduzíveis.
   ===================================================================== */

var MotorRegras = (function () {
  'use strict';

  var R = CONFIG.REGRAS;
  var proximoIdCarta = 1;

  /* ---------- Erro de regra (vira {ok:false, erro:{...}} na API) ---------- */
  function ErroJogo(codigo, mensagem) {
    this.codigo = codigo;
    this.mensagem = mensagem;
  }

  /* ---------- Sorte com semente ---------- */

  // Gerador de números pseudoaleatórios mulberry32 (o mesmo de ui-pista.js).
  // Devolve um número de 0 (incluso) a 1 (excluso). O estado do gerador é
  // só um número, guardado em dono.aleatorio (dono = a partida ou a pista),
  // então a sequência continua de onde parou a cada chamada.
  function aleatorio(dono) {
    var a = (dono.aleatorio + 0x6D2B79F5) >>> 0;
    dono.aleatorio = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Número inteiro sorteado de min a max (os dois inclusos).
  function sortearEntre(dono, min, max) {
    return min + Math.floor(aleatorio(dono) * (max - min + 1));
  }

  // Semente válida: inteiro de 1 a 2147483647.
  function sementeValida(valor) {
    var n = Number(valor);
    return Number.isInteger(n) && n >= 1 && n <= 2147483647;
  }

  /* ---------- Utilitários ---------- */

  // Embaralhamento de Fisher-Yates: cada ordem tem a mesma chance.
  function embaralhar(dono, lista) {
    for (var i = lista.length - 1; i > 0; i--) {
      var j = Math.floor(aleatorio(dono) * (i + 1));
      var temp = lista[i];
      lista[i] = lista[j];
      lista[j] = temp;
    }
    return lista;
  }

  function ultimaCasa(partida) {
    return partida.pista.total_casas - 1;
  }

  function buscarCarro(partida, carroId) {
    return partida.carros.find(function (c) { return c.id === carroId; });
  }

  function ehCalor(carta) { return carta.tipo === 'calor'; }
  function ehVelocidade(carta) { return carta.tipo === 'velocidade'; }

  // Move "quantidade" cartas do fim de uma pilha para outra.
  function moverCartas(origem, destino, quantidade) {
    for (var i = 0; i < quantidade && origem.length > 0; i++) {
      destino.push(origem.pop());
    }
  }

  /* ---------- Baralho ---------- */

  // Monta as 12 cartas de Velocidade, as 6 de Calor e compra a mão inicial.
  function prepararBaralho(partida, carro) {
    carro.compra = [];
    carro.mao = [];
    carro.descarte = [];
    carro.motor = [];

    R.VALORES_VELOCIDADE.forEach(function (valor) {
      for (var i = 0; i < R.COPIAS_POR_VALOR; i++) {
        carro.compra.push({ id: proximoIdCarta++, tipo: 'velocidade', valor: valor });
      }
    });
    embaralhar(partida, carro.compra);

    for (var i = 0; i < R.CALOR_MOTOR; i++) {
      carro.motor.push({ id: proximoIdCarta++, tipo: 'calor', valor: 0 });
    }

    comprarAte(partida, carro, R.TAMANHO_MAO);
  }

  // Compra cartas até a mão ter "limite" cartas.
  // Se o baralho de compra acabar, o descarte é embaralhado e vira o novo baralho.
  function comprarAte(partida, carro, limite) {
    var resultado = { quantidade: 0, reembaralhou: false };
    while (carro.mao.length < limite) {
      if (carro.compra.length === 0) {
        if (carro.descarte.length === 0) break; // não há mais cartas em lugar nenhum
        carro.compra = embaralhar(partida, carro.descarte);
        carro.descarte = [];
        resultado.reembaralhou = true;
      }
      carro.mao.push(carro.compra.pop());
      resultado.quantidade++;
    }
    return resultado;
  }

  /* ---------- Marchas ---------- */

  // Lista as 4 marchas dizendo se cada uma é permitida e quanto custa.
  // Subir/descer 1 = grátis; pular 2 = 1 Calor; pular 3 = proibido.
  function opcoesDeMarcha(carro) {
    var opcoes = [];
    for (var m = R.MARCHA_MIN; m <= R.MARCHA_MAX; m++) {
      var diferenca = Math.abs(m - carro.marcha);
      var custo = diferenca === 2 ? 1 : 0;
      var permitida = true;
      var motivo = '';
      if (diferenca > 2) {
        permitida = false;
        motivo = 'Só dá para mudar até 2 marchas por turno.';
      } else if (custo > carro.motor.length) {
        permitida = false;
        motivo = 'Pular 2 marchas custa 1 Calor, mas seu motor está vazio.';
      }
      opcoes.push({
        marcha: m,
        custo_calor: custo,
        permitida: permitida,
        motivo: motivo,
        resfria: m === 1
      });
    }
    return opcoes;
  }

  // Quantas cartas de Velocidade o carro precisa jogar nessa marcha.
  // Marcha N = N cartas; se não houver N na mão, joga as que tiver.
  function cartasNecessarias(carro, marcha) {
    var naMao = carro.mao.filter(ehVelocidade).length;
    return Math.min(marcha, naMao);
  }

  /* ---------- Validação da jogada ---------- */

  // Confere se a jogada é válida. Se não for, lança ErroJogo.
  // Devolve os objetos das cartas escolhidas.
  function validarJogada(carro, marcha, cartaIds) {
    marcha = Number(marcha);
    if (!Number.isInteger(marcha) || marcha < R.MARCHA_MIN || marcha > R.MARCHA_MAX) {
      throw new ErroJogo('MARCHA_INVALIDA', 'Escolha uma marcha de ' + R.MARCHA_MIN + ' a ' + R.MARCHA_MAX + '.');
    }
    var opcao = opcoesDeMarcha(carro).find(function (o) { return o.marcha === marcha; });
    if (!opcao.permitida) {
      throw new ErroJogo('MARCHA_INVALIDA', opcao.motivo);
    }

    if (!Array.isArray(cartaIds)) {
      throw new ErroJogo('CARTAS_INVALIDAS', 'Envie a lista de cartas escolhidas.');
    }
    var ids = cartaIds.map(Number);
    var unicos = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    if (unicos.length !== ids.length) {
      throw new ErroJogo('CARTAS_INVALIDAS', 'A mesma carta foi escolhida duas vezes.');
    }

    var cartas = ids.map(function (id) {
      return carro.mao.find(function (c) { return c.id === id; });
    });
    if (cartas.some(function (c) { return !c; })) {
      throw new ErroJogo('CARTAS_INVALIDAS', 'Uma das cartas escolhidas não está na sua mão.');
    }
    if (cartas.some(ehCalor)) {
      throw new ErroJogo('CARTAS_INVALIDAS', 'Cartas de Calor são "mortas": não podem ser jogadas.');
    }

    var necessarias = cartasNecessarias(carro, marcha);
    if (cartas.length !== necessarias) {
      throw new ErroJogo('CARTAS_INVALIDAS',
        'Na marcha ' + marcha + ' você deve jogar exatamente ' + necessarias +
        (necessarias === 1 ? ' carta' : ' cartas') + ' de Velocidade.');
    }
    return cartas;
  }

  /* ---------- Simulação (não altera nada!) ---------- */

  // Carro que está na casa (ignorando o próprio carro), ou null se estiver livre.
  function carroNaCasa(partida, casa, ignorarCarroId) {
    return partida.carros.find(function (c) {
      return c.id !== ignorarCarroId && c.posicao === casa;
    }) || null;
  }

  function casaOcupada(partida, casa, ignorarCarroId) {
    return carroNaCasa(partida, casa, ignorarCarroId) !== null;
  }

  // Regra de ocupação: se o destino estiver ocupado, recua até a casa livre
  // mais próxima, sem voltar para trás da casa onde o carro começou.
  function casaLivre(partida, carro, alvo, inicial) {
    for (var casa = alvo; casa > inicial; casa--) {
      if (!casaOcupada(partida, casa, carro.id)) return casa;
    }
    return inicial;
  }

  // Calcula o resultado da jogada SEM mexer no estado.
  // É usada pela previsão (prever_jogada), pelos bots e pelo turno de verdade,
  // então as três coisas sempre concordam.
  function simularJogada(partida, carro, marcha, cartas) {
    var ultima = ultimaCasa(partida);
    var r = {
      marcha: marcha,
      custoMarcha: Math.abs(marcha - carro.marcha) === 2 ? 1 : 0,
      resfria: false,
      velocidade: 0,
      inicial: carro.posicao,
      alvo: 0,              // casa pretendida (posição + velocidade)
      casaAposOcupacao: 0,  // casa depois da regra de ocupação
      ajustado: false,
      final: 0,
      curvas: [],           // curvas cruzadas: { casa, limite, calor_pago }
      derrapou: false,
      derrapagem: null,     // detalhes da derrapagem, se houver
      vacuo: null,          // rastro (vácuo), se houver: { de, para, atras_de }
      calorTotal: 0,        // calor pago no turno (marcha + curvas)
      motorFinal: 0,
      chegou: false
    };

    // 1. Marcha: pular 2 marchas custa 1 Calor
    var motor = carro.motor.length - r.custoMarcha;

    // 2. Resfriar: na marcha 1 volta 1 Calor para o motor
    //    (vem da mão; se não houver na mão, vem do descarte)
    if (marcha === 1) {
      var temCalor = carro.mao.some(ehCalor) || carro.descarte.some(ehCalor) || r.custoMarcha > 0;
      if (temCalor) {
        r.resfria = true;
        motor += 1;
      }
    }

    // 3 e 4. Velocidade = soma das cartas
    r.velocidade = cartas.reduce(function (soma, c) { return soma + c.valor; }, 0);
    r.alvo = r.inicial + r.velocidade;

    // 5. Ocupação (a chegada é a última casa: não passa dela)
    r.casaAposOcupacao = casaLivre(partida, carro, Math.min(r.alvo, ultima), r.inicial);
    r.ajustado = r.casaAposOcupacao !== Math.min(r.alvo, ultima);
    r.final = r.casaAposOcupacao;

    // 6 e 7. Curvas cruzadas, em ordem
    var curvas = partida.pista.curvas.slice().sort(function (a, b) { return a.casa - b.casa; });
    for (var i = 0; i < curvas.length; i++) {
      var curva = curvas[i];
      var cruzou = r.inicial < curva.casa && r.final >= curva.casa;
      if (!cruzou) continue;

      var custo = Math.max(0, r.velocidade - curva.limite);
      if (custo <= motor) {
        motor -= custo;
        r.curvas.push({ casa: curva.casa, limite: curva.limite, calor_pago: custo });
      } else {
        // Derrapagem: para antes da curva e não processa as próximas
        r.derrapou = true;
        r.derrapagem = {
          casa: curva.casa,
          limite: curva.limite,
          calor_necessario: custo,
          calor_disponivel: motor
        };
        r.final = casaLivre(partida, carro, curva.casa - 1, r.inicial);
        break;
      }
    }

    // 7b. Rastro (o vácuo do Pedal Card): quem andou, não derrapou e parou
    //     colado atrás de outro carro é puxado até VACUO_CASAS casas à frente,
    //     para a casa livre mais distante. Só vale na reta: o rastro para na
    //     casa antes da próxima curva, então nunca custa Calor nem faz derrapar.
    if (!r.derrapou && r.final > r.inicial) {
      var carroNaFrente = carroNaCasa(partida, r.final + 1, carro.id);
      if (carroNaFrente) {
        var limite = Math.min(r.final + R.VACUO_CASAS, ultima);
        var proximaCurva = curvas.find(function (c) { return c.casa > r.final; });
        if (proximaCurva) limite = Math.min(limite, proximaCurva.casa - 1);
        var destino = casaLivre(partida, carro, limite, r.final);
        if (destino > r.final) {
          r.vacuo = { de: r.final, para: destino, atras_de: carroNaFrente.id };
          r.final = destino;
        }
      }
    }

    r.calorTotal = r.custoMarcha + r.curvas.reduce(function (s, c) { return s + c.calor_pago; }, 0);
    r.motorFinal = motor;
    r.chegou = r.final >= ultima;
    return r;
  }

  /* ---------- Turno de verdade (altera o estado) ---------- */

  function executarTurno(partida, carro, marcha, cartaIds, eventos) {
    var cartas = validarJogada(carro, marcha, cartaIds); // lança erro se inválida
    marcha = Number(marcha);
    var sim = simularJogada(partida, carro, marcha, cartas);
    var marchaAntiga = carro.marcha;

    // 1. Marcha
    moverCartas(carro.motor, carro.descarte, sim.custoMarcha);
    carro.marcha = marcha;
    eventos.push({ tipo: 'marcha', carro_id: carro.id, de: marchaAntiga, para: marcha, calor_pago: sim.custoMarcha });

    // 2. Resfriar (regra própria): Calor da mão ou, se não houver, do descarte
    if (sim.resfria) {
      var origem = 'mao';
      var indice = carro.mao.findIndex(ehCalor);
      var pilha = carro.mao;
      if (indice === -1) {
        origem = 'descarte';
        pilha = carro.descarte;
        indice = pilha.findIndex(ehCalor);
      }
      carro.motor.push(pilha.splice(indice, 1)[0]);
      eventos.push({ tipo: 'resfriar', carro_id: carro.id, origem: origem });
    }

    // 3 e 4. Cartas jogadas saem da mão
    carro.mao = carro.mao.filter(function (c) { return cartas.indexOf(c) === -1; });
    eventos.push({
      tipo: 'cartas_jogadas',
      carro_id: carro.id,
      cartas: cartas.map(function (c) { return c.id; }),
      valores: cartas.map(function (c) { return c.valor; }),
      velocidade: sim.velocidade
    });

    // 5. Ocupação + movimento (o rastro vem depois, num evento separado)
    if (sim.ajustado) {
      eventos.push({ tipo: 'ajuste_ocupacao', carro_id: carro.id, pretendida: sim.alvo, casa: sim.casaAposOcupacao });
    }
    var casaAntesDoRastro = sim.vacuo ? sim.vacuo.de : sim.final;
    eventos.push({ tipo: 'mover', carro_id: carro.id, de: sim.inicial, para: casaAntesDoRastro });

    // 6. Curvas
    sim.curvas.forEach(function (curva) {
      moverCartas(carro.motor, carro.descarte, curva.calor_pago);
      eventos.push({
        tipo: 'curva', carro_id: carro.id, casa: curva.casa, limite: curva.limite,
        velocidade: sim.velocidade, calor_pago: curva.calor_pago
      });
    });

    // 7. Derrapagem
    if (sim.derrapou) {
      carro.marcha = 1;
      carro.derrapagens++;
      eventos.push({
        tipo: 'derrapagem', carro_id: carro.id, casa: sim.derrapagem.casa, limite: sim.derrapagem.limite,
        velocidade: sim.velocidade, calor_necessario: sim.derrapagem.calor_necessario,
        calor_disponivel: sim.derrapagem.calor_disponivel, para: sim.final
      });
    }

    // 7b. Rastro (vácuo): o carro é puxado para a frente
    if (sim.vacuo) {
      eventos.push({ tipo: 'vacuo', carro_id: carro.id, de: sim.vacuo.de, para: sim.vacuo.para, atras_de: sim.vacuo.atras_de });
    }
    carro.posicao = sim.final;

    // 8. Fim do turno: jogadas para o descarte e compra até 7
    cartas.forEach(function (c) { carro.descarte.push(c); });
    var compra = comprarAte(partida, carro, R.TAMANHO_MAO);
    eventos.push({ tipo: 'compra', carro_id: carro.id, quantidade: compra.quantidade, reembaralhou: compra.reembaralhou });

    // Histórico (vira a tabela "jogadas" na Fase 2)
    partida.jogadas.push({
      id: partida.jogadas.length + 1,
      partida_id: partida.id,
      carro_id: carro.id,
      rodada: partida.rodada,
      marcha: marcha,
      velocidade: sim.velocidade,
      posicao_inicial: sim.inicial,
      posicao_final: sim.final,
      calor_pago: sim.calorTotal,
      derrapou: sim.derrapou
    });

    if (sim.chegou) finalizarCorrida(partida, carro, eventos);
  }

  /* ---------- Ordem dos turnos ---------- */

  // O líder (maior posição) joga primeiro. Recalculado a cada rodada.
  function recalcularOrdem(partida) {
    var ordenados = partida.carros.slice().sort(function (a, b) {
      return b.posicao - a.posicao || a.id - b.id;
    });
    partida.ordem = ordenados.map(function (c) { return c.id; });
    ordenados.forEach(function (c, i) { c.ordem = i + 1; });
    partida.indiceVez = 0;
  }

  function carroDaVez(partida) {
    return buscarCarro(partida, partida.ordem[partida.indiceVez]);
  }

  function avancarVez(partida, eventos) {
    partida.indiceVez++;
    if (partida.indiceVez >= partida.ordem.length) {
      partida.rodada++;
      recalcularOrdem(partida);
      eventos.push({ tipo: 'nova_rodada', rodada: partida.rodada });
    }
  }

  // Os bots jogam sozinhos até chegar a vez do humano (ou a corrida acabar).
  function executarAteVezDoHumano(partida, eventos) {
    while (partida.status === 'em_andamento') {
      var carro = carroDaVez(partida);
      partida.turno_de = carro.id;
      if (carro.tipo === 'humano') return;

      var escolha = escolherJogadaBot(partida, carro);
      executarTurno(partida, carro, escolha.marcha, escolha.cartas, eventos);
      if (partida.status === 'em_andamento') avancarVez(partida, eventos);
    }
  }

  /* ---------- Fim da corrida ---------- */

  function finalizarCorrida(partida, vencedor, eventos) {
    partida.status = 'finalizada';
    partida.turno_de = null;
    partida.vencedor_carro_id = vencedor.id;

    // Demais carros: maior posição primeiro; desempate = menos derrapagens
    var outros = partida.carros
      .filter(function (c) { return c !== vencedor; })
      .sort(function (a, b) {
        return b.posicao - a.posicao || a.derrapagens - b.derrapagens || a.id - b.id;
      });
    var classificacao = [vencedor].concat(outros);
    classificacao.forEach(function (c, i) {
      c.chegada_posicao = i + 1;
      c.pontos = R.PONTOS_POR_COLOCACAO[i] || 0;
    });

    eventos.push({
      tipo: 'fim_corrida',
      vencedor_id: vencedor.id,
      rodada: partida.rodada,
      classificacao: classificacao.map(function (c) {
        return { carro_id: c.id, nome: c.nome, colocacao: c.chegada_posicao, pontos: c.pontos };
      })
    });
  }

  /* ---------- Bots ---------- */

  // Todas as combinações de k itens de uma lista (ex.: escolher 3 cartas de 5).
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

  /* ---------- Bots: tabela de turnos até a chegada ----------
     Os bots pensam em TURNOS: "quantos turnos ainda faltam para eu cruzar a
     chegada?". A resposta vem de uma tabela montada uma vez por pista, como
     um GPS que sabe a distância de cada esquina até o destino:

       tabela[casa][marcha][calor] = turnos que faltam, jogando bem, para
                                    quem está nessa casa, nessa marcha e
                                    com essa quantidade de Calor no motor.

     Ela é preenchida de trás para frente (da casa 46 até a 0), porque o
     valor de uma casa depende do valor das casas à frente. Como ninguém sabe
     as cartas dos próximos turnos, usamos MÃOS DE EXEMPLO (sempre as mesmas,
     sorteadas com semente fixa) e tiramos a média: em cada mão, qual seria a
     melhor marcha e velocidade? Quanto mais Calor já foi gasto, mais cartas
     de Calor (mortas) aparecem nessas mãos, porque o Calor pago volta
     embaralhado para o baralho.

     Sem nenhuma regra extra, a tabela já "sabe" que:
       - o Calor vale conforme as curvas que ainda faltam (o que sobra depois
         da última curva não vale nada);
       - parar colado numa curva lenta em marcha alta é ruim (no turno
         seguinte vai pagar muito Calor ou derrapar);
       - gastar Calor enche o baralho de cartas mortas;
       - resfriar (marcha 1) compensa quando ainda há curvas caras pela frente.
     A ocupação e o rastro (vácuo) entram porque cada jogada candidata é
     simulada com simularJogada(), que já aplica essas regras.
     ------------------------------------------------------------------ */

  var VELOCIDADE_MAXIMA = R.MARCHA_MAX * Math.max.apply(null, R.VALORES_VELOCIDADE); // 4 cartas de 4 = 16
  var TURNOS_SE_TRAVADO = 10;  // mão de exemplo sem nenhuma jogada que ande (raríssimo)
  var maosDeExemplo = null;    // maosDeExemplo[calorGasto][i][marcha] = velocidades possíveis

  // Sorteia as mãos de exemplo (uma vez só) e guarda, para cada marcha, as
  // velocidades que dá para fazer com elas. Ex.: mão 1, 3, 4 na marcha 2 → 4, 5 e 7.
  function prepararMaosDeExemplo() {
    var gerador = { aleatorio: 2024 };  // semente fixa: a tabela nunca muda
    maosDeExemplo = [];
    for (var gasto = 0; gasto <= R.CALOR_MOTOR; gasto++) {
      var maos = [];
      for (var i = 0; i < R.BOT_MAOS_EXEMPLO; i++) {
        // Baralho: as cartas de Velocidade + uma carta de Calor (valor 0) por Calor gasto
        var baralho = [];
        R.VALORES_VELOCIDADE.forEach(function (valor) {
          for (var copia = 0; copia < R.COPIAS_POR_VALOR; copia++) baralho.push(valor);
        });
        for (var q = 0; q < gasto; q++) baralho.push(0);
        embaralhar(gerador, baralho);
        var mao = baralho.slice(0, R.TAMANHO_MAO).filter(function (valor) { return valor > 0; });

        var porMarcha = [];
        for (var m = R.MARCHA_MIN; m <= R.MARCHA_MAX; m++) {
          var somas = {};
          combinacoes(mao, Math.min(m, mao.length)).forEach(function (combo) {
            somas[combo.reduce(function (s, v) { return s + v; }, 0)] = true;
          });
          porMarcha[m] = Object.keys(somas).map(Number);
        }
        maos.push(porMarcha);
      }
      maosDeExemplo.push(maos);
    }
  }

  // Monta a tabela de turnos de uma pista (leva poucos milissegundos).
  function montarTabelaTurnos(pista) {
    if (!maosDeExemplo) prepararMaosDeExemplo();
    var ultima = pista.total_casas - 1;
    var curvas = pista.curvas.slice().sort(function (a, b) { return a.casa - b.casa; });
    var tabela = [];
    for (var casa = 0; casa < ultima; casa++) {
      tabela.push([]);
      for (var m = R.MARCHA_MIN; m <= R.MARCHA_MAX; m++) tabela[casa][m] = [];
    }

    // Turnos que faltam para quem está nessa situação (0 na chegada)
    function turnosNa(casa, marcha, calor) {
      if (casa >= ultima) return 0;
      var valor = tabela[casa][marcha][calor];
      return valor === undefined ? Infinity : valor; // ainda não calculado
    }

    // Anda "velocidade" casas a partir de "inicio" pagando as curvas (como em
    // simularJogada, mas sem outros carros) e diz quantos turnos faltarão.
    function turnosDepoisDeAndar(inicio, velocidade, marcha, calor) {
      var destino = Math.min(inicio + velocidade, ultima);
      for (var i = 0; i < curvas.length; i++) {
        var curva = curvas[i];
        if (curva.casa <= inicio) continue;
        if (curva.casa > destino) break;
        var custo = Math.max(0, velocidade - curva.limite);
        if (custo <= calor) {
          calor -= custo;
        } else {             // derrapa: para antes da curva, marcha 1
          destino = curva.casa - 1;
          marcha = R.MARCHA_MIN;
          break;
        }
      }
      return turnosNa(destino, marcha, calor);
    }

    for (var p = ultima - 1; p >= 0; p--) {
      for (var marcha = R.MARCHA_MIN; marcha <= R.MARCHA_MAX; marcha++) {
        for (var calor = 0; calor <= R.CALOR_MOTOR; calor++) {
          // 1) Para cada marcha nova e cada velocidade: turnos que faltariam depois
          var depois = [];
          for (var nova = Math.max(R.MARCHA_MIN, marcha - 2); nova <= Math.min(R.MARCHA_MAX, marcha + 2); nova++) {
            var custoMarcha = Math.abs(nova - marcha) === 2 ? 1 : 0;
            if (custoMarcha > calor) continue;                           // pular 2 marchas sem Calor: proibido
            var motor = calor - custoMarcha;
            if (nova === R.MARCHA_MIN && motor < R.CALOR_MOTOR) motor++; // resfriar
            depois[nova] = [];
            for (var v = 1; v <= VELOCIDADE_MAXIMA; v++) depois[nova][v] = turnosDepoisDeAndar(p, v, nova, motor);
          }

          // 2) Média das mãos de exemplo: em cada uma, a melhor escolha possível
          var maos = maosDeExemplo[R.CALOR_MOTOR - calor];
          var soma = 0;
          for (var i = 0; i < maos.length; i++) {
            var melhor = Infinity;
            for (var n = R.MARCHA_MIN; n <= R.MARCHA_MAX; n++) {
              if (!depois[n]) continue;
              var velocidades = maos[i][n];
              for (var k = 0; k < velocidades.length; k++) {
                var turnos = depois[n][velocidades[k]];
                if (turnos < melhor) melhor = turnos;
              }
            }
            soma += Math.min(melhor, TURNOS_SE_TRAVADO);
          }
          tabela[p][marcha][calor] = 1 + soma / maos.length;
        }
      }
    }
    return { pista: pista, consultar: turnosNa };
  }

  // A tabela só depende da pista: é montada na primeira jogada de um bot e
  // reaproveitada. A última tabela montada também fica guardada, para a
  // próxima partida na mesma pista (revanche, testes) não montar de novo.
  var ultimaTabela = { chave: null, tabela: null };

  function tabelaDaPartida(partida) {
    if (!partida.tabelaBots || partida.tabelaBots.pista !== partida.pista) {
      var chave = JSON.stringify([partida.pista.total_casas, partida.pista.curvas]);
      if (ultimaTabela.chave !== chave) {
        ultimaTabela = { chave: chave, tabela: montarTabelaTurnos(partida.pista) };
      }
      partida.tabelaBots = { pista: partida.pista, consultar: ultimaTabela.tabela.consultar };
    }
    return partida.tabelaBots;
  }

  // O bot testa todas as jogadas possíveis (marcha + cartas), simula cada uma
  // com simularJogada() e dá a NOTA:
  //   turnos = quantos turnos ainda faltariam até a chegada depois da jogada
  //            (0 se ela cruza a chegada), lidos na tabela na casa, marcha e
  //            Calor em que o carro termina (derrapou = marcha 1).
  // Quanto MENOS turnos, melhor. Empate: a que termina mais à frente.
  function avaliarOpcoesBot(partida, carro) {
    var tabela = tabelaDaPartida(partida);
    var velocidadeNaMao = carro.mao.filter(ehVelocidade);
    var vistas = {};
    var opcoes = [];

    opcoesDeMarcha(carro).forEach(function (op) {
      if (!op.permitida) return;
      var n = Math.min(op.marcha, velocidadeNaMao.length);
      combinacoes(velocidadeNaMao, n).forEach(function (combo) {
        // Cartas de mesmo valor dão o mesmo resultado: avalia só uma vez
        var chave = op.marcha + ':' + combo.map(function (c) { return c.valor; }).sort().join(',');
        if (vistas[chave]) return;
        vistas[chave] = true;

        var sim = simularJogada(partida, carro, op.marcha, combo);
        var marchaDepois = sim.derrapou ? R.MARCHA_MIN : op.marcha;
        opcoes.push({
          marcha: op.marcha,
          cartas: combo.map(function (c) { return c.id; }),
          turnos: sim.chegou ? 0 : tabela.consultar(sim.final, marchaDepois, sim.motorFinal),
          casaFinal: sim.final,
          derrapa: sim.derrapou
        });
      });
    });

    opcoes.sort(function (a, b) { return a.turnos - b.turnos || b.casaFinal - a.casaFinal; });
    return opcoes;
  }

  // Dificuldades: todos usam a mesma tabela; o que muda é o quanto erram.
  //  - difícil: sempre a jogada com menos turnos;
  //  - médio e fácil: sorteiam entre as jogadas SEGURAS (sem derrapagem) que
  //    deixam no máximo BOT_TOLERANCIA turnos a mais que a melhor. Assim erram
  //    de propósito, mas nunca de um jeito suicida: ninguém derrapa por
  //    sorteio e ninguém deixa de cruzar a chegada quando pode.
  function escolherJogadaBot(partida, carro) {
    var opcoes = avaliarOpcoesBot(partida, carro);
    var melhor = opcoes[0];
    var tolerancia = R.BOT_TOLERANCIA[carro.dificuldade] || 0;
    if (tolerancia === 0 || melhor.turnos === 0) return melhor;

    var parecidas = opcoes.filter(function (op) {
      return !op.derrapa && op.turnos <= melhor.turnos + tolerancia;
    });
    if (!parecidas.length) return melhor;
    return parecidas[Math.floor(aleatorio(partida) * parecidas.length)];
  }

  /* ---------- Pista ---------- */

  function pistaClassica() {
    return {
      nome: 'Circuito da Serra',
      semente: 1,
      total_casas: R.TOTAL_CASAS,
      curvas: R.CURVAS.map(function (c) { return { casa: c.casa, limite: c.limite }; })
    };
  }

  // A pista combina com as regras de espaçamento de PISTA_SORTEIO?
  function curvasValidas(casas) {
    var S = R.PISTA_SORTEIO;
    if (casas[0] < S.PRIMEIRA_CURVA_MIN || casas[casas.length - 1] > S.ULTIMA_CURVA_MAX) return false;
    for (var i = 1; i < casas.length; i++) {
      var distancia = casas[i] - casas[i - 1];
      if (distancia < S.DISTANCIA_MIN || distancia > S.DISTANCIA_MAX) return false;
    }
    return R.TOTAL_CASAS - casas[casas.length - 1] + casas[0] <= S.RETA_LARGADA_MAX;
  }

  // Monta a pista de uma semente: quantas curvas, onde ficam e o limite de
  // cada uma. A semente 1 é a pista clássica; as outras sorteiam uma pista
  // com um gerador só dela, então a mesma semente sempre dá a mesma pista
  // (e a interface usa a mesma semente para desenhar o traçado).
  function pistaDaSemente(semente) {
    if (semente === 1) return pistaClassica();
    var S = R.PISTA_SORTEIO;
    var gerador = { aleatorio: semente };
    var quantidade = sortearEntre(gerador, S.CURVAS_MIN, S.CURVAS_MAX);
    var casas = null;

    // Sorteia posições até achar um conjunto bem espaçado (acha em poucas tentativas)
    for (var tentativa = 0; tentativa < 2000 && !casas; tentativa++) {
      var candidatas = [];
      while (candidatas.length < quantidade) {
        var casa = sortearEntre(gerador, S.PRIMEIRA_CURVA_MIN, S.ULTIMA_CURVA_MAX);
        if (candidatas.indexOf(casa) === -1) candidatas.push(casa);
      }
      candidatas.sort(function (a, b) { return a - b; });
      if (curvasValidas(candidatas)) casas = candidatas;
    }
    if (!casas) return pistaClassica();

    // Limites variados: pelo menos uma curva lenta e uma rápida
    var limites = casas.map(function () { return sortearEntre(gerador, S.LIMITE_MIN, S.LIMITE_MAX); });
    var lenta = sortearEntre(gerador, 0, limites.length - 1);
    limites[lenta] = S.LIMITE_MIN;
    if (Math.max.apply(null, limites) < S.LIMITE_MAX - 1) {
      limites[(lenta + 2) % limites.length] = S.LIMITE_MAX;
    }

    return {
      nome: R.NOMES_CIRCUITOS[sortearEntre(gerador, 0, R.NOMES_CIRCUITOS.length - 1)],
      semente: semente,
      total_casas: R.TOTAL_CASAS,
      curvas: casas.map(function (casa, i) { return { casa: casa, limite: limites[i] }; })
    };
  }

  /* ---------- Funções públicas (usadas pela mock-api) ---------- */

  function criarPartida(id, dados) {
    var nome = String(dados.nome_jogador || '').trim();
    if (nome.length < 2 || nome.length > 20) {
      throw new ErroJogo('NOME_INVALIDO', 'Digite um nome de piloto com 2 a 20 caracteres.');
    }
    var numBots = Number(dados.num_bots);
    if (numBots !== 1 && numBots !== 2) {
      throw new ErroJogo('BOTS_INVALIDOS', 'Escolha 1 ou 2 adversários.');
    }
    var dificuldade = dados.dificuldade;
    if (['facil', 'medio', 'dificil'].indexOf(dificuldade) === -1) {
      throw new ErroJogo('DIFICULDADE_INVALIDA', 'Escolha a dificuldade: fácil, médio ou difícil.');
    }

    // Semente da partida: a informada (testes) ou uma nova. É o ÚNICO uso de
    // Math.random no motor; daqui em diante tudo sai do gerador com semente.
    var semente = sementeValida(dados.semente) ? Number(dados.semente) : 1 + Math.floor(Math.random() * 2147483646);

    var partida = {
      id: id,
      semente: semente,
      aleatorio: semente,   // estado do gerador (muda a cada sorteio)
      status: 'em_andamento',
      rodada: 1,
      turno_de: null,
      vencedor_carro_id: null,
      pista: null,
      carros: [],
      ordem: [],
      indiceVez: 0,
      jogadas: []
    };

    // Pista: semente_pista informada (revanche na mesma pista), clássica ou sorteada
    var sementePista;
    if (sementeValida(dados.semente_pista)) sementePista = Number(dados.semente_pista);
    else sementePista = R.PISTA_ALEATORIA ? sortearEntre(partida, 2, 999999) : 1;
    partida.pista = pistaDaSemente(sementePista);

    // Grid de largada sorteado: casas 0, 1 (e 2), uma por carro
    var casasGrid = [];
    for (var g = 0; g <= numBots; g++) casasGrid.push(g);
    embaralhar(partida, casasGrid);

    for (var i = 0; i <= numBots; i++) {
      var visual = CONFIG.CARROS_VISUAL[i];
      var carro = {
        id: i + 1,
        nome: i === 0 ? nome : visual.nome,
        tipo: i === 0 ? 'humano' : 'bot',
        dificuldade: i === 0 ? null : dificuldade,
        cor: visual.cor,
        forma: visual.forma,
        numero: i + 1,
        posicao: casasGrid[i],
        marcha: R.MARCHA_INICIAL,
        derrapagens: 0,
        chegada_posicao: null,
        pontos: 0,
        ordem: 0
      };
      prepararBaralho(partida, carro);
      partida.carros.push(carro);
    }

    recalcularOrdem(partida);
    return partida;
  }

  // Começa a corrida: bots à frente do humano no grid já fazem a 1ª jogada.
  function iniciarCorrida(partida) {
    var eventos = [];
    executarAteVezDoHumano(partida, eventos);
    return eventos;
  }

  function verificarVezDoHumano(partida) {
    if (partida.status !== 'em_andamento') {
      throw new ErroJogo('PARTIDA_ENCERRADA', 'Esta corrida já terminou. Comece uma nova partida.');
    }
    var carro = carroDaVez(partida);
    if (carro.tipo !== 'humano') {
      throw new ErroJogo('NAO_E_SEU_TURNO', 'Ainda não é a sua vez. Aguarde os adversários.');
    }
    return carro;
  }

  function jogarTurnoHumano(partida, marcha, cartaIds) {
    var carro = verificarVezDoHumano(partida);
    var eventos = [];
    executarTurno(partida, carro, marcha, cartaIds, eventos);
    if (partida.status === 'em_andamento') {
      avancarVez(partida, eventos);
      executarAteVezDoHumano(partida, eventos);
    }
    return eventos;
  }

  function preverJogada(partida, marcha, cartaIds) {
    var carro = verificarVezDoHumano(partida);
    var cartas = validarJogada(carro, marcha, cartaIds);
    var sim = simularJogada(partida, carro, Number(marcha), cartas);
    return {
      ok: true,
      velocidade: sim.velocidade,
      destino: sim.final,
      destino_pretendido: sim.alvo,
      ajuste_ocupacao: sim.ajustado,
      calor_previsto: sim.calorTotal,
      custo_marcha: sim.custoMarcha,
      resfria: sim.resfria,
      derrapa: sim.derrapou,
      derrapagem: sim.derrapagem,
      curvas: sim.curvas,
      vacuo: sim.vacuo,     // rastro: { de, para, atras_de } ou null (extra no contrato)
      motor_apos: sim.motorFinal,
      chega: sim.chegou
    };
  }

  // Converte a partida interna no formato JSON do contrato (seção 6).
  // Só a mão do humano é revelada; as mãos dos bots ficam em segredo.
  function montarEstado(partida) {
    var humano = partida.carros.find(function (c) { return c.tipo === 'humano'; });
    var estado = {
      ok: true,
      partida: {
        id: partida.id,
        status: partida.status,
        rodada: partida.rodada,
        turno_de: partida.turno_de,
        vencedor_carro_id: partida.vencedor_carro_id
      },
      pista: partida.pista,
      carros: partida.carros.map(function (c) {
        return {
          id: c.id, nome: c.nome, tipo: c.tipo, dificuldade: c.dificuldade,
          posicao: c.posicao, marcha: c.marcha, motor: c.motor.length,
          ordem: c.ordem, cor: c.cor, forma: c.forma, numero: c.numero,
          derrapagens: c.derrapagens, chegada_posicao: c.chegada_posicao, pontos: c.pontos
        };
      }),
      minha_mao: humano.mao.slice(),
      baralho: {
        compra: humano.compra.length,
        descarte: humano.descarte.length,
        calor_na_mao: humano.mao.filter(ehCalor).length
      },
      minhas_opcoes: {
        marchas: opcoesDeMarcha(humano)
      },
      resultado: null
    };

    if (partida.status === 'finalizada') {
      estado.resultado = {
        rodadas: partida.rodada,
        classificacao: partida.carros.slice()
          .sort(function (a, b) { return a.chegada_posicao - b.chegada_posicao; })
          .map(function (c) {
            return {
              carro_id: c.id, nome: c.nome, tipo: c.tipo, colocacao: c.chegada_posicao,
              pontos: c.pontos, posicao: c.posicao, motor: c.motor.length,
              derrapagens: c.derrapagens, cor: c.cor, forma: c.forma, numero: c.numero
            };
          })
      };
    }
    return estado;
  }

  return {
    ErroJogo: ErroJogo,
    criarPartida: criarPartida,
    iniciarCorrida: iniciarCorrida,
    jogarTurnoHumano: jogarTurnoHumano,
    preverJogada: preverJogada,
    montarEstado: montarEstado,
    // expostos para o arquivo de testes (testes.html)
    escolherJogadaBot: escolherJogadaBot,
    avaliarOpcoesBot: avaliarOpcoesBot,
    simularJogada: simularJogada,
    opcoesDeMarcha: opcoesDeMarcha,
    pistaClassica: pistaClassica,
    curvasValidas: curvasValidas,
    carroDaVez: carroDaVez
  };
})();
