"""Layered 24x32 office-worker sprites (chibi proportions: big head, short body).

Every layer atlas shares one frame layout so the client can stack
skin → outfit → hair → accessory with identical background-position.
Pixel size matches the 16px world tiles; the sprite is simply larger.
"""
from px import Canvas, hx

FW, FH = 24, 32
COLS = 4
ANIMS = [
    ('idle-down', 'down', 'stand', 2), ('idle-up', 'up', 'stand', 2),
    ('idle-left', 'left', 'stand', 2), ('idle-right', 'right', 'stand', 2),
    ('walk-down', 'down', 'walk', 4), ('walk-up', 'up', 'walk', 4),
    ('walk-left', 'left', 'walk', 4), ('walk-right', 'right', 'walk', 4),
    ('sit-down', 'down', 'sit', 2), ('sit-up', 'up', 'sit', 2),
    ('sit-left', 'left', 'sit', 2), ('sit-right', 'right', 'sit', 2),
]

O = hx('3a2e3a')
EYE = hx('2b2235')
EYE_HI = hx('ffffff')
BLUSH = hx('f4a3a3')
MOUTH = hx('b8544f')
CLEAR = (0, 0, 0, 0)


def shade(c, f):
    return (max(0, min(255, int(c[0] * f))), max(0, min(255, int(c[1] * f))), max(0, min(255, int(c[2] * f))), 255)


SKINS = [
    ('light', hx('f8d5b8')), ('tan', hx('e8b48c')), ('deep', hx('b8784f')),
]
HAIR_COLORS = [
    ('black', hx('2f2630')), ('espresso', hx('5a3a2c')), ('brown', hx('8a5a3a')),
    ('blond', hx('e6b44e')), ('ginger', hx('d4682f')), ('rose', hx('e98fb8')),
]
HAIR_STYLES = ['short', 'spiky', 'long', 'bun']

ROLES = {
    'pm': dict(shirt=hx('f4f4f2'), pants=hx('59627a'), shoes=hx('2e2633'), kind='vest', trim=hx('2f4a7a'), tie=hx('e45b5b')),
    'developer': dict(shirt=hx('5b8def'), pants=hx('3d5a8a'), shoes=hx('2e2633'), kind='hoodie', trim=hx('ffffff')),
    'game-developer': dict(shirt=hx('9b72e0'), pants=hx('3a3550'), shoes=hx('2e2633'), kind='hoodie', trim=hx('f4c64e')),
    'designer': dict(shirt=hx('f2837a'), pants=hx('c9a77c'), shoes=hx('f4f4f2'), kind='sweater', trim=hx('ffd1c9')),
    'researcher': dict(shirt=hx('f5f7fa'), pants=hx('4b5263'), shoes=hx('2e2633'), kind='coat', trim=hx('4fc1b0')),
    'marketer': dict(shirt=hx('f4a142'), pants=hx('2f3b5c'), shoes=hx('2e2633'), kind='jacket', trim=hx('ffe08a')),
    'qa': dict(shirt=hx('4fbf86'), pants=hx('b89b6a'), shoes=hx('2e2633'), kind='polo', trim=hx('ffffff')),
    'reviewer': dict(shirt=hx('3a4560'), pants=hx('3a4560'), shoes=hx('1f1a24'), kind='suit', trim=hx('f4f4f2'), tie=hx('d9534f')),
}
ACCESSORY = {
    'game-developer': 'headphones', 'researcher': 'glasses', 'reviewer': 'glasses',
    'marketer': 'headset', 'designer': 'beret',
}


def geo(direction, kind, f):
    """Shared body geometry for one frame (all layers read the same numbers)."""
    dy = 0
    if kind == 'walk' and f in (1, 3):
        dy = -1
    if kind == 'sit':
        dy = 3
    return dict(
        dir=direction, kind=kind, f=f, dy=dy,
        h=6 + dy,            # head skin top row (head is 11 rows tall)
        t=18 + dy,           # torso top
        tb=24 + dy,          # torso bottom (inclusive)
        blink=(kind in ('stand', 'sit') and f == 1 and direction != 'up'),
        type=(kind == 'sit' and direction == 'up' and f == 1),
        armL=1 if (kind == 'walk' and f == 1) else (-1 if (kind == 'walk' and f == 3) else 0),
        armR=1 if (kind == 'walk' and f == 3) else (-1 if (kind == 'walk' and f == 1) else 0),
        liftL=kind == 'walk' and f == 1,
        liftR=kind == 'walk' and f == 3,
        stride={0: 0, 1: 1, 2: 0, 3: -1}[f] if kind == 'walk' else 0,
    )


def _pen(c, ox, oy):
    P = lambda x, y, col: c.p(ox + x, oy + y, col)
    R = lambda x, y, w, hh, col: c.rect(ox + x, oy + y, w, hh, col)

    def clear(x, y):
        if 0 <= ox + x < c.w and 0 <= oy + y < c.h:
            c.px[ox + x, oy + y] = CLEAR
    return P, R, clear


# ---------------------------------------------------------------- skin
def draw_skin(c, ox, oy, g, skin):
    sk, sd = skin, shade(skin, 0.86)
    P, R, clear = _pen(c, ox, oy)
    h, t, d = g['h'], g['t'], g['dir']
    if d in ('down', 'up'):
        R(6, h, 12, 11, sk)
        for (x, y) in ((6, h), (7, h), (6, h + 1), (17, h), (16, h), (17, h + 1), (6, h + 10), (17, h + 10)):
            clear(x, y)
        P(7, h + 10, sd); P(16, h + 10, sd)
        R(5, h + 5, 1, 2, sd); R(18, h + 5, 1, 2, sd)          # ears
        R(10, h + 11, 4, 1, sd)                                # neck
        if d == 'down':
            for ex in (8, 14):
                if g['blink']:
                    R(ex, h + 7, 2, 1, EYE)
                else:
                    R(ex, h + 5, 2, 3, EYE); P(ex + 1, h + 5, EYE_HI)
            R(7, h + 8, 2, 1, BLUSH); R(15, h + 8, 2, 1, BLUSH)
            R(11, h + 9, 2, 1, MOUTH)
    else:  # left
        R(6, h, 11, 11, sk)
        for (x, y) in ((6, h), (7, h), (6, h + 1), (16, h), (15, h), (16, h + 1), (6, h + 10), (16, h + 10)):
            clear(x, y)
        P(5, h + 6, sk); P(5, h + 7, sd)                       # nose
        R(13, h + 5, 2, 2, sd)                                 # ear
        R(10, h + 11, 3, 1, sd)
        if g['blink']:
            R(8, h + 7, 2, 1, EYE)
        else:
            R(8, h + 5, 2, 3, EYE); P(8, h + 5, EYE_HI)
        R(8, h + 8, 2, 1, BLUSH)
        P(7, h + 9, MOUTH)
    # hands
    if g['kind'] == 'sit':
        if d == 'down':
            R(8, t + 6, 2, 1, sk); R(14, t + 6, 2, 1, sk)
        elif d == 'up':
            R(5, t + 4 - (1 if g['type'] else 0), 2, 2, sk); R(17, t + 4, 2, 2, sk)
        else:
            R(5, t + 6, 2, 2, sk)
    elif d in ('down', 'up'):
        R(5, t + 6 + g['armL'], 2, 2, sk); R(17, t + 6 + g['armR'], 2, 2, sk)
    else:
        R(10 - g['stride'] * 2, t + 6, 2, 2, sk)


# ---------------------------------------------------------------- outfit
def draw_outfit(c, ox, oy, g, role):
    spec = ROLES[role]
    sh, sd, sl = spec['shirt'], shade(spec['shirt'], 0.82), shade(spec['shirt'], 1.1)
    pa, pd = spec['pants'], shade(spec['pants'], 0.78)
    so, sod = spec['shoes'], shade(spec['shoes'], 0.75)
    trim = spec['trim']
    k = spec['kind']
    P, R, _ = _pen(c, ox, oy)
    t, tb, d, kind = g['t'], g['tb'], g['dir'], g['kind']
    sitting = kind == 'sit'
    if d in ('down', 'up'):
        tb_ = tb + (2 if sitting and d == 'up' else 0)
        R(7, t, 10, tb_ - t + 1, sh)
        R(7, t, 1, tb_ - t + 1, sd); R(16, t, 1, tb_ - t + 1, sd)
        R(8, t, 8, 1, sl)
        R(7, tb_, 10, 1, sd)
        # sleeves
        if sitting and d == 'up':
            R(5, t, 2, 4 - (1 if g['type'] else 0), sd); R(17, t, 2, 4, sd)
        elif sitting:
            R(5, t, 2, 5, sd); R(17, t, 2, 5, sd)
            R(7, t + 5, 2, 1, sd); R(15, t + 5, 2, 1, sd)
        else:
            R(5, t, 2, 6 + g['armL'], sd); R(17, t, 2, 6 + g['armR'], sd)
            R(5, t, 1, 6 + g['armL'], shade(spec['shirt'], .7)); R(18, t, 1, 6 + g['armR'], shade(spec['shirt'], .7))
        if d == 'down':
            n = tb - t + 1
            if k == 'vest':
                R(7, t, 3, n, trim); R(14, t, 3, n, trim)
                R(11, t, 2, 5, spec['tie']); R(11, t, 2, 1, shade(spec['tie'], .8))
            elif k == 'suit':
                R(10, t, 4, 3, trim); R(11, t, 2, 6, spec['tie']); P(9, t, trim); P(14, t, trim)
            elif k == 'hoodie':
                R(9, t, 6, 1, sd)
                R(10, t + 1, 1, 3, trim); R(13, t + 1, 1, 3, trim)
                R(9, t + 4, 6, 1, sd); R(9, t + 5, 1, 1, sd); R(14, t + 5, 1, 1, sd)
            elif k == 'coat':
                R(10, t, 4, n, trim); P(9, t, sd); P(14, t, sd); P(9, t + 1, sd); P(14, t + 1, sd)
                R(8, t + 4, 2, 1, sd); R(14, t + 4, 2, 1, sd)
            elif k == 'jacket':
                R(10, t, 4, n, trim); R(9, t, 1, 2, sd); R(14, t, 1, 2, sd)
            elif k == 'polo':
                R(9, t, 6, 1, trim); P(11, t + 1, trim); P(12, t + 1, trim); P(14, t + 3, hx('f4c64e'))
            elif k == 'sweater':
                R(8, t + 3, 8, 1, trim); R(8, t + 5, 8, 1, trim)
        else:
            if k == 'hoodie':
                R(8, t, 8, 3, sd); R(9, t, 6, 2, shade(spec['shirt'], .7))
            if k == 'coat':
                R(7, tb_ - 1, 10, 2, shade(sh, .92)); R(11, t + 2, 2, tb_ - t - 2, shade(sh, .9))
            if k in ('suit', 'vest'):
                R(11, t, 2, tb_ - t, shade(sh, .9))
        # legs
        if sitting and d == 'down':
            R(7, tb + 1, 10, 2, pa); R(7, tb + 2, 10, 1, pd)
            R(8, tb + 3, 3, 1, pa); R(13, tb + 3, 3, 1, pa)
            R(7, tb + 4, 4, 1, so); R(13, tb + 4, 4, 1, so)
        elif sitting and d == 'up':
            R(7, tb + 3, 10, 2, pd)
        else:
            base = tb + 1
            R(8, base, 8, 1, pa)
            for x0, lift in ((8, g['liftL']), (13, g['liftR'])):
                ln = 28 - base + 1 - (1 if lift else 0)
                R(x0, base, 3, ln, pa)
                shoe_y = base + ln
                R(x0 - (1 if x0 == 8 else 0), shoe_y, 4, 2, so)
                R(x0 - (1 if x0 == 8 else 0), shoe_y + 1, 4, 1, sod)
            R(11, base + 1, 2, 28 - base, (0, 0, 0, 0))
            R(10, base, 1, 28 - base + 1, pd); R(13, base, 1, 28 - base + 1, pd)
    else:  # left
        R(8, t, 8, tb - t + 1, sh)
        R(15, t, 1, tb - t + 1, sd); R(8, t, 7, 1, sl); R(8, tb, 8, 1, sd)
        n = tb - t + 1
        if k in ('vest', 'suit'):
            R(8, t, 2, n, trim if k == 'vest' else trim)
            if 'tie' in spec:
                R(8, t + 1, 1, 4, spec['tie'])
        elif k == 'hoodie':
            R(12, t, 4, 3, sd); P(8, t + 1, trim); P(8, t + 2, trim)
        elif k == 'coat':
            R(8, t, 1, n, spec['trim']); R(9, t + 4, 2, 1, sd)
        elif k == 'jacket':
            R(8, t, 1, n, trim)
        elif k == 'polo':
            R(8, t, 3, 1, trim)
        elif k == 'sweater':
            R(8, t + 3, 8, 1, trim); R(8, t + 5, 8, 1, trim)
        if sitting:
            R(10, t, 3, 5, sd); R(7, t + 5, 4, 1, sd)
            R(4, tb + 1, 12, 2, pa); R(4, tb + 2, 12, 1, pd)
            R(4, tb + 3, 3, 1, pa)
            R(2, tb + 4, 5, 1, so)
        else:
            s = g['stride']
            R(10 - s * 2, t, 3, 6, sd); R(12 - s * 2, t, 1, 6, shade(spec['shirt'], .7))
            base = tb + 1
            if s == 0:
                R(9, base, 6, 28 - base + 1, pa); R(14, base, 1, 28 - base + 1, pd); R(11, base + 1, 1, 28 - base, pd)
                R(7, 29, 8, 2, so); R(7, 30, 8, 1, sod)
            else:
                fx, bx = (6, 12) if s > 0 else (12, 6)
                R(9, base, 6, 2, pa)
                R(fx, base + 2, 4, 28 - base - 1, pa)
                R(bx, base + 2, 4, 28 - base - 2, pd)
                R(fx - 1, 29, 5, 2, so); R(fx - 1, 30, 5, 1, sod)
                R(bx, 28, 4, 2, sod)


# ---------------------------------------------------------------- hair
def draw_hair(c, ox, oy, g, style, color):
    hc, hd, hl = color, shade(color, 0.72), shade(color, 1.28)
    P, R, _ = _pen(c, ox, oy)
    h, d = g['h'], g['dir']
    if d == 'down':
        R(8, h - 3, 8, 1, hc); R(6, h - 2, 12, 1, hc); R(5, h - 1, 14, 3, hc)
        for x in (5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18):
            P(x, h + 2, hc)
        for x in (5, 6, 7, 12, 17, 18):
            P(x, h + 3, hc)
        R(5, h + 3, 1, 4, hd); R(18, h + 3, 1, 4, hd); P(6, h + 4, hc); P(17, h + 4, hc)
        R(9, h - 2, 4, 1, hl); R(8, h - 1, 2, 1, hl)
        R(5, h + 1, 1, 2, hd); R(18, h + 1, 1, 2, hd)
        if style == 'spiky':
            for x in (6, 9, 12, 15):
                R(x, h - 4, 2, 1, hc); P(x + 1, h - 5, hc)
            R(7, h - 3, 10, 1, hc)
            for x in (5, 8, 10, 13, 16, 18):
                P(x, h + 3, hc)
        if style == 'long':
            R(4, h + 3, 3, 12, hc); R(17, h + 3, 3, 12, hc)
            R(4, h + 3, 1, 12, hd); R(19, h + 3, 1, 12, hd); R(4, h + 14, 3, 1, hd); R(17, h + 14, 3, 1, hd)
        if style == 'bun':
            R(9, h - 6, 6, 3, hc); R(10, h - 7, 4, 1, hc); R(10, h - 6, 2, 1, hl); R(9, h - 4, 6, 1, hd)
    elif d == 'up':
        R(8, h - 3, 8, 1, hc); R(6, h - 2, 12, 1, hc); R(5, h - 1, 14, 11, hc)
        R(5, h - 1, 1, 11, hd); R(18, h - 1, 1, 11, hd); R(6, h + 9, 12, 1, hd)
        R(9, h - 2, 4, 1, hl); R(7, h, 3, 1, hl)
        if style == 'spiky':
            for x in (6, 9, 12, 15):
                R(x, h - 4, 2, 1, hc); P(x + 1, h - 5, hc)
        if style == 'long':
            R(4, h + 9, 16, 7, hc); R(4, h + 15, 16, 1, hd); R(4, h + 9, 1, 7, hd); R(19, h + 9, 1, 7, hd)
        if style == 'bun':
            R(9, h - 6, 6, 3, hc); R(10, h - 7, 4, 1, hc); R(10, h - 6, 2, 1, hl)
    else:  # facing left
        R(8, h - 3, 7, 1, hc); R(6, h - 2, 11, 1, hc); R(5, h - 1, 13, 3, hc)
        R(12, h + 2, 5, 7, hc); R(17, h, 1, 8, hd); R(16, h + 8, 1, 1, hd)
        for x in (5, 6, 7, 8, 10):
            P(x, h + 2, hc)
        P(5, h + 3, hc); P(6, h + 3, hc); R(12, h + 3, 1, 3, hd)
        R(8, h - 2, 4, 1, hl); R(7, h - 1, 2, 1, hl)
        if style == 'spiky':
            for x in (6, 9, 12, 15):
                R(x, h - 4, 2, 1, hc); P(x + 1, h - 5, hc)
            P(4, h, hc); P(4, h + 1, hc)
        if style == 'long':
            R(12, h + 8, 6, 7, hc); R(17, h + 4, 1, 11, hd); R(12, h + 14, 6, 1, hd)
        if style == 'bun':
            R(16, h - 3, 4, 4, hc); P(17, h - 3, hl); R(16, h + 0, 4, 1, hd)


# ---------------------------------------------------------------- accessories
def draw_acc(c, ox, oy, g, acc):
    P, R, _ = _pen(c, ox, oy)
    h, d = g['h'], g['dir']
    dark = hx('2f3448'); frame = hx('3a3f58')
    if acc in ('headphones', 'headset'):
        band = dark if acc == 'headphones' else hx('4a5170')
        cup = hx('f4c64e') if acc == 'headphones' else dark
        top = h - 4 if acc == 'headphones' else h - 3
        if d in ('down', 'up'):
            R(7, top, 10, 1, band)
            R(5, top + 1, 1, h + 3 - top - 1, band); R(18, top + 1, 1, h + 3 - top - 1, band)
            R(3, h + 3, 3, 4, cup); R(18, h + 3, 3, 4, cup)
            R(3, h + 3, 3, 1, shade(cup, 1.2)); R(18, h + 3, 3, 1, shade(cup, 1.2))
            if acc == 'headset' and d == 'down':
                P(6, h + 7, dark); P(7, h + 8, dark); P(8, h + 9, dark); P(9, h + 9, hx('e45b5b'))
        else:
            R(8, top, 8, 1, band); R(13, top + 1, 1, h + 3 - top - 1, band)
            R(12, h + 3, 4, 4, cup); R(12, h + 3, 4, 1, shade(cup, 1.2))
            if acc == 'headset':
                P(11, h + 7, dark); P(10, h + 8, dark); P(9, h + 9, dark); P(8, h + 9, hx('e45b5b'))
    elif acc == 'glasses':
        if d == 'down':
            for x0 in (7, 13):
                c.frame(ox + x0, oy + h + 4, 4, 5, frame)
            R(11, h + 5, 2, 1, frame)
            P(6, h + 5, frame); P(17, h + 5, frame)
        elif d == 'left':
            c.frame(ox + 7, oy + h + 4, 4, 5, frame)
            R(11, h + 5, 3, 1, frame)
    elif acc == 'beret':
        col, cd = hx('c0392b'), hx('8e2a20')
        if d in ('down', 'up'):
            R(6, h - 4, 13, 3, col); R(8, h - 5, 9, 1, col); R(6, h - 1, 13, 1, cd); R(12, h - 6, 1, 1, cd)
            R(9, h - 4, 3, 1, shade(col, 1.25))
        else:
            R(5, h - 4, 12, 3, col); R(7, h - 5, 8, 1, col); R(5, h - 1, 12, 1, cd); R(11, h - 6, 1, 1, cd)


def build_atlas(draw_fn, *args):
    atlas = Canvas(FW * COLS, FH * len(ANIMS))
    for row, (name, d, kind, n) in enumerate(ANIMS):
        for f in range(n):
            mirror = d == 'right'
            src_dir = 'left' if mirror else d
            g = geo(src_dir, kind, f)
            frame = Canvas(FW, FH)
            draw_fn(frame, 0, 0, g, *args)
            if mirror:
                frame = frame.mirrored()
            atlas.blit(frame, f * FW, row * FH)
    return atlas


def manifest():
    return {
        'frameWidth': FW, 'frameHeight': FH, 'columns': COLS,
        'animations': {name: {'row': i, 'frames': n} for i, (name, d, kind, n) in enumerate(ANIMS)},
        'skins': [s for s, _ in SKINS],
        'hairStyles': HAIR_STYLES,
        'hairColors': [n for n, _ in HAIR_COLORS],
        'roles': list(ROLES.keys()),
        'accessories': {r: a for r, a in ACCESSORY.items()},
    }
