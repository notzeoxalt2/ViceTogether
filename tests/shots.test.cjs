const {test}=require('node:test'),assert=require('node:assert/strict');
test('automatic weapons and bounded shotgun pellets preserve their weapon IDs',async()=>{
  const {ShotAuthority,validShot}=await import('../engine/shots.js');const authority=new ShotAuthority();
  const player={time:0,state:[0,0,10,0,0,0,0,1,100,0]},base={source:[0,0,11],end:[0,80,11],normal:[0,0,1],hit:true,hitKind:1};
  for(const weapon of [18,19,20,21,22,23,24,25,26,27,28,29,32,33,35]){
    assert.ok(validShot({...base,weapon}));assert.equal(authority.accept('w'+weapon,{...base,weapon,seq:1},player,weapon,0).weapon,weapon);
  }
  assert.equal(validShot({...base,weapon:30}),false,'rocket events need a projectile path');
  assert.equal(authority.accept('wrong',{...base,weapon:26,seq:1},player,33,0),null);
  for(let seq=1;seq<=16;seq++)assert.ok(authority.accept('pellets',{...base,weapon:19,seq},player,19,0));
  assert.equal(authority.accept('pellets',{...base,weapon:19,seq:17},player,19,0),null);
});
test('shot authority validates origin, equipment, range, freshness and replay without applying damage',async()=>{
  const {ShotAuthority}=await import('../engine/shots.js');const authority=new ShotAuthority();
  const player={time:0,state:[0,0,10,0,0,0,0,1,100,0]};
  const shot={seq:1,weapon:17,source:[0,0,11],end:[0,20,11],normal:[0,0,0],hit:false,hitKind:0};
  assert.equal(authority.accept('a',shot,player,0,0),null);
  assert.equal(authority.accept('a',{...shot,source:[10,0,11]},player,17,0),null);
  assert.equal(authority.accept('a',{...shot,end:[0,50,11]},player,17,0),null);
  assert.equal(authority.accept('a',shot,player,17,600),null);
  assert.equal(authority.accept('a',shot,player,17,0).id,'a');
  assert.equal(authority.accept('a',shot,player,17,200),null);
  assert.equal(authority.accept('a',{...shot,seq:2},player,17,50),null);
  assert.ok(authority.accept('a',{...shot,seq:2},player,17,200));
  assert.equal(player.state[8],100,'visual miss never mutates damage');
});
