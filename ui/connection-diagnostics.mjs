// Counts and states only: never include addresses, SDP, invites or peer identities.
export function connectionDiagnostics({ NativePeer = globalThis.RTCPeerConnection, relaySockets = () => ({}) } = {}) {
  const peers = [];
  class ObservedPeer extends NativePeer {
    constructor(...args) {
      super(...args); const record={pc:this,failed:false,received:false};peers.push(record);if(peers.length>64)peers.shift();
      const update=()=>{record.failed ||= this.connectionState==='failed'||this.iceConnectionState==='failed';record.received ||= !!this.remoteDescription;};
      for(const event of ['connectionstatechange','iceconnectionstatechange','signalingstatechange'])this.addEventListener(event,update);
    }
  }
  return {
    Peer: ObservedPeer,
    snapshot() {
      const sockets = Object.values(relaySockets());
      return {
        signalingOpen: sockets.filter(s => s.readyState === 1).length,
        signalingPending: sockets.filter(s => s.readyState === 0).length,
        signalingScope: 'Shared by friend and lobby connections',
        peers: peers.slice(-6).map(({pc:p,failed,received}) => ({ connection: p.connectionState, ice: p.iceConnectionState, gathering: p.iceGatheringState, receivedDescription: received || !!p.remoteDescription, failed }))
      };
    }
  };
}
export function connectionHint(status, diagnostics, hasRelay) {
  if (status === 'Online') return '';
  if (status === 'Connecting') return 'Looking for your friend. Both launchers must be open.';
  if (!diagnostics) return 'Connection did not complete. Check that both launchers are open, then reconnect.';
  if (!diagnostics.signalingOpen) return 'Cannot reach the discovery service. Check your internet connection or firewall, then reconnect.';
  if (diagnostics.peers.some(p => p.receivedDescription && (p.failed || p.connection === 'failed' || p.ice === 'failed'))) {
    return 'Discovery was reached, but a direct connection failed. ' + (hasRelay ? 'The configured relay also needs checking.' : 'This build has no relay fallback; some networks cannot connect directly.');
  }
  return 'Discovery is reachable, but pairing has not completed. Confirm both launchers use the same friend invite and version, then reconnect. A network restriction is also possible.';
}
