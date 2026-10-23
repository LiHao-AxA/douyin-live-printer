# 抖音云容器服务部署镜像（零依赖 Node 服务）
# 部署步骤：抖音云控制台 → 创建容器服务 → 选择本目录构建（Dockerfile 构建镜像）
# 环境变量在抖音云控制台配置，勿将 .env 提交/打进镜像
FROM node:20-alpine

WORKDIR /app

# 项目零依赖，无需 npm install；拷贝源码与示例配置
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY .env.example ./

EXPOSE 80

CMD ["node", "src/server.js"]
