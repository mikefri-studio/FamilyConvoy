// ============================================================
// APP v11 : mode SOLO + convoi, conduite auto, nav, radars, voix
// ============================================================
import { MAP_STYLES, TESLA_WORKER_URL, ROUTING_WORKER_URL } from './config.js';
import { $, haversineKm, bearingDeg, ago, freshDev, colorFor, bus } from './utils.js';
import { S, me, getAll } from './state.js';
import { pushAlert, speak, updateStatus, updateRoleUI,
         listVoiceOptions, setVoiceChoice, getVoiceChoice, testVoice } from './notify.js';
import { R, db } from './db.js';
import { bindAvatarUI, openAvatarOverlay, loadEmblem } from './avatar.js';
import { initMaps, initDriverMap, playReplay, closeReplay } from './map.js';
import { render, updateFollowPill, bindCoreUI, autoNight } from './ui.js';
import { tripTick, endTrip, resumeTrip, pruneHistory, bindHistoryUI } from './trips.js';
import { bindRadio, playRadio } from './radio.js';
import { loadRadars, updateRadarLayer, checkRadarAlert, toggleRadars, isRadarsEnabled, getSettings, saveSettings } from './radars.js';
import { addReport } from './radarzen.js';
import { bindNavigationUI, navigationTick, stopNavigation, isNavigating } from './navigation.js';
import { bindDiagUI } from './diag.js';
import * as MAP from './map.js';

// ============================================================
// 🚗 Conduite automatique
// ============================================================
let autoEntered = false, autoSuspended = false, stoppedSince = 0;
function enterDriver(bySpeed){
  if (S.driverMode) return;
  S.driverMode = true; autoEntered = !!bySpeed;
  document.body.classList.add('driver');
  initDriverMap(); setTimeout(render, 150);
  if (bySpeed) pushAlert('🚗 Mode conduite activé', 'info', 2000);
}
function exitDriver(byStop){
  if (!S.driverMode) return;
  S.driverMode = false; autoEntered = false;
  document.body.classList.remove('driver');
  if (byStop) pushAlert('🅿️ Mode conduite désactivé', 'info', 2000);
}
function autoDriverTick(){
  if (me.speed == null) return;
  if (me.speed >= 30){ stoppedSince = 0; if (!S.driverMode && !autoSuspended) enterDriver(true); }
  else if (me.speed < 5){
    if (!stoppedSince) stoppedSince = Date.now();
    if (S.driverMode && autoEntered && Date.now() - stoppedSince > 60000){ exitDriver(true); autoSuspended = false; }
  } else stoppedSince = 0;
}

// ============================================================
// 📍 GPS (démarré une seule fois, convoi ou solo)
// ============================================================
let gpsWatch = null;
function startGPS(){
  if (gpsWatch != null) return;
  if (!navigator.geolocation){ $('#status').textContent='GPS non supporté'; return; }
  gpsWatch = navigator.geolocation.watchPosition(p => {
    const now = Date.now();
    const newLat=p.coords.latitude, newLng=p.coords.longitude;
    if (me.lat != null) {
      const moved = haversineKm(me.lat,me.lng,newLat,newLng)*1000;
      if (moved > 20) S.myHeading = bearingDeg(me.lat,me.lng,newLat,newLng);
      if (moved < 15 && me.speed < 5 && now - S.lastGPSUpdate < 2500) return;
    }
    if (p.coords.heading != null && me.speed > 5) S.myHeading = p.coords.heading;
    me.lat = newLat; me.lng = newLng;
    me.accuracy = p.coords.accuracy;
    me.speed = Math.round((p.coords.speed||0)*3.6);
    S.lastGPSUpdate = now;
    updateStatus(); navigationTick(); autoDriverTick();
  }, e => { $('#status').textContent = 'GPS refusé'; pushAlert('⚠️ Autorise la géolocalisation','warn'); },
  { enableHighAccuracy:true, maximumAge:2000, timeout:15000 });
}
function updateNetIcon(){
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) { S.netIcon = ''; return; }
  const t = c.effectiveType;
  S.netIcon = (t === '4g' && (c.downlink||0) > 5) ? '🟢' : t === '4g' ? '🟢' : t === '3g' ? '🟡' : '🔴';
  updateStatus();
}
if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', updateNetIcon);
updateNetIcon();
if (navigator.getBattery) navigator.getBattery().then(b => {
  S.phoneBattery = Math.round(b.level*100);
  b.addEventListener('levelchange', ()=> S.phoneBattery = Math.round(b.level*100));
});
let wakeLock = null;
async function keepScreenOn(){ try { wakeLock = await navigator.wakeLock.request('screen'); } catch(e){} }
document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') keepScreenOn();
});

// ============================================================
// 📡 Partage Firebase (convoi uniquement)
// ============================================================
function setRole(r, silent){
  if (me.role === r || !S.refs.myRef) return;
  me.role = r;
  if (r === 'gps') {
    R.onDisconnect(S.refs.myRef).update({ lat:null, lng:null, speed:0, gpsDevice:null });
    if (!silent) pushAlert('📍 Cet appareil transmet ta position','success');
  } else {
    R.onDisconnect(S.refs.myRef).cancel();
    if (!silent) pushAlert('📺 Cet appareil passe en mode écran','info');
  }
  updateRoleUI(); updateStatus();
}
$('#btn-takeover').onclick = () => {
  if (!S.refs.myRef) return;
  R.update(S.refs.myRef, { gpsDevice: me.device });
  setRole('gps');
};

function startSharing(){
  S.joined = true; S.hidden = false;
  S.refs.myRef = R.ref(db, `convoy/${me.group}/members/${me.id}`);
  S.refs.deviceRef = R.ref(db, `convoy/${me.group}/members/${me.id}/devices/${me.device}`);
  R.onDisconnect(S.refs.deviceRef).remove();
  if (me.role === 'gps') R.onDisconnect(S.refs.myRef).update({ lat:null, lng:null, speed:0, gpsDevice:null });

  R.get(S.refs.myRef).then(snap => {
    const v = snap.val() || {};
    const gps = Object.entries(v.devices||{}).find(([did,d]) => d.role==='gps' && freshDev(d));
    if (me.role === 'gps' && gps && gps[0] !== me.device) setRole('screen', true);
  }).catch(()=>{});

  S.refs.membersRef = R.ref(db, `convoy/${me.group}/members`);
  S.refs.membersCb = snap => {
    S.members = snap.val() || {};
    const myNode = S.members[me.id];
    if (myNode && myNode.gpsDevice) {
      if (myNode.gpsDevice !== me.device && me.role === 'gps') setRole('screen');
      if (myNode.gpsDevice === me.device && me.role === 'screen') setRole('gps');
    }
    detectAlerts(); render();
  };
  R.onValue(S.refs.membersRef, S.refs.membersCb);

  S.refs.radioRef = R.ref(db, `convoy/${me.group}/radio`);
  S.refs.radioCb = snap => {
    const m = snap.val();
    if (!m || m.fromPerson === me.id || m.from === me.device) return;
    if (Date.now() - m.ts > 120000) return;
    playRadio(m);
  };
  R.onChildAdded(S.refs.radioRef, S.refs.radioCb);

  R.get(S.refs.radioRef).then(snap => {
    const updates = {};
    Object.entries(snap.val() || {}).forEach(([k, m]) => {
      if (Date.now() - (m.ts||0) > 600000) updates[k] = null;
    });
    if (Object.keys(updates).length) R.update(S.refs.radioRef, updates);
  }).catch(()=>{});

  loadEmblem(me.group);
  loadRadars();
  setTimeout(updateRoutes, 4000);
  updateRoleUI(); updateStatus();
  resumeTrip();
  pruneHistory();
}

// Tick 5 s : Firebase si convoi ; radars + nav si convoi OU solo
setInterval(() => {
  if (S.joined && !S.hidden && me.lat != null && S.refs.myRef) {
    R.set(S.refs.deviceRef, { role: me.role, lat: me.lat, lng: me.lng, battery: S.phoneBattery, updatedAt: Date.now() });
    const payload = {
      name: me.name, color: me.colorChoice || colorFor(me.id),
      emoji: me.emoji || null, hasAvatar: me.hasAvatar || null, avatarTs: me.avatarTs || null
    };
    if (me.role === 'gps') {
      R.update(S.refs.myRef, { ...payload, lat: me.lat, lng: me.lng, speed: me.speed,
        battery: S.phoneBattery, gpsDevice: me.device, updatedAt: Date.now() });
    } else {
      R.update(S.refs.myRef, payload);
    }
  }
  if ((S.joined || S.solo) && me.lat != null) {
    checkRadarAlert();
    updateRadarLayer();
    navigationTick();
  }
}, 5000);

// ============================================================
// 🚪 Quitter / rejoindre / solo
// ============================================================
function leaveGroup(clearName=false){
  stopNavigation();
  exitDriver(false);
  endTrip();
  if (S.refs.deviceRef) { R.onDisconnect(S.refs.deviceRef).cancel(); R.set(S.refs.deviceRef, null); }
  if (S.refs.myRef) {
    R.onDisconnect(S.refs.myRef).cancel();
    if (me.role === 'gps') R.update(S.refs.myRef, { lat:null, lng:null, speed:0, gpsDevice:null });
  }
  if (S.refs.membersRef && S.refs.membersCb) R.off(S.refs.membersRef, S.refs.membersCb);
  if (S.refs.radioRef && S.refs.radioCb) R.off(S.refs.radioRef, S.refs.radioCb);
  S.joined = false; S.solo = false; S.hidden = false; S.followId = null; me.role = 'gps';
  S.tripResumeChecked = false;
  localStorage.removeItem('fc_solo');
  updateFollowPill(); updateRoleUI();
  S.members = {};
  for (const k of Object.keys(S.trails)) delete S.trails[k];
  for (const m of Object.values(S.markersMain)) m.remove();
  for (const m of Object.values(S.markersDriver)) m.remove();
  for (const k of Object.keys(S.markersMain)) delete S.markersMain[k];
  for (const k of Object.keys(S.markersDriver)) delete S.markersDriver[k];
  for (const k of Object.keys(S.alertState)) delete S.alertState[k];
  localStorage.removeItem('fc_group');
  if (clearName) localStorage.removeItem('fc_name');
  S.boundsDone = false;
  S.refs = {};
  me.group = '';
  $('#group-label').textContent = '—';
  updateStatus(); render();
}
function showJoinOverlay(withName){
  $('#overlay').classList.remove('hidden');
  $('#inp-name').value = withName ? (localStorage.getItem('fc_name') || '') : '';
  $('#inp-group').value = '';
}
const params = new URLSearchParams(location.search);
const pairPerson = params.get('p');

function join(){
  const name = $('#inp-name').value.trim().slice(0,24);
  const group = ($('#inp-group').value.trim()||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (!name) { pushAlert('⚠️ Entre un nom','warn'); return; }
  if (group.length < 3 || group.length > 20) { pushAlert('⚠️ Code invalide (3-20 lettres/chiffres)','warn'); return; }
  if (pairPerson) {
    me.id = pairPerson; me.role = 'screen';
    localStorage.setItem('fc_person', pairPerson);
  }
  me.name = name; me.group = group;
  S.solo = false; localStorage.removeItem('fc_solo');
  localStorage.setItem('fc_name', me.name);
  localStorage.setItem('fc_group', me.group);
  $('#overlay').classList.add('hidden');
  $('#group-label').textContent = me.group;
  startGPS(); startSharing(); keepScreenOn();
  pushAlert(pairPerson ? `📺 Appairé au convoi ${me.group} (mode écran)` : `✅ Rejoint le convoi ${me.group}`, 'success');
  speak(`Convoi ${me.group} rejoint`, { interrupt:true });
}
$('#btn-join').onclick = join;

// 🧭 Mode solo : tout local, aucun partage
function startSolo(){
  S.solo = true; S.joined = false; S.hidden = false;
  me.name = localStorage.getItem('fc_name') || 'Moi';
  me.group = '';
  localStorage.setItem('fc_solo', '1');
  $('#overlay').classList.add('hidden');
  $('#group-label').textContent = 'SOLO';
  S.tripResumeChecked = true;
  startGPS(); keepScreenOn();
  loadRadars();
  updateRoleUI(); updateStatus(); render();
  pushAlert('🧭 Mode solo : navigation, radars et voix actifs', 'success');
  speak('Mode solo activé', { interrupt:true });
}
$('#btn-solo-start').onclick = () => startSolo();

// ============================================================
// 🚨 Alertes intelligentes
// ============================================================
function detectAlerts(){
  const all = getAll();
  const myEntry = all[me.id];
  for (const [id, v] of Object.entries(all)) {
    const seen = v.lastSeen || v.updatedAt;
    if (!seen || v.lat == null) continue;
    const fresh = Date.now() - seen < 120000;
    if (id !== me.id && fresh) {
      const stopped = (v.speed||0) < 5;
      const k = 'stop_'+id;
      if (stopped && !S.alertState[k]) S.alertState[k]=Date.now();
      else if (stopped && S.alertState[k] && Date.now()-S.alertState[k] > 30000 && !S.alertState[k+'_fired']) {
        S.alertState[k+'_fired']=true;
        pushAlert(`🛑 ${v.name} est arrêté(e)`,'warn');
      }
      else if (!stopped) { S.alertState[k]=null; S.alertState[k+'_fired']=false; }
    }
    if (v.battery != null && v.battery < 20) {
      const k = 'bat_'+id;
      if (!S.alertState[k]) { S.alertState[k]=true; pushAlert(`🔋 Batterie faible : ${v.name} (${v.battery}%)`,'warn'); }
    }
    if (id !== me.id && fresh && myEntry) {
      const dist = haversineKm(myEntry.lat, myEntry.lng, v.lat, v.lng);
      const k = 'far_'+id;
      if (dist > 20 && !S.alertState[k]) { S.alertState[k]=true; pushAlert(`↔️ ${v.name} est loin (${dist.toFixed(0)} km)`,'info'); }
      else if (dist < 15) S.alertState[k]=false;
    }
    if (!fresh) {
      const k = 'stale_'+id;
      if (!S.alertState[k]) { S.alertState[k]=true; pushAlert(`📵 ${v.name} : pas de signal depuis ${ago(seen)}`,'warn',8000); }
    } else S.alertState['stale_'+id]=false;
  }
}

// ============================================================
// 🛣️ Itinéraires convoi
// ============================================================
async function updateRoutes(){
  if (!S.joined || me.lat == null || !ROUTING_WORKER_URL) return;
  const all = getAll();
  const jobs = [];
  for (const [id, v] of Object.entries(all)) {
    if (id === me.id || v.lat == null) continue;
    const rc = S.routeCache[id];
    if (rc && Date.now() - rc.ts < 60000) continue;
    const workerUrl = `${ROUTING_WORKER_URL}?start=${me.lng},${me.lat}&end=${v.lng},${v.lat}`;
    jobs.push(
      fetch(workerUrl).then(r => r.json()).then(j => {
        if (j.features && j.features[0]) {
          const props = j.features[0].properties;
          S.routeCache[id] = { km: props.summary.distance / 1000, min: Math.round(props.summary.duration / 60), ts: Date.now() };
        }
      }).catch(e => console.warn('[Routes] Worker :', e.message))
    );
  }
  if (jobs.length) { await Promise.allSettled(jobs); render(); }
}
setInterval(updateRoutes, 30000);

let lastNearest = { d:null, t:0 };
setInterval(()=>{
  if (!S.joined || !S.voiceOn) return;
  if (isNavigating()) return;
  if (!(S.driverMode || me.speed > 20)) return;
  const all = getAll();
  const my = all[me.id];
  if (!my || me.lat == null) return;
  let nearest=null, minD=Infinity;
  for (const [id,v] of Object.entries(all)){
    if (id===me.id || v.lat==null) continue;
    const d = haversineKm(my.lat,my.lng,v.lat,v.lng);
    if (d<minD){ minD=d; nearest=v; }
  }
  if (nearest) {
    const now = Date.now();
    if (lastNearest.d != null && Math.abs(lastNearest.d - minD) < 0.3 && now - lastNearest.t < 300000) return;
    lastNearest = { d:minD, t:now };
    let pos = '';
    if (S.myHeading != null) {
      const b = bearingDeg(me.lat, me.lng, nearest.lat, nearest.lng);
      const diff = ((b - S.myHeading + 540) % 360) - 180;
      pos = Math.abs(diff) < 90 ? 'devant toi' : 'derrière toi';
    }
    speak(`${nearest.name} est à ${minD.toFixed(1)} kilomètres ${pos}`);
  }
}, 300000);

// ============================================================
// ⚡ Tesla
// ============================================================
if (TESLA_WORKER_URL) {
  $('#btn-tesla').classList.remove('hidden');
  $('#btn-tesla').onclick = () => window.open(TESLA_WORKER_URL + '/auth', '_blank');
  const loadTesla = async () => {
    try {
      const cars = await (await fetch(TESLA_WORKER_URL + '/vehicles')).json();
      if (cars.error) return;
      S.teslaCars = {};
      for (const c of cars) {
        const d = await (await fetch(`${TESLA_WORKER_URL}/data?id=${c.id}`)).json();
        if (!d.error) S.teslaCars['tesla_'+c.id] = {...d, name:'⚡ '+d.name, color:'#7b1fa2'};
      }
      render();
    } catch(e){}
  };
  loadTesla(); setInterval(loadTesla, 60000);
}

// ============================================================
// 🎮 Événements globaux + menu
// ============================================================
function toggleFollow(id){
  if (S.followId === id) S.followId = null;
  else {
    S.followId = id;
    const v = getAll()[id];
    if (v && v.lat != null && MAP.map) MAP.map.flyTo({ center:[v.lng, v.lat], zoom: Math.max(MAP.map.getZoom(), 14), duration: 1500 });
    pushAlert(`🎯 Tu suis ${v?.name || id}`,'info',3000);
  }
  updateFollowPill(); render();
}
bus.on('follow-toggle', toggleFollow);
bus.on('follow-stop', () => { updateFollowPill(); render(); });
bus.on('render', () => render());

$('#btn-menu').onclick = () => {
  $('#menu-group').textContent = me.group || (S.solo ? 'SOLO' : '—');
  $('#btn-toggle-hide').textContent = S.hidden ? '👁 Rendre ma position visible' : '👻 Cacher ma position';
  $('#btn-mode').textContent = S.joined ? '🧭 Passer en mode solo' : '👥 Rejoindre un convoi';
  $('#menu-overlay').classList.remove('hidden');
};
$('#btn-close-menu').onclick = () => $('#menu-overlay').classList.add('hidden');
$('#btn-mode').onclick = () => {
  $('#menu-overlay').classList.add('hidden');
  if (S.joined){ const old = me.group; leaveGroup(false); startSolo(); pushAlert(`🧭 Solo (quitté ${old})`,'info'); }
  else showJoinOverlay(true);
};
$('#btn-avatar').onclick = () => { $('#menu-overlay').classList.add('hidden'); openAvatarOverlay(); };
$('#btn-toggle-hide').onclick = () => {
  if (S.solo){
    S.hidden = !S.hidden;
    pushAlert(S.hidden ? '👻 Position masquée' : '👁 Position visible','info');
    $('#btn-toggle-hide').textContent = S.hidden ? '👁 Rendre ma position visible' : '👻 Cacher ma position';
    $('#menu-overlay').classList.add('hidden');
    updateStatus(); render();
    return;
  }
  if (!S.joined) { pushAlert('Rejoins d\'abord un convoi','info'); return; }
  S.hidden = !S.hidden;
  if (S.hidden) {
    R.update(S.refs.myRef, { hidden:true, lat:null, lng:null, speed:0 });
    R.set(S.refs.deviceRef, null);
    pushAlert('👻 Position masquée','info');
  } else {
    R.update(S.refs.myRef, { hidden:false });
    pushAlert('👁 Position visible','success');
  }
  $('#btn-toggle-hide').textContent = S.hidden ? '👁 Rendre ma position visible' : '👻 Cacher ma position';
  $('#menu-overlay').classList.add('hidden');
  updateStatus(); render();
};
$('#btn-switch').onclick = () => {
  $('#menu-overlay').classList.add('hidden');
  const old = me.group;
  leaveGroup(false); showJoinOverlay(true);
  pushAlert(`🔁 Quitté ${old}`,'info');
};
$('#btn-quit').onclick = () => {
  $('#menu-overlay').classList.add('hidden');
  const old = me.group;
  leaveGroup(true); showJoinOverlay(false);
  pushAlert(`🚪 Tu as quitté ${old}`,'warn');
};

// ============================================================
// 🚗 Conduite manuelle + recentrage
// ============================================================
$('#btn-driver').onclick = () => {
  if (S.driverMode){ exitDriver(false); autoSuspended = true; }
  else { enterDriver(false); autoSuspended = false; }
};
$('#btn-exit-driver').onclick = () => { exitDriver(false); autoSuspended = true; };
$('#btn-center-me').onclick = () => {
  if (me.lat != null && MAP.driverMap) {
    MAP.driverMap.flyTo({ center:[me.lng, me.lat], zoom:15, pitch:45, duration:1200 });
    S.followMe = true;
  }
};
$('#btn-replay-play').onclick = playReplay;
$('#btn-replay-close').onclick = closeReplay;

// ============================================================
// 📤 Partage
// ============================================================
function openShare(mode){
  if (!me.group) { pushAlert('Rejoins d\'abord un convoi','info'); return; }
  S.shareLink = mode === 'pair'
    ? `${location.origin}${location.pathname}?g=${me.group}&p=${me.id}`
    : `${location.origin}${location.pathname}?g=${me.group}`;
  $('#share-title').textContent = mode === 'pair' ? '🔗 Mon autre appareil' : '📤 Inviter';
  $('#share-mode-hint').textContent = mode === 'pair' ? 'Scanne ce QR sur ton autre appareil.' : 'Partage ce lien pour inviter.';
  $('#share-link-text').textContent = S.shareLink;
  $('#qr-box').innerHTML = '';
  new QRCode($('#qr-box'), { text: S.shareLink, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  $('#share-overlay').classList.remove('hidden');
}
$('#btn-share').onclick = () => openShare('invite');
$('#btn-pair').onclick = () => { $('#menu-overlay').classList.add('hidden'); openShare('pair'); };
$('#btn-copy').onclick = () => navigator.clipboard.writeText(S.shareLink).then(()=> pushAlert('Lien copié ! 📋','info'));
$('#btn-close-share').onclick = () => $('#share-overlay').classList.add('hidden');

// ============================================================
// 🎤 Voix
// ============================================================
function openVoiceOverlay(){
  const list = $('#voice-list');
  const options = listVoiceOptions();
  const current = getVoiceChoice();
  if (!options.length){
    list.innerHTML = '<div class="row"><span>⚠️ Aucune voix détectée.</span></div>';
  } else {
    list.innerHTML = options.map(o => {
      const isActive = o.id === current;
      return `<div class="row ${isActive?'followed':''}" data-voice="${o.id.replace(/"/g,'&quot;')}">
        <div class="avatar" style="background:var(--accent);border-radius:12px">${o.icon || '🎤'}</div>
        <div class="who"><div class="nm">${o.name}</div><div class="sub">${o.sub}</div></div>
        <div class="rt"><div class="dst">${isActive?'✓ actif':''}</div></div>
      </div>`;
    }).join('');
  }
  $('#voice-overlay').classList.remove('hidden');
}
function bindVoiceUI(){
  $('#btn-voice').onclick = () => {
    S.voiceOn = !S.voiceOn;
    $('#btn-voice').querySelector('.ico').textContent = S.voiceOn ? '🔊' : '🔇';
    $('#btn-voice').classList.toggle('active', S.voiceOn);
    if (S.voiceOn && window.__voiceTap && Date.now() - window.__voiceTap < 400) openVoiceOverlay();
    if (S.voiceOn) window.__voiceTap = Date.now();
  };
  let voicePressTimer = null;
  $('#btn-voice').addEventListener('pointerdown', () => { voicePressTimer = setTimeout(openVoiceOverlay, 600); });
  $('#btn-voice').addEventListener('pointerup', () => clearTimeout(voicePressTimer));
  $('#btn-voice').addEventListener('pointercancel', () => clearTimeout(voicePressTimer));
  $('#voice-list').addEventListener('click', e => {
    const row = e.target.closest('.row[data-voice]');
    if (!row) return;
    setVoiceChoice(row.dataset.voice);
    testVoice();
    openVoiceOverlay();
  });
  $('#btn-test-voice').onclick = testVoice;
  $('#btn-voice-reset').onclick = () => { setVoiceChoice(''); testVoice(); openVoiceOverlay(); };
  $('#btn-close-voice').onclick = () => $('#voice-overlay').classList.add('hidden');
}

// ============================================================
// 📷 Radars
// ============================================================
function openRadarSettings(){
  const s = getSettings();
  $('#radar-radius').value = s.displayRadius;
  $('#radar-alert').value = s.alertDist;
  $('#radar-minspeed').value = s.minSpeed;
  $('#radar-sound').value = s.alertSound;
  $('#radar-fixed').checked = s.showFixed;
  $('#radar-mobile').checked = s.showMobile;
  $('#radar-reports').checked = s.showReports;
  $('#radar-radarzen').checked = s.useRadarZen;
  $('#radar-vma').checked = s.showVMA;
  $('#radar-overlay').classList.remove('hidden');
}
$('#btn-radar').onclick = () => {
  const on = toggleRadars();
  $('#btn-radar').classList.toggle('active', on);
  pushAlert(on ? '📷 Radars activés' : '📷 Radars désactivés', 'info', 2000);
};
let radarPressTimer = null;
$('#btn-radar').addEventListener('pointerdown', () => { radarPressTimer = setTimeout(openRadarSettings, 600); });
$('#btn-radar').addEventListener('pointerup', () => clearTimeout(radarPressTimer));
$('#btn-radar').addEventListener('pointercancel', () => clearTimeout(radarPressTimer));
$('#btn-radar-apply').onclick = () => {
  saveSettings({
    displayRadius: parseInt($('#radar-radius').value),
    alertDist: parseFloat($('#radar-alert').value),
    minSpeed: parseInt($('#radar-minspeed').value),
    alertSound: $('#radar-sound').value,
    showFixed: $('#radar-fixed').checked,
    showMobile: $('#radar-mobile').checked,
    showReports: $('#radar-reports').checked,
    useRadarZen: $('#radar-radarzen').checked,
    showVMA: $('#radar-vma').checked
  });
  pushAlert('✅ Réglages appliqués', 'success', 2000);
  $('#radar-overlay').classList.add('hidden');
  loadRadars().then(() => updateRadarLayer());
};
$('#btn-radar-reset').onclick = () => {
  saveSettings({
    displayRadius: 25, alertDist: 0.5, minSpeed: 30,
    alertSound: 'voice', showFixed: true, showMobile: true,
    showReports: true, useRadarZen: true, showVMA: true
  });
  openRadarSettings();
  pushAlert('🔄 Réinitialisé', 'info', 2000);
  loadRadars().then(() => updateRadarLayer());
};
$('#btn-close-radar').onclick = () => $('#radar-overlay').classList.add('hidden');

// ============================================================
// 📍 Signalement
// ============================================================
$('#btn-report').onclick = () => {
  if (!me.lat){ pushAlert('⚠️ Position GPS non disponible', 'warn'); return; }
  $('#report-pos').textContent = `${me.lat.toFixed(5)}, ${me.lng.toFixed(5)}`;
  $('#report-desc').value = '';
  $('#report-overlay').classList.remove('hidden');
};
$('#btn-report-send').onclick = async () => {
  const type = $('#report-type').value;
  const desc = $('#report-desc').value.trim();
  const btn = $('#btn-report-send');
  btn.textContent = '⏳ Envoi...'; btn.disabled = true;
  const ok = await addReport(type, desc);
  btn.textContent = '📤 Envoyer'; btn.disabled = false;
  if (ok){
    pushAlert('✅ Signalement envoyé !', 'success', 3000);
    $('#report-overlay').classList.add('hidden');
    loadRadars().then(() => updateRadarLayer());
  } else pushAlert('❌ Erreur lors de l\'envoi', 'warn');
};
$('#btn-close-report').onclick = () => $('#report-overlay').classList.add('hidden');

// ============================================================
// 🎙️ Radio : bloquée hors convoi (garde en capture)
// ============================================================
function bindDriverRadio(){
  const fab = $('#btn-radio-fab');
  const real = $('#btn-radio');
  if (!fab || !real) return;
  ['pointerdown','pointerup','pointercancel'].forEach(ev => {
    fab.addEventListener(ev, () => {
      fab.classList.toggle('recording', ev === 'pointerdown');
      real.dispatchEvent(new PointerEvent(ev, { bubbles:true }));
    });
  });
}
['pointerdown','pointerup','pointercancel'].forEach(ev => {
  document.addEventListener(ev, e => {
    if (!S.joined && e.target.closest && e.target.closest('#btn-radio, #btn-radio-fab')){
      e.stopPropagation();
      if (ev === 'pointerdown') pushAlert('🎙️ Radio disponible seulement en convoi','info',2500);
    }
  }, true);
});

// ============================================================
// 📲 Service worker
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      if (registration.active && registration.active.scriptURL.startsWith('blob:')) registration.unregister();
    }
  });
  const swUrl = new URL('../sw.js', import.meta.url).href;
  navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' })
    .then(registration => setInterval(() => registration.update(), 60 * 60 * 1000))
    .catch(err => console.error('[App] SW:', err));
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// ============================================================
// 🚀 Démarrage
// ============================================================
window.addEventListener('beforeunload', endTrip);
setInterval(tripTick, 10000);
setInterval(autoNight, 60000);
autoNight();

initMaps();
bindCoreUI();
bindVoiceUI();
bindAvatarUI();
bindRadio();
bindHistoryUI();
bindNavigationUI();
bindDiagUI();
bindDriverRadio();

const headBtn = $('#btn-driver-heading');
if (headBtn){
  headBtn.onclick = () => {
    const on = localStorage.getItem('fc_driver_heading') !== '1';
    localStorage.setItem('fc_driver_heading', on ? '1' : '0');
    headBtn.classList.toggle('active', on);
    pushAlert(on ? '🧭 Caméra : cap vers le haut' : '🧭 Caméra : nord vers le haut', 'info', 2000);
  };
  headBtn.classList.toggle('active', localStorage.getItem('fc_driver_heading') === '1');
}

const __shareBtn = $('#btn-share');
const __oldShare = __shareBtn.onclick;
__shareBtn.onclick = () => { $('#menu-overlay').classList.add('hidden'); if (__oldShare) __oldShare(); };
const __histBtn = $('#btn-history');
const __oldHist = __histBtn.onclick;
__histBtn.onclick = () => { $('#menu-overlay').classList.add('hidden'); if (__oldHist) __oldHist(); };

$('#btn-radar').classList.toggle('active', isRadarsEnabled());

const storedName = localStorage.getItem('fc_name');
const storedGroup = localStorage.getItem('fc_group');
const storedStyle = localStorage.getItem('fc_mapStyle');
if (storedStyle && MAP_STYLES[storedStyle]) S.currentStyle = storedStyle;
if (pairPerson) { me.id = pairPerson; me.role = 'screen'; localStorage.setItem('fc_person', pairPerson); }
if (storedName && storedGroup) {
  me.name = storedName; me.group = storedGroup.toUpperCase();
  $('#inp-name').value = me.name; $('#inp-group').value = me.group;
  join();
} else if (localStorage.getItem('fc_solo') === '1') {
  startSolo();
} else {
  $('#overlay').classList.remove('hidden');
  $('#inp-name').value = storedName || '';
  $('#inp-group').value = params.get('g') ? params.get('g').toUpperCase() : '';
}
