<?php
/* =====================================================================
   Regras.php — Motor de regras do Pedal Card (seção 5 do briefing)
   ---------------------------------------------------------------------
   É a "tradução" do js/mock-engine.js para PHP, função por função e
   com os mesmos nomes, para o grupo comparar os dois lado a lado.
   Aqui não há SQL: o motor só mexe nos objetos de Modelos.php. Quem
   carrega e grava no banco é o Repositorio.php.

   O SERVIDOR É A AUTORIDADE: o navegador só envia a marcha e os ids
   das cartas. Posição, velocidade, Calor e curvas são sempre
   calculados aqui; nada disso é aceito vindo do cliente.
   ===================================================================== */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/ErroJogo.php';
require_once __DIR__ . '/Modelos.php';
require_once __DIR__ . '/Bots.php';

class Regras
{
    /* ---------- Utilitários ---------- */

    public static function ultimaCasa(Partida $partida): int
    {
        return $partida->pista['total_casas'] - 1;
    }

    public static function buscarCarro(Partida $partida, int $carroId): ?Carro
    {
        foreach ($partida->carros as $carro) {
            if ($carro->id === $carroId) return $carro;
        }
        return null;
    }

    public static function humano(Partida $partida): Carro
    {
        foreach ($partida->carros as $carro) {
            if ($carro->tipo === 'humano') return $carro;
        }
        throw new ErroJogo('ERRO_INTERNO', 'Partida sem piloto humano.');
    }

    // Converte 3, "3" ou 3.0 em 3. Qualquer outra coisa ("abc", [], null) vira null.
    // Tudo que chega do navegador passa por aqui antes de ser usado.
    public static function inteiro($valor): ?int
    {
        if (is_int($valor)) return $valor;
        if (is_float($valor) && is_finite($valor) && floor($valor) === $valor && abs($valor) <= 2147483647) {
            return (int) $valor;
        }
        if (is_string($valor) && preg_match('/^\s*-?\d{1,10}\s*$/', $valor)) return (int) $valor;
        return null;
    }

    // Curvas da pista em ordem de casa (sem mexer na pista original).
    public static function curvasEmOrdem(array $pista): array
    {
        $curvas = $pista['curvas'];
        usort($curvas, function ($a, $b) {
            return $a['casa'] <=> $b['casa'];
        });
        return $curvas;
    }

    public static function cartasDeVelocidade(array $pilha): array
    {
        return array_values(array_filter($pilha, function (Carta $carta) {
            return $carta->ehVelocidade();
        }));
    }

    private static function temCalor(array $pilha): bool
    {
        foreach ($pilha as $carta) {
            if ($carta->ehCalor()) return true;
        }
        return false;
    }

    private static function indiceDoCalor(array $pilha): int
    {
        foreach ($pilha as $i => $carta) {
            if ($carta->ehCalor()) return $i;
        }
        return -1;
    }

    // Move "quantidade" cartas do topo (fim do array) de uma pilha para outra.
    private static function moverCartas(array &$origem, array &$destino, int $quantidade): void
    {
        for ($i = 0; $i < $quantidade && count($origem) > 0; $i++) {
            $destino[] = array_pop($origem);
        }
    }

    /* ---------- Baralho ---------- */

    // Monta as 12 cartas de Velocidade, as 6 de Calor e compra a mão inicial.
    private static function prepararBaralho(Partida $partida, Carro $carro): void
    {
        $carro->compra = [];
        $carro->mao = [];
        $carro->descarte = [];
        $carro->motor = [];

        foreach (REGRAS['VALORES_VELOCIDADE'] as $valor) {
            for ($i = 0; $i < REGRAS['COPIAS_POR_VALOR']; $i++) {
                $carro->compra[] = new Carta($partida->proximoIdCarta++, 'velocidade', $valor);
            }
        }
        $carro->compra = $partida->sorteio->embaralhar($carro->compra);

        for ($i = 0; $i < REGRAS['CALOR_MOTOR']; $i++) {
            $carro->motor[] = new Carta($partida->proximoIdCarta++, 'calor', 0);
        }

        self::comprarAte($partida, $carro, REGRAS['TAMANHO_MAO']);
    }

    // Compra cartas até a mão ter "limite" cartas.
    // Se o baralho de compra acabar, o descarte é embaralhado e vira o novo baralho.
    private static function comprarAte(Partida $partida, Carro $carro, int $limite): array
    {
        $resultado = ['quantidade' => 0, 'reembaralhou' => false];
        while (count($carro->mao) < $limite) {
            if (count($carro->compra) === 0) {
                if (count($carro->descarte) === 0) break; // não há mais cartas em lugar nenhum
                $carro->compra = $partida->sorteio->embaralhar($carro->descarte);
                $carro->descarte = [];
                $resultado['reembaralhou'] = true;
            }
            $carro->mao[] = array_pop($carro->compra);
            $resultado['quantidade']++;
        }
        return $resultado;
    }

    /* ---------- Marchas ---------- */

    // Lista as 4 marchas dizendo se cada uma é permitida e quanto custa.
    // Subir/descer 1 = grátis; pular 2 = 1 Calor; pular 3 = proibido.
    public static function opcoesDeMarcha(Carro $carro): array
    {
        $opcoes = [];
        for ($m = REGRAS['MARCHA_MIN']; $m <= REGRAS['MARCHA_MAX']; $m++) {
            $diferenca = abs($m - $carro->marcha);
            $custo = $diferenca === 2 ? 1 : 0;
            $permitida = true;
            $motivo = '';
            if ($diferenca > 2) {
                $permitida = false;
                $motivo = 'Só dá para mudar até 2 marchas por turno.';
            } elseif ($custo > count($carro->motor)) {
                $permitida = false;
                $motivo = 'Pular 2 marchas custa 1 Calor, mas seu motor está vazio.';
            }
            $opcoes[] = [
                'marcha' => $m,
                'custo_calor' => $custo,
                'permitida' => $permitida,
                'motivo' => $motivo,
                'resfria' => $m === 1,
            ];
        }
        return $opcoes;
    }

    // Quantas cartas de Velocidade o carro precisa jogar nessa marcha.
    // Marcha N = N cartas; se não houver N na mão, joga as que tiver.
    public static function cartasNecessarias(Carro $carro, int $marcha): int
    {
        return min($marcha, count(self::cartasDeVelocidade($carro->mao)));
    }

    /* ---------- Validação da jogada ---------- */

    // Confere se a jogada é válida. Se não for, lança ErroJogo.
    // Devolve os objetos das cartas escolhidas.
    public static function validarJogada(Carro $carro, $marcha, $cartaIds): array
    {
        $marcha = self::inteiro($marcha);
        if ($marcha === null || $marcha < REGRAS['MARCHA_MIN'] || $marcha > REGRAS['MARCHA_MAX']) {
            throw new ErroJogo('MARCHA_INVALIDA',
                'Escolha uma marcha de ' . REGRAS['MARCHA_MIN'] . ' a ' . REGRAS['MARCHA_MAX'] . '.');
        }
        $opcao = self::opcoesDeMarcha($carro)[$marcha - REGRAS['MARCHA_MIN']];
        if (!$opcao['permitida']) {
            throw new ErroJogo('MARCHA_INVALIDA', $opcao['motivo']);
        }

        if (!is_array($cartaIds) || count($cartaIds) > 50) {
            throw new ErroJogo('CARTAS_INVALIDAS', 'Envie a lista de cartas escolhidas.');
        }
        $ids = array_map([self::class, 'inteiro'], array_values($cartaIds));
        if (in_array(null, $ids, true)) {
            throw new ErroJogo('CARTAS_INVALIDAS', 'Uma das cartas escolhidas não está na sua mão.');
        }
        if (count(array_unique($ids)) !== count($ids)) {
            throw new ErroJogo('CARTAS_INVALIDAS', 'A mesma carta foi escolhida duas vezes.');
        }

        // Cada id precisa ser de uma carta que está NA MÃO deste carro
        $cartas = [];
        foreach ($ids as $id) {
            $encontrada = null;
            foreach ($carro->mao as $carta) {
                if ($carta->id === $id) {
                    $encontrada = $carta;
                    break;
                }
            }
            if ($encontrada === null) {
                throw new ErroJogo('CARTAS_INVALIDAS', 'Uma das cartas escolhidas não está na sua mão.');
            }
            $cartas[] = $encontrada;
        }
        foreach ($cartas as $carta) {
            if ($carta->ehCalor()) {
                throw new ErroJogo('CARTAS_INVALIDAS', 'Cartas de Calor são "mortas": não podem ser jogadas.');
            }
        }

        $necessarias = self::cartasNecessarias($carro, $marcha);
        if (count($cartas) !== $necessarias) {
            throw new ErroJogo('CARTAS_INVALIDAS',
                'Na marcha ' . $marcha . ' você deve jogar exatamente ' . $necessarias .
                ($necessarias === 1 ? ' carta' : ' cartas') . ' de Velocidade.');
        }
        return $cartas;
    }

    /* ---------- Simulação (não altera nada!) ---------- */

    // Carro que está na casa (ignorando o próprio carro), ou null se estiver livre.
    private static function carroNaCasa(Partida $partida, int $casa, int $ignorarCarroId): ?Carro
    {
        foreach ($partida->carros as $carro) {
            if ($carro->id !== $ignorarCarroId && $carro->posicao === $casa) return $carro;
        }
        return null;
    }

    // Regra de ocupação: se o destino estiver ocupado, recua até a casa livre
    // mais próxima, sem voltar para trás da casa onde o carro começou.
    private static function casaLivre(Partida $partida, Carro $carro, int $alvo, int $inicial): int
    {
        for ($casa = $alvo; $casa > $inicial; $casa--) {
            if (self::carroNaCasa($partida, $casa, $carro->id) === null) return $casa;
        }
        return $inicial;
    }

    // Calcula o resultado da jogada SEM mexer no estado.
    // É usada pela previsão (prever_jogada), pelos bots e pelo turno de verdade,
    // então as três coisas sempre concordam.
    public static function simularJogada(Partida $partida, Carro $carro, int $marcha, array $cartas): array
    {
        $ultima = self::ultimaCasa($partida);
        $r = [
            'marcha' => $marcha,
            'custoMarcha' => abs($marcha - $carro->marcha) === 2 ? 1 : 0,
            'resfria' => false,
            'velocidade' => 0,
            'inicial' => $carro->posicao,
            'alvo' => 0,              // casa pretendida (posição + velocidade)
            'casaAposOcupacao' => 0,  // casa depois da regra de ocupação
            'ajustado' => false,
            'final' => 0,
            'curvas' => [],           // curvas cruzadas: [casa, limite, calor_pago]
            'derrapou' => false,
            'derrapagem' => null,     // detalhes da derrapagem, se houver
            'vacuo' => null,          // rastro (vácuo), se houver: [de, para, atras_de]
            'calorTotal' => 0,        // calor pago no turno (marcha + curvas)
            'motorFinal' => 0,
            'chegou' => false,
        ];

        // 1. Marcha: pular 2 marchas custa 1 Calor
        $motor = count($carro->motor) - $r['custoMarcha'];

        // 2. Resfriar: na marcha 1 volta 1 Calor para o motor
        //    (vem da mão; se não houver na mão, vem do descarte)
        if ($marcha === 1) {
            if (self::temCalor($carro->mao) || self::temCalor($carro->descarte) || $r['custoMarcha'] > 0) {
                $r['resfria'] = true;
                $motor += 1;
            }
        }

        // 3 e 4. Velocidade = soma das cartas
        foreach ($cartas as $carta) {
            $r['velocidade'] += $carta->valor;
        }
        $r['alvo'] = $r['inicial'] + $r['velocidade'];

        // 5. Ocupação (a chegada é a última casa: não passa dela)
        $destino = min($r['alvo'], $ultima);
        $r['casaAposOcupacao'] = self::casaLivre($partida, $carro, $destino, $r['inicial']);
        $r['ajustado'] = $r['casaAposOcupacao'] !== $destino;
        $r['final'] = $r['casaAposOcupacao'];

        // 6 e 7. Curvas cruzadas, em ordem
        $curvas = self::curvasEmOrdem($partida->pista);
        foreach ($curvas as $curva) {
            $cruzou = $r['inicial'] < $curva['casa'] && $r['final'] >= $curva['casa'];
            if (!$cruzou) continue;

            $custo = max(0, $r['velocidade'] - $curva['limite']);
            if ($custo <= $motor) {
                $motor -= $custo;
                $r['curvas'][] = ['casa' => $curva['casa'], 'limite' => $curva['limite'], 'calor_pago' => $custo];
            } else {
                // Derrapagem: para antes da curva e não processa as próximas
                $r['derrapou'] = true;
                $r['derrapagem'] = [
                    'casa' => $curva['casa'],
                    'limite' => $curva['limite'],
                    'calor_necessario' => $custo,
                    'calor_disponivel' => $motor,
                ];
                $r['final'] = self::casaLivre($partida, $carro, $curva['casa'] - 1, $r['inicial']);
                break;
            }
        }

        // 7b. Rastro (vácuo): quem andou, não derrapou e parou colado atrás de
        //     outro carro é puxado até VACUO_CASAS casas à frente, para a casa
        //     livre mais distante. Só vale na reta: o rastro para na casa antes
        //     da próxima curva, então nunca custa Calor nem faz derrapar.
        if (!$r['derrapou'] && $r['final'] > $r['inicial']) {
            $carroNaFrente = self::carroNaCasa($partida, $r['final'] + 1, $carro->id);
            if ($carroNaFrente !== null) {
                $limite = min($r['final'] + REGRAS['VACUO_CASAS'], $ultima);
                foreach ($curvas as $curva) {
                    if ($curva['casa'] > $r['final']) {   // próxima curva
                        $limite = min($limite, $curva['casa'] - 1);
                        break;
                    }
                }
                $destinoRastro = self::casaLivre($partida, $carro, $limite, $r['final']);
                if ($destinoRastro > $r['final']) {
                    $r['vacuo'] = ['de' => $r['final'], 'para' => $destinoRastro, 'atras_de' => $carroNaFrente->id];
                    $r['final'] = $destinoRastro;
                }
            }
        }

        $calorCurvas = 0;
        foreach ($r['curvas'] as $curva) {
            $calorCurvas += $curva['calor_pago'];
        }
        $r['calorTotal'] = $r['custoMarcha'] + $calorCurvas;
        $r['motorFinal'] = $motor;
        $r['chegou'] = $r['final'] >= $ultima;
        return $r;
    }

    /* ---------- Turno de verdade (altera o estado) ---------- */

    private static function executarTurno(Partida $partida, Carro $carro, $marcha, $cartaIds, array &$eventos): void
    {
        $cartas = self::validarJogada($carro, $marcha, $cartaIds); // lança erro se inválida
        $marcha = self::inteiro($marcha);
        $sim = self::simularJogada($partida, $carro, $marcha, $cartas);
        $marchaAntiga = $carro->marcha;

        // 1. Marcha
        self::moverCartas($carro->motor, $carro->descarte, $sim['custoMarcha']);
        $carro->marcha = $marcha;
        $eventos[] = ['tipo' => 'marcha', 'carro_id' => $carro->id, 'de' => $marchaAntiga, 'para' => $marcha,
            'calor_pago' => $sim['custoMarcha']];

        // 2. Resfriar (regra própria): Calor da mão ou, se não houver, do descarte
        if ($sim['resfria']) {
            $indice = self::indiceDoCalor($carro->mao);
            if ($indice !== -1) {
                $origem = 'mao';
                $carta = array_splice($carro->mao, $indice, 1)[0];
            } else {
                $origem = 'descarte';
                $carta = array_splice($carro->descarte, self::indiceDoCalor($carro->descarte), 1)[0];
            }
            $carro->motor[] = $carta;
            $eventos[] = ['tipo' => 'resfriar', 'carro_id' => $carro->id, 'origem' => $origem];
        }

        // 3 e 4. Cartas jogadas saem da mão
        $carro->mao = array_values(array_filter($carro->mao, function (Carta $carta) use ($cartas) {
            return !in_array($carta, $cartas, true);
        }));
        $eventos[] = [
            'tipo' => 'cartas_jogadas',
            'carro_id' => $carro->id,
            'cartas' => array_map(function (Carta $c) { return $c->id; }, $cartas),
            'valores' => array_map(function (Carta $c) { return $c->valor; }, $cartas),
            'velocidade' => $sim['velocidade'],
        ];

        // 5. Ocupação + movimento (o rastro vem depois, num evento separado)
        if ($sim['ajustado']) {
            $eventos[] = ['tipo' => 'ajuste_ocupacao', 'carro_id' => $carro->id, 'pretendida' => $sim['alvo'],
                'casa' => $sim['casaAposOcupacao']];
        }
        $casaAntesDoRastro = $sim['vacuo'] !== null ? $sim['vacuo']['de'] : $sim['final'];
        $eventos[] = ['tipo' => 'mover', 'carro_id' => $carro->id, 'de' => $sim['inicial'], 'para' => $casaAntesDoRastro];

        // 6. Curvas
        foreach ($sim['curvas'] as $curva) {
            self::moverCartas($carro->motor, $carro->descarte, $curva['calor_pago']);
            $eventos[] = [
                'tipo' => 'curva', 'carro_id' => $carro->id, 'casa' => $curva['casa'], 'limite' => $curva['limite'],
                'velocidade' => $sim['velocidade'], 'calor_pago' => $curva['calor_pago'],
            ];
        }

        // 7. Derrapagem
        if ($sim['derrapou']) {
            $carro->marcha = 1;
            $carro->derrapagens++;
            $eventos[] = [
                'tipo' => 'derrapagem', 'carro_id' => $carro->id, 'casa' => $sim['derrapagem']['casa'],
                'limite' => $sim['derrapagem']['limite'], 'velocidade' => $sim['velocidade'],
                'calor_necessario' => $sim['derrapagem']['calor_necessario'],
                'calor_disponivel' => $sim['derrapagem']['calor_disponivel'], 'para' => $sim['final'],
            ];
        }

        // 7b. Rastro (vácuo): o carro é puxado para a frente
        if ($sim['vacuo'] !== null) {
            $eventos[] = ['tipo' => 'vacuo', 'carro_id' => $carro->id, 'de' => $sim['vacuo']['de'],
                'para' => $sim['vacuo']['para'], 'atras_de' => $sim['vacuo']['atras_de']];
        }
        $carro->posicao = $sim['final'];

        // 8. Fim do turno: jogadas para o descarte e compra até 7
        foreach ($cartas as $carta) {
            $carro->descarte[] = $carta;
        }
        $compra = self::comprarAte($partida, $carro, REGRAS['TAMANHO_MAO']);
        $eventos[] = ['tipo' => 'compra', 'carro_id' => $carro->id, 'quantidade' => $compra['quantidade'],
            'reembaralhou' => $compra['reembaralhou']];

        // Histórico: o Repositorio grava isto na tabela "jogadas"
        $partida->jogadas[] = [
            'partida_id' => $partida->id,
            'carro_id' => $carro->id,
            'rodada' => $partida->rodada,
            'marcha' => $marcha,
            'velocidade' => $sim['velocidade'],
            'posicao_inicial' => $sim['inicial'],
            'posicao_final' => $sim['final'],
            'calor_pago' => $sim['calorTotal'],
            'derrapou' => $sim['derrapou'],
        ];

        if ($sim['chegou']) self::finalizarCorrida($partida, $carro, $eventos);
    }

    /* ---------- Ordem dos turnos ---------- */

    // O líder (maior posição) joga primeiro. Recalculado a cada rodada.
    // A ordem fica em cada carro (coluna carros.ordem_turno) e a vez é o
    // número de ordem de quem joga agora (coluna partidas.vez).
    private static function recalcularOrdem(Partida $partida): void
    {
        $ordenados = $partida->carros;
        usort($ordenados, function (Carro $a, Carro $b) {
            return ($b->posicao <=> $a->posicao) ?: ($a->id <=> $b->id);
        });
        foreach ($ordenados as $i => $carro) {
            $carro->ordem = $i + 1;
        }
        $partida->vez = 1;
    }

    public static function carroDaVez(Partida $partida): Carro
    {
        foreach ($partida->carros as $carro) {
            if ($carro->ordem === $partida->vez) return $carro;
        }
        throw new ErroJogo('ERRO_INTERNO', 'Ordem dos turnos inconsistente.');
    }

    // Id do carro que deve jogar agora (null se a corrida acabou).
    public static function turnoDe(Partida $partida): ?int
    {
        return $partida->status === 'em_andamento' ? self::carroDaVez($partida)->id : null;
    }

    private static function avancarVez(Partida $partida, array &$eventos): void
    {
        $partida->vez++;
        if ($partida->vez > count($partida->carros)) {
            $partida->rodada++;
            self::recalcularOrdem($partida);
            $eventos[] = ['tipo' => 'nova_rodada', 'rodada' => $partida->rodada];
        }
    }

    // Os bots jogam sozinhos até chegar a vez do humano (ou a corrida acabar).
    private static function executarAteVezDoHumano(Partida $partida, array &$eventos): void
    {
        while ($partida->status === 'em_andamento') {
            $carro = self::carroDaVez($partida);
            if ($carro->tipo === 'humano') return;

            $escolha = Bots::escolherJogada($partida, $carro);
            self::executarTurno($partida, $carro, $escolha['marcha'], $escolha['cartas'], $eventos);
            if ($partida->status === 'em_andamento') self::avancarVez($partida, $eventos);
        }
    }

    /* ---------- Fim da corrida ---------- */

    private static function finalizarCorrida(Partida $partida, Carro $vencedor, array &$eventos): void
    {
        $partida->status = 'finalizada';
        $partida->vencedor_carro_id = $vencedor->id;

        // Demais carros: maior posição primeiro; desempate = menos derrapagens
        $outros = array_values(array_filter($partida->carros, function (Carro $c) use ($vencedor) {
            return $c !== $vencedor;
        }));
        usort($outros, function (Carro $a, Carro $b) {
            return ($b->posicao <=> $a->posicao) ?: ($a->derrapagens <=> $b->derrapagens) ?: ($a->id <=> $b->id);
        });
        $classificacao = array_merge([$vencedor], $outros);
        foreach ($classificacao as $i => $carro) {
            $carro->chegada_posicao = $i + 1;
            $carro->pontos = REGRAS['PONTOS_POR_COLOCACAO'][$i] ?? 0;
        }

        $eventos[] = [
            'tipo' => 'fim_corrida',
            'vencedor_id' => $vencedor->id,
            'rodada' => $partida->rodada,
            'classificacao' => array_map(function (Carro $c) {
                return ['carro_id' => $c->id, 'nome' => $c->nome, 'colocacao' => $c->chegada_posicao, 'pontos' => $c->pontos];
            }, $classificacao),
        ];
    }

    /* ---------- Pista ---------- */

    public static function pistaClassica(): array
    {
        return [
            'nome' => 'Circuito da Serra',
            'semente' => 1,
            'total_casas' => REGRAS['TOTAL_CASAS'],
            'curvas' => REGRAS['CURVAS'],
        ];
    }

    // A pista combina com as regras de espaçamento de PISTA_SORTEIO?
    public static function curvasValidas(array $casas): bool
    {
        $s = REGRAS['PISTA_SORTEIO'];
        $total = count($casas);
        if ($casas[0] < $s['PRIMEIRA_CURVA_MIN'] || $casas[$total - 1] > $s['ULTIMA_CURVA_MAX']) return false;
        for ($i = 1; $i < $total; $i++) {
            $distancia = $casas[$i] - $casas[$i - 1];
            if ($distancia < $s['DISTANCIA_MIN'] || $distancia > $s['DISTANCIA_MAX']) return false;
        }
        return REGRAS['TOTAL_CASAS'] - $casas[$total - 1] + $casas[0] <= $s['RETA_LARGADA_MAX'];
    }

    // Monta a pista de uma semente: quantas curvas, onde ficam e o limite de
    // cada uma. A semente 1 é a pista clássica; as outras sorteiam uma pista
    // com um gerador só dela, então a mesma semente sempre dá a mesma pista
    // (e a interface usa a mesma semente para desenhar o traçado).
    public static function pistaDaSemente(int $semente): array
    {
        if ($semente === 1) return self::pistaClassica();
        $s = REGRAS['PISTA_SORTEIO'];
        $gerador = new Sorteio($semente);
        $quantidade = $gerador->entre($s['CURVAS_MIN'], $s['CURVAS_MAX']);
        $casas = null;

        // Sorteia posições até achar um conjunto bem espaçado (acha em poucas tentativas)
        for ($tentativa = 0; $tentativa < 2000 && $casas === null; $tentativa++) {
            $candidatas = [];
            while (count($candidatas) < $quantidade) {
                $casa = $gerador->entre($s['PRIMEIRA_CURVA_MIN'], $s['ULTIMA_CURVA_MAX']);
                if (!in_array($casa, $candidatas, true)) $candidatas[] = $casa;
            }
            sort($candidatas);
            if (self::curvasValidas($candidatas)) $casas = $candidatas;
        }
        if ($casas === null) return self::pistaClassica();

        // Limites variados: pelo menos uma curva lenta e uma rápida
        $limites = [];
        foreach ($casas as $casa) {
            $limites[] = $gerador->entre($s['LIMITE_MIN'], $s['LIMITE_MAX']);
        }
        $lenta = $gerador->entre(0, count($limites) - 1);
        $limites[$lenta] = $s['LIMITE_MIN'];
        if (max($limites) < $s['LIMITE_MAX'] - 1) {
            $limites[($lenta + 2) % count($limites)] = $s['LIMITE_MAX'];
        }

        $curvas = [];
        foreach ($casas as $i => $casa) {
            $curvas[] = ['casa' => $casa, 'limite' => $limites[$i]];
        }
        $nomes = REGRAS['NOMES_CIRCUITOS'];
        return [
            'nome' => $nomes[$gerador->entre(0, count($nomes) - 1)],
            'semente' => $semente,
            'total_casas' => REGRAS['TOTAL_CASAS'],
            'curvas' => $curvas,
        ];
    }

    /* ---------- Funções públicas (usadas pelo Jogo.php) ---------- */

    // Semente válida: inteiro de 1 a 2147483647.
    private static function sementeValida($valor): bool
    {
        $n = self::inteiro($valor);
        return $n !== null && $n >= 1 && $n <= 2147483647;
    }

    // Valida os dados da tela inicial e monta a partida EM MEMÓRIA
    // (o Repositorio grava no banco depois).
    public static function criarPartida(array $dados): Partida
    {
        $nome = is_string($dados['nome_jogador'] ?? null) ? trim($dados['nome_jogador']) : '';
        $tamanho = mb_check_encoding($nome, 'UTF-8') ? mb_strlen($nome, 'UTF-8') : 0;
        if ($tamanho < 2 || $tamanho > 20 || preg_match('/[\x00-\x1F\x7F]/', $nome)) {
            throw new ErroJogo('NOME_INVALIDO', 'Digite um nome de piloto com 2 a 20 caracteres.');
        }
        $numBots = self::inteiro($dados['num_bots'] ?? null);
        if ($numBots !== 1 && $numBots !== 2) {
            throw new ErroJogo('BOTS_INVALIDOS', 'Escolha 1 ou 2 adversários.');
        }
        $dificuldade = $dados['dificuldade'] ?? null;
        if (!in_array($dificuldade, ['facil', 'medio', 'dificil'], true)) {
            throw new ErroJogo('DIFICULDADE_INVALIDA', 'Escolha a dificuldade: fácil, médio ou difícil.');
        }

        // Semente da partida: a informada (testes) ou uma nova. Daqui em
        // diante todo sorteio sai do gerador com semente.
        $semente = self::sementeValida($dados['semente'] ?? null)
            ? self::inteiro($dados['semente'])
            : random_int(1, 2147483646);
        $partida = new Partida($semente);

        // Pista: semente_pista informada (revanche na mesma pista), clássica ou sorteada
        if (self::sementeValida($dados['semente_pista'] ?? null)) {
            $sementePista = self::inteiro($dados['semente_pista']);
        } else {
            $sementePista = REGRAS['PISTA_ALEATORIA'] ? $partida->sorteio->entre(2, 999999) : 1;
        }
        $partida->pista = self::pistaDaSemente($sementePista);

        // Grid de largada sorteado: casas 0, 1 (e 2), uma por carro
        $casasGrid = $partida->sorteio->embaralhar(range(0, $numBots));

        for ($i = 0; $i <= $numBots; $i++) {
            $visual = CARROS_VISUAL[$i];
            $carro = new Carro();
            $carro->id = $i + 1;               // provisório: o banco troca pelo id de verdade
            $carro->nome = $i === 0 ? $nome : $visual['nome'];
            $carro->tipo = $i === 0 ? 'humano' : 'bot';
            $carro->dificuldade = $i === 0 ? null : $dificuldade;
            $carro->cor = $visual['cor'];
            $carro->forma = $visual['forma'];
            $carro->numero = $i + 1;
            $carro->posicao = $casasGrid[$i];
            $carro->marcha = REGRAS['MARCHA_INICIAL'];
            self::prepararBaralho($partida, $carro);
            $partida->carros[] = $carro;
        }

        self::recalcularOrdem($partida);
        return $partida;
    }

    // Começa a corrida: bots à frente do humano no grid já fazem a 1ª jogada.
    public static function iniciarCorrida(Partida $partida): array
    {
        $eventos = [];
        self::executarAteVezDoHumano($partida, $eventos);
        return $eventos;
    }

    private static function verificarVezDoHumano(Partida $partida): Carro
    {
        if ($partida->status !== 'em_andamento') {
            throw new ErroJogo('PARTIDA_ENCERRADA', 'Esta corrida já terminou. Comece uma nova partida.');
        }
        $carro = self::carroDaVez($partida);
        if ($carro->tipo !== 'humano') {
            throw new ErroJogo('NAO_E_SEU_TURNO', 'Ainda não é a sua vez. Aguarde os adversários.');
        }
        return $carro;
    }

    public static function jogarTurnoHumano(Partida $partida, $marcha, $cartaIds): array
    {
        $carro = self::verificarVezDoHumano($partida);
        $eventos = [];
        self::executarTurno($partida, $carro, $marcha, $cartaIds, $eventos);
        if ($partida->status === 'em_andamento') {
            self::avancarVez($partida, $eventos);
            self::executarAteVezDoHumano($partida, $eventos);
        }
        return $eventos;
    }

    public static function preverJogada(Partida $partida, $marcha, $cartaIds): array
    {
        $carro = self::verificarVezDoHumano($partida);
        $cartas = self::validarJogada($carro, $marcha, $cartaIds);
        $sim = self::simularJogada($partida, $carro, self::inteiro($marcha), $cartas);
        return [
            'ok' => true,
            'velocidade' => $sim['velocidade'],
            'destino' => $sim['final'],
            'destino_pretendido' => $sim['alvo'],
            'ajuste_ocupacao' => $sim['ajustado'],
            'calor_previsto' => $sim['calorTotal'],
            'custo_marcha' => $sim['custoMarcha'],
            'resfria' => $sim['resfria'],
            'derrapa' => $sim['derrapou'],
            'derrapagem' => $sim['derrapagem'],
            'curvas' => $sim['curvas'],
            'vacuo' => $sim['vacuo'],     // rastro: {de, para, atras_de} ou null (extra no contrato)
            'motor_apos' => $sim['motorFinal'],
            'chega' => $sim['chegou'],
        ];
    }

    // Converte a partida no formato JSON do contrato (seção 6).
    // Só a mão do humano é revelada; as mãos dos bots ficam em segredo.
    public static function montarEstado(Partida $partida): array
    {
        $humano = self::humano($partida);
        $calorNaMao = count($humano->mao) - count(self::cartasDeVelocidade($humano->mao));
        $estado = [
            'ok' => true,
            'partida' => [
                'id' => $partida->id,
                'status' => $partida->status,
                'rodada' => $partida->rodada,
                'turno_de' => self::turnoDe($partida),
                'vencedor_carro_id' => $partida->vencedor_carro_id,
            ],
            'pista' => [
                'nome' => $partida->pista['nome'],
                'semente' => $partida->pista['semente'],
                'total_casas' => $partida->pista['total_casas'],
                'curvas' => $partida->pista['curvas'],
            ],
            'carros' => array_map(function (Carro $c) {
                return [
                    'id' => $c->id, 'nome' => $c->nome, 'tipo' => $c->tipo, 'dificuldade' => $c->dificuldade,
                    'posicao' => $c->posicao, 'marcha' => $c->marcha, 'motor' => count($c->motor),
                    'ordem' => $c->ordem, 'cor' => $c->cor, 'forma' => $c->forma, 'numero' => $c->numero,
                    'derrapagens' => $c->derrapagens, 'chegada_posicao' => $c->chegada_posicao, 'pontos' => $c->pontos,
                ];
            }, $partida->carros),
            'minha_mao' => array_map(function (Carta $c) { return $c->paraJson(); }, $humano->mao),
            'baralho' => [
                'compra' => count($humano->compra),
                'descarte' => count($humano->descarte),
                'calor_na_mao' => $calorNaMao,
            ],
            'minhas_opcoes' => [
                'marchas' => self::opcoesDeMarcha($humano),
            ],
            'resultado' => null,
        ];

        if ($partida->status === 'finalizada') {
            $classificacao = $partida->carros;
            usort($classificacao, function (Carro $a, Carro $b) {
                return $a->chegada_posicao <=> $b->chegada_posicao;
            });
            $estado['resultado'] = [
                'rodadas' => $partida->rodada,
                'classificacao' => array_map(function (Carro $c) {
                    return [
                        'carro_id' => $c->id, 'nome' => $c->nome, 'tipo' => $c->tipo, 'colocacao' => $c->chegada_posicao,
                        'pontos' => $c->pontos, 'posicao' => $c->posicao, 'motor' => count($c->motor),
                        'derrapagens' => $c->derrapagens, 'cor' => $c->cor, 'forma' => $c->forma, 'numero' => $c->numero,
                    ];
                }, $classificacao),
            ];
        }
        return $estado;
    }
}
