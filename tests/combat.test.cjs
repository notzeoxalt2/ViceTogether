const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('host world damage survives player snapshots, bounds damage and respawns',async()=>{
  const {SessionCombat}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  const c=new SessionCombat(),state=[0,0,10,0,0,0,0,1,100,0];c.update('friend',state,0);
  assert.equal(c.worldDamage('friend',20,10).health,80);
  assert.equal(c.update('friend',state,20).health,80);
  for(const amount of [NaN,Infinity,-1,0,101])assert.equal(c.worldDamage('friend',amount,30),null);
  assert.equal(c.worldDamage('missing',10,30),null);
  assert.equal(c.worldDamage('friend',10,600),null);
  c.update('friend',state,610);assert.equal(c.worldDamage('friend',100,620).dead,true);
  assert.equal(c.update('friend',state,3619).health,0);assert.equal(c.update('friend',state,3620).health,100);
});
test('host validates melee range and rate, owns damage, death and respawn',async()=>{
  const {SessionCombat}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  const c=new SessionCombat(),state=x=>[x,0,10,0,0,0,0,1,100,0];
  c.update('a',state(0),0);c.update('b',state(1),0);
  assert.equal(c.hit('a',{seq:1,target:'b',weapon:17},1),null);
  assert.equal(c.hit('a',{seq:1,target:'b',weapon:0},1).health,85);
  assert.equal(c.hit('a',{seq:2,target:'b',weapon:0},2),null);
  assert.equal(c.update('b',state(1),200).state[8],85,'client cannot restore its own health');
  for(let n=2;n<=7;n++){const now=n*300;c.update('a',state(0),now);c.update('b',state(1),now);c.hit('a',{seq:n,target:'b',weapon:0},now);}
  assert.equal(c.players.get('b').health,0);
  assert.equal(c.update('b',state(1),5000).health,0);
  assert.equal(c.update('b',state(1),5100).health,100);
  c.update('b',state(10),5200);c.update('a',state(0),5200);
  assert.equal(c.hit('a',{seq:8,target:'b',weapon:0},5200),null);
});
test('melee accepts a recently visible moving target and rejects invented or expired positions',async()=>{
  const {SessionCombat}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  const state=x=>[x,0,10,0,0,0,0,2,100,0],c=new SessionCombat();
  c.update('a',state(0),0);c.update('b',state(1.5),0);
  c.update('a',state(0),100);c.update('b',state(3),100);
  const hit={seq:1,target:'b',weapon:0,origin:[0,0,10],impact:[1.5,0,10]};
  assert.equal(c.hit('a',hit,120).health,85,'visible contact survives movement during interpolation');
  c.update('a',state(0),400);c.update('b',state(3),400);
  assert.equal(c.hit('a',{...hit,seq:2},410),null,'old targets cannot be hit indefinitely');
  assert.equal(c.hit('a',{...hit,seq:3,impact:[1,100,10]},410),null,'invented contact is rejected');
  assert.equal(c.hit('a',{...hit,seq:4,impact:[NaN,0,10]},410),null);
  const t=new SessionCombat();t.update('a',state(0),0);t.update('b',state(-5),0);t.update('b',state(5),100);
  assert.equal(t.hit('a',{...hit,impact:[0,0,10]},110),null,'teleports do not leave hittable trails');
});
test('pistol hits require equipped weapon and obey range, fire rate and shared health',async()=>{
  const {SessionCombat}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  const c=new SessionCombat(),state=x=>[x,0,10,0,0,0,0,1,100,0];
  c.update('a',state(0),0);c.update('b',state(10),0);
  const hit={seq:1,target:'b',weapon:17,origin:[0,0,10],impact:[10,0,10]};
  assert.equal(c.hit('a',hit,1),null,'unarmed player cannot claim pistol damage');
  c.equip('a',17);assert.equal(c.hit('a',hit,1).health,75);
  assert.equal(c.hit('a',{...hit,seq:2},100),null,'pistol cannot damage faster than its firing interval');
  c.update('a',state(0),500);c.update('b',state(10),500);
  assert.equal(c.hit('a',{...hit,seq:2},500).health,50);
  c.update('a',state(0),1000);c.update('b',state(40),1000);
  assert.equal(c.hit('a',{...hit,seq:3,impact:[40,0,10]},1000),null);
  assert.equal(c.equip('a',33),true,'minigun selection is tracked for host-authoritative hit validation');
  assert.equal(c.hit('a',{...hit,weapon:33,seq:4,impact:[40,0,10]},1000).health,30,'an equipped minigun hit uses the same shared health authority');
  assert.equal(c.equip('a',37),false,'damage-only pseudo-weapons cannot enter the inventory');
});
test('all instant-hit firearms can damage a player only with an equipped weapon and a verified line segment',async()=>{
  const {SessionCombat}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  for(const weapon of [17,18,19,20,21,22,23,24,25,26,27,28,29,32,33,35]){
    const c=new SessionCombat(),state=x=>[x,0,10,0,0,0,0,1,100,0];
    c.update('shooter',state(0),0);c.update('target',state(20),0);c.equip('shooter',weapon);
    const hit=c.hit('shooter',{seq:1,target:'target',weapon,damage:10,origin:[0,0,10],impact:[20,0,10]},100);
    assert.equal(hit?.health,90,`weapon ${weapon} did not apply authoritative health`);
    assert.equal(hit?.damage,10);assert.equal(hit?.weapon,weapon);
    assert.equal(c.hit('shooter',{seq:2,target:'target',weapon,damage:999,origin:[0,0,10],impact:[20,0,10]},200),null,'forged excessive damage is rejected');
  }
});
test('melee hit validation rejects players seated in vehicles',async()=>{
  const {SessionCombat}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  const c=new SessionCombat(),state=x=>[x,0,10,0,0,0,0,1,100,1];c.update('a',state(0),0);c.update('b',state(1),0);
  assert.equal(c.hit('a',{seq:1,target:'b',weapon:0},1),null);
});
test('guest NPC melee requests are sequenced, rate-limited and bounded by the host lobby',async()=>{
  const {NpcMeleeAuthority}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require.resolve('../engine/combat.js'),'utf8')).toString('base64'));
  const authority=new NpcMeleeAuthority(),event={targetId:1234,weapon:0,damage:12,seq:1};
  assert.deepEqual(authority.accept('friend',event,1000),event);
  assert.equal(authority.accept('friend',{...event,seq:2},1100),null,'rapid repeated melee is rate limited');
  assert.deepEqual(authority.accept('friend',{...event,seq:2},1200),{...event,seq:2});
  for(const invalid of [{...event,targetId:-1},{...event,targetId:16777216},{...event,weapon:17},{...event,damage:251},{...event,damage:NaN},{...event,seq:1}])
    assert.equal(authority.accept('friend',invalid,1500),null);
  assert.equal(authority.accept('',event,2000),null);
  authority.remove('friend');assert.deepEqual(authority.accept('friend',event,2200),event,'rejoined peer starts a fresh sequence window');
});
