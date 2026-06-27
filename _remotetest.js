'use strict';
/* _remotetest.js — remote.mining 安全门控 + executor 路由回归 */
global.FIND_MY_CREEPS=3; global.FIND_HOSTILE_CREEPS=2; global.FIND_SOURCES=5;
global.FIND_MY_SPAWNS=6; global.FIND_DROPPED_RESOURCES=7; global.FIND_STRUCTURES=4; global.FIND_TOMBSTONES=8;
global.ATTACK='attack'; global.RANGED_ATTACK='ranged_attack'; global.RESOURCE_ENERGY='energy';
global.WORK='work'; global.CARRY='carry'; global.MOVE='move';
global.STRUCTURE_CONTAINER='container'; global.STRUCTURE_STORAGE='storage'; global.STRUCTURE_CONTROLLER='controller';
global._ = { filter:(obj,fn)=>Object.keys(obj).map(k=>obj[k]).filter(fn) };

let pass=0, fail=0;
function check(n,c){ if(c){pass++;console.log('  PASS '+n);} else {fail++;console.log('  FAIL '+n);} }

// minimal Game
function resetGame(){ global.Game={ time: 100, creeps:{}, rooms:{}, getObjectById:()=>null, map:{ findExit:()=>0 } }; global.Memory={}; }

const RM = require('./remote.mining.js');

// 1. 默认休眠：Memory.remote 未设 → 不孵化、不报错
{
  resetGame();
  let spawned=0;
  Game.rooms['E9N54']={ controller:{my:true,level:4}, find:(t)=>{
    if(t===FIND_MY_CREEPS) return new Array(10).fill({memory:{}});
    if(t===FIND_MY_SPAWNS) return [{spawning:false, spawnCreep:()=>{spawned++;return 0;}}];
    return [];
  }, energyCapacityAvailable:1300, energyAvailable:1300 };
  let ok=true; try{ RM.run(); }catch(e){ ok=false; console.log('   err',e.message);}
  check('默认未启用→不报错', ok);
  check('默认未启用→0孵化', spawned===0);
}

// 2. 启用但 home 人口不足(<6) → 不孵化
{
  resetGame();
  let spawned=0;
  Memory.remote={ enabled:true, routes:[{home:'E9N54',target:'E8N54',maxHarvest:2,maxHaul:3}] };
  Game.rooms['E9N54']={ controller:{my:true,level:4}, find:(t)=>{
    if(t===FIND_MY_CREEPS) return new Array(3).fill({memory:{}});  // 仅3人
    if(t===FIND_MY_SPAWNS) return [{spawning:false, spawnCreep:()=>{spawned++;return 0;}}];
    return [];
  }, energyCapacityAvailable:1300, energyAvailable:1300 };
  RM.run();
  check('启用但人口不足→不孵化', spawned===0);
}

// 3. 启用+人口足+到规划tick → 孵化 harvester
{
  resetGame();
  Game.time=100; // 100 % 25 === 0
  let body=null,mem=null;
  Memory.remote={ enabled:true, routes:[{home:'E9N54',target:'E8N54',maxHarvest:2,maxHaul:3}] };
  Game.rooms['E9N54']={ controller:{my:true,level:4}, find:(t,o)=>{
    if(t===FIND_MY_CREEPS) return new Array(10).fill({memory:{}});
    if(t===FIND_MY_SPAWNS) return [{spawning:false, spawnCreep:(b,n,opt)=>{body=b;mem=opt.memory;return 0;}}];
    return [];
  }, energyCapacityAvailable:1300, energyAvailable:1300 };
  RM.run();
  check('达标→孵化外矿creep', body!==null);
  check('外矿creep带remote标记', mem&&mem.remote===true&&mem.rHome==='E9N54'&&mem.taskType==='rharvest');
}

// 4. target 房有攻击敌人 → 全队撤退(retreat标记)，不孵化
{
  resetGame();
  Game.time=100;
  let spawned=0;
  const rc={memory:{remote:true,rHome:'E9N54',rTarget:'E8N54',taskType:'rharvest'}};
  Game.creeps={ rm1:rc };
  Memory.remote={ enabled:true, routes:[{home:'E9N54',target:'E8N54',maxHarvest:2,maxHaul:3}] };
  Game.rooms['E9N54']={ controller:{my:true,level:4}, find:(t)=>{
    if(t===FIND_MY_CREEPS) return new Array(10).fill({memory:{}});
    if(t===FIND_MY_SPAWNS) return [{spawning:false, spawnCreep:()=>{spawned++;return 0;}}];
    return [];
  }, energyCapacityAvailable:1300, energyAvailable:1300 };
  Game.rooms['E8N54']={ find:(t,o)=>{
    if(t===FIND_HOSTILE_CREEPS){ const h={getActiveBodyparts:(p)=>(p===ATTACK?5:0)}; return o&&o.filter?[h].filter(o.filter):[h]; }
    return [];
  } };
  RM.run();
  check('敌人来袭→撤退标记', rc.memory.retreat===true);
  check('危险期→不孵化', spawned===0);
}

console.log('\n========================================');
if(fail===0) console.log('REMOTE-MINING 回归全部通过 ('+pass+' checks)');
else { console.log('FAIL '+fail+' (pass='+pass+')'); process.exit(1); }
