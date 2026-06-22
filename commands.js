'use strict';

/*
 * commands.js — 控制台交互命令
 * ==================================================================
 * Screeps 控制台是个真 JS REPL：把函数挂到 global，就能在控制台直接敲调用，
 * 这就是 Screeps 的"交互"方式（输出区不能放按钮，但能敲命令 + 房间可视化）。
 *
 * 在游戏控制台直接输入（带括号）：
 *   help()              — 列出所有命令
 *   dash()              — 立即打印一次中文图形仪表盘
 *   prof()              — 打印 CPU 热点排行
 *   intel()             — 情报/威胁/扩张快照
 *   resetProf()         — 清空 profiler 统计重新采样
 *   attack('E5N53', 4)  — 开启进攻：目标房 + 小队规模
 *   stopAttack()        — 关闭进攻
 *   setOversub(2.0)     — 调采集者超额订阅系数
 *   pixelOn()/pixelOff()— 开关 bucket 满自动生成 pixel
 */

module.exports = {
  register() {
    const dashboard = require('dashboard');
    const profiler = require('cpu.profiler');
    const statsTracker = require('stats.tracker');
    const roadmap = require('roadmap');

    global.help = function (cat) {
      const G = (t) => `<div style="color:#4fc3f7;font-weight:bold;margin-top:5px">${t}</div>`;
      let body = `<div style="font-family:Consolas,monospace;font-size:12px;background:#1a1a1a;padding:8px 12px;border-radius:6px;border:1px solid #333;line-height:1.6">` +
        `<div style="color:#ffd54f;font-weight:bold;font-size:14px">🎮 控制台命令大全</div>`;
      body += G('📊 仪表盘 / 显示');
      body += cmd('roadmap()', '一个月发育总路线图(RCL2→8)');
      body += cmd('plan()', '当前 RCL 焦点任务');
      body += cmd('dash()', '打印中文图形仪表盘');
      body += cmd('hud(\'tr\')', 'HUD位置: tl/tr/bl/ctrl/mini/off');
      body += cmd('hud()', '一键显示/隐藏 HUD');
      body += cmd('textMode()/htmlMode()', '切纯文本 / HTML 仪表盘');
      body += G('📈 统计 / 预测');
      body += cmd('stats()', '过往100tick平均统计(能量流入/CPU/人口)');
      body += cmd('eta()', '预测距下一级RCL/GCL还要多久');
      body += cmd('prof()', 'CPU 热点排行');
      body += cmd('intel()', '情报/威胁/扩张快照');
      body += G('🗺 侦察 / 房间');
      body += cmd('neighbors()', '扫描四邻房间所有者+等级');
      body += cmd('roomInfo(\'E9N52\')', '某房详情');
      body += cmd('creeps()', '列出所有 creep 及状态');
      body += G('⚙️ 控制 / 调参');
      body += cmd('setOversub(2.0)', '调采集者超额订阅系数');
      body += cmd('attack(\'E9N51\',4)', '开启进攻：目标房+小队规模');
      body += cmd('stopAttack()', '关闭进攻');
      body += cmd('pixelOn()/pixelOff()', '开关自动生成 pixel');
      body += cmd('say(\'name\',\'文字\')', '让某 creep 说话(调试/好玩)');
      body += G('🧹 重置');
      body += cmd('resetProf()', '清空 profiler 重新采样');
      body += cmd('resetStats()', '清空滞动统计重新采样');
      body += `</div>`;
      console.log(body);
      return '👆 输入任意命令（带括号）执行';
    };
    function cmd(c, desc) {
      return `<div style="color:#aaa">　<span style="color:#ffd54f;font-weight:bold">${c.replace(/</g, '&lt;')}</span> <span style="color:#666">—</span> ${desc}</div>`;
    }

    global.dash = function () { dashboard.print(); return '✅ 仪表盘已刷新'; };

    // 一个月发育总路线图
    global.roadmap = function () {
      const home = Object.keys(Game.rooms).find((r) => Game.rooms[r].controller && Game.rooms[r].controller.my);
      const rcl = home ? Game.rooms[home].controller.level : 1;
      console.log(roadmap.fullPlan(rcl));
      return '👆 ✅=已过  ▶️=当前  ⬜=未来';
    };
    // 当前发育相位 + 焦点任务
    global.plan = function () {
      const home = Object.keys(Game.rooms).find((r) => Game.rooms[r].controller && Game.rooms[r].controller.my);
      if (!home) return '⚠ 无主房';
      const p = roadmap.phase(Game.rooms[home]);
      return `🎯 RCL${p.rcl} 当前任务：${p.focus}` + (p.maxed ? ' 👑已满级' : ` → 下一级 RCL${p.nextLevel}`);
    };

    // 房间 HUD 位置/显隐切换
    global.hud = function (pos) {
      Memory.hud = Memory.hud || { pos: 'tr', on: true };
      if (pos === undefined) { // 无参：显隐切换
        Memory.hud.on = !Memory.hud.on;
        return Memory.hud.on ? '👁 HUD 已显示' : '🙈 HUD 已隐藏（再输 hud() 恢复）';
      }
      const valid = ['tl', 'tr', 'bl', 'ctrl', 'mini', 'off'];
      if (!valid.includes(pos)) return '❌ 位置只能是: tl(左上) tr(右上) bl(左下) ctrl(跟控制器) mini(极简) off(关)';
      Memory.hud.pos = pos; Memory.hud.on = (pos !== 'off');
      const CN = { tl: '左上角', tr: '右上角', bl: '左下角', ctrl: '控制器旁', mini: '极简版(左上)', off: '关闭' };
      return `✅ HUD → ${CN[pos]}`;
    };

    global.textMode = function () {
      Memory.config = Memory.config || {}; Memory.config.dashboardText = true;
      dashboard.print(); return '✅ 已切换纯文本仪表盘（HTML 不渲染时用这个）';
    };
    global.htmlMode = function () {
      Memory.config = Memory.config || {}; Memory.config.dashboardText = false;
      dashboard.print(); return '✅ 已切换 HTML 图形仪表盘';
    };

    global.prof = function () {
      const hot = profiler.hotspots();
      console.log(`🔥 CPU 热点（平均耗时降序）：\n  ` + hot.join('\n  '));
      return `共 ${hot.length} 个模块，采样 ${(Memory.profiler && Memory.profiler.samples) || 0} 次`;
    };


    global.intel = function () {
      const i = Memory.intel || {};
      console.log(`📡 情报快照：\n` + JSON.stringify(i.tasks || {}, null, 1));
      return `更新时间：` + JSON.stringify(i.updatedAt || {});
    };

    global.resetProf = function () { Memory.profiler = { avg: {}, last: {}, samples: 0 }; return '✅ profiler 已清空，重新采样中'; };
    global.resetStats = function () { Memory.stats2 = {}; return '✅ 滞动统计已清空，重新采样中'; };

    // 过往 N tick 平均统计
    global.stats = function (roomName) {
      const rn = roomName || Object.keys(Game.rooms).find((r) => Game.rooms[r].controller && Game.rooms[r].controller.my);
      const st = statsTracker.compute(rn);
      if (!st) return '⚠ 数据不足（刚重启？再等几 tick）';
      console.log(
        `<div style="font-family:Consolas,monospace;font-size:12px;background:#1a1a1a;padding:8px 12px;border-radius:6px;border:1px solid #333;line-height:1.7">` +
        `<div style="color:#4fc3f7;font-weight:bold">📈 ${rn} 过往 ${(st.window * 3.33 / 60).toFixed(1)} 分钟统计</div>` +
        `<div style="color:#aaa">　能量净流入　<b style="color:${st.eRate >= 0 ? '#4caf50' : '#f44336'}">${st.eRate >= 0 ? '+' : ''}${st.eRate}/tick</b></div>` +
        `<div style="color:#aaa">　控制器增长　<b style="color:#4fc3f7">+${st.cpRate}/tick</b></div>` +
        `<div style="color:#aaa">　CPU 平均/峰值 <b style="color:#ce93d8">${st.cpuAvg} / ${st.cpuMax}</b></div>` +
        `<div style="color:#aaa">　平均 creep 数 <b style="color:#ccc">${st.creepAvg}</b></div>` +
        `<div style="color:#666;font-size:11px">　(采样 ${st.samples} 点, 1 tick≈3.33秒)</div></div>`
      );
      return '✅';
    };

    // 预测距下一级 ETA（基于过往平均速率）
    global.eta = function () {
      const out = [];
      for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!room.controller || !room.controller.my) continue;
        const t = statsTracker.etaNextLevel(room);
        const fmt = (ticks) => { if (!ticks) return '?'; const sec = ticks * 3.33; if (sec < 3600) return Math.round(sec / 60) + '分钟'; return (sec / 3600).toFixed(1) + '小时'; };
        out.push(`🏠 ${rn} RCL${room.controller.level}→${room.controller.level + 1}: ${t ? `约 ${t} tick (${fmt(t)})` : '数据不足/未增长'}`);
      }
      // GCL ETA
      const gst = Memory.stats2 && Object.keys(Memory.stats2)[0];
      console.log(out.join('\n'));
      return `🌐 GCL${Game.gcl ? Game.gcl.level : '?'} ${Game.gcl ? (Game.gcl.progress / Game.gcl.progressTotal * 100).toFixed(1) : '?'}% (到 GCL${(Game.gcl ? Game.gcl.level : 0) + 1} 需 ${Game.gcl ? (Game.gcl.progressTotal - Game.gcl.progress).toLocaleString() : '?'} 点)`;
    };

    // 扫描四邻房间（需有视野或用已缓存情报；这里用 Game.map 拿基础信息）
    global.neighbors = function () {
      const home = Object.keys(Game.rooms).find((r) => Game.rooms[r].controller && Game.rooms[r].controller.my);
      if (!home) return '⚠ 无主房';
      const ex = Game.map.describeExits(home);
      const dir = { 1: '上(N)', 3: '右(E)', 5: '下(S)', 7: '左(W)' };
      const out = [`🧭 ${home} 四邻：`];
      for (const d in ex) {
        const rn = ex[d];
        let info = rn;
        const room = Game.rooms[rn];
        if (room && room.controller) {
          if (room.controller.owner) info += ` [${room.controller.owner.username} RCL${room.controller.level}]`;
          else info += ' [无主]';
        } else info += ' [无视野，需斛候]';
        out.push(`　${dir[d] || d}: ${info}`);
      }
      console.log(out.join('\n'));
      return '💡 详细等级需有视野，可派斛候或看地图';
    };

    global.roomInfo = function (rn) {
      const room = Game.rooms[rn];
      if (!room) return `⚠ ${rn} 无视野`;
      const c = room.controller;
      const src = room.find(FIND_SOURCES).length;
      const my = room.find(FIND_MY_STRUCTURES).length;
      const en = room.find(FIND_HOSTILE_CREEPS).length;
      return `🏠 ${rn}: ${c ? (c.owner ? c.owner.username + ' RCL' + c.level : (c.my ? '我的 RCL' + c.level : '无主')) : '无控制器'} | ${src}矿 | 建筑${my} | 敌${en}`;
    };

    global.creeps = function () {
      const out = [];
      for (const n in Game.creeps) {
        const c = Game.creeps[n];
        out.push(`　${c.memory.role || '?'} ${n} @${c.room.name}(${c.pos.x},${c.pos.y}) hp${c.hits}/${c.hitsMax} 能${c.store ? c.store[RESOURCE_ENERGY] : 0}`);
      }
      console.log(`👥 共 ${out.length} 个 creep：\n` + out.join('\n'));
      return '✅';
    };

    global.say = function (name, text) {
      const c = Game.creeps[name];
      if (!c) return `⚠ 找不到 creep: ${name}`;
      c.say(text || '👋', true);
      return `✅ ${name} 说：${text}`;
    };

    global.attack = function (targetRoom, squadSize) {
      Memory.config = Memory.config || {};
      Memory.config.attack = { enabled: true, targetRoom, squadSize: squadSize || 4, type: 'melee' };
      return `⚔️ 进攻已开启 → 目标 ${targetRoom}，小队 ${squadSize || 4} 人。停战输入 stopAttack()`;
    };
    global.stopAttack = function () {
      Memory.config = Memory.config || {};
      Memory.config.attack = { enabled: false };
      return '🕊 进攻已关闭';
    };

    global.setOversub = function (v) {
      Memory.config = Memory.config || {};
      Memory.config.economy = Memory.config.economy || {};
      Memory.config.economy.harvesterOversub = v;
      return `✅ 采集者超额订阅系数 → ${v}（人数=开采格×${v}）`;
    };

    global.pixelOn = function () {
      Memory.config = Memory.config || {}; Memory.config.economy = Memory.config.economy || {};
      Memory.config.economy.autoPixel = true; return '💎 自动生成 pixel 已开启';
    };
    global.pixelOff = function () {
      Memory.config = Memory.config || {}; Memory.config.economy = Memory.config.economy || {};
      Memory.config.economy.autoPixel = false; return '💎 自动生成 pixel 已关闭';
    };
  },
};
