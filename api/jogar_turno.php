<?php
/* POST /api/jogar_turno.php
   Entrada: { "partida_id": 12, "marcha": 3, "cartas": [101, 104, 107] }
   Saída:   { "ok": true, "eventos": [...], "estado": {...} }
   Valida e executa o turno do humano e, em seguida, os turnos dos bots. */

require_once __DIR__ . '/../src/Api.php';

Api::executar(function () {
    Api::exigirMetodo('POST');
    return Jogo::jogarTurno(Api::lerJson());
});
