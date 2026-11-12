<?php
/* GET /api/estado.php?partida_id=12
   Saída: estado completo da partida (mesmo formato de iniciar_partida) */

require_once __DIR__ . '/../src/Api.php';

Api::executar(function () {
    Api::exigirMetodo('GET');
    return Jogo::estado($_GET['partida_id'] ?? null);
});
