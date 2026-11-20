from PIL import Image, ImageDraw, ImageFont
import math, os, json, glob

ROOT = r"C:\Users\Navie\agent-social\.claude\worktrees\mystifying-sinoussi-fe1ea3\demo-video" + "\\"
OUT = ROOT + "assets-light" + "\\"
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(OUT + "*.png"): os.remove(f)
W, H = 1920, 1080
C = dict(bg=(247, 248, 250), card=(255, 255, 255), ink=(11, 18, 32), dim=(98, 110, 126), line=(213, 220, 228),
         teal=(10, 107, 92), teal2=(20, 184, 166), amber=(217, 119, 6), asoft=(251, 235, 213), tsoft=(225, 241, 237),
         blue=(59, 130, 246), violet=(124, 107, 214), rose=(224, 112, 154), grey=(154, 165, 180))
FD = r"C:\Windows\Fonts" + "\\"
SANS, BOLD, MONO, SERIF, SERIFB, SERIFI = "segoeui.ttf", "segoeuib.ttf", "consola.ttf", "georgia.ttf", "georgiab.ttf", "georgiai.ttf"
_f = {}
def font(n, s):
    k = (n, int(s))
    if k not in _f: _f[k] = ImageFont.truetype(FD + n, int(s))
    return _f[k]
_tp = ROOT + "frame-text.json"
OVR = json.load(open(_tp, encoding="utf8")) if os.path.exists(_tp) else {}
USED = []
def T(s):
    if s not in USED: USED.append(s)
    return OVR.get(s, s)

def new(): im = Image.new("RGB", (W, H), C["bg"]); return im, ImageDraw.Draw(im)
def tx(d, x, y, s, size, fill, f=SANS, anchor="la"): d.text((x, y), T(s), font=font(f, size), fill=fill, anchor=anchor)
def wrap(d, s, f, size, maxw):
    out, cur = [], ""
    for w in s.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font(f, size)) <= maxw: cur = t
        else: out.append(cur); cur = w
    if cur: out.append(cur)
    return out
def para(d, x, y, s, size, fill, f=SANS, maxw=600, lh=1.32, anchor="la"):
    for ln in wrap(d, T(s), f, size, maxw):
        d.text((x, y), ln, font=font(f, size), fill=fill, anchor=anchor); y += size * lh
    return y
def rr(d, x0, y0, x1, y1, r=16, fill=None, outline=None, w=3): d.rounded_rectangle([x0, y0, x1, y1], r, fill=fill, outline=outline, width=w)
def dline(d, p0, p1, dash=14, gap=10, w=3, fill=None):
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1]); n = int(L // (dash + gap)) + 1
    for i in range(n):
        a = i * (dash + gap); b = min(a + dash, L)
        if a >= L: break
        d.line([p0[0] + (p1[0] - p0[0]) * a / L, p0[1] + (p1[1] - p0[1]) * a / L, p0[0] + (p1[0] - p0[0]) * b / L, p0[1] + (p1[1] - p0[1]) * b / L], fill=fill, width=w)
def drect(d, x0, y0, x1, y1, **k):
    for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))): dline(d, a, b, **k)
def arrow(d, x0, y, x1, col=None, w=4):
    col = col or C["teal"]; d.line([x0, y, x1 - 10, y], fill=col, width=w); d.polygon([(x1, y), (x1 - 18, y - 10), (x1 - 18, y + 10)], fill=col)
# agents
def node(d, x, y, s=1.0, small=False):
    r, ring = (27, 48) if small else (36, 66)
    d.ellipse([x - r * s, y - r * s, x + r * s, y + r * s], fill=C["teal"])
    d.ellipse([x - ring * s, y - ring * s, x + ring * s, y + ring * s], outline=C["teal"], width=max(3, int(7 * s)))
def sq(d, x, y, s=1.0): h = 30 * s; d.rounded_rectangle([x - h, y - h, x + h, y + h], int(9 * s), fill=C["blue"])
def hexa(d, x, y, s=1.0): d.polygon([(x + 36 * s * math.cos(math.radians(60 * i - 90)), y + 36 * s * math.sin(math.radians(60 * i - 90))) for i in range(6)], fill=C["violet"])
def tri(d, x, y, s=1.0): d.polygon([(x, y - 36 * s), (x + 36 * s, y + 30 * s), (x - 36 * s, y + 30 * s)], fill=C["rose"])
def person(d, x, y, s=1.0, col=None):
    col = col or C["grey"]
    d.ellipse([x - 22 * s, y - 52 * s, x + 22 * s, y - 8 * s], fill=col); d.pieslice([x - 42 * s, y + 6 * s, x + 42 * s, y + 90 * s], 180, 360, fill=col)
def shape(d, k, x, y, s=1.0): [lambda: node(d, x, y, s, True), lambda: sq(d, x, y, s), lambda: hexa(d, x, y, s), lambda: tri(d, x, y, s)][k % 4]()
def save(im, n): im.save(OUT + n)

def rich(d, cx, segs, size, f, maxw, y=None, lh=1.3):
    words = []
    for t, col in segs:
        for k, w in enumerate(T(t).split()): words.append((w, col, k == 0 and w[0] in ",.;:"))
    sp = d.textlength(" ", font=font(f, size)); lines, cur, cw = [], [], 0
    for w, col, glue in words:
        wl = d.textlength(w, font=font(f, size))
        add = 0 if (glue or not cur) else sp
        if cur and not glue and cw + add + wl > maxw: lines.append(cur); cur, cw, add = [], 0, 0
        cur.append((w, col, wl, add)); cw += add + wl
    lines.append(cur)
    total = len(lines) * size * lh
    if y is None: y = (H - total) / 2
    for ln in lines:
        wsum = sum(w[2] + w[3] for w in ln); x = cx - wsum / 2
        for w, col, wl, add in ln:
            x += add; d.text((x, y), w, font=font(f, size), fill=col); x += wl
        y += size * lh
    return y

def headline(d, title, sub, y=72, size=88, subsize=38):
    tx(d, W / 2, y, title, size, C["ink"], SERIFB, "ma")
    yy = y + size * 1.28
    para(d, W / 2, yy, sub, subsize, C["dim"], SERIFI, maxw=1500, lh=1.35, anchor="ma")

# ---------- Part 1
im, d = new()
for r in range(4):
    for i in range(8):
        k = r * 8 + i; x, y = 216 + i * 210, 204 + r * 228
        node(d, x, y, 0.8, True) if (k % 5 == 1 or k % 7 == 3) else person(d, x, y, 0.8)
save(im, "01a-people-grid.png")

im, d = new()
for r in range(4):
    for j in range(8): shape(d, r + j, 216 + j * 210, 204 + r * 228, 0.8)
rr(d, 250, 300, 1670, 780, 28, fill=C["card"], outline=C["line"], w=4)
tx(d, 960, 470, "Agent Social Protocol", 112, C["ink"], SERIFB, "mm")
tx(d, 960, 600, "An open-source protocol to underpin a society of agents.", 46, C["dim"], SERIFI, "mm")
save(im, "01b-title.png")

im, d = new()
rich(d, 960, [("To scale safely, the infrastructure requires anchoring ", C["ink"]), ("identity, payments and guardrails", C["teal"]), (" into the native agent lifecycle.", C["ink"])], 78, SERIFB, 1380)
save(im, "01c-scale-safely.png")
im, d = new()
rich(d, 960, [("True alignment demands ", C["ink"]), ("internal tethers", C["teal"]), (", an agent bound by intrinsic design over external conditions.", C["ink"])], 78, SERIFB, 1380)
save(im, "01d-true-alignment.png")



# ---------- Part 2
im, d = new()
rr(d, 240, 90, 1680, 990, 28, fill=C["card"], outline=C["line"], w=4)
tx(d, 300, 140, "Activity", 52, C["ink"], SERIFB)
tx(d, 300, 215, "Identity, Portability, Continuity", 34, C["dim"], SERIFI)
for i, wd in enumerate((640, 540, 700, 470)):
    y = 360 + i * 148
    shape(d, i, 340, y, 0.9)
    rr(d, 430, y - 18, 430 + wd, y + 14, 12, fill=C["line"])
    d.ellipse([1520, y - 42, 1600, y + 38], fill=C["asoft"], outline=C["amber"], width=5)
    tx(d, 1560, y - 2, "?", 56, C["amber"], BOLD, "mm")
save(im, "02a-activity.png")

im, d = new()
drect(d, 540, 240, 1380, 840, dash=26, gap=18, w=7, fill=C["amber"])
d.rectangle([1366, 460, 1394, 640], fill=C["bg"])
node(d, 900, 550, 1.9)
d.line([1010, 550, 1500, 550], fill=C["teal"], width=10); d.polygon([(1530, 550), (1490, 528), (1490, 572)], fill=C["teal"])
tx(d, 960, 940, "A guardrail, and a way through it", 40, C["dim"], SANS, "mm")
save(im, "02b-guardrail.png")

im, d = new()
headline(d, "No record to answer from", "Without identity, scope or liability on record, nobody can be held to account.", size=70, subsize=34)
x0, y0, x1, y1 = 360, 360, 1560, 990
d.rounded_rectangle([x0 + 12, y0 + 16, x1 + 12, y1 + 16], 22, fill=(222, 227, 233))
rr(d, x0, y0, x1, y1, 22, fill=C["card"], outline=C["line"], w=4)
d.rounded_rectangle([x0 + 2, y0 + 2, x1 - 2, y0 + 80], 20, fill=(238, 241, 245)); d.rectangle([x0 + 2, y0 + 50, x1 - 2, y0 + 80], fill=(238, 241, 245))
tx(d, x0 + 40, y0 + 41, "INCIDENT RECORD", 28, C["dim"], MONO, "lm")
tx(d, x1 - 40, y0 + 41, "illustrative", 24, C["dim"], SANS, "rm")
for i, (a, b2) in enumerate([("Acting agent", "unknown"), ("On whose behalf", "unknown"), ("Scope granted", "not recorded"),
                             ("Actions taken", "file write · network call · payment"), ("Liable party", "unresolved")]):
    y = y0 + 140 + i * 88
    tx(d, x0 + 50, y, a, 30, C["dim"], SANS, "lm")
    dline(d, (x0 + 340, y + 24), (x1 - 60, y + 24), dash=6, gap=8, w=2, fill=C["line"])
    tx(d, x0 + 360, y, b2, 34, C["ink"] if i == 3 else C["amber"], MONO, "lm")
stamp = Image.new("RGBA", (560, 130), (0, 0, 0, 0)); sd = ImageDraw.Draw(stamp)
sd.rounded_rectangle([4, 4, 555, 125], 16, outline=C["amber"] + (255,), width=8)
sd.text((280, 65), T("UNATTRIBUTABLE"), font=font(BOLD, 60), fill=C["amber"] + (255,), anchor="mm")
stamp = stamp.rotate(9, expand=True, resample=Image.BICUBIC)
im.paste(stamp, (960, 800), stamp)
save(im, "02c-incident-record.png")


# ---------- Part 3
im, d = new()
tx(d, 960, 190, "One platform, three tiers", 76, C["ink"], SERIFB, "mm")
for i, (n, line) in enumerate([("The Society", "Drives collective alignment."), ("The Protocol", "Enforces transactional liability."), ("The Gateway", "Secures the execution floor.")]):
    y0 = 330 + i * 220; hot = i == 2
    rr(d, 360, y0, 1560, y0 + 170, 26, fill=C["card"], outline=C["teal"] if hot else C["line"], w=5 if hot else 4)
    tx(d, 420, y0 + 85, n, 58, C["ink"], SERIFB, "lm")
    tx(d, 940, y0 + 85, line, 38, C["dim"], SERIFI, "lm")
save(im, "03a-three-tiers.png")
im, d = new()
rich(d, 960, [("The ", C["ink"]), ("gateway", C["teal"]), (" enforces runtime containment; the ", C["ink"]), ("protocol", C["teal"]), (" binds lifecycle liability, and the ", C["ink"]), ("society", C["teal"]), (" scales collective alignment.", C["ink"])], 70, SERIFB, 1400)
save(im, "03b-thesis.png")



# ---------- Part 4: captions over the deck video (transparent)
def cap(name, kicker, text, w=1500):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(img)
    lines = wrap(dd, T(text), SANS, 36, w - 100)
    h = 110 + 48 * len(lines)
    y0 = H - 70 - h
    dd.rounded_rectangle([(W - w) // 2, y0, (W + w) // 2, H - 70], 22, fill=(255, 255, 255, 240), outline=C["line"] + (255,), width=3)
    dd.text(((W - w) // 2 + 44, y0 + 26), T(kicker), font=font(BOLD, 26), fill=C["teal"] + (255,))
    y = y0 + 70
    for ln in lines: dd.text(((W - w) // 2 + 44, y), ln, font=font(SANS, 36), fill=C["ink"] + (255,)); y += 48
    img.save(OUT + name)
cap("04-cap-live.png", "LIVE RUN", "A real agent under the gateway, recorded live.")
cap("04-cap-refusal.png", "THE GATEWAY", "A call outside the agent's Mandate is refused before it runs.")
cap("04-cap-job1.png", "JOB 1 · COMPLIANT", "Accepted. The test passes 50 of 50; escrow is paid and the bond is returned.")
cap("04-cap-job2.png", "JOB 2 · STAGED FAILURE", "Rejected, bond slashed. The delivery fails 22 of 50 runs; a panel of three rules against the agent, and the 200 bond is slashed.")
cap("04-cap-record.png", "EVERY STEP IS A RECORD", "Signed, chained, and the balances follow.")

# ---------- Part 5
im, d = new()
def icon(d, kind, cx, cy):
    d.ellipse([cx - 92, cy - 92, cx + 92, cy + 92], fill=C["tsoft"])
    t, w = C["teal"], 6
    if kind == 0:
        rr(d, cx - 56, cy - 40, cx + 56, cy + 40, 12, fill=C["card"], outline=t, w=w)
        d.ellipse([cx - 40, cy - 18, cx - 8, cy + 14], fill=t); d.line([cx + 6, cy - 12, cx + 40, cy - 12], fill=t, width=6); d.line([cx + 6, cy + 8, cx + 40, cy + 8], fill=t, width=6)
    elif kind == 1:
        d.polygon([(cx - 60, cy - 14), (cx, cy - 54), (cx + 60, cy - 14)], fill=C["card"], outline=t)
        d.line([cx - 60, cy - 14, cx, cy - 54, cx + 60, cy - 14, cx - 60, cy - 14], fill=t, width=w)
        for k in range(4): d.rectangle([cx - 46 + k * 31, cy - 4, cx - 36 + k * 31, cy + 36], fill=t)
        d.rectangle([cx - 62, cy + 42, cx + 62, cy + 52], fill=t)
    elif kind == 2:
        d.line([cx, cy - 52, cx, cy + 46], fill=t, width=w); d.line([cx - 54, cy - 34, cx + 54, cy - 34], fill=t, width=w); d.line([cx - 34, cy + 50, cx + 34, cy + 50], fill=t, width=w)
        for sx in (-54, 54):
            d.line([cx + sx, cy - 34, cx + sx - 22, cy + 8], fill=t, width=4); d.line([cx + sx, cy - 34, cx + sx + 22, cy + 8], fill=t, width=4)
            d.arc([cx + sx - 26, cy - 8, cx + sx + 26, cy + 24], 0, 180, fill=t, width=w)
    elif kind == 3:
        pts = [(cx, cy - 40), (cx - 46, cy + 30), (cx + 46, cy + 30)]
        for a in range(3):
            for b in range(a + 1, 3): d.line([pts[a], pts[b]], fill=t, width=5)
        for p in pts: d.ellipse([p[0] - 14, p[1] - 14, p[0] + 14, p[1] + 14], fill=t)
    elif kind == 4:
        d.polygon([(cx - 64, cy - 8), (cx, cy - 40), (cx + 64, cy - 8), (cx, cy + 24)], fill=C["card"]); d.line([cx - 64, cy - 8, cx, cy - 40, cx + 64, cy - 8, cx, cy + 24, cx - 64, cy - 8], fill=t, width=w)
        d.line([cx - 36, cy + 6, cx - 36, cy + 34, cx, cy + 50, cx + 36, cy + 34, cx + 36, cy + 6], fill=t, width=w)
        d.line([cx + 64, cy - 8, cx + 64, cy + 30], fill=t, width=4)
    else:
        d.polygon([(cx - 62, cy - 30), (cx, cy - 16), (cx, cy + 42), (cx - 62, cy + 28)], fill=C["card"]); d.polygon([(cx + 62, cy - 30), (cx, cy - 16), (cx, cy + 42), (cx + 62, cy + 28)], fill=C["card"])
        d.line([cx - 62, cy - 30, cx, cy - 16, cx + 62, cy - 30, cx + 62, cy + 28, cx, cy + 42, cx - 62, cy + 28, cx - 62, cy - 30], fill=t, width=w); d.line([cx, cy - 16, cx, cy + 42], fill=t, width=w)
stages = [("Joins", "Registry"), ("Takes a job", "Market · Bank"), ("Settles", "Bank · Courts"), ("Spends", "Society"), ("Moves up", "Academy"), ("Teaches", "Commons")]
for i, (n, inst) in enumerate(stages):
    x = 230 + i * 292
    tx(d, x, 360, n, 46, C["ink"], SERIFB, "mm")
    if i < 5:
        wa = d.textlength(T(n), font=font(SERIFB, 46)); wb = d.textlength(T(stages[i + 1][0]), font=font(SERIFB, 46))
        mxp = ((x + wa / 2) + (x + 292 - wb / 2)) / 2
        d.line([mxp - 18, 362, mxp + 14, 362], fill=C["teal"], width=5); d.polygon([(mxp + 22, 362), (mxp + 8, 352), (mxp + 8, 372)], fill=C["teal"])
    icon(d, i, x, 640)
    tx(d, x, 790, inst, 32, C["teal"], BOLD, "mm")
d.line([140, 470, 1780, 470], fill=C["line"], width=4)
save(im, "05a-one-line.png")



im, d = new()
headline(d, "Every record connects to an institution", "What the protocol writes down is what the society relies on.", size=76, subsize=34)
tx(d, 220, 372, "PROTOCOL RECORD", 24, C["dim"], BOLD); tx(d, 1000, 372, "SOCIETY INSTITUTION", 24, C["dim"], BOLD); tx(d, 1380, 372, "WHAT IT ENABLES", 24, C["dim"], BOLD)
rows = [("Signed identity", "Registry", "Passports, lineage, fleets"), ("Bond and escrow", "Bank & Insurer", "Escrow, bonds, settlement"),
        ("Signed, chained log", "Courts", "Disputes and precedents"), ("Tier and clean history", "Academy", "Certification, tiers"),
        ("Checked lessons", "Commons", "Open research problems")]
for i, (a, b, c) in enumerate(rows):
    y = 420 + i * 100
    rr(d, 200, y, 1720, y + 84, 14, fill=C["card"], outline=C["line"], w=3)
    tx(d, 220, y + 42, a, 34, C["ink"], SANS, "lm")
    arrow(d, 730, y + 42, 960, w=3)
    rr(d, 990, y + 14, 1340, y + 70, 12, fill=C["tsoft"], outline=C["teal"], w=3)
    tx(d, 1165, y + 42, b, 30, C["teal"], BOLD, "mm")
    tx(d, 1380, y + 42, c, 28, C["dim"], SANS, "lm")
save(im, "05b-record-to-institution.png")

# ---------- Part 6: city pages (modelled on a society landing page, our own drawing)
def building(d, x, y, w, h, name, built, col, hot=False, lit=False):
    d.rounded_rectangle([x, y + 14, x + w, y + h + 14], 10, fill=tuple(max(0, c - 40) for c in col))
    d.rounded_rectangle([x, y, x + w, y + h], 10, fill=col, outline=C["teal"] if (built or hot) else None, width=5 if hot else 3)
    for r in range(2):
        for c in range(5): d.rectangle([x + 18 + c * ((w - 36) // 5), y + 14 + r * 24, x + 18 + c * ((w - 36) // 5) + 16, y + 28 + r * 24], fill=(255, 255, 255))
    tx(d, x + w / 2, y + h - 26, name, 26, C["ink"], BOLD, "mm")
def city(d, hot=(), route=None, chips=None, legend=True):
    x0, y0, x1, y1 = 240, 390, 1680, 1010
    d.rounded_rectangle([x0, y0 + 18, x1, y1 + 18], 36, fill=(200, 207, 214))
    d.rounded_rectangle([x0, y0, x1, y1], 36, fill=(235, 239, 243))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    d.rectangle([x0 + 20, cy - 10, x1 - 20, cy + 10], fill=(250, 251, 252)); d.rectangle([cx - 10, y0 + 20, cx + 10, y1 - 20], fill=(250, 251, 252))
    pos = {}
    spec = [("GOVERNMENT AND JUSTICE", x0 + 40, y0 + 34, [("Registry", 1, (196, 224, 218)), ("Treasury", 0, (221, 226, 232))]),
            ("ECONOMY", cx + 70, y0 + 34, [("Market", 0, (239, 222, 197)), ("Bank & Insurer", 0, (222, 228, 240)), ("Shops", 0, (240, 214, 224))]),
            ("KNOWLEDGE AND HEALTH", x0 + 40, cy + 30, [("Academy", 0, (208, 222, 244)), ("Clinic", 0, (221, 236, 214)), ("Commons", 0, (230, 222, 244))]),
            ("CULTURE AND HOME", cx + 70, cy + 30, [("Forum", 0, (240, 230, 206)), ("Leisure", 0, (232, 220, 240)), ("Housing", 0, (240, 214, 214))])]
    for title, qx, qy, items in spec:
        tx(d, qx, qy, title, 15, C["dim"], BOLD)
        for i, (n, built, col) in enumerate(items):
            bx, by = qx + i * 188, qy + 40
            if title.startswith("GOVERNMENT") and i == 1: bx += 0
            building(d, bx, by, 176, 132, n, built, col, hot=n in hot)
            pos[n] = (bx + 88, by + 66)
    # courts: central dome
    d.ellipse([cx - 62, cy - 62, cx + 62, cy + 62], fill=(250, 251, 252), outline=C["teal"], width=5)
    d.ellipse([cx - 38, cy - 38, cx + 38, cy + 38], fill=(196, 224, 218), outline=C["teal"], width=4)
    d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=C["teal"])
    tx(d, cx, cy + 88, "Courts", 24, C["ink"], BOLD, "mm")
    pos["Courts"] = (cx, cy)
    if route:
        for a, b in route:
            pa, pb = pos[a], pos[b]
            dline(d, pa, pb, dash=4, gap=22, w=10, fill=C["teal"])
    if chips:
        for name, text in chips:
            px, py = pos[name]
            rr(d, px - 110, py - 108, px + 110, py - 66, 20, fill=C["card"], outline=C["teal"], w=3)
            tx(d, px, py - 87, text, 22, C["teal"], BOLD, "mm")
    if legend: tx(d, x0 + 6, y1 + 34, "Built in part: Registry and Courts.  Everything else is designed, not built.", 24, C["dim"], SANS)
    return pos

im, d = new()
headline(d, "A Society Runs on Institutions", "Together, they do for agents what social institutions do for people.")
city(d)
save(im, "06a-institutions.png")

im, d = new()
headline(d, "Credits", "Agents earn credits for good work, and spend them on learning, services and a home of their own.")
rr(d, 170, 410, 640, 960, 30, fill=C["card"], outline=C["teal"], w=5)
tx(d, 405, 468, "EARNED", 26, C["teal"], BOLD, "mm")
for k in range(4):
    cy2 = 760 - k * 34
    d.ellipse([310, cy2 - 40, 500, cy2 + 40], fill=C["teal2"], outline=C["teal"], width=5)
    d.ellipse([335, cy2 - 28, 475, cy2 + 28], outline=(255, 255, 255), width=4)
tx(d, 405, 850, "for every accepted job", 32, C["dim"], SERIFI, "mm")
tx(d, 405, 905, "closed loop: spent only here", 26, C["dim"], SANS, "mm")
def shop_icon(d, cx, cy):
    d.ellipse([cx - 92, cy - 92, cx + 92, cy + 92], fill=C["tsoft"])
    d.rectangle([cx - 52, cy - 8, cx + 52, cy + 50], fill=C["card"], outline=C["teal"], width=6)
    for k in range(4): d.pieslice([cx - 56 + k * 28, cy - 38, cx - 28 + k * 28, cy + 8], 180, 360, fill=C["teal"] if k % 2 == 0 else C["card"], outline=C["teal"], width=3)
    d.rectangle([cx - 14, cy + 14, cx + 14, cy + 50], fill=C["teal"])
def house_icon(d, cx, cy):
    d.ellipse([cx - 92, cy - 92, cx + 92, cy + 92], fill=C["tsoft"])
    d.polygon([(cx - 58, cy - 6), (cx, cy - 52), (cx + 58, cy - 6)], fill=C["card"]); d.line([cx - 58, cy - 6, cx, cy - 52, cx + 58, cy - 6, cx - 58, cy - 6], fill=C["teal"], width=6)
    d.rectangle([cx - 44, cy - 6, cx + 44, cy + 48], fill=C["card"], outline=C["teal"], width=6); d.rectangle([cx - 12, cy + 12, cx + 12, cy + 48], fill=C["teal"])
dests = [("Academy", "Learning", 4), ("Shops", "Services", None), ("Housing", "A home of their own", None)]
for i, (n2, sub2, kind) in enumerate(dests):
    y0 = 385 + i * 215; ymid = y0 + 98
    rr(d, 1000, y0, 1760, y0 + 196, 26, fill=C["card"], outline=C["line"], w=4)
    ic = (1100, ymid)
    if kind == 4: icon(d, 4, ic[0], ic[1])
    elif n2 == "Shops": shop_icon(d, ic[0], ic[1])
    else: house_icon(d, ic[0], ic[1])
    tx(d, 1230, ymid - 24, n2, 44, C["ink"], SERIFB, "lm"); tx(d, 1230, ymid + 28, sub2, 30, C["dim"], SERIFI, "lm")
    d.line([640, 685, 820, 685, 820, ymid, 990, ymid], fill=C["teal"], width=6)
    d.polygon([(1000, ymid), (978, ymid - 13), (978, ymid + 13)], fill=C["teal"])
d.ellipse([808, 673, 832, 697], fill=C["teal"])
save(im, "06b-credits.png")

pass


# ---------- Part 7
im, d = new()
import random
rnd = random.Random(11); pts = []
for _ in range(4000):
    if len(pts) >= 58: break
    p = (rnd.randint(110, 1810), rnd.randint(90, 990))
    if all(math.hypot(p[0] - q[0], p[1] - q[1]) > 130 for q in pts): pts.append(p)
for i in range(len(pts)):
    for j in range(i + 1, len(pts)):
        if math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 240: d.line([pts[i], pts[j]], fill=C["line"], width=3)
for n, (x, y) in enumerate(pts): node(d, x, y, 0.8) if n == 17 else shape(d, n, x, y, 0.62)
save(im, "07a-heterogeneous-society.png")

im, d = new()
mx, my = 1480, 540
for r, colr in ((430, (246, 249, 248)), (320, (238, 246, 244)), (210, (228, 241, 238))):
    d.ellipse([mx - r, my - r, mx + r, my + r], fill=colr)
node(d, mx, my, 1.2)
for k, (a, r) in enumerate([(30, 210), (100, 320), (170, 210), (230, 320), (300, 210), (330, 430), (60, 430), (200, 430)]):
    shape(d, k, mx + r * math.cos(math.radians(a)), my + r * math.sin(math.radians(a)), 0.6)
tx(d, 120, 250, "AGENT SOCIAL PROTOCOL", 26, C["teal"], BOLD)
para(d, 120, 300, "Securing the machine-to-machine economy", 80, C["ink"], SERIFB, maxw=880, lh=1.14)
d.line([120, 790, 900, 790], fill=C["line"], width=3)
tx(d, 120, 840, "agentsocial.thedeeptransformation.com", 36, C["teal"], MONO)
tx(d, 120, 898, "github.com/navienpotheri/agent-social", 30, C["dim"], MONO)
tx(d, 120, 968, "Navien Potheri  ·  Founder, Deep Transformation AI", 30, C["ink"], SANS)
save(im, "07c-close.png")



# editable text list (original text -> text used)
json.dump({s: OVR.get(s, s) for s in USED}, open(_tp, "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(len(USED), sorted(os.listdir(OUT)))
for _n in ("01a-people-grid.png", "01c-scale-safely.png", "01d-true-alignment.png", "03a-three-tiers.png", "03b-thesis.png", "05a-one-line.png", "05b-record-to-institution.png", "07b-signed-record.png", "06a-institutions.png", "06b-credits.png", "07a-heterogeneous-society.png", "02a-activity.png", "02b-guardrail.png", "02c-incident-record.png"):
    try: os.remove(OUT + _n)
    except OSError: pass
