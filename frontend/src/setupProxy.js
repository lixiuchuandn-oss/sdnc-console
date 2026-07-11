const { createProxyMiddleware } = require('http-proxy-middleware');

const towerBackend =
  process.env.REACT_APP_API_URL ||
  process.env.REACT_APP_DEV_TOWER_BACKEND ||
  process.env.REACT_APP_DEV_BACKEND ||
  'http://127.0.0.1:5001';

module.exports = function (app) {
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
    }),
  );
  app.use(
    '/ws',
    createProxyMiddleware({
      target: towerBackend,
      changeOrigin: true,
      secure: false,
      ws: true,
    }),
  );
};
