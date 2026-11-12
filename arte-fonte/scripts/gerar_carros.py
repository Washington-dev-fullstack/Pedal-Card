"""
gerar_carros.py — Imagens dos carros (vista de cima para a pista e vista 3/4)
-----------------------------------------------------------------------------
Gera em assets/carros/:
  carro-<pintura>-cima.webp   256 x 144  carro apontando para a direita, visto de cima
                                         (no jogo ocupa 64 x 36 unidades da pista)
  carro-<pintura>-34.webp     512 x 320  carro em 3/4 para o pódio e o livro de regras
e salva o modelo em arte-fonte/carro.blend (para abrir e olhar no Blender).

Rodar:  blender -b --factory-startup -P arte-fonte/scripts/gerar_carros.py
Prévia grande (fora do jogo):  ... -P gerar_carros.py -- --previa <pasta>
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import carro  # noqa: E402
import pedal  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIA = ARGS[ARGS.index("--previa") + 1] if "--previa" in ARGS else None

NUMEROS = {"azul": 1, "vermelho": 2, "verde": 3}

# Quadro da imagem de cima: 64 x 36 unidades do jogo = 5,42 x 3,05 m
LARGURA_QUADRO_M = 5.42


def render_cima(pintura):
    pedal.limpar_cena()
    pedal.configurar_render(1024 if PREVIA else 256, 576 if PREVIA else 144, amostras=128)
    carro.construir_carro(pintura, NUMEROS[pintura])
    pedal.luz_de_cima()
    pedal.camera_cima(LARGURA_QUADRO_M)
    if PREVIA:
        bpy.context.scene.render.filepath = os.path.join(PREVIA, f"cima-{pintura}.png")
        bpy.context.scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
    else:
        pedal.salvar(f"carros/carro-{pintura}-cima.webp", qualidade=90)


def render_34(pintura, salvar_blend=False):
    pedal.limpar_cena()
    pedal.configurar_render(1024 if PREVIA else 512, 640 if PREVIA else 320, amostras=160)
    carro.construir_carro(pintura, NUMEROS[pintura])
    # Câmera baixa, à frente e à direita do carro; a luminária fica no alto à
    # esquerda de quem olha (lado -X, -Y), iluminando o lado visível do carro.
    pedal.luz_luminaria(escala=1.0, forca=0.9, posicao=(-2.5, -6.5, 6.5), preenchimento=(7, 2, 3),
                        alvo=(0, 0, 0.4))
    pedal.camera_perspectiva((5.9, -6.9, 3.0), (-0.1, 0, 0.40), lente=60)
    if salvar_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(pedal.PASTA_PROJETO, "arte-fonte", "carro.blend"))
    if PREVIA:
        bpy.context.scene.render.filepath = os.path.join(PREVIA, f"34-{pintura}.png")
        bpy.context.scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
    else:
        pedal.salvar(f"carros/carro-{pintura}-34.webp", qualidade=88)


if __name__ == "__main__":
    pinturas = ["azul"] if PREVIA else list(NUMEROS)
    for pintura in pinturas:
        render_cima(pintura)
        render_34(pintura, salvar_blend=(pintura == "azul" and not PREVIA))
