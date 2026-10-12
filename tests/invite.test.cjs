const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInvite, encodeInvite, decodeInvite, inviteLink } = require('../src/invite.cjs');
test('random private invites round-trip through desktop and HTTPS links', () => {
  const a = createInvite(), b = createInvite();
  assert.notDeepEqual(a, b);
  assert.deepEqual(decodeInvite(inviteLink(a)), a);
  assert.deepEqual(decodeInvite(inviteLink(a, 'https://example.org/invite/')), a);
  assert.deepEqual(decodeInvite(encodeInvite(a)), a);
});
test('invalid, oversized and unsupported invitations are rejected', () => {
  for (const value of ['', null, 'x'.repeat(3000), 'vicetogether://delete#abc', 'file:///C:/Windows', 'vicetogether://join?command=launch#abc']) assert.throws(() => decodeInvite(value));
});
test('short codes tolerate case and separators, reject ambiguity and preserve legacy invites',()=>{
  const {fromCode}=require('../src/room-code.cjs');
  const a=fromCode('K7M4P-9Q2RX');
  assert.deepEqual(decodeInvite('k7m4p9q2rx'),a);
  assert.deepEqual(decodeInvite('vicetogether://join/K7M4P-9Q2RX'),a);
  assert.equal(inviteLink(a).length,30+1);
  assert.throws(()=>fromCode('OOOOO-11111'));
  const legacy={v:1,room:'a'.repeat(22),key:'b'.repeat(22),host:'c'.repeat(22)};
  assert.deepEqual(decodeInvite(inviteLink(legacy)),legacy);
  assert.throws(()=>encodeInvite({...a,key:'z'.repeat(22)}));
});
