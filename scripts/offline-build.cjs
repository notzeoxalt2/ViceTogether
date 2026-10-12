// Local packaging of the user's supplied files. Does not upload or publish anything.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assets=process.env.VT_OFFLINE_ASSETS;
if(!assets || !fs.existsSync(path.join(assets,'Mss32.dll')))throw new Error('VT_OFFLINE_ASSETS must point at your supplied, prepared Vice City asset folder.');
const configuration={
  ...JSON.parse(fs.readFileSync('package.json','utf8')).build,compression:'maximum',
  directories:{output:process.env.VT_OFFLINE_OUTPUT || '../../work/offline-release'},
  win:{target:['nsis'],artifactName:'ViceTogether-${version}-${arch}-Personal-Offline-Setup.${ext}',icon:'art/icon.ico',signExecutable:false},
  extraResources:[{from:'engine/native',to:'native',filter:['reVC.exe','ENGINE-LICENSE.md']},
    {from:path.resolve(assets),to:'offline-game',filter:['**/*','!manifest.json','!ViceTogether-engine.exe','!userfiles/**/*','!*.exe','!Uninstall/**/*']}]
};
const configFile=path.resolve('offline-builder.local.json');
fs.writeFileSync(configFile,JSON.stringify(configuration,null,2));
try{
  const result=spawnSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--config',configFile,'--win','nsis','--x64','--publish','never'],{stdio:'inherit'});
  process.exitCode=result.status??1;
}finally{fs.unlinkSync(configFile);}
