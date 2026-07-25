'use strict';
/* 自动殖民闭环门控回归：连续安全观测 + GCL + 储备 + CPU，且失败路线不重复追加。 */
global.FIND_MY_CREEPS=1; global.FIND_MY_SPAWNS=2; global.FIND_HOSTILE_CREEPS=3; global.FIND_HOSTILE_STRUCTURES=4; global.FIND_SOURCES=5;
global.STRUCTURE_TOWER='tower'; global.STRUCTURE_INVADER_CORE='invaderCore'; global.ATTACK='attack'; global.RANGED_ATTACK='ranged'; global.HEAL='heal';
global.RESOURCE_ENERGY='energy'; global.MOVE='move'; global.OK=0; global.TERRAIN_MASK_WALL=1; global.TERRAIN_MASK_SWAMP=2;
let pass=0,fail=0; function check(n,c){if(c){pass++;console.log('PASS '+n)}else{fail++;console.log('FAIL '+n)}}
function owned(name,energy){return{name,controller:{my:true,level:6},storage:{store:{energy}},energyAvailable:1300,find(t,o){if(t===FIND_MY_CREEPS)return new Array(10).fill({memory:{}});if(t===FIND_MY_SPAWNS)return[];if(t===FIND_HOSTILE_CREEPS)return[];return[];}}}
global.Memory={brain:{cpu:{ema:7,bucket:10000}},intel:{rooms:{E9N55:{lastSeen:990,safeScans:3,sources:2,swampRatio:.1,cooldownUntil:0}}},expansion:{auto:true,routes:[]}};
global.Game={time:1000,gcl:{level:3},creeps:{},rooms:{E9N54:owned('E9N54',50000),E8N54:owned('E8N54',40000)},map:{describeExits:(r)=>r==='E9N54'?{1:'E9N55'}:{},getRoomLinearDistance:()=>1}};
const X=require('./expansion.js');
X._autoPlan();
check('安全双源候选→自动创建殖民路线',Memory.expansion.enabled===true&&Memory.expansion.routes.length===1&&Memory.expansion.routes[0].target==='E9N55');
Memory.expansion.routes[0].failed=true; Memory.expansion.enabled=false; Game.time+=25; X._autoPlan();
check('失败旧路线重试时更新而非重复追加',Memory.expansion.routes.length===1&&Memory.expansion.routes[0].failed===false);
Memory.expansion={auto:true,routes:[]}; Memory.intel.rooms.E9N55.hostileTower=1; X._autoPlan();
check('敌塔候选绝不自动殖民',Memory.expansion.routes.length===0);
Memory.intel.rooms.E9N55.hostileTower=0; Memory.brain.cpu.ema=15; X._autoPlan();
check('CPU超门槛不扩张',Memory.expansion.routes.length===0);
console.log('_expansion_auto_test: '+pass+' pass / '+fail+' fail'); process.exit(fail?1:0);
