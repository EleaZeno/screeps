/*
 * Gruntfile.brain.js — 把 V3 大脑部署到 Screeps "brain" 测试分支
 * ------------------------------------------------------------------
 * 用法: npx grunt --gruntfile Gruntfile.brain.js screeps
 * 上传到 brain 分支（不动 default，线上旧系统继续跑）。
 * 部署后需在游戏里手动把 brain 分支切为 activeWorld 才会接管房间。
 *
 * 注意: main.js 上传的是 brain.loop.js 的内容（Screeps 入口必须叫 main）。
 * 这里用 rename 技巧: 把 brain.loop.js 作为 main 模块。
 */
module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-screeps');
  grunt.initConfig({
    screeps: {
      options: {
        email: '15703377328@163.com',
        token: '3456b576-97ec-41bb-90a3-5951670ba79b',
        branch: 'brain',
      },
      dist: {
        src: [
          'brain.loop.js',
          'brain.js',
          'blackboard.js',
          'market.js',
          'utility.js',
          'executor.js',
          'spawning.js',
          // 复用的已验证旧资产
          'utils.js',
          'source.scheduler.js',
        ],
      },
    },
  });
};
