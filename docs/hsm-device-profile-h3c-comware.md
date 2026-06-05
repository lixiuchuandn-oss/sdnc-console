# HSM 设备模板：`h3c-comware-like`（H3C Comware 专用）

> **交付对象**：HSM / ASW-CTL 维护方  
> **Tower 侧状态**：前面板解析已实现 Comware 专用分支（`parseH3cInterfaceStatusStdout`）；本文定义 **SSH 探测模板**，与 `h3c-huawei-like` 分离。  
> **机器可读**：同目录 [`hsm-device-profile-h3c-comware.json`](./hsm-device-profile-h3c-comware.json)

---

## 1. 为什么要从 `h3c-huawei-like` 拆出

| 维度 | `h3c-huawei-like`（现状） | `h3c-comware-like`（本模板） |
|------|---------------------------|------------------------------|
| 适用 | H3C + 华为 VRP 共用 | **仅 H3C Comware** |
| 关分页 | 常见默认 `screen-length 0 temporary` | **`screen-length disable`**（S6800 等实测可用） |
| 接口命令 | 常配 `\| include XGE` | **`display interface brief` 全表** |
| Tower 解析 | 华为走 VRP 表；H3C 走 Comware 分支 | 不变；本模板保证 **回显完整** 供 Comware 解析 |

华为请继续用 `huawei` 或 `h3c-huawei-like`，**不要**挂到本 profile。

---

## 2. Profile 标识

| 字段 | 值 |
|------|-----|
| **profile id** | `h3c-comware-like` |
| **展示名** | H3C Comware / H3C Comware（华三） |
| **vendor 建议** | Switch CR `spec.vendor = "H3C"` |
| **替代关系** | 新建后，H3C 新接入默认用本 profile；存量可迁移 |

---

## 3. 默认参数（写入 HSM profile 配置）

### 3.1 会话

```text
dialTimeoutSec:  15
execTimeoutSec:  90          # display interface brief 全表较慢，勿用 15s
screenLengthCmd: screen-length disable
```

**禁止**作为 H3C 默认（会在部分型号报错 `% Unrecognized command`）：

- `screen-length 0 temporary`
- `screen-length 0`

**执行顺序**：每个探测维度（info / interfaces / performance / vlans）开始前，在同一 SSH 会话内先执行 `screenLengthCmd`，再执行该维度命令列表。

### 3.2 命令列表

与 Tower `Switch` CR（`hms.rivercloud.com/v1`）字段一一对应：

| CR 字段 | 默认命令（每行一条，按序执行） |
|---------|--------------------------------|
| `infoCommands` | `display version` |
| `interfaceCommands` | `display interface brief` |
| `performanceCommands` | `display cpu-usage`<br>`display memory` |
| `vlanCommands` | `display vlan` |

### 3.3 命令约束（HSM 必须遵守）

1. **`interfaceCommands[]` 一条数组元素 = 一条完整 CLI**  
   管道 `| include` 必须与主命令在 **同一字符串**，不得拆成两条执行。
2. **默认不要用** `display interface brief | include XGE`  
   会漏 **FGE**（QSFP+）口；实测 S6800-54QF 为 XGE1/0/1–48 + FGE1/0/49–54。
3. 若用户强制 include，Tower 无法补全未探测到的口；HSM 侧应在文档/校验中提示。

---

## 4. 参考回显（验收样例 · S6800-54QF）

以下片段来自现网 Comware 7.1；HSM 集成测试可用作 golden sample。

### 4.1 关分页 + 版本

```text
<H3C-CORE-SW>screen-length disable
<H3C-CORE-SW>display version
H3C Comware Software, Version 7.1.070, Release 2612P06
...
BOARD TYPE:         S6800-54QF
...
[SubSlot 0] 48SFP Plus+6QSFP Plus
```

### 4.2 接口（关键：bridge mode 段）

`display interface brief` 含 **两段**表；**物理口在 bridge mode**：

```text
Brief information on interfaces in route mode:
Interface            Link Protocol Primary IP      Description
MGE0/0/0             DOWN DOWN     --
Vlan1                UP   UP       --
...

Brief information on interfaces in bridge mode:
Interface            Link Speed   Duplex Type PVID Description
FGE1/0/49            DOWN auto    A      A    1
...
XGE1/0/1             UP   10G(a)  F(a)   A    11   ...
XGE1/0/48            UP   1G(a)   F(a)   A    4094 ...
```

Tower **只绘制物理口**（XGE/FGE/GE 等），过滤 Vlan、MGE、BAGG 等逻辑口。

### 4.3 性能

```text
Slot 1 CPU 0 CPU usage:
      18% in last 5 seconds
      11% in last 1 minute

Memory statistics are measured in KB:
Mem:       2024320   1324704    699616  ...  35.2%
```

---

## 5. 北向 API 与 Tower 消费约定

探测接口（路径以 HSM 部署为准，Tower 北向常见为）：

- `GET /v1/hms/switch/info`
- `GET /v1/hms/switch/interfaces`
- `GET /v1/hms/switch/performance`
- `GET /v1/hms/switch/vlans`

每个维度响应需包含：

```json
{
  "host": "192.168.x.x",
  "device_profile": "h3c-comware-like",
  "ok": true,
  "lines": [
    {
      "command": "display interface brief",
      "stdout": "...(完整回显，含 bridge mode 数据行)...",
      "ok": true
    }
  ]
}
```

Tower 行为摘要：

- **型号**：`display version` → `BOARD TYPE`（vendor=H3C 时）
- **前面板**：`interfaces.lines[].stdout` → `parseH3cInterfaceStatusStdout`
- **CPU/内存**：H3C 专用解析 `display cpu-usage` / `display memory`（与华为 VRP 分开）

---

## 6. HSM 实现清单（给对面勾选）

- [ ] 注册 profile id：`h3c-comware-like`，出现在 `GET /v1/hms/device/profiles`
- [ ] 默认 `screenLengthCmd = screen-length disable`
- [ ] 默认 `execTimeoutSec >= 90`
- [ ] 默认 `interfaceCommands = ["display interface brief"]`
- [ ] 管道命令不拆分执行
- [ ] 响应 `device_profile` 回写本 profile
- [ ] 用 S6800（或同类 L3 Comware）跑通 §7 验收

---

## 7. 验收标准

| # | 检查项 | 通过条件 |
|---|--------|----------|
| 1 | 关分页 | 无 `Unrecognized command`；brief 无 `---- More ----` |
| 2 | 接口完整 | bridge mode 含 XGE1/0/1–48 与 FGE1/0/49–54（S6800-54QF） |
| 3 | Tower 解析 | 前面板 ≥ 54 口，且无单独仅 MGE 的误判 |
| 4 | 性能 | cpu-usage / memory 有有效 stdout |
| 5 | 版本 | info 含 `BOARD TYPE` 或 `H3C Comware` |

---

## 8. Tower 侧后续（HSM 上线后）

HSM 发布 `h3c-comware-like` 后，Tower 将把 Switch CR 厂商 **H3C** 的默认 profile 推断改为优先本 id（保留 `h3c-huawei-like` 回退）。  
用户仍可在「物理交换机 → 编辑 → 高级」覆盖 `screenLengthCmd` / 各命令列表。

---

## 9. 与 `h3c-huawei-like` 差异速查

```yaml
# h3c-huawei-like（勿再用于 H3C 默认）
screenLengthCmd: screen-length 0 temporary   # H3C 常失败
interfaceCommands:
  - display interface brief | include XGE    # 漏 FGE

# h3c-comware-like（本模板）
screenLengthCmd: screen-length disable
execTimeoutSec: 90
interfaceCommands:
  - display interface brief
performanceCommands:
  - display cpu-usage
  - display memory
```
