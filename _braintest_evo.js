'use strict';
// 进化系统测试：验证 (1+1)-ES 真的爬山（优则保留、劣则回滚、变异在界内、用真实progress）
global.Game = { time: 1000 };
const path = require('path'); const Module = require('module'); const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === 'genome') return path.join(__dirname, 'genome.js'); return orig.call(this, r, ...a); };
const genome = require('./genome');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { console.log('  PASS ' + m); pass++; } else { console.log('  FAIL ' + m); fail++; } }

function mkRoom(level, prog) { return { controller: { level, progress: prog } }; }

console.log('\n=== 进化 (1+1)-ES ===');
const bm = {};
genome.current(bm);
ok(bm.genome && bm.genome.genes && bm.genome.genes.proxDecay === 0.04, '基因组初始化为默认值');

// 所有基因在合法范围
let inRange = true;
for (const k in genome.GENES) { const [, lo, hi] = genome.GENES[k]; if (bm.genome.genes[k] < lo || bm.genome.genes[k] > hi) inRange = false; }
ok(inRange, '初始基因都在合法范围');

// 第一次 evolve：建基线（progress 不变 → 仅记录）
Game.time = 1000; genome.evolve(mkRoom(2, 1000), bm, 300);
ok(bm.genome.baselineProg !== null, '首次 evolve 建立 baseline');

// 第二次（300tick 后，progress 涨了）→ 建 champion
Game.time = 1300; genome.evolve(mkRoom(2, 4000), bm, 300); // 涨3000/300=10/tick
ok(bm.genome.best && bm.genome.best.fitness > 0, '建立 champion，fitness>0 (实际=' + (bm.genome.best && Math.round(bm.genome.best.fitness * 100) / 100) + ')');
const champFit = bm.genome.best.fitness;
const champGenes = JSON.stringify(bm.genome.champion);

// 挑战者表现差（progress 涨得少）→ 应回滚到 champion
Game.time = 1600; genome.evolve(mkRoom(2, 4300), bm, 300); // 只涨300/300=1/tick，远低于champion
ok(JSON.stringify(bm.genome.champion) === champGenes, '挑战者更差 → champion 不变（回滚生效）');
ok(bm.genome.best.fitness === champFit, '更差时 best.fitness 保持不变');

// 挑战者表现更好（progress 涨得多）→ 应更新 champion
const beforeBest = bm.genome.best.fitness;
Game.time = 1900; genome.evolve(mkRoom(2, 4300 + 6000), bm, 300); // 涨6000/300=20/tick，远高
ok(bm.genome.best.fitness > beforeBest, '挑战者更优 → champion 更新 (fit ' + Math.round(beforeBest) + '→' + Math.round(bm.genome.best.fitness) + ')');

// 变异后基因仍在界内
let stillInRange = true;
for (const k in genome.GENES) { const [, lo, hi] = genome.GENES[k]; if (bm.genome.genes[k] < lo - 1e-9 || bm.genome.genes[k] > hi + 1e-9) stillInRange = false; }
ok(stillInRange, '变异后基因仍在合法范围（不会跑飞）');

// 代数在增长
ok(bm.genome.gen >= 2, '进化代数在增长 (gen=' + bm.genome.gen + ')');

console.log('\n========================================');
console.log(fail === 0 ? `🎉 ALL ${pass} CHECKS PASSED` : `❌ ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
