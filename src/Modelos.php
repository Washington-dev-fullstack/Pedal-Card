<?php
/* =====================================================================
   Modelos.php — Os "objetos" do jogo em memória
   ---------------------------------------------------------------------
   Cada requisição faz: carregar a partida do banco para estes objetos
   (Repositorio.php) -> aplicar as regras (Regras.php) -> gravar de volta.
   Usamos classes (e não arrays) porque objetos são passados por
   referência: mover uma Carta da mão para o descarte move a MESMA carta,
   igual ao JavaScript do mock-engine.js.
   ===================================================================== */

require_once __DIR__ . '/Sorteio.php';

// Uma carta: tabela "cartas" (a zona é a pilha em que ela está).
class Carta
{
    public int $id;
    public string $tipo;   // 'velocidade' | 'calor'
    public int $valor;     // 1 a 4 (Calor vale 0)

    // Onde a carta está gravada no banco (o Repositorio só faz UPDATE nas
    // cartas que mudaram de pilha ou de posição desde a última gravação).
    public string $zonaGravada = '';
    public int $ordemGravada = -1;

    public function __construct(int $id, string $tipo, int $valor)
    {
        $this->id = $id;
        $this->tipo = $tipo;
        $this->valor = $valor;
    }

    public function ehCalor(): bool
    {
        return $this->tipo === 'calor';
    }

    public function ehVelocidade(): bool
    {
        return $this->tipo === 'velocidade';
    }

    // Formato do contrato JSON (seção 6)
    public function paraJson(): array
    {
        return ['id' => $this->id, 'tipo' => $this->tipo, 'valor' => $this->valor];
    }
}

// Um carro na corrida: tabela "carros" + as 4 pilhas de cartas dele.
class Carro
{
    public int $id = 0;
    public ?int $jogador_id = null;      // null para bot
    public string $nome = '';
    public string $tipo = 'bot';         // 'humano' | 'bot'
    public ?string $dificuldade = null;  // 'facil' | 'medio' | 'dificil' (só bots)
    public string $cor = '';
    public string $forma = '';
    public int $numero = 0;
    public int $posicao = 0;
    public int $marcha = 1;
    public int $derrapagens = 0;
    public ?int $chegada_posicao = null;
    public int $pontos = 0;
    public int $ordem = 0;               // ordem de jogada na rodada (1 = joga primeiro)

    // Pilhas de cartas. A última carta do array é o "topo" da pilha.
    public array $compra = [];
    public array $mao = [];
    public array $descarte = [];
    public array $motor = [];
}

// A partida inteira: tabela "partidas" + pista + carros.
class Partida
{
    public int $id = 0;
    public int $semente = 1;
    public Sorteio $sorteio;             // estado do sorteio (coluna partidas.gerador)
    public string $status = 'em_andamento';
    public int $rodada = 1;
    public int $vez = 1;                 // ordem do carro que joga agora (carros.ordem_turno)
    public ?int $vencedor_carro_id = null;

    // ['id' => ?, 'nome' => ..., 'semente' => ..., 'total_casas' => 48,
    //  'curvas' => [['casa' => 10, 'limite' => 5], ...]]
    public array $pista = [];

    /** @var Carro[] em ordem de id */
    public array $carros = [];

    // Jogadas feitas NESTA requisição (o Repositorio grava na tabela jogadas)
    public array $jogadas = [];

    // Numeração provisória das cartas novas (o banco troca pelos ids de verdade)
    public int $proximoIdCarta = 1;

    public function __construct(int $semente)
    {
        $this->semente = $semente;
        $this->sorteio = new Sorteio($semente);
    }
}
