<?php
/* =====================================================================
   ErroJogo.php — Erro "esperado" do jogo (jogada inválida, partida
   inexistente...). Vira a resposta {"ok":false,"erro":{codigo,mensagem}}.
   A mensagem já vai em português, pronta para o toast da interface.
   ===================================================================== */

class ErroJogo extends Exception
{
    public string $codigo;

    public function __construct(string $codigo, string $mensagem)
    {
        parent::__construct($mensagem);
        $this->codigo = $codigo;
    }

    // Código HTTP de cada erro (a interface lê o JSON de qualquer jeito,
    // mas o código certo ajuda a depurar na aba Rede do navegador).
    public function statusHttp(): int
    {
        switch ($this->codigo) {
            case 'PARTIDA_NAO_ENCONTRADA':
                return 404;
            case 'NAO_E_SEU_TURNO':
            case 'PARTIDA_ENCERRADA':
                return 409;  // conflito com o estado atual da partida
            case 'METODO_INVALIDO':
                return 405;
            case 'ERRO_BANCO':
            case 'ERRO_INTERNO':
                return 500;
            default:
                return 400;  // dados inválidos enviados pelo cliente
        }
    }
}
