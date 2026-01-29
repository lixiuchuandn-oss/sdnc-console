# Compute Tower 离线部署指南 (Ubuntu 24.04)

本文档详细说明如何将 Compute Tower 离线安装包部署到 Ubuntu 24.04 服务器。

## 📦 准备工作

### 1. 获取安装包
确保你已经拥有生成的离线安装包：`compute-tower-offline.zip`。

### 2. 服务器环境要求
目标服务器 (Ubuntu 24.04) 需要满足以下最低要求：
- **操作系统**: Ubuntu 24.04 LTS (x64)
- **权限**: 拥有 `sudo` 权限的用户
- **Node.js**: Node.js 18.x 或更高版本 (必须安装)
- **构建工具** (可选但推荐): `build-essential` (用于编译原生模块)

如果服务器完全离线，请确保已预先安装 Node.js。

---

## 🚀 安装步骤

### 第一步：上传安装包
将 `compute-tower-offline.zip` 上传到服务器的任意临时目录（例如 `/tmp` 或用户主目录）。

```bash
# 示例：使用 scp 上传
scp compute-tower-offline.zip user@your-server-ip:~/
```

### 第二步：解压安装包
登录服务器并解压文件：

```bash
# 安装 unzip (如果未安装)
sudo apt-get install unzip

# 解压
unzip compute-tower-offline.zip
cd compute-tower-offline
```

### 第三步：执行安装脚本
我们提供了一个自动化脚本 `install.sh` 来处理部署。

```bash
# 赋予执行权限
chmod +x install.sh

# 运行安装
./install.sh
```

**脚本会自动执行以下操作：**
1. 检查 Node.js 环境。
2. 停止并清理旧的 `compute-tower` 服务 (如果存在)。
3. 将文件部署到 `/opt/compute-tower`。
4. 尝试修复原生模块 (`sqlite3`, `ssh2`) 的兼容性问题。
5. 使用 PM2 启动服务并设置开机自启。

---

## 🔧 常见问题与故障排除

### 1. "Node.js not found" 错误
如果安装脚本提示找不到 Node.js，请手动安装：

**在线安装:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**离线安装:**
请下载 Node.js Linux Binaries (x64) 并手动配置环境变量。

### 2. 原生模块 (Native Modules) 报错
由于安装包是在 Windows 上生成的，`node_modules` 中的 `sqlite3` 可能包含 Windows 二进制文件。脚本会自动尝试 `npm rebuild`。

如果启动失败并报错 `invalid ELF header` 或 `module not found`：

**解决方法:**
在服务器上进入部署目录并手动重编译：

```bash
cd /opt/compute-tower
sudo npm rebuild --build-from-source
```
*注意：这需要服务器安装了 `build-essential` (gcc, make, python3)。*

### 3. 服务启动失败
查看日志以排查问题：

```bash
# 查看 PM2 日志
pm2 logs compute-tower

# 或者查看错误日志
pm2 logs compute-tower --err
```

### 4. 端口冲突
默认后端监听端口为 **5001**。如果该端口被占用，请修改 `/opt/compute-tower/ecosystem.config.js` 中的 `PORT` 环境变量，然后重启服务：

```bash
pm2 restart compute-tower
```

---

## 🌐 访问系统

安装完成后，您可以通过浏览器访问：

- **地址**: `http://<服务器IP>:5001`
- **默认管理员账号**: (请参考系统初始化配置)

---

## 📂 目录结构说明

部署后的目录结构位于 `/opt/compute-tower`:

```text
/opt/compute-tower/
├── dist/               # 后端编译代码
├── public/             # 前端静态资源 (由后端托管)
├── node_modules/       # 项目依赖
├── ecosystem.config.js # PM2 配置文件
├── package.json
└── .env                # 环境变量配置
```
