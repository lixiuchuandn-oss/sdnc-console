#!/usr/bin/env python3
"""Generate architecture PNG diagrams for docs/reference/architecture.md"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "reference" / "images"

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Arial Unicode MS", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def box(ax, x, y, w, h, text, fc="#E8F4FC", ec="#2B6CB0", fontsize=10, bold=False):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.06",
        linewidth=1.4, edgecolor=ec, facecolor=fc, zorder=2,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2, y + h / 2, text,
        ha="center", va="center", fontsize=fontsize,
        weight="bold" if bold else "normal", zorder=3,
    )
    return patch


def frame(ax, x, y, w, h, title, fc="#F7FAFC", ec="#4A5568", title_fs=13):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.1",
        linewidth=2.0, edgecolor=ec, facecolor=fc, alpha=0.22, zorder=0,
    )
    ax.add_patch(patch)
    ax.text(x + w / 2, y + h - 0.28, title, ha="center", va="top",
            fontsize=title_fs, weight="bold", color="#1A202C", zorder=1)
    return patch


def band(ax, x, y, w, h, title, subtitle, fc, ec):
    """横向色带层（平台层用）"""
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.05",
        linewidth=1.2, edgecolor=ec, facecolor=fc, zorder=2,
    )
    ax.add_patch(patch)
    ax.text(x + w / 2, y + h * 0.62, title, ha="center", va="center",
            fontsize=9.5, weight="bold", color="#1A202C", zorder=3)
    ax.text(x + w / 2, y + h * 0.28, subtitle, ha="center", va="center",
            fontsize=7.5, color="#4A5568", zorder=3)


def arrow(ax, x1, y1, x2, y2, label=None, color="#2D3748", dashed=False, lw=1.6):
    ls = (0, (5, 4)) if dashed else "-"
    arr = FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle="-|>", mutation_scale=12, linewidth=lw,
        color=color, linestyle=ls, zorder=4,
    )
    ax.add_patch(arr)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx + 0.12, my, label, ha="left", va="center", fontsize=7.5, color=color,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.9))


def arrow(ax, x1, y1, x2, y2, label=None, color="#2D3748", dashed=False, lw=1.6, label_offset=(0.12, 0)):
    ls = (0, (5, 4)) if dashed else "-"
    arr = FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle="-|>", mutation_scale=11, linewidth=lw,
        color=color, linestyle=ls, zorder=4,
    )
    ax.add_patch(arr)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ox, oy = label_offset
        ax.text(mx + ox, my + oy, label, ha="left", va="center", fontsize=7, color=color)


def draw_overview():
    """纵向 C/S + IBR 内完整软件/平台栈（clish 枢纽 + 左右分栏）"""
    fig, ax = plt.subplots(figsize=(11, 16))
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 16)
    ax.axis("off")
    ax.set_title("VR / IPoE 上下游架构（C/S）", fontsize=16, weight="bold", pad=14)

    # ── Server 端（Tower = csmctl 可视化）──
    frame(ax, 0.4, 13.8, 10.2, 1.9, "Server 端", fc="#EBF8FF", ec="#2B6CB0", title_fs=11)
    box(ax, 1.2, 14.0, 8.6, 1.35, "Tower / csmctl\n可视化界面  ·  SDN 配置下发  ·  SSO / 网际路由域",
         fc="#BEE3F8", ec="#2B6CB0", fontsize=9.2, bold=True)

    # ── IBR 一体机 ──
    frame(ax, 0.4, 0.45, 10.2, 13.1, "IBR 一体机", fc="#F0FFF4", ec="#276749", title_fs=11)
    ax.text(5.4, 13.25, "应用 / 控制软件", ha="center", fontsize=8.5, color="#276749", weight="bold")

    band(ax, 0.8, 12.15, 9.4, 0.85, "Paas Console",
         "/opt/paas-vr-v2  ·  Web/API  ·  vrconf  ·  IPsec 经 CSM JSON", "#EDF2F7", "#4A5568")
    band(ax, 0.8, 11.1, 9.4, 0.85, "vrctl-agent",
         "/rhos/etc/agent  ·  download  ·  transfer.lua → clish", "#FAF089", "#B7791F")

    # ── IPoE 原子：T 型控制面 + 统一数据面 ──
    box(ax, 0.8, 6.55, 9.4, 4.35, "", fc="#C6F6D5", ec="#276749")
    ax.text(5.5, 10.65, "IPoE 原子  /rhos", ha="center", fontsize=10, weight="bold", color="#22543D")

    # clish 枢纽（居中）
    box(ax, 3.6, 9.55, 3.8, 0.75, "clish / konfd\nenable-view XML", fc="#9AE6B4", ec="#276749", fontsize=8)

    # 左右控制面
    ax.text(2.0, 9.15, "路由控制面", ha="center", fontsize=7, color="#22543D", weight="bold")
    ax.text(8.0, 9.15, "IPsec 控制面", ha="center", fontsize=7, color="#22543D", weight="bold")
    box(ax, 1.1, 8.15, 2.6, 0.8, "FRR\nbgpd / zebra", fc="#9AE6B4", ec="#276749", fontsize=7.5)
    box(ax, 7.3, 8.15, 2.6, 0.8, "strongSwan\ncharon · swanctl", fc="#BEE3F8", ec="#2B6CB0", fontsize=7.5)

    # 数据面一行三块
    ax.text(1.0, 7.85, "数据面 / 接入", ha="left", fontsize=7, color="#22543D", weight="bold")
    box(ax, 1.1, 6.72, 5.4, 0.95, "vbras  VPP\nFIB · SRv6 · IPsec ESP · NAT · ACL", fc="#68D391", ec="#276749", fontsize=8, bold=True)
    box(ax, 6.65, 6.72, 1.55, 0.95, "Accel-PPP\nDHCP/RADIUS", fc="#9AE6B4", ec="#276749", fontsize=7)
    box(ax, 8.35, 6.72, 1.55, 0.95, "vctl\ncli.sock", fc="#E6FFFA", ec="#276749", fontsize=7.5)

    # 平台层
    ax.plot([0.8, 10.2], [6.35, 6.35], color="#A0AEC0", linewidth=1.0, linestyle="--", zorder=1)
    ax.text(5.5, 6.18, "平台 / 宿主层", ha="center", fontsize=8.5, color="#4A5568", weight="bold")

    band(ax, 0.8, 5.15, 9.4, 1.05, "Linux OS",
         "openEuler / Ubuntu  ·  kernel  ·  systemd  ·  /usr/local/src/vrconf", "#E2E8F0", "#4A5568")
    band(ax, 0.8, 3.85, 9.4, 1.05, "DPDK 21.11",
         "PMD · hugepages · dpdk-plugin", "#FED7D7", "#C53030")
    band(ax, 0.8, 2.55, 9.4, 1.05, "vsw1 / vsw2",
         "WAN / LAN 虚拟接口  ·  与 vbras hostif 桥接", "#FEEBC8", "#DD6B20")

    box(ax, 0.8, 0.65, 4.2, 1.65, "物理网卡 WAN\nGE2/2/0", fc="#CBD5E0", ec="#2D3748", fontsize=8.5)
    box(ax, 6.0, 0.65, 4.2, 1.65, "物理网卡 LAN\nGE2/3/0", fc="#CBD5E0", ec="#2D3748", fontsize=8.5)
    ax.text(5.5, 0.52, "对端 PE / 用户 CE / 测试机", ha="center", fontsize=7.5, color="#718096")

    # ── 外部主链路（走两侧，避免穿过 IPoE 内部）──
    # Tower/csmctl → agent（SDN JSON）
    arrow(ax, 7.5, 14.0, 8.2, 11.95, label="SDN JSON", color="#2B6CB0", lw=2.0, label_offset=(0.1, 0.08))
    # agent → clish（中线）
    arrow(ax, 5.5, 11.1, 5.5, 10.3, color="#B7791F", lw=1.6)
    ax.text(5.62, 10.7, "clish", fontsize=7, color="#B7791F")
    # Tower SSO → Console（左侧虚线）
    arrow(ax, 2.5, 14.0, 2.0, 12.55, label="SSO", color="#718096", dashed=True, label_offset=(0.08, 0))

    # ── IPoE 内部：T 型竖向 ──
    arrow(ax, 4.2, 9.55, 2.4, 8.95, color="#276749", lw=1.2)
    arrow(ax, 6.8, 9.55, 8.6, 8.95, color="#2B6CB0", lw=1.2)
    ax.text(3.0, 9.35, "vtysh", fontsize=6.8, color="#276749", ha="center")
    ax.text(7.5, 9.35, "ipsec-commit", fontsize=6.8, color="#2B6CB0", ha="center")
    arrow(ax, 2.4, 8.15, 3.8, 7.67, label="zebra→FIB", color="#276749", lw=1.3, label_offset=(-0.05, 0.06))
    arrow(ax, 8.6, 8.15, 5.8, 7.67, label="SA→ESP", color="#2B6CB0", lw=1.3, label_offset=(0.02, 0.06))
    # Console → vctl（右侧虚线）
    arrow(ax, 9.5, 12.15, 9.1, 7.67, color="#718096", dashed=True, lw=1.2)
    # vbras → 平台（单条中线）
    arrow(ax, 3.8, 6.72, 5.5, 6.2, color="#276749", lw=1.8)
    arrow(ax, 5.5, 5.15, 5.5, 4.9, color="#C53030", lw=1.4)
    arrow(ax, 5.5, 3.85, 5.5, 3.6, color="#C53030", lw=1.4)
    arrow(ax, 5.5, 2.55, 5.5, 2.3, color="#DD6B20", lw=1.4)
    arrow(ax, 4.8, 2.55, 2.9, 2.3, color="#DD6B20", lw=1.1)
    arrow(ax, 6.2, 2.55, 7.1, 2.3, color="#DD6B20", lw=1.1)
    arrow(ax, 2.9, 0.65, 2.9, 0.52, color="#2D3748", lw=1.1)
    arrow(ax, 7.1, 0.65, 7.1, 0.52, color="#2D3748", lw=1.1)

    out = OUT_DIR / "architecture-overview.png"
    fig.savefig(out, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"Wrote {out}")


def draw_dual_config():
    fig, ax = plt.subplots(figsize=(10, 5.5))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.5)
    ax.axis("off")
    ax.set_title("IBR 内双配置链路", fontsize=14, weight="bold", pad=12)

    frame(ax, 0.3, 0.5, 4.5, 4.5, "链路 A · Paas Console", fc="#EDF2F7", ec="#4A5568")
    box(ax, 0.7, 3.5, 1.0, 0.65, "用户", fontsize=9)
    box(ax, 1.9, 3.5, 1.4, 0.65, "Web UI", fontsize=9)
    box(ax, 3.5, 3.5, 1.1, 0.65, "API", fontsize=9)
    box(ax, 0.7, 2.3, 1.8, 0.75, "vrconf", fontsize=8.5)
    box(ax, 2.7, 2.3, 1.9, 0.75, "vbras 快照", fontsize=8.5, fc="#C6F6D5", ec="#276749")
    arrow(ax, 1.7, 3.82, 1.9, 3.82)
    arrow(ax, 3.3, 3.82, 3.5, 3.82)
    arrow(ax, 4.05, 3.5, 1.6, 3.05)
    arrow(ax, 2.5, 2.3, 3.65, 2.3)

    frame(ax, 5.2, 0.5, 4.5, 4.5, "链路 B · Tower/csmctl 下发", fc="#EBF8FF", ec="#2B6CB0")
    box(ax, 5.6, 3.5, 1.8, 0.65, "Tower/csmctl", fontsize=8.5, fc="#BEE3F8")
    box(ax, 7.5, 3.5, 1.4, 0.65, "agent", fontsize=9, fc="#FAF089", ec="#B7791F")
    box(ax, 5.6, 2.3, 1.6, 0.75, "uuid.bak", fontsize=8)
    box(ax, 7.4, 2.3, 1.4, 0.75, "transfer", fontsize=8)
    box(ax, 6.5, 1.1, 2.2, 0.85, "ipoe: FRR +\nstrongSwan + vbras", fontsize=7.5, fc="#9AE6B4", ec="#276749", bold=True)
    arrow(ax, 7.4, 3.82, 7.5, 3.82)
    arrow(ax, 7.75, 3.5, 6.4, 3.05)
    arrow(ax, 7.2, 2.3, 8.1, 2.3)
    arrow(ax, 8.1, 2.3, 7.6, 1.95)

    ax.text(5.0, 0.15, "SRv6/L3VPN 走链路 B；仅 Console 改 IP 不补全 BGP/VRF", ha="center", fontsize=9, color="#C53030")

    out = OUT_DIR / "architecture-dual-config.png"
    fig.savefig(out, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"Wrote {out}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    draw_overview()
    draw_dual_config()


if __name__ == "__main__":
    main()
