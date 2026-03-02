# Harvester 列表组件租户侧适配指南

这份指南提供了将 Harvester 列表组件适配到租户侧（HarvesterConsole / CloudConsoleHarvester）的标准模式。通过统一的 `Props` 接口和渲染逻辑，实现管理端与租户侧的视图差异化控制。

## 1. 核心适配目标

*   **Border Control (`bordered`)**: 租户侧通常需要更简洁的无边框表格样式。
*   **Detail Access (`showYaml`)**: 租户侧通常不需要查看底层的 YAML 配置或复杂的 K8s 事件详情，因此需要隐藏这些入口。

## 2. 代码适配步骤

### Step 1: 扩展 Props 接口定义

在组件的 `Props` 接口中添加 `bordered` 和 `showYaml` 属性。

```typescript
interface Props {
  // ... 原有的 Props
  cloudId: string;
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  
  // [新增] 视图控制属性
  bordered?: boolean; // 控制表格边框 (默认 true)
  showYaml?: boolean; // 控制是否显示详情/YAML入口 (默认 true)
}
```

### Step 2: 设置默认值

在组件解构时为这两个属性设置默认值 `true`，以保持现有的管理端行为不变。

```typescript
const SomeSection: React.FC<Props> = ({ 
  cloudId, 
  loading, 
  onRefresh,
  // ... 其他属性
  bordered = true,  // [新增] 默认有边框
  showYaml = true   // [新增] 默认显示详情
}) => {
  // ...
```

### Step 3: 适配表格列渲染逻辑

**A. 名称列 (Name Column)**

修改名称列的 `render` 方法，根据 `showYaml` 决定是否渲染可点击链接。

```typescript
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name', 
      render: (_: any, r: any) => (
        showYaml ? (
          // 管理端：显示链接，点击打开详情抽屉
          <span className="cell-link" onClick={() => handleOpenDrawer(r)}>
            {r.name}
          </span>
        ) : (
          // 租户侧：仅显示纯文本
          <span>{r.name}</span>
        )
      )
    },
```

**B. 操作列 (Actions Column)**

将操作菜单项 (`items`) 改为动态生成，根据 `showYaml` 隐藏“资源详情”或“查看 YAML”选项。（label名称改为“查看YAML”）

```typescript
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      width: 80,
      render: (_: any, record: any) => {
        const items: any[] = [];
        
        // [关键逻辑] 仅在 showYaml 为 true 时添加详情入口
        if (showYaml) {
          items.push({ key: 'detail', label: '查看YAML', onClick: () => handleOpenDrawer(record) });
          items.push({ type: 'divider' as const });
        }
        
        // 其他通用操作 (如删除、编辑、恢复等)
        items.push({ key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) });
        
        return (
          <ResourceActionsDropdown 
            items={items}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
```

### Step 4: 绑定表格属性

将 `bordered` 属性传递给 Ant Design 的 `<Table>` 组件。

```typescript
      <Table
        className="std-table"
        bordered={bordered} // [关键逻辑] 绑定边框控制属性
        dataSource={dataSource}
        columns={columns}
        // ...
      />
```

## 3. 调用示例 (CloudConsoleHarvester.tsx)

在租户侧容器组件中调用列表组件时，显式传入 `false`。

```typescript
// src/pages/Clouds/Console/CloudConsoleHarvester.tsx

<SnapshotsSection
  snapshots={snapshots}
  loading={loading}
  onRefresh={onRefreshSnapshots}
  cloudId={cloudId}
  bordered={bordered} // 通常透传自 CloudConsoleHarvester 的 props
  showYaml={showYaml} // 通常透传自 CloudConsoleHarvester 的 props
/>
```

---
*Created by Trae AI Assistant*
