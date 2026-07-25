/*
 * Gruntfile.brain.js — 部署 V3 大脑到 Screeps **brain** 分支（线上 activeWorld）
 * ==================================================================
 * 用法:  npx grunt --gruntfile Gruntfile.brain.js deploy
 *
 * 关键点（修正历史隐患）:
 *  1) 线上 activeWorld 分支 = "brain"（不是 default）。
 *  2) Screeps 入口模块必须叫 main —— 而本仓库入口逻辑在 brain.loop.js。
 *     grunt-screeps 用文件 basename 作模块名，无法自动改名，
 *     故 deploy 任务先把源文件复制进 _dist/ 并把 brain.loop.js 改名为 main.js，
 *     再从 _dist/ 上传，保证线上模块名 = main。
 *  3) 必须上传**全部 19 个线上模块**，漏传会导致线上模块被删→殖民地瘫痪。
 *     （历史旧配置只列了 9 个，会丢 genome/worldmodel/build.planner/layout.planner 等；
 *      17 个版本会丢 tower.control/remote.mining→塔静默。已与 /api/user/code?branch=brain 对齐为 19）
 *
 * 部署后无需手动切分支（brain 已是 activeWorld）。
 */
const fs = require('fs');
const path = require('path');
const SCREEPS_EMAIL = process.env.SCREEPS_EMAIL;
const SCREEPS_TOKEN = process.env.SCREEPS_TOKEN;

// 线上 brain 分支的完整模块集（与 /api/user/code?branch=brain 对齐）
// 左= 线上模块名, 右= 本地源文件
const MODULE_MAP = {
  'main': 'brain.loop.js',          // 入口改名
  'brain': 'brain.js',
  'blackboard': 'blackboard.js',
  'market': 'market.js',
  'utility': 'utility.js',
  'executor': 'executor.js',
  'spawning': 'spawning.js',
  'planner': 'planner.js',
  'adaptive': 'adaptive.js',
  'utils': 'utils.js',
  'worldmodel': 'worldmodel.js',
  'genome': 'genome.js',
  'roadmap': 'roadmap.js',
  'infra': 'infra.js',
  'source.scheduler': 'source.scheduler.js',
  'build.planner': 'build.planner.js',
  'layout.planner': 'layout.planner.js',
  // tower 主动控制（防御开火/治疗/维修）—— brain.loop 要 require，漏传塔会静默
  'tower.control': 'tower.control.js',
  // RCL5+ link 能量瞬移（source→controller/storage）—— brain.loop 要 require，漏传 link 空转
  'link.control': 'link.control.js',
  // 跨房外矿（默认休眠，需 Memory.remote.enabled 才生效；上传以与线上 19 模块对齐）
  'remote.mining': 'remote.mining.js',
  // RCL6+ 官方市场变现（卖矿/余量能量换 credits；无 terminal 自动休眠）
  'econ.market': 'econ.market.js',
  // 多房联动层(2026-07-02)：跨房防御互助 + 能量支援（brain.loop 全局调一次；单房时空转）
  'colony.link': 'colony.link.js',
  // 自动侦察→候选评分→claim→Pioneer 建首 Spawn→主循环接管
  'expansion': 'expansion.js',
};

module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-screeps');

  const DIST = '_dist';

  grunt.registerTask('prepare-dist', '复制源文件到 _dist/ 并把 brain.loop.js 改名为 main.js', function () {
    if (fs.existsSync(DIST)) {
      for (const f of fs.readdirSync(DIST)) fs.unlinkSync(path.join(DIST, f));
    } else {
      fs.mkdirSync(DIST);
    }
    let n = 0;
    for (const mod in MODULE_MAP) {
      const srcFile = MODULE_MAP[mod];
      if (!fs.existsSync(srcFile)) grunt.fail.fatal('缺少源文件: ' + srcFile + ' (模块 ' + mod + ')');
      fs.copyFileSync(srcFile, path.join(DIST, mod + '.js'));
      n++;
    }
    grunt.log.ok('prepare-dist: 准备了 ' + n + ' 个模块 -> ' + DIST + '/');
  });

  grunt.initConfig({
    screeps: {
      options: {
        email: SCREEPS_EMAIL,
        token: SCREEPS_TOKEN,
        branch: 'brain',
      },
      dist: {
        src: [DIST + '/*.js'],
      },
    },
  });

  // 一条命令完成：准备 dist -> 上传
  grunt.registerTask('check-auth', '检查环境变量中的 Screeps 凭据', function () {
    if (!SCREEPS_EMAIL || !SCREEPS_TOKEN) grunt.fail.fatal('缺少 SCREEPS_EMAIL / SCREEPS_TOKEN 环境变量');
  });
  grunt.registerTask('deploy', ['check-auth', 'prepare-dist', 'screeps']);
  grunt.registerTask('default', ['deploy']);
};
