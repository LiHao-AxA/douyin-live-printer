'use strict';
/**
 * 服务入口（零依赖，Node 原生 http）
 *
 * 路由：
 *   POST /douyin/webhook            抖音数据推送回调（公网模式：验签 → 分发 → 入队打印）
 *   POST /live_data_callback        抖音云内网专线回调（弹幕玩法：x-msg-type + 事件数组 → 打印）
 *   POST /start_game                玩法客户端开播时调用：开启直播间推送任务（抖音云内网环境生效）
 *   POST /websocket_callback        抖音云 WebSocket 网关回调（预留：后续语音播报下发）
 *   POST /test-print?sn=xxx         手动打一张测试票（联调用）
 *   POST /printers/add?sn=xxx&key=xxx 绑定打印机（机器底部 SN+KEY）
 *   GET  /printers/status?sn=xxx    查询打印机在线状态
 *   GET  /stats                     队列统计
 *   GET  /health                    健康检查
 */
const http = require('http');
const config = require('./config');
const { verifySignature, checkTimestamp, parsePush } = require('./douyin');
const { PrinterService } = require('./printer');
const { FEIE_ERROR_HINTS } = require('./feie');

let service;
try {
  service = new PrinterService(config);
} catch (e) {
  console.error(`[config] ${e.message}`);
  console.error('[config] 请先复制 .env.example 为 .env 并填写配置');
  process.exit(1);
}

// ---------------- 工具 ----------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('请求体超过 1MB'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 抖音云内网专线：开启直播间推送任务（点赞/评论/送礼/粉丝团）
 * 仅抖音云环境可访问 webcast.bytedance.com（内网免 access_token）；
 * 本地/公网环境会失败，属于正常现象，需部署到抖音云 + 开通内网专线后生效。
 */
async function startLiveDataTasks(appId, roomId) {
  const msgTypes = ['live_like', 'live_comment', 'live_gift', 'live_fansclub'];
  const results = [];
  for (const msgType of msgTypes) {
    const body = JSON.stringify({ roomid: roomId, appid: appId, msg_type: msgType });
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: 'webcast.bytedance.com', path: '/api/live_data/task/start', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => {
              try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); }
            });
          }
        );
        req.setTimeout(5000, () => req.destroy());
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      results.push({ msgType, ret: data.err_no === 0 ? 0 : -1, data });
    } catch (e) {
      results.push({ msgType, ret: -1, error: e.message });
    }
  }
  return results;
}

/** 互动指令统一分发：验签/解析 → 按直播间路由打印机 → 入队打印 */
function dispatchEvents(msgType, raw, roomId) {
  const events = parsePush(msgType, raw);
  return events.map(({ type, payload }) => ({
    type,
    ...service.handleEvent(type, payload, { roomId }),
  }));
}

// ---------------- 路由 ----------------

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { ok: true, queuePending: service.queue.pending });
  }

  if (req.method === 'GET' && path === '/stats') {
    return sendJson(res, 200, {
      pending: service.queue.pending,
      total: service.queue.total,
      failed: service.queue.failed,
      printerSn: config.printer.sn || '(未配置)',
      enabledEvents: config.printer.events,
    });
  }

  if (req.method === 'GET' && path === '/printers/status') {
    try {
      const data = await service.printerStatus(url.searchParams.get('sn'));
      return sendJson(res, 200, { ret: 0, data });
    } catch (e) {
      return sendJson(res, 200, { ret: -1, msg: e.message });
    }
  }

  if (req.method === 'POST' && path === '/test-print') {
    try {
      const orderId = await service.testPrint(url.searchParams.get('sn'));
      // 飞鹅订单状态有约 5 秒缓存，等 6 秒后再查：任务到底打印了没有
      await new Promise((r) => setTimeout(r, 6000));
      let printed = null;
      try {
        printed = await service.queryOrderState(orderId);
      } catch {
        /* 查询失败不阻断 */
      }
      let printerStatus = null;
      try {
        printerStatus = await service.printerStatus(url.searchParams.get('sn'));
      } catch {
        /* 状态查询失败不阻断 */
      }
      return sendJson(res, 200, {
        ret: 0,
        orderId,
        printed,
        printerStatus,
        tip:
          printed === true
            ? '飞鹅确认任务已打印 ✅ 若打印机没出纸，是设备端问题（缺纸/卡纸）'
            : printed === false
              ? '飞鹅确认任务尚未打印 ❌ 任务还在云端排队下发（设备在线状态/绑定通道问题）'
              : '订单状态查询失败，看 printerStatus 判断',
      });
    } catch (e) {
      return sendJson(res, 200, { ret: -1, msg: e.message, hint: FEIE_ERROR_HINTS[e.code] || null });
    }
  }

  if (req.method === 'POST' && path === '/printers/add') {
    try {
      const sn = url.searchParams.get('sn') || config.printer.sn;
      const key = url.searchParams.get('key') || config.printer.key;
      if (!sn || !key) {
        return sendJson(res, 400, { ret: -1, msg: '需要 sn 和 key 参数（打印机底部标签）', hint: '也可在 .env 配置 PRINTER_SN / PRINTER_KEY 后重启服务自动绑定' });
      }
      const data = await service.bindPrinter(sn, key);
      return sendJson(res, 200, { ret: 0, data, tip: '绑定成功，现在可以 POST /test-print 测试' });
    } catch (e) {
      return sendJson(res, 200, { ret: -1, msg: e.message, hint: FEIE_ERROR_HINTS[e.code] || null });
    }
  }

  if (req.method === 'POST' && path === '/live_data_callback') {
    // 抖音云内网专线回调（免域名备案）。headers: x-msg-type + body 事件数组
    const raw = (await readBody(req)).toString('utf8');
    const msgType = req.headers['x-msg-type'] || '';
    const roomId = req.headers['x-room-id'] || req.headers['x-roomid'] || '';
    const results = dispatchEvents(msgType, raw, roomId);
    return sendJson(res, 200, { ret: 0, received: results.length, results });
  }

  if (req.method === 'POST' && path === '/start_game') {
    const raw = (await readBody(req)).toString('utf8');
    let body = {};
    try { body = JSON.parse(raw); } catch { /* 非 JSON 忽略 */ }
    const appId = req.headers['x-tt-appid'] || body.appid || '';
    const roomId = req.headers['x-room-id'] || body.roomid || '';
    if (!appId || !roomId) {
      return sendJson(res, 400, { ret: -1, msg: '缺少 appid/roomid（请求头 X-TT-AppID / X-Room-ID，或 body 传 appid/roomid）' });
    }
    const results = await startLiveDataTasks(appId, roomId);
    const okCount = results.filter((r) => r.ret === 0).length;
    return sendJson(res, 200, {
      ret: 0,
      msg: okCount === results.length
        ? `已开启 ${results.length} 类推送任务`
        : `开启 ${okCount}/${results.length} 类成功；其余失败（部署到抖音云 + 开通内网专线后自动生效）`,
      results,
    });
  }

  if (req.method === 'POST' && path === '/websocket_callback') {
    // 抖音云 WS 网关回调：客户端建连/断连/上行。当前记录日志，后续用于语音播报下发
    const eventType = req.headers['x-tt-event-type'] || '';
    if (eventType) console.log(`[ws] ${eventType}`);
    return sendJson(res, 200, { ret: 0, msg: 'success' });
  }

  if (req.method === 'POST' && path === config.douyin.webhookPath) {
    const raw = (await readBody(req)).toString('utf8');

    // 1. 验签（body 必须用原始字符串，不能重新序列化）
    if (!verifySignature(req.headers, raw, config.douyin.secret)) {
      return sendJson(res, 401, { ret: -1, msg: '签名校验失败' });
    }
    // 2. 时间戳防重放
    if (!checkTimestamp(req.headers, config.douyin.timestampToleranceMs)) {
      return sendJson(res, 401, { ret: -1, msg: '时间戳超出容差，疑似重放' });
    }
    // 3. 拆条分发
    const msgType = req.headers['x-msg-type'] || '';
    const roomId = req.headers['x-room-id'] || req.headers['x-roomid'] || '';
    const results = dispatchEvents(msgType, raw, roomId);
    return sendJson(res, 200, { ret: 0, received: results.length, results });
  }

  sendJson(res, 404, { ret: -1, msg: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => sendJson(res, 500, { ret: -1, msg: e.message }));
});

server.listen(config.port, () => {
  console.log(`[server] 抖音直播互动打印服务已启动: http://localhost:${config.port}`);
  console.log(`[server] Webhook 回调地址: http://<公网或内网IP>:${config.port}${config.douyin.webhookPath}`);
  console.log(`[server] 打印机 SN: ${config.printer.sn || '(未配置 PRINTER_SN)'}`);
  console.log(`[server] 打印事件: ${config.printer.events.join(', ') || '(未启用)'}`);
  console.log('[server] 联调: POST /test-print 打测试票，GET /printers/status 查在线状态');
});

// 配置了 PRINTER_KEY 时启动即自动绑定（已绑定则幂等提示，不阻塞服务）
if (config.printer.sn && config.printer.key) {
  service
    .bindPrinter(config.printer.sn, config.printer.key)
    .then((data) => console.log('[server] 打印机绑定成功:', JSON.stringify(data)))
    .catch((e) => console.warn(`[server] 自动绑定提示（可能已绑定，可忽略）: ${e.message}`));
}
