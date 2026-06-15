# HMS 底座 CRD 规格：安全组与部署集

> **交付对象**：Harvester / 底座（K8s API 扩展）维护方  
> **权威原则**：**集群 CR 为唯一持久化真相**；Tower BFF 读写 CR，SQLite 表仅为历史兼容（将逐步下线）。  
> **API 组**：`hms.rivercloud.com/v1`（与 `Switch`、`MetricRule`、`DeploySet` 一致；**非** `tower.rivercloud.com`）  
> **参考实现**：`backend/src/services/hms/deploySetCr.ts`、`securityGroupCr.ts`

---

## 1. 设计原则

| 原则 | 说明 |
| ---- | ---- |
| **底座权威** | 列表/详情/增删改以集群 CR 为准；Tower 不得将 SQLite 当作唯一数据源冒充已同步 |
| **与 HMS 对齐** | API 组 `hms.rivercloud.com/v1`、**Cluster 作用域**、标准 CRUD |
| **按云实例隔离** | 安全组必填 `spec.cloudId`；列表用 label `tower.io/cloud-id` |
| **嵌套 spec** | 安全组 `spec.rules` / `spec.members` 同 CR（对应 Tower「整表替换 rules」） |

**ACL 下发**：安全组规则展开写入 Kube-OVN 扁平子网 `Subnet.spec.acls` 可由底座 controller 完成（写 `status.aclSync`），或 Tower BFF 在 CR 变更后触发（现 `kubeOvnSecurityGroupAclPush`）；**无论谁下发，CR spec 仍为权威**。

---

## 2. CRD 总览（现网底座）

| Kind | Plural | CRD | Tower 客户端 |
| ---- | ------ | --- | ------------ |
| `DeploySet` | `deploysets` | `deploysets.hms.rivercloud.com` | `deploySetCr.ts` · `deploymentSetService.ts` |
| `SecurityGroup` | `securitygroups` | `securitygroups.hms.rivercloud.com` | `securityGroupCr.ts`（BFF 迁移中） |

```text
apiVersion: hms.rivercloud.com/v1
kind: SecurityGroup
metadata:
  name: <uuid>
  labels:
    tower.io/cloud-id: <cloudId>
    tower.io/managed-by: tower
spec: ...
```

**HTTP 路径**：

```text
GET/POST    /apis/hms.rivercloud.com/v1/securitygroups
GET/PUT/PATCH/DELETE /apis/hms.rivercloud.com/v1/securitygroups/{name}
```

---

## 3. SecurityGroup

### 3.1 业务含义

- 作用于 **Kube-OVN 扁平子网**（`Subnet` 注解 `tower.io/subnet-type=flat`）。
- **唯一键**：`(cloudId, subnetName, name)`（逻辑名在 `spec.name`）。
- **规则**：与 `Subnet.spec.acls[]` 单条结构一致；按成员 IP 展开后合并写入子网 ACL（priority 31000–39999）。
- **成员**：`(vmNamespace, vmName)` 唯一。

### 3.2 spec 字段

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | string | 推荐 | Tower UUID，同 `metadata.name` |
| `cloudId` | string | 是 | 资源池 ID |
| `name` | string | 是 | 组名，≤128 字符 |
| `description` | string | 否 | 描述 |
| `subnetName` | string | 是 | Kube-OVN Subnet `metadata.name` |
| `rules` | []Rule | 否 | 访问控制规则（整组替换） |
| `members` | []Member | 否 | 绑定的 VM |

**Rule**：`priority`、`direction`（`from-lport` \| `to-lport`）、`action`（`drop` \| `allow` \| `pass`）、`match`。

**Member**：`vmNamespace`、`vmName`（可选 `id`）。

### 3.3 Tower HTTP 映射（BFF 保持不变，实现切 CR）

| Tower API | CR 操作 |
| --------- | ------- |
| `GET .../kube-ovn-security-groups` | list + filter `cloudId` |
| `GET .../kube-ovn-security-groups/:sgId` | get |
| `POST .../kube-ovn-security-groups` | create |
| `PUT .../kube-ovn-security-groups/:sgId` | patch name/description |
| `PUT .../kube-ovn-security-groups/:sgId/rules` | 替换 `spec.rules` |
| members API | 更新 `spec.members` |

**实现状态**：Tower BFF 已读写 `securityGroupCr`（`kubeOvnSecurityGroupCrService.ts`）；`kube_ovn_security_groups*` SQLite 表不再参与业务读写（仅历史表结构保留）。

---

## 4. DeploySet（部署集）

| Kind | Plural | CRD |
| ---- | ------ | --- |
| `DeploySet` | `deploysets` | `deploysets.hms.rivercloud.com` |

Tower 已以 CR 为权威：`deploymentSetService.ts` 读写 DeploySet CR；HTTP `.../deployment-sets*`。

**spec 要点**：`description`、`projectNamespace`、`sortOrder`、`podTemplateLabels`、`placement`（policy / strength / topologyKey）。

---

## 5. 验收清单

### SecurityGroup

- [x] 注册 `hms.rivercloud.com/v1` · `SecurityGroup` CRD（`securitygroups.hms.rivercloud.com`）
- [x] Tower BFF 列表/详情/写操作走 SecurityGroup CR
- [x] ACL 推送从 CR spec 展开（`kubeOvnSecurityGroupAclPush`）
- [ ] 规则枚举与 match 语义校验；成员重复 409
- [ ] label `tower.io/cloud-id` 可按云实例 list

### DeploySet

- [x] 注册 `deploysets.hms.rivercloud.com`
- [x] Tower BFF CRUD 走 DeploySet CR
- [x] E2E：`tests/harvester/deployment-sets/`

**探测命令**（需 `tests/.env` 与 backend 库）：

```bash
cd tests && node harvester/security-groups/api-crd-probe.api.test.cjs
```
