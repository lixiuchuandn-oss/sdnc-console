**使用时机**
当一级功能页面中，存在大量实例，需要通过列表进行展示时，需要引入 PageContainer 组件。
公共组件地址：D:\Compute.Tower\frontend\src\components\PageContainer.tsx

--页面顶部--------------------------------------------
# 页面顶部
## 1 面包屑，使用routespec 中的path 作为面包屑的文字，每个path之间用 / 隔开
## 2 主标题，使用routespec 中的icon 作为主标题的图标，后面跟着routespec 中的title 作为主标题的文字
## 3 副标题，使用routespec 中的subtitle 作为副标题的文字
## 4 Kpi卡片，展示该页面的主要指标，如实例数量、CPU 数量、内存数量等。受副标题折叠状态影响，当副标题折叠时，Kpi卡片不展示。
## 5 tabs标签，展示该页面的不同功能模块，如实例列表、日志列表等。每个tab 由 icon 图标、text 文字、该类型资源的数量 三部分组成。按需添加。

--tabs额外说明--------------------------------------------
# tabs标签组成
## icon 图标
## text 文字
## 该类型资源的数量，强制使用英文括号 ( ) 包裹
## 上述三者的gap:4px;
## 上述三者的未选中、选中、hover 状态的样式要一致

--页面表格----------------------------------
# 1. 工具栏
D:\Compute.Tower\frontend\src\components\SharedToolbar.tsx
## left 1：关键字Label（在上，字体14px，字体颜色#000000E0，paddingBottom 8px） + 关键字搜索（不要放大镜，在下）
## left n：各类的类型选择label（在上，字体14px，字体颜色#000000E0，paddingBottom 8px+ 下拉框（在下）
## left 末尾：重置，纯文字链接，底部对齐，总高度30px，无左右padding，无margin
## left 的组件 12px gap
## right 1 主要按钮，纯文字，无icon  （如没有则无需添加）
## right 2 批量操作菜单触发器，纯icon <EllipsisOutlined>，无文字  （如没有则无需添加）
## right 3 齿轮按钮（列表表头控制），纯icon <SettingOutlined>，无文字。
- 列选择弹窗改为可换行布局：500px 容器，flex-wrap+gap 控制；选项超宽时自动换行为多行显示。
- 批量操作菜单，一般操作和风险操作中间要有分隔线
## right 4 刷新按钮，纯icon <ReloadOutlined>，无文字 

# 2. 表格
## 禁止添加尺寸，使用表格的默认尺寸
## 禁止添加列宽
## 需要有 border
## 行操作菜单触发器 D:\Compute.Tower\frontend\src\components\ResourceActionsDropdown.tsx （如没有则无需添加），禁止修改其尺寸
### 查看元数据 点击后展开该实例的元数据
### 行操作菜单，一般操作和风险操作中间要有分隔线
## 禁止启用 showQuickJumper
