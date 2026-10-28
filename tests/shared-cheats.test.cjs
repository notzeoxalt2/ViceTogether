const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SHARED_CHEATS,acceptSharedCheatToggle}=require('../engine/shared-cheats.cjs');

test('shared cheat requests are limited to admitted players and rate limited per player',()=>{
 const players=new Map([['guest',{}]]),cooldowns=new Map();
 assert.equal(acceptSharedCheatToggle('stranger',1,{players,cooldowns,now:1000}),false);
 assert.equal(acceptSharedCheatToggle('guest',99,{players,cooldowns,now:1000}),false);
 assert.deepEqual(acceptSharedCheatToggle('guest',1,{players,cooldowns,now:1000}),{cheatId:1});
 assert.equal(acceptSharedCheatToggle('guest',1,{players,cooldowns,now:1500}),false);
 assert.deepEqual(acceptSharedCheatToggle('guest',1,{players,cooldowns,now:2000}),{cheatId:1});
 assert.deepEqual(SHARED_CHEATS,[1,2]);
});

test('nearby Big Bang requires a fresh living guest position and forwards that position',()=>{
 const players=new Map([['guest',{}]]),cooldowns=new Map(),states=new Map([['guest',{time:1000,state:[5,6,7,0,0,0,0,1,100,0]}]]);
 assert.deepEqual(acceptSharedCheatToggle('guest',2,{players,states,cooldowns,now:1100}),{cheatId:2,position:[5,6,7]});
 cooldowns.clear();
 states.set('guest',{time:100,state:[5,6,7,0,0,0,0,1,100,0]});
 assert.equal(acceptSharedCheatToggle('guest',2,{players,states,cooldowns,now:2000}),false,'stale position is rejected');
 states.set('guest',{time:2000,state:[5,6,7,0,0,0,0,1,0,0]});
 assert.equal(acceptSharedCheatToggle('guest',2,{players,states,cooldowns,now:2000}),false,'dead player cannot trigger the shared blast');
});

test('Come Fly With Me is requested by guests, host toggled, then replicated as an on/off world state',()=>{
 const root=path.join(__dirname,'..');
 const pad=fs.readFileSync(path.join(root,'engine/native-source/native-engine.patch'),'utf8');
 const cpp=fs.readFileSync(path.join(root,'engine/native-source/ViceTogether.cpp'),'utf8');
 const world=fs.readFileSync(path.join(root,'engine/native-source/ViceTogetherWorld.cpp'),'utf8');
 const network=fs.readFileSync(path.join(root,'engine/native-source/ViceTogetherNetwork.cpp'),'utf8');
 const lobby=fs.readFileSync(path.join(root,'ui/network.js'),'utf8');
 assert.match(pad,/if \( ViceTogetherInterceptFlyCheat\(\) \)/);
 assert.match(cpp,/ViceTogetherInterceptFlyCheat\(\).*ViceTogetherWorldToggleFlyCheat\(\).*VT_SendSharedCheatRequest\(1\)/);
 assert.match(network,/sendWorld\(57,0,state\)/);
 assert.match(network,/wire\.type==58[^\n]*ViceTogetherWorldNearbyBigBang/);
 assert.match(world,/header\[23\]=CVehicle::bAllDodosCheat\?1\.0f:0\.0f/);
 assert.match(world,/CVehicle::bAllDodosCheat=flyCheat/);
 assert.match(world,/"CHEATOF"/);
 assert.match(lobby,/acceptSharedCheatToggle\(peerId,request\?\.cheatId/);
 assert.match(lobby,/this\.sharedCheatAction\.send\(\{cheatId\}/);
 assert.match(cpp,/Nearby Big Bang \(35 m\)/);
 assert.match(world,/constexpr float radius=35\.0f/);
});

test('transient complete-frame omissions keep vehicle and police replicas briefly, with no extra NPC spawning',()=>{
 const world=fs.readFileSync(path.join(__dirname,'..','engine/native-source/ViceTogetherWorld.cpp'),'utf8');
 assert.match(world,/map==&vehicles \|\| \(map==&pedestrians && int\(it->second\.target\[1\]\)==PEDTYPE_COP\)/);
 assert.match(world,/now-it->second\.received<2000/);
});

test('floating player names and health lines use a shared left edge captured by the render hook',()=>{
 const cpp=fs.readFileSync(path.join(__dirname,'..','engine/native-source/ViceTogether.cpp'),'utf8');
 const draw=cpp.slice(cpp.indexOf('void ViceTogetherDrawNames()'),cpp.indexOf('\nvoid ViceTogetherTick()'));
 assert.match(draw,/CFont::SetCentreOff\(\); CFont::SetWrapx\(SCREEN_WIDTH\)/);
 assert.match(cpp,/CVector head=ped->GetNodePosition\(PED_HEAD\);head\.z\+=0\.10f/);
 assert.match(cpp,/struct RemoteTagLayout \{float centerX,nameY,healthY,headY;\}/);
 assert.match(cpp,/float remoteTagNameGap\(\)\{return SCREEN_SCALE_Y\(17\.0f\);\}/);
 assert.match(cpp,/float remoteTagHealthGap\(\)\{return SCREEN_SCALE_Y\(13\.0f\);\}/);
 assert.match(cpp,/float remoteTagHeadClearance\(\)\{return SCREEN_SCALE_Y\(32\.0f\);\}/);
 assert.match(cpp,/const float clearance=remoteTagHeadClearance\(\);/);
 assert.match(cpp,/remoteTagNameGap\(\)-clearance,head\.y-SCREEN_SCALE_Y\(1\.0f\)-remoteTagHealthGap\(\)-clearance/);
 assert.match(cpp,/struct RemoteTagObservation/);
 assert.match(cpp,/remoteTagObservations\[slot\]/);
 assert.match(cpp,/out\[24\]=tag\.nameLeft;out\[25\]=tag\.healthLeft;out\[26\]=tag\.nameWidth/);
 assert.match(draw,/remoteTagProjection\(ped,&screen\)/);
 assert.match(draw,/const RemoteTagLayout tag=remoteTagLayout\(screen\)/);
 assert.match(draw,/const float labelLeft=tag\.centerX-labelWidth\*0\.5f/);
 assert.match(draw,/CFont::PrintString\(labelLeft,tag\.nameY,text\)/);
 assert.match(draw,/const float healthLeft=labelLeft/);
 assert.match(draw,/remoteTagObservations\[i\]=\{frame,true,labelLeft,labelWidth,tag\.nameY,healthLeft,tag\.healthY,tag\.centerX,tag\.headY\}/);
 assert.match(draw,/CFont::SetDropShadowPosition\(0\)/,'tiny black shadow cannot look like a backing strip');
 assert.doesNotMatch(draw,/CRGBA\(13,17,23/,'name text has no dark backing rectangle');
});
