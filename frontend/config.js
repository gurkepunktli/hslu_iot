// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Cloudflare Worker API Endpoint
    // Set this after worker deployment, e.g.:
    // API_URL: 'https://bike-api.your-account.workers.dev'
    API_URL: 'https://bike-api.dyntech.workers.dev',

    // Device ID (as stored in DynamoDB)
    DEVICE_ID: 'pi9',

    // Update interval in milliseconds (15000 = 15 seconds)
    // Matches MQTT forwarder rate limit (10s) to avoid excessive polling
    UPDATE_INTERVAL: 15000,

    // Default map position (overridden when data is available)
    DEFAULT_LAT: 47.049,
    DEFAULT_LON: 8.305,
    DEFAULT_ZOOM: 15,

    // Track colors
    TRACK_COLOR_NORMAL: '#3b82f6',  // Blue
    TRACK_COLOR_STOLEN: '#ef4444',  // Red

    // Maximum track points (older points will be removed)
    MAX_TRACK_POINTS: 500,

    // How many history points to load (for last fix)
    HISTORY_LIMIT: 500,

    // Staleness checks for online/GPS status
    STALE_UPDATE_MS: 60_000, // How old can the last signal be to be considered online
    STALE_FIX_MS: 120_000,   // How old can the last GPS fix be

    // Job polling settings
    JOB_STATUS_POLL_MS: 2000,
    GATEWAY_TARGET: 'gateway',
    GPS_PI_TARGET: 'pi9',
    LIGHT_TARGET: 'lightpi' // rear light controller Pi
};
