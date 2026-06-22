'use strict';

/*
 * dashboard.js — 控制台一行总览
 * ==================================================================
 * 把分散在各处的状态（房间发育/能量/creep/CPU/profiler 热点/路径缓存命中率/
 * 威胁/扩张时机）汇成紧凑的几行打印，一眼掌握全局。
 * 每 N tick 打印一次（config.dashboardInterval），不刷屏。
 */

const profiler = require('cpu.profiler');
const pathCache = require('path.cache');

module.exports = {
  print() {
    const lines = [];

    // 每个自有房一行：RCL/进度/能量/creep 名册/敌情
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || !room.controller.my) continue;
      const c = room.controller;
      const pct = c.progressTotal ? ((c.progress / c.progressTotal) * 100).toFixed(1) : '100';
      const counts = {};
      for (const n in Game.creeps) {
        if (Game.creeps[n].room.name !== rn) continue;
        const r = Game.creeps[n].memory.role;
        counts[r] = (counts[r] || 0) + 1;
      }
      const roster = Object.keys(counts).map((k) => `${k[0].toUpperCase()}${counts[k]}`).join(' ');
      const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
      const threat = hostiles ? ` ⚠️敌${hostiles}` : '';
      const store = room.storage ? ` S:${room.storage.store[RESOURCE_ENERGY]}` : '';
      lines.push(`📊[${rn}] RCL${c.level} ${pct}% | E${room.energyAvailable}/${room.energyCapacityAvailable}${store} | ${roster}${threat}`);
    }

    // 全局资源行：CPU/bucket/pixel/内存/GCL
    const ms = (typeof RawMemory !== 'undefined' && RawMemory.get) ? RawMemory.get().length : 0;
    const pixels = (Game.resources && Game.resources.pixel) || 0;
    const gclPct = Game.gcl ? (Game.gcl.progress / Game.gcl.progressTotal * 100).toFixed(1) : '?';
    lines.push(`⚙️ CPU ${Game.cpu.getUsed().toFixed(1)}/${Game.cpu.limit} bucket ${Game.cpu.bucket} | mem ${(ms / 1024).toFixed(0)}KB | pixel ${pixels} | GCL${Game.gcl ? Game.gcl.level : '?'} ${gclPct}%`);

    // profiler 热点（前 4）+ 路径缓存命中率
    const hot = profiler.hotspots().slice(0, 4).join(' ');
    const pc = pathCache.stats();
    if (hot) lines.push(`🔥 热点 ${hot} | 路径缓存 ${pc.entries}条 命中率${pc.hitRate}%(${pc.hits}/${pc.hits + pc.misses})`);

    // 扩张时机提示
    const exp = Memory.intel && Memory.intel.tasks && Memory.intel.tasks.expansion;
    if (exp && exp.canExpandSoon) lines.push(`🚀 ${exp.note}`);

    console.log(lines.join('\n'));
  },
};
