"""
pedal.py — Funções comuns aos scripts de arte do Pedal Card (Blender 5.2)
-------------------------------------------------------------------------
Todos os scripts de geração importam este módulo. Ele cuida de:
  - limpar a cena e configurar o render (Cycles na CPU, sem ruído);
  - converter as cores da paleta do jogo (hex) para o Blender;
  - criar materiais (pintura laqueada, borracha, metal, madeira);
  - montar as duas luzes do projeto:
      luz_de_cima()     -> para objetos que GIRAM no jogo (carros, arquibancadas):
                           luz suave vinda de cima, que não denuncia a rotação;
      luz_luminaria()   -> para o resto: luminária quente no alto à esquerda;
  - câmeras (ortográfica vista de cima e perspectiva 3/4);
  - salvar em WebP na pasta assets/ do jogo.

Como rodar qualquer script (exemplo):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P arte-fonte/scripts/gerar_carros.py
"""

import math
import os

import bpy

# Pastas do projeto (este arquivo fica em arte-fonte/scripts/)
PASTA_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
PASTA_PROJETO = os.path.dirname(os.path.dirname(PASTA_SCRIPTS))
PASTA_ASSETS = os.path.join(PASTA_PROJETO, "assets")

# Paleta do jogo (a mesma de css/base.css)
PALETA = {
    "mesa": "#1A1511",
    "luz": "#F2B35B",
    "papel": "#F1E4C8",
    "papel_claro": "#F7EEDB",
    "tinta": "#1D2B3A",
    "vermelho": "#C63A2B",
    "azul": "#1F6FA0",
    "verde": "#2A9D5C",
    "ocre": "#E2A33B",
    "brasa": "#E0702F",
    "grama": "#56772F",
    "asfalto": "#2E2F31",
}

# As três pinturas dos carros (nome usado nos arquivos -> cor da paleta)
PINTURAS = {"azul": "azul", "vermelho": "vermelho", "verde": "verde"}

FONTE_NUMEROS = r"C:\Windows\Fonts\bahnschrift.ttf"


# ---------------------------------------------------------------- cores

def srgb_para_linear(c):
    """Converte um canal de 0..1 do sRGB (cor da tela) para o linear do Blender."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def cor(nome_ou_hex, alfa=1.0):
    """Recebe um nome da PALETA ou um '#RRGGBB' e devolve (r, g, b, a) linear."""
    h = PALETA.get(nome_ou_hex, nome_ou_hex).lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_para_linear(r), srgb_para_linear(g), srgb_para_linear(b), alfa)


# ---------------------------------------------------------------- cena e render

def limpar_cena():
    """Apaga tudo da cena e dos dados (começa sempre do zero)."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for colecao in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                    bpy.data.cameras, bpy.data.curves, bpy.data.images):
        for item in list(colecao):
            colecao.remove(item)


def configurar_render(largura, altura, amostras=96, transparente=True):
    cena = bpy.context.scene
    cena.render.engine = "CYCLES"
    cena.cycles.device = "CPU"
    cena.cycles.samples = amostras
    cena.cycles.use_denoising = True
    cena.cycles.use_adaptive_sampling = True
    cena.render.film_transparent = transparente
    cena.render.resolution_x = largura
    cena.render.resolution_y = altura
    cena.render.resolution_percentage = 100
    # Cores fiéis à paleta: sem curva "cinematográfica" que desbota as tintas
    try:
        cena.view_settings.view_transform = "Khronos PBR Neutral"
    except TypeError:
        cena.view_settings.view_transform = "Standard"
    cena.view_settings.look = "None"
    cena.view_settings.exposure = 0.0
    cena.view_settings.gamma = 1.0
    return cena


def mundo(cor_fundo=(0.035, 0.03, 0.028, 1.0), forca=1.0):
    """Luz ambiente fraca (o 'escuro da sala'), que só preenche as sombras."""
    cena = bpy.context.scene
    w = bpy.data.worlds.new("Sala")
    cena.world = w
    fundo = w.node_tree.nodes.get("Background")
    fundo.inputs["Color"].default_value = cor_fundo
    fundo.inputs["Strength"].default_value = forca
    return w


def salvar(caminho_relativo, qualidade=88):
    """Renderiza a cena e salva em assets/<caminho_relativo> (WebP com alfa)."""
    cena = bpy.context.scene
    destino = os.path.join(PASTA_ASSETS, caminho_relativo)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    cena.render.image_settings.file_format = "WEBP"
    cena.render.image_settings.color_mode = "RGBA" if cena.render.film_transparent else "RGB"
    cena.render.image_settings.quality = qualidade
    cena.render.filepath = destino
    bpy.ops.render.render(write_still=True)
    print("SALVO", destino)
    return destino


# ---------------------------------------------------------------- objetos

def objeto(nome, malha):
    obj = bpy.data.objects.new(nome, malha)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def suavizar(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def modificador(obj, tipo, **props):
    m = obj.modifiers.new(tipo.title(), tipo)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def aplicar_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


# ---------------------------------------------------------------- materiais

def material(nome, base, rugosidade=0.5, metal=0.0, verniz=0.0, verniz_rugosidade=0.05,
             emissao=None, forca_emissao=0.0):
    m = bpy.data.materials.new(nome)
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = cor(base) if isinstance(base, str) else base
    p.inputs["Roughness"].default_value = rugosidade
    p.inputs["Metallic"].default_value = metal
    p.inputs["Coat Weight"].default_value = verniz
    p.inputs["Coat Roughness"].default_value = verniz_rugosidade
    if emissao:
        p.inputs["Emission Color"].default_value = cor(emissao)
        p.inputs["Emission Strength"].default_value = forca_emissao
    return m


def material_laca(nome, base):
    """Pintura de miniatura: cor viva, verniz brilhante por cima."""
    return material(nome, base, rugosidade=0.32, verniz=1.0, verniz_rugosidade=0.06)


def material_borracha(nome="Borracha"):
    return material(nome, "#1B1A19", rugosidade=0.78)


def material_metal(nome="Metal", base="#B9B3A8", rugosidade=0.25):
    return material(nome, base, rugosidade=rugosidade, metal=1.0)


def material_faixa(nome, base, faixa="#F7EEDB", largura=0.09, eixo="Y"):
    """Pintura laqueada com uma faixa clara no meio do carro (decalque de corrida).
    A faixa é desenhada pelo material: onde |coordenada| < largura, a cor muda."""
    m = material_laca(nome, base)
    nos = m.node_tree.nodes
    links = m.node_tree.links
    p = nos["Principled BSDF"]
    coord = nos.new("ShaderNodeTexCoord")
    separar = nos.new("ShaderNodeSeparateXYZ")
    absoluto = nos.new("ShaderNodeMath"); absoluto.operation = "ABSOLUTE"
    menor = nos.new("ShaderNodeMath"); menor.operation = "LESS_THAN"
    menor.inputs[1].default_value = largura
    mistura = nos.new("ShaderNodeMix"); mistura.data_type = "RGBA"
    mistura.inputs["A"].default_value = cor(base)
    mistura.inputs["B"].default_value = cor(faixa)
    links.new(coord.outputs["Object"], separar.inputs[0])
    links.new(separar.outputs[eixo], absoluto.inputs[0])
    links.new(absoluto.outputs[0], menor.inputs[0])
    links.new(menor.outputs[0], mistura.inputs["Factor"])
    links.new(mistura.outputs["Result"], p.inputs["Base Color"])
    return m


# ---------------------------------------------------------------- luzes

def luz(nome, tipo, local, energia, cor_luz=(1, 1, 1, 1), tamanho=1.0, mirar=(0, 0, 0)):
    dados = bpy.data.lights.new(nome, tipo)
    dados.energy = energia
    dados.color = cor_luz[:3]
    if tipo == "AREA":
        dados.size = tamanho
    elif tipo == "SUN":
        dados.angle = tamanho
    elif tipo in ("POINT", "SPOT"):
        dados.shadow_soft_size = tamanho
    obj = objeto(nome, dados)
    obj.location = local
    olhar_para(obj, mirar)
    return obj


def olhar_para(obj, alvo):
    from mathutils import Vector
    direcao = Vector(alvo) - obj.location
    obj.rotation_euler = direcao.to_track_quat("-Z", "Y").to_euler()


def luz_de_cima(escala=1.0, forca=1.0):
    """Para objetos que giram no jogo: quatro softboxes em anel (frente, trás e lados)
    e um preenchimento fraco por cima. A luz é simétrica, então o objeto pode girar
    na pista sem que o brilho "denuncie" a rotação; e nenhuma luz fica exatamente
    atrás da câmera, o que desbotaria o verniz das superfícies planas."""
    raio, altura = 6 * escala, 7 * escala
    for i, (dx, dy) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        luz(f"Anel{i}", "AREA", (dx * raio, dy * raio, altura), 400 * forca * escala * escala,
            (1.0, 0.95, 0.88, 1), tamanho=4 * escala)
    luz("Topo", "AREA", (0, 0, 10 * escala), 110 * forca * escala * escala, (1.0, 0.97, 0.92, 1), tamanho=3 * escala)
    mundo(forca=0.5)


def luz_luminaria(escala=1.0, forca=1.0, posicao=(-4, 4, 7), preenchimento=(5, -3, 4), alvo=(0, 0, 0)):
    """A luminária do projeto: quente, no alto à esquerda DE QUEM OLHA, com um
    preenchimento frio bem fraco do lado oposto. O padrão vale para a câmera de
    cima (alto da imagem = +Y); nas vistas em perspectiva, passe a posição que
    fica no alto à esquerda daquela câmera."""
    luz("Luminaria", "AREA", tuple(c * escala for c in posicao), 1500 * forca * escala * escala,
        (1.0, 0.82, 0.58, 1), tamanho=2.2 * escala, mirar=alvo)
    luz("Preenchimento", "AREA", tuple(c * escala for c in preenchimento), 140 * forca * escala * escala,
        (0.72, 0.8, 1.0, 1), tamanho=5 * escala, mirar=alvo)
    mundo(forca=0.45)


# ---------------------------------------------------------------- câmeras

def camera_cima(largura_metros, altura_z=20.0):
    """Câmera ortográfica olhando para baixo: +X do mundo = direita da imagem,
    +Y do mundo = alto da imagem. 'largura_metros' cobre a largura da imagem."""
    dados = bpy.data.cameras.new("CameraCima")
    dados.type = "ORTHO"
    dados.ortho_scale = largura_metros
    dados.clip_end = 200
    cam = objeto("CameraCima", dados)
    cam.location = (0, 0, altura_z)
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    return cam


def camera_perspectiva(local, alvo, lente=50, sensor=36, foco=None, abertura=None):
    dados = bpy.data.cameras.new("Camera")
    dados.lens = lente
    dados.sensor_width = sensor
    dados.clip_end = 500
    cam = objeto("Camera", dados)
    cam.location = local
    olhar_para(cam, alvo)
    if foco is not None:
        dados.dof.use_dof = True
        dados.dof.focus_distance = foco
        dados.dof.aperture_fstop = abertura or 2.8
    bpy.context.scene.camera = cam
    return cam


def angulo(graus):
    return math.radians(graus)
