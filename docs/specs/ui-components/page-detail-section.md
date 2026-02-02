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
## 禁止启用 showQuickJumper
