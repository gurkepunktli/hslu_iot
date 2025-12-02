// ============================================
// KONFIGURATION - Hier anpassen!
// ============================================

const CONFIG = {
    // Dein Cloudflare Worker API Endpoint
    // Nach dem Worker-Deployment hier eintragen, z.B.:
    // API_URL: 'https://bike-api.dein-account.workers.dev'
    API_URL: 'https://bike-api.dyntech.workers.dev',
    
    // Geraete-ID (wie in DynamoDB)
    DEVICE_ID: 'pi9',
    
    // Update-Intervall in Millisekunden (3000 = 3 Sekunden)
    UPDATE_INTERVAL: 3000,
    
    // Startposition der Karte (wird ueberschrieben sobald Daten da sind)
    DEFAULT_LAT: 47.049,
    DEFAULT_LON: 8.305,
    DEFAULT_ZOOM: 15,
    
    // Track-Farben
    TRACK_COLOR_NORMAL: '#3b82f6',  // Blau
    TRACK_COLOR_STOLEN: '#ef4444',  // Rot
    
    // Maximale Track-Punkte (aeltere werden entfernt)
    MAX_TRACK_POINTS: 500,

    // Job-/Polling-Einstellungen
    JOB_STATUS_POLL_MS: 2000,
    GATEWAY_TARGET: 'gateway',
    GPS_PI_TARGET: 'pi9'
};
