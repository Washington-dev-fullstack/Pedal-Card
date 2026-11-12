/* =====================================================================
   ui-pista.js — Maquete da pista, carros e animações (SVG)
   ---------------------------------------------------------------------
   Como funciona:
   1. O traçado é UM <path> com um canto arredondado por curva. Os cantos
      são sorteados a partir da "semente" da pista, então cada partida
      tem um formato diferente (a mesma semente sempre dá o mesmo desenho).
   2. Cada casa é um ponto ao longo do traçado, obtido com
      getPointAtLength(). As casas de curva ficam exatamente no meio
      de cada canto ("âncoras"); as outras são distribuídas entre elas.
   3. A maquete é desenhada em DUAS camadas SVG empilhadas (mesmo viewBox):
      - #pista: a parte parada (grama, asfalto, zebras, placas, cenário);
      - #pista-pecas: o que se mexe (carros, previsão, efeitos).
      Assim, um carro andando não obriga o navegador a redesenhar a maquete.
   4. Carros, árvores, arquibancadas etc. são imagens renderizadas no
      Blender (pasta assets/). A sombra de cada objeto é feita aqui, sempre
      deslocada para baixo e para a direita (a luminária fica no alto à
      esquerda), mesmo quando o carro gira.
   ===================================================================== */

var UIPista = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var LARGURA_PISTA = 62;                 // largura do asfalto com as faixas brancas
  var PASTA = 'assets/';
  var SOMBRA_CARRO = { dx: 4, dy: 6 };    // a luz vem do alto à esquerda
  var LIMITE_OBJETOS = 35;                // máximo de objetos de cenário na maquete
  var TAMANHO_CARRO = { w: 64, h: 36 };   // imagem do carro em unidades da pista
  var LARGURA_TABULEIRO = 1000;           // largura do viewBox das duas camadas SVG (index.html)

  // Traçado desenhado à mão da pista clássica (semente 1).
  // Um vértice por curva; "raio" arredonda o canto.
  var VERTICES_CLASSICOS = [
    { x: 937, y: 70,  raio: 120 },  // curva da casa 10
    { x: 834, y: 452, raio: 120 },  // curva da casa 18
    { x: 471, y: 616, raio: 170 },  // curva da casa 26 (a mais aberta)
    { x: 128, y: 420, raio: 60 },   // curva da casa 34 (o grampo)
    { x: 66,  y: 80,  raio: 120 }   // curva da casa 41
  ];

  // Cenário: tamanho de cada imagem em unidades da pista (1 metro = 11,8 unidades)
  var OBJETOS = {
    arvore1:      { img: 'pista/arvore-1.webp', w: 50, h: 50, raio: 18, altura: 1.6 },
    arvore2:      { img: 'pista/arvore-2.webp', w: 50, h: 50, raio: 13, altura: 1.3 },
    arvore3:      { img: 'pista/arvore-3.webp', w: 50, h: 50, raio: 20, altura: 1.5 },
    araucaria1:   { img: 'pista/araucaria-1.webp', w: 54, h: 54, raio: 22, altura: 2.4 },
    araucaria2:   { img: 'pista/araucaria-2.webp', w: 54, h: 54, raio: 19, altura: 2.2 },
    cerrado1:     { img: 'pista/cerrado-1.webp', w: 50, h: 50, raio: 16, altura: 1.4 },
    cerrado2:     { img: 'pista/cerrado-2.webp', w: 50, h: 50, raio: 16, altura: 1.4 },
    coqueiro:     { img: 'pista/coqueiro.webp', w: 59, h: 59, raio: 20, altura: 2.2 },
    restinga:     { img: 'pista/restinga.webp', w: 35, h: 35, raio: 12, altura: 0.6 },
    arquibancada: { img: 'pista/arquibancada.webp', w: 148, h: 49, altura: 1.4 },
    boxes:        { img: 'pista/boxes.webp', w: 171, h: 45, altura: 1.2 },
    pneus:        { img: 'pista/pneus.webp', w: 35, h: 19, altura: 0.6 }
  };

  // Cada circuito tem um "bioma": muda o chão, as árvores e as manchas do terreno
  // (só a aparência; o motor e a API não sabem disso). "manchas": [escura, clara].
  var BIOMAS = {
    campo:   { terreno: 'pista/grama.webp',         arvores: ['arvore1', 'arvore2', 'arvore3'],       agua: false, manchas: ['#2E4416', '#9DBA5C'] },
    represa: { terreno: 'pista/grama.webp',         arvores: ['arvore1', 'arvore2', 'arvore3'],       agua: true,  manchas: ['#2E4416', '#9DBA5C'] },
    cerrado: { terreno: 'pista/capim-cerrado.webp', arvores: ['cerrado1', 'cerrado2', 'cerrado1'],    agua: false, manchas: ['#6A5226', '#D3BE78'] },
    pinhais: { terreno: 'pista/chao-pinhais.webp',  arvores: ['araucaria1', 'araucaria2', 'arvore3'], agua: false, manchas: ['#1E3014', '#6F8F4A'] },
    dunas:   { terreno: 'pista/areia.webp',         arvores: ['coqueiro', 'restinga', 'restinga'],    agua: false, manchas: ['#9C7E4C', '#F4E6C2'] }
  };

  var VERTICES = [];
  var svg = null;             // camada parada (#pista)
  var svgPecas = null;        // camada que se mexe (#pista-pecas)
  var trilha = null;          // o <path> principal (asfalto)
  var comprimentoTotal = 0;
  var ancoras = [];           // [{ casa, comprimento }]
  var pista = null;           // dados da pista vindos da API
  var centro = { x: 500, y: 345 };
  var camadas = {};
  var carros = {};            // carroId -> { grupo, corpo, sombra, giro, casa, ponto }
  var idHumano = null;
  var amostrasTrilha = [];    // pontos do eixo da pista (para medir distâncias)
  var contornoAgua = null;    // contorno do lago (circuitos da Lagoa e da Represa)

  /* ---------- Utilitários ---------- */

  // Cria um elemento SVG com atributos e já coloca dentro do "pai".
  function el(tag, atributos, pai) {
    var elemento = document.createElementNS(NS, tag);
    Object.keys(atributos || {}).forEach(function (nome) {
      elemento.setAttribute(nome, atributos[nome]);
    });
    if (pai) pai.appendChild(elemento);
    return elemento;
  }

  function texto(conteudo, atributos, pai) {
    var t = el('text', atributos, pai);
    t.textContent = conteudo;
    return t;
  }

  function imagem(caminho, w, h, pai, extra) {
    var atributos = { href: PASTA + caminho, x: f(-w / 2), y: f(-h / 2), width: w, height: h };
    Object.keys(extra || {}).forEach(function (k) { atributos[k] = extra[k]; });
    return el('image', atributos, pai);
  }

  function reduzirMovimento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function pausa(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function unitario(dx, dy) {
    var tamanho = Math.hypot(dx, dy) || 1;
    return { x: dx / tamanho, y: dy / tamanho };
  }

  function f(n) { return n.toFixed(1); }

  function graus(rad) { return rad * 180 / Math.PI; }

  /* ---------- Geometria do traçado ---------- */

  // Gerador de números "aleatórios" que sempre repete a mesma sequência
  // para a mesma semente (mulberry32).
  function geradorComSemente(semente) {
    var a = semente >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Um vértice por curva, em volta de uma elipse: o ângulo segue o número
  // da casa (a curva da casa 12 fica a 1/4 da volta) e a distância do centro
  // varia, o que deixa cada traçado com uma cara própria. No fim o desenho
  // é esticado para ocupar o tabuleiro inteiro.
  // Curvas mais fechadas (limite menor) ganham um canto mais apertado.
  function montarVertices() {
    if (pista.semente === 1 && pista.curvas.length === VERTICES_CLASSICOS.length) {
      return VERTICES_CLASSICOS.map(function (v) { return { x: v.x, y: v.y, raio: v.raio }; });
    }
    var aleatorio = geradorComSemente(pista.semente || 1);
    var curvas = pista.curvas.slice().sort(function (a, b) { return a.casa - b.casa; });
    var vertices = curvas.map(function (curva) {
      var angulo = -Math.PI / 2 + 2 * Math.PI * curva.casa / pista.total_casas + (aleatorio() - 0.5) * 0.25;
      var escala = 0.62 + aleatorio() * 0.38;
      return { x: Math.cos(angulo) * escala, y: Math.sin(angulo) * escala, raio: 40 + curva.limite * 22 };
    });

    // Estica para a área útil do tabuleiro (a mesma usada pela pista clássica)
    var xs = vertices.map(function (v) { return v.x; });
    var ys = vertices.map(function (v) { return v.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    vertices.forEach(function (v) {
      v.x = 70 + (v.x - minX) / (maxX - minX || 1) * 860;
      v.y = 72 + (v.y - minY) / (maxY - minY || 1) * 544;
    });
    return vertices;
  }

  // Monta o texto "d" do <path>: retas + cantos arredondados (curvas Q).
  function montarCaminho(inicio) {
    var partes = ['M' + f(inicio.x) + ' ' + f(inicio.y)];
    var total = VERTICES.length;
    VERTICES.forEach(function (v, i) {
      var anterior = VERTICES[(i - 1 + total) % total];
      var proximo = VERTICES[(i + 1) % total];
      var ida = unitario(anterior.x - v.x, anterior.y - v.y);
      var volta = unitario(proximo.x - v.x, proximo.y - v.y);
      // o canto não pode "comer" mais do que quase metade das retas vizinhas
      v.raio = Math.min(v.raio, 0.45 * Math.hypot(anterior.x - v.x, anterior.y - v.y), 0.45 * Math.hypot(proximo.x - v.x, proximo.y - v.y));
      var a = { x: v.x + ida.x * v.raio, y: v.y + ida.y * v.raio };
      var b = { x: v.x + volta.x * v.raio, y: v.y + volta.y * v.raio };
      v.apice = { x: 0.25 * a.x + 0.5 * v.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * v.y + 0.25 * b.y };
      partes.push('L' + f(a.x) + ' ' + f(a.y));
      partes.push('Q' + v.x + ' ' + v.y + ' ' + f(b.x) + ' ' + f(b.y));
    });
    partes.push('Z');
    return partes.join(' ');
  }

  // Encontra o comprimento do traçado mais próximo de um ponto,
  // procurando só depois de "aPartirDe" (as curvas vêm em ordem).
  function comprimentoMaisProximo(ponto, aPartirDe) {
    var melhor = aPartirDe;
    var menorDistancia = Infinity;
    for (var L = aPartirDe; L <= comprimentoTotal; L += 2) {
      var p = trilha.getPointAtLength(L);
      var d = Math.hypot(p.x - ponto.x, p.y - ponto.y);
      if (d < menorDistancia) { menorDistancia = d; melhor = L; }
    }
    return melhor;
  }

  // Âncoras ligam "número da casa" a "comprimento no traçado".
  function calcularAncoras() {
    ancoras = [{ casa: 0, comprimento: 0 }];
    var curvas = pista.curvas.slice().sort(function (a, b) { return a.casa - b.casa; });
    if (curvas.length === VERTICES.length) {
      var ultimo = 0;
      curvas.forEach(function (curva, i) {
        ultimo = comprimentoMaisProximo(VERTICES[i].apice, ultimo);
        ancoras.push({ casa: curva.casa, comprimento: ultimo });
      });
    }
    // Se a pista tiver outro número de curvas, as casas ficam só igualmente espaçadas.
    ancoras.push({ casa: pista.total_casas, comprimento: comprimentoTotal });
  }

  // Converte um número de casa (pode ser fracionado, ex.: 46.5) em comprimento.
  function comprimentoDaCasa(casa) {
    for (var i = 0; i < ancoras.length - 1; i++) {
      var a = ancoras[i];
      var b = ancoras[i + 1];
      if (casa <= b.casa) {
        return a.comprimento + (casa - a.casa) / (b.casa - a.casa) * (b.comprimento - a.comprimento);
      }
    }
    return comprimentoTotal;
  }

  // Ponto (x, y) e ângulo da pista em um comprimento.
  function pontoNoComprimento(L) {
    var normalizar = function (x) { return ((x % comprimentoTotal) + comprimentoTotal) % comprimentoTotal; };
    var p = trilha.getPointAtLength(normalizar(L));
    var antes = trilha.getPointAtLength(normalizar(L - 2));
    var depois = trilha.getPointAtLength(normalizar(L + 2));
    var angulo = Math.atan2(depois.y - antes.y, depois.x - antes.x) * 180 / Math.PI;
    return { x: p.x, y: p.y, angulo: angulo };
  }

  function pontoNaCasa(casa) {
    return pontoNoComprimento(comprimentoDaCasa(casa));
  }

  // Vetor perpendicular à pista, apontando para dentro (para o gramado central).
  function normalInterna(ponto) {
    var rad = ponto.angulo * Math.PI / 180;
    var n = { x: -Math.sin(rad), y: Math.cos(rad) };
    var paraCentro = { x: centro.x - ponto.x, y: centro.y - ponto.y };
    if (n.x * paraCentro.x + n.y * paraCentro.y < 0) { n.x = -n.x; n.y = -n.y; }
    return n;
  }

  function transformar(ponto) {
    return 'translate(' + f(ponto.x) + ' ' + f(ponto.y) + ') rotate(' + f(ponto.angulo) + ')';
  }

  // Trecho do traçado entre dois comprimentos, como um "d" de <path> (para as zebras).
  function trechoDoTracado(L0, L1) {
    var partes = [];
    for (var L = L0; L <= L1; L += 4) {
      var p = pontoNoComprimento(L);
      partes.push((partes.length ? 'L' : 'M') + f(p.x) + ' ' + f(p.y));
    }
    return partes.join(' ');
  }

  // Distância de um ponto até o eixo da pista (usa os pontos amostrados).
  function distanciaAtePista(x, y) {
    var menor = Infinity;
    for (var i = 0; i < amostrasTrilha.length; i++) {
      var d = Math.hypot(amostrasTrilha[i].x - x, amostrasTrilha[i].y - y);
      if (d < menor) menor = d;
    }
    return menor;
  }

  /* ---------- Bioma do circuito (só aparência) ---------- */

  function biomaDoCircuito(nome) {
    var n = (nome || '').toLowerCase();
    if (/lagoa|represa/.test(n)) return BIOMAS.represa;
    if (/cerrado/.test(n)) return BIOMAS.cerrado;
    if (/pinha/.test(n)) return BIOMAS.pinhais;
    if (/duna/.test(n)) return BIOMAS.dunas;
    return BIOMAS.campo;
  }

  /* ---------- Desenho da maquete (camada parada) ---------- */

  function criarDefinicoes(bioma) {
    var defs = el('defs', {}, svg);

    // Texturas renderizadas no Blender, repetidas como ladrilhos
    var terreno = el('pattern', { id: 'tex-terreno', width: '180', height: '180', patternUnits: 'userSpaceOnUse' }, defs);
    el('image', { href: PASTA + bioma.terreno, width: '180', height: '180' }, terreno);
    var asfalto = el('pattern', { id: 'tex-asfalto', width: '128', height: '128', patternUnits: 'userSpaceOnUse' }, defs);
    el('image', { href: PASTA + 'pista/asfalto.webp', width: '128', height: '128' }, asfalto);

    var xadrez = el('pattern', { id: 'padrao-xadrez', width: '12', height: '12', patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { width: '12', height: '12', fill: '#F7EEDB' }, xadrez);
    el('rect', { width: '6', height: '6', fill: '#1D2B3A' }, xadrez);
    el('rect', { x: '6', y: '6', width: '6', height: '6', fill: '#1D2B3A' }, xadrez);

    // Manchas suaves no gramado (para a repetição da textura não aparecer)
    [['mancha-escura', bioma.manchas[0], 0.55], ['mancha-clara', bioma.manchas[1], 0.35]].forEach(function (m) {
      var g = el('radialGradient', { id: m[0] }, defs);
      el('stop', { offset: '0', 'stop-color': m[1], 'stop-opacity': String(m[2]) }, g);
      el('stop', { offset: '1', 'stop-color': m[1], 'stop-opacity': '0' }, g);
    });

    // Sombra dos objetos: a silhueta da própria imagem, escurecida e desfocada
    var sombra = el('filter', { id: 'sombra-objetos', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
    el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 .07  0 0 0 0 .05  0 0 0 0 .02  0 0 0 .5 0' }, sombra);
    el('feGaussianBlur', { stdDeviation: '2.6' }, sombra);

    // Luz da luminária (alto à esquerda) e penumbra nas bordas
    var luz = el('radialGradient', { id: 'luz-luminaria', gradientUnits: 'userSpaceOnUse', cx: '220', cy: '40', r: '1050' }, defs);
    el('stop', { offset: '0', 'stop-color': '#FFD592', 'stop-opacity': '.16' }, luz);
    el('stop', { offset: '.45', 'stop-color': '#FFD592', 'stop-opacity': '0' }, luz);
    el('stop', { offset: '.8', 'stop-color': '#0C0805', 'stop-opacity': '.14' }, luz);
    el('stop', { offset: '1', 'stop-color': '#0C0805', 'stop-opacity': '.34' }, luz);

    var agua = el('linearGradient', { id: 'agua', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#4F8FA0' }, agua);
    el('stop', { offset: '1', 'stop-color': '#2B5E70' }, agua);

    return defs;
  }

  function desenharTerreno(aleatorio) {
    // O terreno passa das bordas do viewBox: se o tabuleiro ficar mais largo
    // que o desenho (telas baixas), as laterais continuam sendo grama.
    el('rect', { x: '-700', y: '-400', width: '2400', height: '1490', fill: 'url(#tex-terreno)', class: 'terreno' }, svg);
    var manchas = el('g', { class: 'manchas', 'aria-hidden': 'true' }, svg);
    for (var i = 0; i < 12; i++) {
      el('ellipse', {
        cx: f(aleatorio() * 1000), cy: f(aleatorio() * 690),
        rx: f(70 + aleatorio() * 120), ry: f(50 + aleatorio() * 90),
        fill: i % 3 === 0 ? 'url(#mancha-clara)' : 'url(#mancha-escura)'
      }, manchas);
    }
  }

  // Espelho d'água no miolo do circuito (Lagoa e Represa): o próprio traçado,
  // encolhido em volta do centro, garante que a água fica dentro da pista.
  function desenharAgua(d) {
    var escala = 0.42;
    var t = 'translate(' + f(centro.x) + ' ' + f(centro.y) + ') scale(' + escala + ') translate(' + f(-centro.x) + ' ' + f(-centro.y) + ')';
    var g = el('g', { class: 'agua', transform: t, 'aria-hidden': 'true' }, svg);
    el('path', { d: trilha.getAttribute('d'), class: 'agua-margem' }, g);
    el('path', { d: trilha.getAttribute('d'), class: 'agua-espelho' }, g);
    el('path', { d: trilha.getAttribute('d'), class: 'agua-reflexo' }, g);
    return { x: centro.x, y: centro.y, escala: escala };
  }

  function desenharAsfalto(d) {
    var g = el('g', { class: 'pista-camadas-asfalto' }, svg);
    // sombra de contato da pista sobre a grama, deslocada como a luz
    el('path', { d: d, class: 'pista-sombra', transform: 'translate(5 8)' }, g);
    el('path', { d: d, class: 'pista-sombra pista-sombra-perto', transform: 'translate(2 3)' }, g);
    el('path', { d: d, class: 'pista-mureta' }, g);
    camadas.zebras = el('g', { class: 'zebras', 'aria-hidden': 'true' }, g);
    el('path', { d: d, class: 'pista-faixa' }, g);
    g.appendChild(trilha); // o path principal é o asfalto
    trilha.setAttribute('class', 'pista-asfalto');
  }

  // Zebras: faixa contínua vermelha e creme acompanhando cada curva,
  // nos dois lados do asfalto (fica por baixo do asfalto e aparece nas bordas).
  function desenharZebras() {
    pista.curvas.forEach(function (curva) {
      var apice = comprimentoDaCasa(curva.casa);
      var d = trechoDoTracado(apice - 92, apice + 92);
      el('path', { d: d, class: 'zebra-base' }, camadas.zebras);
      el('path', { d: d, class: 'zebra-listras' }, camadas.zebras);
    });
  }

  function desenharCasas() {
    var grupo = el('g', { class: 'casas', 'aria-hidden': 'true' }, svg);
    var casasDeCurva = pista.curvas.map(function (c) { return c.casa; });
    var ultima = pista.total_casas - 1;
    var meia = LARGURA_PISTA / 2 - 5;

    // Divisões entre casas (a divisão antes de uma curva é a linha vermelha)
    for (var i = 1; i < pista.total_casas; i++) {
      if (i === ultima) continue; // aí fica a linha de chegada
      var p = pontoNaCasa(i - 0.5);
      var ehEntradaDeCurva = casasDeCurva.indexOf(i) !== -1;
      var g = el('g', { transform: transformar(p) }, grupo);
      el('line', { x1: '0', y1: -meia, x2: '0', y2: meia, class: ehEntradaDeCurva ? 'linha-curva' : 'divisao-casa' }, g);
    }

    // Grid de largada pintado (casas 0, 1 e 2), alternando os lados como num grid de verdade
    [0, 1, 2].forEach(function (casa) {
      var p = pontoNaCasa(casa + 0.32);
      var lado = casa % 2 === 0 ? -1 : 1;
      var g = el('g', { transform: transformar(p), class: 'grid-largada' }, grupo);
      el('path', { d: 'M-6 ' + f(lado * 6) + ' H0 V' + f(lado * meia) + ' H-6' }, g);
    });

    // Número de cada casa, pintado no asfalto
    for (var c = 0; c < pista.total_casas; c++) {
      var pc = pontoNaCasa(c);
      texto(String(c), {
        class: 'casa-numero' + (casasDeCurva.indexOf(c) !== -1 ? ' casa-curva-numero' : ''),
        x: f(pc.x), y: f(pc.y + 4.5), 'text-anchor': 'middle'
      }, grupo);
    }
  }

  // Etiqueta impressa (retângulo creme + texto), sempre de pé
  function etiqueta(conteudo, x, y, classe, pai) {
    var g = el('g', { class: 'etiqueta ' + (classe || ''), transform: 'translate(' + f(x) + ' ' + f(y) + ')' }, pai);
    var fundo = el('rect', { class: 'etiqueta-fundo', rx: '2' }, g);
    var t = texto(conteudo, { class: 'etiqueta-texto', 'text-anchor': 'middle', y: '4.5' }, g);
    var largura = Math.max(30, (t.getComputedTextLength ? t.getComputedTextLength() : conteudo.length * 8) + 14);
    fundo.setAttribute('x', f(-largura / 2));
    fundo.setAttribute('y', '-9');
    fundo.setAttribute('width', f(largura));
    fundo.setAttribute('height', '18');
    return { g: g, largura: largura };
  }

  // Faixa quadriculada atravessando a pista, com a etiqueta no gramado interno
  // ("distancia" afasta a etiqueta da pista para as duas não se sobreporem).
  function desenharLinha(casa, rotulo, distancia) {
    var p = pontoNaCasa(casa);
    var g = el('g', { transform: transformar(p) }, svg);
    el('rect', { x: '-6', y: -LARGURA_PISTA / 2 + 3, width: '12', height: LARGURA_PISTA - 6, fill: 'url(#padrao-xadrez)' }, g);
    var n = normalInterna(p);
    var pos = { x: p.x + n.x * distancia, y: p.y + n.y * distancia };
    etiqueta(rotulo, pos.x, pos.y, 'etiqueta-linha', svg);
    return pos;
  }

  // Placas de limite das curvas: poste + disco com a face impressa (cartaz)
  function desenharPlacas(sombras) {
    var grupo = el('g', { class: 'placas' }, svg);
    var posicoes = [];
    pista.curvas.forEach(function (curva) {
      var p = pontoNaCasa(curva.casa);
      var n = normalInterna(p);
      var x = p.x + n.x * 92;
      var y = p.y + n.y * 92;
      posicoes.push({ x: x, y: y + 6, r: 44 });
      el('line', {
        class: 'placa-guia',
        x1: f(p.x + n.x * 44), y1: f(p.y + n.y * 44), x2: f(x - n.x * 26), y2: f(y - n.y * 26)
      }, grupo);

      // sombra da placa e do poste (na camada de sombras, embaixo de tudo)
      el('circle', { cx: f(x + 5), cy: f(y + 8), r: '22' }, sombras);
      el('rect', { x: f(x + 2), y: f(y + 24), width: '6', height: '14' }, sombras);

      var g = el('g', { class: 'placa', transform: 'translate(' + f(x) + ' ' + f(y) + ')' }, grupo);
      var titulo = el('title', {}, g);
      titulo.textContent = 'Curva na casa ' + curva.casa + ': limite de velocidade ' + curva.limite;
      el('rect', { class: 'placa-poste', x: '-2', y: '14', width: '4', height: '20', rx: '1' }, g);
      el('ellipse', { class: 'placa-base', cx: '0', cy: '34', rx: '7', ry: '3' }, g);
      el('circle', { class: 'placa-disco', r: '21' }, g);
      el('circle', { class: 'placa-aro', r: '17.5' }, g);
      texto(String(curva.limite), { class: 'placa-limite', y: '9', 'text-anchor': 'middle' }, g);
      etiqueta('CASA ' + curva.casa, x, y + 48, 'etiqueta-placa', grupo);
    });
    return posicoes;
  }

  /* ---------- Cenário posicionado pela semente ---------- */

  // Cada objeto é aproximado por círculos (para checar se encosta em algo).
  function circulosDoObjeto(tipo, x, y, angulo, escala) {
    var o = OBJETOS[tipo];
    if (o.raio) return [{ x: x, y: y, r: o.raio * escala }];
    var rad = angulo * Math.PI / 180;
    var eixo = { x: Math.cos(rad), y: Math.sin(rad) };
    var r = o.h / 2 * escala;
    var quantos = Math.max(1, Math.ceil(o.w / o.h));
    var lista = [];
    for (var i = 0; i < quantos; i++) {
      var t = quantos === 1 ? 0 : (i / (quantos - 1) - 0.5) * (o.w * escala - o.h * escala);
      lista.push({ x: x + eixo.x * t, y: y + eixo.y * t, r: r });
    }
    return lista;
  }

  // Ponto dentro do lago? (regra do "raio": conta quantas vezes uma linha
  // horizontal saindo do ponto cruza o contorno; ímpar = dentro)
  function naAgua(x, y, folga) {
    if (!contornoAgua) return false;
    var dentro = false;
    for (var i = 0, j = contornoAgua.length - 1; i < contornoAgua.length; j = i++) {
      var a = contornoAgua[i], b = contornoAgua[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) dentro = !dentro;
    }
    if (dentro) return true;
    return contornoAgua.some(function (p) { return Math.hypot(p.x - x, p.y - y) < folga; });
  }

  function cabe(circulos, ocupados, folgaPista) {
    return circulos.every(function (c) {
      if (c.x < c.r + 6 || c.x > 1000 - c.r - 6 || c.y < c.r + 6 || c.y > 690 - c.r - 6) return false;
      if (distanciaAtePista(c.x, c.y) < LARGURA_PISTA / 2 + folgaPista + c.r) return false;
      if (naAgua(c.x, c.y, c.r + 12)) return false;
      return ocupados.every(function (o) { return Math.hypot(o.x - c.x, o.y - c.y) >= o.r + c.r; });
    });
  }

  // Ângulo para a FRENTE do objeto (o lado de baixo da imagem) apontar na direção (dx, dy)
  function anguloDeFrente(dx, dy) {
    return graus(Math.atan2(dy, dx)) - 90;
  }

  // Tenta posicionar um prédio ao lado de uma reta (entre dois vértices).
  function prediosNaReta(tipo, i, fracoes, ocupados, lista, faixa) {
    var o = OBJETOS[tipo];
    var a = VERTICES[i];
    var b = VERTICES[(i + 1) % VERTICES.length];
    var dir = unitario(b.x - a.x, b.y - a.y);
    var normal = { x: -dir.y, y: dir.x };
    for (var k = 0; k < fracoes.length; k++) {
      var t = fracoes[k];
      var base = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      var paraFora = (normal.x * (base.x - centro.x) + normal.y * (base.y - centro.y)) > 0 ? 1 : -1;
      var lados = [paraFora, -paraFora];
      for (var s = 0; s < lados.length; s++) {
        var n = { x: normal.x * lados[s], y: normal.y * lados[s] };
        var dist = LARGURA_PISTA / 2 + 16 + o.h / 2;
        var x = base.x + n.x * dist;
        var y = base.y + n.y * dist;
        var angulo = anguloDeFrente(-n.x, -n.y); // a frente olha para a pista
        var circulos = circulosDoObjeto(tipo, x, y, graus(Math.atan2(dir.y, dir.x)), 1);
        if (cabe(circulos, ocupados, 14)) {
          Array.prototype.push.apply(ocupados, circulos);
          lista.push({ tipo: tipo, x: x, y: y, angulo: angulo, escala: 1, faixa: faixa });
          return true;
        }
      }
    }
    return false;
  }

  function posicionarCenario(aleatorio, ocupados, bioma) {
    var lista = [];
    var total = VERTICES.length;

    // Retas em ordem de tamanho (a reta i vai do vértice i ao i + 1)
    var retas = VERTICES.map(function (v, i) {
      var w = VERTICES[(i + 1) % total];
      return { i: i, tamanho: Math.hypot(w.x - v.x, w.y - v.y) };
    }).sort(function (a, b) { return b.tamanho - a.tamanho; });

    // 1. Boxes na reta de largada (do último vértice ao primeiro), longe da faixa de largada
    prediosNaReta('boxes', total - 1, [0.22, 0.78, 0.3, 0.7], ocupados, lista);

    // 2. Arquibancadas de frente para as duas retas mais longas, com a faixa do GP
    var nomeGP = 'GP ' + (pista.nome || 'Circuito da Serra').split(' ').slice(1).join(' ');
    retas.slice(0, 2).forEach(function (reta) {
      prediosNaReta('arquibancada', reta.i, [0.5, 0.36, 0.64], ocupados, lista, nomeGP.toUpperCase());
    });

    // 3. Pneus na área de escape (lado de fora) de cada curva
    pista.curvas.forEach(function (curva) {
      var p = pontoNaCasa(curva.casa);
      var n = normalInterna(p);
      var dist = LARGURA_PISTA / 2 + 24;
      var x = p.x - n.x * dist;
      var y = p.y - n.y * dist;
      var circulos = circulosDoObjeto('pneus', x, y, p.angulo, 1);
      if (cabe(circulos, ocupados, 6)) {
        Array.prototype.push.apply(ocupados, circulos);
        lista.push({ tipo: 'pneus', x: x, y: y, angulo: anguloDeFrente(n.x, n.y), escala: 1 });
      }
    });

    // 4. Árvores em bosques (mesma semente = mesmas árvores)
    var tentativas = 0;
    var bosques = [];
    for (var b = 0; b < 7; b++) bosques.push({ x: aleatorio() * 1000, y: aleatorio() * 690 });
    while (lista.length < LIMITE_OBJETOS && tentativas < 420) {
      tentativas++;
      var bosque = bosques[tentativas % bosques.length];
      var ang = aleatorio() * Math.PI * 2;
      var raio = 10 + aleatorio() * 70;
      var tipo = bioma.arvores[Math.floor(aleatorio() * bioma.arvores.length)];
      var escala = 0.85 + aleatorio() * 0.35;
      var x = bosque.x + Math.cos(ang) * raio;
      var y = bosque.y + Math.sin(ang) * raio;
      var circulos = circulosDoObjeto(tipo, x, y, 0, escala);
      if (cabe(circulos, ocupados, 16)) {
        Array.prototype.push.apply(ocupados, circulos);
        lista.push({ tipo: tipo, x: x, y: y, angulo: 0, escala: escala });
      }
    }
    return lista;
  }

  function desenharCenario(lista, sombras) {
    var grupo = el('g', { class: 'cenario', 'aria-hidden': 'true' }, svg);
    // árvores por último (são as mais altas) e as de baixo por cima das de cima
    lista.sort(function (a, b) { return (a.tipo.indexOf('arvore') === 0) - (b.tipo.indexOf('arvore') === 0) || a.y - b.y; });
    lista.forEach(function (item) {
      var o = OBJETOS[item.tipo];
      var w = o.w * item.escala;
      var h = o.h * item.escala;
      var desloca = 5 * o.altura;
      // sombra: a mesma imagem, sem girar o deslocamento (a luz não gira)
      imagem(o.img, w, h, sombras, {
        transform: 'translate(' + f(item.x + desloca * 0.7) + ' ' + f(item.y + desloca) + ') rotate(' + f(item.angulo) + ')'
      });
      var g = el('g', { transform: 'translate(' + f(item.x) + ' ' + f(item.y) + ') rotate(' + f(item.angulo) + ')' }, grupo);
      imagem(o.img, w, h, g);
      if (item.faixa) {
        // faixa impressa na mureta da arquibancada; se o prédio estiver "de ponta-
        // cabeça" (girado mais de 90°), o texto gira 180° para continuar legível
        var anguloNormal = ((item.angulo % 360) + 540) % 360 - 180;
        var virar = Math.abs(anguloNormal) > 90;
        var faixa = el('g', { class: 'faixa-gp', transform: 'translate(0 ' + f(h / 2 - 4) + ')' + (virar ? ' rotate(180)' : '') }, g);
        el('rect', { x: f(-w * 0.32), y: '-5', width: f(w * 0.64), height: '10', rx: '1' }, faixa);
        texto(item.faixa, { 'text-anchor': 'middle', y: '3.6', transform: 'skewX(-9)' }, faixa);
      }
    });
  }

  function desenharLuz() {
    el('rect', { x: '-700', y: '-400', width: '2400', height: '1490', fill: 'url(#luz-luminaria)', class: 'luz-mesa', 'aria-hidden': 'true' }, svg);
  }

  /* ---------- Peças (carros), na camada que se mexe ---------- */

  // Carro desenhado em SVG: só para uma cor sem imagem renderizada (ex.: outra cor na Fase 2)
  function desenharCarroVetorial(pai, cor) {
    [[-15, -16], [-15, 12], [9, -16], [9, 12]].forEach(function (r) {
      el('rect', { x: r[0], y: r[1], width: '10', height: '4.5', rx: '1.5', fill: '#1D1915' }, pai);
    });
    el('rect', { x: '-23', y: '-12.5', width: '46', height: '25', rx: '9', fill: cor, stroke: 'rgba(0,0,0,.35)', 'stroke-width': '1.2' }, pai);
    el('rect', { x: '-27', y: '-13.5', width: '6', height: '27', rx: '2', fill: '#1D2B3A' }, pai);
    el('ellipse', { cx: '3', cy: '0', rx: '7.5', ry: '6', fill: '#1D2B3A', opacity: '0.85' }, pai);
  }

  function desenharSelo(pai, forma, cor, numero) {
    el('circle', { r: '14.5', class: 'selo-fundo' }, pai);
    if (forma === 'triangulo') {
      el('polygon', { points: '0,-11 11,8 -11,8', fill: cor }, pai);
    } else if (forma === 'quadrado') {
      el('rect', { x: '-9.5', y: '-9.5', width: '19', height: '19', rx: '2.5', fill: cor }, pai);
    } else {
      el('circle', { r: '10.5', fill: cor }, pai);
    }
    texto(String(numero), { class: 'carro-numero', y: forma === 'triangulo' ? '6.5' : '5', 'text-anchor': 'middle' }, pai);
  }

  function criarDefinicoesPecas() {
    var defs = el('defs', {}, svgPecas);
    var sombra = el('filter', { id: 'sombra-carro', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feColorMatrix', { type: 'matrix', values: '0 0 0 0 .06  0 0 0 0 .035  0 0 0 0 .015  0 0 0 .55 0' }, sombra);
    el('feGaussianBlur', { stdDeviation: '1.8' }, sombra);
    var sombraSelo = el('filter', { id: 'sombra-selo', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feDropShadow', { dx: '2', dy: '3', stdDeviation: '1.6', 'flood-color': '#120A04', 'flood-opacity': '.5' }, sombraSelo);
    var fumaca = el('radialGradient', { id: 'fumaca' }, defs);
    el('stop', { offset: '0', 'stop-color': '#D9D2C4', 'stop-opacity': '.95' }, fumaca);
    el('stop', { offset: '.6', 'stop-color': '#A9A194', 'stop-opacity': '.55' }, fumaca);
    el('stop', { offset: '1', 'stop-color': '#8A8276', 'stop-opacity': '0' }, fumaca);
    return defs;
  }

  function criarCarro(carro, ehHumano) {
    var gradiente = 'rastro-' + carro.id;
    var lg = el('linearGradient', { id: gradiente, x1: '0', x2: '1', y1: '0', y2: '0' }, camadas.defs);
    el('stop', { offset: '0', 'stop-color': carro.cor, 'stop-opacity': '0' }, lg);
    el('stop', { offset: '1', 'stop-color': carro.cor, 'stop-opacity': '0.5' }, lg);

    var grupo = el('g', { class: 'carro' + (ehHumano ? ' carro-jogador' : '') }, camadas.carros);
    var titulo = el('title', {}, grupo);
    titulo.textContent = carro.nome + ': carro ' + carro.numero + ' (' + nomeDaForma(carro.forma) + ')';

    if (ehHumano) el('circle', { class: 'anel-jogador', r: '34' }, grupo);
    var giro = el('g', { class: 'carro-giro' }, grupo);
    var pintura = pinturaDoCarro(carro.cor);
    var caminho = pintura ? 'carros/carro-' + pintura + '-cima.webp' : null;

    // sombra: deslocada no espaço do tabuleiro, girando só o formato do carro
    var sombra = el('g', { class: 'carro-sombra', filter: 'url(#sombra-carro)' }, giro);
    var corpo = el('g', { class: 'carro-corpo' }, giro);
    el('rect', { class: 'rastro', x: '-82', y: '-8', width: '56', height: '16', rx: '8', fill: 'url(#' + gradiente + ')' }, corpo);
    if (caminho) {
      imagem(caminho, TAMANHO_CARRO.w, TAMANHO_CARRO.h, sombra);
      imagem(caminho, TAMANHO_CARRO.w, TAMANHO_CARRO.h, corpo);
      // o fantasma da previsão usa a silhueta do carro do jogador
      if (ehHumano) imagem(caminho, TAMANHO_CARRO.w, TAMANHO_CARRO.h, camadas.fantasmaCarro);
    } else {
      desenharCarroVetorial(sombra, '#000');
      desenharCarroVetorial(corpo, carro.cor);
    }

    var selo = el('g', { class: 'carro-selo', transform: 'translate(0 -38)', filter: 'url(#sombra-selo)' }, grupo);
    desenharSelo(selo, carro.forma, carro.cor, carro.numero);
    if (ehHumano) texto('VOCÊ', { class: 'rotulo-voce', y: '-60', 'text-anchor': 'middle' }, grupo);

    carros[carro.id] = { grupo: grupo, corpo: corpo, sombra: sombra, giro: giro, casa: null, ponto: null };
    return carros[carro.id];
  }

  function aplicarPonto(info, ponto) {
    info.ponto = ponto;
    info.grupo.setAttribute('transform', 'translate(' + f(ponto.x) + ' ' + f(ponto.y) + ')');
    info.corpo.setAttribute('transform', 'rotate(' + f(ponto.angulo) + ')');
    info.sombra.setAttribute('transform', 'translate(' + SOMBRA_CARRO.dx + ' ' + SOMBRA_CARRO.dy + ') rotate(' + f(ponto.angulo) + ')');
  }

  /* ---------- Funções públicas ---------- */

  // Desenha o tabuleiro inteiro do zero (chamar com a tela de jogo visível).
  function criar(elementoSvg, dadosPista, carroHumanoId) {
    svg = elementoSvg;
    svgPecas = document.getElementById('pista-pecas') || elementoSvg;
    pista = dadosPista;
    idHumano = carroHumanoId;
    carros = {};
    camadas = {};
    while (svg.lastChild) svg.removeChild(svg.lastChild);
    if (svgPecas !== svg) while (svgPecas.lastChild) svgPecas.removeChild(svgPecas.lastChild);

    var titulo = el('title', { id: 'pista-titulo' }, svg);
    titulo.textContent = 'Tabuleiro da pista ' + (pista.nome || '') + ' com ' + pista.total_casas + ' casas e ' + pista.curvas.length + ' curvas';

    var bioma = biomaDoCircuito(pista.nome);
    criarDefinicoes(bioma);
    VERTICES = montarVertices();

    // Começo do traçado = casa 0, entre a última e a primeira curva
    var curvas = pista.curvas.slice().sort(function (a, b) { return a.casa - b.casa; });
    var ultimaCurva = curvas[curvas.length - 1].casa;
    var primeiraCurva = curvas[0].casa;
    var fracao = (pista.total_casas - ultimaCurva) / (pista.total_casas - ultimaCurva + primeiraCurva);
    var vA = VERTICES[VERTICES.length - 1];
    var vB = VERTICES[0];
    var inicio = { x: vA.x + (vB.x - vA.x) * fracao, y: vA.y + (vB.y - vA.y) * fracao };

    trilha = el('path', { d: montarCaminho(inicio), id: 'trilha-principal' }, svg);
    comprimentoTotal = trilha.getTotalLength();
    centro = { x: 0, y: 0 };
    VERTICES.forEach(function (v) { centro.x += v.x / VERTICES.length; centro.y += v.y / VERTICES.length; });
    calcularAncoras();
    amostrasTrilha = [];
    for (var L = 0; L < comprimentoTotal; L += 6) amostrasTrilha.push(trilha.getPointAtLength(L));

    var d = trilha.getAttribute('d');
    var aleatorio = geradorComSemente((pista.semente || 1) * 7919 + 13);
    desenharTerreno(aleatorio);
    var ocupados = [];
    contornoAgua = null;
    if (bioma.agua) {
      var agua = desenharAgua(d);
      // contorno do lago: nenhum objeto de cenário nasce dentro dele
      contornoAgua = amostrasTrilha.map(function (p) {
        return { x: agua.x + (p.x - agua.x) * agua.escala, y: agua.y + (p.y - agua.y) * agua.escala };
      });
    }
    var sombras = el('g', { class: 'sombras', filter: 'url(#sombra-objetos)', 'aria-hidden': 'true' }, svg);
    desenharAsfalto(d);
    desenharZebras();
    desenharCasas();
    var ultima = pista.total_casas - 1;
    ocupados.push(Object.assign({ r: 46 }, desenharLinha(ultima - 0.5, 'CHEGADA', 54)));
    ocupados.push(Object.assign({ r: 46 }, desenharLinha(ultima + 0.5, 'LARGADA', 84)));
    var placas = desenharPlacas(sombras);
    Array.prototype.push.apply(ocupados, placas);
    desenharCenario(posicionarCenario(aleatorio, ocupados, bioma), sombras);
    svg.appendChild(svg.querySelector('.placas')); // placas por cima do cenário
    desenharLuz();

    var plaqueta = document.getElementById('pista-plaqueta');
    if (plaqueta) {
      plaqueta.textContent = (pista.nome || 'Circuito da Serra') + ' · ' + pista.total_casas + ' casas · ' +
        pista.curvas.length + ' curvas · 1 volta';
    }

    // Camada que se mexe
    camadas.defs = criarDefinicoesPecas();
    camadas.rota = el('path', { d: d, class: 'rota-prevista', 'aria-hidden': 'true' }, svgPecas);
    camadas.fantasma = el('g', { class: 'fantasma', 'aria-hidden': 'true' }, svgPecas);
    el('rect', { class: 'peca-contorno', x: '-32', y: '-17', width: '64', height: '34', rx: '13' }, camadas.fantasma);
    camadas.fantasmaCarro = el('g', { class: 'fantasma-carro' }, camadas.fantasma);
    camadas.fantasmaEtiqueta = el('g', { class: 'fantasma-etiqueta' }, camadas.fantasma);
    camadas.fantasmaFundo = el('rect', { class: 'etiqueta-fundo', y: '40', height: '19', rx: '2' }, camadas.fantasmaEtiqueta);
    camadas.fantasmaRotulo = texto('', { class: 'fantasma-rotulo', y: '54', 'text-anchor': 'middle' }, camadas.fantasmaEtiqueta);
    camadas.carros = el('g', { class: 'camada-carros' }, svgPecas);
    camadas.efeitos = el('g', { class: 'camada-efeitos', 'aria-hidden': 'true' }, svgPecas);
  }

  // Coloca cada carro na casa indicada, sem animação.
  function posicionarCarros(listaCarros) {
    listaCarros.forEach(function (carro) {
      var info = carros[carro.id] || criarCarro(carro, carro.id === idHumano);
      info.casa = carro.posicao;
      aplicarPonto(info, pontoNaCasa(carro.posicao));
    });
    // o carro do jogador fica sempre por cima
    if (carros[idHumano]) camadas.carros.appendChild(carros[idHumano].grupo);
  }

  // Quanto dura (ms) a animação de um carro andando de "de" até "para"
  // (0 = sem animação). Os efeitos sonoros usam a mesma conta.
  function duracaoMovimento(de, para) {
    if (de === para || reduzirMovimento()) return 0;
    return Math.max(400, Math.min(1800, Math.abs(para - de) * CONFIG.ANIMACAO.MS_POR_CASA + 250));
  }

  // Suavização do movimento (t de 0 a 1): acelera no começo e freia no fim
  function suavizar(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // De que lado do tabuleiro fica uma casa: -1 esquerda … 1 direita (para o som acompanhar o carro)
  function panDaCasa(casa) {
    if (!trilha) return 0;
    return Math.max(-1, Math.min(1, pontoNaCasa(casa).x / LARGURA_TABULEIRO * 2 - 1));
  }

  // Anda com o carro casa a casa pelo traçado. Devolve uma Promise.
  function animarMovimento(carroId, de, para) {
    var info = carros[carroId];
    if (!info) return Promise.resolve();
    camadas.carros.appendChild(info.grupo);

    if (de === para || reduzirMovimento()) {
      info.casa = para;
      aplicarPonto(info, pontoNaCasa(para));
      return pausa(reduzirMovimento() ? 150 : 0);
    }

    var L0 = comprimentoDaCasa(de);
    var L1 = comprimentoDaCasa(para);
    var duracao = duracaoMovimento(de, para);
    info.grupo.classList.add('em-movimento');

    return new Promise(function (resolve) {
      var inicio = null;
      var terminou = false;

      function terminar() {
        if (terminou) return;
        terminou = true;
        aplicarPonto(info, pontoNaCasa(para));
        info.casa = para;
        info.grupo.classList.remove('em-movimento');
        if (carros[idHumano] && carroId !== idHumano) camadas.carros.appendChild(carros[idHumano].grupo);
        resolve();
      }

      function quadro(agora) {
        if (terminou) return;
        if (inicio === null) inicio = agora;
        var t = Math.min(1, (agora - inicio) / duracao);
        aplicarPonto(info, pontoNoComprimento(L0 + (L1 - L0) * suavizar(t)));
        if (t < 1) requestAnimationFrame(quadro);
        else terminar();
      }
      requestAnimationFrame(quadro);

      // Plano B: se o navegador pausar os quadros (aba em segundo plano),
      // o carro chega no destino mesmo assim e o jogo não trava.
      setTimeout(terminar, duracao + 300);
    });
  }

  // Rota prevista: trecho do traçado entre a posição atual e o destino.
  // "extra" (opcional) completa o rótulo do fantasma, ex.: "rastro +3".
  function mostrarPrevisao(de, para, tipo, extra) {
    if (!trilha) return;
    var L0 = comprimentoDaCasa(de);
    var L1 = comprimentoDaCasa(para);
    camadas.rota.setAttribute('stroke-dasharray', '0 ' + f(L0) + ' ' + f(Math.max(0.1, L1 - L0)) + ' ' + f(comprimentoTotal));
    camadas.rota.setAttribute('class', 'rota-prevista visivel rota-' + tipo);

    var p = pontoNaCasa(para);
    camadas.fantasma.setAttribute('transform', transformar(p));
    camadas.fantasma.setAttribute('class', 'fantasma visivel fantasma-' + tipo);
    // a etiqueta não deve girar junto com o carro
    camadas.fantasmaEtiqueta.setAttribute('transform', 'rotate(' + f(-p.angulo) + ')');
    camadas.fantasmaRotulo.textContent = 'casa ' + para + (extra ? ' · ' + extra : '');
    var largura = (camadas.fantasmaRotulo.getComputedTextLength ? camadas.fantasmaRotulo.getComputedTextLength() : 60) + 16;
    camadas.fantasmaFundo.setAttribute('x', f(-largura / 2));
    camadas.fantasmaFundo.setAttribute('width', f(largura));
  }

  function esconderPrevisao() {
    if (!camadas.rota) return;
    camadas.rota.setAttribute('class', 'rota-prevista');
    camadas.fantasma.setAttribute('class', 'fantasma');
  }

  /* ---------- Efeitos visuais ---------- */

  function efeitoTexto(carroId, conteudo, tipo) {
    var info = carros[carroId];
    if (!info || !info.ponto) return;
    var g = el('g', { transform: 'translate(' + f(info.ponto.x) + ' ' + f(info.ponto.y - 64) + ')' }, camadas.efeitos);
    texto(conteudo, { class: 'flutuante flutuante-' + tipo, 'text-anchor': 'middle' }, g);
    setTimeout(function () { g.remove(); }, 1600);
  }

  // Cubos de calor (os mesmos do motor) saltando do carro
  function efeitoCalor(carroId, quantidade) {
    var info = carros[carroId];
    if (!info || !info.ponto) return;
    efeitoTexto(carroId, '−' + quantidade + ' CALOR', 'calor');
    var g = el('g', { transform: 'translate(' + f(info.ponto.x) + ' ' + f(info.ponto.y) + ')' }, camadas.efeitos);
    var cubos = Math.min(8, quantidade * 2);
    for (var i = 0; i < cubos; i++) {
      imagem('pecas/cubo-calor.webp', 13, 13, g, {
        class: 'particula-calor',
        style: '--dx:' + Math.round(Math.random() * 70 - 35) + 'px; animation-delay:' + (i * 60) + 'ms'
      });
    }
    setTimeout(function () { g.remove(); }, 1700);
  }

  function efeitoResfriar(carroId) {
    efeitoTexto(carroId, '+1 CALOR', 'frio');
  }

  function efeitoDerrapagem(carroId) {
    var info = carros[carroId];
    if (!info || !info.ponto) return Promise.resolve();
    efeitoTexto(carroId, 'DERRAPOU!', 'perigo');
    var g = el('g', { transform: 'translate(' + f(info.ponto.x) + ' ' + f(info.ponto.y) + ')' }, camadas.efeitos);
    for (var i = 0; i < 8; i++) {
      el('circle', {
        class: 'fumaca', r: String(8 + Math.random() * 8), fill: 'url(#fumaca)',
        style: '--dx:' + Math.round(Math.random() * 70 - 35) + 'px; --dy:' + Math.round(Math.random() * 50 - 25) + 'px; animation-delay:' + (i * 70) + 'ms'
      }, g);
    }
    info.giro.classList.remove('derrapando');
    void info.giro.getBBox(); // reinicia a animação CSS
    info.giro.classList.add('derrapando');
    setTimeout(function () { g.remove(); info.giro.classList.remove('derrapando'); }, 1400);
    return pausa(reduzirMovimento() ? 300 : 1000);
  }

  return {
    criar: criar,
    posicionarCarros: posicionarCarros,
    animarMovimento: animarMovimento,
    mostrarPrevisao: mostrarPrevisao,
    esconderPrevisao: esconderPrevisao,
    efeitoTexto: efeitoTexto,
    efeitoCalor: efeitoCalor,
    efeitoResfriar: efeitoResfriar,
    efeitoDerrapagem: efeitoDerrapagem,
    // usados pelos efeitos sonoros (audio/efeitos-jogo.js)
    duracaoMovimento: duracaoMovimento,
    suavizar: suavizar,
    panDaCasa: panDaCasa
  };
})();
