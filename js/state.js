// ============================================================
// STATE : état global mutable + liste unifiée des membres
// ============================================================
import { freshDev, colorFor } from './utils.js';

const deviceId = localStorage.getItem('fc_id') || (localStorage.setItem('fc_id', crypto.randomUUID()), localStorage.getItem('fc_id'));

export const me = {
  id: localStorage.getItem('fc_person') || deviceId,
  device: deviceId,
  role: 'gps',
  name:'', group:'', lat:null, lng:null, speed:0, accuracy:null, battery:null,
  emoji: localStorage.getItem('fc_emoji') || '',
  colorChoice: localStorage.getItem('fc_color') || '',
  hasAvatar: false, avatarTs: 0
};

export const S = {
  members:{}, teslaCars:{},
  markersMain:{}, markersDriver:{}, trails:{}, alertState:{}, routeCache:{},
  avatarCache:{}, emblem:null,
  boundsDone:false, phoneBattery:null, driverMode:false, followMe:true, followId:null,
  joined:false, hidden:false, voiceOn:true, nightManual:null, myHeading:null,
  netIcon:'', lastGPSUpdate:0, shareLink:'', historyCache:[],
  trip:null, tripResumeChecked:false, currentStyle:'standard',
  refs:{} // myRef, deviceRef, membersRef...
};

export function getAll(){
  const all = {};
  for (const [id,v] of Object.entries(S.members)){
    if (id === me.id || v.hidden) continue;
    const devs = Object.values(v.devices||{});
    if (v.lat == null && !devs.some(freshDev)) continue;
    v.devCount = devs.filter(freshDev).length;
    v.lastSeen = Math.max(v.updatedAt||0, ...devs.map(d=>d.updatedAt||0), 0);
    all[id] = v;
  }
  Object.assign(all, S.teslaCars);
  if (S.joined && me.lat != null){
    const myDevs = Object.values(S.members[me.id]?.devices||{});
    all[me.id] = {
      name: S.hidden ? me.name+' 👻' : me.name,
      lat: me.lat, lng: me.lng, speed: me.speed, battery: S.phoneBattery,
      color: me.colorChoice || colorFor(me.id),
      emoji: me.emoji, hasAvatar: me.hasAvatar, avatarTs: me.avatarTs,
      updatedAt: Date.now(), lastSeen: Date.now(),
      devCount: Math.max(1, myDevs.filter(freshDev).length),
      role: me.role
    };
  }
  return all;
}
