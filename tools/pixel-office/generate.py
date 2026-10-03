#!/usr/bin/env python3
"""Agent Deck — pixel office generator.

Draws every office asset procedurally (no third-party art), so style, palette
and scale stay consistent. Single source of truth for the office map:
room rects, doors, furniture placements, seat waypoints and the walk grid.

    python3 tools/pixel-office/generate.py

Writes to client/public/assets/pixel-office/.
"""
import json
import os
import random
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from px import Canvas, hx  # noqa: E402
import props as P  # noqa: E402
import characters as CH  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'pixel-office')

W, H = 768, 480
# Layout variant: 'game' (default, game projects) or 'app' (app/web/SaaS projects: the
# game-dev room becomes an app-dev room). Variant outputs carry a suffix: office-bg.app.png …
VARIANT = os.environ.get('OFFICE_VARIANT', 'game')
SUFFIX = '' if VARIANT == 'game' else f'.{VARIANT}'
CELL = 8
O = hx('3a2e3a')

# ------------------------------------------------------------------ layout
TOP = (24, 151)
MID = (172, 311)
BOT = (332, 473)
ROOMS = {
    'product': (6, TOP[0], 151, TOP[1]),
    'gamedev': (158, TOP[0], 304, TOP[1]),
    'design': (311, TOP[0], 456, TOP[1]),
    'research': (463, TOP[0], 609, TOP[1]),
    'development': (616, TOP[0], 761, TOP[1]),
    'marketing': (6, MID[0], 183, MID[1]),
    'lounge': (190, MID[0], 577, MID[1]),
    'testing': (584, MID[0], 761, MID[1]),
    'meeting': (6, BOT[0], 247, BOT[1]),
    'terrace': (254, BOT[0], 495, BOT[1]),
    'garden': (496, BOT[0], 761, BOT[1]),
}
LABELS = [
    ('product', '제품', 10, 7), ('gamedev', '게임 개발' if VARIANT == 'game' else '앱 개발', 162, 7), ('design', '디자인', 315, 7),
    ('research', '리서치', 467, 7), ('development', '엔지니어링', 620, 7),
    ('marketing', '마케팅', 10, 158), ('lounge', '휴게실', 518, 290), ('testing', '테스트', 588, 158),
    ('meeting', '회의실', 10, 318), ('garden', '가든', 650, 318),
]
H_WALLS = [  # (cap_y, [door gaps x0..x1])
    (152, [(70, 101), (200, 231), (368, 399), (520, 551), (720, 751)]),
    (312, [(30, 61), (200, 231), (254, 577), (700, 731)]),
]
V_WALLS = [  # (x, y0, y1, [door gaps y0..y1], style)
    (152, 0, 155, [], 'wall'), (305, 0, 155, [], 'wall'), (457, 0, 155, [], 'wall'), (610, 0, 155, [], 'wall'),
    (184, 152, 315, [(280, 303)], 'wall'), (578, 152, 315, [(280, 303)], 'wall'),
    (248, 312, 479, [], 'wall'),
]
ENTRANCE = (360, 391)

# palette
WALL = hx('efe6d4'); WALL_D = hx('ddd0b8'); BASE = hx('a98b6d'); BASE_D = hx('84684f')
CAP = hx('5f4f4a'); CAP_L = hx('7b6a62')
GLASS = hx('bfe6f5'); GLASS_L = hx('e6f7fd')

FLOORS = {
    'product': ('wood', hx('d9a066'), hx('c48a52'), hx('e8b47c')),
    'gamedev': ('carpet', hx('6c6aa8'), hx('5d5b97'), hx('7d7bb8')) if VARIANT == 'game' else ('tile', hx('d3e6e4'), hx('bcd6d3'), hx('e2efed')),
    'design': ('tile', hx('f5d9df'), hx('e8c2ca'), hx('fbe7eb')),
    'research': ('wood', hx('caa274'), hx('b38a5e'), hx('dcb689')),
    'development': ('tile', hx('cfd6df'), hx('b8c1cc'), hx('dde3ea')),
    'marketing': ('wood', hx('e0aa70'), hx('c99158'), hx('efbf88')),
    'lounge': ('herring', hx('e7c99a'), hx('d4b07c'), hx('f1d9b0')),
    'testing': ('tile', hx('d9e7dc'), hx('c3d6c8'), hx('e6f0e8')),
    'meeting': ('carpet', hx('5f86b8'), hx('5378a8'), hx('6f95c4')),
    'terrace': ('herring', hx('e7c99a'), hx('d4b07c'), hx('f1d9b0')),
    'garden': ('grass', hx('7cc35f'), hx('68ad50'), hx('93d675')),
}


# ------------------------------------------------------------------ floors
def floor(c, rid):
    x0, y0, x1, y1 = ROOMS[rid]
    kind, base, dark, light = FLOORS[rid]
    rnd = random.Random(hash(rid) & 0xffff)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            col = base
            if kind == 'wood':
                row = (y - y0) // 6
                if (y - y0) % 6 == 0:
                    col = dark
                elif ((x - x0) + row * 21) % 42 == 0:
                    col = dark
                elif (y - y0) % 6 == 1 and ((x - x0) + row * 7) % 13 < 3:
                    col = light
            elif kind == 'tile':
                if (x - x0) % 16 == 0 or (y - y0) % 16 == 0:
                    col = dark
                elif (x - x0) % 16 == 1 or (y - y0) % 16 == 1:
                    col = light
            elif kind == 'carpet':
                r = rnd.random()
                col = dark if r < .10 else (light if r < .16 else base)
            elif kind == 'herring':
                bx, by = (x - x0), (y - y0)
                blk = ((bx // 8) + (by // 8)) % 2
                if blk == 0:
                    col = dark if bx % 8 == 0 or by % 4 == 0 else base
                else:
                    col = dark if by % 8 == 0 or bx % 4 == 0 else light
            elif kind == 'marble':
                if ((x - x0) // 16 + (y - y0) // 16) % 2:
                    col = light
                if (x - x0) % 16 == 0 or (y - y0) % 16 == 0:
                    col = dark
            elif kind == 'grass':
                r = rnd.random()
                col = dark if r < .12 else (light if r < .2 else base)
            c.p(x, y, col)
    if kind == 'grass':
        for _ in range(140):
            x = rnd.randint(x0, x1); y = rnd.randint(y0 + 2, y1)
            c.p(x, y, dark); c.p(x, y - 1, dark); c.p(x + 1, y - 2, light)


# ------------------------------------------------------------------ walls
def wall_face(c, x0, x1, ytop, h=16, exterior_from=None):
    """Front face of a wall between ytop..ytop+h-1 with baseboard."""
    for x in range(x0, x1 + 1):
        exterior = exterior_from is not None and x >= exterior_from
        for y in range(ytop, ytop + h):
            if exterior:
                by = (y - ytop) // 4
                col = hx('c7826a') if ((x + (by % 2) * 4) % 8 == 0 or (y - ytop) % 4 == 0) else hx('d99a7f')
                if (y - ytop) % 4 == 0:
                    col = hx('b8735c')
            else:
                col = WALL
                if (x - x0) % 32 == 0:
                    col = WALL_D
            c.p(x, y, col)
        c.p(x, ytop + h - 3, BASE if not exterior else hx('9b6250'))
        c.p(x, ytop + h - 2, BASE)
        c.p(x, ytop + h - 1, BASE_D)


def wall_cap(c, x0, y0, x1, y1):
    c.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, CAP)
    c.hline(x0, y0, x1 - x0 + 1, CAP_L)


def draw_walls(c, blocked):
    # outer top wall
    wall_cap(c, 0, 0, W - 1, 3)
    wall_face(c, 0, W - 1, 4, 20)
    mark(blocked, 0, 0, W, 24)
    # horizontal dividers
    for cap_y, gaps in H_WALLS:
        segs = []
        x = 0
        for g0, g1 in gaps:
            segs.append((x, g0 - 1)); x = g1 + 1
        segs.append((x, W - 1))
        for s0, s1 in segs:
            wall_cap(c, s0, cap_y, s1, cap_y + 3)
            wall_face(c, s0, s1, cap_y + 4, 16, exterior_from=502 if cap_y == 312 else None)
            mark(blocked, s0, cap_y, s1 - s0 + 1, 20)
        for g0, g1 in gaps:
            # threshold + door frame posts
            if g1 - g0 < 64:
                c.rect(g0, cap_y + 17, g1 - g0 + 1, 3, hx('b89a7a'))
                c.hline(g0, cap_y + 17, g1 - g0 + 1, hx('d8c3a5'))
            for px_ in (g0 - 2, g1 + 1):
                c.rect(px_, cap_y, 2, 20, CAP); c.vline(px_, cap_y, 20, CAP_L)
    # vertical walls
    for x, y0, y1, gaps, style in V_WALLS:
        segs = []
        y = y0
        for g0, g1 in gaps:
            segs.append((y, g0 - 1)); y = g1 + 1
        segs.append((y, y1))
        for s0, s1 in segs:
            if style == 'glass':
                c.rect(x, s0, 6, s1 - s0 + 1, GLASS)
                c.vline(x, s0, s1 - s0 + 1, CAP); c.vline(x + 5, s0, s1 - s0 + 1, CAP)
                for yy in range(s0, s1, 8):
                    c.p(x + 2, yy + 2, GLASS_L); c.p(x + 3, yy + 3, GLASS_L)
                for yy in range(s0, s1, 24):
                    c.hline(x, yy, 6, CAP)
            else:
                wall_cap(c, x, s0, x + 5, s1)
                c.vline(x, s0, s1 - s0 + 1, CAP_L)
            mark(blocked, x, s0, 6, s1 - s0 + 1)
        for g0, g1 in gaps:
            c.rect(x, g0 - 2, 6, 2, CAP); c.rect(x, g1 + 1, 6, 2, CAP)
    # outer side + bottom walls
    for x in (0, W - 6):
        wall_cap(c, x, 0, x + 5, H - 1); mark(blocked, x, 0, 6, H)
    for s0, s1 in ((0, ENTRANCE[0] - 1), (ENTRANCE[1] + 1, W - 1)):
        wall_cap(c, s0, 474, s1, 479); mark(blocked, s0, 474, s1 - s0 + 1, 6)
    # entrance sliding doors (open)
    c.rect(ENTRANCE[0] - 6, 474, 6, 6, GLASS); c.rect(ENTRANCE[1] + 1, 474, 6, 6, GLASS)
    c.frame(ENTRANCE[0] - 6, 474, 6, 6, CAP); c.frame(ENTRANCE[1] + 1, 474, 6, 6, CAP)


# ------------------------------------------------------------------ wall decor
def window(c, x, y, w=30, h=13):
    c.rect(x, y, w, h, hx('8a7464')); c.rect(x + 2, y + 2, w - 4, h - 4, hx('a9dcf2'))
    c.vline(x + w // 2, y + 2, h - 4, hx('8a7464'))
    c.hline(x + 3, y + 3, 4, hx('e6f7fd')); c.hline(x + w // 2 + 2, y + 3, 3, hx('e6f7fd'))
    c.rect(x + 2, y + h - 5, w - 4, 3, hx('bfe8d0'))  # distant trees
    c.hline(x - 1, y + h, w + 2, hx('c9b79e'))


def board(c, x, y, w, h, kind):
    c.rect(x, y, w, h, hx('f9f9f6')); c.frame(x, y, w, h, hx('8f8f99'))
    rnd = random.Random(x * 7 + y)
    cols = [hx('f4c64e'), hx('f39ab8'), hx('8fd8ff'), hx('9fe0b4'), hx('f6a86b')]
    if kind == 'kanban':
        for k in range(3):
            c.vline(x + 1 + (k + 1) * (w - 2) // 3, y + 1, h - 2, hx('d8d8e0'))
            for n in range(rnd.randint(2, 3)):
                c.rect(x + 3 + k * (w - 2) // 3, y + 2 + n * 4, 5, 3, rnd.choice(cols))
    elif kind == 'chart':
        for i, hh in enumerate([3, 6, 4, 8, 7]):
            c.rect(x + 3 + i * 5, y + h - 2 - hh, 3, hh, [hx('5b8def'), hx('f08a4b'), hx('62c48a'), hx('9b72e0'), hx('e45b5b')][i])
        c.hline(x + 2, y + h - 2, w - 4, hx('9aa3b5'))
    elif kind == 'qa':
        for i in range(3):
            c.rect(x + 3, y + 2 + i * 4, 2, 2, hx('62c48a')); c.hline(x + 7, y + 3 + i * 4, w - 12, hx('9aa3b5'))
    elif kind == 'palette':
        for i, col in enumerate(cols):
            c.rect(x + 3 + i * 5, y + 3, 4, h - 6, col)
    elif kind == 'map':
        c.rect(x + 1, y + 1, w - 2, h - 2, hx('a9dcf2'))
        for (a, b, ww, hh) in [(4, 3, 7, 4), (14, 5, 6, 5), (22, 2, 5, 3), (8, 8, 4, 2)]:
            if x + a + ww < x + w:
                c.rect(x + a, y + b, ww, hh, hx('7cc35f'))
    elif kind == 'status':
        c.rect(x + 1, y + 1, w - 2, h - 2, hx('243150'))
        for i in range(3):
            c.hline(x + 3, y + 3 + i * 3, w - 14, [hx('4fc1b0'), hx('f4c64e'), hx('8fd8ff')][i])
            c.p(x + w - 6, y + 3 + i * 3, hx('62c48a'))


def poster(c, x, y, kind):
    if kind == 'game':
        c.rect(x, y, 12, 14, hx('2b1e4a')); c.frame(x, y, 12, 14, O)
        c.rect(x + 3, y + 5, 6, 3, hx('9b72e0')); c.p(x + 4, y + 6, hx('f4c64e')); c.p(x + 7, y + 6, hx('e45b5b'))
    elif kind == 'idea':
        c.rect(x, y, 12, 14, hx('fff3c4')); c.frame(x, y, 12, 14, O)
        c.ellipse(x + 6, y + 6, 3, 3, hx('f4c64e')); c.rect(x + 5, y + 9, 3, 2, hx('9aa3b5'))
    elif kind == 'heart':
        c.rect(x, y, 12, 14, hx('ffe6f0')); c.frame(x, y, 12, 14, O)
        for (a, b) in [(4, 5), (7, 5), (3, 6), (4, 6), (5, 6), (6, 6), (7, 6), (8, 6), (4, 7), (5, 7), (6, 7), (7, 7), (5, 8), (6, 8)]:
            c.p(x + a, y + b, hx('e45b5b'))


def clock(c, x, y):
    c.ellipse(x, y, 4, 4, O); c.ellipse(x, y, 3, 3, hx('ffffff'))
    c.vline(x, y - 2, 3, O); c.hline(x, y, 2, O)


def shelf_plants(c, x, y, w):
    c.rect(x, y + 8, w, 2, hx('a8713f'))
    for i in range(0, w - 4, 7):
        c.rect(x + i + 1, y + 5, 4, 3, hx('c96a48'))
        c.rect(x + i, y + 2, 6, 3, hx('5fb35a')); c.p(x + i + 2, y + 1, hx('93d778'))


def tv(c, x, y, w, h):
    c.rect(x, y, w, h, hx('22263a')); c.frame(x, y, w, h, O)
    c.rect(x + 2, y + 2, w - 4, h - 4, hx('2f4a7a'))
    c.rect(x + 5, y + 4, 18, 2, hx('ffffff')); c.rect(x + 5, y + 7, 30, 1, hx('8fd8ff'))
    for i, hh in enumerate([2, 4, 3, 5]):
        c.rect(x + w - 26 + i * 5, y + h - 3 - hh, 3, hh, [hx('f4c64e'), hx('62c48a'), hx('f39ab8'), hx('8fd8ff')][i])


def logo(c, x, y):
    c.rect(x, y, 86, 14, hx('ffffff')); c.frame(x, y, 86, 14, hx('c9cfdb'))
    c.rect(x + 4, y + 3, 8, 8, hx('3f69c2')); c.rect(x + 7, y + 6, 4, 4, hx('8fd8ff')); c.rect(x + 5, y + 4, 4, 4, hx('ffffff'))
    # pixel wordmark "AGENT DECK" (3x5 font)
    font = {
        'A': ['010', '101', '111', '101', '101'], 'G': ['011', '100', '101', '101', '011'],
        'E': ['111', '100', '110', '100', '111'], 'N': ['101', '111', '111', '111', '101'],
        'T': ['111', '010', '010', '010', '010'], 'D': ['110', '101', '101', '101', '110'],
        'C': ['011', '100', '100', '100', '011'], 'K': ['101', '110', '100', '110', '101'], ' ': ['000'] * 5,
    }
    cx = x + 16
    for ch in 'AGENT DECK':
        g = font[ch]
        for r, row in enumerate(g):
            for k, bit in enumerate(row):
                if bit == '1':
                    c.p(cx + k, y + 5 + r, hx('2f3448'))
        cx += 4 if ch != ' ' else 3


def ivy(c, x0, x1, y):
    rnd = random.Random(9)
    for x in range(x0, x1, 3):
        for k in range(rnd.randint(1, 8)):
            c.p(x + rnd.randint(-1, 1), y + k, hx('4f9a4a') if k % 2 else hx('6fbf5e'))


def wall_decor(c):
    # top band (face y 4..23)
    face = 6
    rooms = ['product', 'gamedev', 'design', 'research', 'development']
    kinds = {'product': 'kanban', 'gamedev': None if VARIANT == 'game' else 'status', 'design': 'palette', 'research': 'map', 'development': 'status'}
    for rid in rooms:
        x0, _, x1, _ = ROOMS[rid]
        window(c, x1 - 40, face)
        k = kinds[rid]
        if k:
            board(c, x0 + 52, face, 34, 14, k)
        else:
            poster(c, x0 + 56, face, 'game'); poster(c, x0 + 72, face, 'heart')
        c.rect(x0 + 1, 4, 1, 17, WALL_D)
    clock(c, 30, 13)
    # middle band (face 156..171)
    board(c, 112, 157, 40, 12, 'chart'); poster(c, 158, 157, 'idea')
    board(c, 600, 157, 40, 12, 'qa'); clock(c, 660, 163)
    # bottom band (face 316..331)
    tv(c, 80, 317, 92, 13)
    window(c, 640, 317, 34, 12)
    ivy(c, 580, 698, 316); ivy(c, 734, 760, 316)


# ------------------------------------------------------------------ helpers
blocked_px = None


def mark(blocked, x, y, w, h):
    for yy in range(max(0, y), min(H, y + h)):
        for xx in range(max(0, x), min(W, x + w)):
            blocked[yy][xx] = True


def rug(c, x, y, w, h, base, border):
    c.rect(x, y, w, h, border)
    c.rect(x + 3, y + 3, w - 6, h - 6, base)
    for xx in range(x + 6, x + w - 6, 6):
        c.p(xx, y + 5, border); c.p(xx, y + h - 6, border)
    for (cx, cy) in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
        c.px[cx, cy] = c.px[cx, cy]


# ------------------------------------------------------------------ build
def main():
    os.makedirs(os.path.join(OUT, 'characters'), exist_ok=True)
    bg = Canvas(W, H)
    blocked = [[False] * W for _ in range(H)]
    # everything outside rooms starts blocked; floors open it
    for rid in ROOMS:
        floor(bg, rid)
    # gaps get the floor of the room below / left
    for cap_y, gaps in H_WALLS:
        below = MID if cap_y == 152 else BOT
        for g0, g1 in gaps:
            # Wide openings may span both the lounge terrace and garden.
            for xx in range(g0, g1 + 1):
                rid = next(r for r, (a, b, cc, d) in ROOMS.items() if b == below[0] and a <= xx <= cc)
                bg.rect(xx, cap_y, 1, 20, FLOORS[rid][1])
    for x, y0, y1, gaps, _ in V_WALLS:
        for g0, g1 in gaps:
            bg.rect(x, g0, 6, g1 - g0 + 1, FLOORS['lounge'][1])
    bg.rect(ENTRANCE[0], 474, ENTRANCE[1] - ENTRANCE[0] + 1, 6, FLOORS['terrace'][1])
    draw_walls(bg, blocked)
    wall_decor(bg)

    placements = []   # (key, builder, args, x, y)
    waypoints = {}
    chairs = []

    def put(key, builder, x, y, *args):
        placements.append((key, builder, args, x, y))

    def chair(x, y, col='blue'):
        chairs.append((x, y, col))

    # ---------------- top rooms: 2 rows x 3 slots
    room_plan = {
        'product': (['single', 'chart', None, 'single', 'laptop', None], ['bookshelf', 'plant+filing']),
        'gamedev': (['game', 'game', None, 'dual', 'game', None], ['arcade', 'beanbag']) if VARIANT == 'game'
        else (['laptop', 'single', None, 'dual', 'laptop', None], ['plant+filing', 'server+plant']),
        'design': (['art', 'art', 'art', 'laptop', 'art', None], ['easel']),
        'research': (['books', 'chart', None, 'books', 'single', None], ['bookshelf', 'globe']),
        'development': (['dual', 'dual', None, 'dual', 'dual', None], ['servers', 'server+plant']),
    }
    wp_prefix = {'product': 'product', 'gamedev': 'gamedev', 'design': 'design', 'research': 'research', 'development': 'development'}
    for rid, (slots, decor) in room_plan.items():
        x0 = ROOMS[rid][0]
        n = 0
        dec_iter = iter(decor)
        for i, kind in enumerate(slots):
            dx = x0 + [12, 57, 102][i % 3]
            rt = 30 if i < 3 else 84
            if kind:
                put(f'desk:{kind}', P.desk, dx, rt, kind)
                chair(dx + 9, rt + 31, 'pink' if rid == 'design' else ('purple' if rid == 'gamedev' and VARIANT == 'game' else 'blue'))
                n += 1
                waypoints[f'{wp_prefix[rid]}.desk.{n}'] = dict(x=dx + 8, y=rt + 39, pose='sit', face='up')
            else:
                d = next(dec_iter)
                if d == 'bookshelf':
                    put('bookshelf', P.bookshelf, dx + 2, rt + 2, x0)
                elif d == 'plant+filing':
                    put('plant:large', P.plant, dx + 14, rt + 10, 'large', x0)
                    put('filing', P.filing, dx, rt + 14)
                elif d == 'arcade':
                    put('arcade', P.arcade, dx + 6, rt)
                elif d == 'beanbag':
                    put('bean_bag:purple', P.bean_bag, dx, rt + 20, hx('9b72e0'), hx('7d55c4'))
                    put('plant:small', P.plant, dx + 20, rt + 16, 'small', 11)
                elif d == 'easel':
                    put('easel', P.easel, dx + 4, rt + 6)
                elif d == 'globe':
                    put('globe', P.globe, dx + 2, rt + 14)
                    put('plant:large', P.plant, dx + 16, rt + 10, 'large', x0)
                elif d == 'servers':
                    put('server', P.server_rack, dx - 2, rt - 2, 1); put('server', P.server_rack, dx + 16, rt - 2, 1)
                elif d == 'server+plant':
                    put('server', P.server_rack, dx - 2, rt - 2, 1); put('plant:small', P.plant, dx + 18, rt + 16, 'small', 11)
        # corner plant near the wall
        put('plant:small', P.plant, ROOMS[rid][2] - 14, 26, 'small', 11)

    # ---------------- marketing
    mk = ROOMS['marketing']
    n = 0
    for (dx, rt, kind) in [(110, 180, 'chart'), (146, 180, 'laptop'), (110, 236, 'single'), (146, 236, 'chart')]:
        put(f'desk:{kind}', P.desk, dx, rt, kind)
        chair(dx + 9, rt + 31, 'orange')
        n += 1
        waypoints[f'marketing.desk.{n}'] = dict(x=dx + 8, y=rt + 39, pose='sit', face='up')
    put('printer', P.printer, 12, 176)
    put('easel', P.easel, 40, 214)
    put('plant:large', P.plant, 10, 262, 'large', 5)
    put('plant:small', P.plant, 88, 290, 'small', 11)

    # ---------------- testing
    n = 0
    for (dx, rt, kind) in [(596, 180, 'check'), (638, 180, 'check'), (680, 180, 'dual'), (596, 236, 'check'), (638, 236, 'laptop')]:
        put(f'desk:{kind}', P.desk, dx, rt, kind)
        chair(dx + 9, rt + 31, 'green')
        n += 1
        waypoints[f'testing.desk.{n}'] = dict(x=dx + 8, y=rt + 39, pose='sit', face='up')
    put('device_rack', P.device_rack, 682, 236)
    put('robot', P.robot, 724, 250)
    put('plant:large', P.plant, 742, 182, 'large', 7)

    # ---------------- lounge
    put('counter', P.counter, 240, 158)
    for i in range(5):
        bg.blit(P.stool(), 252 + i * 16, 196)
    put('vending', P.vending, 408, 154)
    put('bookshelf', P.bookshelf, 436, 150, 77)
    put('water_cooler', P.water_cooler, 470, 162)
    put('plant:tall', P.plant, 492, 150, 'tall', 3)
    put('plant:large', P.plant, 556, 160, 'large', 9)
    put('plant:tall', P.plant, 196, 212, 'tall', 21)
    rug(bg, 262, 212, 208, 88, hx('8aa7e6'), hx('6f8fd6'))
    put('sofa', P.sofa, 329, 210)
    put('coffee_table', P.coffee_table, 344, 250)
    put('armchair:pink', P.armchair, 300, 232)
    put('armchair:blue', P.armchair, 408, 232, hx('6aa0f0'), hx('3f69c2'))
    put('bean_bag:pink', P.bean_bag, 478, 272, hx('f39ab8'), hx('d76d93'))
    put('bean_bag:blue', P.bean_bag, 462, 252, hx('6aa0f0'), hx('3f69c2'))
    put('plant:small', P.plant, 546, 290, 'small', 11)
    for i, x in enumerate([341, 355, 369, 383]):
        waypoints[f'lounge.sofa.{i + 1}'] = dict(x=x, y=236, pose='sit', face='down')
    waypoints['lounge.armchair.1'] = dict(x=310, y=250, pose='sit', face='right')
    waypoints['lounge.armchair.2'] = dict(x=418, y=250, pose='sit', face='left')
    waypoints['lounge.coffee.1'] = dict(x=272, y=208, pose='stand', face='up')
    waypoints['lounge.coffee.2'] = dict(x=419, y=204, pose='stand', face='up')
    waypoints['lounge.bookshelf.1'] = dict(x=450, y=200, pose='stand', face='up')
    stands = [(282, 222, 'right'), (448, 226, 'left'), (300, 300, 'up'), (432, 298, 'up'), (240, 250, 'right'), (552, 280, 'left')]
    for i, (x, y, f) in enumerate(stands):
        waypoints[f'lounge.stand.{i + 1}'] = dict(x=x, y=y, pose='stand', face=f)
    put('cafe_table', P.cafe_table, 506, 222)
    waypoints['lounge.talk.1'] = dict(x=500, y=240, pose='stand', face='right')
    waypoints['lounge.talk.2'] = dict(x=534, y=240, pose='stand', face='left')

    # ---------------- meeting
    put('meeting_table', P.meeting_table, 54, 372)
    for i, x in enumerate([84, 124, 164]):
        chair(x - 7, 356, 'navy')
        chair(x - 7, 418, 'navy')
    chair(31, 390, 'navy'); chair(203, 390, 'navy')
    waypoints['meeting.seat.1'] = dict(x=38, y=402, pose='sit', face='right')
    waypoints['meeting.seat.2'] = dict(x=84, y=376, pose='sit', face='down')
    waypoints['meeting.seat.3'] = dict(x=124, y=376, pose='sit', face='down')
    waypoints['meeting.seat.4'] = dict(x=210, y=402, pose='sit', face='left')
    waypoints['meeting.seat.5'] = dict(x=84, y=430, pose='sit', face='up')
    waypoints['meeting.seat.6'] = dict(x=124, y=430, pose='sit', face='up')
    waypoints['meeting.seat.7'] = dict(x=164, y=430, pose='sit', face='up')
    waypoints['meeting.seat.8'] = dict(x=164, y=376, pose='sit', face='down')
    put('plant:large', P.plant, 10, 446, 'large', 13)
    put('plant:large', P.plant, 226, 446, 'large', 14)
    put('water_cooler', P.water_cooler, 228, 340)

    # ---------------- open lounge terrace (formerly reception)
    put('sofa_small:blue', P.lounge_sofa_small, 430, 420, hx('6aa0f0'), hx('3f69c2'))
    put('plant:large', P.plant, 474, 430, 'large', 15)
    put('plant:large', P.plant, 258, 440, 'large', 16)
    put('plant:tall', P.plant, 470, 336, 'tall', 17)
    rug(bg, 352, 452, 48, 20, hx('d9534f'), hx('b33f3c'))
    rug(bg, 418, 410, 68, 44, hx('f1d9b0'), hx('d4b07c'))

    # ---------------- garden
    g = ROOMS['garden']
    rnd = random.Random(42)
    # Stone path leads directly from the open lounge terrace into the garden.
    for x in range(496, 724, 9):
        for k in range(2):
            yy = 408 + k * 8 + rnd.randint(0, 1)
            bg.ellipse(x + 4, yy + 3, 3, 2, hx('cfc8bb')); bg.p(x + 3, yy + 2, hx('e8e2d6'))
    for y in range(334, 408, 9):
        for k in range(2):
            xx = 704 + k * 13 + rnd.randint(0, 1)
            bg.ellipse(xx + 4, y + 3, 3, 2, hx('cfc8bb')); bg.p(xx + 3, y + 2, hx('e8e2d6'))
    # pond
    bg.ellipse(600, 452, 36, 15, hx('5aa0c8')); bg.ellipse(600, 451, 33, 12, hx('7cc4e6'))
    bg.ellipse(590, 447, 6, 2, hx('bfe6f5')); bg.ellipse(612, 456, 4, 2, hx('5fb35a')); bg.p(612, 455, hx('f39ab8'))
    for a in range(0, 360, 20):
        import math
        x = int(600 + 37 * math.cos(math.radians(a))); y = int(452 + 16 * math.sin(math.radians(a)))
        bg.rect(x - 1, y - 1, 3, 2, hx('a9a29a'))
    mark(blocked, 564, 438, 74, 30)
    # flowers
    for _ in range(70):
        x = rnd.randint(g[0] + 4, g[2] - 4); y = rnd.randint(g[1] + 4, g[3] - 4)
        if 404 <= y <= 426 or (700 <= x <= 734):
            continue
        bg.p(x, y, rnd.choice([hx('f39ab8'), hx('f4c64e'), hx('ffffff'), hx('e45b5b'), hx('b896f0')])); bg.p(x, y + 1, hx('3c8a46'))
    put('tree', P.tree, 506, 336, 3)
    put('tree', P.tree, 630, 336, 5)
    put('tree', P.tree, 718, 412, 8)
    put('bench', P.bench, 560, 360)
    waypoints['lounge.stand.7'] = dict(x=579, y=374, pose='sit', face='down')
    waypoints['lounge.stand.8'] = dict(x=560, y=432, pose='stand', face='right')
    waypoints['lounge.stand.9'] = dict(x=660, y=444, pose='stand', face='left')
    put('lamp', P.lamp_post, 540, 372)
    put('lamp', P.lamp_post, 684, 372)
    put('sign', P.signboard, 524, 428)
    for (x, y, s) in [(506, 446, 1), (528, 456, 2), (668, 456, 3), (740, 338, 4)]:
        put(f'bush:{s}', P.bush, x, y, s)

    # ---------------- chairs → background
    chair_cols = {
        'blue': (hx('5b8def'), hx('3f69c2')), 'pink': (hx('f39ab8'), hx('d76d93')),
        'purple': (hx('9b72e0'), hx('7d55c4')), 'orange': (hx('f08a4b'), hx('c96a30')),
        'green': (hx('4fbf86'), hx('35996a')), 'navy': (hx('3f5f99'), hx('2f4a7a')),
    }
    for (x, y, col) in chairs:
        bg.blit(P.office_chair(*chair_cols[col]), x, y)

    # ---------------- props atlas
    cache = {}
    prop_list = []
    for key, builder, args, x, y in placements:
        if key not in cache:
            cache[key] = builder(*args)
        img, fp, sort_y = cache[key]
        mark(blocked, x + fp[0], y + fp[1], fp[2], fp[3])
        prop_list.append(dict(key=key, x=x, y=y, z=y + sort_y))
    # shelf-pack unique sprites
    atlas_w = 512
    order = sorted(cache.keys(), key=lambda k: -cache[k][0].h)
    pos = {}
    cx = cy = row_h = 0
    for k in order:
        im = cache[k][0]
        if cx + im.w > atlas_w:
            cx = 0; cy += row_h + 1; row_h = 0
        pos[k] = (cx, cy)
        cx += im.w + 1
        row_h = max(row_h, im.h)
    atlas = Canvas(atlas_w, cy + row_h + 1)
    for k, (x, y) in pos.items():
        atlas.blit(cache[k][0], x, y)
    atlas.img.save(os.path.join(OUT, f'props{SUFFIX}.png'))
    for pr in prop_list:
        sx, sy = pos[pr['key']]
        im = cache[pr['key']][0]
        pr.update(sx=sx, sy=sy, w=im.w, h=im.h)

    bg.img.save(os.path.join(OUT, f'office-bg{SUFFIX}.png'))

    # ---------------- walk grid
    cols, rows = W // CELL, H // CELL
    grid = []
    for r in range(rows):
        line = []
        for cc in range(cols):
            cnt = 0
            for yy in range(r * CELL + 2, r * CELL + 6):
                for xx in range(cc * CELL + 2, cc * CELL + 6):
                    cnt += blocked[yy][xx]
            line.append('1' if cnt >= 4 else '0')
        grid.append(''.join(line))

    spawn = dict(x=376, y=470)
    lobby = [dict(x=x, y=y) for (x, y) in [(392, 360), (416, 362), (440, 366), (464, 370), (380, 420), (404, 430)]]

    # connectivity check
    def cell_of(x, y):
        return min(cols - 1, max(0, x // CELL)), min(rows - 1, max(0, y // CELL))
    seen = set()
    s = cell_of(spawn['x'], spawn['y'] - 2)
    dq = deque([s]); seen.add(s)
    while dq:
        cx_, cy_ = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx_ + dx, cy_ + dy
            if 0 <= nx < cols and 0 <= ny < rows and (nx, ny) not in seen and grid[ny][nx] == '0':
                seen.add((nx, ny)); dq.append((nx, ny))
    problems = []
    open_count = sum(row.count('0') for row in grid)
    if len(seen) != open_count:
        problems.append(f'disconnected walk cells: {open_count - len(seen)}')
    for x, y in [(376, 314), (376, 330), (492, 410), (500, 410), (516, 410)]:
        if cell_of(x, y - 2) not in seen:
            problems.append(f'lounge/garden connection at {x},{y}')
    for wid, wp in {**waypoints, **{f'lobby.{i}': dict(x=p['x'], y=p['y']) for i, p in enumerate(lobby)}}.items():
        c0 = cell_of(wp['x'], wp['y'] - 2)
        near = [c0] + [(c0[0] + dx, c0[1] + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
        if not any(n in seen for n in near):
            problems.append(wid)

    required = [f'lounge.sofa.{i}' for i in range(1, 5)] + ['lounge.armchair.1', 'lounge.armchair.2', 'lounge.coffee.1', 'lounge.coffee.2', 'lounge.bookshelf.1'] \
        + [f'lounge.stand.{i}' for i in range(1, 10)] + ['lounge.talk.1', 'lounge.talk.2'] + [f'meeting.seat.{i}' for i in range(1, 9)] \
        + [f'testing.desk.{i}' for i in range(1, 6)] + [f'product.desk.{i}' for i in range(1, 5)] + [f'design.desk.{i}' for i in range(1, 6)] \
        + [f'development.desk.{i}' for i in range(1, 5)] + [f'gamedev.desk.{i}' for i in range(1, 5)] + [f'research.desk.{i}' for i in range(1, 5)] \
        + [f'marketing.desk.{i}' for i in range(1, 5)]
    missing = [r for r in required if r not in waypoints]

    office = dict(
        width=W, height=H, cell=CELL, cols=cols, rows=rows, grid=grid,
        waypoints=waypoints, spawn=spawn, lobby=lobby,
        labels=[dict(id=i, text=t, x=x, y=y) for (i, t, x, y) in LABELS],
        rooms={k: dict(x0=v[0], y0=v[1], x1=v[2], y1=v[3]) for k, v in ROOMS.items()},
        props=prop_list,
    )
    with open(os.path.join(OUT, f'office-map{SUFFIX}.json'), 'w') as f:
        json.dump(office, f, separators=(',', ':'), ensure_ascii=False)
    if VARIANT != 'game':
        return  # characters/bubbles are shared with the default layout

    # ---------------- characters
    cdir = os.path.join(OUT, 'characters')
    for name, col in CH.SKINS:
        CH.build_atlas(CH.draw_skin, col).img.save(os.path.join(cdir, f'skin-{name}.png'))
    for role in CH.ROLES:
        CH.build_atlas(CH.draw_outfit, role).img.save(os.path.join(cdir, f'outfit-{role}.png'))
    for style in CH.HAIR_STYLES:
        for cname, col in CH.HAIR_COLORS:
            CH.build_atlas(CH.draw_hair, style, col).img.save(os.path.join(cdir, f'hair-{style}-{cname}.png'))
    for acc in sorted(set(CH.ACCESSORY.values())):
        CH.build_atlas(CH.draw_acc, acc).img.save(os.path.join(cdir, f'acc-{acc}.png'))
    with open(os.path.join(OUT, 'characters.json'), 'w') as f:
        json.dump(CH.manifest(), f, indent=1)

    build_bubbles()

    print(f'props: {len(prop_list)} placements, {len(cache)} unique sprites')
    print(f'waypoints: {len(waypoints)}  missing required: {missing}')
    print(f'walkable cells: {open_count}; connected: {len(seen)}')
    print(f'unreachable: {problems}')
    return 1 if (missing or problems) else 0


def build_bubbles():
    names = ['dots', 'alert', 'check', 'zzz', 'note', 'coffee', 'idea']
    c = Canvas(12 * len(names), 12)
    for i, n in enumerate(names):
        x = i * 12
        bgc = hx('ffffff') if n != 'alert' else hx('e45b5b')
        c.rect(x + 1, 0, 10, 8, bgc); c.frame(x + 1, 0, 10, 8, O)
        c.px[x + 1, 0] = (0, 0, 0, 0); c.px[x + 10, 0] = (0, 0, 0, 0); c.px[x + 1, 7] = (0, 0, 0, 0); c.px[x + 10, 7] = (0, 0, 0, 0)
        c.p(x + 4, 8, O); c.p(x + 5, 8, bgc); c.p(x + 5, 9, O); c.p(x + 4, 9, O)
        ink = hx('3a2e3a')
        if n == 'dots':
            for k in (3, 5, 7):
                c.p(x + k + 1, 4, ink)
        elif n == 'alert':
            c.vline(x + 6, 2, 3, hx('ffffff')); c.p(x + 6, 6, hx('ffffff'))
        elif n == 'check':
            for (a, b) in [(3, 4), (4, 5), (5, 4), (6, 3), (7, 2)]:
                c.p(x + a + 1, b, hx('2f9a5a'))
        elif n == 'zzz':
            c.hline(x + 3, 2, 3, ink); c.p(x + 4, 3, ink); c.hline(x + 3, 4, 3, ink); c.hline(x + 7, 4, 2, ink); c.p(x + 7, 5, ink); c.hline(x + 7, 6, 2, ink)
        elif n == 'note':
            c.vline(x + 7, 2, 4, ink); c.p(x + 8, 2, ink); c.rect(x + 5, 5, 2, 2, ink)
        elif n == 'coffee':
            c.rect(x + 4, 3, 4, 4, hx('b07040')); c.p(x + 8, 4, ink); c.p(x + 5, 2, hx('cfcfcf'))
        elif n == 'idea':
            c.rect(x + 5, 2, 3, 3, hx('f4c64e')); c.p(x + 6, 5, hx('9aa3b5'))
    c.img.save(os.path.join(OUT, 'bubbles.png'))
    with open(os.path.join(OUT, 'bubbles.json'), 'w') as f:
        json.dump({'size': 12, 'names': names}, f)


if __name__ == '__main__':
    sys.exit(main())
