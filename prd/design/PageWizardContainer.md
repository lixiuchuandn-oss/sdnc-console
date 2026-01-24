**使用时机**
当一级功能页面中，所管理的实例的创建非常复杂时，需要引入 PageDetailContainer 组件，对其进行详细创建。如点击某实例的创建按钮
该组件包含了页面顶部、tabs 标签、多个资源section 等内容。
公共组件地址：D:\Compute.Tower\frontend\src\components\PageDetailContainer.tsx

--页面顶部--------------------------------------------
# 页面顶部
## 1 面包屑，使用routespec 中的path 作为面包屑的文字，每个path之间用 / 隔开
## 2 主标题
### 使用routespec 中的icon 作为主标题的图标，后面跟着routespec 中的title 作为主标题的文字
### right 1 返回上一级按钮，icon <ArrowLeftOutlined> 文字 返回
## 3 副标题，使用routespec 中的subtitle 作为副标题的文字
