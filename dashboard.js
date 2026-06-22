'use strict';

/*
 * dashboard.js — 控制台中文图形化仪表盘（HTML/CSS 渲染）
 * ==================================================================
 * Screeps 控制台支持 HTML（<div>/<span> 带内联 style + CSS color/background）。
 * 本模块用它画出：
 *   - 彩色进度条（RCL/GCL/能量/bucket）
 *   - 工整对齐的表格（profiler 热点、路径缓存）
 *   - 颜色编码状态（绿=健康/黄=注意/红=告警）
 * 全中文标签。每 N tick 自动打印一次。
 *
 * 交互：见 commands.js（在控制台敲 dash()/prof()/help() 等命令）。
 */

const profiler = require('cpu.profiler');

// 画一条 HTML 进度条
function bar(pct, color, width) {
  const w = width || 120;
  const fill = Math.round(w * Math.min(pct, 100) / 100);
  return `<span style="display:inline-block;width:${w}px;height:11px;background:#333;border-radius:3px;vertical-align:middle">` +
         `<span style="display:inline-block;width:${fill}px;height:11px;background:${color};border-radius:3px"></span></span>`;
}

// 颜色编码：根据比例返回绿/黄/红
function rag(pct, goodHigh) {
  const good = goodHigh ? pct >= 60 : pct <= 50;
  const warn = goodHigh ? pct >= 30 : pct <= 80;
  return good ? '#4caf50' : (warn ? '#ffc107' : '#f44336');
}

module.exports = {
  print() {
    // 默认 HTML（官方游戏控制台渲染）；若你的查看器不渲染 HTML，
    // 在控制台输入 textMode() 切纯文本，或 config.dashboardText=true。
    const cfg = require('config');
    const useText = (Memory.config && Memory.config.dashboardText) || cfg.dashboardText;
    if (useText) return this.printText();
    const out = [];
    out.push(`<div style="font-family:Consolas,monospace;font-size:12px;line-height:1.5;background:#1a1a1a;padding:6px 10px;border-radius:6px;border:1px solid #333">`);
    out.push(`<div style="color:#4fc3f7;font-weight:bold;font-size:13px">📊 帝国仪表盘 · tick ${Game.time}</div>`);

    // 各房间
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || !room.controller.my) continue;
      const c = room.controller;
      const ctrlPct = c.progressTotal ? (c.progress / c.progressTotal * 100) : 100;
      const ePct = room.energyCapacityAvailable ? (room.energyAvailable / room.energyCapacityAvailable * 100) : 0;

      const counts = {};
      for (const n in Game.creeps) {
        if (Game.creeps[n].room.name !== rn) continue;
        const r = Game.creeps[n].memory.role;
        counts[r] = (counts[r] || 0) + 1;
      }
      const ROLE_CN = { harvester: '采集', miner: '矿工', hauler: '运输', upgrader: '升级', builder: '建造', defender: '防御', attacker: '进攻', scout: '斥候' };
      const roster = Object.keys(counts).map((k) => `${ROLE_CN[k] || k}<b>${counts[k]}</b>`).join(' ');
      const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
      const threat = hostiles ? `<span style="color:#f44336;font-weight:bold"> ⚠ 入侵 ${hostiles} 敌</span>` : `<span style="color:#4caf50"> ✓ 安全</span>`;

      out.push(`<div style="margin-top:4px;color:#fff">🏠 <b style="color:#ffd54f">${rn}</b> RCL${c.level}${threat}</div>`);
      out.push(`<div style="color:#aaa">　控制器 ${bar(ctrlPct, '#4fc3f7')} <span style="color:#4fc3f7">${ctrlPct.toFixed(1)}%</span> (${c.progress}/${c.progressTotal})</div>`);
      out.push(`<div style="color:#aaa">　能量　 ${bar(ePct, rag(ePct, true))} <span style="color:${rag(ePct, true)}">${room.energyAvailable}/${room.energyCapacityAvailable}</span></div>`);
      out.push(`<div style="color:#ccc">　人口　 ${roster}</div>`);
    }

    // 全局资源
    const bucketPct = Game.cpu.bucket / 100; // bucket 上限 10000
    const cpuPct = Game.cpu.getUsed() / Game.cpu.limit * 100;
    const ms = (typeof RawMemory !== 'undefined' && RawMemory.get) ? RawMemory.get().length : 0;
    const memPct = ms / 2048 / 1024 * 100;
    const pixels = (Game.resources && Game.resources.pixel) || 0;
    const gclPct = Game.gcl ? (Game.gcl.progress / Game.gcl.progressTotal * 100) : 0;

    out.push(`<div style="margin-top:5px;border-top:1px solid #333;padding-top:4px;color:#fff">⚙️ <b>全局资源</b></div>`);
    out.push(`<div style="color:#aaa">　CPU 　 ${bar(cpuPct, rag(cpuPct, false))} <span style="color:${rag(cpuPct, false)}">${Game.cpu.getUsed().toFixed(1)}/${Game.cpu.limit}</span> <span style="color:#666">(用越少越好)</span></div>`);
    out.push(`<div style="color:#aaa">　Bucket ${bar(bucketPct, '#9c27b0')} <span style="color:#ce93d8">${Game.cpu.bucket}/10000</span></div>`);
    out.push(`<div style="color:#aaa">　内存　 ${bar(memPct, '#26a69a')} <span style="color:#26a69a">${(ms / 1024).toFixed(0)}KB/2048KB (${memPct.toFixed(1)}%)</span></div>`);
    out.push(`<div style="color:#aaa">　GCL${Game.gcl ? Game.gcl.level : '?'}　 ${bar(gclPct, '#ff9800')} <span style="color:#ffb74d">${gclPct.toFixed(1)}%</span>　💎 像素 ${pixels}</div>`);

    // profiler 热点表格
    const avg = (Memory.profiler && Memory.profiler.avg) || {};
    const keys = Object.keys(avg).sort((a, b) => avg[b] - avg[a]).slice(0, 6);
    if (keys.length) {
      const LBL = { creeps: 'creep逻辑', spawn: '孵化', intel: '情报', build: '建造', layout: '路网', tower: '塔', sched: '排程', pixel: '像素', defender: '防御' };
      const maxv = avg[keys[0]] || 1;
      out.push(`<div style="margin-top:5px;border-top:1px solid #333;padding-top:4px;color:#fff">🔥 <b>CPU 热点</b> <span style="color:#666">(每模块平均耗时)</span></div>`);
      for (const k of keys) {
        const pct = avg[k] / maxv * 100;
        out.push(`<div style="color:#aaa">　${(LBL[k] || k).padEnd ? (LBL[k] || k) : k} ${bar(pct, '#ff7043', 80)} <span style="color:#ff8a65">${avg[k]}</span></div>`);
      }
    }

    // 扩张提示
    const exp = Memory.intel && Memory.intel.tasks && Memory.intel.tasks.expansion;
    if (exp) {
      const color = exp.canExpandSoon ? '#4caf50' : '#888';
      out.push(`<div style="color:${color};margin-top:3px">🚀 ${exp.note}</div>`);
    }

    out.push(`<div style="color:#555;margin-top:4px;font-size:11px">💡 控制台输入 help() 看全部命令</div>`);
    out.push(`</div>`);
    console.log(out.join(''));
  },

  // 纯文本降级版（用 ASCII 进度条 + 对齐，任何查看器都能看）
  printText() {
    function tbar(pct, width) {
      const w = width || 12;
      const f = Math.round(w * Math.min(pct, 100) / 100);
      return '[' + '█'.repeat(f) + '─'.repeat(Math.max(0, w - f)) + ']';
    }
    const L = [];
    L.push(`📊 帝国仪表盘 · tick ${Game.time}`);
    for (const rn in Game.rooms) {
      const room = Game.rooms[rn];
      if (!room.controller || !room.controller.my) continue;
      const c = room.controller;
      const cp = c.progressTotal ? c.progress / c.progressTotal * 100 : 100;
      const ep = room.energyCapacityAvailable ? room.energyAvailable / room.energyCapacityAvailable * 100 : 0;
      const counts = {};
      for (const n in Game.creeps) { if (Game.creeps[n].room.name !== rn) continue; const r = Game.creeps[n].memory.role; counts[r] = (counts[r] || 0) + 1; }
      const CN = { harvester: '采集', miner: '矿工', hauler: '运输', upgrader: '升级', builder: '建造', defender: '防御', attacker: '进攻' };
      const roster = Object.keys(counts).map((k) => `${CN[k] || k}${counts[k]}`).join(' ');
      const h = room.find(FIND_HOSTILE_CREEPS).length;
      L.push(`🏠 ${rn} RCL${c.level} ${h ? '⚠️敌' + h : '✓安全'}`);
      L.push(`  控制器 ${tbar(cp)} ${cp.toFixed(1)}% (${c.progress}/${c.progressTotal})`);
      L.push(`  能量　 ${tbar(ep)} ${room.energyAvailable}/${room.energyCapacityAvailable}`);
      L.push(`  人口　 ${roster}`);
    }
    const ms = (typeof RawMemory !== 'undefined' && RawMemory.get) ? RawMemory.get().length : 0;
    const pixels = (Game.resources && Game.resources.pixel) || 0;
    const gp = Game.gcl ? Game.gcl.progress / Game.gcl.progressTotal * 100 : 0;
    L.push(`⚙️ CPU ${tbar(Game.cpu.getUsed() / Game.cpu.limit * 100)} ${Game.cpu.getUsed().toFixed(1)}/${Game.cpu.limit}`);
    L.push(`  Bucket ${tbar(Game.cpu.bucket / 100)} ${Game.cpu.bucket}/10000`);
    L.push(`  内存 ${(ms / 1024).toFixed(0)}KB/2048KB | GCL${Game.gcl ? Game.gcl.level : '?'} ${gp.toFixed(1)}% | 💎${pixels}`);
    const avg = (Memory.profiler && Memory.profiler.avg) || {};
    const keys = Object.keys(avg).sort((a, b) => avg[b] - avg[a]).slice(0, 5);
    if (keys.length) {
      const LBL = { creeps: 'creep逻辑', spawn: '孵化', intel: '情报', build: '建造', layout: '路网', tower: '塔', sched: '排程', pixel: '像素', visual: '可视化' };
      L.push(`🔥 热点: ` + keys.map((k) => `${LBL[k] || k}=${avg[k]}`).join('  '));
    }
    console.log(L.join('\n'));
  },
};
