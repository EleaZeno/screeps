const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
const SHARD = 'shard3';
function api(p){return new Promise((res,rej)=>{const o={host:'screeps.com',path:'/api/'+p,method:'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};const r=https.request(o,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}));});r.on('error',rej);r.end();});}
function decode(body){
  let j; try{j=JSON.parse(body);}catch(e){return body;}
  let d=j.data!==undefined?j.data:j;
  if(typeof d==='string' && d.startsWith('gz:')){
    const buf=Buffer.from(d.slice(3),'base64');
    return JSON.parse(zlib.gunzipSync(buf).toString());
  }
  return d;
}
(async()=>{
  const cm=await api(`user/memory?shard=${SHARD}&path=creeps`);
  const creeps=decode(cm.body);
  console.log('=== Memory.creeps ===');
  for(const [name,m] of Object.entries(creeps||{})){
    console.log(`${name}: role=${m.role} src=${m.sourceId||'-'} working=${m.working||false} _stk=${m._stk||0}`);
  }
  const cfg=await api(`user/memory?shard=${SHARD}&path=config`);
  console.log('=== Memory.config ===');
  console.log(JSON.stringify(decode(cfg.body),null,2));
  // game time
  const t=await api(`game/time?shard=${SHARD}`);
  console.log('=== game time ===', t.body.slice(0,100));
})().catch(e=>console.log('ERR',e.message));
