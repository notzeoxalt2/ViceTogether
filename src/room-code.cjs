const {randomBytes,createHash}=require('node:crypto');
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function fromCode(input) {
  const code=String(input).toUpperCase().replace(/[\s-]/g,'');
  if(!/^[A-HJ-NP-Z2-9]{10}$/.test(code))throw new Error('Enter the ten-character room code your friend shared.');
  const derive=context=>createHash('sha256').update('ViceTogether/code/v2/'+context+'/'+code).digest().subarray(0,16).toString('base64url');
  return {v:2,code:code.slice(0,5)+'-'+code.slice(5),room:derive('room'),key:derive('key'),host:null};
}
function createCodeInvite(){return fromCode([...randomBytes(10)].map(b=>ALPHABET[b&31]).join(''));}
module.exports={fromCode,createCodeInvite};
