import { Friends } from './network.bundle.js';
import { connectionHint } from './connection-diagnostics.mjs';
const $ = id => document.getElementById(id);
export function setupFriends({ state, call, notice, join }) {
  let selected = null;
  const statuses=new Map(),notifications=[];let notificationUnread=0;
  const center=document.createElement('details');center.className='panel';const summary=document.createElement('summary');summary.textContent='Notifications';const entries=document.createElement('div');entries.setAttribute('aria-live','polite');center.append(summary,entries);$('friend-create').parentElement.append(center);
  center.addEventListener('toggle',()=>{if(center.open){notificationUnread=0;summary.textContent='Notifications';}});
  function notify(text){notifications.unshift(text);notifications.splice(20);entries.replaceChildren();for(const item of notifications){const p=document.createElement('p');p.className='muted';p.textContent=item;entries.append(p);}if(!center.open)summary.textContent=`Notifications (${++notificationUnread})`;notice(text);if(window.desktop.notify)call(window.desktop.notify(text)).catch(()=>{});}
  const social = new Friends({ storage: localStorage });
  const help=document.createElement('p'); help.className='muted';help.setAttribute('role','status');$('chat-status').parentElement.append(help);
  const diagnosticButton=document.createElement('button');diagnosticButton.type='button';diagnosticButton.textContent='Copy connection details';$('friend-retry').parentElement.append(diagnosticButton);
  diagnosticButton.onclick=async()=>{try{await call(window.desktop.copyText(JSON.stringify({version:state.version,...social.diagnostics(selected)})));notice('Connection details copied. Contains connection states, without your invite, messages or network addresses.');}catch(e){notice(e.message)}};
  function render() {
    const friends = social.snapshot(), online = friends.filter(f => f.status === 'Online').length;
    for(const f of friends){const previous=statuses.get(f.room);if(f.status==='Online'&&previous!=='Online')notify(`${f.name} connected.`);else if(previous==='Online'&&f.status!=='Online')notify(`${f.name} disconnected.`);statuses.set(f.room,f.status);}
    $('friends-count').textContent = `${online} online`;
    $('friends-summary').textContent = friends.length ? `${online} connected · ${friends.length} saved friends` : 'Add your first friend to start chatting.';
    $('friend-list').replaceChildren(); $('friend-empty').hidden = friends.length > 0;
    for (const f of friends) {
      const b = document.createElement('button'); b.className = 'friend-row' + (f.room === selected ? ' selected' : '');
      const avatar = document.createElement('span'); avatar.className = 'friend-avatar' + (f.status === 'Online' ? ' online' : ''); avatar.textContent = f.name[0].toUpperCase();
      const label = document.createElement('span'), name = document.createElement('strong'), status = document.createElement('small');
      name.textContent = f.name + (f.unread ? ` (${f.unread})` : ''); status.textContent = f.status === 'Online' ? f.activity : f.status;
      label.append(name, status); b.append(avatar, label); b.onclick = () => { selected = f.room; social.markRead(selected); render(); }; $('friend-list').append(b);
    }
    const f = friends.find(f => f.room === selected);
    $('chat-empty').hidden = !!f; $('chat-panel').hidden = !f; if (!f) return;
    $('chat-name').textContent = f.name; $('chat-status').textContent = f.status === 'Online' ? f.activity : f.status;
    const diagnostic=social.diagnostics(selected);help.textContent=connectionHint(f.status,diagnostic.connection,diagnostic.relayConfigured);help.hidden=!help.textContent;
    $('chat-send').disabled = f.status !== 'Online'; $('friend-join').disabled = !f.invite;
    const log = $('chat-log'), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 45; const scroll = log.scrollTop;
    log.replaceChildren();
    for (const m of f.messages) {
      const row = document.createElement('div'); row.className = 'chat-message ' + (m.direction === 'received' ? 'incoming' : 'outgoing');
      const text = document.createElement('p'); text.textContent = m.text;
      const status = document.createElement('small'); status.textContent = m.direction === 'received' ? f.name : ({ sent: 'Sent · awaiting delivery', delivered: 'Delivered', failed: 'Not sent' }[m.direction] || 'Sent');
      row.append(text, status); log.append(row);
    }
    log.scrollTop = atEnd ? log.scrollHeight : scroll;
  }
  social.addEventListener('change', render);
  social.addEventListener('message',e=>{if(selected===e.detail.room&&!$('page-friends').hidden)social.markRead(selected);else notify(`New message from ${e.detail.name}.`);});
  $('friend-create').onclick = async () => {
    try { const invite = social.createFriend(); $('friend-created').value = invite; $('friend-created-wrap').hidden = false; await call(window.desktop.copyText(invite)); notice('Private friend invite copied. Send it to one friend, who can paste it below.'); }
    catch (e) { notice(e.message); }
  };
  $('friend-add').onsubmit = e => { e.preventDefault(); try { selected = social.add($('friend-input').value); $('friend-input').value = ''; render(); notice('Friend saved. Connecting when both launchers are open…'); } catch (e) { notice(e.message); } };
  $('chat-compose').onsubmit = async e => { e.preventDefault(); const text = $('chat-text').value; try { await social.send(selected, text); $('chat-text').value = ''; } catch (e) { notice(e.message); } };
  $('friend-retry').onclick = () => social.retry(selected);
  $('friend-remove').onclick = () => { social.remove(selected); selected = null; render(); };
  $('friend-join').onclick = async () => { try { const f = social.snapshot().find(f => f.room === selected); if (f?.invite) await join(await call(window.desktop.parseInvite(f.invite))); } catch (e) { notice(e.message); } };
  social.start(state.settings.name, { iceServers: state.config.iceServers }); render();
  window.addEventListener('pagehide', () => social.stop(), { once: true });
  return social;
}
