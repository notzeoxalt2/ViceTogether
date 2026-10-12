import { Friends } from './network.bundle.js';
const $ = id => document.getElementById(id);
export function setupFriends({ state, call, notice, join }) {
  let selected = null;
  const social = new Friends({ storage: localStorage });
  function render() {
    const friends = social.snapshot(), online = friends.filter(f => f.status === 'Online').length;
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
