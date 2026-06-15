Cloudmap / Tower 镜像直传桌面工具（ImageUploader.exe）

构建
  Windows: 在 tools/uploader 目录执行 build.bat，或参考 Makefile / go build。
  将生成的 ImageUploader.exe 放到以下路径之一（后端从此处下发）：
    - <backend 工作目录>/tools/uploader/ImageUploader.exe
    - <仓库根>/tools/uploader/ImageUploader.exe（从 backend 目录启动时会尝试上一级）

下载
  浏览器访问后端：GET /api/tools/imageuploader.exe（需与前端同源或已配置 API 地址）。
