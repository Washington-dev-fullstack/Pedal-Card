<?php
/* GET /api/historico.php?partida_id=12
   Saída: { "ok": true, "jogadas": [{ rodada, carro_id, carro_nome, tipo, marcha, velocidade,
                                      posicao_inicial, posicao_final, calor_pago, derrapou }] } */

require_once __DIR__ . '/../src/Api.php';

Api::executar(function () {
    Api::exigirMetodo('GET');
    return Jogo::historico($_GET['partida_id'] ?? null);
});
