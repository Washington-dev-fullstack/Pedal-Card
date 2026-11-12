/* =====================================================================
   ui-eventos.js — Reprodução dos eventos e painel (log) de eventos
   ---------------------------------------------------------------------
   O servidor devolve uma LISTA ORDENADA de eventos (marcha, mover,
   curva, derrapagem...). Aqui reproduzimos um por um: animamos na
   pista, escrevemos uma frase no log e atualizamos o HUD. Só no final
   o main.js aplica o estado completo que veio do servidor.
   ===================================================================== */

var UIEventos = (function () {
  'use strict';

  var MAX_ITENS_LOG = 60;

  function pausa(ms) {
    var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise(function (resolve) { setTimeout(resolve, reduzir ? Math.min(ms, 120) : ms); });
  }

  function nomeDe(carro) {
    return carro.tipo === 'humano' ? 'Você' : carro.nome;
  }

  /* ---------- Frases em português para cada evento ---------- */
  function textoDoEvento(ev) {
    var carro = ev.carro_id ? EstadoUI.buscarCarro(ev.carro_id) : null;
    var nome = carro ? nomeDe(carro) : '';
    var voce = carro && carro.tipo === 'humano';

    switch (ev.tipo) {
      case 'marcha':
        if (ev.de === ev.para) return null; // manteve a marcha: não precisa de frase
        return nome + ' ' + (ev.para > ev.de ? 'subiu' : 'reduziu') + ' para a ' + ev.para + 'ª marcha' +
          (ev.calor_pago > 0 ? ' e pagou ' + ev.calor_pago + ' de Calor (pulou 2 marchas).' : '.');
      case 'resfriar':
        return nome + ' resfriou o motor: +1 Calor (carta vinda ' + (ev.origem === 'mao' ? 'da mão' : 'do descarte') + ').';
      case 'cartas_jogadas':
        if (!ev.valores.length) return nome + ' não tinha cartas de Velocidade: velocidade 0.';
        return nome + ' jogou ' + ev.valores.join(' + ') + ' = velocidade ' + ev.velocidade + '.';
      case 'ajuste_ocupacao':
        return 'Casa ' + ev.pretendida + ' ocupada: ' + nome + ' parou na casa ' + ev.casa + '.';
      case 'mover':
        if (ev.de === ev.para) return nome + ' ficou na casa ' + ev.para + '.';
        return nome + ' avançou da casa ' + ev.de + ' para a ' + ev.para + '.';
      case 'curva':
        if (ev.calor_pago > 0) {
          return nome + ' fez a curva ' + ev.casa + ' a ' + ev.velocidade + ' (limite ' + ev.limite + ') e pagou ' + ev.calor_pago + ' de Calor.';
        }
        return nome + ' fez a curva ' + ev.casa + ' dentro do limite (' + ev.limite + ').';
      case 'derrapagem':
        return nome + ' DERRAPOU na curva ' + ev.casa + '! Precisava de ' + ev.calor_necessario + ' Calor e tinha ' +
          ev.calor_disponivel + '. Parou na casa ' + ev.para + ' e voltou para a 1ª marcha.';
      case 'vacuo':
        var daFrente = EstadoUI.buscarCarro(ev.atras_de);
        var deQuem = daFrente.tipo === 'humano' ? 'o seu rastro' : 'o rastro do ' + daFrente.nome;
        return nome + ' pegou ' + deQuem + ' e foi da casa ' + ev.de + ' para a ' + ev.para +
          ' (+' + (ev.para - ev.de) + (ev.para - ev.de === 1 ? ' casa).' : ' casas).');
      case 'compra':
        if (!voce && !ev.reembaralhou) return null;
        if (!voce) return nome + ' reembaralhou o descarte.';
        return 'Você comprou ' + ev.quantidade + (ev.quantidade === 1 ? ' carta' : ' cartas') +
          (ev.reembaralhou ? ' (o descarte foi reembaralhado).' : '.');
      case 'nova_rodada':
        return 'Rodada ' + ev.rodada;
      case 'fim_corrida':
        var vencedor = EstadoUI.buscarCarro(ev.vencedor_id);
        return 'Bandeirada! ' + (vencedor.tipo === 'humano' ? 'Você venceu' : vencedor.nome + ' venceu') + ' a corrida.';
      default:
        return null;
    }
  }

  function classeDoEvento(ev) {
    if (ev.tipo === 'derrapagem') return 'log-perigo';
    if (ev.tipo === 'curva' && ev.calor_pago > 0) return 'log-calor';
    if (ev.tipo === 'marcha' && ev.calor_pago > 0) return 'log-calor';
    if (ev.tipo === 'resfriar') return 'log-frio';
    if (ev.tipo === 'vacuo') return 'log-vacuo';
    if (ev.tipo === 'nova_rodada') return 'log-rodada';
    if (ev.tipo === 'fim_corrida') return 'log-fim';
    return '';
  }

  /* ---------- Log ---------- */
  function adicionarLog(texto, classe, carro) {
    var lista = document.getElementById('log-eventos');
    var item = document.createElement('li');
    item.className = 'log-item ' + (classe || '') + (carro && carro.tipo === 'humano' ? ' log-humano' : '');
    item.innerHTML = (carro ? seloCarroSVG(carro, 18) : '') + '<span></span>';
    item.lastChild.textContent = texto; // textContent evita injeção de HTML (ex.: nome do jogador)
    // Diário em ordem cronológica: a entrada nova vai no fim e a lista rola até ela
    lista.appendChild(item);
    while (lista.children.length > MAX_ITENS_LOG) lista.removeChild(lista.firstChild);
    lista.scrollTop = lista.scrollHeight;
  }

  function limparLog() {
    document.getElementById('log-eventos').innerHTML = '';
  }

  /* ---------- Reprodução animada ---------- */
  async function reproduzir(eventos) {
    var jogo = EstadoUI.jogo;
    for (var i = 0; i < eventos.length; i++) {
      var ev = eventos[i];
      var carro = ev.carro_id ? EstadoUI.buscarCarro(ev.carro_id) : null;

      // Troca de quem está jogando: mostra o banner
      if (carro && carro.id !== EstadoUI.vezAnimada) {
        EstadoUI.vezAnimada = carro.id;
        if (carro.tipo === 'bot') {
          UIHud.banner(carro.nome + ' está jogando…', 'bot');
          UIHud.renderParcial(EstadoUI);
          await pausa(CONFIG.ANIMACAO.PAUSA_TROCA_VEZ);
        } else {
          UIHud.banner('Você acelerou!', 'humano');
          UIHud.renderParcial(EstadoUI);
        }
      }

      // os efeitos sonoros começam junto com a animação do lance (pasta audio/)
      if (window.EfeitosJogo) EfeitosJogo.avisar('lance', { ev: ev, carro: carro });

      switch (ev.tipo) {
        case 'marcha':
          carro.marcha = ev.para;
          if (ev.calor_pago > 0) {
            carro.motor -= ev.calor_pago;
            UIPista.efeitoCalor(carro.id, ev.calor_pago);
          }
          break;
        case 'resfriar':
          carro.motor += 1;
          UIPista.efeitoResfriar(carro.id);
          break;
        case 'cartas_jogadas':
          if (carro.tipo === 'bot') UIHud.banner(carro.nome + ' jogou ' + (ev.valores.join(' + ') || 'nada') + ' = ' + ev.velocidade, 'bot');
          break;
        case 'mover':
          await UIPista.animarMovimento(carro.id, ev.de, ev.para);
          carro.posicao = ev.para;
          if (ev.para > ev.de) UIPista.efeitoTexto(carro.id, '+' + (ev.para - ev.de), 'sucesso');
          break;
        case 'curva':
          if (ev.calor_pago > 0) {
            carro.motor -= ev.calor_pago;
            UIPista.efeitoCalor(carro.id, ev.calor_pago);
            await pausa(450);
          } else if (carro.tipo === 'humano') {
            UIPista.efeitoTexto(carro.id, 'CURVA PERFEITA', 'sucesso');
            await pausa(300);
          }
          break;
        case 'derrapagem':
          carro.marcha = 1;
          carro.derrapagens += 1;
          UITelas.tremerPista();
          await UIPista.efeitoDerrapagem(carro.id);
          if (carro.tipo === 'humano') UITelas.toast('Você derrapou na curva ' + ev.casa + '! Marcha voltou para 1.', 'perigo');
          break;
        case 'vacuo':
          // Rastro: o carro é puxado pelo ar do carro da frente
          await UIPista.animarMovimento(carro.id, ev.de, ev.para);
          carro.posicao = ev.para;
          UIPista.efeitoTexto(carro.id, 'RASTRO +' + (ev.para - ev.de), 'vacuo');
          break;
        case 'nova_rodada':
          jogo.partida.rodada = ev.rodada;
          break;
        case 'fim_corrida':
          EstadoUI.vezAnimada = null;
          break;
      }

      var texto = textoDoEvento(ev);
      if (texto) adicionarLog(texto, classeDoEvento(ev), carro);
      UIHud.renderParcial(EstadoUI);
      if (window.TrilhaJogo) TrilhaJogo.evento(ev, carro);   // a trilha sonora reage ao lance
      if (ev.tipo !== 'compra') await pausa(CONFIG.ANIMACAO.PAUSA_EVENTO);
    }
  }

  return {
    reproduzir: reproduzir,
    adicionarLog: adicionarLog,
    limparLog: limparLog
  };
})();
