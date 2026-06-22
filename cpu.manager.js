'use strict';

/*
 * cpu.manager.js — 闲置 CPU 变现 + bucket 管理
 * ------------------------------------------------------------------
 * 实测（2026-06-22 在 shard3 验证）：
 *   - Game.cpu.generatePixel() 存在且可用
 *   - PIXEL_CPU_COST = 10000（烧 10000 bucket 换 1 个 pixel）
 *   - bucket 上限 10000，满了多余 CPU 全蒸发浪费
 * 所以：bucket 满时自动换 pixel，把闲置算力变现，不影响正常运行。
 * 仅官方服务器有 generatePixel（私服没有），用 typeof 守卫。
 */
module.exports = {
  run() {
    // bucket 攒满 10000 → 自动换 1 个 pixel（你 CPU 严重过剩，稳赚不亏）
    if (typeof Game.cpu.generatePixel === 'function' && Game.cpu.bucket >= 10000) {
      const res = Game.cpu.generatePixel();
      if (res === OK) {
        const pixels = (Game.resources && Game.resources.pixel) || 0;
        console.log(`[PIXEL] 生成成功！当前 pixel 总数≈${pixels}（闲置 CPU 已变现）`);
      }
    }
  },
};
