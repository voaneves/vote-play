"""Vote Play — gera todos os ícones do site a partir da geometria do símbolo.

Victor Neves (voaneves.com) · © 2026. Todos os direitos reservados.

Por que um script, e não arquivos soltos: cada ícone do site sai daqui, do
mesmo desenho e das mesmas cores do brandkit (`brand/logo/simbolo.svg`). Nada
vem de gerador online, template ou banco de ícones — e quem quiser conferir a
origem de um PNG roda o script e compara.

Uso (precisa de Pillow):  python brand/gerar_icones.py
Escreve em public/: favicon.svg, favicon.ico, icon-180.png, icon-192.png,
icon-512.png, icon-maskable-512.png.

Depois de mudar o desenho, suba a versão em VERSAO_ICONES (index.html,
site.webmanifest e sw.js usam `?v=`): navegador guarda favicon por URL durante
meses, inclusive o de uma versão antiga do site.
"""
import pathlib
from PIL import Image, ImageDraw, PngImagePlugin

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = RAIZ / "public"

# cores do brandkit (brand/logo/simbolo.svg)
NOITE = (0x18, 0x0C, 0x0F)
CORAL = (0xF3, 0x48, 0x35)

# geometria do símbolo numa grade de 64: fundo arredondado e três barras
FUNDO_RAIO = 14
BARRAS = [  # x, y, largura, altura (raio = largura / 2)
    (12, 38, 9, 16),
    (27.5, 26, 9, 28),
    (43, 14, 9, 40),
]

AUTOR = "Victor Neves"
DIREITOS = "Copyright 2026 Victor Neves (voaneves.com). All rights reserved."


def desenhar(lado: int, *, cantos: bool = True, zona_segura: float = 1.0) -> Image.Image:
    """Rasteriza o símbolo com 4x de superamostragem (bordas suaves sem SVG)."""
    s = 4
    grande = lado * s
    img = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = grande / 64

    if cantos:
        d.rounded_rectangle([0, 0, grande - 1, grande - 1], radius=FUNDO_RAIO * k, fill=NOITE)
    else:
        # ícone "maskable" e da tela de início do iOS: o sistema recorta a
        # forma, então o fundo vai até a borda
        d.rectangle([0, 0, grande, grande], fill=NOITE)

    # zona segura: no maskable o sistema pode cortar até 20% de cada lado
    c = grande / 2
    for x, y, w, h in BARRAS:
        x0 = c + (x * k - c) * zona_segura
        y0 = c + (y * k - c) * zona_segura
        x1 = c + ((x + w) * k - c) * zona_segura
        y1 = c + ((y + h) * k - c) * zona_segura
        d.rounded_rectangle([x0, y0, x1, y1], radius=(x1 - x0) / 2, fill=CORAL)

    return img.resize((lado, lado), Image.LANCZOS)


def salvar_png(img: Image.Image, nome: str) -> None:
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Author", AUTOR)
    meta.add_text("Copyright", DIREITOS)
    meta.add_text("Source", "brand/gerar_icones.py")
    img.save(PUBLIC / nome, pnginfo=meta, optimize=True)
    print(f"  {nome}")


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)

    (PUBLIC / "favicon.svg").write_text(
        "<!-- Vote Play — Victor Neves (voaneves.com) · © 2026. Todos os direitos reservados.\n"
        "     Gerado por brand/gerar_icones.py a partir do símbolo do brandkit. -->\n"
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Vote Play">\n'
        f'  <rect width="64" height="64" rx="{FUNDO_RAIO}" fill="#{NOITE[0]:02X}{NOITE[1]:02X}{NOITE[2]:02X}"/>\n'
        f'  <g fill="#{CORAL[0]:02X}{CORAL[1]:02X}{CORAL[2]:02X}">\n'
        + "".join(
            f'    <rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{w / 2:g}"/>\n'
            for x, y, w, h in BARRAS
        )
        + "  </g>\n</svg>\n",
        encoding="utf-8",
    )
    print("  favicon.svg")

    # .ico com 16, 32 e 48: navegador que não usa SVG na aba pega daqui
    base = desenhar(256)
    base.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("  favicon.ico (16, 32, 48)")

    salvar_png(desenhar(180, cantos=False).convert("RGB"), "icon-180.png")  # iOS recorta sozinho
    salvar_png(desenhar(192), "icon-192.png")
    salvar_png(desenhar(512), "icon-512.png")
    salvar_png(desenhar(512, cantos=False, zona_segura=0.8), "icon-maskable-512.png")


if __name__ == "__main__":
    main()
