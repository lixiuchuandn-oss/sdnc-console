#!/usr/bin/env python3
"""一次性占位图生成脚本：为白皮书能力章生成"待补充"占位 PNG。
正式配图就位后可删除本脚本与对应 placeholder-*.png。"""
import os
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"
W, H = 1200, 680
BG = (245, 246, 248)
BORDER = (170, 176, 184)
TITLE = (51, 54, 57)
SUB = (120, 126, 132)
BADGE_BG = (230, 233, 237)
BADGE_FG = (110, 116, 122)

FIGS = [
    ("placeholder-multicloud-onboarding.png", "图 3-1", "多云统一接入与标准资源映射"),
    ("placeholder-resource-sync.png", "图 3-2", "资源同步与一致性流程"),
    ("placeholder-compute-storage-image.png", "图 4-1", "计算、存储与镜像统一管理"),
    ("placeholder-k8s-workloads.png", "图 6-1", "Kubernetes 工作负载统一管理"),
]


def font(sz):
    return ImageFont.truetype(FONT, sz)


def centered(draw, text, f, y, fill):
    box = draw.textbbox((0, 0), text, font=f)
    w = box[2] - box[0]
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)


def dashed_rect(draw, xy, color, width=2, dash=14, gap=10):
    x0, y0, x1, y1 = xy
    for x in range(x0, x1, dash + gap):
        draw.line([(x, y0), (min(x + dash, x1), y0)], fill=color, width=width)
        draw.line([(x, y1), (min(x + dash, x1), y1)], fill=color, width=width)
    for y in range(y0, y1, dash + gap):
        draw.line([(x0, y), (x0, min(y + dash, y1))], fill=color, width=width)
        draw.line([(x1, y), (x1, min(y + dash, y1))], fill=color, width=width)


def make(path, num, title):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    dashed_rect(d, (24, 24, W - 24, H - 24), BORDER, 2)
    # badge
    badge = "占位图 · 待补充"
    bf = font(26)
    bbox = d.textbbox((0, 0), badge, font=bf)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    bx, by = (W - bw) / 2 - 22, 150
    d.rounded_rectangle([bx, by, bx + bw + 44, by + bh + 28], radius=18, fill=BADGE_BG)
    d.text(((W - bw) / 2, by + 14), badge, font=bf, fill=BADGE_FG)
    centered(d, num, font(64), 290, TITLE)
    centered(d, title, font(40), 390, TITLE)
    centered(d, "Placeholder — to be replaced with final diagram", font(22), 470, SUB)
    img.save(path, "PNG")
    print("wrote", path)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    for name, num, title in FIGS:
        make(os.path.join(here, name), num, title)


if __name__ == "__main__":
    main()
