'use strict';
const https=require('https'),zlib=require('zlib');
const T='3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p,m,b){return new Promise((res,rej)=>{const data=b?JSON.stringify(b):null;const req=https.request({host:'screeps.com',path:'/api/'+p,method:m||'GET',headers:{'X-Token':T,'Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});req.on('error',rej);if(data)req.write(data);req.end();});}
(async()=>{
  // 注入一段探针到 Memory，让游戏循环里如果有人读就写快照。但更简单：直接读现有 Memory 的 stats/rooms。
  const mem=await api('user/memory?shard=shard3');
  let M;
  try{let m=JSON.parse(mem);let data=m.data;if(typeof data==='string'&&data.startsWith('gz:')){data=zlib.gunzipSync(Buffer.from(data.slice(3),'base64')).toString();}M=JSON.parse(data);}
  catch(e){console.log('mem parse fail',e.message,mem.slice(0,200));return;}
  console.log('=== creeps in Memory ===', Object.keys(M.creeps||{}).length);
  // 统计 creep 角色（从 Memory.creeps）
  const roles={};
  for(const n in (M.creeps||{})){const c=M.creeps[n];const role=c.role||c.r||c.job||'?';roles[role]=(roles[role]||0)+1;}
  console.log('  角色分布:',JSON.stringify(roles));
  // brain 自己写的状态？
  if(M.brain) console.log('=== M.brain ===', JSON.stringify(M.brain).slice(0,500));
  if(M.stats) console.log('=== M.stats ===', JSON.stringify(M.stats).slice(0,300));
  if(M.statistics) console.log('=== M.statistics ===', JSON.stringify(M.statistics).slice(0,300));
  if(M.config) console.log('=== M.config ===', JSON.stringify(M.config).slice(0,300));
  // 用 console 命令查实时 (通过注入 expression)
  const r=await api('user/console?shard=shard3','POST',{expression:"JSON.stringify({rcl:Game.rooms.E9N52&&Game.rooms.E9N52.controller.level,prog:Game.rooms.E9N52&&Game.rooms.E9N52.controller.progress,creeps:Object.keys(Game.creeps).length,cpu:Game.cpu.getUsed&&Math.round(Game.cpu.getUsed()),bucket:Game.cpu.bucket,e:Game.rooms.E9N52&&Game.rooms.E9N52.energyAvailable+'/'+Game.rooms.E9N52.energyCapacityAvailable})",shard:'shard3'});
  console.log('=== console inject ===', r.slice(0,200));
})();
