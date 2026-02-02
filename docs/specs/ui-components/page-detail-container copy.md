**使用时机**
当一级功能页面中，所管理的实例的属性非常复杂时，需要引入 PageDetailContainer 组件，对其进行详细描述。如点击某实例详情按钮
该组件包含了页面顶部、tabs 标签、多个资源section 等内容。
公共组件地址：D:\Compute.Tower\frontend\src\components\PageDetailContainer.tsx

--页面顶部--------------------------------------------
# 页面顶部
## 1 面包屑，使用routespec 中的path 作为面包屑的文字，每个path之间用 / 隔开
## 2 主标题
### 使用routespec 中的icon 作为主标题的图标，后面跟着routespec 中的title 作为主标题的文字
### right 1 返回上一级按钮，纯icon <ArrowLeftOutlined>
### right 2 菜单触发器，纯icon <CodeOutlined />
- 资源刷新，点击后刷新该实例的所有子资源
- 显示日志，点击后展开该实例所有子资源的log
## 3 副标题，使用routespec 中的subtitle 作为副标题的文字
## 4 详情表格，展示该实例的详细属性，如实例状态、CPU 数量、内存数量等。受副标题折叠状态影响，当副标题折叠时，详情表格不展示。

--tabs--------------------------------------------
# tabs标签组成
## icon 图标
## text 文字
## 该类型资源的数量，强制使用英文括号 ( ) 包裹
## 上述三者的gap:4px;
## 上述三者的未选中、选中、hover 状态的样式要一致

--单个资源section----------------------------------
公共组件地址：D:\Compute.Tower\frontend\src\components\PageDetailSection.tsx

# 1. 工具栏
D:\Compute.Tower\frontend\src\components\SharedToolbar.tsx
## left 关键字搜索（不要放大镜），以及各类的类型选择下拉框
## right 1 主要按钮，纯文字，无icon  （如没有则无需添加）
## right 2 批量操作菜单触发器，纯icon <EllipsisOutlined>，无文字  （如没有则无需添加）
- 批量操作菜单，一般操作和风险操作中间要有分隔线
## right 3 齿轮按钮（列表表头控制），纯icon <SettingOutlined>，无文字。
- 列选择弹窗改为可换行布局：720px 容器，flex-wrap+gap 控制；选项超宽时自动换行为多行显示。
- 禁止添加标题
## right 4 刷新按钮，纯icon <ReloadOutlined>，无文字 

# 2. 表格
## 禁止添加尺寸，使用表格的默认尺寸
## 禁止添加列宽
## 需要有 border
## D:\ComputeTower\Compute.Tower\frontend\src\utils\tableStyles.ts 中定义了表格的样式
## 行操作菜单触发器 D:\ComputeTower\Compute.Tower\frontend\src\components\ResourceActionsDropdown.tsx （如没有则无需添加），禁止修改其尺寸
### 行操作菜单，一般操作和风险操作中间要有分隔线
### 行操作菜单，禁止添加icon
### 查看元数据 点击后展开该实例的元数据（从第三方平台接入的数据才需要元数据）
#### 元数据展示窗口样式规范
- **弹窗属性**：
  - 标题：固定为“元数据查看”
  - 宽度：800px
  - Footer：设置为 `null`（不显示底部按钮）
- **内容布局**：
  - 使用 `Tabs` 组件进行多数据源展示（如：CSMCTL 原始数据、VRCTL 数据等）
- **数据展示区域**：
  - 组件：使用 `Input.TextArea`
  - 属性配置：
    - `readOnly`: true
    - `autoSize`: `{ minRows: 10, maxRows: 20 }`
  - 样式 (`style`)：
    - `fontFamily`: `'monospace'` (等宽字体，便于代码阅读)
    - `backgroundColor`: `'#f5f5f5'` (浅灰色背景，区分只读状态)
## 禁止启用 showQuickJumper
