const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
test('Electron package includes every engine module required by the native launcher',()=>{
  const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const source=fs.readFileSync(path.join(root,'src/native-engine.cjs'),'utf8');
  const packaged=new Set(packageJson.build.files);
  const required=[...source.matchAll(/require\(['"]\.\.\/engine\/([^'"]+)['"]\)/g)].map(match=>`engine/${match[1]}`);
  assert.ok(required.length>0,'native-engine.cjs should declare engine module dependencies');
  for(const file of required){
    assert.ok(fs.existsSync(path.join(root,file)),`${file} must exist in the source tree`);
    assert.ok(packaged.has(file),`${file} must be included in Electron's packaged-file allowlist`);
  }
});
