const webpack = require('webpack');

function override(config, env) {
  config.resolve.fallback = {
    ...config.resolve.fallback,
    "https": false,
    "http": false,
    "tls": false,
    "net": false,
    "path": false,
    "fs": false,
  };
  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
  ];

  // Enable Top-level await for @novnc/novnc
  config.experiments = {
    ...config.experiments,
    topLevelAwait: true,
  };

  return config;
}

function devServer(configFunction) {
  return function (proxy, allowedHost) {
    const config = configFunction(proxy, allowedHost);
    config.allowedHosts = 'all';
    config.host = process.env.HOST || '127.0.0.1';
    return config;
  };
}

module.exports = { webpack: override, devServer };