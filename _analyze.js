const fs = require('fs');
const data = JSON.parse(fs.readFileSync('_scan_results.json','utf8'));
const rows = Object.entries(data).map(([room,v]) => ({room, ...v}));

// Candidates: not highway, not SK, 2+ sources, unowned, no hostile structures
const cand = rows.filter(x => !x.err && !x.isHighway && !x.isSK && x.sources >= 2 && !x.owner && x.hostileStructs === 0);

// distance from home E2N53 (Chebyshev in room coords; E2 -> x=2, N53 -> y=53)
function rc(room){ const m=room.match(/E(\d+)N(\d+)/); return {x:+m[1], y:+m[2]}; }
const home = rc('E2N53');
for (const c of cand) { const p=rc(c.room); c.dist = Math.max(Math.abs(p.x-home.x), Math.abs(p.y-home.y)); }

cand.sort((a,b) => (b.sources - a.sources) || (a.dist - b.dist));

console.log('=== CLAIMABLE CANDIDATES (2+ sources, unowned, no SK, no hostiles) ===');
console.log('room    src  mineral  reserved        distFromHome');
for (const c of cand) {
  console.log(`${c.room.padEnd(7)} ${c.sources}    ${(c.mineral||'-').padEnd(8)} ${(c.reserved||'-').toString().padEnd(15)} ${c.dist}`);
}
console.log('\nTotal claimable candidates:', cand.length);

// Summary of whole scan
const owned = rows.filter(x=>x.owner && !x.err);
const sk = rows.filter(x=>x.isSK);
const hwy = rows.filter(x=>x.isHighway && !x.err);
const errs = rows.filter(x=>x.err);
console.log('\n=== SCAN SUMMARY ===');
console.log('scanned:', rows.length, '| owned:', owned.length, '| SK:', sk.length, '| highway:', hwy.length, '| errors:', errs.length);
console.log('owned rooms:', owned.map(o=>o.room+'(L'+o.level+')').join(', '));
