"""
gerar_pecas.py — Peças físicas do tabuleiro do piloto
-----------------------------------------------------
Gera em assets/pecas/:
  cubo-calor.webp   128 x 128  cubo de madeira laqueada laranja (1 Calor), visto do alto em 3/4
  manopla.webp      160 x 160  manopla preta do câmbio, vista de cima (o número vem do HTML)

Rodar:  blender -b --factory-startup -P arte-fonte/scripts/gerar_pecas.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import pedal  # noqa: E402


def madeira_laqueada(nome, base):
    """Laca sobre madeira: cor viva com um veio bem suave por baixo do verniz."""
    m = pedal.material(nome, base, rugosidade=0.38, verniz=0.55, verniz_rugosidade=0.12)
    nos, links = m.node_tree.nodes, m.node_tree.links
    p = nos["Principled BSDF"]
    coord = nos.new("ShaderNodeTexCoord")
    mapa = nos.new("ShaderNodeMapping")
    mapa.inputs["Scale"].default_value = (1.0, 1.0, 9.0)
    ruido = nos.new("ShaderNodeTexNoise")
    ruido.inputs["Scale"].default_value = 3.0
    ruido.inputs["Detail"].default_value = 6.0
    mistura = nos.new("ShaderNodeMix"); mistura.data_type = "RGBA"
    mistura.inputs["A"].default_value = pedal.cor(base)
    mistura.inputs["B"].default_value = pedal.cor("#B8541F")
    links.new(coord.outputs["Object"], mapa.inputs["Vector"])
    links.new(mapa.outputs["Vector"], ruido.inputs["Vector"])
    links.new(ruido.outputs["Fac"], mistura.inputs["Factor"])
    links.new(mistura.outputs["Result"], p.inputs["Base Color"])
    return m


def cubo_calor():
    pedal.limpar_cena()
    pedal.configurar_render(128, 128, amostras=160)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    malha = bpy.data.meshes.new("Cubo")
    bm.to_mesh(malha); bm.free()
    obj = pedal.objeto("Cubo", malha)
    pedal.modificador(obj, "BEVEL", width=0.11, segments=5, limit_method="NONE")
    pedal.suavizar(obj)
    pedal.aplicar_material(obj, madeira_laqueada("Laca", "brasa"))
    # Câmera do alto, na diagonal; luminária no alto à esquerda de quem olha
    pedal.luz_luminaria(escala=0.6, forca=1.2, posicao=(-6, -1, 7), preenchimento=(3, -5, 5))
    cam = pedal.camera_perspectiva((2.6, -2.6, 3.2), (0, 0, -0.05), lente=60)
    cam.data.lens = 85
    pedal.salvar("pecas/cubo-calor.webp", qualidade=90)


def manopla():
    pedal.limpar_cena()
    pedal.configurar_render(160, 160, amostras=160)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.5)
    bmesh.ops.scale(bm, vec=Vector((1.0, 1.0, 0.82)), verts=bm.verts)
    malha = bpy.data.meshes.new("Bola"); bm.to_mesh(malha); bm.free()
    bola = pedal.objeto("Bola", malha)
    bola.location = (0, 0, 0.42)
    pedal.suavizar(bola)
    pedal.aplicar_material(bola, pedal.material("Baquelite", "#161311", rugosidade=0.22, verniz=1.0,
                                                verniz_rugosidade=0.03))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=0.25, radius2=0.2, depth=0.22)
    malha = bpy.data.meshes.new("Anel"); bm.to_mesh(malha); bm.free()
    anel = pedal.objeto("Anel", malha)
    anel.location = (0, 0, 0.02)
    pedal.suavizar(anel)
    pedal.aplicar_material(anel, pedal.material_metal("Cromo", "#D8D2C6", rugosidade=0.12))
    pedal.luz_luminaria(escala=0.7, forca=0.5, posicao=(-4, 4, 7), preenchimento=(4, -4, 3))
    # luz grande: brilho largo e suave na baquelite (um ponto pequeno parecia um sinal ao lado do número)
    bpy.data.lights["Luminaria"].size = 6.0
    pedal.camera_cima(1.25)
    pedal.salvar("pecas/manopla.webp", qualidade=90)


if __name__ == "__main__":
    cubo_calor()
    manopla()
