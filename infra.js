'use strict';

/*
 * infra.js — 基建完成度判定（发育哲学核心）
 * ==================================================================
 * 用户原则：每一级先把基建+开采速度榨满，再升下一级；不要急着冲 controller。
 * 本模块判定"当前 RCL 的基建是否已建完"：
 *   - 该 RCL 应有的 extension 全部建成（非在建，是建成）
 *   - 每个 source 旁有 container（静态采矿就位）
 * 只有基建完成，才放行 upgrader 去升下一级；否则能量全砸基建。
 */

const EXT_PER_RCL = { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 };

module.exports = {
  /** 当前 RCL 应有的 extension 数 */
  extTarget(rcl) { return EXT_PER_RCL[rcl] || 0; },

  /** 已建成（非在建）的 extension 数 */
  extBuilt(room) {
    return room.find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_EXTENSION }).length;
  },

  /** 每个 source 旁是否都有建成的 container */
  containersReady(room) {
    const sources = room.find(FIND_SOURCES);
    for (const s of sources) {
      const has = s.pos.findInRange(FIND_STRUCTURES, 2, {
        filter: (st) => st.structureType === STRUCTURE_CONTAINER,
      }).length;
      if (!has) return false;
    }
    return true;
  },

  /**
   * 当前 RCL 基建是否已完成（extension 全建成 + source container 就位）。
   * RCL1 没 extension，只要有采集就算"完成"，可以升级。
   */
  isComplete(room) {
    const rcl = room.controller.level;
    const need = this.extTarget(rcl);
    if (this.extBuilt(room) < need) return false;      // extension 没建满
    if (rcl >= 2 && !this.containersReady(room)) return false; // 静态采矿没就位
    return true;
  },

  /** 一句话进度（供 HUD/命令显示） */
  status(room) {
    const rcl = room.controller.level;
    const need = this.extTarget(rcl);
    const built = this.extBuilt(room);
    const cReady = rcl < 2 || this.containersReady(room);
    const done = this.isComplete(room);
    return { rcl, extBuilt: built, extNeed: need, containersReady: cReady, complete: done };
  },
};
