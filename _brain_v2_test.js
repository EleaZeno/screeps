'use strict';
// brain v2 前瞻逻辑场景测试：mock 各种局面，验证权重输出合理
global.FIND_HOSTILE_CREEPS=1; global.FIND_MY_CONSTRUCTION_SITES=2; global.FIND_MY_SPAWNS=3; global.FIND_MY_CREEPS=10;
global.ATTACK='attack'; global.RANGED_ATTACK='ranged'; global.WORK='work'; global.RESOURCE_ENERGY='energy';
global.Memory={}; global.Game={time:1000};

// 让 brain 里的 require('planner'/'adaptive') 解析到本地文件
const _path=require('path'); const _Module=require('module'); const _orig=_Module._resolveFilename;
_Module._resolveFilename=function(req,...a){ if(['planner','adaptive'].includes(req)) return _path.join(__dirname,req+'.js'); return _orig.call(this,req,...a); };

const brain=require('./brain.js');

function mkRoom(o){
  const sites=(o.sites||[]).map(s=>({progress:s.p,progressTotal:s.t}));
  const hostiles=(o.hostiles||[]).map(h=>({pos:{x:h.x,y:h.y},getActiveBodyparts:(p)=>h.body&&h.body[p]||0}));
  const spawn={pos:{x:25,y:25}};
  return {
    controller:{level:o.rcl||2, ticksToDowngrade:o.ttd},
    energyCapacityAvailable:o.cap||550,
    energyAvailable:o.cur!==undefined?o.cur:550,
    storage:o.stored!==undefined?{store:{energy:o.stored}}:null,
    find(t){ if(t===FIND_HOSTILE_CREEPS)return hostiles; if(t===FIND_MY_CONSTRUCTION_SITES)return sites; if(t===FIND_MY_SPAWNS)return [spawn]; if(t===FIND_MY_CREEPS)return new Array(o.creeps!==undefined?o.creeps:10).fill({}); return []; }
  };
}
function run(label,o,checks){
  Memory.brain=undefined; Game.time+=10;
  // 跑两次让能量趋势采样生效（第二次跳过 nextThink 才会重算）
  if(o.prevE!==undefined){ const r0=mkRoom({...o,cur:o.prevE}); brain.think(r0); Game.time+=6; }
  const r=mkRoom(o);
  const w=brain.think(r);
  const d=Memory.brain._diag||{};
  console.log(`\n[${label}]`);
  console.log('  weights:',Object.entries(w).map(([k,v])=>`${k}=${(Math.round(v*100)/100)}`).join(' '));
  console.log('  diag:',JSON.stringify(d));
  let pass=true;
  for(const c of checks){ const ok=c.f(w,d); if(!ok)pass=false; console.log(`    ${ok?'✓':'✗'} ${c.name}`); }
  return pass;
}

let all=true;
all &= run('正常发育(有工地,工程量大,无敌)',{rcl:2,cur:300,cap:550,sites:[{p:0,t:3000},{p:100,t:3000}],ttd:8000},[
  {name:'build应高(工程量大)',f:w=>w.build>1.3},
  {name:'upgrade应较低(先盖房)',f:w=>w.upgrade<1.0},
  {name:'defend近0(无敌)',f:w=>w.defend<0.1},
]);
all &= run('工地快完工(剩余少)',{rcl:2,cur:400,sites:[{p:2900,t:3000}],ttd:8000},[
  {name:'build应下降(快完工)',f:w=>w.build<1.2},
  {name:'upgrade应回升',f:w=>w.upgrade>0.7},
]);
all &= run('降级危机(ttd=800)',{rcl:2,cur:400,sites:[{p:0,t:3000}],ttd:800},[
  {name:'upgrade应被顶高(防降级)',f:w=>w.upgrade>2.0},
]);
all &= run('降级临近但未到(ttd=3000)',{rcl:2,cur:400,sites:[{p:0,t:3000}],ttd:3000},[
  {name:'upgrade应中等(连续提前,非硬跳)',f:w=>w.upgrade>0.8&&w.upgrade<2.5},
]);
all &= run('敌人远(20格,弱)',{rcl:3,cur:400,sites:[],hostiles:[{x:25,y:5,body:{attack:2}}],ttd:8000},[
  {name:'defend提前拉起(预判)',f:w=>w.defend>2.5},
]);
all &= run('敌人贴脸(强)',{rcl:3,cur:400,sites:[],hostiles:[{x:24,y:25,body:{attack:5,ranged:2}}],ttd:8000},[
  {name:'defend飙高',f:w=>w.defend>6},
  {name:'fill提前抬(要孵防御)',f:w=>w.fill>1.5},
]);
all &= run('能量流失趋势(prevE高->cur低)',{rcl:2,prevE:500,cur:200,cap:550,sites:[],ttd:8000},[
  {name:'fill提前抬(预测要饿)',f:w=>w.fill>1.3},
]);

console.log('\n'+(all?'✅ 全部前瞻场景 PASS':'❌ 有场景未通过'));
process.exit(all?0:1);
