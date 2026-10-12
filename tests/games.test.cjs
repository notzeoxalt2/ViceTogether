const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {getGameIntegration,listGames}=require('../src/games.cjs');
test('game catalogue rejects unsupported integrations and never resolves invite input as code',()=>{
  for(const id of ['unknown','../native-engine.cjs','https://example.com/mod.exe',null])assert.throws(()=>getGameIntegration(id),/supported multiplayer integration/);
  const catalogue=listGames();assert.deepEqual(catalogue.map(g=>g.id),['vice-city']);
  catalogue[0].id='changed';assert.equal(listGames()[0].id,'vice-city');
  const game=getGameIntegration('vice-city');
  const executable=game.executable({packaged:true,resourcesPath:path.resolve('resources')});
  assert.equal(executable,path.resolve('resources/native/reVC.exe'));
  const engine=game.createEngine(executable);assert.equal(engine.executable,executable);assert.equal(engine.child,undefined);
});
