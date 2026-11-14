// ============================================================
// UI : rendu liste, panneau (convoi/solo), conduite, nuit,
//      compteur de vitesse LISIBLE (graduations chiffrées +
//      aiguille + arc + digital central)
// ============================================================
import { S, me, getAll } from './state.js';
import { $, ago, haversineKm, bus } from './utils.js';
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
  $('#d-next-name').textContent = nearest ? `👉 ${nearest.name}` : (S.solo ? 'mode solo' : 'tu es seul');
  $('#d-my-speed').textContent = `${me.speed||0} km/h`;
  $('#d-my-bat').textContent = S.phoneBattery!=null ? `${S.phoneBattery}%` : '—';
  $('#d-count').textContent = Object.keys(all).length;
  $('#d-eta').textContent = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}

// ---------- Compteur de vitesse lisible ----------
export function initSpeedo(){
  const root=$('#speedo'), fill=$('#speedo-fill'), needle=$('#speedo-needle-g'),
        val=$('#speedo-val'), ticks=$('#speedo-ticks');
  if (!root || !fill || !needle || !val) return;

  const L=226.2, MAX=180;
  const small = window.matchMedia('(max-width:480px)').matches;
  const size = small ? 122 : 152;
  root.style.width = size+'px'; root.style.height = size+'px';
  val.style.fontSize = (small ? 32 : 40)+'px';

  // Graduations : majeures + chiffre tous les 20, mineures tous les 10
  if (ticks && !ticks.childElementCount){
    let html='';
    for (let v=0; v<=MAX; v+=10){
      const major = v%20===0;
      const a=(135+270*v/MAX)*Math.PI/180;
      const r1 = major ? 39 : 42, r2 = 46;
      const x1=60+r1*Math.cos(a), y1=60+r1*Math.sin(a);
      const x2=60+r2*Math.cos(a), y2=60+r2*Math.sin(a);
      html+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
        style="stroke:${major?'rgba(255,255,255,.75)':'rgba(255,255,255,.28)'};stroke-width:${major?2.4:1.2};stroke-linecap:round"/>`;
      if (major){
        const tx=60+30*Math.cos(a), ty=60+30*Math.sin(a);
        html+=`<text x="${tx.toFixed(1)}" y="${(ty+3.4).toFixed(1)}" text-anchor="middle"
          style="fill:rgba(255,255,255,.92);font-size:9.5px;font-weight:800;font-family:inherit;font-variant-numeric:tabular-nums">${v}</text>`;
      }
    }
    ticks.innerHTML=html;
  }

  let shown=0;
  const loop=()=>{
    requestAnimationFrame(loop);
    if (!S.driverMode) return;
    const target=Math.max(0, me.speed||0);
    shown += (target-shown)*0.18;
    if (Math.abs(target-shown)<0.4) shown=target;
    const frac=Math.min(1, shown/MAX);
    fill.style.strokeDashoffset=(L*(1-frac)).toFixed(1);
    needle.setAttribute('transform',`rotate(${(135+270*frac).toFixed(1)} 60 60)`);
    val.textContent=Math.round(shown);
    root.style.setProperty('--speedo-color', shown>130?'#f87171':shown>90?'#fbbf24':'#38bdf8');
  };
  requestAnimationFrame(loop);
}

export function render(){
  document.body.classList.toggle('solo', !!S.solo);
  const all = getAll();
  const pt = $('#panel-title');
  if (pt) pt.textContent = S.solo ? '🧭 Solo' : '🚗 Convoi';
  $('#convoy-count').textContent = Object.keys(all).length;

  updateMapVisuals(all);
  ensureAvatars(all, render);

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
    if (id === me.id && me.role === 'screen' && S.joined) subParts.push('📺 écran');
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
    if (row && row.dataset.id) bus.emit('follow-toggle', row.dataset.id);
  });
  $('#follow-stop').onclick = () => { S.followId = null; updateFollowPill(); render(); };

  initSpeedo();
}
