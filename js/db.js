// ============================================================
// DB : initialisation Firebase Realtime Database
// ============================================================
import { FIREBASE_CONFIG } from './config.js';

const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
const rtdb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');

export const R = rtdb;                                   // module complet (ref, set, get...)
export const db = rtdb.getDatabase(initializeApp(FIREBASE_CONFIG));
