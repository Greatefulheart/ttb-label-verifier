"""Generate synthetic alcohol label images for testing the verifier.

Each sample is a deliberate test case (a clean pass, a known mismatch, or a
hard-to-read photo). Run:  python3 scripts/make_samples.py
Outputs PNG/JPG files plus a batch CSV into public/samples/.
"""
import csv
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "samples")
os.makedirs(OUT, exist_ok=True)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
SERIF_B = f"{FONT_DIR}/DejaVuSerif-Bold.ttf"
SERIF = f"{FONT_DIR}/DejaVuSerif.ttf"
SANS = f"{FONT_DIR}/DejaVuSans.ttf"
SANS_B = f"{FONT_DIR}/DejaVuSans-Bold.ttf"
SANS_C = f"{FONT_DIR}/DejaVuSansCondensed.ttf"

WARNING_BODY = (
    "(1) According to the Surgeon General, women should not drink alcoholic "
    "beverages during pregnancy because of the risk of birth defects. "
    "(2) Consumption of alcoholic beverages impairs your ability to drive a car "
    "or operate machinery, and may cause health problems."
)


def font(path, size):
    return ImageFont.truetype(path, size)


def centered(draw, y, text, fnt, fill, width):
    w = draw.textlength(text, font=fnt)
    draw.text(((width - w) / 2, y), text, font=fnt, fill=fill)
    bbox = fnt.getbbox(text)
    return y + (bbox[3] - bbox[1]) + 18


def wrap_words(draw, words, fonts, max_w):
    """words: list of (text, font). Returns lines of [(text, font)]."""
    lines, cur, cur_w = [], [], 0
    space = draw.textlength(" ", font=fonts)
    for txt, f in words:
        w = draw.textlength(txt, font=f)
        if cur and cur_w + space + w > max_w:
            lines.append(cur)
            cur, cur_w = [], 0
        cur.append((txt, f))
        cur_w += (space if cur_w else 0) + w
    if cur:
        lines.append(cur)
    return lines


def draw_warning(draw, x, y, max_w, prefix="GOVERNMENT WARNING:", body=WARNING_BODY,
                 prefix_bold=True, size=24, fill="#1b1b1b"):
    reg = font(SANS, size)
    bold = font(SANS_B, size) if prefix_bold else reg
    words = [(w, bold) for w in prefix.split()] + [(w, reg) for w in body.split()]
    space = draw.textlength(" ", font=reg)
    for line in wrap_words(draw, words, reg, max_w):
        cx = x
        for txt, f in line:
            draw.text((cx, y), txt, font=f, fill=fill)
            cx += draw.textlength(txt, font=f) + space
        y += int(size * 1.35)
    return y


def make_label(spec):
    W, H = 1000, 1350
    bg = spec.get("bg", "#f4ecd8")
    ink = spec.get("ink", "#2a1a0e")
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    # border
    d.rectangle([30, 30, W - 30, H - 30], outline=ink, width=6)
    d.rectangle([48, 48, W - 48, H - 48], outline=ink, width=2)

    y = 110
    if spec.get("tagline"):
        y = centered(d, y, spec["tagline"], font(SERIF, 30), ink, W)
    y = centered(d, y + 10, spec["brand"], font(SERIF_B, spec.get("brand_size", 62)), ink, W)
    d.line([200, y + 10, W - 200, y + 10], fill=ink, width=3)
    y += 50
    for line in spec["class_lines"]:
        y = centered(d, y, line, font(SERIF, 44), ink, W)
    y += 40
    y = centered(d, y, spec["abv"], font(SANS_B, 46), ink, W)
    y = centered(d, y + 6, spec["net"], font(SANS, 40), ink, W)
    y += 30
    for line in spec["bottler"]:
        y = centered(d, y, line, font(SANS_C, 28), ink, W)
    if spec.get("origin"):
        y = centered(d, y + 10, spec["origin"], font(SANS_B, 30), ink, W)

    wy = max(y + 40, H - 330)
    draw_warning(d, 90, wy, W - 180,
                 prefix=spec.get("warn_prefix", "GOVERNMENT WARNING:"),
                 body=spec.get("warn_body", WARNING_BODY),
                 prefix_bold=spec.get("warn_bold", True),
                 fill=ink)
    return img


def photo_effects(img, angle=5, seed=7):
    """Simulate a phone photo of a bottle: tilt, uneven light, glare, blur, noise."""
    random.seed(seed)
    W, H = img.size
    canvas = Image.new("RGB", (W + 240, H + 240), "#5b5348")
    canvas.paste(img, (120, 120))
    canvas = canvas.rotate(angle, resample=Image.BICUBIC, fillcolor="#5b5348")
    # lighting gradient + glare spot
    overlay = Image.new("L", canvas.size, 0)
    od = ImageDraw.Draw(overlay)
    cw, ch = canvas.size
    for i in range(cw):
        od.line([(i, 0), (i, ch)], fill=int(70 * (i / cw)))
    shade = Image.new("RGB", canvas.size, "#000000")
    canvas = Image.composite(shade, canvas, overlay)
    glare = Image.new("L", canvas.size, 0)
    gd = ImageDraw.Draw(glare)
    gx, gy = int(cw * 0.72), int(ch * 0.30)
    for r in range(220, 0, -4):
        gd.ellipse([gx - r * 0.6, gy - r, gx + r * 0.6, gy + r], fill=int(150 * (1 - r / 220)))
    canvas = Image.composite(Image.new("RGB", canvas.size, "#ffffff"), canvas, glare)
    canvas = canvas.filter(ImageFilter.GaussianBlur(1.1))
    px = canvas.load()
    for _ in range(int(cw * ch * 0.02)):
        x, y = random.randrange(cw), random.randrange(ch)
        v = random.randint(-40, 40)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    return canvas.resize((int(cw * 0.8), int(ch * 0.8)))


BOURBON = dict(
    brand="OLD TOM DISTILLERY",
    tagline="Est. 1891",
    class_lines=["Kentucky Straight", "Bourbon Whiskey"],
    abv="45% Alc./Vol. (90 Proof)",
    net="750 mL",
    bottler=["Distilled and Bottled by", "Old Tom Distillery, Bardstown, Kentucky"],
)
BOURBON_APP = dict(
    beverage_type="spirits", brand_name="OLD TOM DISTILLERY",
    class_type="Kentucky Straight Bourbon Whiskey", alcohol_content="45% Alc./Vol. (90 Proof)",
    net_contents="750 mL", bottler="Old Tom Distillery, Bardstown, Kentucky", country_of_origin="",
)

SAMPLES = [
    # (file, label spec, application data, expected outcome note)
    ("01-old-tom-clean.png", BOURBON, BOURBON_APP, "All fields match"),
    ("02-stones-throw-case.png",
     dict(BOURBON, brand="STONE'S THROW", tagline="Small Batch", class_lines=["Straight Rye Whiskey"],
          abv="50% Alc./Vol. (100 Proof)", bottler=["Bottled by", "Stone's Throw Spirits, Frankfort, KY"]),
     dict(BOURBON_APP, brand_name="Stone's Throw", class_type="Straight Rye Whiskey",
          alcohol_content="50% Alc./Vol.", bottler="Stone's Throw Spirits, Frankfort, KY"),
     "Brand differs only by capitalization - should pass with a note"),
    ("03-wrong-abv.png", dict(BOURBON, abv="40% Alc./Vol. (80 Proof)"), BOURBON_APP,
     "Label says 40% but application says 45% - should fail"),
    ("04-warning-title-case.png", dict(BOURBON, warn_prefix="Government Warning:"), BOURBON_APP,
     "'Government Warning' not in all caps - should fail"),
    ("05-warning-reworded.png",
     dict(BOURBON, warn_body=WARNING_BODY.replace("may cause health problems", "might cause some health issues")
          .replace("women should not drink", "women may wish to avoid")),
     BOURBON_APP, "Warning text altered - should fail"),
    ("06-warning-not-bold.png", dict(BOURBON, warn_bold=False), BOURBON_APP,
     "Warning heading not bold - should be flagged"),
    ("07-chateau-import-wine.png",
     dict(brand="CHÂTEAU BELLE RIVE", tagline="Grand Vin de Bordeaux", class_lines=["Red Bordeaux Wine"],
          abv="13.5% Alc./Vol.", net="750 mL",
          bottler=["Imported by Belle Rive Imports, Napa, CA"], origin="Product of France",
          bg="#efe9f2", ink="#3b1030", brand_size=66),
     dict(beverage_type="wine", brand_name="Château Belle Rive", class_type="Red Bordeaux Wine",
          alcohol_content="13.5%", net_contents="750 mL", bottler="Belle Rive Imports, Napa, CA",
          country_of_origin="France"),
     "Imported wine with country of origin - should pass"),
    ("08-harbor-ipa-beer.png",
     dict(brand="HARBOR LIGHT", tagline="Brewing Co.", class_lines=["India Pale Ale"],
          abv="6.8% Alc./Vol.", net="12 FL. OZ.", bottler=["Brewed and Canned by", "Harbor Light Brewing Co., Portland, ME"],
          bg="#e3f0f4", ink="#0c2d3c"),
     dict(beverage_type="beer", brand_name="Harbor Light", class_type="India Pale Ale",
          alcohol_content="6.8% ABV", net_contents="355 mL", bottler="Harbor Light Brewing Co., Portland, ME",
          country_of_origin=""),
     "Net contents given as 355 mL on the form vs 12 fl oz on the label - equivalent, should pass"),
]


def main():
    rows = []
    for fname, spec, app, note in SAMPLES:
        make_label(spec).save(os.path.join(OUT, fname))
        rows.append(dict(filename=fname, **app, expected=note))
    # A tilted, glare-y "phone photo" of the clean label
    photo = photo_effects(make_label(BOURBON), angle=4)
    photo.save(os.path.join(OUT, "09-old-tom-phone-photo.jpg"), quality=78)
    rows.append(dict(filename="09-old-tom-phone-photo.jpg", **BOURBON_APP,
                     expected="Tilted photo with glare - should still pass or ask for review"))

    with open(os.path.join(OUT, "batch-applications.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} samples to {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
