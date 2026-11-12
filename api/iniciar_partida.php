<?php
/* POST /api/iniciar_partida.php
   Entrada: { "nome_jogador": "Ana", "num_bots": 2, "dificuldade": "medio" }
   Saída:   estado completo da partida + "eventos" (jogadas dos bots que largaram na frente) */

require_once __DIR__ . '/../src/Api.php';

Api::executar(function () {
    Api::exigirMetodo('POST');
    return Jogo::iniciarPartida(Api::lerJson());
});
