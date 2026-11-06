// ============================================================
// AVATAR : personnalisation (emoji, couleur, photo, emblème)
// Stockage photos HORS du flux temps réel (nœud avatars/) → quota safe
// ============================================================
import { R, db } from './db.js';
import { S, me } from './state.js';
import { $, initialOf, colorFor, bus } from './utils.js';
import { pushAlert } from './notify.js';
import { EMOJIS } from './config.js';

const AV_MAX = 30000; // ~22 Ko en base64 max

function fileToDataURL(file, size, quality){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, size, size);
        res(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = rej;
      img.src = r.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ----- Rendu d'un avatar sur un élément (marker ou liste) -----
export function applyAvatarToEl(el, id, v){
  const cached = S.avatarCache[id];
  const wantImg = v.hasAvatar && cached && cached.data && cached.ts >= (v.avatarTs||0);
  const key = wantImg ? 'i'+cached.ts : (v.emoji || '') + '|' + initialOf(v.name);
  if (el.dataset.av === key) return;
  el.dataset.av = key;
  if (wantImg){
    el.style.backgroundImage = `url(${cached.data})`;
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = v.emoji || initialOf(v.name);
  }
}

// ----- Chargement paresseux + cache local -----
export async function loadAvatar(id, ts){
  try {
    const snap = await R.get(R.ref(db, `convoy/${me.group}/avatars/${id}`));
    const data = snap.val();
    if (data) {
      S.avatarCache[id] = { ts: ts||Date.now(), data };
      localStorage.setItem(`fc_av_${me.group}_${id}`, JSON.stringify(S.avatarCache[id]));
    }
  } catch(e){}
}
export function restoreAvatarCache(id){
  const raw = localStorage.getItem(`fc_av_${me.group}_${id}`);
  if (raw && !S.avatarCache[id]) { try { S.avatarCache[id] = JSON.parse(raw); } catch(e){} }
}
export function ensureAvatars(all, onchange){
  const jobs = [];
  for (const [id,v] of Object.entries(all)){
    if (!v.hasAvatar) continue;
    restoreAvatarCache(id);
    const cached = S.avatarCache[id];
    if (!cached || cached.ts < (v.avatarTs||0)) jobs.push(loadAvatar(id, v.avatarTs));
  }
  if (jobs.length) Promise.all(jobs).then(()=> onchange && onchange());
}

// ----- Uploads -----
export async function uploadMyPhoto(file){
  if (!S.joined) return pushAlert('Rejoins d\'abord un convoi','info');
  const data = await fileToDataURL(file, 96, 0.7);
  if (!data || data.length > AV_MAX) return pushAlert('Image trop lourde (max ~20 Ko)','warn');
  await R.set(R.ref(db, `convoy/${me.group}/avatars/${me.id}`), data);
  me.hasAvatar = true; me.avatarTs = Date.now();
  S.avatarCache[me.id] = { ts: me.avatarTs, data };
  localStorage.setItem(`fc_av_${me.group}_${me.id}`, JSON.stringify(S.avatarCache[me.id]));
  await R.update(R.ref(db, `convoy/${me.group}/members/${me.id}`), { hasAvatar:true, avatarTs: me.avatarTs });
  pushAlert(' Photo appliquée !','success');
  refreshPreviews(); bus.emit('render');
}
export async function removeMyPhoto(){
  if (!S.joined) return;
  await R.set(R.ref(db, `convoy/${me.group}/avatars/${me.id}`), null);
  me.hasAvatar = false;
  delete S.avatarCache[me.id];
  localStorage.removeItem(`fc_av_${me.group}_${me.id}`);
  await R.update(R.ref(db, `convoy/${me.group}/members/${me.id}`), { hasAvatar:null, avatarTs:null });
  pushAlert('🗑 Photo retirée','info');
  refreshPreviews(); bus.emit('render');
}
export async function uploadEmblem(file){
  if (!S.joined) return pushAlert('Rejoins d\'abord un convoi','info');
  const data = await fileToDataURL(file, 128, 0.7);
  if (!data || data.length > AV_MAX) return pushAlert('Image trop lourde (max ~20 Ko)','warn');
  await R.set(R.ref(db, `convoy/${me.group}/emblem`), data);
  S.emblem = data;
  localStorage.setItem('fc_emb_'+me.group, data);
  applyEmblem(); refreshPreviews();
  pushAlert('🚩 Emblème du groupe mis à jour','success');
}
export async function removeEmblem(){
  if (!S.joined) return;
  await R.set(R.ref(db, `convoy/${me.group}/emblem`), null);
  S.emblem = null;
  localStorage.removeItem('fc_emb_'+me.group);
  applyEmblem(); refreshPreviews();
  pushAlert('🗑 Emblème retiré','info');
}
export async function loadEmblem(group){
  const cached = localStorage.getItem('fc_emb_'+group);
  if (cached) { S.emblem = cached; applyEmblem(); }
  try {
    const snap = await R.get(R.ref(db, `convoy/${group}/emblem`));
    S.emblem = snap.val() || null;
    if (S.emblem) localStorage.setItem('fc_emb_'+group, S.emblem);
    else localStorage.removeItem('fc_emb_'+group);
    applyEmblem();
  } catch(e){}
}
export function applyEmblem(){
  const img = $('#group-emblem');
  if (!img) return;
  if (S.emblem){ img.src = S.emblem; img.classList.remove('hidden'); }
  else img.classList.add('hidden');
}

// ----- UI de l'overlay 🎭 -----
function refreshPreviews(){
  const mine = S.avatarCache[me.id];
  const pp = $('#photo-preview'), pr = $('#btn-photo-remove');
  if (me.hasAvatar && mine){ pp.src = mine.data; pp.classList.remove('hidden'); pr.classList.remove('hidden'); }
  else { pp.classList.add('hidden'); pr.classList.add('hidden'); }
  const ep = $('#emblem-preview'), er = $('#btn-emblem-remove');
  if (S.emblem){ ep.src = S.emblem; ep.classList.remove('hidden'); er.classList.remove('hidden'); }
  else { ep.classList.add('hidden'); er.classList.add('hidden'); }
}
export function openAvatarOverlay(){
  $('#inp-color').value = me.colorChoice || colorFor(me.id);
  refreshPreviews();
  $('#avatar-overlay').classList.remove('hidden');
}
export function bindAvatarUI(){
  const grid = $('#emoji-grid');
  grid.innerHTML = EMOJIS.map(e=>`<button class="emoji-btn" data-e="${e}">${e}</button>`).join('')
                 + `<button class="emoji-btn" data-e="">❌</button>`;
  grid.onclick = e => {
    const b = e.target.closest('.emoji-btn'); if(!b) return;
    me.emoji = b.dataset.e || '';
    localStorage.setItem('fc_emoji', me.emoji);
    pushAlert(me.emoji ? `Logo : ${me.emoji}` : 'Logo effacé', 'success', 1500);
    bus.emit('render');
  };
  $('#inp-color').onchange = e => {
    me.colorChoice = e.target.value;
    localStorage.setItem('fc_color', me.colorChoice);
    bus.emit('render');
  };
  $('#btn-color-reset').onclick = () => {
    me.colorChoice = '';
    localStorage.removeItem('fc_color');
    $('#inp-color').value = colorFor(me.id);
    bus.emit('render');
  };
  $('#inp-photo').onchange = async e => { const f = e.target.files[0]; if (f) await uploadMyPhoto(f); e.target.value=''; };
  $('#btn-photo-remove').onclick = removeMyPhoto;
  $('#inp-emblem').onchange = async e => { const f = e.target.files[0]; if (f) await uploadEmblem(f); e.target.value=''; };
  $('#btn-emblem-remove').onclick = removeEmblem;
  $('#btn-close-avatar').onclick = () => $('#avatar-overlay').classList.add('hidden');
}
