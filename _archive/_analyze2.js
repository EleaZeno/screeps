const fs = require('fs');
const data = JSON.parse(fs.readFileSync('_scan_results.json','utf8'));
const rows = Object.entries(data).map(([room,v]) => ({room, ...v}));

function rc(room){ const m=room.match(/E(\d+)N(\d+)/); return {x:+m[1], y:+m[2]}; }
const home = rc('E2N53');

// Candidates: claimable
const cand = rows.filter(x => !x.err && !x.isHighway && !x.isSK && x.sources >= 2 && !x.owner);

// neighborhood crowding: count owned rooms within Chebyshev dist 2
function crowding(room){
  const p=rc(room); let c=0;
  for(const r of rows){ if(r.owner&&!r.err){const q=rc(r.room); if(Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y))<=2)c++;} }
  return c;
}

for (const c of cand) {
  const p=rc(c.room);
  c.dist = Math.max(Math.abs(p.x-home.x), Math.abs(p.y-home.y));
  c.crowd = crowding(c.room);
  // reservation by real player (24-hex) = bad; "2" = NPC reservation
  c.reservedByPlayer = c.reserved && /^[0-9a-f]{24}$/.test(c.reserved);
}

cand.sort((a,b) => (a.crowd - b.crowd) || (a.dist - b.dist));
console.log('=== ALL CLAIMABLE 2-SOURCE CANDIDATES (sorted by least crowded) ===');
console.log('room     src min  reserved          crowd(own≤2)  dist');
for (const c of cand) {
  const resv = c.reservedByPlayer ? 'PLAYER:'+c.reserved.slice(0,6) : (c.reserved==='2'?'NPC':(c.reserved||'-'));
  console.log(`${c.room.padEnd(8)} ${c.sources}   ${(c.mineral||'-').padEnd(3)} ${resv.padEnd(16)} ${String(c.crowd).padEnd(13)} ${c.dist}`);
}
console.log('\nTotal claimable 2-src candidates:', cand.length);

const owned = rows.filter(x=>x.owner&&!x.err);
console.log('\nTotal scanned:', rows.length, '| owned:', owned.length, '| SK:', rows.filter(x=>x.isSK).length, '| highway:', rows.filter(x=>x.isHighway&&!x.err).length);
