# Tower 底座 CRD 规格：安全组

> **交付对象**：Harvester / 底座（K8s API 扩展）维护方  
> **来源**：Tower 现网 SQLite 模型与 HTTP API（`kube_ovn_security_groups*`）  
> **参考 CR**：`hms.rivercloud.com/v1` · `Switch`（集群级、spec 持久化）  
> **示例清单**：[`tower-crd-examples/`](./tower-crd-examples/)

> **说明**：**部署集（DeploymentSet）CRD 暂不交付**——Tower 侧部署集功能仍在调整，待产品定稿后再单独出 CRD 规格。本文仅含 **SecurityGroup**。

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **与 HMS Switch 对齐** | API 组 `tower.rivercloud.com/v1`、**Cluster 作用域**、标准 CRUD |
| **与 Tower 字段 1:1** | spec 字段名、枚举、校验与 Tower 后端一致 |
| **稳定主键** | `metadata.name` 建议用 Tower 资源 UUID |
| **按云实例隔离** | 必填 `spec.cloudId`；列表用 label `tower.io/cloud-id` |
| **嵌套 spec** | `spec.rules` / `spec.members` 同 CR（对应 Tower「整表替换 rules」） |

**不在 CR 内建模**：安全组 → Kube-OVN 扁平子网 `Subnet.spec.acls` 展开下发（Tower 现逻辑在 `kubeOvnSecurityGroupAclPush`）；底座 controller 可选写 `status.aclSync`，或仍由 Tower BFF 触发。

---

## 2. API 总览

| Kind | Plural | 作用域 | 说明 |
|------|--------|--------|------|
| `SecurityGroup` | `securitygroups` | Cluster | Kube-OVN 扁平子网安全组（规则 + VM 成员） |

```text
apiVersion: tower.rivercloud.com/v1
kind: SecurityGroup
metadata:
  name: <tower-resource-uuid>
  labels:
    tower.io/cloud-id: <cloudId>
    tower.io/managed-by: tower
spec: ...
status: ...
```

**HTTP 路径**：

```text
GET/POST    /apis/tower.rivercloud.com/v1/securitygroups
GET/PUT/PATCH/DELETE /apis/tower.rivercloud.com/v1/securitygroups/{name}
```

---

## 3. SecurityGroup

### 3.1 业务含义（Tower 现网）

- 作用于 **Kube-OVN 扁平子网**（`Subnet` 注解 `tower.io/subnet-type=flat`）。
- **唯一键**：`(cloudId, subnetName, name)`。
- **规则**：与 `Subnet.spec.acls[]` 单条结构一致；Tower 按成员 IP 展开后合并写入子网 ACL（priority 区间 31000–39999）。
- **成员**：`(vmNamespace, vmName)` 唯一。

### 3.2 spec 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 推荐 | Tower UUID，同 metadata.name |
| `cloudId` | string | 是 | 资源池 ID |
| `name` | string | 是 | 组名，≤128 字符 |
| `description` | string | 否 | 描述 |
| `subnetName` | string | 是 | Kube-OVN Subnet `metadata.name` |
| `rules` | []Rule | 否 | 访问控制规则（整组替换） |
| `members` | []Member | 否 | 绑定的 VM |

**Rule**：`priority`、`direction`（`from-lport`|`to-lport`）、`action`（`drop`|`allow`|`pass`）、`match`。

语义（Tower 强制）：

- `from-lport`：`match` 不得含 `ip4.dst`
- `to-lport`：`match` 不得含 `ip4.src`

**Member**：`vmNamespace`、`vmName`（可选 `id`）。

### 3.3 status 字段（controller 可选）

| 字段 | 说明 |
|------|------|
| `ruleCount` / `memberCount` | 与 spec 同步 |
| `aclSync` | 最近 ACL 下发状态 |
| `conditions[]` | 标准 condition |

### 3.4 Tower HTTP 映射

| Tower API | CR 操作 |
|-----------|---------|
| `GET .../kube-ovn-security-groups` | list + filter cloudId |
| `GET .../kube-ovn-security-groups/:sgId` | get |
| `POST .../kube-ovn-security-groups` | create |
| `PUT .../kube-ovn-security-groups/:sgId` | patch name/description |
| `PUT .../kube-ovn-security-groups/:sgId/rules` | 替换 `spec.rules` |
| members API | 更新 `spec.members` |

---

## 4. CRD 与样例

- [`tower-crd-examples/crd-securitygroups.yaml`](./tower-crd-examples/crd-securitygroups.yaml)
- [`tower-crd-examples/securitygroup-sample.yaml`](./tower-crd-examples/securitygroup-sample.yaml)

---

## 5. 验收清单

- [ ] 注册 `tower.rivercloud.com/v1` · `SecurityGroup` CRD
- [ ] Cluster 作用域 CRUD 可用
- [ ] 规则枚举与 match 语义校验；成员重复 409
- [ ] label `tower.io/cloud-id` 可按云实例 list
- [ ] 与 Tower 示例 YAML round-trip 一致

---

## 6. 部署集（暂缓）

部署集 CRD **不在本次范围**。Tower 仍使用 SQLite `cloud_deployment_sets` 与 HTTP API：

- `GET/POST/PUT/DELETE /api/clouds/:id/resources/harvester/deployment-sets*`

功能定稿后另出 `DeploymentSet` CRD 文档，不与本文混交。
