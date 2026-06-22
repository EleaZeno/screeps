const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path){return new Promise((res,rej)=>{
  const req=https.request({host:'screeps.com',path:'/api/'+path,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}},r=>{
    let ch=[];r.on('data',c=>ch.push(c));r.on('end',()=>{let b=Buffer.concat(ch);if(r.headers['content-encoding']==='gzip'){try{b=zlib.gunzipSync(b);}catch(e){}}res({status:r.statusCode,body:b.toString()});});
  });req.on('error',rej);req.end();
});}
function terr(room){return api('game/room-terrain?room='+room+'&shard=shard3&encoded=1');}
function dist(a,b){return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));}
// count open (non-wall) tiles adjacent to a position
function openAround(ter,x,y){let c=0;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(dx===0&&dy===0)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>49||ny>49)continue;const ch=ter[ny*50+nx];if(ch!=='1'&&ch!=='3')c++;}return c;}
(async()=>{
  for (const room of ['E9N52','E9N54']){
    const r = await api('game/room-objects?room='+room+'&shard=shard3');
    const j = JSON.parse(r.body); const objs=j.objects||[];
    const t = await terr(room); const tj=JSON.parse(t.body);
    const ter = tj.terrain&&tj.terrain[0]&&tj.terrain[0].terrain;
    const sources=objs.filter(o=>o.type==='source');
    const ctrl=objs.find(o=>o.type==='controller');
    const mineral=objs.find(o=>o.type==='mineral');
    let s=0,w=0,p=0;for(const ch of ter){if(ch==='2')s++;else if(ch==='1'||ch==='3')w++;else p++;}
    let harvestSlots=0; const slotDetail=[];
    for(const src of sources){const o=openAround(ter,src.x,src.y);harvestSlots+=o;slotDetail.push(`(${src.x},${src.y}):${o}位`);}
    const srcDist = sources.length>=2? dist(sources[0],sources[1]) : null;
    const ctrlDists = ctrl? sources.map(sr=>dist(sr,ctrl)) : [];
    console.log('\n========== '+room+' ==========');
    console.log('sources:', sources.map(o=>`(${o.x},${o.y})`).join(' '));
    console.log('harvest slots (开采位):', harvestSlots, '|', slotDetail.join(' '));
    console.log('source间距:', srcDist);
    console.log('controller:', ctrl?`(${ctrl.x},${ctrl.y})`:'NONE', '| source->ctrl距离:', ctrlDists.join(','));
    console.log('mineral:', mineral?`${mineral.mineralType} (${mineral.x},${mineral.y})`:'NONE');
    console.log('terrain: plain', p, 'swamp', s, `(${(s/2500*100).toFixed(1)}%)`, 'wall', w);
  }
})();
