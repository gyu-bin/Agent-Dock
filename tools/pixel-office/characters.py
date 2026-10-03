"""Layered 16x24 office-worker sprites.

Every layer atlas shares one frame layout so the client can stack
skin → outfit → hair → accessory with identical background-position.
"""
from px import Canvas, hx

FW, FH = 16, 24
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
    # shirt, pants, shoes, kind
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
    """Shared body geometry for one frame."""
    g = dict(dir=direction, kind=kind, f=f, blink=False)
    dy = 0
    if kind == 'walk' and f in (1, 3):
        dy = -1
    if kind == 'sit':
        dy = 3
    g['h'] = 4 + dy            # head skin top row
    g['t'] = 11 + dy           # torso top
    g['tb'] = 16 + dy          # torso bottom (inclusive)
    g['dy'] = dy
    g['blink'] = (kind in ('stand', 'sit') and f == 1 and direction != 'up')
    g['type'] = (kind == 'sit' and direction == 'up' and f == 1)
    # arm swing for walk: +1 lowers a hand
    g['armL'] = 1 if (kind == 'walk' and f == 1) else 0
    g['armR'] = 1 if (kind == 'walk' and f == 3) else 0
    g['liftL'] = kind == 'walk' and f == 1
    g['liftR'] = kind == 'walk' and f == 3
    g['stride'] = {0: 0, 1: 1, 2: 0, 3: -1}[f] if kind == 'walk' else 0
    return g


# ---------------------------------------------------------------- skin
def draw_skin(c, ox, oy, g, skin):
    sk, sd = skin, shade(skin, 0.86)
    P = lambda x, y, col: c.p(ox + x, oy + y, col)
    R = lambda x, y, w, h, col: c.rect(ox + x, oy + y, w, h, col)
    h = g['h']
    if g['dir'] in ('down', 'up'):
        R(4, h, 8, 7, sk)
        c.px[ox + 4, oy + h] = (0, 0, 0, 0); c.px[ox + 11, oy + h] = (0, 0, 0, 0)
        c.px[ox + 4, oy + h + 6] = sd; c.px[ox + 11, oy + h + 6] = sd
        R(6, h + 7, 4, 1, sd)  # neck
        P(3, h + 3, sd); P(12, h + 3, sd)  # ears
        if g['dir'] == 'down':
            if g['blink']:
                P(6, h + 4, EYE); P(9, h + 4, EYE)
            else:
                P(6, h + 3, EYE); P(6, h + 4, EYE); P(9, h + 3, EYE); P(9, h + 4, EYE)
            P(5, h + 5, hx('f2a0a0')); P(10, h + 5, hx('f2a0a0'))
            P(7, h + 6, sd); P(8, h + 6, sd)
    else:  # left
        R(4, h, 7, 7, sk)
        c.px[ox + 4, oy + h] = (0, 0, 0, 0); c.px[ox + 10, oy + h] = (0, 0, 0, 0)
        P(3, h + 4, sk)  # nose
        R(6, h + 7, 3, 1, sd)
        P(9, h + 3, sd); P(9, h + 4, sd)
        if g['blink']:
            P(5, h + 4, EYE)
        else:
            P(5, h + 3, EYE); P(5, h + 4, EYE)
        P(6, h + 5, hx('f2a0a0'))
    # hands
    t = g['t']
    if g['kind'] == 'sit':
        if g['dir'] == 'down':
            P(4, t + 5, sk); P(11, t + 5, sk)
        elif g['dir'] == 'up':
            if g['type']:
                P(3, t + 3, sk); P(12, t + 4, sk)
            else:
                P(3, t + 4, sk); P(12, t + 4, sk)
        else:
            P(3, t + 4, sk); P(4, t + 4, sk)
    elif g['dir'] in ('down', 'up'):
        P(3, t + 5 + g['armL'], sk); P(12, t + 5 + g['armR'], sk)
    else:
        sx = 7 - g['stride']
        P(sx, t + 5, sk)


# ---------------------------------------------------------------- outfit
def draw_outfit(c, ox, oy, g, role):
    spec = ROLES[role]
    sh, sd, sl = spec['shirt'], shade(spec['shirt'], 0.82), shade(spec['shirt'], 1.12)
    pa, pd = spec['pants'], shade(spec['pants'], 0.8)
    so = spec['shoes']
    trim = spec['trim']
    P = lambda x, y, col: c.p(ox + x, oy + y, col)
    R = lambda x, y, w, hh, col: c.rect(ox + x, oy + y, w, hh, col)
    t, tb, d, kind = g['t'], g['tb'], g['dir'], g['kind']
    sitting = kind == 'sit'
    if d in ('down', 'up'):
        tb_ = tb + (2 if sitting and d == 'up' else 0)
        R(4, t, 8, tb_ - t + 1, sh)
        R(4, t, 1, tb_ - t + 1, sd); R(11, t, 1, tb_ - t + 1, sd)
        R(5, t, 6, 1, sl)
        # sleeves
        if sitting and d == 'up':
            R(3, t, 1, 4 - (1 if g['type'] else 0), sd); R(12, t, 1, 4, sd)
        elif sitting:
            R(3, t, 1, 4, sd); R(12, t, 1, 4, sd)
            R(4, t + 4, 1, 1, sd); R(11, t + 4, 1, 1, sd)
        else:
            R(3, t, 1, 5 + g['armL'], sd); R(12, t, 1, 5 + g['armR'], sd)
        if d == 'down':
            k = spec['kind']
            if k == 'vest':
                R(4, t, 2, tb - t + 1, spec['trim']); R(10, t, 2, tb - t + 1, spec['trim'])
                R(7, t, 2, 4, spec['tie']); P(7, t, shade(spec['tie'], .8)); P(8, t, shade(spec['tie'], .8))
            elif k == 'suit':
                R(6, t, 4, 3, trim); R(7, t, 2, 4, spec['tie'])
            elif k == 'hoodie':
                R(5, t, 6, 1, sd); P(6, t + 1, trim); P(9, t + 1, trim); P(6, t + 2, trim); P(9, t + 2, trim)
                R(5, t + 4, 6, 1, sd)
            elif k == 'coat':
                R(7, t, 2, tb - t + 1, trim); P(6, t, sd); P(9, t, sd); P(5, t + 3, sd)
            elif k == 'jacket':
                R(6, t, 4, tb - t + 1, trim); R(7, t + 1, 2, 1, sh)
            elif k == 'polo':
                P(6, t, trim); P(7, t, trim); P(8, t, trim); P(9, t, trim); P(9, t + 2, hx('f4c64e'))
            elif k == 'sweater':
                R(4, t + 3, 8, 1, trim)
        else:  # up / back
            if spec['kind'] == 'hoodie':
                R(5, t, 6, 2, sd)
            if spec['kind'] == 'coat':
                R(4, tb - 1, 8, 2, shade(sh, .92))
        # legs
        if sitting and d == 'down':
            R(4, tb + 1, 8, 2, pa); R(4, tb + 2, 8, 1, pd)
            R(5, tb + 3, 2, 1, pa); R(9, tb + 3, 2, 1, pa)
            R(5, tb + 4, 3, 1, so); R(8, tb + 4, 3, 1, so)
        elif sitting and d == 'up':
            R(4, tb + 3, 8, 2, pd)
        else:
            base = tb + 1
            for side, x0, lift in (('L', 5, g['liftL']), ('R', 8, g['liftR'])):
                ln = (21 - base) - (1 if lift else 0)
                R(x0, base, 3, ln, pa)
                R(x0 + (2 if side == 'L' else 0), base, 1, ln, pd)
                R(x0, base + ln, 3, 2, so)
            R(5, base, 6, 1, pd)
    else:  # left facing
        R(5, t, 6, tb - t + 1, sh)
        R(10, t, 1, tb - t + 1, sd); R(5, t, 6, 1, sl)
        k = spec['kind']
        if k in ('vest', 'suit'):
            R(5, t, 2, tb - t + 1, spec['trim'] if k == 'vest' else trim)
            if 'tie' in spec:
                P(5, t + 1, spec['tie']); P(5, t + 2, spec['tie'])
        elif k == 'hoodie':
            R(8, t, 3, 2, sd)
        elif k == 'coat':
            P(5, t, spec['trim']); P(5, t + 1, spec['trim'])
        elif k == 'jacket':
            R(5, t, 1, tb - t + 1, trim)
        elif k == 'polo':
            P(6, t, trim); P(7, t, trim)
        elif k == 'sweater':
            R(5, t + 3, 6, 1, trim)
        if sitting:
            R(7, t, 2, 4, sd)  # arm resting forward
            R(4, t + 4, 3, 1, sd)
            R(3, tb + 1, 8, 2, pa); R(3, tb + 2, 8, 1, pd)
            R(3, tb + 3, 2, 1, pa)
            R(2, tb + 4, 3, 1, so)
        else:
            s = g['stride']
            ax = 7 - s
            R(ax, t, 2, 5, sd)
            base = tb + 1
            if s == 0:
                R(6, base, 4, 21 - base, pa); R(9, base, 1, 21 - base, pd)
                R(5, 21, 5, 2, so)
            else:
                # front leg (toward facing) and back leg
                fx, bx = (4, 8) if s > 0 else (8, 4)
                R(6, base, 4, 2, pa)
                R(fx, base + 2, 3, 21 - base - 2, pa)
                R(bx, base + 2, 3, 21 - base - 3, pd)
                R(fx - 1, 21, 4, 2, so)
                R(bx, 20, 3, 2, shade(so, .85))


# ---------------------------------------------------------------- hair
def draw_hair(c, ox, oy, g, style, color):
    hc, hd, hl = color, shade(color, 0.72), shade(color, 1.25)
    P = lambda x, y, col: c.p(ox + x, oy + y, col)
    R = lambda x, y, w, hh, col: c.rect(ox + x, oy + y, w, hh, col)
    h, d = g['h'], g['dir']
    if d == 'down':
        R(5, h - 2, 6, 1, hc); R(4, h - 1, 8, 3, hc)
        R(3, h, 1, 4, hd); R(12, h, 1, 4, hd)
        P(4, h + 2, hc); P(5, h + 2, hc); P(10, h + 2, hc); P(11, h + 2, hc); P(4, h + 3, hd); P(11, h + 3, hd)
        R(6, h - 2, 3, 1, hl); P(5, h - 1, hl)
        if style == 'spiky':
            for x in (4, 6, 8, 10):
                P(x, h - 3, hc); P(x + 1, h - 3, hd)
            R(4, h + 1, 8, 1, hc); P(6, h + 2, hc); P(9, h + 2, hc)
        if style == 'long':
            R(3, h + 4, 2, 7, hc); R(11, h + 4, 2, 7, hc)
            R(3, h + 4, 1, 7, hd); R(12, h + 4, 1, 7, hd)
        if style == 'bun':
            R(6, h - 4, 4, 2, hc); P(6, h - 4, hd); P(7, h - 4, hl)
    elif d == 'up':
        R(5, h - 2, 6, 1, hc); R(3, h - 1, 10, 8, hc)
        R(3, h - 1, 1, 8, hd); R(12, h - 1, 1, 8, hd); R(4, h + 6, 8, 1, hd)
        R(6, h - 2, 3, 1, hl); R(5, h, 2, 1, hl)
        if style == 'spiky':
            for x in (4, 6, 8, 10):
                P(x, h - 3, hc)
        if style == 'long':
            R(3, h + 6, 10, 5, hc); R(3, h + 10, 10, 1, hd)
        if style == 'bun':
            R(6, h - 4, 4, 3, hc); P(7, h - 4, hl)
    else:  # left
        R(5, h - 2, 5, 1, hc); R(4, h - 1, 7, 3, hc)
        R(8, h + 2, 3, 4, hc); R(10, h, 1, 6, hd)
        P(4, h + 2, hc); P(5, h + 2, hd)
        R(5, h - 2, 3, 1, hl)
        if style == 'spiky':
            for x in (4, 6, 8):
                P(x, h - 3, hc)
            P(3, h, hc)
        if style == 'long':
            R(8, h + 6, 4, 5, hc); R(11, h + 4, 1, 7, hd)
        if style == 'bun':
            R(10, h - 2, 3, 3, hc); P(11, h - 2, hl)


# ---------------------------------------------------------------- accessories
def draw_acc(c, ox, oy, g, acc):
    P = lambda x, y, col: c.p(ox + x, oy + y, col)
    R = lambda x, y, w, hh, col: c.rect(ox + x, oy + y, w, hh, col)
    h, d = g['h'], g['dir']
    dark = hx('2f3448'); glass = hx('3a3f58')
    if acc in ('headphones', 'headset'):
        band = dark if acc == 'headphones' else hx('4a5170')
        cup = hx('f4c64e') if acc == 'headphones' else dark
        if d in ('down', 'up'):
            R(4, h - 3 if acc == 'headphones' else h - 2, 8, 1, band)
            R(3, h - 2, 1, 2, band); R(12, h - 2, 1, 2, band)
            R(2, h + 1, 2, 3, cup); R(12, h + 1, 2, 3, cup)
            if acc == 'headset' and d == 'down':
                P(4, h + 4, dark); P(5, h + 5, dark); P(6, h + 5, hx('e45b5b'))
        else:
            R(5, h - 3 if acc == 'headphones' else h - 2, 5, 1, band)
            R(8, h + 1, 3, 3, cup)
            if acc == 'headset':
                P(6, h + 4, dark); P(5, h + 5, dark); P(4, h + 5, hx('e45b5b'))
    elif acc == 'glasses':
        if d == 'down':
            for x0 in (5, 8):
                P(x0, h + 3, glass); P(x0 + 2, h + 3, glass); P(x0, h + 4, glass); P(x0 + 2, h + 4, glass)
                P(x0 + 1, h + 2, glass); P(x0 + 1, h + 5, glass)
            P(4, h + 3, glass); P(11, h + 3, glass)
        elif d == 'left':
            P(4, h + 3, glass); P(6, h + 3, glass); P(4, h + 4, glass); P(6, h + 4, glass); P(5, h + 2, glass); P(5, h + 5, glass)
            R(7, h + 3, 2, 1, glass)
    elif acc == 'beret':
        col, cd = hx('c0392b'), hx('8e2a20')
        if d in ('down', 'up'):
            R(4, h - 3, 9, 2, col); R(5, h - 4, 6, 1, col); R(4, h - 1, 9, 1, cd); P(8, h - 5, cd)
        else:
            R(4, h - 3, 8, 2, col); R(5, h - 4, 5, 1, col); R(4, h - 1, 8, 1, cd); P(7, h - 5, cd)


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
