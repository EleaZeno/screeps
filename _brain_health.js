'use strict';
const https = require('https');
const T = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path){return new Promise((res,rej)=>{https.request({host:'screeps.com',path:'/api/'+path,headers:{'X-Token':T}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));}).on('error',rej).end();});}
(async()=>{
  // 房间实时对象
  const r = JSON.parse(await api('user/room-objects?room=E9N52&shard=shard3'));
  if(!r.objects){ console.log('room-objects fail:', JSON.stringify(r).slice(0,200)); }
  else {
    const objs = r.objects;
    const byType = {};
    let ctrl=null, spawn=null;
    const roles={};
    for(const o of objs){
      byType[o.type]=(byType[o.type]||0)+1;
      if(o.type==='controller') ctrl=o;
      if(o.type==='spawn') spawn=o;
      if(o.type==='creep'){ const rr=(o.name||'').replace(/[0-9]/g,'').slice(0,6)||'?'; roles[rr]=(roles[rr]||0)+1; }
    }
    console.log('=== E9N52 房间对象 ===');
    console.log('  类型统计:', JSON.stringify(byType));
    if(ctrl) console.log(`  controller: RCL=${ctrl.level} progress=${ctrl.progress}/${ctrl.progressTotal} downgrade=${ctrl.downgradeTime}`);
    if(spawn) console.log(`  spawn: energy=${spawn.store?spawn.store.energy:'?'} spawning=${spawn.spawning?JSON.stringify(spawn.spawning):'no'}`);
    console.log('  creep角色前缀:', JSON.stringify(roles));
    // 看 creep 在干嘛
    const creeps = objs.filter(o=>o.type==='creep').slice(0,6);
    console.log('  creep样本:');
    creeps.forEach(c=>console.log(`    ${c.name} pos=(${c.x},${c.y}) energy=${c.store?c.store.energy:'?'} fatigue=${c.fatigue||0} ticksToLive=${c.ticksToLive}`));
  }
  // CPU/bucket
  const stats = await api('user/console?shard=shard3');
  // 看console最近
})();
