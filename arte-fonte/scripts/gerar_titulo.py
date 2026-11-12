"""
gerar_titulo.py — Arte da tela de título: a mesa numa noite de jogo
-------------------------------------------------------------------
A cena junta as peças reais do jogo sob a luz da luminária:
  - a maquete (base de madeira, grama e asfalto com as MESMAS texturas da pista
    do jogo, zebras, faixas, divisões de casa, árvores e uma arquibancada);
  - os três carros (carro.py) saindo colados de uma curva, o azul na frente;
  - cartas em leque e cubos de calor sobre a mesa, em primeiro plano.
A profundidade de campo bem curta dá a cara de "foto de miniatura".

Gera em assets/titulo/:
  mesa.webp          2400 x 1350  (desktop; a ação fica à esquerda, a direita cai na penumbra)
  mesa-celular.webp  1200 x 800   (recorte em volta dos carros)
e salva a cena em arte-fonte/titulo.blend.

Rodar:  blender -b --factory-startup -P arte-fonte/scripts/gerar_titulo.py
Prévia rápida:  ... -P gerar_titulo.py -- --previa <arquivo.png>
"""

import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import carro  # noqa: E402
import gerar_pista  # noqa: E402
import pedal  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIA = ARGS[ARGS.index("--previa") + 1] if "--previa" in ARGS else None

LARGURA_PISTA = 7.4          # metros, na escala dos carros
ALTURA_MAQUETE = 1.6         # espessura da base da maquete
TOPO = ALTURA_MAQUETE        # altura da grama


# ------------------------------------------------------------ materiais com textura

def material_imagem(nome, arquivo, escala=1.0, rugosidade=0.8, cor_multiplicar=None):
    m = pedal.material(nome, "#808080", rugosidade=rugosidade)
    nos, links = m.node_tree.nodes, m.node_tree.links
    p = nos["Principled BSDF"]
    coord = nos.new("ShaderNodeTexCoord")
    mapa = nos.new("ShaderNodeMapping")
    mapa.inputs["Scale"].default_value = (escala, escala, escala)
    tex = nos.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(pedal.PASTA_ASSETS, arquivo), check_existing=True)
    tex.extension = "REPEAT"
    links.new(coord.outputs["UV"], mapa.inputs["Vector"])
    links.new(mapa.outputs["Vector"], tex.inputs["Vector"])
    if cor_multiplicar:
        mult = nos.new("ShaderNodeMix"); mult.data_type = "RGBA"; mult.blend_type = "MULTIPLY"
        mult.inputs["Factor"].default_value = 1.0
        mult.inputs["B"].default_value = pedal.cor(cor_multiplicar)
        links.new(tex.outputs["Color"], mult.inputs["A"])
        links.new(mult.outputs["Result"], p.inputs["Base Color"])
    else:
        links.new(tex.outputs["Color"], p.inputs["Base Color"])
    return m


def material_madeira(nome, clara, escura, escala=0.08, verniz=0.3):
    m = pedal.material(nome, escura, rugosidade=0.5, verniz=verniz, verniz_rugosidade=0.2)
    nos, links = m.node_tree.nodes, m.node_tree.links
    p = nos["Principled BSDF"]
    coord = nos.new("ShaderNodeTexCoord")
    mapa = nos.new("ShaderNodeMapping")
    mapa.inputs["Scale"].default_value = (escala, escala * 9, escala)
    onda = nos.new("ShaderNodeTexWave")
    onda.inputs["Scale"].default_value = 2.0
    onda.inputs["Distortion"].default_value = 9.0
    onda.inputs["Detail"].default_value = 4.0
    mistura = nos.new("ShaderNodeMix"); mistura.data_type = "RGBA"
    mistura.inputs["A"].default_value = pedal.cor(escura)
    mistura.inputs["B"].default_value = pedal.cor(clara)
    links.new(coord.outputs["Object"], mapa.inputs["Vector"])
    links.new(mapa.outputs["Vector"], onda.inputs["Vector"])
    links.new(onda.outputs["Fac"], mistura.inputs["Factor"])
    links.new(mistura.outputs["Result"], p.inputs["Base Color"])
    return m


# ------------------------------------------------------------ geometria auxiliar

def caixa(nome, centro, tamanho, material, bisel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(tamanho), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centro), verts=bm.verts)
    malha = bpy.data.meshes.new(nome); bm.to_mesh(malha); bm.free()
    obj = pedal.objeto(nome, malha)
    pedal.aplicar_material(obj, material)
    if bisel:
        pedal.modificador(obj, "BEVEL", width=bisel, segments=3, limit_method="NONE")
        pedal.suavizar(obj)
    return obj


def eixo_da_pista():
    """Centro da pista: reta ao fundo (indo para +X), curva de 90° à direita e
    reta vindo na direção da câmera (-Y). Devolve pontos (x, y) e a direção."""
    pontos = []
    for x in np.linspace(-34, -6, 30):
        pontos.append((x, 7.0))
    raio, cx, cy = 11.0, -6.0, -4.0
    for a in np.linspace(math.pi / 2, 0, 40)[1:]:
        pontos.append((cx + raio * math.cos(a), cy + raio * math.sin(a)))
    for y in np.linspace(-4, -26, 24)[1:]:
        pontos.append((5.0, y))
    return pontos


def faixa_ao_longo(nome, pontos, deslocamento_a, deslocamento_b, z, material, uv_escala=0.12):
    """Malha em fita entre dois deslocamentos laterais do eixo (asfalto, linhas, zebras)."""
    verts, faces, uvs = [], [], []
    comprimento = 0.0
    for i, (x, y) in enumerate(pontos):
        x2, y2 = pontos[min(i + 1, len(pontos) - 1)]
        x0, y0 = pontos[max(i - 1, 0)]
        d = Vector((x2 - x0, y2 - y0, 0)).normalized()
        n = Vector((-d.y, d.x, 0))
        if i:
            comprimento += math.hypot(x - pontos[i - 1][0], y - pontos[i - 1][1])
        verts.append((x + n.x * deslocamento_a, y + n.y * deslocamento_a, z))
        verts.append((x + n.x * deslocamento_b, y + n.y * deslocamento_b, z))
        uvs.append(((deslocamento_a) * uv_escala, comprimento * uv_escala))
        uvs.append(((deslocamento_b) * uv_escala, comprimento * uv_escala))
    for i in range(len(pontos) - 1):
        a = 2 * i
        faces.append((a, a + 1, a + 3, a + 2))
    malha = bpy.data.meshes.new(nome)
    malha.from_pydata(verts, [], faces)
    camada = malha.uv_layers.new(name="UVMap")
    for poli in malha.polygons:
        for li in poli.loop_indices:
            camada.data[li].uv = uvs[malha.loops[li].vertex_index]
    obj = pedal.objeto(nome, malha)
    pedal.aplicar_material(obj, material)
    return obj


def ponto_e_direcao(pontos, distancia):
    """Ponto do eixo a uma distância do começo, e o ângulo da direção (para os carros)."""
    acumulado = 0.0
    for i in range(1, len(pontos)):
        trecho = math.hypot(pontos[i][0] - pontos[i - 1][0], pontos[i][1] - pontos[i - 1][1])
        if acumulado + trecho >= distancia:
            t = (distancia - acumulado) / trecho
            x = pontos[i - 1][0] + (pontos[i][0] - pontos[i - 1][0]) * t
            y = pontos[i - 1][1] + (pontos[i][1] - pontos[i - 1][1]) * t
            ang = math.atan2(pontos[i][1] - pontos[i - 1][1], pontos[i][0] - pontos[i - 1][0])
            return x, y, ang
        acumulado += trecho
    return pontos[-1][0], pontos[-1][1], -math.pi / 2


# ------------------------------------------------------------ a cena

def mesa_e_maquete():
    caixa("Mesa", (0, 0, -0.5), (240, 240, 1.0), material_madeira("Mesa", "#5A3A22", "#2E1D12", escala=0.05))
    base = material_madeira("BaseMaquete", "#4A3424", "#22170F", escala=0.12, verniz=0.5)
    caixa("BaseMaquete", (-6, -2, ALTURA_MAQUETE / 2 - 0.02), (56, 40, ALTURA_MAQUETE), base, bisel=0.25)
    grama = material_imagem("Grama", "pista/grama.webp", escala=1.0, rugosidade=0.95)
    terreno = faixa_ao_longo("Terreno", [(-33.6, -2.0), (21.6, -2.0)], -19.6, 19.6, TOPO + 0.005, grama, uv_escala=0.09)
    terreno.name = "Terreno"


def pista():
    pontos = eixo_da_pista()
    meia = LARGURA_PISTA / 2
    asfalto = material_imagem("Asfalto", "pista/asfalto.webp", rugosidade=0.7)
    faixa = pedal.material("Faixa", "#EFE7D6", rugosidade=0.6)
    mureta = pedal.material("Mureta", "#D3CAB8", rugosidade=0.8)
    faixa_ao_longo("Mureta", pontos, -meia - 0.9, meia + 0.9, TOPO + 0.02, mureta)
    faixa_ao_longo("Asfalto", pontos, -meia, meia, TOPO + 0.05, asfalto, uv_escala=0.25)
    faixa_ao_longo("LinhaE", pontos, meia - 0.32, meia - 0.12, TOPO + 0.06, faixa)
    faixa_ao_longo("LinhaD", pontos, -meia + 0.12, -meia + 0.32, TOPO + 0.06, faixa)
    # zebras na curva (alternando vermelho e creme), dos dois lados
    vermelho = pedal.material("ZebraV", "vermelho", rugosidade=0.6)
    creme = pedal.material("ZebraC", "papel_claro", rugosidade=0.6)
    inicio, fim = 26, 70
    for k, i in enumerate(range(inicio, fim, 2)):
        trecho = pontos[i:i + 3]
        for lado in (-1, 1):
            a, b = (meia, meia + 1.1) if lado > 0 else (-meia - 1.1, -meia)
            obj = faixa_ao_longo("Zebra", trecho, a, b, TOPO + 0.09, vermelho if k % 2 else creme)
            pedal.modificador(obj, "SOLIDIFY", thickness=0.12)
    # divisões das casas pintadas no asfalto
    for d in np.arange(4.0, 90.0, 4.4):
        x, y, ang = ponto_e_direcao(pontos, d)
        caixa("Casa", (x, y, TOPO + 0.062), (0.16, LARGURA_PISTA - 0.8, 0.01), faixa).rotation_euler = (0, 0, ang)
    return pontos


def arvores():
    folhas = [gerar_pista.material_folhas("Folhas1", "#3E5F22", "#6F9636"),
              gerar_pista.material_folhas("Folhas2", "#5A7A26", "#93AE46"),
              gerar_pista.material_folhas("Folhas3", "#2F4B1C", "#5B7F2E")]
    tronco = pedal.material("Tronco", "#4A3524", rugosidade=0.9)
    posicoes = [(-22, 14, 2.4), (-17, 15, 2.0), (-12.5, 13.8, 2.2), (-28, -10, 2.6), (-24, -14, 2.0),
                (-16, -12, 2.3), (-30, 2, 2.1), (12, 9, 2.5), (16, 4, 2.0),
                (-9, -10, 1.8), (-31, 12, 2.3)]
    for i, (x, y, r) in enumerate(posicoes):
        gerar_pista.copa(f"Copa{i}", (x, y, TOPO + r * 1.55), r, folhas[i % 3], i + 3)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.32 * r / 2, radius2=0.22 * r / 2, depth=r * 1.4)
        malha = bpy.data.meshes.new("Tronco"); bm.to_mesh(malha); bm.free()
        t = pedal.objeto("Tronco", malha)
        t.location = (x, y, TOPO + r * 0.7)
        pedal.aplicar_material(t, tronco)


def arquibancada():
    """Arquibancada atrás da reta do fundo, de frente para a pista, com a faixa do GP."""
    concreto = pedal.material("Concreto", "#A8A196", rugosidade=0.8)
    cores = ["vermelho", "azul", "ocre"]
    x0, y0 = -26.0, 13.2
    for f in range(5):
        caixa(f"Degrau{f}", (x0 + 8, y0 + f * 0.9, TOPO + (f + 1) * 0.45), (16, 0.9, (f + 1) * 0.9), concreto)
        for s, cor_nome in enumerate(cores):
            caixa(f"Assentos{f}{s}", (x0 + 2.7 + s * 5.33, y0 + f * 0.9 - 0.2, TOPO + (f + 1) * 0.9 + 0.12),
                  (5.0, 0.45, 0.24), pedal.material(f"Assento{cor_nome}", cor_nome, rugosidade=0.5))
    creme = pedal.material("FaixaGP", "papel_claro", rugosidade=0.6)
    caixa("Mureta", (x0 + 8, y0 - 0.65, TOPO + 0.45), (16, 0.2, 0.9), creme)
    texto = bpy.data.curves.new("TextoGP", "FONT")
    texto.body = "GRANDE PRÊMIO DE CARTAS"
    texto.font = bpy.data.fonts.load(pedal.FONTE_NUMEROS, check_existing=True)
    texto.align_x = "CENTER"; texto.align_y = "CENTER"
    texto.size = 0.62
    texto.shear = 0.18
    obj = pedal.objeto("TextoGP", texto)
    obj.location = (x0 + 8, y0 - 0.77, TOPO + 0.47)
    obj.rotation_euler = (math.radians(90), 0, 0)
    pedal.aplicar_material(obj, pedal.material("TintaGP", "vermelho", rugosidade=0.5))


def carros(pontos):
    # o azul (você) na frente; vermelho e verde colados atrás, ainda saindo da curva
    for pintura, num, dist, desvio in (("azul", 1, 60.5, -0.9), ("vermelho", 2, 54.0, 1.0), ("verde", 3, 47.5, -0.6)):
        raiz = carro.construir_carro(pintura, num, prefixo=pintura)
        x, y, ang = ponto_e_direcao(pontos, dist)
        n = Vector((-math.sin(ang), math.cos(ang), 0))
        raiz.location = (x + n.x * desvio, y + n.y * desvio, TOPO + 0.05)
        raiz.rotation_euler = (0, 0, ang)


def carta_na_mesa(valor, centro, angulo, cor_fundo):
    """Uma carta de verdade sobre a mesa: papel creme, fundo na cor do valor,
    ilustração em duas tintas, número grande e faixa de tinta."""
    w, h = 4.0, 5.6
    papel = pedal.material(f"Papel{valor}", "papel_claro", rugosidade=0.55)
    fundo = pedal.material(f"Fundo{valor}", cor_fundo, rugosidade=0.6)
    tinta = pedal.material(f"TintaCarta{valor}", "tinta", rugosidade=0.6)
    raiz = bpy.data.objects.new(f"Carta{valor}", None)
    bpy.context.scene.collection.objects.link(raiz)
    for nome, c, t, m in (("Papel", (0, 0, 0.02), (w, h, 0.04), papel),
                          ("Fundo", (0, 0.05, 0.045), (w - 0.5, h - 0.6, 0.01), fundo),
                          ("Faixa", (0, -h / 2 + 0.65, 0.052), (w - 0.5, 0.55, 0.01), tinta)):
        caixa(nome, c, t, m).parent = raiz
    arte = material_imagem(f"Arte{valor}", f"cartas/carta-{valor}.webp", rugosidade=0.6)
    no_img = [n for n in arte.node_tree.nodes if n.type == "TEX_IMAGE"][0]
    arte.node_tree.links.new(no_img.outputs["Alpha"], arte.node_tree.nodes["Principled BSDF"].inputs["Alpha"])
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=Vector((w - 0.6, (w - 0.6) * 2 / 3, 1)), verts=bm.verts)
    malha = bpy.data.meshes.new("ArteCarta"); bm.to_mesh(malha); bm.free()
    camada = malha.uv_layers.new(name="UVMap")
    for poli in malha.polygons:
        for li in poli.loop_indices:
            v = malha.vertices[malha.loops[li].vertex_index].co
            camada.data[li].uv = (v.x / (w - 0.6) + 0.5, v.y / ((w - 0.6) * 2 / 3) + 0.5)
    plano = pedal.objeto("ArteCarta", malha)
    plano.location = (0, 0.1, 0.06)
    pedal.aplicar_material(plano, arte)
    plano.parent = raiz
    num = bpy.data.curves.new("NumCarta", "FONT")
    num.body = str(valor)
    num.font = bpy.data.fonts.load(pedal.FONTE_NUMEROS, check_existing=True)
    num.size = 1.7
    num.shear = 0.16
    tnum = pedal.objeto("NumCarta", num)
    tnum.location = (-w / 2 + 0.45, h / 2 - 1.75, 0.06)
    pedal.aplicar_material(tnum, tinta if valor == 3 else papel)
    tnum.parent = raiz
    raiz.location = centro
    raiz.rotation_euler = (0, 0, angulo)


def pecas_na_mesa():
    cores = {1: "azul", 2: "#237A4B", 3: "ocre", 4: "vermelho"}
    # leque de cartas descansando na borda da maquete, à frente e à esquerda
    for i, (valor, x, y, ang) in enumerate(((2, -9.6, -16.6, 0.85), (4, -7.0, -17.8, 0.6), (3, -4.2, -18.4, 0.35),
                                            (1, -1.5, -18.1, 0.1))):
        carta_na_mesa(valor, (x, y, TOPO + 0.02 + i * 0.045), ang, cores[valor])
    laca = pedal.material("CuboLaca", "brasa", rugosidade=0.38, verniz=0.55, verniz_rugosidade=0.12)
    for i, (x, y, rot) in enumerate(((-6.2, -13.4, 0.3), (-4.4, -14.6, 0.9), (-7.9, -14.4, 0.1), (-5.4, -12.0, 0.6),
                                     (-9.6, -12.6, 1.2))):
        c = caixa(f"Cubo{i}", (0, 0, 0), (1.05, 1.05, 1.05), laca, bisel=0.12)
        c.location = (x, y, TOPO + 0.53)
        c.rotation_euler = (0, 0, rot)


def iluminacao_e_camera():
    # Luminária: um spot quente bem em cima dos carros; a luz cai rápido para as
    # bordas, então o fundo e o lado direito da imagem ficam na penumbra.
    lum = pedal.luz("Luminaria", "SPOT", (-5, -9, 30), 32000, (1.0, 0.8, 0.55, 1), tamanho=4.0, mirar=(1.0, -13, 1.6))
    lum.data.spot_size = math.radians(58)
    lum.data.spot_blend = 0.75
    pedal.luz("Preenchimento", "AREA", (45, -40, 16), 2600, (0.62, 0.72, 1.0, 1), tamanho=14, mirar=(0, -12, 0))
    pedal.luz("Recorte", "AREA", (8, 30, 9), 5200, (1.0, 0.84, 0.6, 1), tamanho=6, mirar=(3, -10, 2))
    pedal.mundo(cor_fundo=(0.02, 0.016, 0.013, 1), forca=0.25)
    alvo = (2.0, -12.5, TOPO + 0.7)
    cam = pedal.camera_perspectiva((17.0, -43.0, 8.2), alvo, lente=52)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (Vector((4.0, -16.5, TOPO + 0.6)) - cam.location).length
    cam.data.dof.aperture_fstop = 0.45
    cam.data.shift_x = 0.1
    return cam


def recortar_celular(caminho_png):
    """Recorta a região dos carros do render grande e salva a versão do celular."""
    img = bpy.data.images.load(caminho_png, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    # (linhas do Blender vêm de baixo para cima)
    x0, y0, cw, ch = int(w * 0.10), int(h * 0.18), int(w * 0.6), int(w * 0.4)
    corte = px[y0:y0 + ch, x0:x0 + cw].copy()
    novo = bpy.data.images.new("Celular", cw, ch, alpha=False)
    novo.pixels.foreach_set(corte.ravel())
    novo.scale(1200, 800)
    cena = bpy.context.scene
    cena.render.image_settings.file_format = "WEBP"
    cena.render.image_settings.color_mode = "RGB"
    cena.render.image_settings.quality = 80
    destino = os.path.join(pedal.PASTA_ASSETS, "titulo", "mesa-celular.webp")
    novo.save_render(destino, scene=cena)
    print("SALVO", destino)


if __name__ == "__main__":
    pedal.limpar_cena()
    if PREVIA:
        pedal.configurar_render(960, 540, amostras=20, transparente=False)
    else:
        pedal.configurar_render(2400, 1350, amostras=110, transparente=False)
    mesa_e_maquete()
    pontos = pista()
    arvores()
    arquibancada()
    carros(pontos)
    pecas_na_mesa()
    iluminacao_e_camera()
    cena = bpy.context.scene
    if PREVIA:
        cena.render.image_settings.file_format = "PNG"
        cena.render.filepath = PREVIA
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(pedal.PASTA_PROJETO, "arte-fonte", "titulo.blend"))
        temporario = os.path.join(tempfile.gettempdir(), "pedal_titulo.png")
        cena.render.image_settings.file_format = "PNG"
        cena.render.image_settings.color_mode = "RGB"
        cena.render.filepath = temporario
        bpy.ops.render.render(write_still=True)
        cena.view_settings.view_transform = "Standard"
        img = bpy.data.images.load(temporario, check_existing=False)
        cena.render.image_settings.file_format = "WEBP"
        cena.render.image_settings.quality = 80
        destino = os.path.join(pedal.PASTA_ASSETS, "titulo", "mesa.webp")
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        img.save_render(destino, scene=cena)
        print("SALVO", destino)
        recortar_celular(temporario)
