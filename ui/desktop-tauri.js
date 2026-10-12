// Keep the reviewed UI shared between the working Electron build and Rust preview.
if (!window.desktop && window.__TAURI__) {
  const request = async (operation, ...args) => {
    try { return { ok:true, value:await window.__TAURI__.core.invoke('desktop_request', { operation, args }) }; }
    catch(error) { return { ok:false, error:String(error) }; }
  };
  const routes={init:'init',prepareBundled:'prepare-bundled',importGame:'import-game',importRuntime:'import-runtime',repair:'repair',createInvite:'invite-create',parseInvite:'invite-parse',copyInvite:'invite-copy',copyCode:'invite-code-copy',saveSettings:'settings',play:'play',sendFrame:'remote-frame',sendShot:'remote-shot',sendWorld:'remote-world',seatGrant:'seat-grant',glassRequest:'glass-request',checkUpdates:'updates',quit:'quit'};
  const bridge=Object.fromEntries(Object.entries(routes).map(([method,operation])=>[method,(...args)=>request(operation,...args)]));
  bridge.windowAction=action=>request('window-action',action);
  bridge.copyText=text=>request('copy-text',text);
  bridge.verificationResult=value=>request('verification-result',value);
  bridge.on=(name,callback)=>{
    let removed=false,unlisten;
    window.__TAURI__.event.listen(name,event=>callback(event.payload)).then(stop=>{if(removed)stop();else unlisten=stop;});
    return ()=>{removed=true;unlisten?.();};
  };
  window.desktop=Object.freeze(bridge);
}
