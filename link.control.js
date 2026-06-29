'use strict';
/**
 * link.control.js —— RCL5+ link 能量瞬移逻辑（与 tower.control 对称的主动控制层）
 *
 * 背景：build.planner 在 RCL5+ 会在 source 旁 / controller 旁 / storage 旁各放 link，
 * 但没有任何模块每 tick 指挥 link.transferEnergy。link 是被动建筑——不下令就是一堆死能量。
 * 一旦 RCL5 落地（当前 ~94.9% 在即），不补这块逻辑 = 白建 link、白占布局、hauler 省不下来。
 *
 * 角色分类（按距离锚点 2 格内判定，零 Memory 依赖）：
 *   - source link（离任一 source ≤2）：发送方（miner 灌满后瞬移走）
 *   - controller link（离 controller ≤2）：接收方·最高优先（喂 upgrader）
 *   - storage link（离 storage ≤2）：接收方·兜底（攒到 storage 旁，hauler 短驳）
 *
 * 策略（每 tick，CPU O(links)）：
 *   发送方能量 ≥ 阈值(默认 400/800) 且自身不在 cooldown →
 *     优先转给 controller link（若其有空位），否则转给 storage link（若其有空位）。
 *   不转给其它 source link（避免来回倒）。controller/storage link 只收不发。
 */

const SEND_THRESHOLD = 400;   // 发送方至少攒到这么多才瞬移（约半仓，减少碎片转账浪费 3% 损耗）
const RECV_HEADROOM = 100;    // 接收方至少留这么多空位才转（避免转过去溢出）

module.exports = {
  /**
   * @param {Room} room
   * @returns {boolean} 本 tick 是否有过 link 操作
   */
  run(room) {
    if (!room || !room.controller || !room.controller.my) return false;
    // RCL5 才有 link，提前 return 省 CPU
    if (room.controller.level < 5) return false;

    const links = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LINK,
    });
    if (links.length < 2) return false; // 单 link 没法瞬移

    const ctrl = room.controller;
    const storage = room.storage;
    const sources = room.find(FIND_SOURCES);

    const isNear = (pos, target, range) => target && pos.inRangeTo(target.pos.x, target.pos.y, range);

    let ctrlLink = null;
    let storageLink = null;
    const senders = [];

    for (const lk of links) {
      if (isNear(lk.pos, ctrl, 2)) { ctrlLink = ctrlLink || lk; continue; }
      if (storage && isNear(lk.pos, storage, 2)) { storageLink = storageLink || lk; continue; }
      const nearSource = sources.some((s) => lk.pos.inRangeTo(s.pos.x, s.pos.y, 2));
      if (nearSource) senders.push(lk);
    }

    // 没有任何接收方就没意义
    const receivers = [];
    if (ctrlLink) receivers.push(ctrlLink);
    if (storageLink) receivers.push(storageLink);
    if (receivers.length === 0 || senders.length === 0) return false;

    let acted = false;
    for (const src of senders) {
      if (src.cooldown > 0) continue;
      const have = src.store ? src.store[RESOURCE_ENERGY] : src.energy;
      if (have < SEND_THRESHOLD) continue;

      // controller link 优先（直接喂 upgrade——rcl_push 目标下收益最高）
      let target = null;
      for (const r of receivers) {
        const cap = r.store ? r.store.getCapacity(RESOURCE_ENERGY) : r.energyCapacity;
        const cur = r.store ? r.store[RESOURCE_ENERGY] : r.energy;
        if (cap - cur >= RECV_HEADROOM) { target = r; break; }
      }
      if (!target) continue;
      if (src.transferEnergy(target) === OK) acted = true;
    }
    return acted;
  },
};
