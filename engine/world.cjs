// Host-owned nearby ambient snapshots. Player vehicle ownership is not implied.
const {validGlass,validExplosion}=require('./glass.cjs');
// reVC ePedType ordering: PLAYER1..4, CIVMALE, CIVFEMALE, COP.
const POLICE_PED_TYPE=6;
function validVehicleVisual(v){return Array.isArray(v)&&v.length===34&&v.every(Number.isFinite)&&!v.slice(0,25).some(n=>Math.abs(n)>1000000)&&[25,26,27,28,29,30,31,32,33].every(i=>Number.isInteger(v[i])&&v[i]>=0)&&v[25]<=255&&v[26]<=4095&&v[27]<=65535&&v[28]<=65535&&v[29]<=65535&&v[30]<=255&&v[31]<=255&&v[32]<=1&&v[33]<=1;}
function validDriverVehicleVisual(v){return validVehicleVisual(v)&&v[31]<=5;}
function validWorldFrame(frame) {
  if(!frame || !Number.isSafeInteger(frame.seq) || frame.seq<1 || frame.seq>16777215 || !Array.isArray(frame.entities) || frame.entities.length>80)return false;
  if(frame.glass!==undefined && (!Array.isArray(frame.glass)||frame.glass.length>128||!frame.glass.every(validGlass)))return false;
  if(frame.explosions!==undefined && (!Array.isArray(frame.explosions)||frame.explosions.length>32||!frame.explosions.every(validExplosion)))return false;
  if(frame.environment!==undefined){const e=frame.environment;if(!Array.isArray(e) || ![6,19,20].includes(e.length) || !e.every(Number.isFinite) || !Number.isInteger(e[0]) || e[0]<0 || e[0]>=24 || !Number.isInteger(e[1]) || e[1]<0 || e[1]>=60 || !Number.isInteger(e[2]) || e[2]<0 || e[2]>=60 || ![3,4].every(i=>Number.isInteger(e[i]) && e[i]>=0 && e[i]<6) || e[5]<0 || e[5]>1)return false;if(e.length>=19 && (e.slice(6,16).some(v=>v<0 || v>3) || !Number.isInteger(e[16]) || e[16]<-1 || e[16]>6 || ![17,18].every(i=>e[i]===0 || e[i]===1)))return false;if(e.length===20 && ![0,1].includes(e[19]))return false;}
  const seen=new Set();let peds=0,cars=0;
  for(const entity of frame.entities) {
    if(!entity || ![21,22].includes(entity.type) || !Number.isSafeInteger(entity.id) || entity.id<0 || entity.id>0xffffffff)return false;
    const key=entity.type+':'+entity.id;if(seen.has(key))return false;seen.add(key);
    const d=entity.state;
    if(!Array.isArray(d) || d.length!==34 || !d.every(Number.isFinite) || !Number.isInteger(d[0]) || d[0]<0 || d[0]>=6500 || Math.abs(d[2])>=10000 || Math.abs(d[3])>=10000 || Math.abs(d[4])>=3000)return false;
    if(entity.type===21) {
      // The current shared-world scope is police only. Do not accept or
      // replicate ordinary ambient pedestrians until their AI is supported.
      if(d[1]!==POLICE_PED_TYPE)return false;
      if(![30,31].every(i=>Number.isInteger(d[i]) && d[i]>=0 && d[i]<=255) || (d[31]&31)>18 || ![0,1].includes(d[32]))return false;
      if(++peds>48 || !Number.isInteger(d[1]) || d[1]<0 || d[1]>22 || Math.abs(d[5])>=100 || d[6]<-1000 || d[6]>10000 || !Number.isInteger(d[7]) || d[7]<0 || d[7]>5 || !Number.isInteger(d[8]) || d[8]<-1 || !Number.isInteger(d[9]) || d[9]<-1 || d[9]>7 || !Number.isInteger(d[33]) || d[33]<0 || d[33]>36)return false;
      for(const i of [10,15,20,25])if(!Number.isInteger(d[i]) || d[i]<0 || d[i]>1000 || !Number.isInteger(d[i+1]) || d[i+1]<0 || d[i+1]>1000 || d[i+2]<0 || d[i+2]>1000 || d[i+3]<0 || d[i+3]>10 || d[i+4]<0 || d[i+4]>1.01)return false;
    } else {
      if(++cars>32 || ![0,1,2,3,4].includes(d[1]) || d[17]<-1000 || d[17]>10000 || ![18,19].every(i=>Number.isInteger(d[i]) && d[i]>=0 && d[i]<=255) || ![20,21].every(i=>d[i]===0 || d[i]===1))return false;
      const axes=[d.slice(5,8),d.slice(8,11),d.slice(11,14)];
      if(axes.some(a=>Math.abs(Math.hypot(...a)-1)>0.15))return false;
      for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(axes[i].reduce((sum,v,k)=>sum+v*axes[j][k],0))>0.2)return false;
      if(d.slice(14,17).some(v=>Math.abs(v)>100))return false;
      if(entity.visual&&!validVehicleVisual(entity.visual))return false;
    }
  }
  return true;
}
function retainSupportedWorldPeds(frame) {
  if(!frame || !Array.isArray(frame.entities))return {frame,droppedPeds:0};
  const entities=[];let droppedPeds=0;
  for(const entity of frame.entities){
    // Older native builds can still send civilians. Drop those entries instead
    // of rejecting the whole transaction and losing its vehicles, police,
    // weather, glass, and explosion updates.
    if(entity?.type===21 && entity.state?.[1]!==POLICE_PED_TYPE){droppedPeds++;continue;}
    entities.push(entity);
  }
  return {frame:{...frame,entities},droppedPeds};
}
module.exports={POLICE_PED_TYPE,validWorldFrame,validVehicleVisual,validDriverVehicleVisual,retainSupportedWorldPeds};
