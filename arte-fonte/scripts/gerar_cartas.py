"""
gerar_cartas.py — Ilustrações das cartas em "serigrafia" de duas tintas
----------------------------------------------------------------------
Cada ilustração sai do MESMO carro 3D do jogo (carro.py): o Blender renderiza
a pose e depois o numpy reduz a imagem a duas tintas, como num cartaz impresso:
  sombra forte  -> tinta azul-marinho chapada
  meio-tom      -> pontinhos de tinta (retícula a 45°)
  luz           -> transparente (aparece a cor da carta por baixo)
  brilho        -> creme
A carta de Calor usa o esquema invertido (laranja-brasa e creme sobre o azul-marinho).

Gera em assets/cartas/ (300 x 200, fundo transparente):
  carta-1.webp  Tração      roda traseira mordendo o asfalto
  carta-2.webp  Ritmo       carro de lado, em cruzeiro
  carta-3.webp  Embalo      carro inclinado na curva, com zebra embaixo
  carta-4.webp  Pé no fundo carro de frente, baixo, com riscos de velocidade
  carta-calor.webp          traseira do carro superaquecendo
  verso-carro.webp          silhueta creme do carro, vista de cima (verso das cartas)

Rodar:  blender -b --factory-startup -P arte-fonte/scripts/gerar_cartas.py
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
import pedal  # noqa: E402

LARGURA, ALTURA = 300, 200
TINTA = np.array([0x1D, 0x2B, 0x3A]) / 255
CREME = np.array([0xF7, 0xEE, 0xDB]) / 255
BRASA = np.array([0xE0, 0x70, 0x2F]) / 255
RETICULA = 5.0   # tamanho da célula do meio-tom, em pixels


# ------------------------------------------------------------ cena

def chao_que_pega_sombra():
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    malha = bpy.data.meshes.new("Chao"); bm.to_mesh(malha); bm.free()
    chao = pedal.objeto("Chao", malha)
    chao.is_shadow_catcher = True
    return chao


def luz_pela_camera(cam, alvo, forca=1.0):
    """Luminária no alto à esquerda DE QUEM OLHA por esta câmera."""
    frente = (Vector(alvo) - cam.location).normalized()
    direita = frente.cross(Vector((0, 0, 1))).normalized()
    cima = direita.cross(frente).normalized()
    chave = cam.location + (-direita * 4 + cima * 5 + frente * 2)
    oposta = cam.location + (direita * 5 - cima * 0.5 + frente * 1)
    pedal.luz("Luminaria", "AREA", tuple(chave), 1300 * forca, (1.0, 0.86, 0.66, 1), tamanho=2.5, mirar=alvo)
    pedal.luz("Preenchimento", "AREA", tuple(oposta), 120 * forca, (0.8, 0.85, 1.0, 1), tamanho=4, mirar=alvo)
    pedal.mundo(forca=0.35)


def preparar(lente, local, alvo, forca=1.0):
    pedal.limpar_cena()
    pedal.configurar_render(LARGURA, ALTURA, amostras=96)
    bpy.context.scene.view_settings.view_transform = "Standard"
    raiz = carro.construir_carro("azul", 1)
    chao_que_pega_sombra()
    cam = pedal.camera_perspectiva(local, alvo, lente=lente)
    luz_pela_camera(cam, alvo, forca)
    return raiz


def render_para_numpy():
    caminho = os.path.join(tempfile.gettempdir(), "pedal_carta_tmp.png")
    cena = bpy.context.scene
    cena.render.image_settings.file_format = "PNG"
    cena.render.image_settings.color_mode = "RGBA"
    cena.render.filepath = caminho
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(caminho, check_existing=False)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1]
    bpy.data.images.remove(img)
    return px


# ------------------------------------------------------------ "serigrafia"

def reticula(h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (xx + yy) / math.sqrt(2)
    v = (xx - yy) / math.sqrt(2)
    return 0.5 + 0.25 * (np.cos(2 * np.pi * u / RETICULA) + np.cos(2 * np.pi * v / RETICULA))


def dilatar(mascara, passos):
    # margem em volta: sem ela o np.roll "dá a volta" e suja a borda oposta
    m = np.pad(mascara, passos)
    for _ in range(passos):
        n = m.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            n |= np.roll(np.roll(m, dy, 0), dx, 1)
        m = n
    return m[passos:-passos, passos:-passos]


def serigrafia(px, invertida=False):
    """Converte o render em duas tintas + transparência."""
    rgb, a = px[..., :3], px[..., 3]
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    sobre_branco = lum * a + (1 - a)            # sombra do chão (alfa parcial) vira tom
    tom = 1 - sobre_branco                       # 0 = claro, 1 = escuro
    grade = reticula(*tom.shape)
    objeto = a > 0.9
    saida = np.zeros(px.shape, dtype=np.float32)

    if not invertida:
        chapado = (tom > 0.8) & (a > 0.05)
        meio = (tom > 0.3) & ~chapado & (((tom - 0.3) / 0.5) > grade)
        brilho = objeto & (lum > 0.86)
        contorno = dilatar(objeto, 2) & ~objeto
        tinta = chapado | meio | contorno
        saida[tinta, :3] = TINTA
        saida[tinta, 3] = 1
        saida[brilho & ~contorno, :3] = CREME
        saida[brilho & ~contorno, 3] = 1
    else:
        # Calor: brasa nas luzes, creme nos brilhos; o escuro some no azul-marinho da carta
        luz = 1 - tom
        brilho = (lum > 0.82) & (a > 0.5)
        chapado = (luz > 0.42) & (a > 0.5) & ~brilho
        meio = (luz > 0.16) & ~chapado & ~brilho & (a > 0.3) & (((luz - 0.16) / 0.26) > grade)
        saida[chapado | meio, :3] = BRASA
        saida[chapado | meio, 3] = 1
        saida[brilho, :3] = CREME
        saida[brilho, 3] = 1
    return saida


def salvar_rgba(nome, rgba):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(nome, w, h, alpha=True)
    img.pixels.foreach_set(rgba[::-1].ravel())
    cena = bpy.context.scene
    cena.view_settings.view_transform = "Standard"
    cena.render.image_settings.file_format = "WEBP"
    cena.render.image_settings.color_mode = "RGBA"
    cena.render.image_settings.quality = 90
    destino = os.path.join(pedal.PASTA_ASSETS, "cartas", nome + ".webp")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    img.save_render(destino, scene=cena)
    print("SALVO", destino)


# ------------------------------------------------------------ as cinco ilustrações

def carta_tracao():
    # Por trás e de lado, rente ao chão: a roda traseira grande em primeiro plano
    preparar(lente=34, local=(-4.3, 2.9, 0.62), alvo=(-1.2, 0.55, 0.42), forca=0.9)
    salvar_rgba("carta-1", serigrafia(render_para_numpy()))


def carta_ritmo():
    # De lado: o bico aponta para a direita da carta
    preparar(lente=42, local=(0.1, -6.3, 1.05), alvo=(0.1, 0, 0.45))
    salvar_rgba("carta-2", serigrafia(render_para_numpy()))


def carta_embalo():
    raiz = preparar(lente=45, local=(5.0, -4.3, 2.2), alvo=(0, 0, 0.3))
    raiz.rotation_euler = (math.radians(-7), 0, math.radians(28))   # inclinado e apontando para a curva
    # zebra embaixo das rodas de fora
    vermelho = pedal.material("Zebra", "vermelho", rugosidade=0.6)
    creme = pedal.material("ZebraCreme", "papel_claro", rugosidade=0.6)
    for i in range(-6, 7):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((0.55, 0.9, 0.04)), verts=bm.verts)
        malha = bpy.data.meshes.new("Zebra"); bm.to_mesh(malha); bm.free()
        z = pedal.objeto("Zebra", malha)
        ang = math.radians(28)
        x, y = i * 0.55, -1.25
        z.location = (x * math.cos(ang) - y * math.sin(ang), x * math.sin(ang) + y * math.cos(ang), 0.02)
        z.rotation_euler = (0, 0, ang)
        pedal.aplicar_material(z, vermelho if i % 2 else creme)
    salvar_rgba("carta-3", serigrafia(render_para_numpy()))


def carta_pe_no_fundo():
    preparar(lente=30, local=(3.5, -0.75, 0.62), alvo=(0, 0, 0.45))
    preto = pedal.material("Risco", "#141414", rugosidade=0.9)
    # riscos de velocidade: barras escuras atrás do carro, que a perspectiva faz convergir
    for lado in (-1, 1):
        for k, (y, z) in enumerate(((1.25, 0.12), (1.55, 0.7), (1.95, 0.3), (2.3, 0.95))):
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=Vector((6.5 - k * 0.8, 0.07, 0.07)), verts=bm.verts)
            malha = bpy.data.meshes.new("Risco"); bm.to_mesh(malha); bm.free()
            r = pedal.objeto("Risco", malha)
            r.location = (-3.6 + k * 0.5, y * lado, z)
            pedal.aplicar_material(r, preto)
    salvar_rgba("carta-4", serigrafia(render_para_numpy()))


def carta_calor():
    preparar(lente=38, local=(-4.7, -2.7, 1.55), alvo=(-1.3, 0, 0.55), forca=0.55)
    fogo = pedal.material("Fogo", "#FFB347", rugosidade=1.0, emissao="#FFB347", forca_emissao=14)
    fumaca = pedal.material("Fumaca", "#8C8378", rugosidade=1.0)
    for lado in (-1, 1):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.13, radius2=0.0, depth=1.2)
        malha = bpy.data.meshes.new("Chama"); bm.to_mesh(malha); bm.free()
        chama = pedal.objeto("Chama", malha)
        chama.location = (-2.8, 0.22 * lado, 0.34)
        chama.rotation_euler = (0, math.radians(-90), 0)
        pedal.aplicar_material(chama, fogo)
    for k, (x, y, z, r) in enumerate(((-1.7, 0.05, 1.25, 0.28), (-2.0, -0.25, 1.6, 0.36), (-1.6, 0.25, 1.95, 0.42))):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r)
        malha = bpy.data.meshes.new("Fumaca"); bm.to_mesh(malha); bm.free()
        bola = pedal.objeto("Fumaca", malha)
        bola.location = (x, y, z)
        pedal.suavizar(bola)
        pedal.aplicar_material(bola, fumaca)
    pedal.luz("Contraluz", "AREA", (-4, 3, 3), 600, (1.0, 0.7, 0.4, 1), tamanho=2, mirar=(-1.5, 0, 0.5))
    salvar_rgba("carta-calor", serigrafia(render_para_numpy(), invertida=True))


def verso_carro():
    """Silhueta creme do carro visto de cima, para o medalhão do verso."""
    pedal.limpar_cena()
    pedal.configurar_render(256, 144, amostras=16)
    carro.construir_carro("azul", 1)
    pedal.luz_de_cima()
    pedal.camera_cima(5.42)
    px = render_para_numpy()
    rgba = np.zeros(px.shape, dtype=np.float32)
    rgba[..., :3] = CREME
    rgba[..., 3] = (px[..., 3] > 0.5).astype(np.float32)
    salvar_rgba("verso-carro", rgba)


if __name__ == "__main__":
    carta_tracao()
    carta_ritmo()
    carta_embalo()
    carta_pe_no_fundo()
    carta_calor()
    verso_carro()
