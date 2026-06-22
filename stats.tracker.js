'use strict';

/*
 * stats.tracker.js — 过往 N tick 滚动统计
 * ==================================================================
 * 每 tick 采样关键指标，存环形缓冲（ring buffer）进 Memory，算出：
 *   - 过往 N tick 的平均能量净流入/tick
 *   - 平均控制器进度增长/tick → 推算到下一级 ETA
 *   - 平均 CPU 占用
 *   - 平均 creep 数
 *   - 峰值/谷值
 * 默认窗口 100 tick（约 5.5 分钟），可配。供 HUD 和 stats() 命令读取。
 */

const WINDOW = 100; // 滚动窗口 tick 数

module.exports = {
  // 每 tick 调一次，采样并写入环形缓冲
  sample() {
    if (!Memory.stats2) Memory.stats2 = {};
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || !room.controller.my) continue;
      const s = Memory.stats2[rn] || (Memory.stats2[rn] = { buf: [], i: 0 });

      const energy = room.energyAvailable + (room.storage ? room.storage.store[RESOURCE_ENERGY] : 0);
      let creeps = 0;
      for (const n in Game.creeps) if (Game.creeps[n].room.name === rn) creeps++;

      const sample = {
        t: Game.time,
        e: energy,                       // 总能量（房内+仓储）
        cp: room.controller.progress,    // 控制器进度
        cpu: +Game.cpu.getUsed().toFixed(2),
        creeps,
      };
      // 环形缓冲：固定大小，覆盖最老的
      if (s.buf.length < WINDOW) s.buf.push(sample);
      else { s.buf[s.i] = sample; }
      s.i = (s.i + 1) % WINDOW;
    }
  },

  // 计算某房过往窗口内的统计结果
  compute(roomName) {
    const s = Memory.stats2 && Memory.stats2[roomName];
    if (!s || s.buf.length < 2) return null;
    // 按时间排序（环形缓冲乱序）
    const buf = s.buf.slice().sort((a, b) => a.t - b.t);
    const first = buf[0], last = buf[buf.length - 1];
    const dt = Math.max(last.t - first.t, 1);

    // 净流入速率 = (末-初)/时间跨度
    const eRate = (last.e - first.e) / dt;
    const cpRate = (last.cp - first.cp) / dt;

    // 平均 CPU / creep
    let cpuSum = 0, creepSum = 0, cpuMax = 0;
    for (const x of buf) { cpuSum += x.cpu; creepSum += x.creeps; cpuMax = Math.max(cpuMax, x.cpu); }
    const cpuAvg = cpuSum / buf.length;
    const creepAvg = creepSum / buf.length;

    return {
      window: dt,           // 实际统计跨度（tick）
      samples: buf.length,
      eRate: +eRate.toFixed(2),       // 平均能量净流入/tick
      cpRate: +cpRate.toFixed(2),     // 平均控制器进度/tick
      cpuAvg: +cpuAvg.toFixed(2),
      cpuMax: +cpuMax.toFixed(2),
      creepAvg: +creepAvg.toFixed(1),
    };
  },

  // 推算到下一级 RCL 的 ETA（基于过往平均进度速率，更准）
  etaNextLevel(room) {
    const st = this.compute(room.name);
    if (!st || st.cpRate <= 0) return null;
    const remain = room.controller.progressTotal - room.controller.progress;
    return Math.ceil(remain / st.cpRate);
  },
};
