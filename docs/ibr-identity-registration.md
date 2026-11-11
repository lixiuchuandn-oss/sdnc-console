# IBR 设备身份：Paas-VRv2 与 vrctl-agent

> **备查日期**：2026-11-11  
> **范围**：本机 `registervr.conf` 如何变成 CSMCTL/SDNC 上的一台 IBR；Paas 控制台与 agent 两条路径如何交叉。  
> **不覆盖**：VR2 业务配置下发（ACL/NAT/SRv6），见 [ibr-vr-config-deploy.md](./ibr-vr-config-deploy.md)。

---

## 1. 背景

设备身份写在 IBR 本机：

`/usr/local/src/vrconf/registervr.conf`

出厂模板（`ibr-local-agent/tools/registervr.conf.temp`）只有 `name` / `vm_id` / `pool_*` / `type` / `version`，**没有** `uuid`、`mac`。

历史上有两套「空了就自己编身份」的逻辑，容易把同一台机器在控制器上变成两行：

| 时期 | 谁生成 uuid | 形态 | 是否写回文件 |
|------|-------------|------|----------------|
| 旧 agent | CPU ID + 网卡 MAC，每次注册现算 | `54060500FFFB8B0F-<mac无冒号>` | **否**（只进注册报文） |
| 2026-01-30 | 改为只读文件；硬件拼接整段注释掉 | 文件空则没有 uuid | 否 |
| 2026-05 前后 | 文件空则雪花算法，并写回 | 十进制雪花数字 | 是 |
| Paas「接入与身份」 | 表单空则预填雪花 / `02:…` MAC | 与 agent 同形态，随机位不同 | **要点保存才写盘** |

升级镜像、重启 `vrctl-agent` 后：文件里往往仍无 `uuid`（旧算法从未落盘）。新 agent 读到 `null`，再生成雪花并注册 → SDNC 出现「已停止」的旧 `54060500…` 行 + 「未设置角色」的新雪花行。这与 Paas 表单预填不是同一件事：预填不写盘。

**归一目标**：日常只在 **Paas-VRv2「接入与身份」** 生成并保存；agent **只读文件、不再空值自生成**。手改文件仍能被 agent 发现（见 §5）。

---

## 2. 字段与主键（CSMCTL / SDNC）

南向注册：`POST /V2/vrcontrol/VR1/register`（先 `/api/sign`）。实现：`VrInServiceImpl.register` → `VrDao.findByUuid`。

| 字段 | 含义 | CSMCTL | 是否身份主键 |
|------|------|--------|----------------|
| **uuid** | 实例主键 | 有则 update 整条文档，无则 insert | **是**（唯一查找键） |
| **name** | 列表显示名 | 随 register 更新 | 否；改名应再 POST，仍是同一台 |
| **vm_id** | 运维辅助号（云主机时代残留） | 无唯一索引；与 VM04 那套 `vm_id` API 不是一条路 | 否 |
| **mac** | 注册报文占位（`02:…` 随机，**不是网卡 MAC**） | `@NotBlank`，列表默认隐藏 | 否 |
| **type / version** | 默认 `VR` / `V1.0` | 随报文保存 | 否；界面锁死 |

SDNC IBR 列表、隧道、角色、VR2 配置都挂 **uuid**。uuid 变了 = 新设备；旧行停在已停止，角色和隧道不会自动迁移。

`vm_id` 在部分前端仍作 `uuid` 缺失时的兜底，**不要**当成第二主键，也不要在 Mongo 上加 `vm_id` 唯一索引（会与改编号、重复填写冲突）。

---

## 3. 两条路径

```text
                    ┌─ Paas「接入与身份」保存 ─┐
                    │  写 registervr.conf      │
                    │  载荷有变则删 finish     │
                    │  SIGUSR1 唤醒 agent      │
                    └──────────┬───────────────┘
                               │
 /usr/local/src/vrconf/registervr.conf
                               │
                    ┌──────────▼───────────────┐
                    │  vrctl.agent             │
                    │  启动：身份不齐则等待     │
                    │  成功：写 .registration_finish
                    │  循环：discover_change    │
                    └──────────┬───────────────┘
                               │ POST VR1/register
                               ▼
                    CSMCTL Mongo（按 uuid） → SDNC 列表
```

### 3.1 Paas-VRv2（推荐入口）

- 页面：设备 **接入与身份**（`DeviceServicePage`）。
- 文件空：打开页时 **仅表单** 生成 uuid（只读）和 mac（可改）；**保存才写盘**。服务端在结构化保存时也会补空 uuid/mac；`regenerate.uuid` 一律忽略。
- 无「重新生成」按钮。日常不能改 uuid（改了就是新实例）；专家抽屉仍可整文件编辑。
- 保存后：注册报文相对旧文件有变化 → 删 `/rhos/etc/agent/.registration_finish`，并向 `vrctl.agent` 发 `SIGUSR1`（agent 从启动起全程处理该信号，含 auth/register 等待期）。
- 界面：`ONLINE` / `OFFLINE`（看 finish 文件）；保存后轮询最多约 45s 直到注册成功或超时。
- 「从控制器同步配置」要求：网卡已初始化 + CSMCTL 可达 + **ONLINE**（同一 finish 文件）。

代码（Paas 仓）：`web/src/pages/device/config/DeviceServicePage.tsx`，`server/src/lib/registerVrIdentity.ts`，`server/src/routes/api/configSysRoutes.ts`。

### 3.2 vrctl.agent（真正向控制器 POST 的进程）

启动顺序：等到两个 conf 文件存在 → `init_validation`（**不再调用** `init_uuid_function` / `init_name_function`）→ `auth_device` 身份不齐则循环等待 → 无 finish 则 `register` → 主循环。

进程启动即 `trap handle_sigusr1 USR1`，所有等待用 `sleep & wait`（`sleep_interruptible`）。否则首次保存 poke 会打在默认 SIGUSR1 上，**把尚未进入主循环的 agent 杀掉**（`Type=forking` 且无 Restart）。身份不齐时清掉 finish，避免假 ONLINE。

主循环约每 `--interval`（常见 30s）：

1. `check_conf_info`：文件还在否  
2. `discover_change`：文件 vs **上次认证读入内存的** `$UUID $VM_ID $NAME $MAC $VERSION $TYPE`  
3. 有差异则删 finish，再认证+注册  

手改 `registervr.conf`、专家抽屉、Paas 保存，只要文件变了，这条循环都能发现。Paas 只是立刻删 finish 并唤醒 sleep，不必干等 30 秒。

`init_uuid_function` / `generate_random_mac` / `init_name_function` **函数仍在脚本里，启动路径不再调用**。实验室无控制台：人工写齐文件即可触发注册（无开关）。

代码（本仓）：`ibr-local-agent/vrctl.agent`。设备路径：`/rhos/etc/agent/vrctl.agent`（**不随 Paas `deploy:remote` 发布**，改完需单独推脚本并保持 **LF**，CRLF 会导致 bash `set: invalid option`）。

### 3.3 monitoring.agent 重读 uuid

`refresh_uuid`（每轮 download/send）：进程内存里的 uuid 若仍是启动时的空/旧值，checksum 会拉错设备。  
即使 Paas 禁止改 uuid，仍需要它：**agent 先起来、Paas 后保存**（空 → 有 uuid）。与表单按钮无关，不要删。

---

## 4. 现有改动（2026-11-11）

| 点 | 行为 |
|----|------|
| agent 空值生成 | 关掉；文件无 uuid/mac/name 就等待 |
| `auth_device` | `vm_id` 必填；JSON `null` 当空；六项缺一不发认证 |
| `discover_change` | 六项都比：uuid、vm_id、name、mac、version、type；有差异才清 finish 再 POST |
| Paas 保存 | 载荷变化才清 finish + SIGUSR1；uuid 从已有值改成另一个才提示「新实例」；空 uuid/mac 服务端补发 |
| Paas 表单 | uuid 自动生成且只读；mac 自动生成可改；去掉重新生成 |
| agent SIGUSR1 | 全程 trap；auth/register/主循环等待均可被 poke 打断 |
| agent 假 ONLINE | 身份不齐时清 `.registration_finish` |
| 控制器 | **未改**；主键仍是 uuid，同一 uuid 再 POST 为 update |

同一 uuid 再注册，CSMCTL 返回「设备已注册, 仅更新该设备」。删 finish **不等于**新建实例。

---

## 5. 仍然存在的差异

1. **Paas 不是文件锁**  
   手改 / 脚本 / 专家抽屉改 `registervr.conf`，agent 仍会 POST。归一的是推荐入口，不是唯一写入者。

2. **`discover_change` 仍比六项**  
   对 30s 轮询不贵，但语义偏宽。真正有业务含义的触发是 **uuid**（换实例）和 **name**（改显示名要 update）。`vm_id` / `mac` 业务含义弱；`version` / `type` 界面锁死。六项全比的额外作用：有人只改了文件里的 vm_id/mac、又没走 Paas 时，agent 也会 update 一次库。

3. **两套进程、两套缓存**  
   `vrctl.agent` 用内存里上次认证的字段做 discover；`monitoring.agent` 用内存 uuid 拉配置。Paas 只保证写文件 + 唤醒 vrctl；download 侧靠 `refresh_uuid`。

4. **ONLINE 只表示本机 finish 文件**  
   不是 SDNC 列表「运行中」（那是心跳/健康）。finish 在、CSMCTL 不可达时，同步配置仍会被挡住。

5. **运维 Console（`ibr-local-web`）**  
   身份主表单在 **Paas-VRv2**；运维仓若只有整文件抽屉，不会做表单预填，但写盘后同样走 agent。

6. **发布面分裂**  
   改 Paas 走控制台部署；改 agent 必须拷到 `/rhos/etc/agent/`。只升其中一侧会出现「界面已归一、设备仍自生成」或反过来。

---

## 6. 后续可能优化（未做）

| 项 | 说明 |
|----|------|
| 缩小 `discover_change` | 只比 uuid + name；vm_id/mac 仍作**首次注册必填**，不当变更触发器 |
| 真正只认 Paas | 文件签名或 agent 忽略手工改动；会牺牲「无控制台写文件注册」 |
| 改 uuid 的迁移 | 今日改 uuid = 新行，旧角色/隧道不搬；若要搬家需单独工具 |
| 运维仓对齐 | `ibr-local-web` 身份页与 Paas 同一套只读 uuid / 可改 mac |
| finish 与心跳 | 界面 ONLINE 可叠加 CSMCTL 可达，避免「本地已注册、列表已停止」 |

---

## 7. 现场核对

```bash
# 身份文件（应有 uuid / mac / name / vm_id）
cat /usr/local/src/vrconf/registervr.conf

# 本机是否已向控制器注册成功
ls -l /rhos/etc/agent/.registration_finish

# agent 是否在跑（须为 LF 脚本）
ps -ef | grep vrctl.agent | grep -v grep
journalctl -t agent --since '10 min ago' | grep -E 'identity incomplete|registered successfully|uuid field'

# 推送 vrctl.agent 后若 bash 报 set: invalid option，把 CRLF 转成 LF 再重启
systemctl restart vrctl-agent.service
```

控制器侧：同一 uuid 应只有一行；列表「已停止」且 uuid 为 `54060500…` 的是旧硬件拼接身份，与当前文件无关。

---

## 8. 相关路径

| 位置 | 路径 |
|------|------|
| agent 主循环 | `ibr-local-agent/vrctl.agent`（`auth_device` / `discover_change` / `register`） |
| download 重读 uuid | `ibr-local-agent/monitoring.agent`（`refresh_uuid`） |
| 出厂模板 | `ibr-local-agent/tools/registervr.conf.temp` |
| CSMCTL 注册 | `csm-controller/.../VrInServiceImpl.java`、`VrDao.java`、`VrDeviceBean.java` |
| Paas 身份页 | `Paas-VRv2`（或本仓对照 `ibr-local-web`）`web/src/pages/device/config/DeviceServicePage.tsx` |
| Paas 写盘 / 唤醒 | `server/src/lib/registerVrIdentity.ts`、`server/src/routes/api/configSysRoutes.ts` |
| ONLINE 与同步 | `server/src/services/forwarding/forwardingExtended.ts` |
