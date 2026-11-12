/* =====================================================================
   controle-som.js — O botão "Som" do jogador (música, efeitos e volumes)
   ---------------------------------------------------------------------
   Aparece em dois lugares: no alto da tela inicial e no topo do jogo,
   ao lado de "Regras". Clicar abre um cartão com "Música ligada" e o
   volume dela, "Efeitos ligados" e o volume deles, e o "Modo leve"
   (para computador lento). A escolha fica guardada no navegador
   (localStorage) e volta igual na próxima vez que o jogo abrir.
   Atalhos: a tecla M liga e desliga a música; a tecla N, os efeitos.
   Os botões das duas telas mostram sempre o mesmo.
   ===================================================================== */

var ControleSom = (function () {
  'use strict';

  var CHAVE = 'neonrush-som';       // nome da preferência guardada no navegador
  var MIXAGEM = 2;                  // versão do equilíbrio música × efeitos (ver lerPreferencia)
  var PADROES_ANTERIORES = { volume: 0.8, volumeEfeitos: 0.7 };   // os padrões da mixagem 1
  var preferencia = lerPreferencia();
  var controles = [];               // os botões "Som" desenhados na tela

  var ICONE_LIGADO =
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  var ICONE_MUDO =
    '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

  function limitar(valor) { return Math.min(1, Math.max(0, Number(valor) || 0)); }

  // Aparelho fraco (2 núcleos ou menos, ou pouca memória)? Então o modo
  // leve já começa ligado. A pessoa pode mudar no cartão do botão Som.
  function aparelhoFraco() {
    return (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;
  }

  // Lê a preferência guardada. Se o navegador bloquear o localStorage
  // (ex.: modo privativo), o jogo segue com o padrão, sem erro. Uma
  // preferência antiga (de antes dos efeitos) continua valendo: os
  // efeitos começam ligados, no volume padrão.
  function lerPreferencia() {
    var padrao = {
      volume: AudioDirector.getInfo().volume,
      mudo: false,
      leve: aparelhoFraco(),
      efeitos: true,
      volumeEfeitos: Efeitos.getInfo().volume,
      mixagem: MIXAGEM
    };
    try {
      var salva = JSON.parse(localStorage.getItem(CHAVE));
      if (salva && typeof salva.volume === 'number') {
        return {
          volume: volumeGuardado(salva, 'volume', padrao),
          mudo: !!salva.mudo,
          leve: typeof salva.leve === 'boolean' ? salva.leve : padrao.leve,
          efeitos: typeof salva.efeitos === 'boolean' ? salva.efeitos : padrao.efeitos,
          volumeEfeitos: volumeGuardado(salva, 'volumeEfeitos', padrao),
          mixagem: MIXAGEM
        };
      }
    } catch (erro) { /* nada guardado ainda */ }
    return padrao;
  }

  // Um volume guardado. Mixagem 2 (música 65%, efeitos 85%): numa preferência
  // guardada antes dela, o volume que ainda estava no padrão anterior (música
  // 80%, efeitos 70%) passa para o padrão novo; o que a pessoa escolheu fica.
  function volumeGuardado(salva, nome, padrao) {
    var valor = salva[nome];
    if (typeof valor !== 'number') return padrao[nome];
    if (salva.mixagem !== MIXAGEM && valor === PADROES_ANTERIORES[nome]) return padrao[nome];
    return limitar(valor);
  }

  function guardar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(preferencia));
    } catch (erro) { /* sem localStorage: a escolha vale só até fechar o jogo */ }
  }

  // Passa a preferência para a trilha (AudioDirector) e para os efeitos
  // (Efeitos), redesenha os botões e avisa quem mais quiser saber ("som-mudou")
  function aplicar() {
    AudioDirector.setVolume(preferencia.volume);
    AudioDirector.setLightMode(preferencia.leve);
    if (preferencia.mudo) AudioDirector.mute();
    else AudioDirector.unmute();
    Efeitos.setVolume(preferencia.volumeEfeitos);
    Efeitos.setLightMode(preferencia.leve);
    if (preferencia.efeitos) Efeitos.unmute();
    else Efeitos.mute();
    controles.forEach(desenhar);
    document.dispatchEvent(new CustomEvent('som-mudou', {
      detail: {
        volume: preferencia.volume, mudo: preferencia.mudo, leve: preferencia.leve,
        efeitos: preferencia.efeitos, volumeEfeitos: preferencia.volumeEfeitos
      }
    }));
  }

  function definirVolume(valor) {
    preferencia.volume = limitar(valor);
    if (preferencia.volume > 0) preferencia.mudo = false;   // mexer no volume religa a música
    guardar();
    aplicar();
  }

  function alternarMudo() {
    preferencia.mudo = !preferencia.mudo;
    guardar();
    aplicar();
  }

  // Mexer no volume dos efeitos toca uma amostra, para ouvir o nível escolhido
  function definirVolumeEfeitos(valor) {
    preferencia.volumeEfeitos = limitar(valor);
    if (preferencia.volumeEfeitos > 0) preferencia.efeitos = true;   // mexer no volume religa os efeitos
    guardar();
    aplicar();
    Efeitos.tocar('amostra');
  }

  function alternarEfeitos() {
    preferencia.efeitos = !preferencia.efeitos;
    guardar();
    aplicar();
    if (preferencia.efeitos) Efeitos.tocar('amostra');
  }

  function alternarLeve() {
    preferencia.leve = !preferencia.leve;
    guardar();
    aplicar();
  }

  // Cria um botão "Som" com o cartão de opções (um <details>: abre e fecha sozinho)
  function criar(classeExtra) {
    var caixa = document.createElement('details');
    caixa.className = 'controle-som' + (classeExtra ? ' ' + classeExtra : '');
    caixa.innerHTML =
      '<summary class="botao botao-icone"><span class="controle-som-icone"></span>' +
        '<span class="rotulo-botao-icone">Som</span></summary>' +
      '<div class="controle-som-cartao papel">' +
        '<label class="controle-som-musica"><input type="checkbox" data-musica> Música ligada</label>' +
        '<label class="controle-som-volume"><span>Volume</span>' +
          '<input type="range" min="0" max="100" step="1" data-volume aria-label="Volume da música"><output data-valor></output></label>' +
        '<label class="controle-som-musica controle-som-separador"><input type="checkbox" data-efeitos> Efeitos ligados</label>' +
        '<label class="controle-som-volume"><span>Volume</span>' +
          '<input type="range" min="0" max="100" step="1" data-volume-efeitos aria-label="Volume dos efeitos"><output data-valor-efeitos></output></label>' +
        '<label class="controle-som-leve controle-som-separador"><input type="checkbox" data-leve>' +
          '<span>Modo leve <small>Para computador lento: menos notas e sons ao mesmo tempo.</small></span></label>' +
        '<p class="controle-som-dica">Atalhos: <kbd>M</kbd> liga e desliga a música; <kbd>N</kbd>, os efeitos.</p>' +
      '</div>';
    caixa.querySelector('[data-musica]').addEventListener('change', alternarMudo);
    caixa.querySelector('[data-efeitos]').addEventListener('change', alternarEfeitos);
    caixa.querySelector('[data-leve]').addEventListener('change', alternarLeve);
    caixa.querySelector('[data-volume]').addEventListener('input', function () {
      definirVolume(this.value / 100);
    });
    caixa.querySelector('[data-volume-efeitos]').addEventListener('input', function () {
      definirVolumeEfeitos(this.value / 100);
    });
    controles.push(caixa);
    desenhar(caixa);
    return caixa;
  }

  // Mostra um controle deslizante e o número ao lado
  function desenharVolume(controle, saida, porcento) {
    if (Number(controle.value) !== porcento) controle.value = porcento;
    controle.setAttribute('aria-valuetext', porcento + '%');
    saida.textContent = porcento + '%';
  }

  function desenhar(caixa) {
    var musica = !preferencia.mudo;
    var efeitos = preferencia.efeitos;
    var porcento = Math.round(preferencia.volume * 100);
    var porcentoEfeitos = Math.round(preferencia.volumeEfeitos * 100);
    var algumSom = musica || efeitos;
    caixa.classList.toggle('mudo', !algumSom);
    caixa.querySelector('.controle-som-icone').innerHTML = algumSom ? ICONE_LIGADO : ICONE_MUDO;
    caixa.querySelector('summary').setAttribute('aria-label',
      'Som: música ' + (musica ? 'ligada, volume ' + porcento + '%' : 'desligada') +
      '; efeitos ' + (efeitos ? 'ligados, volume ' + porcentoEfeitos + '%' : 'desligados'));
    caixa.querySelector('[data-musica]').checked = musica;
    caixa.querySelector('[data-efeitos]').checked = efeitos;
    caixa.querySelector('[data-leve]').checked = preferencia.leve;
    desenharVolume(caixa.querySelector('[data-volume]'), caixa.querySelector('[data-valor]'), porcento);
    desenharVolume(caixa.querySelector('[data-volume-efeitos]'), caixa.querySelector('[data-valor-efeitos]'), porcentoEfeitos);
  }

  function montar() {
    // Tela inicial: no alto, à direita
    var inicial = document.getElementById('tela-inicial');
    if (inicial) inicial.insertBefore(criar('controle-som-inicio'), inicial.firstChild);
    // Tela de jogo: no topo, antes do botão "Regras"
    var regras = document.getElementById('botao-regras-jogo');
    if (regras) regras.parentNode.insertBefore(criar(), regras);
  }

  // Clicar fora do cartão ou apertar Esc fecha o cartão
  document.addEventListener('click', function (evento) {
    controles.forEach(function (caixa) {
      if (caixa.open && !caixa.contains(evento.target)) caixa.open = false;
    });
  });

  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape') {
      controles.forEach(function (caixa) {
        if (!caixa.open) return;
        caixa.open = false;
        caixa.querySelector('summary').focus();
      });
      return;
    }
    // Atalhos M e N (menos quando a pessoa está digitando, ex.: o nome do piloto;
    // numa caixa de marcar ou num controle de volume, os atalhos valem)
    var alvo = evento.target;
    var campoDeTexto = alvo && alvo.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit)$/.test(alvo.type);
    var digitando = alvo && (campoDeTexto || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
    if (digitando || evento.ctrlKey || evento.altKey || evento.metaKey) return;
    var tecla = evento.key.toLowerCase();
    if (tecla === 'm') {
      alternarMudo();
      if (window.UITelas) UITelas.toast(preferencia.mudo ? 'Música desligada. Aperte M para ligar.' : 'Música ligada.', 'info');
    } else if (tecla === 'n') {
      alternarEfeitos();
      if (window.UITelas) UITelas.toast(preferencia.efeitos ? 'Efeitos sonoros ligados.' : 'Efeitos sonoros desligados. Aperte N para ligar.', 'info');
    }
  });

  aplicar();                                          // vale desde já, mesmo antes do primeiro clique
  document.addEventListener('DOMContentLoaded', montar);

  return {
    definirVolume: definirVolume,
    alternarMudo: alternarMudo,
    definirVolumeEfeitos: definirVolumeEfeitos,
    alternarEfeitos: alternarEfeitos
  };
})();
