'use strict';
/**
 * 打印链路一键诊断：检查配置完整性 → 查询飞鹅打印机状态 → 给出可执行结论
 * 用法：node scripts/diagnose.js
 */
const config = require('../src/config');
const { FEIE_ERROR_HINTS } = require('../src/feie');

console.log('=== 1. 配置检查 ===');
console.log(`FEIE_USER    : ${config.feie.user ? '已配置 ✅' : '未配置 ❌'}`);
console.log(`FEIE_UKEY    : ${config.feie.ukey ? '已配置 ✅' : '未配置 ❌'}`);
console.log(`PRINTER_SN   : ${config.printer.sn ? '已配置 ✅' : '未配置 ❌'}`);
console.log(`PRINTER_KEY  : ${config.printer.key ? '已配置 ✅' : '未配置 ❌（打印机未绑定时就是这个原因）'}`);
console.log(`DOUYIN_SECRET: ${config.douyin.secret ? '已配置 ✅' : '未配置 ⚠️（只影响抖音推送，不影响 test-print）'}`);

(async () => {
  if (!config.feie.user || !config.feie.ukey || !config.printer.sn) {
    console.log('\n=== 结论：先补齐上表 ❌ 的配置项 ===');
    return;
  }

  console.log('\n=== 2. 查询飞鹅打印机状态（定位核心问题）===');
  const { FeieClient } = require('../src/feie');
  const client = new FeieClient(config.feie);
  try {
    const status = await client.queryPrinterStatus(config.printer.sn);
    console.log('飞鹅返回:', status);
    if (/off-line/i.test(status)) {
      console.log('\n=== 结论：打印机离线 ❌\n   1) 机器通电了吗？\n   2) 配网了吗？（WiFi 用「飞鹅WiFi配置」APP 扫码，或插 4G 卡）\n   3) 配完网后打印机会打一张「联网成功」小票，看到才算联网\n   4) 这台是二手，确认卖家已解绑、机器未被他人占用');
    } else if (/abnormal/i.test(status)) {
      console.log('\n=== 结论：打印机在线但异常 ❌ → 一般是缺纸，装好 57×50 热敏纸再试');
    } else {
      console.log('\n=== 结论：打印机在线正常 ✅\n   接下来 POST /test-print 应该能出票；如果还没出，把接口返回的 JSON 发我');
    }
  } catch (e) {
    console.log('查询失败:', e.message);
    const hint = FEIE_ERROR_HINTS[e.code];
    console.log(`\n=== 结论：${hint || '见错误信息排查'}`);
    if (e.code === -1) {
      console.log('   → 打印机还没绑定到你的飞鹅账号！两个办法：\n       A) 在 .env 填 PRINTER_KEY（机器底部标签）后重启服务，自动绑定\n       B) 调 POST /printers/add?sn=<SN>&key=<KEY>');
    }
  }
})();
