# 抖音直播互动打印服务（douyin-live-printer）

接收抖音直播小玩法的官方数据推送（点赞 / 评论 / 送礼 / 粉丝团 / 关注），通过**飞鹅云打印 API** 把互动内容输出到网络热敏打印机的小票上。

```
观众互动 → 抖音官方 Webhook(POST+签名) → 本服务(验签→去重→模板→队列) → 飞鹅云API → 热敏打印机
```

## 一、目录结构

```
douyin-live-printer/
├── .env.example        # 配置模板（复制为 .env 使用）
├── package.json
├── README.md
├── scripts/
│   └── verify-signature.js   # 验签算法自检（用官方示例数据）
└── src/
    ├── server.js       # HTTP 服务入口（零依赖）
    ├── config.js       # 配置加载（环境变量 / .env）
    ├── feie.js         # 飞鹅云打印 API 封装（签名、打印、查状态、绑机）
    ├── douyin.js       # 抖音 Webhook 验签 + 消息解析
    ├── templates.js    # 小票模板（点赞/评论/送礼/粉丝团/关注）
    ├── queue.js        # 内存打印队列（削峰 + 重试）
    └── printer.js      # 打印编排（事件→模板→入队）
```

## 二、快速开始

### 1. 准备配置

```bash
cd douyin-live-printer
cp .env.example .env
# 编辑 .env 填入 5 个关键项：
#   FEIE_USER / FEIE_UKEY   飞鹅开发者账号（developer.de.feieyun.com 免费注册，UKEY 在 admin.feieyun.com 个人中心）
#   PRINTER_SN / PRINTER_KEY  打印机底部标签的 SN 编号 + KEY 密钥（两个都要，缺 KEY 无法绑定打印机）
#   DOUYIN_SECRET           抖音数据推送配置中的签名秘钥
#   FEIE_API_BASE（可选）   飞鹅 API 地址，默认中国站 https://api.feieyun.cn/Api/Open/
```

### 2. 自检验签算法（不联网，确认实现正确）

```bash
node scripts/verify-signature.js   # 输出 PASS 即正确
```

### 3. 启动服务

```bash
node src/server.js    # 或 npm start
```

### 4. 联调验证（机器到手后）

```bash
# 一键诊断（推荐先跑这个，直接告诉你卡在哪）
node scripts/diagnose.js

# 查打印机是否在线
curl "http://localhost:8080/printers/status"

# 打一张测试票
curl -X POST "http://localhost:8080/test-print"

# 如果没绑定打印机，先绑机（sn/key 在机器底部标签）
curl -X POST "http://localhost:8080/printers/add?sn=SN编号&key=KEY密钥"

# 看队列统计
curl "http://localhost:8080/stats"
```

### 5. 模拟抖音推送（没有真数据时测试全链路）

```bash
# 用官方签名算法构造一次 live_gift 推送（secret 换成你 .env 里的 DOUYIN_SECRET）
# 参考 scripts/verify-signature.js 里的算法即可，验签失败会返回 401
curl -X POST http://localhost:8080/douyin/webhook \
  -H "Content-Type: application/json" \
  -H "x-nonce-str: 123456" \
  -H "x-timestamp: $(date +%s%3N)" \
  -H "x-roomid: 268" \
  -H "x-msg-type: live_gift" \
  -d '[{"msg_id":"1","nickname":"测试用户","gift_num":3,"gift_value":6600}]'
```

## 三、部署方式（抖音云推荐）

目标是"主播只用手机 + 打印机，不依赖电脑/自建服务器"，把本服务部署到**抖音云容器服务**：

1. 本仓库已内置 `Dockerfile`（零依赖 Node，直接构建）
2. 抖音云控制台 → 创建**容器服务** → 选择本目录按 Dockerfile 构建镜像
3. 在控制台配置环境变量（与 `.env.example` 一致）：`FEIE_USER` / `FEIE_UKEY` / `PRINTER_SN` / `PRINTER_KEY` / `DOUYIN_SECRET`（多主播再加 `PRINTER_ROOM_MAP`）
4. 抖音云服务暴露以下路由：
   - `POST /live_data_callback` — 抖音云**内网专线**推送互动指令（点赞/评论/送礼/粉丝团）→ 自动打印。**免域名备案、免公网 IP**，需按《弹幕玩法接入抖音云申请》飞书问卷开通内网专线
   - `POST /start_game` — 玩法客户端开播时调用，自动开启直播间推送任务（四类消息）
   - `POST /websocket_callback` — 抖音云 WebSocket 网关回调（后续语音播报下发预留）
5. 本地开发时用 `node src/server.js` + `scripts/simulate-push.js` 验证，无需抖音云

> 若内网专线未开通，可先走公网模式：抖音开放平台「数据推送」配置回调地址到容器服务的公网域名 `/douyin/webhook`（需域名备案，7–14 天）。

## 四、抖音平台配置

1. 通过**直播小玩法**创意提案后，在抖音开放平台「数据推送」中配置：
   - 回调地址：`http://<公网IP或域名>:8080/douyin/webhook`（需公网可达；本地联调可用内网穿透）
   - 签名秘钥：自定义一段字符串，填到 `.env` 的 `DOUYIN_SECRET`
2. 推送启动：小玩法被挂载后，调用平台的「启动数据推送任务」接口（`roomid + 玩法id + 消息类型`）
3. 收到推送后建议调用「互动数据履约上报」接口，保障推送可靠性

## 五、支持的事件与小票

| 事件类型 | 触发 | 小票内容 |
|---|---|---|
| `live_like` | 点赞（2s 合并一次） | ❤ 感谢点赞 ×N |
| `live_comment` | 评论 | 💬 昵称：内容 |
| `live_gift` | 送礼 | 🎁 昵称 送出 礼物 ×N、价值 ¥xx |
| `live_fansclub` | 加入/升级粉丝团 | 👑 昵称 加入粉丝团 · Lv.x |
| `live_follow` | 关注/取关（互动工具） | ⭐ 昵称 关注了主播 |

默认全部开启，可在 `.env` 的 `PRINT_EVENTS` 中增删。

## 六、注意事项

- **礼物名**：推送中的 `sec_gift_id` 是加密 ID，不含礼物名。可人工配置 `src/templates.js` 里的 `GIFT_NAMES` 映射，或后续接官方「获取礼物列表」接口
- **测试数据**：`payload.test === true` 的礼物是平台模拟数据，已在编排层过滤
- **去重**：推送可能重复，生产环境建议用 `msg_id` 做去重（当前示例可自行在 `handleEvent` 前加 Redis/内存 Set）
- **5000 字节**：单张小票内容上限 5000 字节，模板已控制长度
- **点赞刷屏**：内置 3 秒冷却（`LIKE_COOLDOWN_MS` 可调）
- **飞鹅站点（重要坑）**：飞鹅 API 分中国站 `api.feieyun.cn` / 亚太站 `api.jp.feieyun.com` / 欧洲站 `api.de.feieyun.com`。**中国大陆的打印机必须用中国站**，配错站点会表现为"查询永远离线、任务提交成功但打印不出"（实为任务发到了别的站点）。2026-01 起接口改为 URL 分流（接口名拼到路径），旧共用 URL 已于 2026-08-01 下线，本代码已适配
- **进房事件**：官方小玩法数据推送暂未提供"用户进入直播间"事件，如需打印进房欢迎，需向平台申请确认，或改用评论/点赞等事件做欢迎

## 七、生产化建议

- 队列：内存队列重启即丢，量产后换 Redis + BullMQ，或直接用抖音云队列
- 部署：可部署到抖音云 / 轻量云服务器（本服务零依赖，直接 `node src/server.js`）
- 兼容佳博：佳博云接口同为 HTTP 表单 + MD5 签名，如需切换，把 `feie.js` 的 `_request` 换成佳博 `sendMsg`（memberCode + 签名）即可，模板标签需按佳博语法调整
