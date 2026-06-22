const https = require('https');
const fs = require('fs');
const opts = {
  hostname: 'screeps.com',
  path: '/api/game/room-objects?room=E9N52&shard=shard3',
  headers: {
    'X-Token': '3456b576-97ec-41bb-90a3-5951670ba79b',
    'X-Username': '3456b576-97ec-41bb-90a3-5951670ba79b'
  }
};
const out = [];
const log = (s) => out.push(s);
const req = https.get(opts, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    log('STATUS:' + res.statusCode);
    try {
      const j = JSON.parse(data);
      const objs = j.objects || [];
      const creeps = objs.filter(o => o.type === 'creep');
      const controller = objs.find(o => o.type === 'controller');
      let miners = 0, haulers = 0;
      const bodyTally = {};
      creeps.forEach(c => {
        const parts = (c.body || []).map(b => b.type);
        parts.forEach(p => bodyTally[p] = (bodyTally[p]||0)+1);
        const work = parts.filter(p => p==='work').length;
        const carry = parts.filter(p => p==='carry').length;
        const move = parts.filter(p => p==='move').length;
        if (work >= 3 && carry === 1) miners++;
        if (carry > 0 && move > 0 && work === 0) haulers++;
      });
      log('Total creeps: ' + creeps.length);
      log('controller.progress: ' + (controller ? controller.progress : 'N/A'));
      log('controller.level: ' + (controller ? controller.level : 'N/A'));
      log('Miners: ' + miners);
      log('Haulers: ' + haulers);
      log('Body tally: ' + JSON.stringify(bodyTally));
    } catch(e) {
      log('Parse error: ' + e.message);
      log('Raw: ' + data.slice(0, 800));
    }
    fs.writeFileSync('probe-out.txt', out.join('\n'));
  });
});
req.on('error', e => { log('Request error: ' + e.message); fs.writeFileSync('probe-out.txt', out.join('\n')); });
req.setTimeout(20000, () => { req.destroy(); log('TIMEOUT'); fs.writeFileSync('probe-out.txt', out.join('\n')); });
