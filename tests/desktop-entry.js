import { PrivateLobby, Friends } from '../ui/network.js';
window.testFriends=Friends;
import { joinRoom } from '@trystero-p2p/ws-relay';
window.testLobby = new PrivateLobby();
window.testJoinRoom = joinRoom;
window.testEvents = [];
for (const name of ['change', 'notice', 'frame', 'launch','shot','ambient','seat-grant']) window.testLobby.addEventListener(name, event => {window.testEvents.push({ name, detail: event.detail });if(window.testEvents.length>500)window.testEvents.shift();});
