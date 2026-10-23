'use strict';
/**
 * 冒烟测试：用假配置启动服务（不真调飞鹅 API），验证
 *  1. 服务能启动、健康检查正常
 *  2. /stats 正确读出配置
 *  3. Webhook 无签名 → 401
 *  4. Webhook 正确签名 → 200 且事件被分发
 *  5. Webhook 篡改签名 → 401
 */
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');

const PORT = 8123;
const SECRET = 'demo_secret';
const env = {
  ...process.env,
  PORT: String(PORT),
  FEIE_USER: 'demo',
  FEIE_UKEY: 'demo',
  PRINTER_SN: '123456',
  PRINTER_ENABLED: 'false', // 关闭真实打印，只验证链路
  DOUYIN_SECRET: SECRET,
};

const child = spawn('node', ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
child.stderr.on('data', (d) => process.stderr.write('[server-err] ' + d));

function request(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 抖音官方签名算法
function sign(kv, body) {
  return Buffer.from(crypto.createHash('md5').update(kv + body + SECRET, 'utf8').digest()).toString('base64');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(800);
  const results = [];

  let r = await request('GET', '/health');
  results.push(['health 返回 200', r.status === 200 && JSON.parse(r.body).ok === true]);

  r = await request('GET', '/stats');
  const stats = JSON.parse(r.body);
  results.push(['stats 读出打印机 SN', r.status === 200 && stats.printerSn === '123456']);

  r = await request('POST', '/douyin/webhook', { 'Content-Type': 'application/json' }, '[]');
  results.push(['无签名被拒 401', r.status === 401]);

  const now = Date.now();
  const body = JSON.stringify([{ msg_id: '1', nickname: '测试', gift_num: 1, gift_value: 6600 }]);
  const kv = `x-msg-type=live_gift&x-nonce-str=123456&x-roomid=268&x-timestamp=${now}`;
  r = await request(
    'POST',
    '/douyin/webhook',
    {
      'Content-Type': 'application/json',
      'x-msg-type': 'live_gift',
      'x-nonce-str': '123456',
      'x-roomid': '268',
      'x-timestamp': String(now),
      'x-signature': sign(kv, body),
    },
    body
  );
  const j = JSON.parse(r.body);
  results.push([
    '正确签名通过且分发 1 条事件',
    r.status === 200 && j.received === 1 && j.results[0].type === 'live_gift',
  ]);

  r = await request(
    'POST',
    '/douyin/webhook',
    {
      'Content-Type': 'application/json',
      'x-msg-type': 'live_gift',
      'x-nonce-str': '123456',
      'x-roomid': '268',
      'x-timestamp': String(now),
      'x-signature': 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    },
    body
  );
  results.push(['篡改签名被拒 401', r.status === 401]);

  for (const [name, pass] of results) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  }
  child.kill();
  const allPass = results.every((x) => x[1]);
  console.log('冒烟测试结果:', allPass ? 'PASS ✅' : 'FAIL ❌');
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  child.kill();
  process.exit(1);
});
