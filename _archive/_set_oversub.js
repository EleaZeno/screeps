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
  // 1. 读当前 config
  const before = await api(`user/memory?shard=${SHARD}&path=config`);
  console.log('BEFORE Memory.config =', JSON.stringify(decode(before.body)));
  // 2. 写 economy.harvesterOversub = 0.5（让 _harvNeed 降到 ~4，6 个 harvester 立即超额 → 下一 tick 开始造 miner）
  //    用 path 精确写入 config.economy，避免覆盖 dashboardText
  const setEco = await api(`user/memory?shard=${SHARD}`, 'POST', { path: 'config.economy', value: { harvesterOversub: 0.5 } });
  console.log('SET config.economy.harvesterOversub=0.5 ->', setEco.status, setEco.body.slice(0,120));
  // 3. 回读确认
  const after = await api(`user/memory?shard=${SHARD}&path=config`);
  console.log('AFTER Memory.config =', JSON.stringify(decode(after.body)));
})().catch(e=>console.log('ERR',e.message));
