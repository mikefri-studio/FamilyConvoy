// ============================================================
// NOTIFY : alertes visuelles, synthèse vocale, pill statut
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

export function speak(txt){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'');
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'fr-FR'; u.rate = 1.05;
  speechSynthesis.speak(u);
}

export function pushAlert(msg, type='warn', ttl=6000){
  const el = document.createElement('div');
  el.className = 'alert ' + type;
  el.textContent = msg;
  $('#alerts').prepend(el);
  if (canVibrate && navigator.vibrate) navigator.vibrate(type==='warn'?[200,100,200]:[100]);
  if (type==='warn') speak(msg);
  setTimeout(()=>el.remove(), ttl);
}

export function updateStatus(){
  if (!S.joined) { $('#status').textContent = 'hors convoi'; return; }
  const roleTxt = me.role === 'screen' ? '📺 écran · ' : '';
  $('#status').textContent = `${S.netIcon} ${roleTxt}${S.hidden?'position masquée · ':''}±${Math.round(me.accuracy||0)}m · ${me.speed} km/h`;
}

export function updateRoleUI(){
  $('#role-pill').classList.toggle('hidden', !(S.joined && me.role === 'screen'));
}
