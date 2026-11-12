"""
gerar_pista.py — Texturas e cenário da maquete da pista
-------------------------------------------------------
Gera em assets/pista/:
  Texturas sem emenda (512 x 512), usadas como ladrilhos no SVG da pista:
    grama.webp, asfalto.webp, capim-cerrado.webp, chao-pinhais.webp, areia.webp
  Cenário visto de cima (fundo transparente; a sombra é feita no SVG do jogo):
    arvore-1.webp, arvore-2.webp, arvore-3.webp   (não giram: luz da luminária)
    araucaria-1/2, cerrado-1/2, coqueiro, restinga (biomas: Pinhais, Cerrado e Dunas)
    arquibancada.webp, boxes.webp, pneus.webp     (giram para acompanhar a pista: luz de cima)
  Escala: 1 metro = 11,8 unidades da pista; as imagens têm 4 pixels por unidade.

As texturas saem de ruído feito com FFT (numpy): o ruído criado assim é
"periódico", então a borda direita casa com a esquerda e a de cima com a de baixo.

Rodar:  blender -b --factory-startup -P arte-fonte/scripts/gerar_pista.py
Só os biomas:  ... -P gerar_pista.py -- --biomas
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import pedal  # noqa: E402

N = 512
UNIDADES_POR_METRO = 11.8
PIXELS_POR_UNIDADE = 4


# ================================================================ texturas

def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def passa_baixa(campo, ciclos):
    """Suaviza um campo mantendo só as ondas com até ~'ciclos' repetições por ladrilho."""
    k = np.fft.fftfreq(campo.shape[0]) * campo.shape[0]
    kx, ky = np.meshgrid(k, k)
    filtro = np.exp(-((kx ** 2 + ky ** 2) / (ciclos ** 2)))
    return np.real(np.fft.ifft2(np.fft.fft2(campo) * filtro))


def ruido(rng, ciclos):
    """Ruído periódico normalizado (média 0, desvio 1)."""
    r = passa_baixa(rng.standard_normal((N, N)), ciclos)
    return (r - r.mean()) / (r.std() + 1e-9)


def pintas(rng, densidade, maciez=170):
    """Pontinhos esparsos e macios (tufos de grama, pedrinhas do asfalto)."""
    m = (rng.random((N, N)) < densidade).astype(np.float32)
    m = passa_baixa(m, maciez)
    return np.clip(m / (m.max() + 1e-9) * 1.6, 0, 1)


def misturar(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


def suave(x, a=-1.0, b=1.0):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def salvar_textura(nome, rgb):
    img = bpy.data.images.new(nome, N, N, alpha=False)
    rgba = np.ones((N, N, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())  # o Blender guarda as linhas de baixo para cima
    cena = bpy.context.scene
    cena.view_settings.view_transform = "Standard"
    cena.render.image_settings.file_format = "WEBP"
    cena.render.image_settings.color_mode = "RGB"
    cena.render.image_settings.quality = 82
    destino = os.path.join(pedal.PASTA_ASSETS, "pista", nome + ".webp")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    img.save_render(destino, scene=cena)
    print("SALVO", destino)


def textura_vegetal(nome, escura, clara, mancha, ponta_clara, ponta_escura, semente,
                    terra=None, quantidade_terra=0.0):
    rng = np.random.default_rng(semente)
    base = misturar(hex_rgb(escura), hex_rgb(clara), suave(ruido(rng, 4), -1.3, 1.3))
    manchas = suave(ruido(rng, 22), 0.4, 1.6) * 0.45
    rgb = misturar(base, hex_rgb(mancha), manchas)
    if terra:
        rgb = misturar(rgb, hex_rgb(terra), suave(ruido(rng, 9), 1.0, 2.0) * quantidade_terra)
    rgb += ruido(rng, 150)[..., None] * 0.028          # grão fino de "grama de maquete"
    rgb = misturar(rgb, hex_rgb(ponta_clara), pintas(rng, 0.010) * 0.85)
    rgb = misturar(rgb, hex_rgb(ponta_escura), pintas(rng, 0.008) * 0.75)
    salvar_textura(nome, rgb)


def textura_asfalto():
    rng = np.random.default_rng(7)
    rgb = np.ones((N, N, 3), dtype=np.float32) * hex_rgb("#2E2F31")
    rgb += ruido(rng, 3)[..., None] * 0.012
    rgb += ruido(rng, 210)[..., None] * 0.026
    rgb = misturar(rgb, hex_rgb("#55565A"), pintas(rng, 0.018, 220) * 0.8)
    rgb = misturar(rgb, hex_rgb("#1C1D1F"), pintas(rng, 0.018, 220) * 0.8)
    salvar_textura("asfalto", rgb)


def textura_areia():
    rng = np.random.default_rng(11)
    base = misturar(hex_rgb("#D3B983"), hex_rgb("#E6D2A3"), suave(ruido(rng, 4), -1.3, 1.3))
    y = np.arange(N)[:, None] / N
    x = np.arange(N)[None, :] / N
    torcao = ruido(rng, 3) * 0.06
    ondas = np.sin(2 * np.pi * (14 * y + 2 * x + torcao))   # frequências inteiras: casa nas bordas
    rgb = base + (ondas * 0.035)[..., None]
    rgb += ruido(rng, 200)[..., None] * 0.02
    rgb = misturar(rgb, hex_rgb("#9E8656"), pintas(rng, 0.006) * 0.6)
    salvar_textura("areia", rgb)


# ================================================================ cenário

def cena_de_cenario(largura_m, altura_m, luz="cima", forca=1.0):
    pedal.limpar_cena()
    px_w = round(largura_m * UNIDADES_POR_METRO * PIXELS_POR_UNIDADE)
    px_h = round(altura_m * UNIDADES_POR_METRO * PIXELS_POR_UNIDADE)
    pedal.configurar_render(px_w, px_h, amostras=128)
    if luz == "cima":
        pedal.luz_de_cima(escala=2.0, forca=forca)
    else:
        pedal.luz_luminaria(escala=2.0, forca=0.85 * forca)
    pedal.camera_cima(max(largura_m, altura_m))


def material_folhas(nome, escura, clara):
    m = pedal.material(nome, escura, rugosidade=0.85)
    nos, links = m.node_tree.nodes, m.node_tree.links
    p = nos["Principled BSDF"]
    ruido_n = nos.new("ShaderNodeTexNoise")
    ruido_n.inputs["Scale"].default_value = 9.0
    ruido_n.inputs["Detail"].default_value = 8.0
    ao = nos.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.6
    mistura = nos.new("ShaderNodeMix"); mistura.data_type = "RGBA"
    mistura.inputs["A"].default_value = pedal.cor(escura)
    mistura.inputs["B"].default_value = pedal.cor(clara)
    escurece = nos.new("ShaderNodeMix"); escurece.data_type = "RGBA"; escurece.blend_type = "MULTIPLY"
    escurece.inputs["Factor"].default_value = 1.0
    links.new(ruido_n.outputs["Fac"], mistura.inputs["Factor"])
    links.new(mistura.outputs["Result"], escurece.inputs["A"])
    links.new(ao.outputs["AO"], escurece.inputs["B"])
    links.new(escurece.outputs["Result"], p.inputs["Base Color"])
    return m


def copa(nome, centro, raio, material, semente):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=raio)
    bmesh.ops.scale(bm, vec=Vector((1, 1, 0.75)), verts=bm.verts)
    # girar a malha muda onde o ruído de "folhas" é lido: cada copa fica diferente
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.radians(semente * 47), 3, "Z") @ Matrix.Rotation(math.radians(semente * 23), 3, "X"))
    malha = bpy.data.meshes.new(nome); bm.to_mesh(malha); bm.free()
    obj = pedal.objeto(nome, malha)
    obj.location = centro
    tex = bpy.data.textures.new(nome + "_nuvens", "CLOUDS")
    tex.noise_scale = 0.32 * raio
    tex.noise_depth = 3
    desloca = obj.modifiers.new("Folhas", "DISPLACE")
    desloca.texture = tex
    desloca.strength = 0.42 * raio
    desloca.mid_level = 0.55
    desloca.texture_coords = "GLOBAL"
    pedal.suavizar(obj)
    pedal.aplicar_material(obj, material)
    return obj


def arvores():
    variantes = [
        ("arvore-1", [((0, 0, 1.2), 1.55)], "#3E5F22", "#6F9636", 1),
        ("arvore-2", [((0, 0, 1.0), 1.1)], "#5A7A26", "#93AE46", 2),
        ("arvore-3", [((-0.55, 0.35, 1.1), 1.05), ((0.6, 0.15, 1.0), 0.95), ((0.05, -0.6, 0.9), 0.85)],
         "#2F4B1C", "#5B7F2E", 3),
    ]
    for nome, copas, escura, clara, semente in variantes:
        cena_de_cenario(4.2, 4.2, luz="luminaria")
        folhas = material_folhas("Folhas", escura, clara)
        for i, (centro, raio) in enumerate(copas):
            copa(f"Copa{i}", centro, raio, folhas, semente * 10 + i)
        pedal.salvar(f"pista/{nome}.webp", qualidade=86)


def caixa_simples(nome, centro, tamanho, material):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(tamanho), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centro), verts=bm.verts)
    malha = bpy.data.meshes.new(nome); bm.to_mesh(malha); bm.free()
    obj = pedal.objeto(nome, malha)
    pedal.aplicar_material(obj, material)
    return obj


def muitas_caixas(nome, caixas, material):
    """Junta muitas caixinhas numa malha só (assentos, telhas, aparelhos)."""
    bm = bmesh.new()
    for centro, tamanho in caixas:
        geom = bmesh.ops.create_cube(bm, size=1.0)
        vs = geom["verts"]
        bmesh.ops.scale(bm, vec=Vector(tamanho), verts=vs)
        bmesh.ops.translate(bm, vec=Vector(centro), verts=vs)
    malha = bpy.data.meshes.new(nome); bm.to_mesh(malha); bm.free()
    obj = pedal.objeto(nome, malha)
    pedal.aplicar_material(obj, material)
    return obj


def arquibancada():
    """Arquibancada descoberta: degraus que sobem para o alto da imagem e a frente
    (mureta creme) embaixo. No jogo, a frente aponta para a pista."""
    largura, fileiras, profundidade, altura_degrau = 12.0, 6, 0.56, 0.36
    cena_de_cenario(12.5, 4.17, luz="cima")
    concreto = pedal.material("Concreto", "#A8A196", rugosidade=0.8)
    creme = pedal.material("Mureta", "papel_claro", rugosidade=0.6)
    y0 = -1.65
    for f in range(fileiras):
        caixa_simples(f"Degrau{f}", (0, y0 + f * profundidade, (f + 1) * altura_degrau / 2),
                      (largura, profundidade, (f + 1) * altura_degrau), concreto)
    caixa_simples("Fundo", (0, y0 + fileiras * profundidade + 0.1, fileiras * altura_degrau / 2 + 0.3),
                  (largura + 0.2, 0.22, fileiras * altura_degrau + 0.6), concreto)
    caixa_simples("Mureta", (0, y0 - 0.38, 0.28), (largura + 0.2, 0.16, 0.56), creme)
    rnd = random.Random(42)
    setores = [("vermelho", -largura / 2, -largura / 6), ("azul", -largura / 6, largura / 6), ("ocre", largura / 6, largura / 2)]
    publico = []
    for cor_nome, xa, xb in setores:
        assentos = []
        for f in range(fileiras):
            x = xa + 0.2
            while x < xb - 0.2:
                assentos.append(((x, y0 + f * profundidade - 0.05, (f + 1) * altura_degrau + 0.06), (0.3, 0.3, 0.12)))
                if rnd.random() < 0.55:
                    publico.append((x + rnd.uniform(-0.04, 0.04), y0 + f * profundidade - 0.02,
                                    (f + 1) * altura_degrau + 0.32))
                x += 0.38
        muitas_caixas(f"Assentos_{cor_nome}", assentos, pedal.material(f"Assento_{cor_nome}", cor_nome, rugosidade=0.5))
    # Público: cabecinhas e ombros em cores variadas
    cores_roupa = ["#F7EEDB", "#C63A2B", "#1F6FA0", "#E2A33B", "#2A9D5C", "#3D4A57", "#E0702F"]
    for i, cor_roupa in enumerate(cores_roupa):
        grupo = [p for j, p in enumerate(publico) if j % len(cores_roupa) == i]
        muitas_caixas(f"Publico{i}", [((x, y, z), (0.26, 0.2, 0.2)) for x, y, z in grupo],
                      pedal.material(f"Roupa{i}", cor_roupa, rugosidade=0.7))
        cabecas = bmesh.new()
        for x, y, z in grupo:
            g = bmesh.ops.create_uvsphere(cabecas, u_segments=10, v_segments=6, radius=0.085)
            bmesh.ops.translate(cabecas, vec=Vector((x, y, z + 0.16)), verts=g["verts"])
        malha = bpy.data.meshes.new(f"Cabecas{i}"); cabecas.to_mesh(malha); cabecas.free()
        obj = pedal.objeto(f"Cabecas{i}", malha)
        pedal.aplicar_material(obj, pedal.material(f"Cabelo{i}", ["#2A1D14", "#5A3A22", "#C9A26B", "#1C1512"][i % 4], rugosidade=0.8))
    pedal.salvar("pista/arquibancada.webp", qualidade=86)


def boxes():
    """Prédio dos boxes visto de cima: telhado claro com aparelhos e claraboias,
    faixa ocre na beirada que fica de frente para a pista (embaixo na imagem)."""
    cena_de_cenario(14.5, 3.84, luz="cima", forca=0.55)
    telhado = pedal.material("Telhado", "#CFC7B8", rugosidade=0.75)
    vidro = pedal.material("Claraboia", "#2B3640", rugosidade=0.15)
    aparelho = pedal.material("Aparelho", "#9C978E", rugosidade=0.5, metal=0.4)
    faixa = pedal.material("Faixa", "ocre", rugosidade=0.5)
    torre = pedal.material("Torre", "#E6DCC8", rugosidade=0.6)
    caixa_simples("Predio", (0, 0, 0.8), (13.0, 3.0, 1.6), telhado)
    caixa_simples("Faixa", (0, -1.52, 1.45), (13.0, 0.06, 0.3), faixa)
    caixa_simples("Torre", (5.6, 0.1, 1.4), (1.9, 2.6, 2.8), torre)
    caixa_simples("TorreVidro", (5.6, -1.2, 2.55), (1.9, 0.1, 0.5), vidro)
    muitas_caixas("Claraboias", [((x, 0.35, 1.62), (1.1, 0.7, 0.05)) for x in (-5.2, -3.4, -1.6, 0.2, 2.0, 3.8)], vidro)
    muitas_caixas("Aparelhos", [((x, -0.65, 1.75), (0.6, 0.5, 0.3)) for x in (-4.3, -0.7, 2.9)], aparelho)
    pedal.salvar("pista/boxes.webp", qualidade=86)


def pneus():
    """Barreira de pneus: 2 fileiras de 4 pilhas; o pneu de cima é pintado."""
    cena_de_cenario(3.0, 1.6, luz="cima")
    borracha = pedal.material_borracha()
    pintados = [pedal.material("PneuCreme", "papel_claro", rugosidade=0.6),
                pedal.material("PneuVermelho", "vermelho", rugosidade=0.6)]
    for linha in range(2):
        for col in range(4):
            x, y = -1.08 + col * 0.72, -0.34 + linha * 0.68
            for andar in range(3):
                bm = bmesh.new()
                bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=0.33, radius2=0.33, depth=0.2)
                malha = bpy.data.meshes.new("Pneu"); bm.to_mesh(malha); bm.free()
                obj = pedal.objeto("Pneu", malha)
                obj.location = (x, y, 0.1 + andar * 0.21)
                pedal.modificador(obj, "SOLIDIFY", thickness=0.13)
                pedal.modificador(obj, "BEVEL", width=0.04, segments=3)
                pedal.suavizar(obj)
                material = pintados[(linha + col) % 2] if andar == 2 else borracha
                pedal.aplicar_material(obj, material)
    pedal.salvar("pista/pneus.webp", qualidade=86)


# ================================================================ biomas

def galho(nome, a, b, raio, material):
    """Tubo fino entre dois pontos (galhos de árvore)."""
    a, b = Vector(a), Vector(b)
    direcao = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=raio, radius2=raio * 0.6, depth=direcao.length)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=direcao.to_track_quat("Z", "Y").to_matrix())
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    malha = bpy.data.meshes.new(nome); bm.to_mesh(malha); bm.free()
    obj = pedal.objeto(nome, malha)
    pedal.aplicar_material(obj, material)
    return obj


def araucarias():
    """Araucária vista de cima: galhos em raio, em dois andares, terminando em tufos."""
    for n, (galhos, alcance, semente) in enumerate(((13, 1.85, 4), (11, 1.55, 5)), start=1):
        cena_de_cenario(4.6, 4.6, luz="luminaria")
        madeira = pedal.material("Galho", "#4A3524", rugosidade=0.9)
        folhas = material_folhas("FolhasAraucaria", "#1F3A1A", "#4C6E33")
        rnd = random.Random(semente)
        for andar, (altura, fator) in enumerate(((3.0, 1.0), (3.5, 0.62))):
            for k in range(galhos):
                ang = 2 * math.pi * (k + 0.5 * andar) / galhos + rnd.uniform(-0.12, 0.12)
                r = alcance * fator * rnd.uniform(0.85, 1.05)
                ponta = (math.cos(ang) * r, math.sin(ang) * r, altura + 0.35)
                galho(f"Galho{andar}_{k}", (0, 0, altura), ponta, 0.05, madeira)
                copa(f"Tufo{andar}_{k}", ponta, 0.36 * fator + 0.12, folhas, semente * 100 + andar * 20 + k)
        copa("TufoCentro", (0, 0, 3.9), 0.42, folhas, semente)
        pedal.salvar(f"pista/araucaria-{n}.webp", qualidade=86)


def arvores_cerrado():
    """Árvore do cerrado: copa rala em tufos, com os galhos tortos aparecendo entre eles."""
    for n, semente in enumerate((7, 8), start=1):
        cena_de_cenario(4.2, 4.2, luz="luminaria")
        madeira = pedal.material("GalhoTorto", "#5A3E28", rugosidade=0.9)
        folhas = material_folhas("FolhasCerrado", "#5E6A2A", "#A9A84E")
        rnd = random.Random(semente)
        for k in range(5 + n):
            ang = rnd.uniform(0, 2 * math.pi)
            r = rnd.uniform(0.5, 1.45)
            ponta = (math.cos(ang) * r, math.sin(ang) * r, 2.2 + rnd.uniform(-0.3, 0.3))
            meio = (ponta[0] * 0.45 + rnd.uniform(-0.25, 0.25), ponta[1] * 0.45 + rnd.uniform(-0.25, 0.25), 1.6)
            galho(f"Galho{k}a", (0, 0, 0.6), meio, 0.09, madeira)
            galho(f"Galho{k}b", meio, ponta, 0.06, madeira)
            copa(f"Tufo{k}", ponta, rnd.uniform(0.38, 0.6), folhas, semente * 10 + k)
        pedal.salvar(f"pista/cerrado-{n}.webp", qualidade=86)


def coqueiro():
    """Coqueiro visto de cima: folhas longas em estrela e cocos no centro."""
    cena_de_cenario(5.0, 5.0, luz="luminaria")
    folha = pedal.material("FolhaCoqueiro", "#5F8A2E", rugosidade=0.7)
    coco = pedal.material("Coco", "#6B4A2B", rugosidade=0.6)
    rnd = random.Random(9)
    for k in range(11):
        ang = 2 * math.pi * k / 11 + rnd.uniform(-0.1, 0.1)
        comp = rnd.uniform(1.9, 2.3)
        bm = bmesh.new()
        pontos = []
        for i in range(9):
            t = i / 8
            largura = 0.32 * math.sin(math.pi * min(1.0, t * 1.15))
            pontos.append((t * comp, largura, -0.9 * t * t))
        vs = []
        for x, w, z in pontos:
            vs.append(bm.verts.new((x, -w, z)))
            vs.append(bm.verts.new((x, w, z)))
            vs.append(bm.verts.new((x, 0, z + 0.06)))
        for i in range(len(pontos) - 1):
            a = 3 * i
            bm.faces.new((vs[a], vs[a + 2], vs[a + 5], vs[a + 3]))
            bm.faces.new((vs[a + 2], vs[a + 1], vs[a + 4], vs[a + 5]))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(ang, 3, "Z"))
        bmesh.ops.translate(bm, vec=Vector((0, 0, 3.0)), verts=bm.verts)
        malha = bpy.data.meshes.new("Folha"); bm.to_mesh(malha); bm.free()
        obj = pedal.objeto("Folha", malha)
        pedal.modificador(obj, "SOLIDIFY", thickness=0.03)
        pedal.aplicar_material(obj, folha)
    for k in range(4):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.16)
        malha = bpy.data.meshes.new("Coco"); bm.to_mesh(malha); bm.free()
        c = pedal.objeto("Coco", malha)
        c.location = (math.cos(k * 1.6) * 0.18, math.sin(k * 1.6) * 0.18, 2.95)
        pedal.suavizar(c)
        pedal.aplicar_material(c, coco)
    pedal.salvar("pista/coqueiro.webp", qualidade=86)


def restinga():
    """Moita baixa de restinga, com florzinhas."""
    cena_de_cenario(3.0, 3.0, luz="luminaria")
    folhas = material_folhas("FolhasRestinga", "#5C7A30", "#9DB25A")
    for k, (x, y, r) in enumerate(((-0.4, 0.2, 0.62), (0.45, 0.25, 0.5), (0.0, -0.45, 0.55), (0.6, -0.4, 0.38))):
        copa(f"Moita{k}", (x, y, 0.45), r, folhas, 60 + k)
    flor = pedal.material("Flor", "#E9A3B6", rugosidade=0.6)
    rnd = random.Random(12)
    for k in range(14):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.06)
        malha = bpy.data.meshes.new("Flor"); bm.to_mesh(malha); bm.free()
        f = pedal.objeto("Flor", malha)
        f.location = (rnd.uniform(-0.8, 0.9), rnd.uniform(-0.8, 0.7), 0.95)
        pedal.aplicar_material(f, flor)
    pedal.salvar("pista/restinga.webp", qualidade=86)


if __name__ == "__main__":
    SO_BIOMAS = "--biomas" in sys.argv
    if SO_BIOMAS:
        araucarias()
        arvores_cerrado()
        coqueiro()
        restinga()
        sys.exit(0)
    textura_vegetal("grama", "#4A6827", "#5E8134", "#6E9140", "#97B65B", "#33481B", semente=1)
    textura_vegetal("capim-cerrado", "#8A7A3C", "#A69050", "#B9A25E", "#D2BE7C", "#6B5A2C", semente=2,
                    terra="#9A6A42", quantidade_terra=0.55)
    textura_vegetal("chao-pinhais", "#3A5429", "#4B6833", "#56763A", "#7D9A55", "#6C583A", semente=3)
    textura_asfalto()
    textura_areia()
    arvores()
    arquibancada()
    boxes()
    pneus()
    araucarias()
    arvores_cerrado()
    coqueiro()
    restinga()
