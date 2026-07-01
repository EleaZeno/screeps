'use strict';
/* _colonylinktest.js — colony.link 多房联动回归：防御互助门控 + 能量支援门控 + remote 退役守卫 + executor guard/share 路由 */
global.FIND_MY_CREEPS=3; global.FIND_HOSTILE_CREEPS=2; global.FIND_SOURCES=5;
global.FIND_MY_SPAWNS=6; global.FIND_DROPPED_RESOURCES=7; global.FIND_STRUCTURES=4;
global.FIND_MY_STRUCTURES=9; global.FIND_TOMBSTONES=8; global.FIND_MY_CONSTRUCTION_SITES=10;
global.FIND_SOURCES_ACTIVE=11;
global.ATTACK='attack'; global.RANGED_ATTACK='ranged_attack'; global.RESOURCE_ENERGY='energy';
global.WORK='work'; global.CARRY='carry'; global.MOVE='move'; global.TOUGH='tough';
global.STRUCTURE_CONTAINER='container'; global.STRUCTURE_STORAGE='storage'; global.STRUCTURE_CONTROLLER='controller';
global.STRUCTURE_TOWER='tower'; global.STRUCTURE_SPAWN='spawn'; global.STRUCTURE_EXTENSION='extension'; global.STRUCTURE_LINK='link';
global.ERR_NOT_IN_RANGE=-9; global.OK=0;
global._ = { filter:(obj,fn)=>Object.keys(obj).map(k=>obj[k]).filter(fn) };

let pass=0, fail=0;
function check(n,c){ if(c){pass++;console.log('  PASS '+n);} else {fail++;console.log('  FAIL '+n);} }

function resetGame(t){
  global.Game={ time: t||100, creeps:{}, rooms:{}, getObjectById:()=>null,
    map:{ findExit:()=>0, getRoomLinearDistance:(a,b)=>1 } };
  global.Memory={};
}
function mkRoom(name, opts){
  opts=opts||{};
  const structs = opts.structs || [];
  const creeps = opts.creeps || [];
  const hostiles = opts.hostiles || [];
  const spawns = opts.spawns || [];
  return {
    name,
    controller: { my:true, level: opts.rcl||1, progress: opts.prog||0 },
    storage: opts.storage || null,
    energyAvailable: opts.energyAvailable!=null?opts.energyAvailable:300,
    energyCapacityAvailable: opts.cap!=null?opts.cap:300,
    find: (t,o)=>{
      const flt = (arr)=> (o&&o.filter)? arr.filter(o.filter) : arr;
      if(t===FIND_HOSTILE_CREEPS) return flt(hostiles);
      if(t===FIND_MY_CREEPS) return flt(creeps);
      if(t===FIND_MY_SPAWNS) return flt(spawns);
      if(t===FIND_MY_STRUCTURES) return flt(structs);
      if(t===FIND_STRUCTURES) return flt(structs);
      return [];
    },
  };
}
function atkHostile(atk){ return { getActiveBodyparts:(p)=>(p===ATTACK?atk:0), pos:{x:25,y:25} }; }

const LINK = require('./colony.link.js');

// ---- A1. 单房 → 无联动，不报错，清空标记 ----
{
  resetGame();
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5});
  let ok=true; try{ LINK.run(); }catch(e){ ok=false; console.log('   err',e.message); }
  check('单房→不报错', ok);
  check('单房→无 defend 标记', Memory.link && Object.keys(Memory.link.defend||{}).length===0);
}

// ---- A2. 双房，受援房无tower无战斗单位被攻击 → 标记求援 + 健康主房派 Guard ----
{
  resetGame(100); // 100 % 10 === 0 → 到评估tick
  let guardBody=null, guardMem=null;
  const donorSpawn={ spawning:false, spawnCreep:(b,n,opt)=>{ guardBody=b; guardMem=opt.memory; return OK; } };
  // 捐助房：RCL5, 8 creeps, 有 idle spawn, 能量足
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5, cap:1300, energyAvailable:1300,
    creeps:new Array(8).fill({body:[]}), spawns:[donorSpawn]});
  // 受援房：RCL2, 无tower, 无战斗creep, 被 5-ATTACK 敌人打
  Game.rooms['E8N54']=mkRoom('E8N54',{rcl:2, creeps:[{body:[{type:WORK}]}], hostiles:[atkHostile(5)], spawns:[]});
  LINK.run();
  check('受援房被攻击→标记求援', Memory.link.defend['E8N54']!=null);
  check('健康主房派出Guard', guardBody!==null);
  check('Guard带guard标记+目标房', guardMem&&guardMem.guard===true&&guardMem.gTarget==='E8N54'&&guardMem.gHome==='E9N54');
  check('Guard体含ATTACK', guardBody&&guardBody.indexOf(ATTACK)>=0);
}

// ---- A3. 受援房有足够tower自保 → 不求援、不派兵 ----
{
  resetGame(100);
  let spawned=0;
  const donorSpawn={ spawning:false, spawnCreep:()=>{ spawned++; return OK; } };
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5, cap:1300, energyAvailable:1300,
    creeps:new Array(8).fill({body:[]}), spawns:[donorSpawn]});
  // 受援房有 2 个满电 tower（防御力 12）对 3-ATTACK 敌人（威胁3）→ 扛得住
  const tower={ structureType:STRUCTURE_TOWER, store:{energy:1000} };
  Game.rooms['E8N54']=mkRoom('E8N54',{rcl:3, creeps:[{body:[]}], hostiles:[atkHostile(3)],
    structs:[tower,tower], spawns:[]});
  LINK.run();
  check('自身扛得住→不标记求援', Memory.link.defend['E8N54']==null);
  check('自身扛得住→不派兵', spawned===0);
}

// ---- B1. 能量支援：受援房告急(RCL≤3无storage能量低) + 捐助房storage富余 → 派 Carrier ----
{
  resetGame(100);
  let shareBody=null, shareMem=null;
  const donorSpawn={ spawning:false, spawnCreep:(b,n,opt)=>{ shareBody=b; shareMem=opt.memory; return OK; } };
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5, cap:1300, energyAvailable:1300,
    creeps:new Array(8).fill({body:[]}), spawns:[donorSpawn],
    storage:{ store:{energy:30000} }});
  // 受援房 RCL2 无 storage 能量占用率低(100/300=33%<60%)
  Game.rooms['E8N54']=mkRoom('E8N54',{rcl:2, energyAvailable:100, cap:300, creeps:[{body:[]}], spawns:[]});
  LINK.run();
  check('告急+富余→派Carrier支援', shareBody!==null);
  check('Carrier带share标记', shareMem&&shareMem.share===true&&shareMem.sTarget==='E8N54'&&shareMem.sHome==='E9N54');
}

// ---- B2. 捐助房storage不富余 → 不派能量支援 ----
{
  resetGame(100);
  let spawned=0;
  const donorSpawn={ spawning:false, spawnCreep:()=>{ spawned++; return OK; } };
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5, cap:1300, energyAvailable:1300,
    creeps:new Array(8).fill({body:[]}), spawns:[donorSpawn],
    storage:{ store:{energy:5000} }}); // < 20000 阈值
  Game.rooms['E8N54']=mkRoom('E8N54',{rcl:2, energyAvailable:100, cap:300, creeps:[{body:[]}], spawns:[]});
  LINK.run();
  check('storage不富余→不派能量支援', spawned===0);
}

// ---- C. remote 退役守卫：target 已成为自有房 → 标记退役、不派外矿 ----
{
  resetGame(100);
  let spawned=0;
  Memory.remote={ enabled:true, routes:[{home:'E9N54',target:'E8N54',maxHarvest:2,maxHaul:3}] };
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5, cap:1300, energyAvailable:1300,
    creeps:new Array(10).fill({memory:{}}), spawns:[{spawning:false,spawnCreep:()=>{spawned++;return OK;}}]});
  Game.rooms['E8N54']=mkRoom('E8N54',{rcl:2}); // 现在是自有房(controller.my=true)
  const RM=require('./remote.mining.js');
  RM.run();
  check('target已自有→路线退役', Memory.remote.routes[0]._retired==='target_now_owned');
  check('target已自有→不派外矿', spawned===0);
}

// ---- D. remote 退役: liveRoutes 过滤后, target 自有房不进 _runRoute (二次确认 run 层过滤) ----
{
  resetGame(100);
  let spawned=0;
  // 两条路线: 一条 target 自有(应退役), 一条 target 无主(应保留)
  Memory.remote={ enabled:true, routes:[
    {home:'E9N54',target:'E8N54',maxHarvest:2,maxHaul:3},
    {home:'E9N54',target:'E7N54',maxHarvest:2,maxHaul:3},
  ] };
  Game.rooms['E9N54']=mkRoom('E9N54',{rcl:5, cap:1300, energyAvailable:1300,
    creeps:new Array(10).fill({memory:{}}), spawns:[{spawning:false,spawnCreep:()=>{spawned++;return OK;}}]});
  Game.rooms['E8N54']=mkRoom('E8N54',{rcl:2}); // 自有 → 退役
  // E7N54 不在视野(无 Game.rooms 条目) → 无主, 路线保留(但 target 不可见, _runRoute 早退, 不孵化)
  const RM=require('./remote.mining.js');
  let ok=true; try{ RM.run(); }catch(e){ ok=false; console.log('   remote err',e.message); }
  check('remote run 不报错', ok);
  check('自有 target 路线退役', Memory.remote.routes[0]._retired==='target_now_owned');
  check('无主 target 路线未退役', Memory.remote.routes[1]._retired==null);
}

console.log('\n========================================');
if(fail===0) console.log('COLONY-LINK 回归全部通过 ('+pass+' checks)');
else { console.log('FAIL '+fail+' (pass='+pass+')'); process.exit(1); }
