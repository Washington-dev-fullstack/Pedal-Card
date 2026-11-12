<?php
/* =====================================================================
   Bots.php — Como os bots escolhem a jogada (port do mock-engine.js)
   ---------------------------------------------------------------------
   Os bots pensam em TURNOS: "quantos turnos ainda faltam para eu cruzar
   a chegada?". A resposta vem de uma tabela montada uma vez por pista,
   como um GPS que sabe a distância de cada esquina até o destino:

     tabela[casa][marcha][calor] = turnos que faltam, jogando bem, para
                                  quem está nessa casa, nessa marcha e
                                  com essa quantidade de Calor no motor.

   Ela é preenchida de trás para frente (da casa 46 até a 0), porque o
   valor de uma casa depende do valor das casas à frente. Como ninguém
   sabe as cartas dos próximos turnos, usamos MÃOS DE EXEMPLO (sempre as
   mesmas, sorteadas com semente fixa) e tiramos a média.

   Na hora de jogar, o bot testa todas as jogadas possíveis (marcha +
   cartas), simula cada uma com Regras::simularJogada() e fica com a que
   deixa MENOS turnos até a chegada. As dificuldades mudam só o quanto
   ele erra de propósito (BOT_TOLERANCIA no config.php).
   ===================================================================== */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/Modelos.php';
require_once __DIR__ . '/Regras.php';

class Bots
{
    const TURNOS_SE_TRAVADO = 10;  // mão de exemplo sem nenhuma jogada que ande (raríssimo)

    // maosDeExemplo[calorGasto][i][marcha] = velocidades possíveis
    private static ?array $maosDeExemplo = null;

    // Tabelas já montadas nesta requisição, por pista
    private static array $tabelas = [];

    // Todas as combinações de k itens de uma lista (ex.: escolher 3 cartas de 5).
    public static function combinacoes(array $lista, int $k): array
    {
        if ($k === 0) return [[]];
        $resultado = [];
        $total = count($lista);
        for ($i = 0; $i <= $total - $k; $i++) {
            foreach (self::combinacoes(array_slice($lista, $i + 1), $k - 1) as $resto) {
                $resultado[] = array_merge([$lista[$i]], $resto);
            }
        }
        return $resultado;
    }

    // Sorteia as mãos de exemplo (uma vez só) e guarda, para cada marcha, as
    // velocidades que dá para fazer com elas. Ex.: mão 1, 3, 4 na marcha 2 → 4, 5 e 7.
    private static function prepararMaosDeExemplo(): void
    {
        $gerador = new Sorteio(2024);  // semente fixa: a tabela nunca muda
        self::$maosDeExemplo = [];
        for ($gasto = 0; $gasto <= REGRAS['CALOR_MOTOR']; $gasto++) {
            $maos = [];
            for ($i = 0; $i < REGRAS['BOT_MAOS_EXEMPLO']; $i++) {
                // Baralho: as cartas de Velocidade + uma carta de Calor (valor 0) por Calor gasto
                $baralho = [];
                foreach (REGRAS['VALORES_VELOCIDADE'] as $valor) {
                    for ($copia = 0; $copia < REGRAS['COPIAS_POR_VALOR']; $copia++) $baralho[] = $valor;
                }
                for ($q = 0; $q < $gasto; $q++) $baralho[] = 0;
                $baralho = $gerador->embaralhar($baralho);
                $mao = array_values(array_filter(array_slice($baralho, 0, REGRAS['TAMANHO_MAO']), function ($valor) {
                    return $valor > 0;
                }));

                $porMarcha = [];
                for ($m = REGRAS['MARCHA_MIN']; $m <= REGRAS['MARCHA_MAX']; $m++) {
                    $somas = [];
                    foreach (self::combinacoes($mao, min($m, count($mao))) as $combo) {
                        $somas[array_sum($combo)] = true;
                    }
                    $velocidades = array_keys($somas);
                    sort($velocidades);
                    $porMarcha[$m] = $velocidades;
                }
                $maos[] = $porMarcha;
            }
            self::$maosDeExemplo[] = $maos;
        }
    }

    // Turnos que faltam para quem está nessa situação (0 na chegada).
    private static function turnosNa(array $tabela, int $ultima, int $casa, int $marcha, int $calor)
    {
        if ($casa >= $ultima) return 0;
        return $tabela[$casa][$marcha][$calor] ?? INF; // INF = ainda não calculado
    }

    // Anda "velocidade" casas a partir de "inicio" pagando as curvas (como em
    // simularJogada, mas sem outros carros).
    // Devolve [casa onde parou, derrapou?, Calor que sobrou no motor].
    private static function andar(array $curvas, int $ultima, int $inicio, int $velocidade, int $calor): array
    {
        $destino = min($inicio + $velocidade, $ultima);
        foreach ($curvas as $curva) {
            if ($curva['casa'] <= $inicio) continue;
            if ($curva['casa'] > $destino) break;
            $custo = max(0, $velocidade - $curva['limite']);
            if ($custo <= $calor) {
                $calor -= $custo;
            } else {             // derrapa: para antes da curva (e volta para a marcha 1)
                return [$curva['casa'] - 1, true, $calor];
            }
        }
        return [$destino, false, $calor];
    }

    // Monta a tabela de turnos de uma pista.
    private static function montarTabelaTurnos(array $pista): array
    {
        if (self::$maosDeExemplo === null) self::prepararMaosDeExemplo();
        $ultima = $pista['total_casas'] - 1;
        $curvas = Regras::curvasEmOrdem($pista);
        $velocidadeMaxima = REGRAS['MARCHA_MAX'] * max(REGRAS['VALORES_VELOCIDADE']); // 4 cartas de 4 = 16
        $minima = REGRAS['MARCHA_MIN'];
        $maxima = REGRAS['MARCHA_MAX'];
        $calorMaximo = REGRAS['CALOR_MOTOR'];

        // 0) Andar pela pista não depende da tabela, só da casa, da velocidade e
        //    do Calor. Calculamos isso uma vez só, em vez de repetir a mesma
        //    conta milhares de vezes dentro dos laços abaixo.
        //    andar[casa][calor][velocidade] = [casa final, derrapou?, Calor que sobrou]
        $andar = [];
        for ($p = 0; $p < $ultima; $p++) {
            for ($calor = 0; $calor <= $calorMaximo; $calor++) {
                for ($v = 1; $v <= $velocidadeMaxima; $v++) {
                    $andar[$p][$calor][$v] = self::andar($curvas, $ultima, $p, $v, $calor);
                }
            }
        }

        $tabela = [];
        for ($p = $ultima - 1; $p >= 0; $p--) {
            for ($marcha = $minima; $marcha <= $maxima; $marcha++) {
                for ($calor = 0; $calor <= $calorMaximo; $calor++) {
                    // 1) Para cada marcha nova e cada velocidade: turnos que faltariam depois
                    $depois = [];
                    for ($nova = max($minima, $marcha - 2); $nova <= min($maxima, $marcha + 2); $nova++) {
                        $custoMarcha = abs($nova - $marcha) === 2 ? 1 : 0;
                        if ($custoMarcha > $calor) continue;                     // pular 2 marchas sem Calor: proibido
                        $motor = $calor - $custoMarcha;
                        if ($nova === $minima && $motor < $calorMaximo) $motor++; // resfriar
                        $turnos = [];
                        foreach ($andar[$p][$motor] as $v => [$destino, $derrapou, $sobra]) {
                            // (o mesmo que turnosNa, escrito aqui dentro por ser o trecho que mais roda)
                            $turnos[$v] = $destino >= $ultima ? 0 : ($tabela[$destino][$derrapou ? $minima : $nova][$sobra] ?? INF);
                        }
                        $depois[$nova] = $turnos;
                    }

                    // 2) Média das mãos de exemplo: em cada uma, a melhor escolha possível
                    $maos = self::$maosDeExemplo[$calorMaximo - $calor];
                    $soma = 0;
                    foreach ($maos as $mao) {
                        $melhor = INF;
                        foreach ($depois as $n => $turnosPorVelocidade) {
                            foreach ($mao[$n] as $velocidade) {
                                if ($turnosPorVelocidade[$velocidade] < $melhor) $melhor = $turnosPorVelocidade[$velocidade];
                            }
                        }
                        $soma += min($melhor, self::TURNOS_SE_TRAVADO);
                    }
                    $tabela[$p][$marcha][$calor] = 1 + $soma / count($maos);
                }
            }
        }
        return $tabela;
    }

    /* ---------- Cache da tabela ----------
       A tabela só depende da pista (e das regras), mas montar leva de 0,1 a
       0,7 s conforme o computador. Como o PHP esquece tudo ao fim de cada
       requisição, ela é guardada num arquivo da pasta cache/: é montada na
       primeira jogada de bot da partida e lida pronta nos turnos seguintes.
       Se a pasta não puder ser criada, o jogo funciona igual (só mais lento). */

    const MAX_ARQUIVOS_CACHE = 300;  // cada tabela ocupa uns 20 KB (300 = uns 6 MB)

    // Chamado ao criar a partida (tela "Preparando o grid…"): a espera fica na
    // largada, e nenhum turno no meio da corrida precisa montar a tabela.
    public static function prepararTabela(array $pista): void
    {
        self::tabelaDaPista($pista);
    }

    private static function tabelaDaPista(array $pista): array
    {
        // A chave muda se a pista OU as regras mudarem (aí a tabela antiga não serve)
        $chave = md5(json_encode([$pista['total_casas'], Regras::curvasEmOrdem($pista), REGRAS]));
        if (!isset(self::$tabelas[$chave])) {
            $arquivo = __DIR__ . '/../cache/bots-' . $chave . '.dat';
            $tabela = self::lerCache($arquivo);
            if ($tabela === null) {
                $tabela = self::montarTabelaTurnos($pista);
                self::gravarCache($arquivo, $tabela);
            }
            self::$tabelas = [$chave => $tabela];  // na memória, guarda só a última
        }
        return self::$tabelas[$chave];
    }

    private static function lerCache(string $arquivo): ?array
    {
        if (!is_file($arquivo)) return null;
        // allowed_classes = false: o arquivo só pode conter números e arrays,
        // nunca objetos (proteção contra "object injection").
        $tabela = @unserialize((string) @file_get_contents($arquivo), ['allowed_classes' => false]);
        return is_array($tabela) ? $tabela : null;
    }

    // O "@" faz o PHP não reclamar se não houver permissão de escrita: nesse
    // caso simplesmente não há cache.
    private static function gravarCache(string $arquivo, array $tabela): void
    {
        $pasta = dirname($arquivo);
        if (!is_dir($pasta) && !@mkdir($pasta, 0775, true)) return;

        // Grava num arquivo temporário e renomeia: quem estiver lendo nunca
        // vê um arquivo pela metade.
        $temporario = $arquivo . '.' . getmypid() . '.tmp';
        if (@file_put_contents($temporario, serialize($tabela)) === false) return;
        if (!@rename($temporario, $arquivo)) {
            @unlink($temporario);
            return;
        }

        // Limpeza: passou do limite, apaga as tabelas mais antigas até sobrar
        // 80% do limite (assim a limpeza só roda de vez em quando).
        $arquivos = glob($pasta . '/bots-*.dat') ?: [];
        if (count($arquivos) > self::MAX_ARQUIVOS_CACHE) {
            $datas = [];
            foreach ($arquivos as $nome) $datas[$nome] = (int) @filemtime($nome);
            asort($datas);  // mais antigos primeiro
            $sobrar = (int) (self::MAX_ARQUIVOS_CACHE * 0.8);
            foreach (array_slice(array_keys($datas), 0, count($datas) - $sobrar) as $antigo) {
                @unlink($antigo);
            }
        }
    }

    // Testa todas as jogadas possíveis e dá a NOTA de cada uma:
    //   turnos = quantos turnos ainda faltariam até a chegada depois da jogada
    //            (0 se ela cruza a chegada), lidos na tabela na casa, marcha e
    //            Calor em que o carro termina (derrapou = marcha 1).
    // Quanto MENOS turnos, melhor. Empate: a que termina mais à frente.
    public static function avaliarOpcoes(Partida $partida, Carro $carro): array
    {
        $tabela = self::tabelaDaPista($partida->pista);
        $ultima = Regras::ultimaCasa($partida);
        $velocidadeNaMao = Regras::cartasDeVelocidade($carro->mao);
        $vistas = [];
        $opcoes = [];

        foreach (Regras::opcoesDeMarcha($carro) as $op) {
            if (!$op['permitida']) continue;
            $n = min($op['marcha'], count($velocidadeNaMao));
            foreach (self::combinacoes($velocidadeNaMao, $n) as $combo) {
                // Cartas de mesmo valor dão o mesmo resultado: avalia só uma vez
                $valores = array_map(function (Carta $c) { return $c->valor; }, $combo);
                sort($valores);
                $chave = $op['marcha'] . ':' . implode(',', $valores);
                if (isset($vistas[$chave])) continue;
                $vistas[$chave] = true;

                $sim = Regras::simularJogada($partida, $carro, $op['marcha'], $combo);
                $marchaDepois = $sim['derrapou'] ? REGRAS['MARCHA_MIN'] : $op['marcha'];
                $opcoes[] = [
                    'marcha' => $op['marcha'],
                    'cartas' => array_map(function (Carta $c) { return $c->id; }, $combo),
                    'turnos' => $sim['chegou'] ? 0 : self::turnosNa($tabela, $ultima, $sim['final'], $marchaDepois, $sim['motorFinal']),
                    'casaFinal' => $sim['final'],
                    'derrapa' => $sim['derrapou'],
                ];
            }
        }

        // usort é estável no PHP 8 (empates mantêm a ordem), igual ao sort do JavaScript
        usort($opcoes, function ($a, $b) {
            return ($a['turnos'] <=> $b['turnos']) ?: ($b['casaFinal'] <=> $a['casaFinal']);
        });
        return $opcoes;
    }

    // Dificuldades: todos usam a mesma tabela; o que muda é o quanto erram.
    //  - difícil: sempre a jogada com menos turnos;
    //  - médio e fácil: sorteiam entre as jogadas SEGURAS (sem derrapagem) que
    //    deixam no máximo BOT_TOLERANCIA turnos a mais que a melhor. Assim erram
    //    de propósito, mas nunca de um jeito suicida.
    public static function escolherJogada(Partida $partida, Carro $carro): array
    {
        $opcoes = self::avaliarOpcoes($partida, $carro);
        $melhor = $opcoes[0];
        $tolerancia = REGRAS['BOT_TOLERANCIA'][$carro->dificuldade ?? ''] ?? 0;
        if ($tolerancia == 0 || $melhor['turnos'] == 0) return $melhor;

        $parecidas = array_values(array_filter($opcoes, function ($op) use ($melhor, $tolerancia) {
            return !$op['derrapa'] && $op['turnos'] <= $melhor['turnos'] + $tolerancia;
        }));
        if (count($parecidas) === 0) return $melhor;
        return $parecidas[(int) floor($partida->sorteio->proximo() * count($parecidas))];
    }
}
