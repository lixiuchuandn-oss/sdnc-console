# 操作系统图标资源需求清单 (OS Icon Requirements)

为了在 Compute Tower 的虚拟机创建向导中能够智能识别并展示操作系统图标，我们需要收集以下操作系统的 Logo 图标。

**图标要求：**
- **格式**：推荐 SVG (矢量图，清晰度最佳) 或 PNG (透明背景，建议 64x64 像素以上)。
- **风格**：彩色原版 Logo，或统一的扁平化风格。

以下是我们需要支持的操作系统列表及其识别关键词（不区分大小写）：

## 1. 国际主流操作系统 (International OS)

| 操作系统名称 | 识别关键词 (Keywords) | 状态 | 备注 |
| :--- | :--- | :--- | :--- |
| **Windows** | `windows`, `win10`, `win11`, `win2019`, `win2022`, `server` | ✅ 已收集 | 使用彩色 SVG |
| **Linux (通用)** | `linux` | ✅ 已有 (Emoji) | 通用企鹅图标 |
| **Ubuntu** | `ubuntu` | ✅ 已收集 | |
| **CentOS** | `centos` | ✅ 已收集 | |
| **Debian** | `debian` | ✅ 已收集 | |
| **Red Hat (RHEL)** | `redhat`, `rhel` | ✅ 已收集 | |
| **Fedora** | `fedora` | ✅ 已收集 | |
| **SUSE / openSUSE** | `suse`, `opensuse`, `sles` | ✅ 已收集 | |
| **Android** | `android` | ✅ 已收集 | |
| **FreeBSD** | `freebsd`, `bsd` | ✅ 已收集 | |

## 2. 中国国产操作系统 (信创领域)

| 操作系统名称 | 识别关键词 (Keywords) | 状态 | 备注 |
| :--- | :--- | :--- | :--- |
| **银河麒麟 (Kylin)** | `kylin`, `kylinos`, `galaxy` | ✅ 已收集 | 麒麟软件 |
| **中标麒麟 (NeoKylin)** | `neokylin` | ✅ 已收集 | 麒麟软件 |
| **统信 UOS** | `uos`, `uniontech` | ✅ 已收集 | 统信软件 |
| **欧拉 (openEuler)** | `openeuler`, `euler` | ✅ 已收集 | 华为/开放原子基金会 |
| **龙蜥 (OpenAnolis)** | `anolis`, `openanolis` | ✅ 已收集 | 阿里/社区 |

---

**收集说明：**
请将收集到的图标文件命名为对应的英文关键词（如 `ubuntu.svg`, `kylin.svg`），并告知存放位置，我将更新前端代码进行加载。
