/* =====================================================================
   mock-api.js — API simulada (Fase 1)
   ---------------------------------------------------------------------
   Implementa EXATAMENTE o mesmo contrato JSON dos endpoints PHP da
   seção 6 do briefing, só que dentro do navegador:
     - as regras vêm do mock-engine.js;
     - os dados ficam em memória (um "banco falso" com as mesmas
       tabelas que teremos no MySQL);
     - cada resposta demora 300 a 600 ms, como uma rede de verdade.
   Recarregar a página apaga tudo: o banco de verdade chega na Fase 2.
   ===================================================================== */

var MockApi = (function () {
  'use strict';

  // Partidas em andamento (o "estado vivo" de cada corrida)
  var partidas = {};
  var proximoIdPartida = 1;

  // "Banco falso": imita as tabelas jogadores, partidas e carros.
  // Já vem com alguns dados de exemplo para o ranking não ficar vazio.
  var banco = {
    jogadores: [
      { id: 1, nome: 'Ana Turbo' },
      { id: 2, nome: 'Rafa Nitro' },
      { id: 3, nome: 'Lia Drift' }
    ],
    partidas: [
      { id: 901, status: 'finalizada', rodada: 8 },
      { id: 902, status: 'finalizada', rodada: 9 },
      { id: 903, status: 'finalizada', rodada: 10 },
      { id: 904, status: 'finalizada', rodada: 9 },
      { id: 905, status: 'finalizada', rodada: 11 }
    ],
    carros: [
      { partida_id: 901, jogador_id: 1, tipo: 'humano', chegada_posicao: 1 },
      { partida_id: 902, jogador_id: 1, tipo: 'humano', chegada_posicao: 1 },
      { partida_id: 903, jogador_id: 2, tipo: 'humano', chegada_posicao: 1 },
      { partida_id: 904, jogador_id: 2, tipo: 'humano', chegada_posicao: 3 },
      { partida_id: 905, jogador_id: 3, tipo: 'humano', chegada_posicao: 2 }
    ]
  };

  /* ---------- Utilitários ---------- */

  function atraso() {
    return CONFIG.ATRASO_MIN + Math.random() * (CONFIG.ATRASO_MAX - CONFIG.ATRASO_MIN);
  }

  // Cópia profunda: a interface recebe uma cópia, como se viesse pela rede.
  function copiar(dados) {
    return JSON.parse(JSON.stringify(dados));
  }

  // Executa a função depois do atraso e transforma erros em JSON de erro.
  function responder(funcao) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        try {
          resolve(copiar(funcao()));
        } catch (erro) {
          if (erro instanceof MotorRegras.ErroJogo) {
            resolve({ ok: false, erro: { codigo: erro.codigo, mensagem: erro.mensagem } });
          } else {
            console.error(erro);
            resolve({ ok: false, erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro inesperado no servidor. Tente novamente.' } });
          }
        }
      }, atraso());
    });
  }

  function buscarPartida(partidaId) {
    var partida = partidas[Number(partidaId)];
    if (!partida) {
      throw new MotorRegras.ErroJogo('PARTIDA_NAO_ENCONTRADA', 'Partida não encontrada.');
    }
    return partida;
  }

  // Procura o jogador pelo nome (sem diferenciar maiúsculas); se não existir, cria.
  function buscarOuCriarJogador(nome) {
    var existente = banco.jogadores.find(function (j) {
      return j.nome.toLowerCase() === nome.toLowerCase();
    });
    if (existente) return existente;
    var novo = { id: banco.jogadores.length + 1, nome: nome };
    banco.jogadores.push(novo);
    return novo;
  }

  // Quando a corrida termina, "grava" o resultado no banco falso.
  function registrarResultado(partida) {
    var registro = banco.partidas.find(function (p) { return p.id === partida.id; });
    registro.status = 'finalizada';
    registro.rodada = partida.rodada;
    var humano = partida.carros.find(function (c) { return c.tipo === 'humano'; });
    banco.carros.push({
      partida_id: partida.id,
      jogador_id: partida.jogador_id,
      tipo: 'humano',
      chegada_posicao: humano.chegada_posicao
    });
  }

  /* ---------- Endpoints (mesmos nomes e formatos da seção 6) ---------- */

  // POST /api/iniciar_partida.php  { nome_jogador, num_bots, dificuldade }
  function iniciarPartida(dados) {
    return responder(function () {
      var id = proximoIdPartida++;
      var partida = MotorRegras.criarPartida(id, dados);
      var jogador = buscarOuCriarJogador(partida.carros[0].nome);
      partida.jogador_id = jogador.id;
      banco.partidas.push({ id: id, status: 'em_andamento', rodada: 1 });
      partidas[id] = partida;

      // Bots que largaram na frente do humano já jogam a 1ª rodada
      var eventos = MotorRegras.iniciarCorrida(partida);
      var resposta = MotorRegras.montarEstado(partida);
      resposta.eventos = eventos;
      return resposta;
    });
  }

  // GET /api/estado.php?partida_id=
  function estado(dados) {
    return responder(function () {
      return MotorRegras.montarEstado(buscarPartida(dados.partida_id));
    });
  }

  // POST /api/prever_jogada.php  { partida_id, marcha, cartas[] }
  function preverJogada(dados) {
    return responder(function () {
      var partida = buscarPartida(dados.partida_id);
      return MotorRegras.preverJogada(partida, dados.marcha, dados.cartas);
    });
  }

  // POST /api/jogar_turno.php  { partida_id, marcha, cartas[] }
  function jogarTurno(dados) {
    return responder(function () {
      var partida = buscarPartida(dados.partida_id);
      var eventos = MotorRegras.jogarTurnoHumano(partida, dados.marcha, dados.cartas);
      if (partida.status === 'finalizada') registrarResultado(partida);
      return { ok: true, eventos: eventos, estado: MotorRegras.montarEstado(partida) };
    });
  }

  // GET /api/ranking.php?limite=
  // Faz em JavaScript o mesmo que a consulta SQL da seção 7:
  // agrupa por jogador, conta corridas e vitórias, pega a melhor rodada.
  function ranking(dados) {
    return responder(function () {
      var limite = Number(dados && dados.limite) || 10;
      var porJogador = {};

      banco.carros.forEach(function (carro) {
        var partida = banco.partidas.find(function (p) { return p.id === carro.partida_id; });
        if (carro.tipo !== 'humano' || !partida || partida.status !== 'finalizada') return;

        var jogador = banco.jogadores.find(function (j) { return j.id === carro.jogador_id; });
        if (!porJogador[jogador.id]) {
          porJogador[jogador.id] = { nome: jogador.nome, corridas: 0, vitorias: 0, melhor_rodada: null };
        }
        var linha = porJogador[jogador.id];
        linha.corridas++;
        if (carro.chegada_posicao === 1) {
          linha.vitorias++;
          if (linha.melhor_rodada === null || partida.rodada < linha.melhor_rodada) {
            linha.melhor_rodada = partida.rodada;
          }
        }
      });

      var lista = Object.keys(porJogador).map(function (k) { return porJogador[k]; });
      lista.sort(function (a, b) {
        if (b.vitorias !== a.vitorias) return b.vitorias - a.vitorias;
        return (a.melhor_rodada || 999) - (b.melhor_rodada || 999);
      });
      return { ok: true, jogadores: lista.slice(0, limite) };
    });
  }

  // GET /api/historico.php?partida_id=
  function historico(dados) {
    return responder(function () {
      var partida = buscarPartida(dados.partida_id);
      return {
        ok: true,
        jogadas: partida.jogadas.map(function (j) {
          var carro = partida.carros.find(function (c) { return c.id === j.carro_id; });
          return {
            rodada: j.rodada, carro_id: j.carro_id, carro_nome: carro.nome, tipo: carro.tipo,
            marcha: j.marcha, velocidade: j.velocidade, posicao_inicial: j.posicao_inicial,
            posicao_final: j.posicao_final, calor_pago: j.calor_pago, derrapou: j.derrapou
          };
        })
      };
    });
  }

  return {
    iniciarPartida: iniciarPartida,
    estado: estado,
    preverJogada: preverJogada,
    jogarTurno: jogarTurno,
    ranking: ranking,
    historico: historico
  };
})();
