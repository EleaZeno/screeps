'use strict';
/* _towertest.js — tower.control 回归：开火/治疗/维修/能量底线优先级 */
global.STRUCTURE_TOWER='tower'; global.STRUCTURE_WALL='constructedWall';
global.STRUCTURE_RAMPART='rampart'; global.RESOURCE_ENERGY='energy';
global.FIND_MY_STRUCTURES=1; global.FIND_HOSTILE_CREEPS=2; global.FIND_MY_CREEPS=3; global.FIND_STRUCTURES=4;
global.HEAL='heal'; global.ATTACK='attack'; global.RANGED_ATTACK='ranged_attack';

let pass=0, fail=0;
function check(name, cond){ if(cond){pass++; console.log('  PASS '+name);} else {fail++; console.log('  FAIL '+name);} }

function pos(x,y){ return { x, y, getRangeTo(o){ const p=o.pos||o; return Math.max(Math.abs(p.x-x),Math.abs(p.y-y)); } }; }
function hostile(x,y,heal,atk){ return { pos:pos(x,y), getActiveBodyparts(t){ return t===HEAL?heal:(t===ATTACK||t===RANGED_ATTACK?atk:0); } }; }
function tower(energy){ const t={ structureType:'tower', store:{energy}, pos:pos(25,25), _acts:[],
  attack(tg){this._acts.push(['attack',tg]);return 0;}, heal(tg){this._acts.push(['heal',tg]);return 0;}, repair(tg){this._acts.push(['repair',tg]);return 0;} }; return t; }

function mkRoom({towers=[], hostiles=[], hurt=[], structs=[]}){
  return { find(type, opts){
    let arr = type===FIND_MY_STRUCTURES?towers : type===FIND_HOSTILE_CREEPS?hostiles : type===FIND_MY_CREEPS?hurt : type===FIND_STRUCTURES?structs : [];
    if(opts&&opts.filter) arr=arr.filter(opts.filter);
    return arr;
  } };
}

const TC = require('./tower.control.js');

// 1. 有敌人 → 开火，且优先打带 HEAL 的敌人
{
  const t=tower(1000);
  const grunt=hostile(20,20,0,5);   // 纯进攻
  const healer=hostile(30,30,5,0);  // 带治疗(更该先点)
  const room=mkRoom({towers:[t], hostiles:[grunt, healer]});
  TC.run(room);
  check('有敌人→开火', t._acts.length>0 && t._acts[0][0]==='attack');
  check('优先点杀治疗兵', t._acts[0][1]===healer);
}

// 2. 无敌人但有伤员 → 治疗最缺血的
{
  const t=tower(1000);
  const c1={hits:90,hitsMax:100,pos:pos(26,26)};   // 缺10
  const c2={hits:200,hitsMax:500,pos:pos(27,27)};  // 缺300(最缺)
  const room=mkRoom({towers:[t], hostiles:[], hurt:[c1,c2]});
  TC.run(room);
  check('无敌人有伤员→治疗', t._acts.length>0 && t._acts[0][0]==='heal');
  check('治最缺血的', t._acts[0][1]===c2);
}

// 3. 和平期 + 高于应急储备 → 维修受损建筑
{
  const t=tower(900);
  const dmg={structureType:'extension',hits:1000,hitsMax:3000,pos:pos(24,24)}; // 33% < 70%
  const room=mkRoom({towers:[t], hostiles:[], hurt:[], structs:[dmg]});
  TC.run(room);
  check('和平期能量足→维修', t._acts.length>0 && t._acts[0][0]==='repair' && t._acts[0][1]===dmg);
}

// 4. 和平期但能量低于底线(500) → 不维修(攒能量应急)
{
  const t=tower(400);
  const dmg={structureType:'extension',hits:1000,hitsMax:3000,pos:pos(24,24)};
  const room=mkRoom({towers:[t], hostiles:[], hurt:[], structs:[dmg]});
  TC.run(room);
  check('能量<底线→不维修', t._acts.length===0);
}

// 5. 战斗优先于一切：同时有敌人+伤员 → 只开火不治疗
{
  const t=tower(1000);
  const enemy=hostile(20,20,0,3);
  const c1={hits:50,hitsMax:100,pos:pos(26,26)};
  const room=mkRoom({towers:[t], hostiles:[enemy], hurt:[c1]});
  TC.run(room);
  check('战斗压倒治疗', t._acts.length>0 && t._acts.every(a=>a[0]==='attack'));
}

// 6. 没 tower → 安全返回 false，不报错
{
  const room=mkRoom({towers:[]});
  let ok=true; try { const r=TC.run(room); ok=(r===false); } catch(e){ ok=false; }
  check('无tower安全返回', ok);
}

// 7. 不修墙(wall) — 只有一堵残墙时不应触发维修
{
  const t=tower(900);
  const wall={structureType:'constructedWall',hits:100,hitsMax:300000,pos:pos(10,10)};
  const room=mkRoom({towers:[t], hostiles:[], hurt:[], structs:[wall]});
  TC.run(room);
  check('不把能量喂给wall', t._acts.length===0);
}

console.log('\n========================================');
if(fail===0) console.log('🎉 TOWER-CONTROL 回归全部通过 ('+pass+' checks)');
else { console.log('❌ '+fail+' 个检查失败 (pass='+pass+')'); process.exit(1); }
