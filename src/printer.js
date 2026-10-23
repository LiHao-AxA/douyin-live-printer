'use strict';
/**
 * 打印编排：抖音事件 → 模板渲染 → 入队 → 飞鹅打印
 */
const { FeieClient } = require('./feie');
const { PrintQueue } = require('./queue');
const templates = require('./templates');

class PrinterService {
  constructor(config) {
    this.config = config;
    this.feie = new FeieClient(config.feie);
    this.queue = new PrintQueue((job) => this._doPrint(job), { maxRetry: 3, intervalMs: 500 });
    /** 点赞冷却：记录最近打印点赞小票的时间，防止刷屏 */
    this._lastLikeAt = 0;
  }

  /** 该事件类型是否开启打印 */
  isEnabled(type) {
    return this.config.printer.enabled && this.config.printer.events.includes(type);
  }

  /**
   * 入口：收到一条抖音事件后调用
   * @param {string} type    live_like / live_comment / live_gift / live_fansclub / live_follow
   * @param {object} payload 单条消息 payload
   * @param {{roomId?: string}} opts 可选：直播间 id（多主播时按 roomMap 路由到对应打印机）
   * @returns {{dropped: boolean, reason?: string, queueLength?: number}}
   */
  handleEvent(type, payload, opts = {}) {
    const sn = this._resolveSn(opts.roomId);
    if (!sn) return { dropped: true, reason: 'no-printer-sn' };
    if (!this.isEnabled(type)) return { dropped: true, reason: 'event-disabled' };

    // 礼物测试数据必须过滤（平台模拟发送）
    if (type === 'live_gift' && payload.test === true) {
      return { dropped: true, reason: 'gift-test-data' };
    }

    // 点赞冷却，避免连点刷屏
    if (type === 'live_like') {
      const now = Date.now();
      if (now - this._lastLikeAt < this.config.printer.likeCooldownMs) {
        return { dropped: true, reason: 'like-cooldown' };
      }
      this._lastLikeAt = now;
    }

    const content = templates.render(type, payload);
    if (!content) return { dropped: true, reason: 'no-template' };

    this.queue.push({
      type,
      msgId: payload.msg_id || `${type}-${Date.now()}`,
      content,
      sn,
    });
    return { dropped: false, queueLength: this.queue.pending };
  }

  /** 按直播间 id 解析目标打印机 SN（roomMap 未配置或未匹配时回退 PRINTER_SN） */
  _resolveSn(roomId) {
    if (roomId && this.config.printer.roomMap) {
      const mapped = this.config.printer.roomMap[String(roomId)];
      if (mapped) return mapped;
    }
    return this.config.printer.sn;
  }

  async _doPrint(job) {
    const orderId = await this.feie.printMsg(job.sn, job.content, 1);
    console.log(`[print] OK type=${job.type} msgId=${job.msgId} orderId=${orderId}`);
  }

  // ---------------- 联调 / 管理辅助 ----------------

  /** 手动打一张测试票（验证打印机链路） */
  async testPrint(sn) {
    return this.feie.printMsg(sn || this.config.printer.sn, templates.testTicket(), 1);
  }

  /** 绑定打印机到当前飞鹅账号（SN + KEY，机器底部标签） */
  async bindPrinter(sn, key, remark = 'douyin-live-printer') {
    return this.feie.addPrinter(`${sn}#${key}#${remark}`);
  }

  /** 查询打印机在线状态 */
  async printerStatus(sn) {
    return this.feie.queryPrinterStatus(sn || this.config.printer.sn);
  }

  /** 查询某个打印任务是否已被打印机打出（飞鹅订单状态有约 5 秒缓存，需稍等再查） */
  async queryOrderState(orderId) {
    return this.feie.queryOrderState(orderId);
  }

  /** 清空该打印机积压队列 */
  async clearQueue(sn) {
    return this.feie.delPrinterSqs(sn || this.config.printer.sn);
  }
}

module.exports = { PrinterService };
