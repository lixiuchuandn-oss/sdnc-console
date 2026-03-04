# Harvester 列表组件租户侧适配指南

这份指南提供了将 Harvester 列表组件适配到租户侧（HarvesterConsole / CloudConsoleHarvester）的标准模式。通过统一的 `isTenant` 属性，实现管理端与租户侧的视图差异化控制。

## 1. 核心适配目标

*   **View Mode (`isTenant`)**: 通过单一的 `isTenant` 属性来控制组件的渲染模式，减少冗余的 Props。
*   **Border Control**: 
    *   **管理员模式**: 默认有边框 (`bordered=true`)。
    *   **租户模式**: 默认无边框 (`bordered=false`)，以适应 Console 页面的卡片式布局。
*   **Detail Access**: 
    *   **管理员模式**: 提供 YAML 查看入口和底层详情。
    *   **租户模式**: 隐藏底层的 YAML 配置和复杂的 K8s 事件详情，仅展示业务相关信息。
*   **System Resources Visibility**: 
    *   **管理员模式**: 默认隐藏系统级资源，但提供复选框允许管理员手动查看。
    *   **租户模式**: 强制隐藏系统级资源（如 `harvester-system`, `longhorn-system` 等命名空间下的资源），且隐藏控制开关。

## 2. 代码适配步骤

### Step 1: 扩展 Props 接口定义

在组件的 `Props` 接口中仅添加 `isTenant` 属性。移除过时的 `bordered`, `showYaml`, `showSys` 属性。

```typescript
interface Props {
  // ... 原有的 Props (cloudId, loading, onRefresh 等)
  
  // [新增] 视图控制属性
  isTenant?: boolean; // 是否为租户模式
}
```

### Step 2: 组件内部逻辑适配

在组件内部，根据 `isTenant` 推导其他控制状态。

```typescript
const SomeSection: React.FC<Props> = ({ 
  cloudId, 
  loading, 
  onRefresh,
  // ... 其他属性
  isTenant = false,
}) => {
  // [状态] 控制系统资源显示的开关 (默认关闭)
  const [showSystemResources, setShowSystemResources] = useState<boolean>(false);
  
  // [推导] 视图控制变量
  const bordered = !isTenant; // 租户模式无边框
  const showYaml = !isTenant; // 租户模式不显示 YAML
  
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

### Step 6: 适配表格列渲染逻辑

**A. 名称列 (Name Column)**

```typescript
    { 
      title: '名称', 
      render: (_: any, r: any) => (
        // 禁止添加 Link。Opsinfo（Opsinfo=HarvesterOpsinfoDrawer.tsx抽屉，禁止修改此文件） 入口仅通过行操作菜单提供。Opsinfo是运维版本，是面向管理员的
        // 可以添加 资源详情 入口，资源详情是美化版本，是面向租户的
        <span>{r.name}</span>
      )
    },
```

**B. 操作列 (Actions Column)**

```typescript
    {
      title: '操作',
      render: (_: any, record: any) => {
        const items: any[] = [];
        // 仅在非租户模式下显示 Opsinfo 选项（Opsinfo=HarvesterOpsinfoDrawer.tsx抽屉）
        if (!isTenant) {
          items.push({ key: 'detail', label: 'Opsinfo', onClick: () => handleOpenDrawer(record) });
        }
        // ... 其他操作
        return <ResourceActionsDropdown items={items} />;
      },
    },
```

### Step 7: 表格渲染

```typescript
<Table
  // ...
  bordered={!isTenant} // 租户模式无边框
/>
```

## 3. 调用示例 (CloudConsoleHarvester.tsx)

```typescript
<SomeSection
  // ...
  isTenant={true} // 仅需标记为租户视图，无需传递 bordered/showYaml
/>
```
