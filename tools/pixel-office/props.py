"""Furniture / prop sprites. Each builder returns (Canvas, footprint, sort_y).

footprint = (x, y, w, h) relative to the sprite's top-left; it is what blocks walking.
sort_y    = y (relative) used for depth sorting against characters' feet.
"""
import random
from px import Canvas, hx

O = hx('3a2e3a')          # selective outline
WOOD = hx('d69a5c'); WOOD_D = hx('a8713f'); WOOD_DD = hx('7d5032'); WOOD_L = hx('f0c08a')
MON = hx('2f3448'); MON_L = hx('4a5170')
SCR = hx('8fd8ff'); SCR_D = hx('4aa3e0')
WHITE = hx('ffffff'); PAPER = hx('f4efe3'); GRAY = hx('9aa3b5'); GRAY_D = hx('6b7386'); GRAY_L = hx('c9cfdb')
LEAF = hx('5fb35a'); LEAF_D = hx('3c8a46'); LEAF_L = hx('93d778'); LEAF_DD = hx('2d6b3a')
POT = hx('c96a48'); POT_D = hx('96472f'); POT_L = hx('e08a64')
RED = hx('e45b5b'); YEL = hx('f4c64e'); YEL_D = hx('d29b28'); PINK = hx('f39ab8'); PINK_D = hx('d76d93')
BLUE = hx('5b8def'); BLUE_D = hx('3f69c2'); TEAL = hx('4fc1b0'); PURP = hx('9b72e0'); ORANGE = hx('f08a4b')
GREEN = hx('62c48a')


def _desk_base(c, w=32):
    # monitor area y0..11 is left for caller; desk top y12..21, front y22..25, legs y26..29
    c.rect(0, 12, w, 10, WOOD)
    c.hline(0, 12, w, WOOD_L)
    c.hline(0, 11, w, O)
    c.vline(0, 12, 14, O); c.vline(w - 1, 12, 14, O)
    c.rect(1, 22, w - 2, 4, WOOD_D)
    c.hline(1, 22, w - 2, WOOD_DD)
    c.hline(0, 26, w, O)
    for lx in (1, w - 4):
        c.rect(lx, 26, 3, 4, WOOD_DD)
    c.shadow(w // 2, 29, w // 2 - 2, 1, 50)


def _monitor(c, x, y, w=14, h=10, screen='code'):
    c.rect(x, y, w, h, MON)
    c.frame(x, y, w, h, O)
    sx, sy, sw, sh = x + 1, y + 1, w - 2, h - 3
    if screen == 'code':
        c.rect(sx, sy, sw, sh, hx('243150'))
        for i, (ox, ln, col) in enumerate([(0, 6, TEAL), (2, 5, PINK), (2, 7, YEL), (0, 4, SCR)]):
            if sy + 1 + i * 1 < sy + sh:
                c.hline(sx + 1 + ox, sy + 1 + i, min(ln, sw - 2 - ox), col)
    elif screen == 'chart':
        c.rect(sx, sy, sw, sh, hx('e9f4ff'))
        for i, hh in enumerate([2, 4, 3, 5]):
            c.rect(sx + 2 + i * 3, sy + sh - hh, 2, hh, [BLUE, ORANGE, GREEN, PURP][i])
    elif screen == 'art':
        c.rect(sx, sy, sw, sh, hx('ffe6f0'))
        c.rect(sx + 2, sy + 1, 4, 3, PINK); c.rect(sx + 6, sy + 2, 3, 3, TEAL); c.rect(sx + 3, sy + 4, 5, 1, YEL)
    elif screen == 'game':
        c.rect(sx, sy, sw, sh, hx('2b1e4a'))
        c.rect(sx, sy + sh - 2, sw, 2, GREEN)
        c.rect(sx + 3, sy + 2, 2, 3, YEL); c.rect(sx + 8, sy + 3, 2, 2, RED); c.p(sx + 10, sy + 1, WHITE)
    elif screen == 'check':
        c.rect(sx, sy, sw, sh, hx('f2fff6'))
        for i in range(3):
            c.p(sx + 2, sy + 1 + i * 2, GREEN); c.hline(sx + 4, sy + 1 + i * 2, 6, GRAY)
    else:
        c.rect(sx, sy, sw, sh, SCR); c.hline(sx, sy, sw, SCR_D); c.hline(sx + 2, sy + 3, 5, WHITE)
    c.hline(sx, sy, sw, (255, 255, 255, 60))
    c.rect(x + w // 2 - 1, y + h, 3, 2, MON)  # stand
    c.hline(x + w // 2 - 3, y + h + 1, 7, O)


def desk(kind='single'):
    c = Canvas(32, 30)
    _desk_base(c)
    if kind == 'dual':
        _monitor(c, 2, 0, 14, 10, 'code'); _monitor(c, 16, 0, 14, 10, 'code')
    elif kind == 'laptop':
        c.rect(9, 6, 14, 8, MON); c.frame(9, 6, 14, 8, O); c.rect(10, 7, 12, 5, SCR); c.rect(8, 14, 16, 3, GRAY_L); c.frame(8, 14, 16, 3, O)
    elif kind == 'art':
        _monitor(c, 8, 0, 16, 10, 'art')
        c.rect(24, 15, 6, 4, hx('3a3f58')); c.p(26, 16, PINK)  # tablet
    elif kind == 'game':
        _monitor(c, 9, 0, 16, 10, 'game')
        c.rect(3, 15, 6, 3, hx('3a3f58')); c.p(4, 16, RED); c.p(7, 16, BLUE)  # gamepad
    elif kind == 'chart':
        _monitor(c, 9, 0, 14, 10, 'chart')
        c.rect(2, 13, 6, 6, YEL); c.rect(3, 12, 6, 6, PAPER); c.frame(3, 12, 6, 6, GRAY)
    elif kind == 'check':
        _monitor(c, 9, 0, 14, 10, 'check')
        c.rect(3, 14, 3, 5, MON); c.p(4, 15, SCR)  # phone
        c.rect(25, 14, 4, 6, MON); c.rect(26, 15, 2, 4, SCR)
    elif kind == 'books':
        _monitor(c, 11, 0, 14, 10, 'chart')
        for i, col in enumerate([RED, BLUE, GREEN]):
            c.rect(2 + i * 3, 8 + i, 3, 6 - i, col); c.vline(2 + i * 3, 8 + i, 6 - i, O)
    else:
        _monitor(c, 9, 0, 14, 10, 'plain')
    if kind not in ('laptop',):
        c.rect(6, 17, 10, 2, MON); c.hline(6, 17, 10, MON_L)  # keyboard
    c.rect(24, 13, 3, 3, WHITE); c.p(27, 14, WHITE); c.p(25, 13, hx('b07040'))  # mug
    return c, (0, 12, 32, 18), 25


def office_chair(col=BLUE, col_d=BLUE_D):
    c = Canvas(14, 14)
    c.shadow(7, 12, 5, 1)
    c.rect(2, 0, 10, 6, col); c.frame(2, 0, 10, 6, O); c.hline(3, 1, 8, (255, 255, 255, 70))
    c.rect(1, 6, 12, 4, col_d); c.frame(1, 6, 12, 4, O)
    c.rect(6, 10, 2, 2, O); c.hline(3, 12, 8, O)
    return c


def stool():
    c = Canvas(10, 10)
    c.ellipse(5, 3, 4, 2, ORANGE); c.hline(2, 1, 6, O); c.hline(2, 5, 6, hx('b05f30'))
    c.vline(4, 6, 3, O); c.vline(5, 6, 3, O); c.hline(2, 9, 6, O)
    return c


def plant(size='small', seed=0):
    rnd = random.Random(seed)
    if size == 'small':
        w, h, potw, poth = 12, 18, 8, 6
    elif size == 'large':
        w, h, potw, poth = 18, 28, 10, 8
    else:  # tall
        w, h, potw, poth = 20, 38, 10, 8
    c = Canvas(w, h)
    c.shadow(w // 2, h - 1, potw // 2 + 1, 1)
    px0 = (w - potw) // 2
    c.rect(px0, h - poth - 1, potw, poth, POT); c.frame(px0, h - poth - 1, potw, poth, O)
    c.hline(px0 + 1, h - poth, potw - 2, POT_L); c.rect(px0 + 1, h - 3, potw - 2, 1, POT_D)
    top = 0
    bottom = h - poth - 1
    if size == 'tall':
        c.vline(w // 2, 8, bottom - 8, WOOD_DD)
    blobs = []
    n = {'small': 7, 'large': 13, 'tall': 16}[size]
    for _ in range(n):
        bx = rnd.randint(1, w - 5)
        by = rnd.randint(top, bottom - 3)
        blobs.append((bx, by))
    blobs.sort(key=lambda b: b[1])
    for bx, by in blobs:
        r = 2 if size == 'small' else 3
        c.ellipse(bx + 1, by + 1, r, r, LEAF_DD)
    for bx, by in blobs:
        r = 2 if size == 'small' else 3
        c.ellipse(bx + 1, by, r - 1 if r > 2 else 2, r - 1 if r > 2 else 1, LEAF)
        c.p(bx, by - 1, LEAF_L)
    return c, (px0, h - poth - 1, potw, poth), h - 2


def bookshelf(seed=1):
    rnd = random.Random(seed)
    c = Canvas(28, 36)
    c.shadow(14, 35, 12, 1)
    c.rect(0, 0, 28, 35, WOOD_D); c.frame(0, 0, 28, 35, O); c.hline(1, 1, 26, WOOD)
    cols = [RED, BLUE, GREEN, YEL, PURP, TEAL, ORANGE, PINK]
    for shelf in range(4):
        y = 3 + shelf * 8
        c.rect(2, y, 24, 6, WOOD_DD)
        x = 3
        while x < 25:
            bw = rnd.choice([2, 2, 3])
            bh = rnd.choice([4, 5, 5, 6])
            col = rnd.choice(cols)
            if x + bw > 25:
                break
            c.rect(x, y + 6 - bh, bw, bh, col); c.vline(x, y + 6 - bh, bh, O)
            x += bw + (1 if rnd.random() < .2 else 0)
        c.hline(1, y + 6, 26, WOOD)
    return c, (0, 26, 28, 9), 34


def server_rack(seed=2):
    rnd = random.Random(seed)
    c = Canvas(18, 38)
    c.shadow(9, 37, 8, 1)
    c.rect(0, 0, 18, 37, hx('2a2f40')); c.frame(0, 0, 18, 37, O); c.hline(1, 1, 16, hx('454c63'))
    for i in range(7):
        y = 3 + i * 5
        c.rect(2, y, 14, 4, hx('394057')); c.hline(2, y, 14, hx('4c556f'))
        c.p(4, y + 2, rnd.choice([GREEN, GREEN, SCR, YEL]))
        c.p(6, y + 2, rnd.choice([GREEN, SCR, (0, 0, 0, 0)]))
        c.hline(9, y + 2, 5, hx('22273a'))
    return c, (0, 28, 18, 9), 36


def sofa(col=YEL, col_d=YEL_D):
    c = Canvas(66, 30)
    c.shadow(33, 29, 31, 1)
    c.rect(2, 0, 62, 12, col_d); c.frame(2, 0, 62, 12, O); c.hline(3, 1, 60, col)
    c.rect(0, 8, 8, 20, col_d); c.frame(0, 8, 8, 20, O); c.hline(1, 9, 6, col)
    c.rect(58, 8, 8, 20, col_d); c.frame(58, 8, 8, 20, O); c.hline(59, 9, 6, col)
    c.rect(8, 12, 50, 12, col); c.hline(8, 12, 50, hx('ffe08a'))
    for x in (24, 41):
        c.vline(x, 12, 12, col_d)
    c.rect(8, 24, 50, 4, col_d); c.hline(0, 28, 66, O)
    c.rect(10, 4, 8, 6, PINK); c.frame(10, 4, 8, 6, PINK_D)  # cushion
    c.rect(48, 4, 8, 6, TEAL); c.frame(48, 4, 8, 6, hx('2f9a8a'))
    return c, (0, 12, 66, 17), 10


def armchair(col=PINK, col_d=PINK_D):
    c = Canvas(20, 22)
    c.shadow(10, 21, 9, 1)
    c.rect(2, 0, 16, 9, col_d); c.frame(2, 0, 16, 9, O); c.hline(3, 1, 14, col)
    c.rect(0, 6, 4, 14, col_d); c.frame(0, 6, 4, 14, O)
    c.rect(16, 6, 4, 14, col_d); c.frame(16, 6, 4, 14, O)
    c.rect(4, 9, 12, 8, col); c.hline(4, 9, 12, (255, 255, 255, 70))
    c.rect(4, 17, 12, 3, col_d); c.hline(0, 20, 20, O)
    return c, (0, 8, 20, 13), 8


def coffee_table():
    c = Canvas(36, 16)
    c.shadow(18, 15, 16, 1)
    c.rect(0, 0, 36, 10, WOOD); c.frame(0, 0, 36, 10, O); c.hline(1, 1, 34, WOOD_L)
    c.rect(1, 10, 34, 3, WOOD_D); c.hline(0, 13, 36, O)
    c.rect(2, 13, 2, 2, WOOD_DD); c.rect(32, 13, 2, 2, WOOD_DD)
    c.rect(6, 3, 3, 3, WHITE); c.p(9, 4, WHITE); c.p(7, 3, hx('8a5230'))
    c.rect(24, 3, 3, 3, WHITE); c.p(23, 4, WHITE); c.p(25, 3, hx('8a5230'))
    c.rect(14, 2, 8, 6, hx('f6e0a8')); c.frame(14, 2, 8, 6, hx('c79a4d'))  # snack plate
    c.p(16, 4, hx('b06a3b')); c.p(19, 5, hx('b06a3b'))
    return c, (0, 2, 36, 12), 12


def bean_bag(col=BLUE, col_d=BLUE_D):
    c = Canvas(18, 14)
    c.shadow(9, 13, 8, 1)
    c.ellipse(9, 7, 8, 6, col_d)
    c.ellipse(9, 6, 7, 5, col)
    c.ellipse(7, 4, 3, 2, (255, 255, 255, 70))
    return c, (1, 4, 16, 9), 10


def counter():
    c = Canvas(96, 34)
    c.shadow(48, 33, 46, 1)
    # upper cabinets / backsplash
    c.rect(0, 0, 96, 8, hx('e9e1d2')); c.frame(0, 0, 96, 8, O)
    for x in range(1, 95, 16):
        c.vline(x + 15, 1, 6, hx('cfc4ae'))
    # counter top
    c.rect(0, 14, 96, 6, hx('d8dde6')); c.frame(0, 14, 96, 6, O); c.hline(1, 15, 94, WHITE)
    c.rect(0, 20, 96, 12, WOOD_D); c.frame(0, 20, 96, 12, O)
    for x in range(0, 96, 16):
        c.vline(x, 21, 10, WOOD_DD); c.hline(x + 6, 25, 4, WOOD_L)
    # coffee machine
    c.rect(8, 4, 14, 12, hx('3a3f58')); c.frame(8, 4, 14, 12, O); c.rect(11, 6, 8, 3, hx('5a6280')); c.p(12, 7, RED); c.p(14, 7, GREEN)
    c.rect(12, 11, 6, 3, hx('22263a')); c.rect(13, 12, 3, 2, WHITE)
    # sink
    c.rect(44, 15, 14, 4, hx('aeb6c6')); c.frame(44, 15, 14, 4, GRAY_D); c.vline(51, 10, 5, GRAY_D); c.hline(51, 10, 3, GRAY_D)
    # cups + fruit bowl
    for i, col in enumerate([RED, BLUE, YEL]):
        c.rect(28 + i * 4, 11, 3, 4, col); c.hline(28 + i * 4, 11, 3, WHITE)
    c.ellipse(76, 13, 6, 2, hx('d9b48c')); c.p(73, 11, RED); c.p(76, 10, YEL); c.p(79, 11, GREEN); c.p(75, 11, ORANGE)
    c.rect(86, 8, 6, 7, PAPER); c.frame(86, 8, 6, 7, GRAY)  # menu
    return c, (0, 14, 96, 19), 30


def vending():
    c = Canvas(22, 40)
    c.shadow(11, 39, 10, 1)
    c.rect(0, 0, 22, 39, hx('d9534f')); c.frame(0, 0, 22, 39, O); c.hline(1, 1, 20, hx('f07a74'))
    c.rect(2, 3, 13, 26, hx('cfe9f5')); c.frame(2, 3, 13, 26, O)
    cols = [YEL, BLUE, GREEN, ORANGE, PINK, TEAL]
    for r in range(5):
        for k in range(3):
            c.rect(4 + k * 4, 5 + r * 5, 2, 3, cols[(r + k) % len(cols)])
        c.hline(3, 8 + r * 5, 11, GRAY)
    c.rect(16, 6, 4, 8, hx('3a3f58')); c.p(17, 8, GREEN); c.p(18, 10, YEL)
    c.rect(3, 31, 12, 5, hx('2a2f40'))
    return c, (0, 30, 22, 9), 38


def water_cooler():
    c = Canvas(12, 28)
    c.shadow(6, 27, 5, 1)
    c.rect(2, 0, 8, 10, hx('9fdcff')); c.frame(2, 0, 8, 10, O); c.hline(3, 1, 3, WHITE)
    c.rect(1, 10, 10, 17, hx('e6eaf0')); c.frame(1, 10, 10, 17, O)
    c.p(4, 13, BLUE); c.p(7, 13, RED); c.rect(3, 16, 6, 2, hx('6b7386'))
    return c, (1, 20, 10, 7), 26


def meeting_table():
    c = Canvas(140, 40)
    c.shadow(70, 39, 68, 1)
    c.rect(0, 0, 140, 30, hx('b77d4a')); c.frame(0, 0, 140, 30, O); c.hline(1, 1, 138, hx('d39a62'))
    c.rect(4, 4, 132, 22, hx('c88b55'))
    c.rect(1, 30, 138, 5, hx('8c5a34')); c.hline(0, 35, 140, O)
    for lx in (4, 132):
        c.rect(lx, 35, 4, 4, WOOD_DD)
    # laptops + papers
    for i, x in enumerate([22, 62, 102]):
        c.rect(x, 4, 12, 6, MON); c.rect(x + 1, 5, 10, 4, [SCR, hx('ffe6f0'), hx('e9f4ff')][i])
        c.rect(x - 1, 10, 14, 2, GRAY_L)
        c.rect(x + 2, 18, 9, 6, PAPER); c.frame(x + 2, 18, 9, 6, GRAY_L); c.hline(x + 4, 20, 5, GRAY)
    c.ellipse(46, 15, 3, 2, WHITE); c.ellipse(90, 16, 3, 2, WHITE)
    c.p(70, 14, GREEN); c.rect(68, 15, 5, 3, POT)
    return c, (0, 4, 140, 35), 30


def reception_desk():
    c = Canvas(76, 32)
    c.shadow(38, 31, 36, 1)
    c.rect(0, 6, 76, 8, hx('f6f3ee')); c.frame(0, 6, 76, 8, O); c.hline(1, 7, 74, WHITE)
    c.rect(0, 14, 76, 16, hx('e8e2d8')); c.frame(0, 14, 76, 16, O)
    c.hline(1, 15, 74, WHITE); c.rect(4, 20, 68, 3, hx('7fa8e8')); c.hline(4, 20, 68, hx('a8c6f5'))
    _monitor(c, 46, 0, 14, 9, 'plain')
    c.rect(20, 3, 6, 4, YEL); c.frame(20, 3, 6, 4, YEL_D); c.p(23, 2, YEL_D)  # bell
    c.rect(10, 8, 6, 4, PAPER); c.ellipse(66, 10, 2, 1, PINK)
    return c, (0, 10, 76, 21), 29


def lounge_sofa_small(col=BLUE, col_d=BLUE_D):
    c, fp, sy = sofa(col, col_d)
    small = Canvas(40, 30)
    # build a 2-seat sofa by redrawing narrower
    s = small
    s.shadow(20, 29, 19, 1)
    s.rect(2, 0, 36, 12, col_d); s.frame(2, 0, 36, 12, O); s.hline(3, 1, 34, col)
    s.rect(0, 8, 7, 20, col_d); s.frame(0, 8, 7, 20, O)
    s.rect(33, 8, 7, 20, col_d); s.frame(33, 8, 7, 20, O)
    s.rect(7, 12, 26, 12, col); s.hline(7, 12, 26, (255, 255, 255, 80)); s.vline(20, 12, 12, col_d)
    s.rect(7, 24, 26, 4, col_d); s.hline(0, 28, 40, O)
    return s, (0, 12, 40, 17), 10


def tree(seed=3):
    rnd = random.Random(seed)
    c = Canvas(44, 56)
    c.shadow(22, 54, 14, 2, 60)
    c.rect(19, 34, 6, 20, hx('8a5a36')); c.vline(19, 34, 20, O); c.vline(24, 34, 20, hx('6a4228')); c.vline(21, 36, 14, hx('a06c44'))
    blobs = [(rnd.randint(6, 36), rnd.randint(6, 34)) for _ in range(18)]
    for bx, by in blobs:
        c.ellipse(bx, by + 1, 7, 6, LEAF_DD)
    for bx, by in blobs:
        c.ellipse(bx, by, 6, 5, LEAF_D)
    for bx, by in blobs[:10]:
        c.ellipse(bx - 1, by - 2, 4, 3, LEAF)
    for bx, by in blobs[:6]:
        c.p(bx - 2, by - 3, LEAF_L); c.p(bx - 1, by - 3, LEAF_L)
    return c, (16, 46, 12, 8), 52


def bush(seed=4, flowers=True):
    rnd = random.Random(seed)
    c = Canvas(22, 16)
    c.shadow(11, 15, 10, 1)
    for _ in range(6):
        c.ellipse(rnd.randint(5, 16), rnd.randint(6, 10), 5, 4, LEAF_D)
    for _ in range(5):
        c.ellipse(rnd.randint(5, 16), rnd.randint(5, 8), 3, 2, LEAF)
    if flowers:
        for _ in range(5):
            c.p(rnd.randint(3, 18), rnd.randint(3, 11), rnd.choice([PINK, YEL, WHITE, RED]))
    return c, (2, 8, 18, 7), 14


def bench():
    c = Canvas(38, 20)
    c.shadow(19, 19, 18, 1)
    c.rect(1, 0, 36, 6, WOOD); c.frame(1, 0, 36, 6, O); c.hline(2, 1, 34, WOOD_L); c.hline(2, 3, 34, WOOD_D)
    c.rect(0, 8, 38, 6, WOOD); c.frame(0, 8, 38, 6, O); c.hline(1, 9, 36, WOOD_L); c.hline(1, 11, 36, WOOD_D)
    for lx in (3, 33):
        c.rect(lx, 14, 2, 5, hx('3a3f58'))
    return c, (0, 8, 38, 11), 6


def lamp_post():
    c = Canvas(10, 36)
    c.shadow(5, 35, 4, 1)
    c.rect(4, 8, 2, 26, hx('3a3f58')); c.rect(2, 33, 6, 2, hx('3a3f58'))
    c.rect(1, 1, 8, 7, hx('3a3f58')); c.rect(2, 2, 6, 5, hx('fff1b0')); c.p(3, 3, WHITE)
    return c, (2, 30, 6, 5), 34


def signboard():
    c = Canvas(30, 32)
    c.shadow(15, 31, 12, 1)
    c.rect(13, 18, 4, 13, WOOD_DD)
    c.rect(0, 0, 30, 20, WOOD); c.frame(0, 0, 30, 20, O); c.rect(2, 2, 26, 16, hx('6f4a2f'))
    for i, ln in enumerate([14, 18, 12]):
        c.hline(15 - ln // 2, 5 + i * 4, ln, hx('f6e7c8'))
    return c, (10, 26, 10, 5), 30


def arcade():
    c = Canvas(20, 38)
    c.shadow(10, 37, 9, 1)
    c.rect(0, 0, 20, 37, PURP); c.frame(0, 0, 20, 37, O); c.hline(1, 1, 18, hx('b896f0'))
    c.rect(2, 2, 16, 5, hx('2a1f45')); c.hline(4, 4, 12, YEL)
    c.rect(2, 9, 16, 12, hx('1b1430')); c.rect(4, 17, 12, 2, GREEN); c.p(7, 13, YEL); c.p(12, 12, RED)
    c.rect(1, 22, 18, 5, hx('7d55c4')); c.p(5, 24, RED); c.p(9, 24, BLUE); c.p(12, 24, YEL); c.vline(15, 23, 2, O)
    c.rect(3, 28, 14, 8, hx('6b46b0'))
    return c, (0, 28, 20, 9), 36


def easel():
    c = Canvas(22, 32)
    c.shadow(11, 31, 9, 1)
    c.vline(4, 6, 25, WOOD_DD); c.vline(17, 6, 25, WOOD_DD); c.vline(11, 2, 28, WOOD_D)
    c.rect(2, 4, 18, 16, PAPER); c.frame(2, 4, 18, 16, O)
    c.ellipse(8, 10, 3, 3, PINK); c.rect(11, 9, 5, 6, TEAL); c.hline(5, 16, 11, YEL)
    return c, (2, 26, 18, 5), 30


def globe():
    c = Canvas(16, 24)
    c.shadow(8, 23, 6, 1)
    c.rect(7, 14, 2, 8, WOOD_DD); c.rect(4, 21, 8, 2, WOOD_DD)
    c.ellipse(8, 8, 6, 6, hx('5aa7e8')); c.ellipse(8, 8, 6, 6, None)
    for (x, y) in [(5, 5), (6, 5), (6, 6), (9, 8), (10, 9), (10, 10), (7, 10), (4, 9)]:
        c.p(x, y, GREEN)
    c.vline(14, 3, 11, YEL_D)
    return c, (3, 18, 10, 5), 22


def device_rack():
    c = Canvas(30, 34)
    c.shadow(15, 33, 13, 1)
    c.rect(0, 0, 30, 33, hx('d8dde6')); c.frame(0, 0, 30, 33, O)
    for r in range(3):
        y = 3 + r * 10
        c.hline(1, y + 8, 28, GRAY)
        for k in range(4):
            c.rect(3 + k * 7, y, 4, 7, MON); c.rect(4 + k * 7, y + 1, 2, 5, [SCR, GREEN, PINK, YEL][(r + k) % 4])
    return c, (0, 24, 30, 9), 32


def robot():
    c = Canvas(16, 22)
    c.shadow(8, 21, 6, 1)
    c.rect(3, 2, 10, 8, GRAY_L); c.frame(3, 2, 10, 8, O); c.p(6, 5, SCR); c.p(9, 5, SCR); c.vline(8, 0, 2, O); c.p(8, 0, RED)
    c.rect(2, 11, 12, 8, GRAY); c.frame(2, 11, 12, 8, O); c.p(7, 14, GREEN); c.p(8, 14, YEL)
    c.rect(3, 19, 4, 2, O); c.rect(9, 19, 4, 2, O)
    return c, (2, 15, 12, 6), 20


def printer():
    c = Canvas(24, 22)
    c.shadow(12, 21, 11, 1)
    c.rect(0, 6, 24, 14, hx('e6eaf0')); c.frame(0, 6, 24, 14, O); c.hline(1, 7, 22, WHITE)
    c.rect(4, 2, 16, 5, PAPER); c.frame(4, 2, 16, 5, GRAY_L); c.rect(15, 10, 6, 2, MON); c.p(16, 10, GREEN)
    c.rect(4, 14, 16, 3, hx('6b7386'))
    return c, (0, 12, 24, 8), 20


def filing():
    c = Canvas(16, 26)
    c.shadow(8, 25, 7, 1)
    c.rect(0, 0, 16, 25, hx('8ea0bd')); c.frame(0, 0, 16, 25, O)
    for i in range(3):
        c.rect(2, 2 + i * 8, 12, 6, hx('a9b9d3')); c.hline(6, 4 + i * 8, 4, O)
    return c, (0, 17, 16, 8), 24


def cafe_table():
    c = Canvas(24, 22)
    c.shadow(12, 21, 8, 1)
    c.vline(11, 9, 11, hx('3a3f58')); c.vline(12, 9, 11, hx('3a3f58')); c.hline(7, 20, 10, hx('3a3f58'))
    c.ellipse(12, 5, 11, 5, hx('a8713f')); c.ellipse(12, 4, 10, 4, WOOD); c.ellipse(10, 3, 4, 1, WOOD_L)
    c.rect(6, 2, 3, 3, WHITE); c.p(7, 2, hx('8a5230')); c.rect(15, 3, 3, 3, WHITE); c.p(16, 3, hx('8a5230'))
    return c, (6, 8, 12, 13), 18


BUILDERS = {
    'desk': desk, 'plant': plant, 'bookshelf': bookshelf, 'server': server_rack, 'sofa': sofa,
    'armchair': armchair, 'coffee_table': coffee_table, 'bean_bag': bean_bag, 'counter': counter,
    'vending': vending, 'water_cooler': water_cooler, 'meeting_table': meeting_table,
    'reception_desk': reception_desk, 'sofa_small': lounge_sofa_small, 'tree': tree, 'bush': bush,
    'bench': bench, 'lamp': lamp_post, 'sign': signboard, 'arcade': arcade, 'easel': easel,
    'globe': globe, 'device_rack': device_rack, 'robot': robot, 'printer': printer, 'filing': filing,
}
