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
 *   paths()             — 路径缓存命中率
 *   intel()             — 情报/威胁/扩张快照
 *   resetProf()         — 清空 profiler 统计重新采样
 *   resetPaths()        — 清空路径缓存
 *   attack('E5N53', 4)  — 开启进攻：目标房 + 小队规模
 *   stopAttack()        — 关闭进攻
 *   setOversub(2.0)     — 调采集者超额订阅系数
 *   pixelOn()/pixelOff()— 开关 bucket 满自动生成 pixel
 */

module.exports = {
  register() {
    const dashboard = require('dashboard');
    const profiler = require('cpu.profiler');
    const pathCache = require('path.cache');

    global.help = function () {
      console.log(
        `<div style="font-family:Consolas,monospace;font-size:12px;background:#1a1a1a;padding:8px 12px;border-radius:6px;border:1px solid #333;line-height:1.6">` +
        `<div style="color:#4fc3f7;font-weight:bold;font-size:13px">🎮 控制台命令大全</div>` +
        cmd('dash()', '立即打印中文图形仪表盘') +
        cmd('prof()', 'CPU 热点排行（找性能瓶颈）') +
        cmd('paths()', '路径缓存命中率') +
        cmd('intel()', '情报/威胁/扩张预案快照') +
        cmd('resetProf()', '清空 profiler 重新采样') +
        cmd('resetPaths()', '清空路径缓存') +
        cmd("attack('E5N53',4)", '开启进攻：目标房+小队规模') +
        cmd('stopAttack()', '关闭进攻') +
        cmd('setOversub(2.0)', '调采集者超额订阅系数') +
        cmd('pixelOn() / pixelOff()', '开关自动生成 pixel') +
        `</div>`
      );
      return '👆 输入上面任意命令（带括号）执行';
    };
    function cmd(c, desc) {
      return `<div style="color:#aaa">　<span style="color:#ffd54f;font-weight:bold">${c.replace(/</g, '&lt;')}</span> <span style="color:#666">—</span> ${desc}</div>`;
    }

    global.dash = function () { dashboard.print(); return '✅ 仪表盘已刷新'; };

    global.prof = function () {
      const hot = profiler.hotspots();
      console.log(`🔥 CPU 热点（平均耗时降序）：\n  ` + hot.join('\n  '));
      return `共 ${hot.length} 个模块，采样 ${(Memory.profiler && Memory.profiler.samples) || 0} 次`;
    };

    global.paths = function () {
      const s = pathCache.stats();
      return `🗺 路径缓存：命中率 ${s.hitRate}% | ${s.hits} 命中 / ${s.misses} 未命中 | 缓存 ${s.entries} 条`;
    };

    global.intel = function () {
      const i = Memory.intel || {};
      console.log(`📡 情报快照：\n` + JSON.stringify(i.tasks || {}, null, 1));
      return `更新时间：` + JSON.stringify(i.updatedAt || {});
    };

    global.resetProf = function () { Memory.profiler = { avg: {}, last: {}, samples: 0 }; return '✅ profiler 已清空，重新采样中'; };
    global.resetPaths = function () { Memory.pathCache = { entries: {}, hits: 0, misses: 0 }; return '✅ 路径缓存已清空'; };

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
