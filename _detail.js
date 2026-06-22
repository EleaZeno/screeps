const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
function api(path){return new Promise((res,rej)=>{
  const req=https.request({host:'screeps.com',path:'/api/'+path,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}},r=>{
    let ch=[];r.on('data',c=>ch.push(c));r.on('end',()=>{let b=Buffer.concat(ch);if(r.headers['content-encoding']==='gzip'){try{b=zlib.gunzipSync(b);}catch(e){}}res({status:r.statusCode,body:b.toString()});});
  });req.on('error',rej);req.end();
});}

(async()=>{
  // Resolve reservation user "2" and the E8N54 owner id
  for (const id of ['2','6a27a73c86c11900136b0abe','649c04775d0eee0851f5fb0f']) {
    const r = await api('user/find?id='+id);
    console.log('user', id, '->', r.body.slice(0,150));
  }
  // E9N54 detail
  const r = await api('game/room-objects?room=E9N54&shard=shard3');
  const j = JSON.parse(r.body);
  const objs=j.objects||[];
  console.log('\n=== E9N54 objects ===');
  for (const o of objs) {
    if (['source','mineral','controller','keeperLair','spawn','tower'].includes(o.type))
      console.log(o.type, 'x'+o.x, 'y'+o.y, o.level?('L'+o.level):'', o.mineralType||'', o.user?('user='+o.user):'');
  }
  // terrain
  const t = await api('game/room-terrain?room=E9N54&shard=shard3&encoded=1');
  try { const tj=JSON.parse(t.body); const ter=tj.terrain&&tj.terrain[0]&&tj.terrain[0].terrain; if(ter){let s=0,w=0,p=0;for(const ch of ter){if(ch==='2'){s++;}else if(ch==='1'||ch==='3'){w++;}else p++;}console.log('terrain: plain~',p,'swamp~',s,'wall~',w,'(of',ter.length,')');}else console.log('terrain raw:',t.body.slice(0,120)); } catch(e){ console.log('terrain err', t.body.slice(0,120)); }
})();
