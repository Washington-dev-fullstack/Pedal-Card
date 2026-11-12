"""
carro.py — Modelo 3D da miniatura de fórmula dos anos 70 (o carro do Pedal Card)
--------------------------------------------------------------------------------
Um único modelo, usado em todas as imagens do jogo (pista, pódio, livro de regras,
cartas e arte do título). Medidas em metros; o carro aponta para +X (frente),
a largura fica em Y e a altura em Z.

construir_carro("azul", 1) devolve o objeto raiz (um "Empty"); todas as peças
são filhas dele, então basta mover/girar a raiz para posicionar o carro.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import pedal


# ------------------------------------------------------------ formas básicas

def _malha_de_bmesh(nome, bm):
    malha = bpy.data.meshes.new(nome)
    bm.to_mesh(malha)
    bm.free()
    return malha


def caixa(nome, centro, tamanho, material, raiz, bisel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(tamanho), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centro), verts=bm.verts)
    obj = pedal.objeto(nome, _malha_de_bmesh(nome, bm))
    pedal.aplicar_material(obj, material)
    if bisel:
        pedal.modificador(obj, "BEVEL", width=bisel, segments=3, limit_method="NONE")
        pedal.suavizar(obj)
    obj.parent = raiz
    return obj


def cilindro(nome, centro, raio, comprimento, material, raiz, eixo="Y", segmentos=28, raio2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segmentos, radius1=raio,
                          radius2=raio if raio2 is None else raio2, depth=comprimento)
    if eixo == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    elif eixo == "X":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    bmesh.ops.translate(bm, vec=Vector(centro), verts=bm.verts)
    obj = pedal.objeto(nome, _malha_de_bmesh(nome, bm))
    pedal.aplicar_material(obj, material)
    pedal.suavizar(obj)
    obj.parent = raiz
    return obj


def esfera(nome, centro, raio, material, raiz, escala=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=raio)
    bmesh.ops.scale(bm, vec=Vector(escala), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centro), verts=bm.verts)
    obj = pedal.objeto(nome, _malha_de_bmesh(nome, bm))
    pedal.aplicar_material(obj, material)
    pedal.suavizar(obj)
    obj.parent = raiz
    return obj


def barra(nome, a, b, raio, material, raiz):
    """Tubo fino entre dois pontos (braços de suspensão)."""
    a, b = Vector(a), Vector(b)
    direcao = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=raio, radius2=raio, depth=direcao.length)
    rot = direcao.to_track_quat("Z", "Y").to_matrix()
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    obj = pedal.objeto(nome, _malha_de_bmesh(nome, bm))
    pedal.aplicar_material(obj, material)
    obj.parent = raiz
    return obj


def loft(nome, secoes, material, raiz, lados=20, expoente=2.6, centro_y=0.0, nivel=2):
    """Casca suave feita de seções transversais ao longo de X.
    Cada seção: (x, meia_largura, z_baixo, z_alto). A seção é um "retângulo
    arredondado" (superelipse); depois a subdivisão deixa tudo liso."""
    verts, faces = [], []
    for (x, w, zb, zt) in secoes:
        zc, h = (zb + zt) / 2, (zt - zb) / 2
        for i in range(lados):
            t = 2 * math.pi * i / lados
            c, s = math.cos(t), math.sin(t)
            y = w * math.copysign(abs(c) ** (2 / expoente), c)
            z = zc + h * math.copysign(abs(s) ** (2 / expoente), s)
            verts.append((x, centro_y + y, z))
    for k in range(len(secoes) - 1):
        for i in range(lados):
            a = k * lados + i
            b = k * lados + (i + 1) % lados
            faces.append((a, b, b + lados, a + lados))
    # tampas nas pontas
    faces.append(tuple(reversed(range(lados))))
    ultimo = (len(secoes) - 1) * lados
    faces.append(tuple(range(ultimo, ultimo + lados)))
    malha = bpy.data.meshes.new(nome)
    malha.from_pydata(verts, [], faces)
    malha.update()
    obj = pedal.objeto(nome, malha)
    pedal.aplicar_material(obj, material)
    pedal.modificador(obj, "SUBSURF", levels=nivel, render_levels=nivel)
    pedal.suavizar(obj)
    obj.parent = raiz
    return obj


def numero(nome, texto, centro, tamanho, material, raiz, rotacao=(0, 0, 0)):
    curva = bpy.data.curves.new(nome, "FONT")
    curva.body = texto
    try:
        curva.font = bpy.data.fonts.load(pedal.FONTE_NUMEROS, check_existing=True)
    except RuntimeError:
        pass
    curva.align_x = "CENTER"
    curva.align_y = "CENTER"
    curva.size = tamanho
    curva.extrude = 0.002
    obj = pedal.objeto(nome, curva)
    obj.location = centro
    obj.rotation_euler = rotacao
    pedal.aplicar_material(obj, material)
    obj.parent = raiz
    return obj


# ------------------------------------------------------------ o carro

def construir_carro(pintura="azul", num=1, prefixo=None):
    """Monta a miniatura. 'pintura' é azul, vermelho ou verde (cores da paleta)."""
    p = prefixo or pintura
    raiz = bpy.data.objects.new(f"Carro_{p}", None)
    bpy.context.scene.collection.objects.link(raiz)

    cor_equipe = pedal.PINTURAS[pintura]
    laca = pedal.material_faixa(f"Laca_{p}", cor_equipe, faixa=pedal.PALETA["papel_claro"], largura=0.085)
    laca_lisa = pedal.material_laca(f"LacaLisa_{p}", cor_equipe)
    creme = pedal.material(f"Creme_{p}", "papel_claro", rugosidade=0.35, verniz=0.6)
    tinta = pedal.material(f"Tinta_{p}", "tinta", rugosidade=0.4)
    preto = pedal.material(f"Preto_{p}", "#121112", rugosidade=0.3, verniz=0.4)
    borracha = pedal.material_borracha(f"Borracha_{p}")
    metal = pedal.material_metal(f"Metal_{p}")
    motor = pedal.material(f"Motor_{p}", "#3A3836", rugosidade=0.45, metal=0.7)
    capacete = pedal.material(f"Capacete_{p}", "#F5E6C4", rugosidade=0.25, verniz=1.0)

    # Fuselagem: bico fino, cockpit largo, cobertura do motor afinando até o câmbio
    loft("Fuselagem", [
        (2.28, 0.10, 0.15, 0.28),
        (1.95, 0.21, 0.12, 0.37),
        (1.35, 0.29, 0.10, 0.48),
        (0.75, 0.36, 0.08, 0.58),
        (0.20, 0.40, 0.08, 0.57),
        (-0.30, 0.40, 0.08, 0.62),
        (-0.90, 0.34, 0.10, 0.57),
        (-1.50, 0.27, 0.12, 0.48),
        (-1.95, 0.19, 0.15, 0.39),
        (-2.12, 0.13, 0.18, 0.33),
    ], laca, raiz)

    # Pontões laterais em cunha (mais altos atrás, como nos anos 70)
    for lado in (-1, 1):
        loft(f"Pontao_{'E' if lado > 0 else 'D'}", [
            (0.62, 0.15, 0.10, 0.26),
            (0.42, 0.23, 0.08, 0.34),
            (-0.55, 0.24, 0.08, 0.44),
            (-1.02, 0.19, 0.10, 0.38),
        ], laca_lisa, raiz, centro_y=0.62 * lado)
        # boca do radiador
        caixa(f"Radiador_{lado}", (0.60, 0.62 * lado, 0.19), (0.04, 0.26, 0.12), preto, raiz)

    # Tomada de ar atrás do piloto
    loft("TomadaDeAr", [
        (-0.28, 0.14, 0.55, 0.96),
        (-0.62, 0.19, 0.54, 0.94),
        (-1.02, 0.16, 0.50, 0.70),
    ], laca, raiz, expoente=3.0)
    cilindro("BocaTomada", (-0.27, 0, 0.84), 0.09, 0.04, preto, raiz, eixo="X")

    # Cockpit e piloto
    esfera("Cockpit", (0.22, 0, 0.555), 0.36, preto, raiz, escala=(1.0, 0.62, 0.12))
    esfera("Capacete", (0.12, 0, 0.70), 0.16, capacete, raiz, escala=(1.05, 1.0, 1.0))
    caixa("Viseira", (0.25, 0, 0.71), (0.05, 0.2, 0.07), tinta, raiz, bisel=0.02)
    caixa("ArcoSantoAntonio", (-0.22, 0, 0.74), (0.06, 0.26, 0.10), preto, raiz, bisel=0.02)

    # Retrovisores
    for lado in (-1, 1):
        barra(f"HasteRetrovisor_{lado}", (0.62, 0.30 * lado, 0.55), (0.62, 0.46 * lado, 0.63), 0.015, preto, raiz)
        caixa(f"Retrovisor_{lado}", (0.62, 0.48 * lado, 0.64), (0.05, 0.12, 0.07), preto, raiz, bisel=0.015)

    # Asa dianteira com placas laterais
    caixa("AsaDianteira", (2.13, 0, 0.17), (0.40, 1.74, 0.045), laca, raiz, bisel=0.012)
    for lado in (-1, 1):
        caixa(f"PlacaDianteira_{lado}", (2.14, 0.87 * lado, 0.21), (0.44, 0.03, 0.22), laca_lisa, raiz, bisel=0.008)

    # Asa traseira alta, sobre dois suportes, com placas laterais
    caixa("AsaTraseira", (-2.23, 0, 0.98), (0.52, 1.26, 0.05), laca, raiz, bisel=0.012)
    for lado in (-1, 1):
        caixa(f"PlacaTraseira_{lado}", (-2.24, 0.63 * lado, 0.87), (0.56, 0.03, 0.40), laca_lisa, raiz, bisel=0.008)
        caixa(f"SuporteAsa_{lado}", (-2.08, 0.18 * lado, 0.68), (0.10, 0.03, 0.56), preto, raiz)

    # Motor e escapamentos (aparecem entre a carroceria e as rodas traseiras)
    caixa("Motor", (-1.45, 0, 0.30), (0.95, 0.62, 0.34), motor, raiz, bisel=0.03)
    for lado in (-1, 1):
        cilindro(f"Escape_{lado}", (-1.95, 0.22 * lado, 0.32), 0.05, 0.55, metal, raiz, eixo="X", raio2=0.06)

    # Rodas: traseiras mais largas; braços de suspensão até a carroceria
    rodas = [
        ("DE", 1.28, 0.80, 0.29, 0.30),
        ("DD", 1.28, -0.80, 0.29, 0.30),
        ("TE", -1.38, 0.78, 0.335, 0.50),
        ("TD", -1.38, -0.78, 0.335, 0.50),
    ]
    for nome, x, y, raio, largura in rodas:
        cilindro(f"Pneu_{nome}", (x, y, raio), raio, largura, borracha, raiz, eixo="Y", segmentos=40)
        lado = 1 if y > 0 else -1
        cilindro(f"Aro_{nome}", (x, y + lado * (largura / 2 + 0.002), raio), raio * 0.62, 0.012, metal, raiz, eixo="Y")
        borda = abs(y) - largura / 2
        for dz, dx in ((0.20, -0.18), (0.36, 0.14)):
            barra(f"Braco_{nome}_{dz}", (x + dx, lado * 0.30, dz), (x, lado * borda, raio), 0.022, preto, raiz)

    # Números decalcados: disco creme + número em tinta (bico, asa traseira e laterais)
    texto = str(num)
    numero_cor = tinta
    disco_bico = cilindro("DiscoBico", (1.62, 0, 0.452), 0.16, 0.006, creme, raiz, eixo="Z")
    disco_bico.rotation_euler = (0, math.radians(11), 0)
    numero("NumeroBico", texto, (1.62, 0, 0.458), 0.30, numero_cor, raiz, rotacao=(0, math.radians(11), math.radians(-90)))
    cilindro("DiscoAsa", (-2.23, 0, 1.007), 0.21, 0.006, creme, raiz, eixo="Z")
    numero("NumeroAsa", texto, (-2.23, 0, 1.012), 0.36, numero_cor, raiz, rotacao=(0, 0, math.radians(-90)))
    for lado in (-1, 1):
        cilindro(f"DiscoLado_{lado}", (-0.25, (0.62 + 0.245) * lado, 0.27), 0.12, 0.006, creme, raiz, eixo="Y")
        numero(f"NumeroLado_{lado}", texto, (-0.25, (0.62 + 0.25) * lado, 0.27), 0.17, numero_cor, raiz,
               rotacao=(math.radians(90), 0, math.radians(0 if lado < 0 else 180)))

    return raiz
