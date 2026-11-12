# Pedal Card

Corrida de cartas inspirada em *Heat: Pedal to the Metal* (regras e arte próprias).
Hackathon "Do Tabuleiro ao Digital": HTML + CSS + JavaScript puro no front-end, PHP 8 + PDO + MySQL no back-end.

## Duas formas de rodar

| Modo | `USE_MOCK` em `js/config.js` | Como abrir | Onde ficam os dados |
|---|---|---|---|
| **Fase 1 (mock)** | `true` | duplo clique no `index.html` | na memória do navegador (somem ao recarregar) |
| **Fase 2 (PHP + MySQL)** | `false` | `http://localhost/pedal-card/` pelo XAMPP | no banco `pedal_card` |

A interface é a mesma nos dois modos: ela só chama as funções do `js/api.js`, que decide
se fala com o mock (`js/mock-api.js`) ou com o PHP (`api/*.php`).

## Instalar a Fase 2 no XAMPP

1. Copie a pasta do projeto para `C:\xampp\htdocs\pedal-card`.
2. No **XAMPP Control Panel**, clique em **Start** no Apache e no MySQL.
3. Abra `http://localhost/phpmyadmin` > aba **Importar** > escolha `sql/pedal_card.sql` > **Executar**.
   O script cria o banco `pedal_card` do zero, com as 7 tabelas, a pista clássica e algumas corridas de exemplo.
   (Rodar de novo apaga tudo e recria.)
4. Em `js/config.js`, troque `USE_MOCK: true` por `USE_MOCK: false`.
5. Abra `http://localhost/pedal-card/` e jogue.

Se o seu MySQL tiver senha ou outra porta, ajuste `src/config.php` (padrão do XAMPP: `root`, sem senha, porta 3306).

## Testes

| O que | Como |
|---|---|
| Back-end inteiro (paridade com o mock, regras, invariantes e banco) | `http://localhost/pedal-card/testes/simular_corridas.php` ou, no terminal, `C:\xampp\php\php.exe testes\simular_corridas.php` |
| Motor JavaScript (Fase 1) e relatório de equilíbrio | `testes.html` |
| Referência de paridade (só se mudar regras no `js/config.js`) | `testes/gerar-paridade.html`, e salve o arquivo baixado em `testes/paridade-mock.json` |

O `simular_corridas.php` roda dentro de uma transação desfeita no final: não deixa nada no banco.
Opções: `?corridas=100` (quantas corridas simular) e `?banco=0` (pular a parte do banco).

## Estrutura

```
index.html, css/, js/, assets/, audio/   interface (Fase 1, não mudou na Fase 2)
api/        endpoints finos (um arquivo por rota do contrato da seção 6 do briefing)
src/        config.php (banco + regras), Db.php (PDO), Api.php (resposta JSON e erros),
            Jogo.php (o que cada endpoint faz), Regras.php (regras), Bots.php (bots),
            Repositorio.php (todo o SQL), Modelos.php (Carta, Carro, Partida), Sorteio.php
sql/        pedal_card.sql: cria o banco do zero + dados de teste + consulta de ranking
testes/     simular_corridas.php, gerar-paridade.html, paridade-mock.json
cache/      tabelas prontas dos bots (geradas sozinhas; pode apagar quando quiser)
```

## Rotas da API

| Rota | Entrada | Saída |
|---|---|---|
| `POST api/iniciar_partida.php` | `nome_jogador`, `num_bots`, `dificuldade` | estado completo + `eventos` |
| `GET api/estado.php?partida_id=` | `partida_id` | estado completo |
| `POST api/prever_jogada.php` | `partida_id`, `marcha`, `cartas[]` | velocidade, destino, Calor previsto, derrapa (não grava nada) |
| `POST api/jogar_turno.php` | `partida_id`, `marcha`, `cartas[]` | `eventos[]` + `estado` (turno do humano e depois dos bots) |
| `GET api/ranking.php?limite=` | `limite` | jogadores com corridas, vitórias e melhor rodada |
| `GET api/historico.php?partida_id=` | `partida_id` | jogadas da partida |

Toda resposta tem `ok`. Em erro: `{"ok": false, "erro": {"codigo": "...", "mensagem": "..."}}`
(códigos como `MARCHA_INVALIDA`, `CARTAS_INVALIDAS`, `NAO_E_SEU_TURNO`, `PARTIDA_ENCERRADA`,
`PARTIDA_NAO_ENCONTRADA`, `ERRO_BANCO`).

## Banco de dados

`jogadores` 1:N `carros` · `pistas` 1:N `pista_curvas` · `pistas` 1:N `partidas` ·
`partidas` 1:N `carros` · `carros` 1:N `cartas` · `partidas`/`carros` 1:N `jogadas` ·
`partidas.vencedor_carro_id` → `carros` (opcional).

A consulta agregada obrigatória é o ranking (`GROUP BY` por jogador com `COUNT`, `SUM` e `MIN`),
no `src/Repositorio.php` e no fim do `sql/pedal_card.sql`.

## Decisões técnicas (para a apresentação)

- **O servidor é a autoridade.** O navegador envia só a marcha e os ids das cartas. O PHP confere se é a vez
  do jogador, se as cartas estão na mão dele e se a marcha é permitida; posição, velocidade e Calor são
  sempre calculados no servidor.
- **Turno inteiro numa transação.** O turno do humano e os dos bots são gravados juntos (ou nada é gravado).
  `SELECT ... FOR UPDATE` trava a partida, então dois cliques em "Acelerar" não jogam o mesmo turno duas vezes.
- **Prepared statements em todo SQL** (`?` no lugar dos valores): sem SQL injection.
- **Mesmo motor nos dois lados.** `src/Regras.php` e `src/Bots.php` são a tradução do `js/mock-engine.js`,
  com o mesmo gerador de sorteio com semente. O teste de paridade prova que o PHP joga exatamente igual ao mock.
- **Sorteio que continua de onde parou.** O estado do gerador fica em `partidas.gerador`; cada requisição continua
  o sorteio, então uma corrida gravada no banco é idêntica à mesma corrida jogada só em memória.
- **Desempenho.** A "tabela de turnos" dos bots é montada uma vez por pista (na largada) e guardada em `cache/`;
  ao gravar, o PHP só atualiza as cartas que mudaram de pilha.

## Problemas comuns

- **"Não foi possível acessar o banco de dados"**: o MySQL do XAMPP está parado ou o `sql/pedal_card.sql` não foi importado.
- **"Não foi possível falar com o servidor"** com `USE_MOCK: false`: o jogo foi aberto com duplo clique.
  Na Fase 2 ele precisa ser aberto pelo endereço `http://localhost/pedal-card/`.
- **Mudou uma regra?** Mude em `js/config.js` **e** em `src/config.php` (o teste de paridade avisa se ficarem diferentes).
