Login hero background (/login 与 /admin/login 共用样式):

  默认不加载 public 下背景图，仅使用系统设置中的背景色/渐变（避免内置图水印等问题）。

  需要背景图时，在构建或运行环境设置：
  REACT_APP_LOGIN_HERO_IMAGE=/images/your.png
  （相对于 public；也可填完整 URL。）
