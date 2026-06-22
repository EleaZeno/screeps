'use strict';

/*
 * visual.js — 房间画面内"纯文字堆叠"HUD（位置可切换 / 可隐藏 / 可简版）
 * ==================================================================
 * 全部用 v.text 纯文字逐行堆叠（你要的"纯文字堆叠图表"），用 ▰▱ 拼进度条。
 * 不画 spawn 旁（挡建筑），位置由 Memory.hud.pos 控制，控制台命令切换：
 *   hud()        显示/隐藏切换
 *   hud('tl')    左上角 (1,1)
 *   hud('tr')    右上角 (49,1) 右对齐
 *   hud('bl')    左下角
 *   hud('ctrl')  跟着控制器（你升级时常盯这里）
 *   hud('mini')  极简版（只 RCL+能量+威胁，最不挡视线）
 *   hud('off')   关闭
 * RoomVisual 是纯绘制层，引擎不支持鼠标点击，所以"按钮"只能用控制台命令实现。
 */

// 文字进度条
function bar(pct, n) {
  n = n || 10;
  const f = Math.round(n * Math.min(Math.max(pct, 0), 1));
  return '▰'.repeat(f) + '▱'.repeat(Math.max(0, n - f));
}

// EMA 记录能量流入速率（存 room.memory，每 tick 比上一帧）
function energyRate(room) {
  const m = room.memory;
  if (!m._hud) m._hud = {};
  const now = room.energyAvailable + (room.storage ? room.storage.store[RESOURCE_ENERGY] : 0);
  const prev = m._hud.lastE;
  m._hud.lastE = now;
  if (prev == null) return 0;
  const d = now - prev;
  m._hud.rate = m._hud.rate == null ? d : m._hud.rate * 0.9 + d * 0.1;
  return m._hud.rate || 0;
}

module.exports = {
  draw(room) {
    if (!room.controller || !room.controller.my) return;
    const v = room.visual;
    if (!v || typeof v.text !== 'function') return;

    const hud = Memory.hud || (Memory.hud = { pos: 'tr', on: true });
    if (!hud.on || hud.pos === 'off') return;

    const c = room.controller;
    const mini = hud.pos === 'mini';

    // 决定锚点 + 对齐
    let x, y, align;
    switch (hud.pos) {
      case 'tl': x = 1; y = 1; align = 'left'; break;
      case 'bl': x = 1; y = 38; align = 'left'; break;
      case 'ctrl': x = Math.min(c.pos.x + 2, 40); y = Math.max(c.pos.y - 4, 1); align = 'left'; break;
      case 'mini': x = 1; y = 1; align = 'left'; break;
      case 'tr':
      default: x = 48; y = 1; align = 'right'; break;
    }

    const lines = [];
    const push = (txt, color) => { lines.push({ t: txt, c: color || '#ddd' }); };

    // ---- 数据计算 ----
    const ctrlPct = c.progressTotal ? c.progress / c.progressTotal : 1;
    const ePct = room.energyCapacityAvailable ? room.energyAvailable / room.energyCapacityAvailable : 0;
    const rate = energyRate(room);
    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    // 人口
    const counts = {};
    for (const n in Game.creeps) {
      if (Game.creeps[n].room.name !== room.name) continue;
      const r = Game.creeps[n].memory.role;
      counts[r] = (counts[r] || 0) + 1;
    }
    const CN = { harvester: '采', miner: '矿', hauler: '运', upgrader: '升', builder: '建', defender: '防', attacker: '攻' };
    const roster = Object.keys(counts).map((k) => `${CN[k] || k}${counts[k]}`).join(' ') || '无';

    // ---- mini 版：只 3 行 ----
    if (mini) {
      push(`${room.name} RCL${c.level} ${bar(ctrlPct, 8)} ${(ctrlPct * 100).toFixed(0)}%`, '#ffd54f');
      push(`能量 ${room.energyAvailable}/${room.energyCapacityAvailable} ${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/t`, ePct > 0.6 ? '#4caf50' : '#ffc107');
      push(hostiles.length ? `⚠ 入侵 ${hostiles.length} 敌!` : '✓ 安全', hostiles.length ? '#f44336' : '#4caf50');
      this._render(v, lines, x, y, align, mini);
      if (hostiles.length) for (const h of hostiles) v.circle(h.pos, { radius: 0.5, stroke: '#f44336', fill: 'transparent', strokeWidth: 0.15 });
      return;
    }

    // ---- 完整版 ----
    push(`🏠 ${room.name}  RCL${c.level}  GCL${Game.gcl ? Game.gcl.level : '?'}`, '#ffd54f');

    // 控制器 + 距下一级 ETA（分钟）
    let eta = '';
    if (c.level < 8 && rate > 0) {
      const remain = c.progressTotal - c.progress;
      const ticks = Math.ceil(remain / Math.max(rate, 0.1));
      const mins = ticks * 3.33 / 60;
      eta = mins < 1440 ? ` ~${mins < 60 ? mins.toFixed(0) + '分' : (mins / 60).toFixed(1) + '时'}` : ` ~${(mins / 1440).toFixed(1)}天`;
    }
    push(`控制 ${bar(ctrlPct)} ${(ctrlPct * 100).toFixed(1)}%${eta}`, '#4fc3f7');

    // 能量 + 净流入速率
    push(`能量 ${bar(ePct)} ${room.energyAvailable}/${room.energyCapacityAvailable} (${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/t)`, ePct > 0.6 ? '#4caf50' : '#ffc107');

    // storage
    if (room.storage) push(`仓储 ${room.storage.store[RESOURCE_ENERGY]} 能量`, '#26a69a');

    // source 采集饱和度（每个 source 当前剩余 / 容量）
    const sources = room.find(FIND_SOURCES);
    sources.forEach((s, i) => {
      const sp = s.energyCapacity ? s.energy / s.energyCapacity : 0;
      push(`矿${i + 1} ${bar(sp, 6)} ${s.energy}/${s.energyCapacity}`, '#cddc39');
    });

    // 人口
    push(`👥 ${roster} (共${Object.values(counts).reduce((a, b) => a + b, 0)})`, '#ccc');

    // 建造进度（工地数 + 总进度）
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    if (sites.length) {
      let prog = 0, total = 0;
      sites.forEach((st) => { prog += st.progress; total += st.progressTotal; });
      push(`🔨 工地${sites.length}个 ${bar(total ? prog / total : 0, 6)} ${total ? (prog / total * 100).toFixed(0) : 0}%`, '#ff9800');
    }

    // tower 能量（防御就绪度）
    const towers = room.find(FIND_MY_STRUCTURES, { filter: (st) => st.structureType === STRUCTURE_TOWER });
    if (towers.length) {
      const te = towers.reduce((a, t) => a + t.store[RESOURCE_ENERGY], 0);
      const tc = towers.reduce((a, t) => a + t.store.getCapacity(RESOURCE_ENERGY), 0);
      push(`🗼 塔${towers.length} ${bar(tc ? te / tc : 0, 5)}`, '#90a4ae');
    }

    // CPU + bucket
    push(`⚙ CPU ${Game.cpu.getUsed().toFixed(1)}/${Game.cpu.limit} bkt ${Game.cpu.bucket}`, '#ce93d8');

    // 过往 N tick 平均统计（能量净流入 + CPU，用分钟描述窗口）
    try {
      const tracker = require('stats.tracker');
      const st = tracker.compute(room.name);
      if (st) push(`📈 近${(st.window * 3.33 / 60).toFixed(1)}分均: 能${st.eRate >= 0 ? '+' : ''}${st.eRate}/t CPU${st.cpuAvg}`, '#80cbc4');
    } catch (e) { /* ignore */ }

    // 威胁详情
    if (hostiles.length) {
      let atk = 0, heal = 0;
      hostiles.forEach((h) => { atk += h.getActiveBodyparts(ATTACK) + h.getActiveBodyparts(RANGED_ATTACK); heal += h.getActiveBodyparts(HEAL); });
      push(`⚠ 入侵 ${hostiles.length}敌 攻${atk} 治${heal}!`, '#f44336');
      for (const h of hostiles) v.circle(h.pos, { radius: 0.5, stroke: '#f44336', fill: 'transparent', strokeWidth: 0.15 });
    } else {
      push(`✓ 安全`, '#4caf50');
    }

    this._render(v, lines, x, y, align, mini);
  },

  // 渲染：背板 + 逐行文字（纯文字堆叠）
  _render(v, lines, x, y, align, mini) {
    const lineH = 0.62;
    const w = mini ? 6.5 : 9;
    const h = lines.length * lineH + 0.5;
    // 背板（右对齐时往左偏）
    const bx = align === 'right' ? x - w + 0.3 : x - 0.4;
    v.rect(bx, y - 0.6, w, h, { fill: '#000', opacity: 0.5, stroke: '#4fc3f7', strokeWidth: 0.04, radius: 0.2 });
    let cy = y;
    for (const ln of lines) {
      v.text(ln.t, x, cy, { align, color: ln.c, font: mini ? 0.55 : 0.5, opacity: 0.95 });
      cy += lineH;
    }
  },
};
