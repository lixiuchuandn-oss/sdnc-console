# reference/（架构文档）

产品**源码**在仓库根目录 **`products/`**（**本地目录，`.gitignore` 不上传 GitHub**）。目录约定见下方；本地若无该目录，请自行从各产品仓库检出后放入。

| 文档 | 说明 |
|------|------|
| **[`architecture.md`](architecture.md)** | 上下游 C/S 架构 |
| [`images/`](images/) | 架构图 PNG |
| [`../knowledge-base.md`](../knowledge-base.md) | 开发知识库 |
| [`internetwork-routing-domain-downstream.md`](internetwork-routing-domain-downstream.md) | IRD / Tower 对接 |

## 四份源码位置

| 产品 | 路径 |
|------|------|
| Paas Console | `web/`、`server/` |
| csmctl | [`products/csmctl/`](../products/csmctl/) |
| vrctl-agent | [`products/vrctl-agent/`](../products/vrctl-agent/) |
| ipoe | [`products/ipoe/`](../products/ipoe/) |
