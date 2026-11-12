<?php
/* =====================================================================
   Jogo.php — O que cada endpoint faz, passo a passo
   ---------------------------------------------------------------------
   Liga as três peças:
     Repositorio (banco)  ->  Regras/Bots (lógica)  ->  Repositorio (banco)
   Toda ação que grava acontece dentro de UMA transação: ou a jogada do
   humano e as dos bots são salvas juntas, ou nada é salvo.
   ===================================================================== */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ErroJogo.php';
require_once __DIR__ . '/Modelos.php';
require_once __DIR__ . '/Regras.php';
require_once __DIR__ . '/Bots.php';
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Repositorio.php';

class Jogo
{
    // partida_id vem do navegador: só aceitamos inteiros positivos.
    private static function idDaPartida($valor): int
    {
        $id = Regras::inteiro($valor);
        if ($id === null || $id < 1) {
            throw new ErroJogo('PARTIDA_NAO_ENCONTRADA', 'Partida não encontrada.');
        }
        return $id;
    }

    // POST /api/iniciar_partida.php  { nome_jogador, num_bots, dificuldade }
    public static function iniciarPartida(array $dados): array
    {
        // 1. Valida os dados e monta a partida em memória (lança ErroJogo se inválido)
        $partida = Regras::criarPartida($dados);

        return Db::transacao(function (PDO $pdo) use ($partida) {
            $repo = new Repositorio($pdo);
            // 2. Jogador e pista (a pista do banco tem prioridade sobre a gerada)
            $jogadorId = $repo->buscarOuCriarJogador(Regras::humano($partida)->nome);
            $partida->pista = $repo->obterPista($partida->pista);
            Bots::prepararTabela($partida->pista);   // "cérebro" dos bots para esta pista (ver Bots.php)
            // 3. Grava partida, carros e cartas (agora tudo tem id de verdade)
            $repo->inserirPartida($partida, $jogadorId);
            // 4. Bots que largaram na frente já fazem a 1ª jogada
            $eventos = Regras::iniciarCorrida($partida);
            $repo->salvarPartida($partida);

            $resposta = Regras::montarEstado($partida);
            $resposta['eventos'] = $eventos;
            return $resposta;
        });
    }

    // GET /api/estado.php?partida_id=
    public static function estado($partidaId): array
    {
        $repo = new Repositorio(Db::conexao());
        return Regras::montarEstado($repo->carregarPartida(self::idDaPartida($partidaId)));
    }

    // POST /api/prever_jogada.php  { partida_id, marcha, cartas[] }
    // Só simula: não grava nada no banco.
    public static function preverJogada(array $dados): array
    {
        $repo = new Repositorio(Db::conexao());
        $partida = $repo->carregarPartida(self::idDaPartida($dados['partida_id'] ?? null));
        return Regras::preverJogada($partida, $dados['marcha'] ?? null, $dados['cartas'] ?? null);
    }

    // POST /api/jogar_turno.php  { partida_id, marcha, cartas[] }
    public static function jogarTurno(array $dados): array
    {
        $partidaId = self::idDaPartida($dados['partida_id'] ?? null);
        return Db::transacao(function (PDO $pdo) use ($partidaId, $dados) {
            $repo = new Repositorio($pdo);
            $partida = $repo->carregarPartida($partidaId, true);   // trava a partida (FOR UPDATE)
            $eventos = Regras::jogarTurnoHumano($partida, $dados['marcha'] ?? null, $dados['cartas'] ?? null);
            $repo->salvarPartida($partida);
            return ['ok' => true, 'eventos' => $eventos, 'estado' => Regras::montarEstado($partida)];
        });
    }

    // GET /api/ranking.php?limite=
    public static function ranking($limite): array
    {
        $limite = Regras::inteiro($limite);
        if ($limite === null || $limite < 1 || $limite > 100) $limite = 10;
        $repo = new Repositorio(Db::conexao());
        return ['ok' => true, 'jogadores' => $repo->ranking($limite)];
    }

    // GET /api/historico.php?partida_id=
    public static function historico($partidaId): array
    {
        $repo = new Repositorio(Db::conexao());
        return ['ok' => true, 'jogadas' => $repo->historico(self::idDaPartida($partidaId))];
    }
}
