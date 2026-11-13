// ============================================================
// NOTIFY v10 : TTS 100% voix système (Google Neural2 /
// Microsoft Natural) — illimité, gratuit, fonctionne offline.
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

let frVoices = [];
let voicesLoaded = false;
function loadVoices(){
  const all = speechSynthesis.getVoices();
  frVoices = all.filter(v => /^fr/i.test(v.lang));
  if (frVoices.length) voicesLoaded = true;
}
if ('speechSynthesis' in window){
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 1000);
}

let voiceChoice = localStorage.getItem('fc_voice') || '';
// Nettoyage : ancien choix ElevenLabs oublié
if (voiceChoice.startsWith('eleven:')){
  localStorage.removeItem('fc_voice');
  voiceChoice = '';
}

export function listVoiceOptions(){
  if (!voicesLoaded) loadVoices();
  const best = pickBestVoice();
  return frVoices.map(v => {
    const isPremium = /premium|enhanced|natural|neural|google|microsoft/i.test(v.name);
    const isBest = best && v.name === best.name;
    return {
      id:'sys:'+v.name,
      name: isPremium ? `${v.name} ⭐` : v.name,
      sub:`${v.lang} · ${v.localService?'📱 offline':'️ en ligne'}${isPremium?' · PREMIUM':''}${isBest?' · ✅ RECOMMANDÉE':''}`,
      icon:'🎤'
    };
  });
}
export function getVoiceChoice(){ return voiceChoice; }
export function setVoiceChoice(id){
  voiceChoice = id || '';
  if (id) localStorage.setItem('fc_voice', id); else localStorage.removeItem('fc_voice');
}

// ---------- Anti-répétition + file d'attente ----------
let speaking = false;
let queue = [];
let lastText = '';
let lastAt = 0;

function systemSpeak(clean){
  return new Promise(res => {
    let done = false;
    const fin = () => { if (!done){ done = true; res(); } };
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fr-FR'; u.rate = 1.02;
    const best = pickBestVoice();
    if (best){ u.voice = best; u.lang = best.lang; }
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, Math.min(15000, clean.length * 90 + 3000));
    speechSynthesis.speak(u);
  });
}

// 🥇 Classement : Google Neural2 / Microsoft Natural en tête
function pickBestVoice(){
  if (!frVoices.length) return null;
  if (voiceChoice.startsWith('sys:')){
    const v = frVoices.find(v => v.name === voiceChoice.slice(4));
    if (v) return v;
  }
  const scored = frVoices.map(v => {
    let score = 0; const n = v.name.toLowerCase();
    if (v.lang === 'fr-FR') score += 10;
    if (/neural2|neural/i.test(n)) score += 40;
    if (/natural/i.test(n)) score += 40;
    if (/premium|enhanced/i.test(n)) score += 35;
    if (/google/i.test(n)) score += 25;
    if (/microsoft/i.test(n)) score += 20;
    if (/audrey|thomas|amelie|aurelie|marie|henri|julie|hortense|paul|denise|eloise/i.test(n)) score += 8;
    if (v.localService) score += 5;
    return { v, score };
  }).sort((a,b) => b.score - a.score);
  return scored[0].v;
}

function runSpeak(clean){
  speaking = true;
  const next = () => { speaking = false; const q = queue.shift(); if (q) start(q); };
  systemSpeak(clean).then(next).catch(next);
}
function start(clean){
  lastText = clean; lastAt = Date.now();
  runSpeak(clean);
}
export function speak(txt, opts = {}){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').trim();
  if (!clean) return;
  const now = Date.now();
  if (!opts.force && clean === lastText && now - lastAt < 20000) return;
  if (opts.interrupt){
    queue = [];
    speechSynthesis.cancel();
    speaking = false;
    start(clean);
    return;
  }
  if (speaking || queue.length){
    if (queue[queue.length - 1] === clean) return;
    queue.push(clean);
    if (queue.length > 2) queue.shift();
    return;
  }
  start(clean);
}
export function testVoice(){ speak('Bonjour, ceci est un test de la voix sélectionnée.', { interrupt:true, force:true }); }

// ---------- Alertes ----------
export function pushAlert(msg, type='warn', ttl=6000, opts={}){
  const el = document.createElement('div');
  el.className = 'alert ' + type;
  el.textContent = msg;
  $('#alerts').prepend(el);
  if (canVibrate && navigator.vibrate) navigator.vibrate(type==='warn'?[200,100,200]:[100]);
  if (type==='warn' && !opts.silent) speak(msg);
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
