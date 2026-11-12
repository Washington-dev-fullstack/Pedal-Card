<?php
/* =====================================================================
   Sorteio.php — Gerador de números "aleatórios" com semente
   ---------------------------------------------------------------------
   É o mesmo gerador do mock-engine.js (mulberry32), conta por conta.
   Mesma semente = mesma sequência, no navegador e no PHP. Por isso a
   mesma semente gera a mesma pista, o mesmo grid e os mesmos baralhos
   nos dois lados (o teste de paridade confere isso).

   O estado do gerador é um único número inteiro, gravado na coluna
   partidas.gerador: a cada requisição a partida continua o sorteio de
   onde parou, como se o PHP nunca tivesse sido desligado.
   ===================================================================== */

class Sorteio
{
    public int $estado;   // inteiro de 32 bits sem sinal (0 a 4294967295)

    public function __construct(int $semente)
    {
        $this->estado = $semente & 0xFFFFFFFF;
    }

    // Número de 0 (incluso) a 1 (excluso).
    // O JavaScript faz estas contas em 32 bits; no PHP os inteiros têm
    // 64 bits, então "& 0xFFFFFFFF" corta o resultado para 32 bits.
    public function proximo(): float
    {
        $a = ($this->estado + 0x6D2B79F5) & 0xFFFFFFFF;
        $this->estado = $a;
        $t = self::multiplicar32($a ^ ($a >> 15), 1 | $a);
        $t = (($t + self::multiplicar32($t ^ ($t >> 7), 61 | $t)) & 0xFFFFFFFF) ^ $t;
        return (($t ^ ($t >> 14)) & 0xFFFFFFFF) / 4294967296;
    }

    // Inteiro sorteado de $min a $max (os dois inclusos).
    public function entre(int $min, int $max): int
    {
        return $min + (int) floor($this->proximo() * ($max - $min + 1));
    }

    // Embaralhamento de Fisher-Yates: cada ordem tem a mesma chance.
    // Devolve a lista embaralhada (arrays do PHP são copiados, não compartilhados).
    public function embaralhar(array $lista): array
    {
        for ($i = count($lista) - 1; $i > 0; $i--) {
            $j = (int) floor($this->proximo() * ($i + 1));
            $temp = $lista[$i];
            $lista[$i] = $lista[$j];
            $lista[$j] = $temp;
        }
        return $lista;
    }

    // Equivalente ao Math.imul do JavaScript: multiplica dois números de
    // 32 bits e fica só com os 32 bits de baixo. A conta é feita em
    // pedaços de 16 bits para o produto nunca estourar os 64 bits do PHP.
    private static function multiplicar32(int $a, int $b): int
    {
        $aAlto = ($a >> 16) & 0xFFFF;
        $aBaixo = $a & 0xFFFF;
        $bAlto = ($b >> 16) & 0xFFFF;
        $bBaixo = $b & 0xFFFF;
        $meio = (($aAlto * $bBaixo + $aBaixo * $bAlto) & 0xFFFF) << 16;
        return ($aBaixo * $bBaixo + $meio) & 0xFFFFFFFF;
    }
}
