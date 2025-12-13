const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api-proxy',
    createProxyMiddleware({
      target: 'https://10.20.255.93:8016',
      changeOrigin: true,
      secure: false, // 忽略SSL证书验证
      pathRewrite: {
        '^/api-proxy': ''
      }
    })
  );
  app.use(
    '/ws/ssh',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
  app.use(
    '/ws/vnc',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
};