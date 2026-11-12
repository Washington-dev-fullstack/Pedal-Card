/* =====================================================================
   icones.js — Ícones e ilustrações em SVG (arte própria do jogo)
   ---------------------------------------------------------------------
   Estilo "tinta impressa" de jogo de tabuleiro. Cada ícone é um texto
   SVG pronto para innerHTML; "currentColor" usa a cor do texto em volta.
   ===================================================================== */

var Icones = {
  chama:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 2c.9 3.6 5.8 5.8 5.8 11.6a5.8 5.8 0 0 1-11.6 0c0-2.8 1.5-4.6 2.8-5.9.2 1.9 1.1 3.2 2.4 3.7-.5-3.4-.1-6.4.6-9.4z"/>' +
    '<path fill="#fff" opacity=".35" d="M12 12.5c.5 1.7 2.6 2.6 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.6 1.2-2.6 2.6-5z"/></svg>',

  velocidade:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M4 6l6 6-6 6M12 6l6 6-6 6"/></svg>',

  floco:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/></g></svg>',

  alerta:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 2.5 23 21.5H1z"/>' +
    '<path fill="#fff" d="M11 9h2l-.3 6.5h-1.4zM12 17.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></svg>',

  bandeira:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 22V3"/>' +
    '<path fill="currentColor" d="M5 3h4v3.5H5zM13 3h4v3.5h-4zM9 6.5h4V10H9zM17 6.5h3V10h-3zM5 10h4v3.5H5zM13 10h4v3.5h-4z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="1.2" d="M5 3h15v10.5H5z"/></svg>',

  trofeu:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M7 3h10v5a5 5 0 0 1-10 0zM10.5 14h3v3.5h3V21h-9v-3.5h3z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2" d="M7 5H3.5v1.5A3.5 3.5 0 0 0 7 10M17 5h3.5v1.5A3.5 3.5 0 0 1 17 10"/></svg>',

  check:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/></svg>',

  cadeado:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M6 10h12v11H6z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2.4" d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/></svg>',

  interrogacao:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M9.2 9.3a2.9 2.9 0 1 1 3.9 2.7c-.8.3-1.1.9-1.1 1.8v.6"/>' +
    '<circle cx="12" cy="17.6" r="1.3" fill="currentColor"/></svg>',

  // Cubo de calor (peça de madeira vista de cima em perspectiva)
  cubo:
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 2 21 7v10l-9 5-9-5V7z"/>' +
    '<path fill="#fff" opacity=".35" d="M12 2 21 7l-9 5-9-5z"/>' +
    '<path fill="#000" opacity=".18" d="M12 12v10l9-5V7z"/></svg>'
};

/* Ilustração de cada carta: imagem renderizada no Blender a partir do carro 3D
   e impressa em duas tintas (assets/cartas/carta-1.webp ... carta-4.webp, carta-calor.webp). */
function arteDaCarta(carta) {
  var nome = carta.tipo === 'calor' ? 'carta-calor' : 'carta-' + carta.valor;
  return '<img class="carta-ilustracao" src="assets/cartas/' + nome + '.webp" alt="" draggable="false">';
}

/* Ficha do carro: forma + cor + número (nunca só a cor).
   Usada na classificação, na ordem da rodada, no pódio e no diário. */
function seloCarroSVG(carro, tamanho) {
  tamanho = tamanho || 28;
  var forma;
  if (carro.forma === 'triangulo') {
    forma = '<polygon points="16,2.5 30.5,28.5 1.5,28.5" fill="' + carro.cor + '" stroke="#1D2B3A" stroke-width="1.6" stroke-linejoin="round"/>';
  } else if (carro.forma === 'quadrado') {
    forma = '<rect x="3" y="3" width="26" height="26" rx="4" fill="' + carro.cor + '" stroke="#1D2B3A" stroke-width="1.6"/>';
  } else {
    forma = '<circle cx="16" cy="16" r="14" fill="' + carro.cor + '" stroke="#1D2B3A" stroke-width="1.6"/>';
  }
  var y = carro.forma === 'triangulo' ? 25 : 21.5;
  // número branco com contorno de tinta: legível sobre qualquer cor de equipe
  return '<svg class="selo-carro" width="' + tamanho + '" height="' + tamanho + '" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
    forma +
    '<text x="16" y="' + y + '" text-anchor="middle" font-size="15" font-weight="700" fill="#FFFFFF" ' +
    'stroke="#1D2B3A" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round" ' +
    'font-family="Bahnschrift, \'DIN Alternate\', \'Arial Narrow\', sans-serif">' + carro.numero + '</text></svg>';
}

// A pintura (imagens renderizadas em assets/carros/) de cada carro sai da cor
// dele, procurando em CONFIG.CARROS_VISUAL. Assim a API não precisa mudar.
function pinturaDoCarro(cor) {
  var visual = (CONFIG.CARROS_VISUAL || []).find(function (v) {
    return v.pintura && v.cor.toLowerCase() === String(cor).toLowerCase();
  });
  return visual ? visual.pintura : null;
}

// Nome da forma por extenso (para leitores de tela e legendas)
function nomeDaForma(forma) {
  return { circulo: 'círculo', triangulo: 'triângulo', quadrado: 'quadrado' }[forma] || forma;
}
