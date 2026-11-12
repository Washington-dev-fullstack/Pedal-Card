<?php
/* =====================================================================
   Db.php — Conexão com o MySQL/MariaDB via PDO
   ---------------------------------------------------------------------
   - Uma conexão só por requisição (criada na primeira vez que alguém pede).
   - ERRMODE_EXCEPTION: qualquer erro de SQL vira exceção (nada falha calado).
   - EMULATE_PREPARES = false: os "?" são enviados ao MySQL como prepared
     statements de verdade (proteção contra SQL injection) e os números
     voltam como números, não como texto.
   ===================================================================== */

require_once __DIR__ . '/config.php';

class Db
{
    private static ?PDO $pdo = null;

    public static function conexao(): PDO
    {
        if (self::$pdo === null) {
            $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORTA . ';dbname=' . DB_NOME . ';charset=utf8mb4';
            self::$pdo = new PDO($dsn, DB_USUARIO, DB_SENHA, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        }
        return self::$pdo;
    }

    // Executa $acao dentro de uma TRANSAÇÃO: ou tudo é gravado (commit), ou
    // nada é gravado (rollBack). Ex.: o turno do humano + o turno dos bots
    // ficam todos salvos, ou nenhum, se algo der errado no meio.
    // Se já houver uma transação aberta (o script de testes abre uma para
    // desfazer tudo no final), só executa a ação dentro dela.
    public static function transacao(callable $acao)
    {
        $pdo = self::conexao();
        if ($pdo->inTransaction()) return $acao($pdo);

        $pdo->beginTransaction();
        try {
            $resultado = $acao($pdo);
            $pdo->commit();
            return $resultado;
        } catch (Throwable $erro) {
            $pdo->rollBack();
            throw $erro;
        }
    }
}
