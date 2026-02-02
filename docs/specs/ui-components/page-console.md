--单个资源section----------------------------------
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
## 禁止添加border
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
