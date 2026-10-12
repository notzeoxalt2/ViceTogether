const { randomBytes } = require('node:crypto');
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const {fromCode,createCodeInvite}=require('./room-code.cjs');
function createInvite() {
  return createCodeInvite();
}
function validateInvite(value) {
  if(value?.v===2) {
    const invite=fromCode(value.code);
    if(value.room!==invite.room || value.key!==invite.key || value.host!==null && !TOKEN.test(value.host||''))throw new Error('Invalid room invitation.');
    return {...invite,host:value.host};
  }
  if (!value || value.v !== 1 || !['room', 'key', 'host'].every(k => typeof value[k] === 'string' && TOKEN.test(value[k]))) throw new Error('That invite is not valid. Ask your friend to copy a new invite.');
  return { v: 1, room: value.room, key: value.key, host: value.host };
}
function encodeInvite(value) { return Buffer.from(JSON.stringify(validateInvite(value))).toString('base64url'); }
function decodeInvite(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('That invite is too long or missing.');
  let token = input.trim();
  if(/^[A-HJ-NP-Z2-9\s-]{10,20}$/i.test(token))return fromCode(token);
  if (token.startsWith('vicetogether:')) {
    const url = new URL(token);
    if(url.hostname==='join' && !url.search && !url.hash && /^\/[A-HJ-NP-Z2-9-]{10,11}$/i.test(url.pathname))return fromCode(url.pathname.slice(1));
    if (url.protocol !== 'vicetogether:' || url.hostname !== 'join' || url.pathname !== '' && url.pathname !== '/' || url.search) throw new Error('Unsupported invite link.');
    token = url.hash.slice(1);
  } else if (token.startsWith('https://')) {
    const url = new URL(token);
    token = url.hash.slice(1);
  }
  if(/^[A-HJ-NP-Z2-9\s-]{10,20}$/i.test(token))return fromCode(token);
  if (!/^[A-Za-z0-9_-]{80,512}$/.test(token)) throw new Error('Paste the complete invitation link or code.');
  try { return validateInvite(JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))); }
  catch { throw new Error('That invite is not valid. Ask your friend to copy a new invite.'); }
}
function inviteLink(invite, base) {
  invite=validateInvite(invite);
  if(invite.v===2)return base?new URL(base).href.split('#')[0]+'#'+invite.code:'vicetogether://join/'+invite.code;
  return `${base ? new URL(base).href.split('#')[0] : 'vicetogether://join'}#${encodeInvite(invite)}`;
}
module.exports = { createInvite, validateInvite, encodeInvite, decodeInvite, inviteLink };
