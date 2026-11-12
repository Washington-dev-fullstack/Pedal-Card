<?php
/* =====================================================================
   Api.php — Base comum de todos os endpoints da pasta /api
   ---------------------------------------------------------------------
   Garante o contrato da seção 6: a resposta é SEMPRE um JSON com "ok".
     sucesso: {"ok": true, ...}
     erro:    {"ok": false, "erro": {"codigo": "...", "mensagem": "..."}}
   Nenhum erro do PHP aparece como HTML na tela (isso quebraria o JSON):
   avisos viram exceção e tudo cai num dos "catch" de Api::executar().
   ===================================================================== */

require_once __DIR__ . '/Jogo.php';

// Erros do PHP não são impressos na resposta; vão para o log do Apache.
ini_set('display_errors', '0');
error_reporting(E_ALL);

// Qualquer aviso (warning/notice) vira exceção: melhor parar do que seguir com dado errado.
// (Avisos silenciados de propósito com "@", como no cache dos bots, são ignorados.)
set_error_handler(function (int $nivel, string $mensagem, string $arquivo, int $linha) {
    if (!(error_reporting() & $nivel)) return false;
    throw new ErrorException($mensagem, 0, $nivel, $arquivo, $linha);
});

// Último recurso: se o PHP morrer com um erro fatal, ainda responde em JSON.
register_shutdown_function(function () {
    $erro = error_get_last();
    if ($erro !== null && in_array($erro['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => false, 'erro' => [
            'codigo' => 'ERRO_INTERNO', 'mensagem' => 'Erro inesperado no servidor. Tente novamente.',
        ]], JSON_UNESCAPED_UNICODE);
    }
});

class Api
{
    // Envia a resposta JSON e encerra.
    public static function responder(array $dados, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');   // estado do jogo nunca vem do cache
        echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public static function exigirMetodo(string $metodo): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== $metodo) {
            throw new ErroJogo('METODO_INVALIDO', 'Esta rota só aceita o método ' . $metodo . '.');
        }
    }

    // Lê o corpo da requisição POST. O api.js manda JSON; um formulário
    // comum (application/x-www-form-urlencoded) também é aceito.
    public static function lerJson(): array
    {
        $corpo = file_get_contents('php://input');
        if ($corpo === false || trim($corpo) === '') return $_POST;
        $dados = json_decode($corpo, true);
        if (!is_array($dados)) {
            throw new ErroJogo('JSON_INVALIDO', 'Os dados enviados não estão em um formato JSON válido.');
        }
        return $dados;
    }

    // Executa a ação do endpoint e transforma qualquer erro em JSON de erro.
    public static function executar(callable $acao): void
    {
        try {
            self::responder($acao());
        } catch (ErroJogo $erro) {
            // Erro de regra/validação: a mensagem é para o jogador
            self::responder(['ok' => false, 'erro' => [
                'codigo' => $erro->codigo, 'mensagem' => $erro->getMessage(),
            ]], $erro->statusHttp());
        } catch (PDOException $erro) {
            // Problema no banco: detalhe técnico vai para o log, não para a tela
            error_log('[Pedal Card] Banco: ' . $erro->getMessage());
            self::responder(['ok' => false, 'erro' => [
                'codigo' => 'ERRO_BANCO',
                'mensagem' => 'Não foi possível acessar o banco de dados. Confira se o MySQL do XAMPP está ligado e se o arquivo sql/pedal_card.sql foi importado.',
            ]], 500);
        } catch (Throwable $erro) {
            error_log('[Pedal Card] ' . get_class($erro) . ': ' . $erro->getMessage() . ' em ' . $erro->getFile() . ':' . $erro->getLine());
            self::responder(['ok' => false, 'erro' => [
                'codigo' => 'ERRO_INTERNO', 'mensagem' => 'Erro inesperado no servidor. Tente novamente.',
            ]], 500);
        }
    }
}
