Login hero background（/login 与 /admin/login 共用，见 `frontend/src/pages/auth/loginPageHeroStyle.ts`）：

  默认使用本目录下 `login-hero-light.png`（浅色极简风：左侧 3D 算力塔 + 多云连接，右侧留白衬右侧白卡）。
  旧的深色太空插画仍保留为 `login-hero.png`，可经环境变量切回。

  覆盖：构建或运行环境设置
  REACT_APP_LOGIN_HERO_IMAGE=/images/your.png
  （相对于 public；也可填完整 URL。）

  关闭背景图（仅使用系统设置中的背景色/渐变）：
  REACT_APP_LOGIN_HERO_IMAGE=none
