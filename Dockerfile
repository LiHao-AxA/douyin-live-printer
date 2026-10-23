# 抖音云容器服务部署镜像（零依赖 Node 服务）
# 部署步骤：抖音云控制台 → 创建容器服务 → Git 部署 → Dockerfile 路径填 Dockerfile
# 环境变量在抖音云控制台配置，勿将 .env 提交/打进镜像
FROM node:20-alpine

WORKDIR /app

# 项目零依赖，无需 npm install；拷贝源码与示例配置
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY .env.example ./

# 【关键】抖音云平台固定以 /opt/application/run.sh 启动服务（命令：ulimit ... && /opt/application/run.sh），
# 不执行 Dockerfile 的 CMD；缺此文件会报 exit status 127 / run.sh not found
# 平台 FaaS 探测 8000 端口，服务必须监听 8000（config.js 默认 PORT=8000）
COPY run.sh /opt/application/run.sh
RUN chmod +x /opt/application/run.sh

EXPOSE 8000

CMD ["/opt/application/run.sh"]
