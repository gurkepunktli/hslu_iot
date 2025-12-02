// ============================================
// BIKE TRACKER APP
// ============================================

let map, marker, trackLine;
let isStolen = false;
let lastPosition = null;
let lastGpsFix = null; // Last valid GPS fix with coordinates
let systemRunning = false; // Track if system (GPS + MQTT) is running
let currentStatus = 'unknown'; // Track status badge state
const trackPoints = [];

// Initialize map
function initMap() {
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'OpenStreetMap contributors'
    });

    const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
            maxZoom: 19,
            attribution: 'Tiles by Esri'
        }
    );

    map = L.map('map', {
        center: [CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LON],
        zoom: CONFIG.DEFAULT_ZOOM,
        layers: [osm]
    });

    L.control.layers(
        {
            'Map': osm,
            'Satellite': satellite
        },
        null,
        { position: 'topleft' }
    ).addTo(map);
}

// Fahrrad-Icon erstellen
function createBikeIcon(stolen = false) {
    return L.divIcon({
        className: 'bike-marker',
        html: `<div class="bike-icon ${stolen ? 'stolen' : ''}">&#128690;</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });
}

// Position aktualisieren
async function updatePosition() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/position?device=${CONFIG.DEVICE_ID}`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        // Loading ausblenden
        document.getElementById('loading').classList.add('hidden');

        const latRaw = data.lat;
        const lonRaw = data.lon;
        const lat = typeof latRaw === 'string' ? parseFloat(latRaw) : latRaw;
        const lon = typeof lonRaw === 'string' ? parseFloat(lonRaw) : lonRaw;

        // Use last_update_ts for last contact, ts for last GPS fix
        const lastUpdateTs = data.last_update_ts || data.ts;
        const lastFixTs = data.ts;

        // If we have a timestamp, we have connection
        const hasConnection = lastUpdateTs != null && lastUpdateTs !== '';

        // Check if coordinates are valid
        const hasValidCoords = lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon);
        const isZeroCoords = lat === 0 && lon === 0;

        // Update last update timestamp (any signal received)
        if (hasConnection) {
            updateLastUpdateTimestamp(lastUpdateTs);
        }

        // No connection at all
        if (!hasConnection) {
            if (lastGpsFix) {
                updateLastFixTimestamp(lastGpsFix.ts);
                updateUI(lastGpsFix);
                ensureMarker(lastGpsFix.lat, lastGpsFix.lon, lastGpsFix.stolen);
            }
            setOfflineStatus();
            return;
        }

        const now = Date.now();
        const lastUpdateMs = toMs(lastUpdateTs);
        const lastFixMs = toMs(lastFixTs);
        const updateFresh = !!lastUpdateMs && now - lastUpdateMs <= CONFIG.STALE_UPDATE_MS;
        const fixFresh = !!lastFixMs && now - lastFixMs <= CONFIG.STALE_FIX_MS;

        // Connection but no valid GPS fix
        if (!hasValidCoords || isZeroCoords) {
            setNoFixStatus('Kein GPS-Fix verfuegbar');
            return;
        }

        if (!updateFresh) {
            setOfflineStatus('Signal zu alt');
            return;
        }

        if (!fixFresh) {
            setNoFixStatus('GPS-Fix zu alt');
            return;
        }

        // Valid GPS data
        data.lat = lat;
        data.lon = lon;

        lastPosition = data;
        lastGpsFix = data; // Store last valid GPS fix

        // Update last GPS fix timestamp
        updateLastFixTimestamp(lastFixTs);
        const latlng = [data.lat, data.lon];

        // Marker erstellen oder aktualisieren
        ensureMarker(data.lat, data.lon, data.stolen);

        // Track aktualisieren
        trackPoints.push(latlng);
        if (trackPoints.length > CONFIG.MAX_TRACK_POINTS) {
            trackPoints.shift();
        }

        const trackColor = data.stolen ? CONFIG.TRACK_COLOR_STOLEN : CONFIG.TRACK_COLOR_NORMAL;

        if (trackLine) {
            trackLine.setLatLngs(trackPoints);
            trackLine.setStyle({ color: trackColor });
        } else {
            trackLine = L.polyline(trackPoints, {
                color: trackColor,
                weight: 4,
                opacity: 0.7
            }).addTo(map);
        }

        // UI aktualisieren
        updateUI(data);

        // Diebstahl-Status aus /api/status holen (persistenter Zustand)
        try {
            const statusRes = await fetch(`${CONFIG.API_URL}/api/status?device=${CONFIG.DEVICE_ID}`);
            if (statusRes.ok) {
                const status = await statusRes.json();
                updateStolenUI(!!status.stolen);
            } else {
                updateStolenUI(isStolen);
            }
        } catch (e) {
            console.warn('Failed to load status:', e);
            updateStolenUI(isStolen);
        }

        // Status setzen je nach Freshness
        if (!updateFresh) {
            setOfflineStatus('Signal zu alt');
        } else if (!fixFresh) {
            setNoFixStatus('GPS-Fix zu alt');
        } else {
            setOnlineStatus();
        }

    } catch (err) {
        console.error('Update failed:', err);
        setOfflineStatus();
        document.getElementById('loading').classList.add('hidden');
    }
}

// Update last update timestamp (any signal)
function updateLastUpdateTimestamp(ts) {
    if (ts) {
        const date = new Date(parseInt(ts) || ts);
        const dateStr = date.toLocaleDateString('de-CH');
        const timeStr = date.toLocaleTimeString('de-CH');
        document.getElementById('lastUpdate').textContent = `${dateStr} ${timeStr}`;
    }
}

// Update last GPS fix timestamp (valid coordinates)
function updateLastFixTimestamp(ts) {
    if (ts) {
        const date = new Date(parseInt(ts) || ts);
        const dateStr = date.toLocaleDateString('de-CH');
        const timeStr = date.toLocaleTimeString('de-CH');
        document.getElementById('lastFix').textContent = `${dateStr} ${timeStr}`;
    }
}

// UI mit Daten aktualisieren
function updateUI(data) {
    const speedKnRaw = data.speed != null ? parseFloat(data.speed) : 0;
    const speedKn = Number.isFinite(speedKnRaw) ? speedKnRaw : 0;
    const speedKmh = (speedKn * 1.852).toFixed(1);
    document.getElementById('speed').textContent = `${speedKmh} km/h`;

    const courseRaw = data.course != null ? parseFloat(data.course) : 0;
    const course = Number.isFinite(courseRaw) ? courseRaw : 0;
    document.getElementById('course').textContent = course.toFixed(0) + '\u00B0';
    document.getElementById('coords').textContent = `${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`;
}

// Online-Status setzen
function setOnlineStatus(message) {
    currentStatus = 'online';
    if (isStolen) {
        setMainStatus('alert', 'STOLEN', 'Bike is locked');
    } else {
        setMainStatus('online', 'Online', message || 'Signal OK');
    }
    setLamp('lampConnection', 'online', 'Online');
    setLamp('lampGps', 'online', 'GPS fix OK');
   ;
    if (!systemRunning) {
        systemRunning = true;
        updateButtonVisibility();
    }
}

// Offline-Status setzen
function setOfflineStatus(message) {
    currentStatus = 'offline';
    if (isStolen) {
        setMainStatus('alert', 'STOLEN', message || 'No connection');
    } else {
        setMainStatus('offline', 'Offline', message || 'No connection');
    }
    setLamp('lampConnection', 'offline', message || 'No signal');
    setLamp('lampGps', 'offline', '--');
   ;
}

// Error: No GPS fix available
function setNoFixStatus(message) {
    currentStatus = 'nofix';
    if (isStolen) {
        setMainStatus('alert', 'STOLEN', message || 'No GPS fix');
    } else {
        setMainStatus('nofix', 'No GPS fix', message || 'Waiting for satellites');
    }
    setLamp('lampConnection', 'online', 'Online');
    setLamp('lampGps', 'nofix', message || 'No GPS fix');
   ;
    if (!systemRunning) {
        systemRunning = true;
        updateButtonVisibility();
    }
}

// Update button visibility based on system state
function updateButtonVisibility() {
    const startBtn = document.getElementById('btnStartSystem');
    const stopBtn = document.getElementById('btnStopSystem');

    if (systemRunning) {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }
}

// Hauptstatus (Badge) setzen
function setMainStatus(state, title, subtitle) {
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    const dot = document.getElementById('statusDot');
    if (text) text.textContent = title || '';
    if (sub) sub.textContent = subtitle || '';
    if (dot) dot.className = `badge-dot ${state || ''}`.trim();
}

// Status-Lampe setzen
function setLamp(id, state, valueText) {
    const lamp = document.getElementById(id);
    const value = document.getElementById(`${id}Text`);
    if (!lamp) return;
    lamp.className = `lamp ${state || ''}`.trim();
    if (value) value.textContent = valueText || '--';
}

// Diebstahl-UI aktualisieren
function updateStolenUI(stolen) {
    isStolen = stolen;

    const banner = document.getElementById('stolenBanner');
    const btn = document.getElementById('btnStolen');

    if (stolen) {
        banner.classList.add('active');
        setMainStatus('alert', 'STOLEN', 'Bike is locked and alert');
                btn.className = 'btn-stolen clear';
        btn.textContent = 'Unlock bike';
    } else {
        banner.classList.remove('active');
        if (currentStatus === 'online') setOnlineStatus();
        else if (currentStatus === 'nofix') setNoFixStatus();
        else setOfflineStatus();
        updateAlertLamp();
        btn.className = 'btn-stolen report';
        btn.textContent = 'Report as stolen';
    }
}

// Diebstahl melden / Entwarnung
async function toggleStolen() {
    const pin = prompt('Enter security PIN:');
    if (!pin) return;

    const btn = document.getElementById('btnStolen');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/stolen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stolen: !isStolen,
                pin: pin,
                device: CONFIG.DEVICE_ID
            })
        });

        const result = await res.json();

        if (result.error) {
            alert('Error: ' + result.error);
            updateStolenUI(isStolen);
            return;
        }

        updateStolenUI(result.stolen);

        if (marker) {
            marker.setIcon(createBikeIcon(result.stolen));
        }

    } catch (err) {
        console.error('Error:', err);
        alert('Connection error. Please try again.');
        updateStolenUI(isStolen);
    }

    btn.disabled = false;
}

function setSystemStatus(text, mode = 'muted') {
    const el = document.getElementById('systemStatus');
    if (!el) return;
    el.textContent = text || 'No current status';
    el.className = 'system-status';
    if (mode === 'ok') el.classList.add('ok');
    if (mode === 'warn') el.classList.add('warn');
    if (mode === 'alert') el.classList.add('alert');
    if (mode === 'muted') el.classList.add('muted');
}

// System komplett starten (GPS Reader + MQTT Forwarder)
async function startSystem() {
    const btn = document.getElementById('btnStartSystem');
    if (!btn) return;

    btn.disabled = true;

    try {
        // Step 1: Start GPS Reader
        setSystemStatus('Starting GPS Reader...', 'warn');

        const gpsRes = await fetch(`${CONFIG.API_URL}/api/job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'start_gps_reader',
                target: CONFIG.GPS_PI_TARGET,
                params: { device: CONFIG.DEVICE_ID }
            })
        });

        if (!gpsRes.ok) {
            throw new Error(`GPS Job failed: HTTP ${gpsRes.status}`);
        }

        const gpsData = await gpsRes.json();
        const gpsJobId = gpsData.job_id;

        // Wait for GPS Reader to finish
        setSystemStatus('GPS Reader running...', 'warn');
        const gpsReady = await waitForJob(gpsJobId);

        if (!gpsReady) {
            throw new Error('GPS Reader could not be started');
        }

        setSystemStatus('GPS Reader ok. Starting MQTT Forwarder...', 'warn');

        // Step 2: Start MQTT Forwarder
        const mqttRes = await fetch(`${CONFIG.API_URL}/api/job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'mqtt_forward',
                target: CONFIG.GATEWAY_TARGET,
                params: { script_path: 'mqtt_forwarder.py' }
            })
        });

        if (!mqttRes.ok) {
            throw new Error(`MQTT Job failed: HTTP ${mqttRes.status}`);
        }

        const mqttData = await mqttRes.json();
        const mqttJobId = mqttData.job_id;

        // Wait for MQTT Forwarder to finish
        setSystemStatus('Gateway is working...', 'warn');
        const mqttReady = await waitForJob(mqttJobId);

        if (!mqttReady) {
            throw new Error('MQTT Forwarder could not be started');
        }

        setSystemStatus('System running (GPS + MQTT)', 'ok');
        btn.disabled = false;
        systemRunning = true;
        updateButtonVisibility();

    } catch (err) {
        console.error('System start failed:', err);
        setSystemStatus(`Error: ${err.message}`, 'alert');
        btn.disabled = false;
    }
}

// Stop complete system (MQTT Forwarder + GPS Reader)
async function stopSystem() {
    const btn = document.getElementById('btnStopSystem');
    if (!btn) return;

    btn.disabled = true;

    try {
        // Step 1: Stop MQTT Forwarder
        setSystemStatus('Stopping MQTT Forwarder...', 'warn');

        const mqttRes = await fetch(`${CONFIG.API_URL}/api/job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'stop_mqtt_forward',
                target: CONFIG.GATEWAY_TARGET,
                params: {}
            })
        });

        if (!mqttRes.ok) {
            throw new Error(`MQTT Stop failed: HTTP ${mqttRes.status}`);
        }

        const mqttData = await mqttRes.json();
        const mqttJobId = mqttData.job_id;

        // Wait for MQTT Stop to finish
        setSystemStatus('Gateway is working...', 'warn');
        const mqttStopped = await waitForJob(mqttJobId);

        if (!mqttStopped) {
            throw new Error('MQTT Forwarder could not be stopped');
        }

        setSystemStatus('MQTT stopped. Stopping GPS Reader...', 'warn');

        // Step 2: Stop GPS Reader
        const gpsRes = await fetch(`${CONFIG.API_URL}/api/job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'stop_gps_reader',
                target: CONFIG.GPS_PI_TARGET,
                params: {}
            })
        });

        if (!gpsRes.ok) {
            throw new Error(`GPS Stop failed: HTTP ${gpsRes.status}`);
        }

        const gpsData = await gpsRes.json();
        const gpsJobId = gpsData.job_id;

        // Wait for GPS Stop to finish
        setSystemStatus('GPS Reader stopping...', 'warn');
        const gpsStopped = await waitForJob(gpsJobId);

        if (!gpsStopped) {
            throw new Error('GPS Reader could not be stopped');
        }

        setSystemStatus('System stopped', 'ok');
        btn.disabled = false;
        systemRunning = false;
        updateButtonVisibility();

    } catch (err) {
        console.error('System stop failed:', err);
        setSystemStatus(`Error: ${err.message}`, 'alert');
        btn.disabled = false;
    }
}

// Hilfsfunktion: Warte auf Job-Completion
async function waitForJob(jobId) {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 30; // 30 * 2s = 60s timeout

        const pollTimer = setInterval(async () => {
            attempts++;

            if (attempts > maxAttempts) {
                clearInterval(pollTimer);
                resolve(false);
                return;
            }

            try {
                const res = await fetch(`${CONFIG.API_URL}/api/job/status?job_id=${jobId}`);
                if (!res.ok) {
                    return;
                }

                const data = await res.json();
                const job = data?.job;

                if (!job) {
                    clearInterval(pollTimer);
                    resolve(false);
                    return;
                }

                if (job.status === 'done') {
                    clearInterval(pollTimer);
                    resolve(true);
                    return;
                }

                if (['failed', 'timeout'].includes(job.status)) {
                    clearInterval(pollTimer);
                    resolve(false);
                    return;
                }

            } catch (err) {
                console.error('Job poll error:', err);
            }
        }, CONFIG.JOB_STATUS_POLL_MS);
    });
}

// Parse timestamp (number or string) to epoch ms, or null if invalid
function toMs(ts) {
    if (ts === null || ts === undefined) return null;
    const parsed = typeof ts === 'string' ? parseInt(ts, 10) : ts;
    const date = new Date(parsed);
    return isNaN(date.getTime()) ? null : date.getTime();
}

function ensureMarker(lat, lon, stolenFlag) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const latlng = [lat, lon];
    if (marker) {
        marker.setLatLng(latlng);
        marker.setIcon(createBikeIcon(stolenFlag));
    } else {
        marker = L.marker(latlng, { icon: createBikeIcon(stolenFlag) }).addTo(map);
        map.setView(latlng, 16);
    }
}

// Historie laden
async function loadHistory() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/track?device=${CONFIG.DEVICE_ID}&limit=100`);

        if (!res.ok) return;

        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) return;

        // Neuester Punkt fuer das UI merken
        const latest = data[0];

        // Punkte in chronologischer Reihenfolge fuer den Track
        data.slice().reverse().forEach(p => {
            if (p.lat && p.lon) {
                trackPoints.push([p.lat, p.lon]);
            }
        });

        if (trackPoints.length > 0) {
            trackLine = L.polyline(trackPoints, {
                color: CONFIG.TRACK_COLOR_NORMAL,
                weight: 4,
                opacity: 0.7
            }).addTo(map);

            map.fitBounds(trackLine.getBounds(), { padding: [50, 50] });
        }

        // Fallback: letzten Stand im Panel anzeigen
        if (latest && latest.lat && latest.lon) {
            lastPosition = latest;
            updateUI(latest);

            if (latest.ts) {
                let tsValue = latest.ts;
                if (typeof tsValue === 'string') {
                    tsValue = parseInt(tsValue, 10);
                }
                const tsDate = new Date(tsValue);
                if (!isNaN(tsDate.getTime())) {
                    const ageMs = Date.now() - tsDate.getTime();
                    const tenMinutesMs = 10 * 60 * 1000;
                    if (ageMs >= 0 && ageMs <= tenMinutesMs) {
                        setOnlineStatus();
                    } else {
                        setOfflineStatus();
                    }
                } else {
                    setOfflineStatus();
                }
            } else {
                setOfflineStatus();
            }
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

// App starten
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadHistory();
    updatePosition();

    // Initial button visibility
    updateButtonVisibility();

    // Default system status
    setSystemStatus('System idle', 'muted');

    // Regelmaessige Updates
    setInterval(updatePosition, CONFIG.UPDATE_INTERVAL);
});
