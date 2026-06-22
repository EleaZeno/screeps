const https=require('https'),zlib=require('zlib');
const TOKEN=process.env.SC_TOKEN,SHARD='shard3',ROOM='E9N52';
function api(p){return new Promise((res,rej)=>{const o={host:'screeps.com',path:'/api/'+p,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};const r=https.request(o,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}));});r.on('error',rej);r.end();});}
function dec(b){try{const j=JSON.parse(b);if(j.data&&typeof j.data==='string'&&j.data.startsWith('gz:'))return JSON.parse(zlib.gunzipSync(Buffer.from(j.data.slice(3),'base64')).toString());return j.data!==undefined?j.data:j;}catch(e){return b;}}
(async()=>{
  const me=JSON.parse((await api('auth/me')).body);
  const uid=me._id;
  const g=dec((await api(`user/memory?shard=${SHARD}&path=guardian`)).body);
  const ro=JSON.parse((await api(`game/room-objects?room=${ROOM}&shard=${SHARD}`)).body);
  const objs=ro.objects||[];
  const mine=objs.filter(o=>o.type==='creep'&&o.user===uid);
  const spawn=objs.find(o=>o.type==='spawn');
  const ext=objs.filter(o=>o.type==='extension');
  const ctrl=objs.find(o=>o.type==='controller');
  const sources=objs.filter(o=>o.type==='source');
  const containers=objs.filter(o=>o.type==='container');
  console.log('guardian:',JSON.stringify(g));
  console.log(`RCL ${ctrl?ctrl.level:'?'} progress ${ctrl?ctrl.progress:'?'}`);
  console.log(`spawn energy ${spawn?JSON.stringify(spawn.store):'?'} spawning=${spawn?JSON.stringify(spawn.spawning):'?'}`);
  console.log(`extensions: ${ext.length} | containers: ${containers.length} | sources: ${sources.map(s=>s.energy).join('/')}`);
  console.log(`MY creeps: ${mine.length}`);
  mine.forEach(c=>{
    const parts={};(c.body||[]).forEach(b=>{const t=b.type||b;parts[t]=(parts[t]||0)+1;});
    const ps=Object.keys(parts).map(k=>`${k[0].toUpperCase()}${parts[k]}`).join('');
    console.log(`  ${c.name} @(${c.x},${c.y}) ttl=${c.ageTime?'':''}${c.ticksToLive||'?'} body=[${ps}] store=${JSON.stringify(c.store||{})}`);
  });
})();
