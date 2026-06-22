const fs=require('fs');
const data=JSON.parse(fs.readFileSync('_scan_results.json','utf8'));
function rc(room){const m=room.match(/E(\d+)N(\d+)/);return{x:+m[1],y:+m[2]};}
const targets=['E18N53','E18N52','E17N51'];
for(const t of targets){
  const p=rc(t);
  console.log('\n=== neighbors of',t,'===');
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    if(dx===0&&dy===0)continue;
    const r='E'+(p.x+dx)+'N'+(p.y+dy);
    const v=data[r];
    if(v)console.log(' ',r,'->',v.err?('err'+v.err):(v.isHighway?'highway':v.isSK?'SK!':(v.owner?'OWNED(L'+v.level+')':(v.reserved?'resv:'+(v.reserved==='2'?'NPC':'player'):'free src='+v.sources))));
    else console.log(' ',r,'-> (not scanned)');
  }
}
