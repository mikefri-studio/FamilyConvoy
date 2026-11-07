// ============================================================
// STATE : état global mutable + liste unifiée des membres
// Avec fusion visuelle des membres ayant le même nom
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

// ============================================================
// getAll() avec fusion automatique des doublons de nom
// Si 2 appareils ont le même pseudo, ils apparaissent comme 1 seul
// membre avec le compteur 📱×2 et la position la plus récente
// ============================================================
export function getAll(){
  const all = {};
  const nameToId = {}; // map nom → id retenu dans all

  for (const [id, v] of Object.entries(S.members)){
    // Ignorer mon propre nœud (ajouté après) et les cachés
    if (id === me.id || v.hidden) continue;

    const devs = Object.values(v.devices || {});
    const alive = v.lat != null || devs.some(freshDev);
    if (!alive) continue;

    const devCount = devs.filter(freshDev).length;
    const lastSeen = Math.max(v.updatedAt || 0, ...devs.map(d => d.updatedAt || 0), 0);

    // Fusion si un membre avec le même nom existe déjà
    if (v.name && nameToId[v.name]) {
      const existing = all[nameToId[v.name]];
      // Additionne les appareils
      existing.devCount = (existing.devCount || 1) + devCount;
      // Garde la position la plus fraîche
      if (lastSeen > (existing.lastSeen || 0)) {
        existing.lastSeen = lastSeen;
        if (v.lat != null) {
          existing.lat = v.lat;
          existing.lng = v.lng;
          existing.speed = v.speed || 0;
          existing.battery = v.battery;
          existing.updatedAt = v.updatedAt;
        }
      }
      // Garde la couleur du premier (cohérence visuelle)
      continue;
    }

    // Premier membre avec ce nom → on le retient
    if (v.name) nameToId[v.name] = id;
    all[id] = { ...v, devCount, lastSeen };
  }

  // Tesla (pas de fusion, noms uniques)
  Object.assign(all, S.teslaCars);

  // Moi (ajouté à la fin, prioritaire)
  if (S.joined && me.lat != null){
    const myDevs = Object.values(S.members[me.id]?.devices || {});
    all[me.id] = {
      name: S.hidden ? me.name + ' 👻' : me.name,
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
