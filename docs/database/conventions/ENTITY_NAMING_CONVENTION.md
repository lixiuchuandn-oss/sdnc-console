# 后端实体与数据库命名规范

本文档定义了 `backend/src/entities` 目录下的 TypeORM 实体类、文件名以及对应数据库表结构的命名标准。旨在解决缩写词大小写不一致、表名风格混乱等问题。

## 1. 文件与类命名 (TypeScript)

### 1.1 基本原则
*   **风格**：**PascalCase** (大驼峰命名法)。
*   **缩写词处理**：**严格将缩写词视为普通单词**。
    *   ✅ 正确：`VrConfig`, `IpsecVpn`, `AclRule`, `VpcNetwork`
    *   ❌ 错误：`VRConfig`, `IPsecVPN`, `ACLRule`, `VPCNetwork`
*   **一致性**：文件名必须与导出的实体类名完全一致。

### 1.2 示例对照表

| 业务概念 | ❌ 旧命名 (不推荐) | ✅ 新命名规范 (PascalCase) | 文件名 |
| :--- | :--- | :--- | :--- |
| 虚拟路由器配置 | `VRConfig` | `VrConfig` | `VrConfig.ts` |
| 访问控制列表 | `ACLRule` | `AclRule` | `AclRule.ts` |
| IPsec VPN | `IPsecVPN` | `IpsecVpn` | `IpsecVpn.ts` |
| NAT 规则 | `NATRule` | `NatRule` | `NatRule.ts` |
| RBAC 角色 | `RBACRole` | `RbacRole` | `RbacRole.ts` |
| SRv6 隧道 | `Srv6Tunnel` | `Srv6Tunnel` | `Srv6Tunnel.ts` |

---

## 2. 数据库表命名 (Database Schema)

### 2.1 基本原则
*   **风格**：**snake_case** (全小写，下划线分隔)。
*   **前缀**：
    *   **业务模块前缀**（推荐）：对于特定领域的表，建议加上模块前缀以避免冲突。
    *   例如：`vr_` (虚拟路由相关), `sys_` (系统管理相关), `net_` (网络基础)。
*   **单复数**：建议统一使用 **单数** (Singular) 形式（或者严格遵循 TypeORM 的默认复数策略，但需全项目统一）。鉴于现有 `vr_config` 等表，**推荐统一使用单数**。

### 2.2 实体装饰器配置
必须在 `@Entity` 装饰器中显式指定 `name` 属性，不依赖自动生成，确保代码重构不影响数据库表名。

```typescript
// ✅ 推荐写法
@Entity({ name: 'vr_config' })
export class VrConfig { ... }

// ❌ 不推荐 (依赖自动生成，重构类名会导致表名改变)
@Entity()
export class VrConfig { ... }
```

### 2.3 常用表名映射示例

| 实体类名 (PascalCase) | 数据库表名 (snake_case) | 说明 |
| :--- | :--- | :--- |
| `VrConfig` | `vr_config` | VR 配置主表 |
| `IpsecVpn` | `vr_ipsec_vpn` | 加上 `vr_` 前缀表明从属关系 |
| `AclRule` | `net_acl_rule` | 通用网络规则 |
| `User` | `sys_user` | 系统用户表 |
| `Tenant` | `sys_tenant` | 租户表 |

---

## 3. 字段与列命名

### 3.1 属性名 (Class Property)
*   **风格**：**camelCase** (小驼峰)。
*   **示例**：`createTime`, `ipAddress`, `userId`。

### 3.2 数据库列名 (Column Name)
*   **风格**：**snake_case**。
*   **映射**：使用 `@Column({ name: '...' })` 显式映射，或者配置 TypeORM 的 `NamingStrategy` 自动转换。
*   **推荐**：显式映射更安全。

```typescript
@Column({ name: 'create_time' })
createTime: Date;

@Column({ name: 'ip_address', length: 64 })
ipAddress: string;
```

---

## 4. 重构计划 (TODO)

针对现有代码库的清理建议：

1.  **第一阶段 (Rename Files & Classes)**:
    *   `VRConfig.ts` -> `VrConfig.ts`
    *   `VRListCache.ts` -> `VrListCache.ts`
    *   `ACLRule.ts` -> `AclRule.ts`
    *   `NATRule.ts` -> `NatRule.ts`
    *   `RBACRole.ts` -> `RbacRole.ts`
    *   `IPsecVPN.ts` -> `IpsecVpn.ts`

2.  **第二阶段 (Verify Table Names)**:
    *   检查所有 `@Entity` 装饰器，确保 `name` 属性已固定，防止类名修改导致 TypeORM 试图创建新表。
