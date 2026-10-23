'use strict';
/**
 * 验签算法自检：用抖音官方文档给出的示例数据验证实现正确性
 * 官方示例：header {x-msg-type:live_gift, x-nonce-str:123456, x-roomid:268, x-timestamp:456789}
 *          body "abc123你好"，secret "123abc"，期望 signature "PDcKhdlsrKEJif6uMKD2dw=="
 */
const { verifySignature } = require('../src/douyin');

// 正确签名：完整 header 应包含 x-signature（Node 收到请求时 header 名统一小写）
const headers = {
  'x-nonce-str': '123456',
  'x-timestamp': '456789',
  'x-roomid': '268',
  'x-msg-type': 'live_gift',
  'x-signature': 'PDcKhdlsrKEJif6uMKD2dw==',
};
const body = 'abc123你好';
const secret = '123abc';

const ok = verifySignature(headers, body, secret);
console.log(`官方示例验签: ${ok ? 'PASS ✅' : 'FAIL ❌'}`);

// 篡改签名应被拒绝
const tampered = { ...headers, 'x-signature': 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
const rejected = !verifySignature(tampered, body, secret);
console.log(`篡改签名拒绝: ${rejected ? 'PASS ✅' : 'FAIL ❌'}`);

const allPass = ok && rejected;
console.log('自检结果:', allPass ? 'PASS' : 'FAIL');
process.exit(allPass ? 0 : 1);
