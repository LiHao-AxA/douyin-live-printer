'use strict';
/**
 * 飞鹅云打印 API 封装
 * 文档: http://www.feieyun.com/open/apidoc-en.html
 * 签名: sig = SHA1(user + UKEY + stime)，40 位小写
 * 请求: POST http://api.de.feieyun.com/Api/Open/  (application/x-www-form-urlencoded)
 */
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

class FeieClient {
  constructor({ user, ukey, apiBase }) {
    if (!user || !ukey) {
      throw new Error('缺少飞鹅配置：请在 .env 中填写 FEIE_USER / FEIE_UKEY');
    }
    this.user = user;
    this.ukey = ukey;
    this.apiBase = apiBase || 'http://api.de.feieyun.com/Api/Open/';
  }

  _sign(stime) {
    return crypto.createHash('sha1').update(this.user + this.ukey + stime).digest('hex');
  }

  _request(apiname, params = {}) {
    const stime = String(Math.floor(Date.now() / 1000)); // 10 位 unix 秒
    const form = new URLSearchParams({
      user: this.user,
      stime,
      sig: this._sign(stime),
      apiname,
      ...params,
    });
    // 2026-01 起飞鹅接口URL分流：接口名拼到路径（去 Open_ 前缀），参数中 apiname 仍保留完整名
    const path = apiname.replace(/^Open_/, '');
    const url = new URL(this.apiBase + path);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = form.toString();

    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(new Error(`飞鹅返回非 JSON（HTTP ${res.statusCode}）：${raw.slice(0, 200)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  _check(res, action) {
    if (res.ret !== 0) {
      const err = new Error(`飞鹅 ${action} 失败：ret=${res.ret} msg=${res.msg}`);
      err.code = res.ret; // -3 签名错误 / -2 参数错误 / -1 SN与用户不匹配 / 1001 SN或KEY错误 / 1002 SN非法
      throw err;
    }
    return res.data;
  }

  /** 批量添加打印机：printerContent 形如 "SN#KEY#备注#流量卡号"，多台用 \n 分隔，最多 100 台 */
  async addPrinter(printerContent) {
    const data = await this._request('Open_printerAddlist', { printerContent });
    return this._check(data, '添加打印机');
  }

  /**
   * 打印小票
   * @param {string} sn      打印机编号
   * @param {string} content 排版内容（<BR> 换行、<C></C> 居中、<B></B> 放大、<BOLD></BOLD> 加粗、<QR></QR> 二维码等）
   * @param {number} times   打印份数，默认 1
   * @returns {Promise<string>} 订单 ID
   */
  async printMsg(sn, content, times = 1) {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > 5000) {
      throw new Error(`打印内容 ${bytes} 字节，超过飞鹅 5000 字节上限，请缩短模板（超长可拆分多次打印）`);
    }
    const data = await this._request('Open_printMsg', { sn, content, times: String(times) });
    return this._check(data, '打印');
  }

  /** 查询订单是否打印成功（服务端约 5 秒缓存），返回 boolean */
  async queryOrderState(orderId) {
    const data = await this._request('Open_queryOrderState', { orderid: orderId });
    return this._check(data, '查询订单状态');
  }

  /** 查询某打印机某天统计 {print, waiting}，date 格式 YYYY-MM-DD */
  async queryOrderInfoByDate(sn, date) {
    const data = await this._request('Open_queryOrderInfoByDate', { sn, date });
    return this._check(data, '查询日统计');
  }

  /**
   * 查询打印机状态，data 取值：
   *  - "off-line"                            离线（与服务器失联超 2 分钟）
   *  - "The online working condition is normal"  在线正常
   *  - "The online working state is abnormal"    在线异常（一般缺纸）
   */
  async queryPrinterStatus(sn) {
    const data = await this._request('Open_queryPrinterStatus', { sn });
    return this._check(data, '查询打印机状态');
  }

  /** 清空该打印机待打印队列 */
  async delPrinterSqs(sn) {
    const data = await this._request('Open_delPrinterSqs', { sn });
    return this._check(data, '清空队列');
  }
}

/** 飞鹅错误码 → 中文排查提示 */
const FEIE_ERROR_HINTS = {
  '-3': '签名错误：检查 FEIE_UKEY（开发者账号的 UKEY，在 admin.feieyun.com 个人中心查看，注意去掉空格）',
  '-2': '参数错误：检查请求参数（如内容为空、时间格式不对等）',
  '-1': '打印机未绑定到当前飞鹅账号：先调 POST /printers/add 或到飞鹅管理后台添加 SN+KEY',
  '1001': 'SN 或 KEY 错误：核对打印机底部标签（添加打印机场景）',
  '1002': 'SN 非法：核对打印机底部标签编号',
};

module.exports = { FeieClient, FEIE_ERROR_HINTS };
