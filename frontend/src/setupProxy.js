const { createProxyMiddleware } = require('http-proxy-middleware');

// /api-proxy 必须由 Compute Tower 后端处理（含 POST /api-proxy/api/sign），再由后端转发 CSMCTL。
// Express 在 app.use('/api-proxy', proxy) 里会把 req.url 裁成「去掉 /api-proxy 之后」的路径，
// 代理默认会转发成 target + /api/sign，后端实际只认 /api-proxy/api/sign，必须 pathRewrite 把前缀加回。
const towerBackend =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_DEV_TOWER_BACKEND ||
  process.env.REACT_APP_DEV_BACKEND ||
  'http://127.0.0.1:5001';

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      secure: false,
    }),
  );
  app.use(
    '/api-proxy',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      secure: false,
      pathRewrite: (path) => '/api-proxy' + path,
    })
  );
  app.use(
    '/ws/ssh',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
  app.use(
    '/ws/vnc',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
  // KubeVirt / Harvester：noVNC 走 /ws/kv-vnc；未配置时浏览器连 :5000 会握手失败（closed before established）
  app.use(
    '/ws/kv-vnc',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
  app.use(
    '/ws/kv-pod-log',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
  app.use(
    '/ws/kv-pod-exec',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
};
