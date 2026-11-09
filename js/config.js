// ============================================================
// CONFIG : clés API, styles de carte, emojis, palette, TTS
// ============================================================
export const MAPTILER_KEY = 'nJnYbbeBVl4T09PtkVVv';

// URL de ton worker Cloudflare (proxy TTS Edge de secours)
// Laisse '' si tu ne l'utilises pas — le moteur s'en passe très bien
export const EDGE_TTS_URL = 'https://convoy-tts.mikefri-app.workers.dev';

const ignRasterStyle = (layer, format, maxzoom) => ({
  version: 8,
  sources: {
    ign: {
      type: 'raster',
      tiles: [`https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&LAYER=${layer}&TILEMATRIXSET=PM&FORMAT=${format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`],
      tileSize: 256, maxzoom, attribution: '© IGN Géoplateforme'
    }
  },
  layers: [{ id: 'ign-base', type: 'raster', source: 'ign' }]
});

export const MAP_STYLES = {
  standard:  `https://api.maptiler.com/maps/streets-v2-light/style.json?key=${MAPTILER_KEY}`,
  satellite: `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`,
  hybrid:    `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
  ign:         ignRasterStyle('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png', 19),
  'ign-photo': ignRasterStyle('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', 19)
};
export const STYLE_LABELS = { standard:'standard', satellite:'satellite', hybrid:'hybride', ign:'Plan IGN', 'ign-photo':'photo IGN' };

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBLikY235Wr8capctDYiMEnt6AZflbShfs",
  authDomain: "family-convoy-c1b34.firebaseapp.com",
  databaseURL: "https://family-convoy-c1b34-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "family-convoy-c1b34",
  storageBucket: "family-convoy-c1b34.firebasestorage.app",
  messagingSenderId: "378869564440",
  appId: "1:378869564440:web:2c286789be6e783c99af6d"
};

export const TESLA_WORKER_URL = "";

export const EMOJIS = ['🚗','','🚕','️','🚌','','️','','','⛄','','','❤️','😎','','','🐶','','🦊','','🐼','','',''];

export const PALETTE = ['#e53935','#8e24aa','#3949ab','#00897b','#f4511e','#6d4c41','#d81b60','#1e88e5'];



// ============================================================
// ELEVENLABS TTS (Qualité studio)
// ============================================================
// ⬇️ COLLE TA CLÉ API ICI (commence par sk_)
export const ELEVENLABS_API_KEY = 'sk_a6fa1480643b469256cc6e253bc8eba0a7908fb5ad61287c'; 

// Voix par défaut (Rachel = féminine naturelle, multilingue)
export const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; 

// ============================================================
// ROUTING : Worker Cloudflare pour OpenRouteService
// ============================================================
export const ROUTING_WORKER_URL = 'https://family-convoy-routes.ton-username.workers.dev';
