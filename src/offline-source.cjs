const fs=require('node:fs/promises');
const path=require('node:path');
const {inspectGame}=require('./assets.cjs');
// Preserve the repair source outside the install directory, which NSIS may replace.
async function preserveOfflineSource(bundled, durable) {
  const source=path.resolve(bundled), target=path.resolve(durable);
  if(source===target || target.startsWith(source+path.sep) || source.startsWith(target+path.sep))throw new Error('Offline setup folders overlap.');
  if((await inspectGame(target).catch(()=>({valid:false}))).valid)return target;
  if(!(await inspectGame(source)).valid)throw new Error('The offline game package is incomplete.');
  try {await fs.access(target);throw new Error('The offline repair folder is incomplete. Choose the original game folder in Settings.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(path.dirname(target),{recursive:true});
  try {await fs.rename(source,target);}
  catch(error){
    if(error.code!=='EXDEV')throw error;
    await fs.cp(source,target,{recursive:true,errorOnExist:true,force:false,filter:async file=>!(await fs.lstat(file)).isSymbolicLink()});
  }
  return target;
}
module.exports={preserveOfflineSource};
