<?php
/* =====================================================================
   Repositorio.php — TODO o SQL do jogo fica aqui
   ---------------------------------------------------------------------
   Lê o banco e monta os objetos de Modelos.php; depois grava de volta.
   Todas as consultas usam prepared statements (os "?"): o valor nunca é
   colado dentro do texto do SQL, então não há SQL injection.

   Tabelas (ver sql/pedal_card.sql):
     jogadores 1:N carros · pistas 1:N pista_curvas · pistas 1:N partidas
     partidas 1:N carros · carros 1:N cartas · partidas/carros 1:N jogadas
   ===================================================================== */

require_once __DIR__ . '/ErroJogo.php';
require_once __DIR__ . '/Modelos.php';

class Repositorio
{
    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    /* ---------- Jogadores ---------- */

    // Procura o jogador pelo nome (sem diferenciar maiúsculas); se não existir, cria.
    public function buscarOuCriarJogador(string $nome): int
    {
        $consulta = $this->pdo->prepare('SELECT id FROM jogadores WHERE nome = ?');
        $consulta->execute([$nome]);
        $id = $consulta->fetchColumn();
        if ($id !== false) return (int) $id;

        $this->pdo->prepare('INSERT INTO jogadores (nome) VALUES (?)')->execute([$nome]);
        return (int) $this->pdo->lastInsertId();
    }

    /* ---------- Pistas ---------- */

    // Procura a pista pela semente; se ainda não existir, grava a pista gerada.
    // O banco é a fonte da verdade: se alguém mudar o limite de uma curva no
    // phpMyAdmin, as próximas partidas nessa pista já usam o valor novo.
    public function obterPista(array $pistaGerada): array
    {
        $consulta = $this->pdo->prepare('SELECT id, nome, semente, total_casas FROM pistas WHERE semente = ?');
        $consulta->execute([$pistaGerada['semente']]);
        $linha = $consulta->fetch();
        if ($linha) {
            return [
                'id' => (int) $linha['id'],
                'nome' => $linha['nome'],
                'semente' => (int) $linha['semente'],
                'total_casas' => (int) $linha['total_casas'],
                'curvas' => $this->curvasDaPista((int) $linha['id']),
            ];
        }

        $this->pdo->prepare('INSERT INTO pistas (nome, semente, total_casas) VALUES (?, ?, ?)')
            ->execute([$pistaGerada['nome'], $pistaGerada['semente'], $pistaGerada['total_casas']]);
        $pistaId = (int) $this->pdo->lastInsertId();
        $inserirCurva = $this->pdo->prepare('INSERT INTO pista_curvas (pista_id, casa, limite) VALUES (?, ?, ?)');
        foreach ($pistaGerada['curvas'] as $curva) {
            $inserirCurva->execute([$pistaId, $curva['casa'], $curva['limite']]);
        }
        $pistaGerada['id'] = $pistaId;
        return $pistaGerada;
    }

    private function curvasDaPista(int $pistaId): array
    {
        $consulta = $this->pdo->prepare('SELECT casa, limite FROM pista_curvas WHERE pista_id = ? ORDER BY casa');
        $consulta->execute([$pistaId]);
        $curvas = [];
        foreach ($consulta->fetchAll() as $linha) {
            $curvas[] = ['casa' => (int) $linha['casa'], 'limite' => (int) $linha['limite']];
        }
        return $curvas;
    }

    /* ---------- Partida: criar ---------- */

    // Grava uma partida recém-criada (Regras::criarPartida) e troca os ids
    // provisórios da memória pelos ids de verdade do banco (AUTO_INCREMENT).
    public function inserirPartida(Partida $partida, int $jogadorId): void
    {
        $this->pdo->prepare(
            'INSERT INTO partidas (pista_id, semente, gerador, status, rodada, vez) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([
            $partida->pista['id'], $partida->semente, $partida->sorteio->estado,
            $partida->status, $partida->rodada, $partida->vez,
        ]);
        $partida->id = (int) $this->pdo->lastInsertId();

        $inserirCarro = $this->pdo->prepare(
            'INSERT INTO carros (partida_id, jogador_id, tipo, nome, dificuldade, cor, forma, numero,
                                 posicao, marcha, ordem_turno, derrapagens, chegada_posicao, pontos)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $inserirCarta = $this->pdo->prepare(
            'INSERT INTO cartas (carro_id, tipo, valor, zona, ordem) VALUES (?, ?, ?, ?, ?)'
        );

        foreach ($partida->carros as $carro) {
            $carro->jogador_id = $carro->tipo === 'humano' ? $jogadorId : null;
            $inserirCarro->execute([
                $partida->id, $carro->jogador_id, $carro->tipo, $carro->nome, $carro->dificuldade,
                $carro->cor, $carro->forma, $carro->numero, $carro->posicao, $carro->marcha,
                $carro->ordem, $carro->derrapagens, $carro->chegada_posicao, $carro->pontos,
            ]);
            $carro->id = (int) $this->pdo->lastInsertId();

            // Cada carta é gravada com a zona (pilha) e a ordem dentro dela
            foreach (['compra', 'mao', 'descarte', 'motor'] as $zona) {
                foreach ($carro->$zona as $ordem => $carta) {
                    $inserirCarta->execute([$carro->id, $carta->tipo, $carta->valor, $zona, $ordem]);
                    $carta->id = (int) $this->pdo->lastInsertId();
                    $carta->zonaGravada = $zona;
                    $carta->ordemGravada = $ordem;
                }
            }
        }
    }

    /* ---------- Partida: carregar ---------- */

    // Monta a partida inteira a partir do banco.
    // $bloquear = true usa SELECT ... FOR UPDATE: a linha da partida fica
    // travada até o fim da transação, então dois cliques em "Acelerar" ao
    // mesmo tempo não conseguem jogar o mesmo turno duas vezes.
    public function carregarPartida(int $partidaId, bool $bloquear = false): Partida
    {
        $consulta = $this->pdo->prepare(
            'SELECT p.*, pi.nome AS pista_nome, pi.semente AS pista_semente, pi.total_casas
               FROM partidas p
               JOIN pistas pi ON pi.id = p.pista_id
              WHERE p.id = ?' . ($bloquear ? ' FOR UPDATE' : '')
        );
        $consulta->execute([$partidaId]);
        $linha = $consulta->fetch();
        if (!$linha) {
            throw new ErroJogo('PARTIDA_NAO_ENCONTRADA', 'Partida não encontrada.');
        }

        $partida = new Partida((int) $linha['semente']);
        $partida->id = (int) $linha['id'];
        $partida->sorteio->estado = (int) $linha['gerador'];  // o sorteio continua de onde parou
        $partida->status = $linha['status'];
        $partida->rodada = (int) $linha['rodada'];
        $partida->vez = (int) $linha['vez'];
        $partida->vencedor_carro_id = $linha['vencedor_carro_id'] === null ? null : (int) $linha['vencedor_carro_id'];
        $partida->pista = [
            'id' => (int) $linha['pista_id'],
            'nome' => $linha['pista_nome'],
            'semente' => (int) $linha['pista_semente'],
            'total_casas' => (int) $linha['total_casas'],
            'curvas' => $this->curvasDaPista((int) $linha['pista_id']),
        ];

        // Carros (em ordem de id, como na memória)
        $consulta = $this->pdo->prepare('SELECT * FROM carros WHERE partida_id = ? ORDER BY id');
        $consulta->execute([$partida->id]);
        $porId = [];
        foreach ($consulta->fetchAll() as $c) {
            $carro = new Carro();
            $carro->id = (int) $c['id'];
            $carro->jogador_id = $c['jogador_id'] === null ? null : (int) $c['jogador_id'];
            $carro->nome = $c['nome'];
            $carro->tipo = $c['tipo'];
            $carro->dificuldade = $c['dificuldade'];
            $carro->cor = $c['cor'];
            $carro->forma = $c['forma'];
            $carro->numero = (int) $c['numero'];
            $carro->posicao = (int) $c['posicao'];
            $carro->marcha = (int) $c['marcha'];
            $carro->ordem = (int) $c['ordem_turno'];
            $carro->derrapagens = (int) $c['derrapagens'];
            $carro->chegada_posicao = $c['chegada_posicao'] === null ? null : (int) $c['chegada_posicao'];
            $carro->pontos = (int) $c['pontos'];
            $partida->carros[] = $carro;
            $porId[$carro->id] = $carro;
        }

        // Cartas: cada uma volta para a pilha (zona) dela, na mesma ordem.
        // A zona tem o mesmo nome da pilha no objeto Carro (compra, mao, descarte, motor).
        $consulta = $this->pdo->prepare(
            'SELECT ca.id, ca.carro_id, ca.tipo, ca.valor, ca.zona, ca.ordem
               FROM cartas ca
               JOIN carros c ON c.id = ca.carro_id
              WHERE c.partida_id = ?
              ORDER BY ca.carro_id, ca.zona, ca.ordem'
        );
        $consulta->execute([$partida->id]);
        foreach ($consulta->fetchAll() as $c) {
            $carta = new Carta((int) $c['id'], $c['tipo'], (int) $c['valor']);
            $carta->zonaGravada = $c['zona'];
            $carta->ordemGravada = (int) $c['ordem'];
            $zona = $c['zona'];
            $porId[(int) $c['carro_id']]->{$zona}[] = $carta;
        }

        return $partida;
    }

    /* ---------- Partida: gravar ---------- */

    // Grava tudo o que o motor de regras mudou: partida, carros, cartas e
    // as jogadas novas. Chamado dentro de uma transação (Db::transacao).
    public function salvarPartida(Partida $partida): void
    {
        $finalizada = $partida->status === 'finalizada';
        $this->pdo->prepare(
            'UPDATE partidas
                SET gerador = ?, status = ?, rodada = ?, vez = ?, vencedor_carro_id = ?,
                    finalizada_em = IF(?, COALESCE(finalizada_em, NOW()), NULL)
              WHERE id = ?'
        )->execute([
            $partida->sorteio->estado, $partida->status, $partida->rodada, $partida->vez,
            $partida->vencedor_carro_id, $finalizada ? 1 : 0, $partida->id,
        ]);

        $atualizarCarro = $this->pdo->prepare(
            'UPDATE carros
                SET posicao = ?, marcha = ?, ordem_turno = ?, derrapagens = ?, chegada_posicao = ?, pontos = ?
              WHERE id = ?'
        );
        $atualizarCarta = $this->pdo->prepare('UPDATE cartas SET zona = ?, ordem = ? WHERE id = ?');

        foreach ($partida->carros as $carro) {
            $atualizarCarro->execute([
                $carro->posicao, $carro->marcha, $carro->ordem, $carro->derrapagens,
                $carro->chegada_posicao, $carro->pontos, $carro->id,
            ]);
            // Só grava as cartas que mudaram de pilha ou de posição
            foreach (['compra', 'mao', 'descarte', 'motor'] as $zona) {
                foreach ($carro->$zona as $ordem => $carta) {
                    if ($carta->zonaGravada === $zona && $carta->ordemGravada === $ordem) continue;
                    $atualizarCarta->execute([$zona, $ordem, $carta->id]);
                    $carta->zonaGravada = $zona;
                    $carta->ordemGravada = $ordem;
                }
            }
        }

        $inserirJogada = $this->pdo->prepare(
            'INSERT INTO jogadas (partida_id, carro_id, rodada, marcha, velocidade, posicao_inicial,
                                  posicao_final, calor_pago, derrapou)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($partida->jogadas as $j) {
            $inserirJogada->execute([
                $partida->id, $j['carro_id'], $j['rodada'], $j['marcha'], $j['velocidade'],
                $j['posicao_inicial'], $j['posicao_final'], $j['calor_pago'], $j['derrapou'] ? 1 : 0,
            ]);
        }
        $partida->jogadas = [];  // já gravadas
    }

    /* ---------- Consultas para a interface ---------- */

    // Consulta agregada obrigatória (seção 7): vitórias e melhor corrida por jogador.
    public function ranking(int $limite): array
    {
        $consulta = $this->pdo->prepare(
            'SELECT j.nome,
                    COUNT(*)                                             AS corridas,
                    SUM(c.chegada_posicao = 1)                           AS vitorias,
                    MIN(CASE WHEN c.chegada_posicao = 1 THEN p.rodada END) AS melhor_rodada
               FROM carros c
               JOIN jogadores j ON j.id = c.jogador_id
               JOIN partidas p  ON p.id = c.partida_id AND p.status = \'finalizada\'
              WHERE c.tipo = \'humano\'
              GROUP BY j.id, j.nome
              ORDER BY vitorias DESC, melhor_rodada ASC
              LIMIT ?'
        );
        $consulta->bindValue(1, $limite, PDO::PARAM_INT);
        $consulta->execute();
        $jogadores = [];
        foreach ($consulta->fetchAll() as $linha) {
            $jogadores[] = [
                'nome' => $linha['nome'],
                'corridas' => (int) $linha['corridas'],
                'vitorias' => (int) $linha['vitorias'],
                'melhor_rodada' => $linha['melhor_rodada'] === null ? null : (int) $linha['melhor_rodada'],
            ];
        }
        return $jogadores;
    }

    // Histórico de jogadas de uma partida, na ordem em que aconteceram.
    public function historico(int $partidaId): array
    {
        $existe = $this->pdo->prepare('SELECT 1 FROM partidas WHERE id = ?');
        $existe->execute([$partidaId]);
        if (!$existe->fetchColumn()) {
            throw new ErroJogo('PARTIDA_NAO_ENCONTRADA', 'Partida não encontrada.');
        }

        $consulta = $this->pdo->prepare(
            'SELECT j.rodada, j.carro_id, c.nome AS carro_nome, c.tipo, j.marcha, j.velocidade,
                    j.posicao_inicial, j.posicao_final, j.calor_pago, j.derrapou
               FROM jogadas j
               JOIN carros c ON c.id = j.carro_id
              WHERE j.partida_id = ?
              ORDER BY j.id'
        );
        $consulta->execute([$partidaId]);
        $jogadas = [];
        foreach ($consulta->fetchAll() as $linha) {
            $jogadas[] = [
                'rodada' => (int) $linha['rodada'],
                'carro_id' => (int) $linha['carro_id'],
                'carro_nome' => $linha['carro_nome'],
                'tipo' => $linha['tipo'],
                'marcha' => (int) $linha['marcha'],
                'velocidade' => (int) $linha['velocidade'],
                'posicao_inicial' => (int) $linha['posicao_inicial'],
                'posicao_final' => (int) $linha['posicao_final'],
                'calor_pago' => (int) $linha['calor_pago'],
                'derrapou' => (bool) $linha['derrapou'],
            ];
        }
        return $jogadas;
    }
}
