"""Link-preview pictures (the card Messages, WhatsApp, Slack... show when someone sends a link) and the site icon.
Plain title cards with a drawn timeline: no health data, no names, so they are safe for anyone who sees a link.
serve_viewer.py serves them from preview/ and points each page's og:image at its card.
A card made from a real photo (--photo) is health data, so it goes to the private local/preview/ (never committed);
serve_viewer.py uses a card there ahead of the plain one in preview/.

Usage: ../imaging/.venv/bin/python -I make_preview_cards.py      (needs Pillow; run again after changing a card)
       ../imaging/.venv/bin/python -I make_preview_cards.py --photo slides local/pathology/b2023/full/her2_1_013.jpg
"""
import os, sys, math
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "preview")
BG, INK, MUTED, ACCENT, LINE = (24, 26, 31), (236, 238, 242), (150, 156, 168), (57, 135, 229), (52, 56, 66)
COLS = [(57, 135, 229), (227, 73, 72), (240, 176, 60), (88, 186, 120), (155, 147, 238)]
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONT, size, index=1 if bold else 0)
    except OSError:
        return ImageFont.load_default()


def timeline(d, x0, y0, x1, y1, seed):
    """a made-up timeline motif: faint lanes, a gentle line with dots, a few bars (not real data)"""
    for i in range(4):
        y = y0 + (y1 - y0) * (i + .5) / 4
        d.line([(x0, y), (x1, y)], fill=LINE, width=2)
    pts = []
    for i in range(14):
        x = x0 + (x1 - x0) * i / 13
        y = y0 + (y1 - y0) * (.55 - .3 * math.sin(i * .55 + seed) * math.exp(-i * .04))
        pts.append((x, y))
    d.line(pts, fill=ACCENT, width=5, joint="curve")
    for i, (x, y) in enumerate(pts):
        d.ellipse([x - 8, y - 8, x + 8, y + 8], fill=COLS[(i + seed) % len(COLS)], outline=BG, width=3)
    for i in range(5):
        a = x0 + (x1 - x0) * (.08 + .19 * i)
        d.rounded_rectangle([a, y1 - 22, a + (x1 - x0) * .1, y1 - 6], radius=8, fill=COLS[(i + 2 * seed) % len(COLS)])
    d.line([(x0 + (x1 - x0) * .62, y0 - 10), (x0 + (x1 - x0) * .62, y1 + 6)], fill=ACCENT, width=3)


def card(name, title, sub, seed):
    im = Image.new("RGB", (1200, 630), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([40, 40, 1160, 590], radius=28, outline=LINE, width=3)
    d.text((90, 92), title, font=font(78, True), fill=INK)
    d.text((92, 194), sub, font=font(36), fill=MUTED)
    timeline(d, 92, 300, 1108, 540, seed)
    im.save(os.path.join(OUT, name + ".png"), optimize=True)


def photo_card(name, title, sub, photo):
    """the photo filling the card (cropped to 1200x630), a dark band at the bottom with the title; to local/preview/"""
    W, H = 1200, 630
    ph = Image.open(photo).convert("RGB")
    k = max(W / ph.width, H / ph.height)
    ph = ph.resize((round(ph.width * k), round(ph.height * k)), Image.LANCZOS)
    x, y = (ph.width - W) // 2, (ph.height - H) // 2
    im = ph.crop((x, y, x + W, y + H))
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for yy in range(H):
        t = (yy - H * .42) / (H * .3)
        sd.line([(0, yy), (W, yy)], fill=int(225 * max(0, min(1, t)) ** .8))
    im = Image.composite(Image.new("RGB", (W, H), BG), im, shade)
    d = ImageDraw.Draw(im)
    d.text((60, H - 170), title, font=font(72, True), fill=INK)
    d.text((62, H - 82), sub, font=font(34), fill=(205, 209, 216))
    out = os.path.join(HERE, "local", "preview")
    os.makedirs(out, exist_ok=True)
    im.save(os.path.join(out, name + ".png"), optimize=True)
    print("wrote", os.path.join(out, name + ".png"))


def icon():
    for size, name in ((180, "icon-180.png"), (32, "icon-32.png")):
        s = 4 * size
        im = Image.new("RGB", (s, s), BG)
        d = ImageDraw.Draw(im)
        pts = [(s * (.18 + .64 * i / 5), s * (.5 - .2 * math.sin(i * .9 + .4))) for i in range(6)]
        d.line(pts, fill=ACCENT, width=s // 14, joint="curve")
        for i, (x, y) in enumerate(pts[1::2]):
            r = s * .075
            d.ellipse([x - r, y - r, x + r, y + r], fill=COLS[i + 1])
        d.line([(s * .14, s * .84), (s * .86, s * .84)], fill=MUTED, width=s // 28)
        im.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--photo"]:
        name, photo = sys.argv[2], sys.argv[3]
        title, sub = {"records": ("Health records timeline", "Labs, scans, treatments and notes on one shared timeline"),
                      "slides": ("Pathology slides", "Microscope slide photos by hospital, slide and date"),
                      "story": ("Tell your story", "Photos, memories and the records from that time")}[name]
        photo_card(name, title, sub, photo)
        sys.exit()
    os.makedirs(OUT, exist_ok=True)
    card("records", "Health records timeline", "Labs, scans, treatments and notes on one shared timeline", 0)
    card("slides", "Pathology slides", "Microscope slide photos by hospital, slide and date", 2)
    card("story", "Tell your story", "Photos, memories and the records from that time", 4)
    icon()
    print("wrote", sorted(os.listdir(OUT)))
