#!/usr/bin/env python3
"""
generate_icons.py — drawDB Desktop icon generator (Task T4)

Generates the complete Tauri icon set (PNG sizes, Windows .ico, macOS .icns,
and the Windows Store logos) from a single source PNG. If no source is given,
a clean default drawDB "ER diagram" icon is drawn programmatically, so the
project builds with a real icon out of the box.

Usage:
    python3 scripts/generate_icons.py                 # default icon -> overlay/src-tauri/icons
    python3 scripts/generate_icons.py -s logo.png     # from your own square PNG
    python3 scripts/generate_icons.py -o path/to/icons

Requires: Pillow  (pip install pillow)

Tauri alternative: `npm run tauri icon path/to/logo.png` produces the same
set if you have the Tauri CLI installed; this script is the no-Node fallback
and the source of the default icon.
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

MASTER = 1024
BRAND_TOP = (29, 110, 140)     # #1d6e8c
BRAND_BOTTOM = (18, 74, 94)    # #124a5e
ACCENT = (42, 169, 201)        # #2aa9c9
CARD = (248, 251, 252)
CARD_ROW = (208, 215, 222)
LINE = (235, 245, 249)

# Tauri standard PNG icons (name -> px). 128x128@2x == 256.
PNG_ICONS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}
# Windows Store / MS tiles produced by `tauri icon`.
STORE_LOGOS = {
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}
ICO_SIZES = [16, 32, 48, 64, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_default_master():
    """Draw a 1024x1024 drawDB-style ER diagram icon."""
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    # vertical gradient background
    grad = Image.new("RGBA", (1, MASTER))
    for y in range(MASTER):
        t = y / (MASTER - 1)
        r = int(BRAND_TOP[0] + (BRAND_BOTTOM[0] - BRAND_TOP[0]) * t)
        g = int(BRAND_TOP[1] + (BRAND_BOTTOM[1] - BRAND_TOP[1]) * t)
        b = int(BRAND_TOP[2] + (BRAND_BOTTOM[2] - BRAND_TOP[2]) * t)
        grad.putpixel((0, y), (r, g, b, 255))
    grad = grad.resize((MASTER, MASTER))
    img.paste(grad, (0, 0), rounded_mask(MASTER, 180))

    d = ImageDraw.Draw(img)

    def table_card(x, y, w, h):
        radius = 28
        d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=CARD)
        d.rounded_rectangle([x, y, x + w, y + 88], radius=radius, fill=ACCENT)
        d.rectangle([x, y + 60, x + w, y + 88], fill=ACCENT)  # square off header bottom
        for i in range(3):
            ry = y + 132 + i * 64
            d.rounded_rectangle([x + 36, ry, x + w - 36, ry + 30], radius=12, fill=CARD_ROW)

    # two tables connected by a relationship line
    ax, ay, aw, ah = 150, 250, 360, 360
    bx, by, bw, bh = 540, 470, 340, 320
    # relationship line (drawn under cards' connection points)
    sx, sy = ax + aw, ay + 200
    ex, ey = bx, by + 80
    d.line([(sx, sy), (sx + 30, sy), (ex - 30, ey), (ex, ey)], fill=LINE, width=14, joint="curve")
    d.ellipse([sx - 14, sy - 14, sx + 14, sy + 14], fill=LINE)           # "one" end
    d.ellipse([ex - 16, ey - 16, ex + 16, ey + 16], outline=LINE, width=12)  # "many" end

    table_card(ax, ay, aw, ah)
    table_card(bx, by, bw, bh)
    return img


def load_master(source):
    img = Image.open(source).convert("RGBA")
    if img.width != img.height:
        side = max(img.width, img.height)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        img = canvas
    return img.resize((MASTER, MASTER), Image.LANCZOS)


def resized(master, px):
    return master.resize((px, px), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description="Generate the Tauri icon set for drawDB Desktop.")
    here = Path(__file__).resolve().parent
    ap.add_argument("-s", "--source", help="Source PNG (square recommended). Omit to draw the default icon.")
    ap.add_argument("-o", "--out", default=str(here.parent / "overlay" / "src-tauri" / "icons"),
                    help="Output directory (default: overlay/src-tauri/icons)")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.source:
        master = load_master(args.source)
        print(f"source : {args.source}")
    else:
        master = draw_default_master()
        print("source : (built-in default drawDB icon)")
    print(f"output : {out}")

    for name, px in {**PNG_ICONS, **STORE_LOGOS}.items():
        resized(master, px).save(out / name)
        print(f"  png   {name} ({px}x{px})")

    # multi-resolution .ico
    master.save(out / "icon.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"  ico   icon.ico {ICO_SIZES}")

    # .icns for macOS
    try:
        master.save(out / "icon.icns", format="ICNS")
        print("  icns  icon.icns")
    except Exception as e:  # pragma: no cover - platform/pillow dependent
        print(f"  WARN  icon.icns not written ({e}); run `npm run tauri icon` on macOS instead")

    print("done.")


if __name__ == "__main__":
    main()
