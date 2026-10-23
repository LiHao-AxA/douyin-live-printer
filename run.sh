#!/bin/sh
# 抖音云容器服务固定以 /opt/application/run.sh 启动服务（平台命令：ulimit ... && /opt/application/run.sh）
# 本项目零依赖 Node，无需 npm install
set -e
cd /app
exec node src/server.js
