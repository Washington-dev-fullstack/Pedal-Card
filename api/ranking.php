<?php
/* GET /api/ranking.php?limite=10
   Saída: { "ok": true, "jogadores": [{ nome, corridas, vitorias, melhor_rodada }] }
   Consulta agregada (GROUP BY) da seção 7: vitórias e corrida mais rápida. */

require_once __DIR__ . '/../src/Api.php';

Api::executar(function () {
    Api::exigirMetodo('GET');
    return Jogo::ranking($_GET['limite'] ?? 10);
});
