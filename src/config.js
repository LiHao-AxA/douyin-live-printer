'use strict';
/**
 * 配置加载：优先取环境变量，其次取项目根目录 .env 文件（复制 .env.example 改名）
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  const env = {};
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx <= 0) continue;
      const key = t.slice(0, idx).trim();
      let value = t.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    /* 没有 .env 文件则跳过，只依赖环境变量 */
  }
  return env;
}

const envFile = loadEnvFile(path.join(__dirname, '..', '.env'));

function get(name, fallback) {
  if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name];
  if (envFile[name] !== undefined) return envFile[name];
  return fallback;
}

/** 解析多主播映射：PRINTER_ROOM_MAP = {"roomid1":"SN1","roomid2":"SN2"} */
function parseRoomMap(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

const config = {
  port: parseInt(get('PORT', '8000'), 10),
  feie: {
    user: get('FEIE_USER', ''),
    ukey: get('FEIE_UKEY', ''),
    apiBase: get('FEIE_API_BASE', 'https://api.feieyun.cn/Api/Open/'),
  },
  douyin: {
    secret: get('DOUYIN_SECRET', ''),
    webhookPath: get('DOUYIN_WEBHOOK_PATH', '/douyin/webhook'),
    timestampToleranceMs: parseInt(get('DOUYIN_TOLERANCE_MS', '300000'), 10),
  },
  printer: {
    sn: get('PRINTER_SN', ''),
    // 打印机底部标签上的 KEY（飞鹅绑机需要 SN + KEY 两个凭证，KEY 不是开发者 UKEY）
    key: get('PRINTER_KEY', ''),
    // 多主播映射：{"直播间id":"打印机SN"}，互动事件按直播间路由到对应打印机；未匹配用 PRINTER_SN
    roomMap: parseRoomMap(get('PRINTER_ROOM_MAP', '')),
    enabled: get('PRINTER_ENABLED', 'true') === 'true',
    events: get('PRINT_EVENTS', 'live_like,live_comment,live_gift,live_fansclub')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    likeCooldownMs: parseInt(get('LIKE_COOLDOWN_MS', '3000'), 10),
  },
};

module.exports = config;
