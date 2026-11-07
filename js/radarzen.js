// ============================================================
// RADARZEN : connexion à Firestore (radars + signalements)
// ============================================================
import { S, me } from './state.js';

const RADARZEN_CONFIG = {
  apiKey: "AIzaSyAESYQeZY2bczUK1CqzJyV77G74C1jrMCI",
  authDomain: "radarzen-ae2bb.firebaseapp.com",
  projectId: "radarzen-ae2bb",
  storageBucket: "radarzen-ae2bb.firebasestorage.app",
  messagingSenderId: "778786332416",
  appId: "1:778786332416:web:5c9eedfcabb1cf2c3e5de5"
};

let db2 = null;
let radarzenRadars = [];
let radarzenReports = [];
let radarzenLoaded = false;

async function initRadarZen(){
  if (db2) return;
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getFirestore, collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const app2 = initializeApp(RADARZEN_CONFIG, 'radarzen');
    db2 = getFirestore(app2);
    await loadRadarZenData(collection, getDocs);
  } catch(e){
    console.error('[RadarZen] init erreur :', e.message);
  }
}

async function loadRadarZenData(collection, getDocs){
  try {
    const radarsSnap = await getDocs(collection(db2, 'radars'));
    radarzenRadars = radarsSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: 'rz_' + doc.id,
        type: d['Type de radar'] || 'ETD',
        date: d['Date de mise en service'] || '',
        vma: d['VMA'] || null,
        lat: d['Latitude'],
        lng: d['Longitude'],
        numero: d['Numero de radar'] || '',
        isMobile: /mobile|portable|remorqu/i.test(d['Type de radar'] || ''),
        isReport: false,
        source: 'radarzen'
      };
    }).filter(r => r.lat && r.lng);

    const reportsSnap = await getDocs(collection(db2, 'reports'));
    radarzenReports = reportsSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: 'rp_' + doc.id,
        type: d['type'] || 'autre',
        description: d['description'] || '',
        lat: d['lat'],
        lng: d['lng'],
        timestamp: d['timestamp'] || Date.now(),
        userId: d['userId'] || '',
        isReport: true,
        source: 'radarzen'
      };
    }).filter(r => r.lat && r.lng);

    radarzenLoaded = true;
    console.log('[RadarZen] chargés :', radarzenRadars.length, 'radars +', radarzenReports.length, 'reports');
  } catch(e){
    console.error('[RadarZen] chargement erreur :', e.message);
  }
}

export async function addReport(type, description){
  if (!db2 || !me.lat) return false;
  try {
    const { collection, addDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await addDoc(collection(db2, 'reports'), {
      type,
      description: description || '',
      lat: me.lat,
      lng: me.lng, // ⬅️ 'lng' pour matcher les règles
      timestamp: Date.now(),
      userId: me.id,
      userName: me.name,
      confirmations: 1,  // ⬅️ Requis par les règles
      dismissals: 0      // ⬅️ Requis par les règles
    });
    console.log('[RadarZen] report ajouté avec succès');
    return true;
  } catch(e){
    console.error('[RadarZen] ajout report erreur :', e.message);
    return false;
  }
}

export function getRadarzenRadars(){ return radarzenRadars; }
export function getRadarzenReports(){ return radarzenReports; }
export function isRadarZenLoaded(){ return radarzenLoaded; }
export { initRadarZen };
