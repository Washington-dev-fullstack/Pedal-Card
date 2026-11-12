/* =====================================================================
   estado-ui.js — O ÚNICO objeto de estado da interface
   ---------------------------------------------------------------------
   Tudo que a tela precisa saber fica em EstadoUI. Quando algo muda,
   alteramos o EstadoUI e chamamos EstadoUI.render(), que redesenha
   HUD e mão de cartas a partir dele.

   Importante: EstadoUI.jogo é a última resposta da API. A interface
   não "inventa" regras; ela só mostra o que o servidor mandou.
   ===================================================================== */

var EstadoUI = {
  tela: 'inicial',

  // Escolhas feitas na tela inicial
  config: { nome: '', numBots: 2, dificuldade: 'medio' },

  partidaId: null,
  jogo: null,            // último estado recebido da API (formato da seção 6)
  marcha: 1,             // marcha escolhida no seletor
  selecionadas: [],      // ids das cartas selecionadas
  previsao: { situacao: 'vazia', dados: null, mensagem: '' }, // vazia | carregando | ok | erro
  ocupado: false,        // true enquanto espera o servidor ou anima os eventos
  vezAnimada: null,      // id do carro que está jogando durante a animação

  // Volta tudo ao começo (usado ao iniciar ou abandonar uma partida)
  reiniciar: function () {
    this.partidaId = null;
    this.jogo = null;
    this.marcha = 1;
    this.selecionadas = [];
    this.previsao = { situacao: 'vazia', dados: null, mensagem: '' };
    this.ocupado = false;
    this.vezAnimada = null;
  },

  // Guarda o novo estado vindo da API e ajusta as escolhas do jogador
  aplicarEstado: function (estado) {
    this.jogo = estado;
    this.partidaId = estado.partida.id;
    var humano = this.carroHumano();
    this.marcha = humano.marcha;
    // mantém só as seleções que ainda estão na mão
    this.selecionadas = this.selecionadas.filter(function (id) {
      return estado.minha_mao.some(function (c) { return c.id === id; });
    });
    this.previsao = { situacao: 'vazia', dados: null, mensagem: '' };
    this.vezAnimada = null;
  },

  carroHumano: function () {
    if (!this.jogo) return null;
    return this.jogo.carros.find(function (c) { return c.tipo === 'humano'; });
  },

  buscarCarro: function (id) {
    if (!this.jogo) return null;
    return this.jogo.carros.find(function (c) { return c.id === id; });
  },

  // Quantas cartas o jogador deve escolher na marcha selecionada
  cartasNecessarias: function () {
    if (!this.jogo) return 0;
    var velocidade = this.jogo.minha_mao.filter(function (c) { return c.tipo === 'velocidade'; }).length;
    return Math.min(this.marcha, velocidade);
  },

  opcaoMarcha: function (marcha) {
    if (!this.jogo) return null;
    return this.jogo.minhas_opcoes.marchas.find(function (o) { return o.marcha === marcha; });
  },

  ehMinhaVez: function () {
    var humano = this.carroHumano();
    return !!(humano && this.jogo.partida.status === 'em_andamento' &&
      this.jogo.partida.turno_de === humano.id && !this.ocupado);
  },

  // Pode apertar ACELERAR?
  podeConfirmar: function () {
    return this.ehMinhaVez() &&
      this.selecionadas.length === this.cartasNecessarias() &&
      this.previsao.situacao === 'ok';
  },

  render: function () {
    UIHud.render(this);
    UIMao.render(this);
    if (window.TrilhaJogo) TrilhaJogo.atualizar();   // a trilha sonora também acompanha o estado
  }
};
