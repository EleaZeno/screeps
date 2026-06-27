const { execFileSync } = require('child_process');
const tests = ['_smoketest.js','_stucktest.js','_bootstraptest.js','_recycletest.js','_braintest.js','_braintest_evo.js','_braintest_goap.js','_braintest_load.js','_braintest_run.js','_braintest_sim.js','_braintest_world.js','_brain_v2_test.js','_scrubtest.js','_towertest.js','_backlogtest.js','_spawn_falltest.js','_remotetest.js'];
let pass=0, fail=0; const fails=[];
for(const t of tests){
  try{
    const out = execFileSync('node',[t],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    const ok = !/FAIL|fail|鉂寍鉁桞ad|Error/.test(out) || /PASS|pass|鉁?ok/.test(out);
    // crude: rely on exit code success
    pass++; console.log('PASS '+t);
  }catch(e){
    fail++; fails.push(t);
    const msg=(e.stdout||'')+(e.stderr||e.message||'');
    console.log('FAIL '+t+' :: '+msg.split('\n').slice(-6).join(' | ').slice(0,300));
  }
}
console.log('\n==== '+pass+' pass / '+fail+' fail ====');
if(fails.length) console.log('FAILED: '+fails.join(', '));
