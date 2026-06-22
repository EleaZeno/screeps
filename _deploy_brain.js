'use strict';
/*
 * _deploy_brain.js — 用 Screeps API 直接上传 V3 大脑到 "brain" 分支
 * 完全可控的模块命名：main 模块内容 = brain.loop 的 loop。
 * 不动 default 分支。部署后游戏里手动切 activeWorld。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
const BRANCH = 'brain';
const DIR = path.join(__dirname);

// 要上传的模块（basename 去 .js = 模块名）
const FILES = [
  'brain.js', 'blackboard.js', 'market.js', 'utility.js',
  'executor.js', 'spawning.js', 'planner.js', 'adaptive.js',
  'utils.js', 'source.scheduler.js',
  // 工程规划层（基建+路网自动规划）
  'build.planner.js', 'layout.planner.js', 'roadmap.js', 'infra.js',
];

function api(p, method, bodyObj) {
  return new Promise((res, rej) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : null;
    const o = { host: 'screeps.com', path: '/api/' + p, method: method || 'GET',
      headers: { 'X-Token': TOKEN, 'X-Username': TOKEN } };
    if (data) { o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request(o, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}

(async () => {
  const modules = {};
  // main 模块 = brain.loop 内容（Screeps 入口必须叫 main）
  modules.main = fs.readFileSync(path.join(DIR, 'brain.loop.js'), 'utf8');
  for (const f of FILES) {
    const name = f.replace(/\.js$/, '');
    modules[name] = fs.readFileSync(path.join(DIR, f), 'utf8');
  }
  console.log('上传模块:', Object.keys(modules).join(', '));
  // POST /api/user/code  { branch, modules }
  const r = await api('user/code', 'POST', { branch: BRANCH, modules });
  console.log('部署结果:', r.status, r.body.slice(0, 300));
})().catch(e => console.log('ERR', e.message));
