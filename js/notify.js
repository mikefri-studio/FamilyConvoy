// ============================================================
// NOTIFY v6 : ResponsiveVoice (cloud gratuit, stable) + fallback système
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

// Charger ResponsiveVoice
const rvScript = document.createElement('script');
rvScript.src = 'https://code.responsivevoice.org/responsivevoice.js?key=YOUR_KEY'; // clé gratuite sur responsivevoice.org
document.head.appendChild(rvScript);

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

const RV_VOICES = [
  { id:'rv:FrenchFemale', name:'Sophie ', sub:'ResponsiveVoice · cloud gratuit', icon:'🌐' },
  { id:'rv:FrenchMale',   name:'Pierre 🌐', sub:'ResponsiveVoice · cloud gratuit', icon:'🌐' }
];
const POLLY_VOICES = [
  { id:'cloud:Celine',  name:'Céline ☁️',  sub:'Amazon Polly · cloud gratuit', icon:'☁️' },
  { id:'cloud:Mathieu', name:'Mathieu ☁️', sub:'Amazon Polly · cloud gratuit', icon:'☁️' }
];

export function listVoiceOptions(){
  if (!voicesLoaded) loadVoices();
  return [
    ...RV_VOICES,
    ...POLLY_VOICES,
    ...frVoices.map(v => ({ id:'sys:'+v.name, name:v.name, sub:`${v.lang} · ${v.localService?'📱 offline':'☁️ en ligne'}`, icon:'🎤' }))
  ];
}
export function getVoiceChoice(){ return voiceChoice; }
export function setVoiceChoice(id){
  voiceChoice = id || '';
  if (id) localStorage.setItem('fc_voice', id); else localStorage.removeItem('fc_voice');
}

let currentAudio = null;
function stopAll(){
  if (currentAudio){ try{ currentAudio.pause(); }catch(e){} currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function rvSpeak(clean, voice){
  return new Promise((resolve, reject) => {
    if (typeof ResponsiveVoice === 'undefined'){
      reject(new Error('ResponsiveVoice non chargé'));
      return;
    }
    const v = ResponsiveVoice.speak(clean, voice, {
      onend: () => resolve(),
      onerror: () => reject(new Error('rv error')),
      pitch: 1, rate: 1, volume: 1
    });
    if (!v) reject(new Error('rv failed'));
  });
}

function systemSpeak(clean){
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'fr-FR'; u.rate = 1.02;
  if (frVoices.length){
    const best = frVoices.find(v => /google|microsoft|audrey|thomas/i.test(v.name)) || frVoices[0];
    u.voice = best;
  }
  speechSynthesis.speak(u);
}

export function speak(txt){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').trim();
  if (!clean) return;
  stopAll();

  if (voiceChoice.startsWith('rv:') && typeof ResponsiveVoice !== 'undefined'){
    rvSpeak(clean, voiceChoice.slice(3)).catch(()=> systemSpeak(clean));
  } else if (voiceChoice.startsWith('cloud:')){
    // Polly (si tu veux garder)
    systemSpeak(clean);
  } else {
    systemSpeak(clean);
  }
}
export function testVoice(){
  speak('Bonjour, ceci est un test de la voix sélectionnée.');
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
