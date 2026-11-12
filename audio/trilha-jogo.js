/* =====================================================================
   trilha-jogo.js — Liga a trilha sonora aos momentos do jogo
   ---------------------------------------------------------------------
   O AudioDirector sabe tocar música, mas não sabe nada do jogo. Este
   arquivo é o "tradutor": olha o estado do jogo e diz ao AudioDirector
   qual cena tocar e quanto calor o motor tem.

   O jogo avisa a trilha em três lugares (uma linha em cada):
     UITelas.mostrar()      -> telaMudou(nome)    troca de tela
     EstadoUI.render()      -> atualizar()        o estado na tela mudou
     UIEventos.reproduzir() -> evento(ev, carro)  cada lance da corrida

   Regras da corrida, em ordem de prioridade (função escolherCena):
     1. derrapou agora, ou motor com 0–1 cubo   -> 'overheat'
     2. o líder já passou da última curva       -> 'finalLap'
     3. vai gastar ou acabou de gastar Calor    -> 'pushing'
     4. o resto do tempo                        -> 'planning'
   Bandeirada: 'victory' se você venceu; se não, volta o tema do 'menu'.
   ===================================================================== */

var TrilhaJogo = (function () {
  'use strict';

  var derrapou = false;     // você derrapou: o motor "sofre" até a sua próxima jogada
  var pagouCalor = false;   // você pagou Calor na jogada que está sendo animada
  var acabou = false;       // a corrida terminou: a música da bandeirada já foi escolhida

  // O navegador só deixa tocar som depois que a pessoa clica ou aperta uma
  // tecla. Por isso o som é ligado no primeiro gesto; os ouvintes continuam
  // ativos para religar o som se o sistema o suspender (ex.: no celular).
  function liberarSom() {
    AudioDirector.init();
  }

  ['pointerdown', 'keydown', 'touchend'].forEach(function (tipo) {
    document.addEventListener(tipo, liberarSom, true);
  });

  // Chamada por UITelas.mostrar() sempre que a tela muda
  function telaMudou(nome) {
    if (nome === 'inicial') {
      acabou = false;
      AudioDirector.setScene('menu');
    } else if (nome === 'jogo') {
      acabou = false;
      derrapou = false;
      pagouCalor = false;
      atualizar();
    }
    // tela 'fim': a música da bandeirada já foi escolhida no evento fim_corrida
  }

  // Chamada por EstadoUI.render() e depois de cada evento animado
  function atualizar() {
    var jogo = EstadoUI.jogo;
    var humano = EstadoUI.carroHumano();
    if (acabou || EstadoUI.tela !== 'jogo' || !jogo || !humano) return;
    var previsao = EstadoUI.previsao;
    if (previsao.situacao === 'carregando') return;   // espera a previsão chegar (evita troca à toa)
    var minhaVez = EstadoUI.ehMinhaVez();
    if (minhaVez) pagouCalor = false;                 // na sua vez, vale a jogada que você está montando

    // A previsão é a jogada escolhida (e, depois de "Acelerar", a jogada que
    // está sendo animada). Calor = o que o motor já gastou + o que a jogada
    // escolhida vai gastar (esse só conta na sua vez; depois já saiu do motor).
    var previsto = previsao.situacao === 'ok' ? previsao.dados.calor_previsto : 0;
    var maximo = CONFIG.REGRAS.CALOR_MOTOR;
    var gasto = maximo - humano.motor + (minhaVez ? previsto : 0);
    AudioDirector.setHeat(Math.min(1, gasto / maximo));
    AudioDirector.setScene(escolherCena(jogo, humano, previsto > 0 || pagouCalor));
  }

  function escolherCena(jogo, humano, gastandoCalor) {
    var retaFinal = liderPassouDaUltimaCurva(jogo);
    if (derrapou) return 'overheat';
    if (humano.motor <= 1 && !retaFinal) return 'overheat';
    if (retaFinal) return 'finalLap';
    if (gastandoCalor) return 'pushing';
    return 'planning';
  }

  function liderPassouDaUltimaCurva(jogo) {
    var ultimaCurva = 0;
    jogo.pista.curvas.forEach(function (curva) { ultimaCurva = Math.max(ultimaCurva, curva.casa); });
    return jogo.carros.some(function (carro) { return carro.posicao > ultimaCurva; });
  }

  // Chamada por UIEventos.reproduzir() depois de cada evento da corrida
  function evento(ev, carro) {
    if (ev.tipo === 'fim_corrida') {
      acabou = true;
      var vencedor = EstadoUI.buscarCarro(ev.vencedor_id);
      AudioDirector.setScene(vencedor && vencedor.tipo === 'humano' ? 'victory' : 'menu');
      return;
    }
    if (carro && carro.tipo === 'humano') {
      if (ev.tipo === 'marcha') {      // começou uma jogada sua: esquece a anterior
        derrapou = false;
        pagouCalor = false;
      }
      if (ev.calor_pago > 0) pagouCalor = true;      // pagou Calor no câmbio ou numa curva
      if (ev.tipo === 'derrapagem') derrapou = true;
    }
    atualizar();
  }

  return {
    telaMudou: telaMudou,
    atualizar: atualizar,
    evento: evento
  };
})();
