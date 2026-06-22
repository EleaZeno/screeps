'use strict';

/*
 * cpu.profiler.js — 每模块 CPU 耗时剖析器
 * ==================================================================
 * 目的：把闲置的诊断能力用起来，记录每个子系统（孵化/建造/路网/creep/情报…）
 * 每 tick 的 CPU 消耗，滚动平均，找出性能热点，为后续优化提供数据依据。
 *
 * 用法（main.js 里包住每段）：
 *   profiler.wrap('spawn', () => spawnManager.run(room));
 * 或手动：
 *   const t = profiler.start(); ...; profiler.end('spawn', t);
 *
 * 结果存 Memory.profiler.avg（滚动平均，EMA），控制台 dashboard 读取。
 * 开销极小（每次 getUsed() ≈ 0.002 CPU），且可 config 一键关。
 */

const ALPHA = 0.1; // EMA 平滑系数（越小越平滑）

module.exports = {
  _enabled: true,

  init(enabled) {
    this._enabled = enabled !== false;
    if (!Memory.profiler) Memory.profiler = { avg: {}, last: {}, samples: 0 };
  },

  start() {
    return this._enabled ? Game.cpu.getUsed() : 0;
  },

  end(label, startCpu) {
    if (!this._enabled) return;
    const cost = Game.cpu.getUsed() - startCpu;
    const p = Memory.profiler;
    p.last[label] = +cost.toFixed(3);
    // EMA 滚动平均，避免存历史数组占内存
    p.avg[label] = p.avg[label] == null ? cost : p.avg[label] * (1 - ALPHA) + cost * ALPHA;
    p.avg[label] = +p.avg[label].toFixed(3);
  },

  wrap(label, fn) {
    if (!this._enabled) return fn();
    const t = Game.cpu.getUsed();
    const ret = fn();
    this.end(label, t);
    return ret;
  },

  tickDone() {
    if (!this._enabled) return;
    Memory.profiler.samples = (Memory.profiler.samples || 0) + 1;
    Memory.profiler.totalLast = +Game.cpu.getUsed().toFixed(3);
  },

  /** 返回按平均耗时降序的热点列表（供 dashboard） */
  hotspots() {
    const avg = (Memory.profiler && Memory.profiler.avg) || {};
    return Object.keys(avg).sort((a, b) => avg[b] - avg[a]).map((k) => `${k}:${avg[k]}`);
  },
};
