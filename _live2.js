'use strict';
const https=require('https'),zlib=require('zlib');
const T='3456b576-97ec-41bb-90a3-5951670ba79b';
function api(p,m,b){return new Promise((res,rej)=>{const data=b?JSON.stringify(b):null;const req=https.request({host:'screeps.com',path:'/api/'+p,method:m||'GET',headers:{'X-Token':T,'Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d));});req.on('error',rej);if(data)req.write(data);req.end();});}
(async()=>{
  // 注入控制台命令，把关键指标写进 Memory.__live
  const expr="(function(){var r=Game.rooms.E9N52;if(!r)return 'no room';var c=r.controller;Memory.__live={time:Game.time,rcl:c.level,prog:c.progress,need:c.progressTotal,ttd:c.ticksToDowngrade,creeps:Object.keys(Game.creeps).length,e:r.energyAvailable,ecap:r.energyCapacityAvailable,store:r.storage?r.storage.store.energy:0,sites:r.find(FIND_MY_CONSTRUCTION_SITES).length,hostiles:r.find(FIND_HOSTILE_CREEPS).length,struct:r.find(FIND_MY_STRUCTURES).length,cpu:Math.round(Game.cpu.getUsed()),bucket:Game.cpu.bucket};return 'ok';})()";
  await api('user/console','POST',{expression:expr,shard:'shard3'});
  console.log('注入完成，等 4 秒让游戏执行...');
  await new Promise(r=>setTimeout(r,4500));
  const mem=await api('user/memory?shard=shard3&path=__live');
  console.log('=== __live ===');
  try{let m=JSON.parse(mem);let data=m.data;if(typeof data==='string'&&data.startsWith('gz:')){data=zlib.gunzipSync(Buffer.from(data.slice(3),'base64')).toString();}console.log(JSON.stringify(JSON.parse(data),null,1));}
  catch(e){console.log('parse fail:',mem.slice(0,300));}
  // brain 诊断
  const bd=await api('user/memory?shard=shard3&path=brain');
  try{let m=JSON.parse(bd);let data=m.data;if(typeof data==='string'&&data.startsWith('gz:')){data=zlib.gunzipSync(Buffer.from(data.slice(3),'base64')).toString();}const B=JSON.parse(data);console.log('=== brain.weights ===',JSON.stringify(B.weights||B._diag||B));}
  catch(e){console.log('brain parse fail');}
})();
