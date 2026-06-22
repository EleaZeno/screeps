const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path){return new Promise((res,rej)=>{
  const req=https.request({host:'screeps.com',path:'/api/'+path,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}},r=>{
    let ch=[];r.on('data',c=>ch.push(c));r.on('end',()=>{let b=Buffer.concat(ch);if(r.headers['content-encoding']==='gzip'){try{b=zlib.gunzipSync(b);}catch(e){}}res({status:r.statusCode,body:b.toString()});});
  });req.on('error',rej);req.end();
});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// count mining positions: walkable tiles (plain=0 or swamp=2, not wall) adjacent to each source
function miningPositions(sources, terrainStr){
  // terrainStr: 2500 chars, index = y*50+x, '1'/'3' wall, '0' plain, '2' swamp
  function blocked(x,y){ if(x<0||y<0||x>49||y>49)return true; const c=terrainStr[y*50+x]; return c==='1'||c==='3'; }
  let total=0;
  for(const s of sources){ let n=0; for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){ if(dx===0&&dy===0)continue; if(!blocked(s.x+dx,s.y+dy))n++; } total+=n; s.openPos=n; }
  return total;
}

(async()=>{
  // own state
  const me=await api('auth/me'); const mj=JSON.parse(me.body);
  console.log('GCL',mj.gcl,'CPU',mj.cpu.cpu||mj.cpu);
  const rooms=await api('user/rooms'); console.log('user/rooms:',rooms.body.slice(0,200));

  for(const room of ['E9N52']){
    const r=await api('game/room-objects?room='+room+'&shard=shard3');
    const j=JSON.parse(r.body); const objs=j.objects||[];
    const sources=objs.filter(o=>o.type==='source').map(o=>({x:o.x,y:o.y}));
    const ctrl=objs.find(o=>o.type==='controller');
    const spawns=objs.filter(o=>o.type==='spawn');
    const min=objs.find(o=>o.type==='mineral');
    const t=await api('game/room-terrain?room='+room+'&shard=shard3&encoded=1');
    const ter=JSON.parse(t.body).terrain[0].terrain;
    const mp=miningPositions(sources,ter);
    let swamp=0;for(const c of ter)if(c==='2')swamp++;
    console.log(`\n=== ${room} ===`);
    console.log('controller:', ctrl?('L'+ctrl.level+' @'+ctrl.x+','+ctrl.y+(ctrl.user?' user='+ctrl.user:'')+(ctrl.safeMode?' SAFEMODE':'')):'none');
    console.log('sources:', sources.map(s=>s.x+','+s.y+'(open'+s.openPos+')').join(' '), '=> total mining positions', mp);
    console.log('spawns:', spawns.map(s=>s.name+'@'+s.x+','+s.y).join(' ')||'NONE');
    console.log('mineral:', min?min.mineralType:'?','swamp%', (100*swamp/2500).toFixed(0));
  }
})();
