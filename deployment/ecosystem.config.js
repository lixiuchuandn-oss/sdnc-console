module.exports = {
  apps: [{
    name: "compute-tower-backend",
    script: "./dist/src/index.js",
    env: {
      NODE_ENV: "production",
      PORT: 5001,
      DB_SYNC: "true"
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
}
