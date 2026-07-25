'use strict';
const Module=require('module');
Object.assign(global,{
  STRUCTURE_EXTENSION:'extension',STRUCTURE_CONTAINER:'container',STRUCTURE_TOWER:'tower',STRUCTURE_STORAGE:'storage',STRUCTURE_LINK:'link',
  STRUCTURE_TERMINAL:'terminal',STRUCTURE_EXTRACTOR:'extractor',STRUCTURE_LAB:'lab',STRUCTURE_FACTORY:'factory',STRUCTURE_SPAWN:'spawn',
  STRUCTURE_NUKER:'nuker',STRUCTURE_OBSERVER:'observer',STRUCTURE_POWER_SPAWN:'powerSpawn',STRUCTURE_ROAD:'road',
  FIND_SOURCES:1,FIND_STRUCTURES:2,FIND_CONSTRUCTION_SITES:3,FIND_MY_STRUCTURES:4,FIND_MY_CONSTRUCTION_SITES:5,OK:0
});
const orig=Module._load;Module._load=function(r){if(r==='roadmap')return{};return orig.apply(this,arguments)};
const planner=require('./build.planner.js');Module._load=orig;
let pass=0,fail=0;function ok(c,n){if(c){pass++;console.log('PASS',n)}else{fail++;console.log('FAIL',n)}}
let count=0, sequence=[];
planner.countStructAndSites=()=>count;
planner._noLinkNear=()=>true;
planner.placeAround=(room,pos,type,n,range)=>{sequence.push(pos.role);count++;};
planner._sourceLinkSpot=()=>({x:7,y:7});
const controller={pos:{role:'controller'}};
const storage={pos:{role:'storage'}};
const source={id:'src',pos:{role:'source'}};
const room={controller,storage,find:(t)=>t===FIND_SOURCES?[source]:[],createConstructionSite:()=>{sequence.push('source');count++;return OK;}};
planner.planLinks(room,2);
ok(sequence.join(',')==='controller,source','RCL5 two-link plan is controller receiver + source sender');
count=0;sequence=[];planner.planLinks(room,3);
ok(sequence.join(',')==='controller,source,storage','RCL6 third link adds storage receiver');
console.log(`\n_linkplan_test: ${pass} pass / ${fail} fail`);process.exit(fail?1:0);
