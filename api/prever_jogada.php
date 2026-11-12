<?php
/* POST /api/prever_jogada.php
   Entrada: { "partida_id": 12, "marcha": 3, "cartas": [101, 104, 107] }
   Saída:   velocidade, destino, calor_previsto, derrapa... (simula, NÃO grava nada) */

require_once __DIR__ . '/../src/Api.php';

Api::executar(function () {
    Api::exigirMetodo('POST');
    return Jogo::preverJogada(Api::lerJson());
});
