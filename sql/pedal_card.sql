-- =====================================================================
-- pedal_card.sql — Banco de dados do Pedal Card (Fase 2)
-- ---------------------------------------------------------------------
-- Recria TUDO do zero: apaga o banco "pedal_card" (se existir), cria as
-- 7 tabelas com chaves primárias e estrangeiras e insere os dados de
-- teste (pista clássica + algumas corridas para o ranking não ficar vazio).
--
-- Como usar no XAMPP: phpMyAdmin > aba "Importar" > escolher este arquivo
-- > "Executar". Ou no terminal: mysql -u root < sql/pedal_card.sql
--
-- ATENÇÃO: rodar de novo APAGA todas as partidas gravadas.
-- =====================================================================

DROP DATABASE IF EXISTS pedal_card;
CREATE DATABASE pedal_card CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pedal_card;

-- ---------------------------------------------------------------------
-- jogadores: quem jogou. O nome é único (sem diferenciar maiúsculas):
-- jogar de novo com o mesmo nome soma no mesmo jogador do ranking.
-- ---------------------------------------------------------------------
CREATE TABLE jogadores (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome       VARCHAR(20)  NOT NULL,
    criado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_jogadores_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- pistas: cada traçado. A semente identifica a pista (a mesma semente
-- gera sempre a mesma pista, aqui e no desenho da interface).
-- A semente 1 é a pista clássica do briefing.
-- ---------------------------------------------------------------------
CREATE TABLE pistas (
    id           INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    nome         VARCHAR(60)      NOT NULL,
    semente      INT UNSIGNED     NOT NULL,
    total_casas  TINYINT UNSIGNED NOT NULL DEFAULT 48,
    criada_em    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pistas_semente (semente),
    CONSTRAINT ck_pistas_casas CHECK (total_casas BETWEEN 20 AND 200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- pista_curvas: as curvas de cada pista (casa + limite de velocidade).
-- Mudar um limite aqui muda o jogo nas próximas partidas dessa pista.
-- ---------------------------------------------------------------------
CREATE TABLE pista_curvas (
    id        INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    pista_id  INT UNSIGNED     NOT NULL,
    casa      TINYINT UNSIGNED NOT NULL,
    limite    TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_curva_casa (pista_id, casa),          -- uma curva por casa
    CONSTRAINT fk_curvas_pista FOREIGN KEY (pista_id) REFERENCES pistas (id) ON DELETE CASCADE,
    CONSTRAINT ck_curvas_limite CHECK (limite BETWEEN 1 AND 16)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- partidas: uma corrida.
--   semente / gerador: o sorteio da partida (gerador = estado atual dele,
--                      para a corrida continuar o sorteio de onde parou)
--   vez: ordem (carros.ordem_turno) do carro que joga agora
--   vencedor_carro_id: preenchido quando a corrida termina
-- ---------------------------------------------------------------------
CREATE TABLE partidas (
    id                 INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    pista_id           INT UNSIGNED      NOT NULL,
    semente            INT UNSIGNED      NOT NULL,
    gerador            INT UNSIGNED      NOT NULL,
    status             ENUM('em_andamento', 'finalizada') NOT NULL DEFAULT 'em_andamento',
    rodada             SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    vez                TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    vencedor_carro_id  INT UNSIGNED      NULL,
    criada_em          DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizada_em      DATETIME          NULL,
    PRIMARY KEY (id),
    KEY ix_partidas_status (status),
    CONSTRAINT fk_partidas_pista FOREIGN KEY (pista_id) REFERENCES pistas (id)
    -- a chave estrangeira do vencedor é criada no fim do arquivo (carros ainda não existe)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- carros: os carros de cada partida (1 humano + 1 ou 2 bots).
--   jogador_id: dono do carro humano (NULL nos bots)
--   numero / cor / forma: identificação visual (nunca só pela cor)
--   chegada_posicao / pontos: preenchidos no fim da corrida
-- ---------------------------------------------------------------------
CREATE TABLE carros (
    id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    partida_id       INT UNSIGNED      NOT NULL,
    jogador_id       INT UNSIGNED      NULL,
    tipo             ENUM('humano', 'bot') NOT NULL,
    nome             VARCHAR(20)       NOT NULL,
    dificuldade      ENUM('facil', 'medio', 'dificil') NULL,
    cor              CHAR(7)           NOT NULL,
    forma            VARCHAR(12)       NOT NULL,
    numero           TINYINT UNSIGNED  NOT NULL,
    posicao          TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    marcha           TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    ordem_turno      TINYINT UNSIGNED  NOT NULL,
    derrapagens      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    chegada_posicao  TINYINT UNSIGNED  NULL,
    pontos           TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_carro_numero (partida_id, numero),
    KEY ix_carros_jogador (jogador_id),
    CONSTRAINT fk_carros_partida FOREIGN KEY (partida_id) REFERENCES partidas (id) ON DELETE CASCADE,
    CONSTRAINT fk_carros_jogador FOREIGN KEY (jogador_id) REFERENCES jogadores (id),
    CONSTRAINT ck_carros_marcha CHECK (marcha BETWEEN 1 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- cartas: as 18 cartas de cada carro (12 de Velocidade + 6 de Calor).
--   zona: em que pilha a carta está agora (compra, mão, descarte, motor)
--   ordem: posição dentro da pilha (a maior é o topo do baralho)
-- ---------------------------------------------------------------------
CREATE TABLE cartas (
    id        INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    carro_id  INT UNSIGNED     NOT NULL,
    tipo      ENUM('velocidade', 'calor') NOT NULL,
    valor     TINYINT UNSIGNED NOT NULL,
    zona      ENUM('compra', 'mao', 'descarte', 'motor') NOT NULL,
    ordem     TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    KEY ix_cartas_pilha (carro_id, zona, ordem),
    CONSTRAINT fk_cartas_carro FOREIGN KEY (carro_id) REFERENCES carros (id) ON DELETE CASCADE,
    CONSTRAINT ck_cartas_valor CHECK ((tipo = 'calor' AND valor = 0) OR (tipo = 'velocidade' AND valor BETWEEN 1 AND 4))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- jogadas: o histórico, uma linha por turno de cada carro.
-- ---------------------------------------------------------------------
CREATE TABLE jogadas (
    id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    partida_id       INT UNSIGNED      NOT NULL,
    carro_id         INT UNSIGNED      NOT NULL,
    rodada           SMALLINT UNSIGNED NOT NULL,
    marcha           TINYINT UNSIGNED  NOT NULL,
    velocidade       TINYINT UNSIGNED  NOT NULL,
    posicao_inicial  TINYINT UNSIGNED  NOT NULL,
    posicao_final    TINYINT UNSIGNED  NOT NULL,
    calor_pago       TINYINT UNSIGNED  NOT NULL DEFAULT 0,
    derrapou         BOOLEAN           NOT NULL DEFAULT FALSE,
    criada_em        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_jogadas_partida (partida_id),
    CONSTRAINT fk_jogadas_partida FOREIGN KEY (partida_id) REFERENCES partidas (id) ON DELETE CASCADE,
    CONSTRAINT fk_jogadas_carro FOREIGN KEY (carro_id) REFERENCES carros (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O vencedor da partida é um carro dela (relação opcional: NULL até alguém chegar)
ALTER TABLE partidas
    ADD CONSTRAINT fk_partidas_vencedor FOREIGN KEY (vencedor_carro_id) REFERENCES carros (id) ON DELETE SET NULL;


-- =====================================================================
-- DADOS DE TESTE
-- =====================================================================

-- Pista clássica do briefing: 48 casas e 5 curvas
INSERT INTO pistas (id, nome, semente, total_casas) VALUES (1, 'Circuito da Serra', 1, 48);
INSERT INTO pista_curvas (pista_id, casa, limite) VALUES
    (1, 10, 5), (1, 18, 4), (1, 26, 6), (1, 34, 3), (1, 41, 5);

-- Pilotos de exemplo (os mesmos do ranking do mock da Fase 1)
INSERT INTO jogadores (id, nome) VALUES (1, 'Ana Turbo'), (2, 'Rafa Nitro'), (3, 'Lia Drift');

-- Cinco corridas já terminadas (só o resultado: sem cartas nem jogadas)
INSERT INTO partidas (id, pista_id, semente, gerador, status, rodada, vez, criada_em, finalizada_em) VALUES
    (1, 1, 101, 101, 'finalizada',  8, 1, '2026-10-01 19:00:00', '2026-10-01 19:09:00'),
    (2, 1, 102, 102, 'finalizada',  9, 1, '2026-10-02 19:00:00', '2026-10-02 19:10:00'),
    (3, 1, 103, 103, 'finalizada', 10, 1, '2026-10-03 19:00:00', '2026-10-03 19:11:00'),
    (4, 1, 104, 104, 'finalizada',  9, 1, '2026-10-04 19:00:00', '2026-10-04 19:10:00'),
    (5, 1, 105, 105, 'finalizada', 11, 1, '2026-10-05 19:00:00', '2026-10-05 19:12:00');

INSERT INTO carros (id, partida_id, jogador_id, tipo, nome, dificuldade, cor, forma, numero,
                    posicao, marcha, ordem_turno, derrapagens, chegada_posicao, pontos) VALUES
    -- Partida 1: Ana vence em 8 rodadas
    ( 1, 1, 1,    'humano', 'Ana Turbo',  NULL,    '#1F6FA0', 'circulo',   1, 47, 4, 1, 0, 1, 3),
    ( 2, 1, NULL, 'bot',    'Bot Alfa',   'medio', '#C63A2B', 'triangulo', 2, 44, 3, 2, 0, 2, 2),
    ( 3, 1, NULL, 'bot',    'Bot Beta',   'medio', '#2A9D5C', 'quadrado',  3, 41, 3, 3, 1, 3, 1),
    -- Partida 2: Ana vence em 9 rodadas
    ( 4, 2, 1,    'humano', 'Ana Turbo',  NULL,    '#1F6FA0', 'circulo',   1, 47, 3, 1, 0, 1, 3),
    ( 5, 2, NULL, 'bot',    'Bot Alfa',   'medio', '#C63A2B', 'triangulo', 2, 40, 2, 3, 1, 3, 1),
    ( 6, 2, NULL, 'bot',    'Bot Beta',   'medio', '#2A9D5C', 'quadrado',  3, 45, 3, 2, 0, 2, 2),
    -- Partida 3: Rafa vence em 10 rodadas
    ( 7, 3, 2,    'humano', 'Rafa Nitro', NULL,    '#1F6FA0', 'circulo',   1, 47, 3, 1, 1, 1, 3),
    ( 8, 3, NULL, 'bot',    'Bot Alfa',   'facil', '#C63A2B', 'triangulo', 2, 43, 3, 2, 0, 2, 2),
    ( 9, 3, NULL, 'bot',    'Bot Beta',   'facil', '#2A9D5C', 'quadrado',  3, 39, 2, 3, 2, 3, 1),
    -- Partida 4: Rafa termina em 3º (Bot Alfa vence)
    (10, 4, 2,    'humano', 'Rafa Nitro', NULL,    '#1F6FA0', 'circulo',   1, 42, 2, 3, 2, 3, 1),
    (11, 4, NULL, 'bot',    'Bot Alfa',   'dificil', '#C63A2B', 'triangulo', 2, 47, 4, 1, 0, 1, 3),
    (12, 4, NULL, 'bot',    'Bot Beta',   'dificil', '#2A9D5C', 'quadrado',  3, 46, 3, 2, 0, 2, 2),
    -- Partida 5: Lia termina em 2º (Bot Beta vence)
    (13, 5, 3,    'humano', 'Lia Drift',  NULL,    '#1F6FA0', 'circulo',   1, 45, 3, 2, 1, 2, 2),
    (14, 5, NULL, 'bot',    'Bot Alfa',   'medio', '#C63A2B', 'triangulo', 2, 44, 3, 3, 1, 3, 1),
    (15, 5, NULL, 'bot',    'Bot Beta',   'medio', '#2A9D5C', 'quadrado',  3, 47, 4, 1, 0, 1, 3);

UPDATE partidas SET vencedor_carro_id = 1  WHERE id = 1;
UPDATE partidas SET vencedor_carro_id = 4  WHERE id = 2;
UPDATE partidas SET vencedor_carro_id = 7  WHERE id = 3;
UPDATE partidas SET vencedor_carro_id = 11 WHERE id = 4;
UPDATE partidas SET vencedor_carro_id = 15 WHERE id = 5;


-- =====================================================================
-- CONSULTAS DE EXEMPLO (para mostrar no phpMyAdmin na apresentação)
-- =====================================================================

-- Ranking (consulta agregada obrigatória, a mesma do api/ranking.php):
-- vitórias e corrida mais rápida (menos rodadas) de cada piloto humano.
SELECT j.nome,
       COUNT(*)                                               AS corridas,
       SUM(c.chegada_posicao = 1)                             AS vitorias,
       MIN(CASE WHEN c.chegada_posicao = 1 THEN p.rodada END) AS melhor_rodada
  FROM carros c
  JOIN jogadores j ON j.id = c.jogador_id
  JOIN partidas p  ON p.id = c.partida_id AND p.status = 'finalizada'
 WHERE c.tipo = 'humano'
 GROUP BY j.id, j.nome
 ORDER BY vitorias DESC, melhor_rodada ASC
 LIMIT 10;

-- Outras consultas úteis (descomente para testar):
-- Histórico de uma partida:
--   SELECT j.rodada, c.nome, j.marcha, j.velocidade, j.posicao_inicial, j.posicao_final, j.calor_pago, j.derrapou
--     FROM jogadas j JOIN carros c ON c.id = j.carro_id WHERE j.partida_id = 6 ORDER BY j.id;
-- Onde estão as cartas de um carro:
--   SELECT zona, COUNT(*) AS cartas, SUM(tipo = 'calor') AS calor FROM cartas WHERE carro_id = 16 GROUP BY zona;
-- Curvas que mais causaram derrapagem:
--   SELECT pc.casa, pc.limite, COUNT(*) AS derrapagens
--     FROM jogadas j JOIN partidas p ON p.id = j.partida_id
--     JOIN pista_curvas pc ON pc.pista_id = p.pista_id AND pc.casa = (SELECT MIN(casa) FROM pista_curvas WHERE pista_id = p.pista_id AND casa > j.posicao_final)
--    WHERE j.derrapou GROUP BY pc.id ORDER BY derrapagens DESC;
