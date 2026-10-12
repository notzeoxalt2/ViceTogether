// The secret stays in the URL fragment, never in a server request or analytics.
const code=location.hash.slice(1).toUpperCase();
if(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code)){
  document.getElementById('code').value=code;
  document.getElementById('title').textContent='Join a private Vice City lobby';
  document.getElementById('status').textContent='Already installed? Open the launcher below. Otherwise install it, then return to this invitation.';
  const open=document.getElementById('open');open.href='vicetogether://join/'+code;open.hidden=false;
  const copy=document.getElementById('copy');copy.hidden=false;copy.onclick=async()=>{try{await navigator.clipboard.writeText(code);copy.textContent='Copied';}catch{document.getElementById('code').select();copy.textContent='Select and copy the code';}};
}
// The release landing page always offers the current installer after updates.
fetch('https://api.github.com/repos/notzeoxalt2/ViceTogether/releases/latest')
  .then(response=>{if(!response.ok)throw new Error('Release unavailable');return response.json();})
  .then(release=>{const setup=release.assets?.find(asset=>/^ViceTogether-[0-9][\w.-]*-x64-Setup\.exe$/.test(asset.name));if(setup?.browser_download_url?.startsWith('https://github.com/notzeoxalt2/ViceTogether/releases/download/'))document.getElementById('download').href=setup.browser_download_url;})
  .catch(()=>{});
