# Harvester 列表组件租户侧适配指南

这份指南提供了将 Harvester 列表组件适配到租户侧（HarvesterConsole / CloudConsoleHarvester）的标准模式。通过统一的 `Props` 接口和渲染逻辑，实现管理端与租户侧的视图差异化控制。

## 1. 核心适配目标

*   **Border Control (`bordered`)**: 租户侧通常需要更简洁的无边框表格样式。
*   **Detail Access (`showYaml`)**: 租户侧通常不需要查看底层的 YAML 配置或复杂的 K8s 事件详情，因此需要隐藏这些入口。
*   **System Resources Visibility (`showSys` / `isTenant`)**: 
    *   **租户模式 (`isTenant=true`)**: 强制隐藏系统级资源（如 `harvester-system`, `longhorn-system` 等命名空间下的资源），且不提供查看选项。
    *   **管理员模式**: 默认隐藏系统级资源，但提供复选框允许管理员手动查看。

## 2. 代码适配步骤

### Step 1: 扩展 Props 接口定义

在组件的 `Props` 接口中添加 `bordered`, `showYaml`, `showSys`, `isTenant` 属性。

```typescript
interface Props {
  // ... 原有的 Props
  cloudId: string;
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  
  // [新增] 视图控制属性
  bordered?: boolean; // 控制表格边框 (默认 true)
  showYaml?: boolean; // 控制是否显示详情/YAML入口 (默认 true)
  showSys?: boolean;  // [已废弃，逻辑合并入 isTenant] 是否允许显示系统资源开关 (默认 true)
  isTenant?: boolean; // 是否为租户模式 (租户模式下强制过滤系统和公共卷，且隐藏开关)
}
```

### Step 2: 设置默认值与状态

在组件解构时设置默认值，并初始化控制系统资源显示的状态。

```typescript
const SomeSection: React.FC<Props> = ({ 
  cloudId, 
  loading, 
  onRefresh,
  // ... 其他属性
  bordered = true,
  showYaml = true,
  isTenant = false,
  showSys = true
}) => {
  // [状态] 控制系统资源显示的开关 (默认关闭)
  const [showSystemResources, setShowSystemResources] = useState<boolean>(false);
  
  // ...
```

### Step 3: 实现数据过滤逻辑

在 `filtered` 或 `dataSource` 的计算逻辑中，加入对系统资源的过滤。

```typescript
  const filtered = useMemo(() => {
    return (data || []).filter((r: any) => {
      const ns = r.namespace; // 获取命名空间
      
      // [关键逻辑] 系统资源过滤
      // 1. 租户模式: 强制过滤系统命名空间和公共命名空间
      if (isTenant && (isSystemNamespace(ns) || isPublicNamespace(ns))) return false;
      
      // 2. 管理员模式: 仅在未勾选"显示系统资源"时过滤系统命名空间
      if (!isTenant && !showSystemResources && isSystemNamespace(ns)) return false;

      // ... 其他过滤逻辑 (关键字, 状态等)
      return true;
    });
  }, [data, isTenant, showSystemResources, /* ... */]);
```

### Step 4: 实现命名空间下拉选项过滤

确保命名空间筛选器的选项列表也遵循相同的过滤规则。

```typescript
// 下拉框 options 逻辑
options={namespacesOptions.filter(ns => {
  // 租户模式: 过滤系统和公共命名空间
  if (isTenant && (isSystemNamespace(ns) || isPublicNamespace(ns))) return false;
  // 管理员模式: 根据开关决定是否显示系统命名空间
  if (!isTenant && !showSystemResources && isSystemNamespace(ns)) return false;
  return true;
}).map(ns => ({ value: ns, label: ns }))}
```

### Step 5: 添加工具栏控制开关

在工具栏（通常是左侧筛选区）添加控制复选框。

```typescript
// Toolbar 渲染部分
<div className="toolbar-left">
  {/* 其他筛选器 ... */}
  
  {/* [关键逻辑] 仅在非租户模式下显示控制开关 */}
  {!isTenant && (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Checkbox 
        checked={showSystemResources} 
        onChange={(e: any) => setShowSystemResources(e.target.checked)}
      >
        显示系统资源
      </Checkbox>
    </div>
  )}
</div>
```

### Step 6: 适配表格列渲染逻辑 (同前)

**A. 名称列 (Name Column)**

```typescript
    { 
      title: '名称', 
      render: (_: any, r: any) => (
        showYaml ? (
          <span className="cell-link" onClick={() => handleOpenDrawer(r)}>
            {r.name}
          </span>
        ) : (
          <span>{r.name}</span>
        )
      )
    },
```

**B. 操作列 (Actions Column)**

```typescript
    {
      title: '操作',
      render: (_: any, record: any) => {
        const items: any[] = [];
        if (showYaml) {
          items.push({ key: 'detail', label: '查看YAML', onClick: () => handleOpenDrawer(record) });
          items.push({ type: 'divider' as const });
        }
        // ... 其他操作
        return <ResourceActionsDropdown items={items} />;
      },
    },
```

## 3. 调用示例 (CloudConsoleHarvester.tsx)

```typescript
<SomeSection
  // ...
  bordered={false}
  showYaml={false}
  isTenant={true} // 标记为租户视图
/>
```

## 4. 特殊组件注意事项

### SSH Keys (SshKeysSection)

*   **严格禁止查看详情/YAML**: SSH 密钥包含敏感元数据，租户侧**必须**屏蔽所有查看详情的入口。
*   **交互限制**: 在 `SshKeysSection` 中，**必须**移除“名称”列的点击事件（`onClick`）和链接样式（`.cell-link`），防止租户误入详情页查看原始 YAML 数据。
*   **指纹列**: 如果数据为空，直接移除该列，避免展示无意义的空白。
*   **字体规范**: 密钥 ID 等技术字段应使用 `.std-code` 样式以区分普通文本。
