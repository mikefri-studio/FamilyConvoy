// ============================================================
// NOTIFY v6 : ElevenLabs (qualité studio) + voix système premium
// ============================================================
import { $ } from './utils.js';
import { S, me } from './state.js';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from './config.js';

let canVibrate = false;
document.addEventListener('pointerdown', () => { canVibrate = true; }, { once: true });

// ---------- Voix système ----------
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

// ---------- Choix de voix ----------
let voiceChoice = localStorage.getItem('fc_voice') || '';
let elevenlabsQuota = parseInt(localStorage.getItem('fc_elevenlabs_quota') || '10000');

const ELEVENLABS_VOICES = [
  { id:'eleven:Rachel', name:'Rachel ⭐', sub:'ElevenLabs · qualité studio · 10k car/mois', icon:'⭐', voiceId:'21m00Tcm4TlvDq8ikWAM' },
  { id:'eleven:Domi', name:'Domi ⭐', sub:'ElevenLabs · masculine', icon:'⭐', voiceId:'AZnzlk1XvdvUeBnXmlld' },
  { id:'eleven:Bella', name:'Bella ⭐', sub:'ElevenLabs · féminine douce', icon:'⭐', voiceId:'EXAVITQu4vr4xnSDxMaL' }
];

export function listVoiceOptions(){
  if (!voicesLoaded) loadVoices();
  const eleven = ELEVENLABS_API_KEY && elevenlabsQuota > 0 ? ELEVENLABS_VOICES : [];
  return [
    ...eleven,
    ...frVoices.map(v => {
      const isPremium = /premium|enhanced|natural|neural|google|microsoft/i.test(v.name);
      return { 
        id:'sys:'+v.name, 
        name: isPremium ? `${v.name} ⭐` : v.name,
        sub:`${v.lang} · ${v.localService?'📱 offline':'☁️ en ligne'}${isPremium?' · PREMIUM':''}`, 
        icon:'🎤' 
      };
    })
  ];
}
export function getVoiceChoice(){ return voiceChoice; }
export function setVoiceChoice(id){
  voiceChoice = id || '';
  if (id) localStorage.setItem('fc_voice', id); else localStorage.removeItem('fc_voice');
}

// ---------- Lecture ----------
let currentAudio = null;
function stopAll(){
  if (currentAudio){ try{ currentAudio.pause(); }catch(e){} currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function playBlob(blob){
  return new Promise((res, rej) => {
    const a = new Audio(URL.createObjectURL(blob));
    currentAudio = a;
    a.onended = () => { currentAudio = null; res(); };
    a.onerror = (e) => { currentAudio = null; rej(new Error('audio')); };
    a.play().catch(rej);
  });
}

// 🌟 ElevenLabs TTS (qualité studio)
function elevenlabsSpeak(clean, voiceId){
  return new Promise(async (resolve, reject) => {
    if (!ELEVENLABS_API_KEY || elevenlabsQuota <= 0) return reject(new Error('quota épuisé ou clé absente'));
    try {
      console.log('[TTS] ElevenLabs →', clean.length, 'car, quota restant:', elevenlabsQuota);
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: clean,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const blob = await res.blob();
      elevenlabsQuota -= clean.length;
      localStorage.setItem('fc_elevenlabs_quota', elevenlabsQuota);
      console.log('[TTS] ElevenLabs OK, blob:', blob.size, 'octets');
      await playBlob(blob);
      resolve();
    } catch(e) {
      console.log('[TTS] ElevenLabs erreur:', e.message);
      reject(e);
    }
  });
}

function pickBestVoice(){
  if (!frVoices.length) return null;
  if (voiceChoice.startsWith('sys:')){
    const v = frVoices.find(v => v.name === voiceChoice.slice(4));
    if (v) return v;
  }
  const scored = frVoices.map(v => {
    let score = 0; const n = v.name.toLowerCase();
    if (v.lang === 'fr-FR') score += 10;
    if (/premium|enhanced/i.test(n)) score += 25;
    if (/google/i.test(n)) score += 20;
    if (/microsoft/i.test(n)) score += 15;
    if (/audrey|thomas|amelie|aurelie|marie|henri|julie|hortense|paul/i.test(n)) score += 8;
    if (v.localService) score += 5;
    return { v, score };
  }).sort((a,b) => b.score - a.score);
  return scored[0].v;
}
function systemSpeak(clean){
  console.log('[TTS] fallback système');
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'fr-FR'; u.rate = 1.02;
  const best = pickBestVoice();
  if (best){ u.voice = best; u.lang = best.lang; }
  speechSynthesis.speak(u);
}

// ---------- Parole avec chaîne de repli ----------
export function speak(txt){
  if (!S.voiceOn || !('speechSynthesis' in window)) return;
  const clean = txt.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').trim();
  if (!clean) return;
  stopAll();
  console.log('[TTS] speak :', clean, '| choix :', voiceChoice);

  const engines = [];
  if (voiceChoice.startsWith('eleven:') && ELEVENLABS_API_KEY && elevenlabsQuota > 0){
    const voice = ELEVENLABS_VOICES.find(v => v.id === voiceChoice);
    if (voice) engines.push(['eleven', () => elevenlabsSpeak(clean, voice.voiceId)]);
  }
  engines.push(['sys', () => { systemSpeak(clean); return Promise.resolve(); }]);

  (async () => {
    for (const [name, fn] of engines){
      try { 
        console.log('[TTS] tentative :', name);
        await fn(); 
        console.log('[TTS] succès :', name);
        return; 
      }
      catch(e){
        console.log('[TTS] échec :', name, '→', e.message);
      }
    }
  })();
}
export function testVoice(){
  speak('Bonjour, ceci est un test de la voix sélectionnée.');
}

// ---------- Alertes ----------
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
