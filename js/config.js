/* =====================================================================
   config.js — Configurações gerais do Pedal Card
   ---------------------------------------------------------------------
   Todos os números "ajustáveis" do jogo ficam aqui, num lugar só.
   Na Fase 2 (PHP + MySQL) o servidor passa a ser a fonte das regras e
   basta trocar USE_MOCK para false.
   ===================================================================== */

var CONFIG = {
  // true  = usa a API simulada (mock-api.js), roda só no navegador
  // false = usa o back-end PHP de verdade (Fase 2)
  USE_MOCK: true,

  // Endereço da pasta /api do back-end (usado só quando USE_MOCK = false)
  API_URL: 'api/',

  // Atraso simulado da "rede" no mock, em milissegundos
  ATRASO_MIN: 300,
  ATRASO_MAX: 600,

  // ---- Regras do jogo (seção 5 do briefing) ----
  REGRAS: {
    TOTAL_CASAS: 48,              // casas 0 a 47; chegar na 47 termina a corrida

    // Pista sorteada: cada partida ganha curvas, limites e formato novos.
    // false = sempre a pista clássica (CURVAS logo abaixo).
    PISTA_ALEATORIA: true,
    PISTA_SORTEIO: {
      CURVAS_MIN: 4,
      CURVAS_MAX: 6,
      PRIMEIRA_CURVA_MIN: 6,      // longe do grid de largada (casas 0 a 2)
      ULTIMA_CURVA_MAX: 42,       // deixa uma reta antes da chegada
      DISTANCIA_MIN: 5,           // casas entre uma curva e a próxima
      DISTANCIA_MAX: 13,
      RETA_LARGADA_MAX: 16,       // da última curva até a primeira, passando pela largada
      LIMITE_MIN: 3,
      LIMITE_MAX: 6
    },
    NOMES_CIRCUITOS: [
      'Circuito da Serra', 'Anel do Porto', 'Autódromo das Dunas', 'Circuito do Vale',
      'Traçado da Lagoa', 'Circuito do Cerrado', 'Anel da Represa', 'Circuito dos Pinhais'
    ],

    // Pista clássica (usada quando PISTA_ALEATORIA = false e nos testes)
    CURVAS: [
      { casa: 10, limite: 5 },
      { casa: 18, limite: 4 },
      { casa: 26, limite: 6 },
      { casa: 34, limite: 3 },
      { casa: 41, limite: 5 }
    ],
    VALORES_VELOCIDADE: [1, 2, 3, 4], // valores das cartas de Velocidade
    COPIAS_POR_VALOR: 3,              // 3 cartas de cada valor = 12 cartas
    CALOR_MOTOR: 6,                   // cartas de Calor no motor no início
    TAMANHO_MAO: 7,
    MARCHA_MIN: 1,
    MARCHA_MAX: 4,
    MARCHA_INICIAL: 1,
    PONTOS_POR_COLOCACAO: [3, 2, 1],  // 1º, 2º e 3º lugar

    // Rastro (o vácuo do Pedal Card): quem termina o movimento colado atrás
    // de outro carro é puxado até esta quantidade de casas, sem atravessar curva.
    VACUO_CASAS: 3,

    // Bots (ver "Bots: tabela de turnos" em mock-engine.js)
    BOT_MAOS_EXEMPLO: 16,             // mãos de exemplo usadas para montar a tabela
    // Erro de propósito, em turnos: o bot sorteia entre as jogadas seguras que
    // deixam no máximo esta quantidade de turnos a mais que a melhor.
    BOT_TOLERANCIA: { facil: 1.2, medio: 0.8, dificil: 0 }
  },

  // Aparência dos carros: cor + forma + número (acessibilidade: nunca só cor).
  // "pintura" escolhe as imagens renderizadas no Blender (assets/carros/carro-<pintura>-*.webp);
  // a interface encontra a pintura pela cor do carro, então a API não muda.
  CARROS_VISUAL: [
    { nome: 'Você',     cor: '#1F6FA0', forma: 'circulo',   pintura: 'azul' },     // azul petróleo
    { nome: 'Bot Alfa', cor: '#C63A2B', forma: 'triangulo', pintura: 'vermelho' }, // vermelho corrida
    { nome: 'Bot Beta', cor: '#2A9D5C', forma: 'quadrado',  pintura: 'verde' }     // verde-bandeira
  ],

  // Velocidade das animações da interface
  ANIMACAO: {
    MS_POR_CASA: 120,   // tempo para o carro andar uma casa
    PAUSA_EVENTO: 220,  // pausa entre um evento e outro
    PAUSA_TROCA_VEZ: 450
  }
};
