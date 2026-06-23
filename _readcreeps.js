const https=require('https');const zlib=require('zlib');
const token='3456b576-97ec-41bb-90a3-5951670ba79b';
function get(p){return new Promise((res,rej)=>{https.get('https://screeps.com'+p,{headers:{'X-Token':token}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej);});}
(async()=>{
  const raw=await get('/api/user/memory?path=creeps&shard=shard3');
  const j=JSON.parse(raw);let data=j.data;
  if(typeof data==='string'&&data.startsWith('gz:')){data=JSON.parse(zlib.gunzipSync(Buffer.from(data.slice(3),'base64')).toString());}
  const counts={};let idle=0;const detail=[];
  for(const name in data){const m=data[name];const t=m.taskType||'(IDLE)';counts[t]=(counts[t]||0)+1;if(t==='(IDLE)')idle++;detail.push(name+' -> '+t);}
  console.log('=== creep actual task distribution (from memory) ===');
  console.log(JSON.stringify(counts,null,2));
  console.log('IDLE (no task):',idle);
  console.log('--- detail ---');console.log(detail.join('\n'));
})();
