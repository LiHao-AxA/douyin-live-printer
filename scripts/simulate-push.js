'use strict';
/**
 * 本地模拟抖音推送：向本地服务发送带正确签名的互动事件，验证全链路
 * （不用等抖音提案通过，就能看到打印机打出各种互动小票）
 *
 * 用法：
 *   node scripts/simulate-push.js              # 四类事件各发一条
 *   node scripts/simulate-push.js gift         # 只发一类事件
 *   node scripts/simulate-push.js gift 3       # 只发 3 条送礼
 *   node scripts/simulate-push.js all 2        # 每类各发 2 条
 *
 * 注意：需要 .env 里先随便填一个 DOUYIN_SECRET（验签用，正式接入时换成抖音配置的那个）
 */
const http = require('http');
const crypto = require('crypto');
const config = require('../src/config');

const TYPES = ['live_like', 'live_comment', 'live_gift', 'live_fansclub'];
const TYPE_ALIAS = {
  like: 'live_like',
  comment: 'live_comment',
  gift: 'live_gift',
  fansclub: 'live_fansclub',
  follow: 'live_follow',
};

function makePayload(type, i) {
  const base = { msg_id: `${type}-${i}-${Date.now()}`, nickname: `测试用户${i}`, timestamp: Date.now() };
  switch (type) {
    case 'live_like':
      return { ...base, like_num: 5 };
    case 'live_comment':
      return { ...base, content: '这个玩法太有意思了！' };
    case 'live_gift':
      return { ...base, gift_num: 3, gift_value: 6600, sec_gift_id: 'demo_gift' };
    case 'live_fansclub':
      return { ...base, fansclub_reason_type: 2, fansclub_level: 1 };
    case 'live_follow':
      return { ...base, use_follow_action: 1 };
    default:
      return base;
  }
}

function sign(headers, body, secret) {
  const keys = Object.keys(headers)
    .filter((k) => k.startsWith('x-') && k !== 'x-signature')
    .sort();
  const kv = keys.map((k) => `${k}=${headers[k]}`).join('&');
  return Buffer.from(crypto.createHash('md5').update(kv + body + secret, 'utf8').digest()).toString('base64');
}

function send(type, count) {
  const now = Date.now();
  const body = JSON.stringify(Array.from({ length: count }, (_, i) => makePayload(type, i + 1)));
  const headers = {
    'Content-Type': 'application/json',
    'x-msg-type': type,
    'x-nonce-str': 'simulate',
    'x-roomid': '888888',
    'x-timestamp': String(now),
  };
  headers['x-signature'] = sign(headers, body, config.douyin.secret);

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: config.port, method: 'POST', path: config.douyin.webhookPath, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  if (!config.douyin.secret) {
    console.error('❌ .env 里还没配置 DOUYIN_SECRET（先随便填一个字符串即可，正式接抖音时换成平台配置的秘钥）');
    process.exit(1);
  }

  const arg = process.argv[2] || 'all';
  const count = parseInt(process.argv[3] || '1', 10);
  const types = arg === 'all' ? TYPES : [TYPE_ALIAS[arg] || arg];

  console.log(`→ 发送事件: ${types.join(', ')} × ${count}（验签用 DOUYIN_SECRET 模拟）\n`);
  for (const type of types) {
    try {
      const res = await send(type, count);
      console.log(`[${type}] HTTP ${res.status} ${res.body}`);
      console.log('   ↑ 看打印机是否打出对应小票\n');
    } catch (e) {
      console.error(`[${type}] 发送失败: ${e.message}`);
      console.error('   请确认服务已启动: node src/server.js');
      process.exitCode = 1;
    }
  }
  console.log('全部发送完毕，去打印机看小票效果吧');
})();
