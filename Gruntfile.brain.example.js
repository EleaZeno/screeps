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
 *  3) 必须上传完整模块集，漏传会导致线上模块被删→殖民地瘫痪。
 *     （历史旧配置只列了 9 个，会丢 genome/worldmodel/build.planner/layout.planner 等）
 *
 * 部署后无需手动切分支（brain 已是 activeWorld）。
 */
const fs = require('fs');
const path = require('path');

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
  'tower.control': 'tower.control.js',
  'link.control': 'link.control.js',
  'remote.mining': 'remote.mining.js',
  'econ.market': 'econ.market.js',
  'colony.link': 'colony.link.js',
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
        email: process.env.SCREEPS_EMAIL,
        token: process.env.SCREEPS_TOKEN,
        branch: 'brain',
      },
      dist: {
        src: [DIST + '/*.js'],
      },
    },
  });

  // 一条命令完成：准备 dist -> 上传
  grunt.registerTask('check-auth', function () {
    if (!process.env.SCREEPS_EMAIL || !process.env.SCREEPS_TOKEN) grunt.fail.fatal('缺少 SCREEPS_EMAIL / SCREEPS_TOKEN 环境变量');
  });
  grunt.registerTask('deploy', ['check-auth', 'prepare-dist', 'screeps']);
  grunt.registerTask('default', ['deploy']);
};
