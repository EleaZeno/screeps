'use strict';

/*
 * visual.js — 游戏画面内图形化叠加（RoomVisual）
 * ==================================================================
 * 比控制台 HTML 更"图形化"：直接在房间画面上画文字/进度条/方框/连线。
 * 鼠标看房间时实时显示，刷新房间还在（每 tick 重画，存在 room.visual）。
 * 画在 spawn 附近，显示：RCL 进度条、能量、人口、CPU、威胁预警。
 */

module.exports = {
  draw(room) {
    if (!room.controller || !room.controller.my) return;
    const v = room.visual;
    if (!v || typeof v.text !== 'function') return; // 防御：mock/无可视化环境
    const c = room.controller;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    // 固定画在房间左上角（1,1 起），不跟 spawn 跑、不挡建筑
    const x = 1;
    let y = 1.5;

    // 半透明背板（让左上角面板在任何地形上都清晰可读）
    v.rect(x - 0.5, 0.5, 9.5, 5.2, { fill: '#000', opacity: 0.55, stroke: '#4fc3f7', strokeWidth: 0.05 });

    // 标题
    v.text(`🏠 ${room.name}  RCL${c.level}`, x, y, { align: 'left', color: '#ffd54f', font: 0.7 });
    y += 1;

    // 控制器进度条
    const ctrlPct = c.progressTotal ? c.progress / c.progressTotal : 1;
    this._bar(v, x, y, '控制器', ctrlPct, '#4fc3f7');
    y += 0.8;

    // 能量条
    const ePct = room.energyCapacityAvailable ? room.energyAvailable / room.energyCapacityAvailable : 0;
    this._bar(v, x, y, '能量', ePct, ePct > 0.6 ? '#4caf50' : '#ffc107');
    y += 0.8;

    // 人口
    const counts = {};
    for (const n in Game.creeps) {
      if (Game.creeps[n].room.name !== room.name) continue;
      const r = Game.creeps[n].memory.role;
      counts[r] = (counts[r] || 0) + 1;
    }
    const CN = { harvester: '采', miner: '矿', hauler: '运', upgrader: '升', builder: '建', defender: '防', attacker: '攻' };
    const roster = Object.keys(counts).map((k) => `${CN[k] || k}${counts[k]}`).join(' ');
    v.text(`👥 ${roster}`, x, y, { align: 'left', color: '#ccc', font: 0.5 });
    y += 0.7;

    // CPU + bucket
    v.text(`⚙ CPU ${Game.cpu.getUsed().toFixed(1)}/${Game.cpu.limit}  bucket ${Game.cpu.bucket}`, x, y, { align: 'left', color: '#9c27b0', font: 0.5 });
    y += 0.7;

    // 威胁预警（画在面板内）
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length) {
      v.text(`⚠️ 入侵 ${hostiles.length} 敌!`, x, y, { align: 'left', color: '#f44336', font: 0.6 });
      // 给每个敌人画红圈（这个画在敌人位置，属预警必要）
      for (const h of hostiles) v.circle(h.pos, { radius: 0.5, stroke: '#f44336', fill: 'transparent', strokeWidth: 0.15 });
    } else {
      v.text(`✓ 安全`, x, y, { align: 'left', color: '#4caf50', font: 0.5 });
    }
  },

  _bar(v, x, y, label, pct, color) {
    const W = 5;
    v.text(label, x, y, { align: 'left', color: '#aaa', font: 0.45 });
    v.rect(x + 1.6, y - 0.35, W, 0.5, { fill: '#333', stroke: '#555', strokeWidth: 0.05 });
    v.rect(x + 1.6, y - 0.35, W * Math.min(pct, 1), 0.5, { fill: color });
    v.text(`${(pct * 100).toFixed(0)}%`, x + 1.6 + W + 0.3, y, { align: 'left', color, font: 0.45 });
  },
};
