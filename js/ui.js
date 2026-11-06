// ============================================================
// UI : rendu de la liste, panneau, mode conduite, nuit, voix
// ============================================================
import { S, me, getAll } from './state.js';
import { $, ago, haversineKm } from './utils.js';
import { pushAlert, speak, updateStatus } from './notify.js';
import { applyAvatarToEl, ensureAvatars } from './avatar.js';
import { updateMapVisuals } from './map.js';

export function updateDriverUI(all, myEntry){
  if (!myEntry) return;
  let nearest=null, minD=Infinity, nearestId=null;
  for (const [id,v] of Object.entries(all)) {
    if (id===me.id || v.lat==null) continue;
    const d = haversineKm(myEntry.lat, myEntry.lng, v.lat, v.lng);
    if (d<minD){ minD=d; nearest=v; nearestId=id; }
  }
  const rc = nearestId ? S.routeCache[nearestId] : null;
  $('#d-next-dist').textContent = (rc && Date.now()-rc.ts<90000) ? `${rc.km.toFixed(1)} km` : (nearest ? `${minD.toFixed(1)} km` : '— km');
  $('#d-next-name').textContent = nearest ? `👉 ${nearest.name}` : 'tu es seul';
  $('#d-my-speed').textContent = `${me.speed||0} km/h`;
  $('#d-my-bat').textContent = S.phoneBattery!=null ? `${S.phoneBattery}%` : '—';
  $('#d-count').textContent = Object.keys(all).length;
  $('#d-eta').textContent = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}

export function render(){
  const all = getAll();
  $('#convoy-count').textContent = Object.keys(all).length;

  updateMapVisuals(all);
  ensureAvatars(all, render);   // recharge les photos manquantes puis re-rend

  const myEntry = all[me.id] || (me.lat!=null ? {lat:me.lat,lng:me.lng} : null);
  let html = '';
  const sorted = Object.entries(all).sort((a,b)=>{
    if (a[0]===me.id) return -1; if (b[0]===me.id) return 1;
    const da = myEntry ? haversineKm(myEntry.lat,myEntry.lng,a[1].lat,a[1].lng) : 0;
    const db2 = myEntry ? haversineKm(myEntry.lat,myEntry.lng,b[1].lat,b[1].lng) : 0;
    return da-db2;
  });
  for (const [id, v] of sorted) {
    const seen = v.lastSeen || v.updatedAt;
    const stale = seen && Date.now()-seen > 120000;
    let distTxt, tmTxt = seen ? ago(seen) : '';
    if (id === me.id) distTxt = '(toi)';
    else {
      const rc = S.routeCache[id];
      distTxt = (rc && Date.now()-rc.ts < 90000)
        ? `${rc.km.toFixed(1)} km · ${rc.min} min`
        : `${myEntry ? haversineKm(myEntry.lat,myEntry.lng,v.lat,v.lng).toFixed(1) : '?'} km`;
    }
    const subParts = [];
    if (v.devCount > 1) subParts.push(`📱×${v.devCount}`);
    if (id === me.id && me.role === 'screen') subParts.push('📺 écran');
    if (v.speed) subParts.push(`🚀 ${v.speed} km/h`);
    if (v.battery != null) subParts.push(`🔋 ${v.battery}%`);
    html += `<div class="row ${stale?'old':''} ${id===S.followId?'followed':''}" data-id="${id}">
      <div class="avatar" data-avid="${id}" style="background:${v.color||'#888'}"></div>
      <div class="who">
        <div class="nm">${v.name||id}</div>
        <div class="sub">${subParts.length ? subParts.join(' · ') : 'en attente…'}</div>
      </div>
      <div class="rt"><div class="dst">${distTxt}</div><div class="tm">${tmTxt}</div></div>
    </div>`;
  }
  const listEl = $('#list');
  listEl.innerHTML = html || '<div class="row"><span>Personne dans le convoi…</span></div>';
  listEl.querySelectorAll('[data-avid]').forEach(el => applyAvatarToEl(el, el.dataset.avid, all[el.dataset.avid]));

  if (S.driverMode) updateDriverUI(all, myEntry);
}

export function updateFollowPill(){
  const on = !!S.followId;
  $('#follow-pill').classList.toggle('hidden', !on);
  if (on) {
    const v = getAll()[S.followId];
    $('#follow-name').textContent = v?.name || S.followId;
  }
}

// ----- Nuit -----
export function applyNight(on){
  document.body.classList.toggle('night', on);
  $('#btn-night').querySelector('.ico').textContent = on ? '☀️' : '🌙';
  $('#btn-night').classList.toggle('active', on);
}
export function autoNight(){
  if (S.nightManual !== null) return applyNight(S.nightManual);
  const h = new Date().getHours();
  applyNight(h >= 21 || h < 7);
}

// ----- Événements UI purs -----
export function bindCoreUI(){
  $('#panel-head').onclick = () => $('#panel').classList.toggle('collapsed');
  if (window.innerHeight < 640) $('#panel').classList.add('collapsed');

  $('#btn-voice').onclick = () => {
    S.voiceOn = !S.voiceOn;
    $('#btn-voice').querySelector('.ico').textContent = S.voiceOn ? '🔊' : '🔇';
    $('#btn-voice').classList.toggle('active', S.voiceOn);
    if (S.voiceOn) speak('Voix activée');
  };
  $('#btn-night').onclick = () => {
    S.nightManual = !document.body.classList.contains('night');
    applyNight(S.nightManual);
  };
  $('#list').addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (row && row.dataset.id) bus_emit_follow(row.dataset.id);
  });
  $('#follow-stop').onclick = () => { S.followId = null; updateFollowPill(); render(); };
}
import { bus } from './utils.js';
const bus_emit_follow = id => bus.emit('follow-toggle', id);
