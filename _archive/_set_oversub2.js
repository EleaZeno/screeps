const https = require('https');
const zlib = require('zlib');
const TOKEN = '3456b576-97ec-41bb-90a3-5951670ba79b';
const SHARD = 'shard3';
function api(p, method, bodyObj){return new Promise((res,rej)=>{
  const data = bodyObj ? JSON.stringify(bodyObj) : null;
  const o={host:'screeps.com',path:'/api/'+p,method:method||'GET',headers:{'X-Token':TOKEN,'X-Username':TOKEN}};
  if(data){o.headers['Content-Type']='application/json';o.headers['Content-Length']=Buffer.byteLength(data);}
  const r=https.request(o,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}));});
  r.on('error',rej); if(data) r.write(data); r.end();
});}
function decode(body){let j;try{j=JSON.parse(body);}catch(e){return body;}let d=j.data!==undefined?j.data:j;if(typeof d==='string'&&d.startsWith('gz:')){return JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3),'base64')).toString());}return d;}
(async()=>{
  // 读整个 config 对象
  const before = await api(`user/memory?shard=${SHARD}&path=config`);
  let cfg = decode(before.body);
  if(typeof cfg !== 'object' || cfg === null) cfg = {};
  console.log('BEFORE config =', JSON.stringify(cfg));
  // 本地合并
  cfg.economy = cfg.economy || {};
  cfg.economy.harvesterOversub = 0.5;
  // 整体写回 config（value 直接是对象，服务器接受 JSON）
  const set = await api(`user/memory?shard=${SHARD}`, 'POST', { path: 'config', value: cfg });
  console.log('SET config ->', set.status, set.body.slice(0,150));
  // 回读
  const after = await api(`user/memory?shard=${SHARD}&path=config`);
  console.log('AFTER config =', JSON.stringify(decode(after.body)));
})().catch(e=>console.log('ERR',e.message));
