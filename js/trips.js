// ============================================================
// TRIPS : enregistrement des trajets, reprise, prune, historique
// ============================================================
import { R, db } from './db.js';
import { S, me } from './state.js';
import { $, haversineKm, serializePts, parsePts } from './utils.js';
import { pushAlert } from './notify.js';
import { openReplay } from './map.js';

export function tripTick(){
  if (!S.joined || me.lat == null || !S.tripResumeChecked) return;
  const now = Date.now();
  if (!S.trip) S.trip = { id:`${now}`, start:now, dist:0, lastLat:me.lat, lastLng:me.lng, points:[[me.lng, me.lat]], lastMove:now, lastSave:0 };
  const d = haversineKm(S.trip.lastLat, S.trip.lastLng, me.lat, me.lng);
  if (d*1000 > 60) {
    S.trip.dist += d;
    S.trip.points.push([me.lng, me.lat]);
    if (S.trip.points.length > 400) S.trip.points.shift();
    S.trip.lastLat = me.lat; S.trip.lastLng = me.lng;
    S.trip.lastMove = now;
  }
  $('#d-trip').textContent = `${S.trip.dist.toFixed(1)} km`;
  if (S.trip.dist > 0.3 && now - S.trip.lastMove > 15*60000) { endTrip(); return; }
  if (S.trip.dist > 0.3 && now - (S.trip.lastSave||0) > 300000) {
    S.trip.lastSave = now;
    saveTripProgress();
  }
}

export function saveTripProgress(){
  if (!S.joined || !me.group || !S.trip) return;
  R.set(R.ref(db, `convoy/${me.group}/history/${S.trip.id}`), {
    name: me.name, start: S.trip.start, end: Date.now(),
    km: +S.trip.dist.toFixed(1), min: Math.round((Date.now()-S.trip.start)/60000),
    hasPts: true, ongoing: true
  });
  R.set(R.ref(db, `convoy/${me.group}/tracks/${S.trip.id}`), serializePts(S.trip.points));
}

export async function resumeTrip(){
  try {
    const snap = await R.get(R.ref(db, `convoy/${me.group}/history`));
    const val = snap.val() || {};
    const mine = Object.entries(val)
      .filter(([id,v]) => v.ongoing && v.name === me.name && Date.now()-v.start < 12*3600000)
      .sort((a,b)=>b[1].start-a[1].start)[0];
    if (mine && !S.trip) {
      const [id, v] = mine;
      const tSnap = await R.get(R.ref(db, `convoy/${me.group}/tracks/${id}`));
      const pts = parsePts(tSnap.val());
      if (pts.length) {
        const last = pts[pts.length-1];
        S.trip = { id, start: v.start, dist: v.km||0, lastLat: last[1], lastLng: last[0], points: pts, lastMove: Date.now(), lastSave: Date.now() };
        pushAlert(`🛣️ Trajet repris : ${v.km} km déjà parcourus`, 'info');
      }
    }
  } catch(e){}
  S.tripResumeChecked = true;
}

export function endTrip(){
  if (!S.trip || S.trip.dist < 0.3) { S.trip = null; return; }
  const summary = {
    name: me.name, start: S.trip.start, end: Date.now(),
    km: +S.trip.dist.toFixed(1),
    min: Math.round((Date.now()-S.trip.start)/60000),
    hasPts: true
  };
  if (S.joined && db && me.group) {
    R.set(R.ref(db, `convoy/${me.group}/history/${S.trip.id}`), summary);
    R.set(R.ref(db, `convoy/${me.group}/tracks/${S.trip.id}`), serializePts(S.trip.points));
    pruneHistory();
  }
  const local = JSON.parse(localStorage.getItem('fc_trips')||'[]');
  local.unshift({ ...summary, id: S.trip.id, points: S.trip.points });
  localStorage.setItem('fc_trips', JSON.stringify(local.slice(0,20)));
  S.trip = null;
  $('#d-trip').textContent = '0 km';
}

export async function pruneHistory(){
  if (!S.joined || !me.group) return;
  try {
    const snap = await R.get(R.ref(db, `convoy/${me.group}/history`));
    const entries = Object.entries(snap.val() || {}).sort((a,b)=>(b[1].start||0)-(a[1].start||0));
    const histUpd = {}; const trackIds = [];
    entries.forEach(([id, v], idx) => {
      if (v.ongoing) return;
      if (idx >= 30 || Date.now()-(v.start||0) > 60*86400000) { histUpd[id] = null; trackIds.push(id); }
    });
    if (Object.keys(histUpd).length) {
      await R.update(R.ref(db, `convoy/${me.group}/history`), histUpd);
      for (const id of trackIds) R.set(R.ref(db, `convoy/${me.group}/tracks/${id}`), null);
    }
  } catch(e){}
}

export async function openHistory(){
  $('#history-overlay').classList.remove('hidden');
  const listEl = $('#history-list');
  listEl.innerHTML = '<div class="row"><span>Chargement…</span></div>';
  let items = [];
  if (S.joined && me.group) {
    try {
      const snap = await R.get(R.ref(db, `convoy/${me.group}/history`));
      items = Object.entries(snap.val() || {}).map(([id,v]) => ({...v, id}));
    } catch(e){}
  }
  const local = JSON.parse(localStorage.getItem('fc_trips')||'[]');
  const seen = new Set(items.map(i=>i.start));
  for (const l of local) if (!seen.has(l.start)) items.push({...l, id: l.id || String(l.start)});
  items.sort((a,b)=>b.start-a.start);
  S.historyCache = items.slice(0,15);
  listEl.innerHTML = S.historyCache.length ? S.historyCache.map(i=>{
    const avg = i.min>0 ? Math.round(i.km/(i.min/60)) : '—';
    return `<div class="row" data-trip="${i.id}">
      <div class="avatar" style="background:var(--accent)">🗓️</div>
      <div class="who">
        <div class="nm">${new Date(i.start).toLocaleDateString('fr-FR')} — ${i.name||'?'}</div>
        <div class="sub">${i.min} min · Ø ${avg} km/h${i.ongoing?' · 🔴 en cours':''}</div>
      </div>
      <div class="rt"><div class="dst">${i.km} km</div><div class="tm">▶ voir</div></div>
    </div>`;
  }).join('') : '<div class="row"><span>Aucun trajet enregistré pour l\'instant</span></div>';
}

export function bindHistoryUI(){
  $('#btn-history').onclick = openHistory;
  $('#btn-close-history').onclick = () => $('#history-overlay').classList.add('hidden');
  $('#history-list').addEventListener('click', async e => {
    const row = e.target.closest('.row[data-trip]');
    if (!row) return;
    const item = S.historyCache.find(i => i.id === row.dataset.trip);
    if (!item) return;
    let pts = item.points ? item.points.slice() : null;
    if (!pts && item.hasPts && S.joined && me.group) {
      try {
        const snap = await R.get(R.ref(db, `convoy/${me.group}/tracks/${item.id}`));
        pts = parsePts(snap.val());
      } catch(err){}
    }
    openReplay(item, pts || []);
  });
}
