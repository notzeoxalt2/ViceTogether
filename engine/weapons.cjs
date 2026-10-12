// Engine weapon IDs, not inventory slots. Includes every NUTTERTOOLS selection.
const validWeapon=id=>Number.isInteger(id)&&id>=0&&id<37;
const instantWeapon=id=>Number.isInteger(id)&&((id>=17&&id<=29)||[32,33,35].includes(id));
const shotgun=id=>[19,20,21].includes(id);
const shotRange=id=>id===17?40:shotgun(id)?100:1000;
module.exports={validWeapon,instantWeapon,shotgun,shotRange};
