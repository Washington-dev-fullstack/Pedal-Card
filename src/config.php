<?php
/* =====================================================================
   config.php — Configurações do back-end (Fase 2)
   ---------------------------------------------------------------------
   1. Credenciais do banco (padrão do XAMPP: usuário root, sem senha).
   2. As MESMAS regras do js/config.js. O servidor é a autoridade: na
      Fase 2 valem os números daqui (e as pistas do banco), não os do
      navegador. Se mudar uma regra, mude nos dois arquivos para o mock
      e o PHP continuarem jogando igual (o teste de paridade confere).
   ===================================================================== */

// ---- Banco de dados (MySQL/MariaDB do XAMPP) ----
const DB_HOST    = '127.0.0.1';
const DB_PORTA   = 3306;
const DB_NOME    = 'pedal_card';
const DB_USUARIO = 'root';
const DB_SENHA   = '';

// ---- Regras do jogo (seção 5 do briefing; espelho do js/config.js) ----
const REGRAS = [
    'TOTAL_CASAS' => 48,              // casas 0 a 47; chegar na 47 termina a corrida

    // Pista sorteada: cada partida ganha curvas, limites e formato novos.
    // false = sempre a pista clássica (semente 1, gravada no banco pelo .sql).
    'PISTA_ALEATORIA' => true,
    'PISTA_SORTEIO' => [
        'CURVAS_MIN' => 4,
        'CURVAS_MAX' => 6,
        'PRIMEIRA_CURVA_MIN' => 6,    // longe do grid de largada (casas 0 a 2)
        'ULTIMA_CURVA_MAX' => 42,     // deixa uma reta antes da chegada
        'DISTANCIA_MIN' => 5,         // casas entre uma curva e a próxima
        'DISTANCIA_MAX' => 13,
        'RETA_LARGADA_MAX' => 16,     // da última curva até a primeira, passando pela largada
        'LIMITE_MIN' => 3,
        'LIMITE_MAX' => 6,
    ],
    'NOMES_CIRCUITOS' => [
        'Circuito da Serra', 'Anel do Porto', 'Autódromo das Dunas', 'Circuito do Vale',
        'Traçado da Lagoa', 'Circuito do Cerrado', 'Anel da Represa', 'Circuito dos Pinhais',
    ],

    // Pista clássica (semente 1). No jogo de verdade ela vem do banco
    // (tabelas pistas e pista_curvas); esta cópia serve para os testes sem banco.
    'CURVAS' => [
        ['casa' => 10, 'limite' => 5],
        ['casa' => 18, 'limite' => 4],
        ['casa' => 26, 'limite' => 6],
        ['casa' => 34, 'limite' => 3],
        ['casa' => 41, 'limite' => 5],
    ],
    'VALORES_VELOCIDADE' => [1, 2, 3, 4], // valores das cartas de Velocidade
    'COPIAS_POR_VALOR' => 3,              // 3 cartas de cada valor = 12 cartas
    'CALOR_MOTOR' => 6,                   // cartas de Calor no motor no início
    'TAMANHO_MAO' => 7,
    'MARCHA_MIN' => 1,
    'MARCHA_MAX' => 4,
    'MARCHA_INICIAL' => 1,
    'PONTOS_POR_COLOCACAO' => [3, 2, 1],  // 1º, 2º e 3º lugar

    // Rastro (vácuo): quem termina o movimento colado atrás de outro carro
    // é puxado até esta quantidade de casas, sem atravessar curva.
    'VACUO_CASAS' => 3,

    // Bots (ver Bots.php)
    'BOT_MAOS_EXEMPLO' => 16,             // mãos de exemplo usadas para montar a tabela
    // Erro de propósito, em turnos: o bot sorteia entre as jogadas seguras que
    // deixam no máximo esta quantidade de turnos a mais que a melhor.
    'BOT_TOLERANCIA' => ['facil' => 1.2, 'medio' => 0.8, 'dificil' => 0],
];

// Aparência dos carros: cor + forma + número (acessibilidade: nunca só cor).
// O carro 1 é sempre o humano (o nome dele vem da tela inicial).
const CARROS_VISUAL = [
    ['nome' => 'Você',     'cor' => '#1F6FA0', 'forma' => 'circulo'],
    ['nome' => 'Bot Alfa', 'cor' => '#C63A2B', 'forma' => 'triangulo'],
    ['nome' => 'Bot Beta', 'cor' => '#2A9D5C', 'forma' => 'quadrado'],
];
