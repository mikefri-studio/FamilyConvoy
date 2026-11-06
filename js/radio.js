// ============================================================
// RADIO : talkie-walkie (maintenir pour parler, 15 s max)
// ============================================================
import { R, db } from './db.js';
import { S, me } from './state.js';
import { $ } from './utils.js';
import { pushAlert } from './notify.js';

let mediaRec = null, radioChunks = [], radioTimer = null;

function blobToBase64(blob){
  return new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
}
export function playRadio(m){
  pushAlert(`📻 ${m.name} parle…`,'info',4000);
  const audio = new Audio(`data:${m.mime||'audio/webm'};base64,${m.data}`);
  audio.play().catch(()=>{});
}
function stopRadio(){
  if (mediaRec && mediaRec.state === 'recording') mediaRec.stop();
  clearTimeout(radioTimer);
  $('#btn-radio').classList.remove('recording');
}
export function bindRadio(){
  const btn = $('#btn-radio');
  btn.addEventListener('pointerdown', async e => {
    e.preventDefault();
    if (!S.joined) { pushAlert('Rejoins d\'abord un convoi','info'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRec = new MediaRecorder(stream);
      radioChunks = [];
      mediaRec.ondataavailable = ev => radioChunks.push(ev.data);
      radioTimer = setTimeout(()=>{ if (mediaRec && mediaRec.state === 'recording') stopRadio(); }, 15000);
      mediaRec.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(radioChunks, {type: mediaRec.mimeType || 'audio/webm'});
        if (blob.size < 500) return;
        if (blob.size > 400000) { pushAlert('🎙️ Message trop long','warn'); return; }
        const b64 = await blobToBase64(blob);
        R.set(R.ref(db, `convoy/${me.group}/radio/${Date.now()}_${me.device.slice(0,8)}`),
          { from: me.device, fromPerson: me.id, name: me.name, data: b64, mime: blob.type, ts: Date.now() });
        pushAlert('📻 Message envoyé','success',3000);
      };
      mediaRec.start();
      btn.classList.add('recording');
      if (navigator.vibrate) navigator.vibrate(50);
    } catch(err){ pushAlert('🎙️ Micro refusé','warn'); }
  });
  ['pointerup','pointercancel','pointerleave'].forEach(ev => btn.addEventListener(ev, stopRadio));
}
