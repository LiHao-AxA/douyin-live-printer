'use strict';
/**
 * 热敏小票模板（飞鹅排版标签）
 * 常用标签：<BR> 换行 / <C></C> 居中 / <B></B> 放大一倍 / <BOLD></BOLD> 加粗
 *          / <L></L> 变高一倍 / <W></W> 变宽一倍 / <QR></QR> 二维码 / <RIGHT></RIGHT> 右对齐
 * 注意：单次打印内容 ≤5000 字节；58mm 纸一行约 32 个汉字，文案别太长
 */

const LINE = '--------------------------------';

function pad(n) {
  return String(n).padStart(2, '0');
}

function padTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clip(str, n = 20) {
  const s = String(str ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * 礼物名映射（扩展点）：
 * payload.sec_gift_id 是加密的礼物 ID，当前推送里不带礼物名。
 * 两种补全方式：
 *  1. 后续接入官方「获取礼物列表」接口（直播伴侣互动工具能力），按 ID 映射
 *  2. 先人工配置高频礼物：GIFT_NAMES['加密giftId'] = '爱心'
 */
const GIFT_NAMES = {};

function giftName(payload) {
  const name = GIFT_NAMES[payload.sec_gift_id];
  return name || '礼物';
}

/** gift_value 单位是「分」，转成元 */
function moneyYuan(giftValueFen) {
  const fen = Number(giftValueFen) || 0;
  return (fen / 100).toFixed(2);
}

const templates = {
  /** 点赞（上游 2s 合并一次，like_num 为合并数量） */
  live_like(p) {
    return [
      '<C><B>❤ 感谢点赞</B></C>',
      `<BR>${LINE}`,
      `<BR><BOLD>${clip(p.nickname)}</BOLD> 为主播点赞 ×${p.like_num}`,
      `<BR><BR><C>${padTime(p.timestamp)}</C>`,
      '<BR>',
    ].join('');
  },

  /** 评论 */
  live_comment(p) {
    return [
      '<C><B>💬 观众评论</B></C>',
      `<BR>${LINE}`,
      `<BR><BOLD>${clip(p.nickname)}</BOLD>：${clip(p.content, 40)}`,
      `<BR><BR><C>${padTime(p.timestamp)}</C>`,
      '<BR>',
    ].join('');
  },

  /** 送礼（注意 payload.test === true 是平台测试数据，应在入口过滤） */
  live_gift(p) {
    return [
      '<C><B>🎁 感谢送礼</B></C>',
      `<BR>${LINE}`,
      `<BR><BOLD>${clip(p.nickname)}</BOLD> 送出 ${giftName(p)} ×${p.gift_num}`,
      `<BR>价值 ¥${moneyYuan(p.gift_value)}`,
      `<BR><BR><C>${padTime(p.timestamp)}</C>`,
      '<BR>',
    ].join('');
  },

  /** 粉丝团：fansclub_reason_type 1=升级 2=加团 */
  live_fansclub(p) {
    const action = p.fansclub_reason_type === 1 ? '升级' : '加入';
    return [
      '<C><B>👑 粉丝团</B></C>',
      `<BR>${LINE}`,
      `<BR><BOLD>${clip(p.nickname)}</BOLD> ${action}粉丝团${p.fansclub_level ? ' · Lv.' + p.fansclub_level : ''}`,
      `<BR><BR><C>${padTime(p.timestamp)}</C>`,
      '<BR>',
    ].join('');
  },

  /** 关注（直播伴侣互动工具消息：use_follow_action 1=关注 2=取关） */
  live_follow(p) {
    const action =
      p.use_follow_action === 1 ? '关注了主播' : p.use_follow_action === 2 ? '取关了主播' : '关注互动';
    return [
      '<C><B>⭐ 关注</B></C>',
      `<BR>${LINE}`,
      `<BR><BOLD>${clip(p.nickname)}</BOLD> ${action}`,
      `<BR><BR><C>${padTime(p.timestamp)}</C>`,
      '<BR>',
    ].join('');
  },

  /** 按事件类型渲染，未知类型返回 null */
  render(type, payload) {
    const fn = templates[type];
    if (!fn) return null;
    return fn(payload);
  },

  /** 联调测试票 */
  testTicket() {
    return [
      '<C><B>📢 打印链路测试</B></C>',
      `<BR>${LINE}`,
      '<BR>本小票由打印服务下发',
      `<BR>时间：${padTime(Date.now())}`,
      '<BR><C>如果你看到它，链路已通 ✅</C>',
      '<BR>',
    ].join('');
  },
};

module.exports = templates;
