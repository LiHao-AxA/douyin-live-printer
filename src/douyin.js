'use strict';
/**
 * 抖音直播小玩法「数据推送」Webhook 处理
 * 官方文档: https://developer.open-douyin.com/m/docs/resource/zh-CN/interaction/develop/server/live-room-scope/data-open/data-open-desc
 *
 * 签名算法（官方）：
 *  1. 取请求 header 中除 x-signature 外的参数（content-type 不参与），按 key 字典序升序排列
 *  2. 拼成 key=value&key=value 串
 *  3. 再直接拼接 原始 body 字符串 + secret（推送配置中的签名秘钥）
 *  4. 对拼接结果做 MD5(16 bytes)，再 Base64 编码，得到 x-signature
 */
const crypto = require('crypto');

/**
 * 校验签名
 * @param {object} headers 请求头（键名小写）
 * @param {string} rawBody 原始请求体字符串（必须原样，不能重新 JSON.stringify）
 * @param {string} secret  推送配置中的签名秘钥
 * @returns {boolean}
 */
function verifySignature(headers, rawBody, secret) {
  if (!secret) return false;
  const keys = Object.keys(headers)
    .filter((k) => k.startsWith('x-') && k !== 'x-signature')
    .sort(); // 字典序
  const kv = keys.map((k) => `${k}=${headers[k]}`).join('&');
  const rawData = kv + rawBody + secret;
  const sig = Buffer.from(crypto.createHash('md5').update(rawData, 'utf8').digest()).toString('base64');
  return sig === headers['x-signature'];
}

/**
 * 时间戳防重放：|now - x-timestamp| 超出容差则拒绝
 */
function checkTimestamp(headers, toleranceMs) {
  const ts = Number(headers['x-timestamp']);
  if (!ts) return false;
  return Math.abs(Date.now() - ts) <= toleranceMs;
}

/**
 * 把一条推送拆成单条事件
 * @param {string} xMsgType header 中的消息类型：live_like / live_comment / live_gift / live_fansclub / live_follow
 * @param {string} body     原始请求体（JSON 数组字符串）
 * @returns {Array<{type: string, payload: object}>}
 */
function parsePush(xMsgType, body) {
  let list;
  try {
    list = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({ type: xMsgType, payload: item }));
}

module.exports = { verifySignature, checkTimestamp, parsePush };
