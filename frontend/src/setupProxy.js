const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api-proxy',
    createProxyMiddleware({
      target: 'https://47.111.13.103:8016',
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
      target: 'http://localhost:5001',
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
  app.use(
    '/ws/vnc',
    createProxyMiddleware({
      target: 'http://localhost:5001',
      changeOrigin: true,
      ws: true,
      secure: false,
    })
  );
};
