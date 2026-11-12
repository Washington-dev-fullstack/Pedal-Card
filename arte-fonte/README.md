# Arte do Pedal Card (fontes no Blender)

Toda imagem da pasta `assets/` foi feita pelo grupo no **Blender 5.2**, por scripts em Python.
O jogo **não** carrega nada desta pasta: ele só usa as imagens prontas em `assets/` (WebP),
então continua abrindo com duplo clique no `index.html`, offline e sem bibliotecas.

## A direção de arte em uma frase

*Quente, veloz, maquete de colecionador*: o jogo é uma edição de colecionador sobre a mesa,
numa noite de jogo, iluminada por uma luminária. Três regras valem para todas as telas:

| Matéria | Exemplos | Como é feita |
|---|---|---|
| Objeto físico | carros, cubos de calor, manopla, árvores, arquibancadas | renderizado aqui; uma luz no alto à esquerda, sombra para baixo à direita |
| Superfície impressa | cartas, tampa com o logo, tabuleiro do piloto, livro de regras | CSS/SVG em estilo cartaz de corrida dos anos 70 (cores chapadas, sem brilho) |
| Ambiente | a mesa escura e a luz âmbar | CSS (o âmbar também marca seleção e foco) |

A decisão completa está em `docs/superpowers/specs/2026-10-02-reforma-visual-design.md`.

## Scripts

Rodar a partir da pasta do projeto (o Blender abre em segundo plano, sem janela):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P arte-fonte/scripts/<script>.py
```

| Script | O que gera em `assets/` |
|---|---|
| `pedal.py` | (módulo comum) paleta, render no Cycles, luzes, câmeras, salvar em WebP |
| `carro.py` | (módulo) o modelo da miniatura de fórmula anos 70, usado em todas as imagens |
| `gerar_carros.py` | `carros/`: carro visto de cima (pista) e em 3/4 (pódio e regras), nas 3 pinturas; salva `carro.blend` |
| `gerar_pecas.py` | `pecas/`: cubo de calor e manopla do câmbio |
| `gerar_pista.py` | `pista/`: texturas sem emenda (grama, asfalto, capim do cerrado, chão de pinhais, areia) e o cenário (árvores, araucárias, coqueiro, restinga, arquibancada, boxes, pneus). `-- --biomas` gera só o cenário dos biomas |
| `gerar_cartas.py` | `cartas/`: ilustrações das cartas em "serigrafia" de duas tintas, feitas do mesmo carro 3D |
| `gerar_titulo.py` | `titulo/`: a arte da tela inicial (a mesa com a maquete) e o recorte do celular; salva `titulo.blend`. `-- --previa arquivo.png` faz uma prévia rápida |

## Como algumas coisas funcionam

- **Escala:** 1 metro do carro = 11,8 unidades da pista do jogo; as imagens têm 4 pixels por unidade,
  para ficarem nítidas em telas de alta densidade.
- **Carros que giram:** na pista o carro gira para seguir o traçado. Por isso a imagem vista de cima usa
  luz simétrica (4 softboxes em anel) e a sombra é feita no SVG do jogo, sempre para baixo à direita.
- **Texturas sem emenda:** o ruído é criado com FFT (numpy); ruído feito assim é periódico, então a
  borda direita da imagem casa com a esquerda.
- **Cartas em duas tintas:** o render do carro vira tons: sombra = azul-marinho chapado,
  meio-tom = pontinhos de retícula a 45°, luz = transparente (aparece a cor da carta), brilho = creme.
