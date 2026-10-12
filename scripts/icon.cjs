// Original geometric VT artwork. No game artwork is included.
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const size=256, raw=Buffer.alloc((size*4+1)*size);
const line=(x,y,a,b,c,d,w)=>{const t=Math.max(0,Math.min(1,((x-a)*(c-a)+(y-b)*(d-b))/((c-a)**2+(d-b)**2)));return Math.hypot(x-a-t*(c-a),y-b-t*(d-b))<w;};
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let color=[17,22,32,255];
  if(line(x,y,43,75,88,180,9)||line(x,y,88,180,129,75,9))color=[102,229,203,255];
  if(line(x,y,142,75,218,75,9)||line(x,y,180,75,180,180,9))color=[244,121,177,255];
  const dx=Math.max(0,24-x,x-231),dy=Math.max(0,24-y,y-231);
  if(Math.hypot(dx,dy)>24)color[3]=0;
  raw.set(color,y*(size*4+1)+1+x*4);
}
function crc(b){let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),r=Buffer.alloc(12+data.length);r.writeUInt32BE(data.length);t.copy(r,4);data.copy(r,8);r.writeUInt32BE(crc(Buffer.concat([t,data])),8+data.length);return r;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
fs.mkdirSync(path.resolve(__dirname,'../art'),{recursive:true});
fs.writeFileSync(path.resolve(__dirname,'../art/icon.ico'),Buffer.concat([header,png]));
fs.writeFileSync(path.resolve(__dirname,'../art/icon.png'),png);
