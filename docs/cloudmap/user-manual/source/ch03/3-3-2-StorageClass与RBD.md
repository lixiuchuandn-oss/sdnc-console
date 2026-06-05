## 3.3.2 StorageClass 与 RBD Mirror

**参见白皮书**：3.3.5、3.3.7。

---

### 3.3.2.1 StorageClass

**Tab**：`集群 > 统一存储 > StorageClass`（`cluster/storage_classes`）

**适用角色**：`clouds.storage-classes:read` / write。

#### 查看

1. 列表：名称、**Provisioner**（如 `rancher.io/local-path`、`rook.rbd.csi.ceph.com`）、**回收策略**、是否 **默认**。
2. **Reload** 同步集群 SC。

#### 创建

1. 工具栏 **创建**。
2. 填写 **名称**、Provisioner 参数、**ReclaimPolicy**（Delete/Retain）、**VolumeBindingMode**。
3. **允许扩容** `allowVolumeExpansion`（若表单提供）。
4. **确定**；新建云盘/向导 **存储与磁盘** 可选该 SC。

#### 设为默认

行操作 **设为默认**（或编辑 annotation `storageclass.kubernetes.io/is-default-class`）。

**注意**：改默认 SC **不影响** 已有 PVC；仅影响新建卷。

#### 删除

须无 PVC 引用；删除有确认。

---

### 3.3.2.2 RBD Mirror

**Tab**：`集群 > 统一存储 > RBD Mirror`（`cluster/rbd_mirror`）

**场景**：Ceph **跨集群/跨池** RBD 镜像复制（灾备）。

1. **列表**：CephRBDMirror CR、Peer 状态、同步 lag。
2. **创建 / 编辑**（须 write）：
   - 配置 **peer 集群** 地址、Pool、Secret。
3. **详情 / YAML**：查看同步配置。
4. **Reload** 刷新 Rook bundle。

**前置**：两端 Ceph 已部署且网络互通；见白皮书 **3.3.7**。

---

### 3.3.2.3 与云盘的关系

| 操作                | 使用的 SC              |
| ------------------- | ---------------------- |
| **虚拟云盘 > 创建** | 下拉选 SC              |
| **创建向导数据盘**  | 默认 SC 或镜像绑定 SC  |
| **Ceph 部署向导**   | 步 4 创建/绑定 Rook SC |

存储健康与 Pool 见 **3.3.1**。
