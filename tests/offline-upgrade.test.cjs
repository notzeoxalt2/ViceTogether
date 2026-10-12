const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {preserveOfflineSource}=require('../src/offline-source.cjs');const {AssetStore,ESSENTIAL}=require('../src/assets.cjs');
test('offline first-run source and cache survive replacement of the launcher install folder',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vt-offline-upgrade-'));try{
    const installed=path.join(root,'installed'),bundled=path.join(installed,'resources/offline-game'),durable=path.join(root,'profile/original-game-source');
    for(const file of ESSENTIAL){const p=path.join(bundled,file);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'test asset '+file);}
    const source=await preserveOfflineSource(bundled,durable);const cache=new AssetStore(path.join(root,'profile/library'));await cache.import(source);
    // Only this test-owned temporary install directory is replaced.
    await fs.rm(installed,{recursive:true,force:true});await fs.mkdir(installed);await fs.writeFile(path.join(installed,'new-launcher.txt'),'updated');
    assert.equal((await cache.ensureReady()).gameReady,true);
    await fs.writeFile(path.join(cache.root,'game',ESSENTIAL[0]),'broken');assert.equal((await cache.repair()).repaired,1);
    assert.equal(await preserveOfflineSource(bundled,durable),durable);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
