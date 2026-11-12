/* =====================================================================
   api.js — Único ponto de contato da interface com o "servidor"
   ---------------------------------------------------------------------
   A interface chama SÓ estas funções. Elas decidem se falam com a API
   simulada (mock-api.js) ou com o PHP de verdade (fetch), conforme
   CONFIG.USE_MOCK. Assim, trocar de fase não muda nada na interface.

   Todas as funções devolvem uma Promise:
     - sucesso: resolve com a resposta (que tem ok: true)
     - erro de regra: rejeita com { rede: false, codigo, mensagem }
     - erro de rede:  rejeita com { rede: true, codigo, mensagem }
   ===================================================================== */

var Api = (function () {
  'use strict';

  // Faz a chamada HTTP de verdade para o back-end PHP (Fase 2).
  function chamarServidor(metodo, rota, dados) {
    var url = CONFIG.API_URL + rota;
    var opcoes = { method: metodo, headers: { 'Accept': 'application/json' } };

    if (metodo === 'GET') {
      var parametros = new URLSearchParams(dados || {}).toString();
      if (parametros) url += '?' + parametros;
    } else {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(dados || {});
    }

    return fetch(url, opcoes)
      .then(function (resposta) { return resposta.json(); })
      .catch(function () {
        throw { rede: true, codigo: 'FALHA_REDE', mensagem: 'Não foi possível falar com o servidor. Verifique a conexão.' };
      });
  }

  // Transforma { ok: false } em erro, para a interface usar try/catch.
  function tratar(promessa) {
    return promessa.then(function (resposta) {
      if (!resposta || !resposta.ok) {
        var erro = (resposta && resposta.erro) || {};
        throw {
          rede: false,
          codigo: erro.codigo || 'ERRO_DESCONHECIDO',
          mensagem: erro.mensagem || 'Algo deu errado. Tente novamente.'
        };
      }
      return resposta;
    });
  }

  function iniciarPartida(dados) {
    return tratar(CONFIG.USE_MOCK
      ? MockApi.iniciarPartida(dados)
      : chamarServidor('POST', 'iniciar_partida.php', dados));
  }

  function estado(partidaId) {
    return tratar(CONFIG.USE_MOCK
      ? MockApi.estado({ partida_id: partidaId })
      : chamarServidor('GET', 'estado.php', { partida_id: partidaId }));
  }

  function preverJogada(dados) {
    return tratar(CONFIG.USE_MOCK
      ? MockApi.preverJogada(dados)
      : chamarServidor('POST', 'prever_jogada.php', dados));
  }

  function jogarTurno(dados) {
    return tratar(CONFIG.USE_MOCK
      ? MockApi.jogarTurno(dados)
      : chamarServidor('POST', 'jogar_turno.php', dados));
  }

  function ranking(limite) {
    return tratar(CONFIG.USE_MOCK
      ? MockApi.ranking({ limite: limite })
      : chamarServidor('GET', 'ranking.php', { limite: limite }));
  }

  function historico(partidaId) {
    return tratar(CONFIG.USE_MOCK
      ? MockApi.historico({ partida_id: partidaId })
      : chamarServidor('GET', 'historico.php', { partida_id: partidaId }));
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
