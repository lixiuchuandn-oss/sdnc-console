#!/bin/bash
# 快速修复数据库：如果数据库文件存在但没有表，启用同步并重启应用

DB_PATH="/root/compute-tower/data.sqlite"
APP_NAME="compute-tower"

echo "检查数据库文件..."
if [ -f "$DB_PATH" ]; then
    echo "数据库文件存在: $DB_PATH"
    # 检查是否有 users 表
    if ! sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='users';" 2>/dev/null | grep -q "users"; then
        echo "检测到数据库文件存在但没有 users 表，需要初始化..."
        echo "停止应用..."
        pm2 stop "$APP_NAME" || true
        pm2 delete "$APP_NAME" || true
        echo "启用数据库同步并重启应用..."
        cd /root/compute-tower
        DB_SYNC=true DB_PATH="$DB_PATH" NODE_ENV=production pm2 start dist/src/index.js --name "$APP_NAME"
        pm2 save
        echo "应用已重启，数据库表结构将自动创建"
        echo "等待 5 秒后检查应用状态..."
        sleep 5
        pm2 status
    else
        echo "数据库表已存在，无需修复"
    fi
else
    echo "数据库文件不存在，启用同步并重启应用..."
    pm2 stop "$APP_NAME" || true
    pm2 delete "$APP_NAME" || true
    cd /root/compute-tower
    DB_SYNC=true DB_PATH="$DB_PATH" NODE_ENV=production pm2 start dist/src/index.js --name "$APP_NAME"
    pm2 save
    echo "应用已重启，数据库将自动创建"
    sleep 5
    pm2 status
fi
