'use strict';
/**
 * 内存打印队列：削峰 + 失败重试
 * 抖音推送 QPS 上限 100/s、连续失败会熔断；打印机本身处理不过来，需要排队消费。
 * 生产环境建议换成 Redis/消息队列（BullMQ / 抖音云队列），这里提供最小可用实现。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PrintQueue {
  /**
   * @param {function} processor  async (job) => void，单条打印
   * @param {object} options
   * @param {number} options.maxRetry    最大重试次数，默认 3
   * @param {number} options.intervalMs  重试退避基数，默认 500ms
   */
  constructor(processor, { maxRetry = 3, intervalMs = 500 } = {}) {
    this.processor = processor;
    this.maxRetry = maxRetry;
    this.intervalMs = intervalMs;
    this.jobs = [];
    this.running = false;
    this.total = 0;
    this.failed = 0;
  }

  /** 待打印队列长度 */
  get pending() {
    return this.jobs.length;
  }

  push(job) {
    this.jobs.push({ ...job, retries: 0 });
    this.total += 1;
    this._drain();
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length) {
      const job = this.jobs.shift();
      try {
        await this.processor(job);
      } catch (err) {
        if (job.retries < this.maxRetry) {
          job.retries += 1;
          console.error(`[queue] 打印失败，第 ${job.retries}/${this.maxRetry} 次重试：${err.message}`);
          this.jobs.push(job);
          await sleep(this.intervalMs * job.retries); // 线性退避
        } else {
          this.failed += 1;
          console.error(`[queue] 已放弃打印（重试耗尽）：${err.message}`);
        }
      }
    }
    this.running = false;
  }
}

module.exports = { PrintQueue, sleep };
