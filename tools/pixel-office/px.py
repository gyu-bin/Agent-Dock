"""Tiny pixel-drawing helpers shared by the Agent Deck pixel-office generator."""
from PIL import Image


def hx(s, a=255):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.px = self.img.load()

    # --- primitives -------------------------------------------------------
    def p(self, x, y, c):
        if c is None:
            return
        if 0 <= x < self.w and 0 <= y < self.h:
            if len(c) == 4 and c[3] < 255:
                r, g, b, a = self.px[x, y]
                if a == 0:
                    self.px[x, y] = c
                else:
                    t = c[3] / 255
                    self.px[x, y] = (
                        int(r * (1 - t) + c[0] * t),
                        int(g * (1 - t) + c[1] * t),
                        int(b * (1 - t) + c[2] * t),
                        255,
                    )
            else:
                self.px[x, y] = c

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return (0, 0, 0, 0)

    def rect(self, x, y, w, h, c):
        for j in range(h):
            for i in range(w):
                self.p(x + i, y + j, c)

    def hline(self, x, y, w, c):
        self.rect(x, y, w, 1, c)

    def vline(self, x, y, h, c):
        self.rect(x, y, 1, h, c)

    def frame(self, x, y, w, h, c):
        self.hline(x, y, w, c)
        self.hline(x, y + h - 1, w, c)
        self.vline(x, y, h, c)
        self.vline(x + w - 1, y, h, c)

    def box(self, x, y, w, h, fill, edge, hi=None, round_=False):
        """Filled box with a 1px edge, optional top highlight, optional rounded corners."""
        self.rect(x, y, w, h, fill)
        self.frame(x, y, w, h, edge)
        if hi:
            self.hline(x + 1, y + 1, w - 2, hi)
        if round_:
            for (cx, cy) in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
                if 0 <= cx < self.w and 0 <= cy < self.h:
                    self.px[cx, cy] = (0, 0, 0, 0)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(-ry, ry + 1):
            for x in range(-rx, rx + 1):
                if (x * x) / (rx * rx + 0.01) + (y * y) / (ry * ry + 0.01) <= 1.0:
                    self.p(cx + x, cy + y, c)

    def blit(self, other, x, y):
        self.img.alpha_composite(other.img if isinstance(other, Canvas) else other, (x, y))
        self.px = self.img.load()

    def mirrored(self):
        c = Canvas(self.w, self.h)
        c.img = self.img.transpose(Image.FLIP_LEFT_RIGHT)
        c.px = c.img.load()
        return c

    def shadow(self, cx, cy, rx, ry=2, a=55):
        self.ellipse(cx, cy, rx, ry, (40, 28, 30, a))
