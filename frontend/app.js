// ============================================
// BIKE TRACKER APP
// ============================================

let map, marker, trackLine;
let isStolen = false;
let lastPosition = null;
let lastGpsFix = null; // Last valid GPS fix with coordinates
let systemRunning = false; // Track if system (GPS + MQTT) is running
let currentStatus = 'unknown'; // Track status badge state
let updateTimer = null; // Timer for update countdown animation
const trackPoints = [];
const historyMarkers = []; // Markers for last 10 GPS fixes
const maxHistoryMarkers = 10;

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

// Create small circular marker for history points
function createHistoryMarker(lat, lon, timestamp) {
    const date = new Date(typeof timestamp === 'string' ? parseInt(timestamp) : timestamp);
    const dateStr = date.toLocaleDateString('en-GB');
    const timeStr = date.toLocaleTimeString('en-GB');

    const circleMarker = L.circleMarker([lat, lon], {
        radius: 7,
        fillColor: '#3b82f6',
        color: '#fff',
        weight: 2.5,
        opacity: 1,
        fillOpacity: 0.9,
        interactive: true,
        pane: 'markerPane' // Draw above other layers
    });

    circleMarker.bindPopup(`
        <div style="font-family: 'Inter', sans-serif; font-size: 13px; padding: 4px;">
            <strong style="font-size: 14px; color: #0f172a;">GPS Fix</strong><br/>
            <span style="color: #64748b;">Date:</span> <strong>${dateStr}</strong><br/>
            <span style="color: #64748b;">Time:</span> <strong>${timeStr}</strong><br/>
            <span style="color: #64748b;">Coordinates:</span><br/>
            <strong>${lat.toFixed(6)}, ${lon.toFixed(6)}</strong>
        </div>
    `, {
        closeButton: true,
        autoClose: true,
        closeOnClick: false
    });

    return circleMarker;
}

// Add a history marker to the map and maintain max count
function addHistoryMarker(lat, lon, timestamp) {
    // Remove oldest marker if we exceed the limit
    if (historyMarkers.length >= maxHistoryMarkers) {
        const oldest = historyMarkers.shift();
        map.removeLayer(oldest);
    }

    const marker = createHistoryMarker(lat, lon, timestamp);
    marker.addTo(map);
    historyMarkers.push(marker);
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
            setNoFixStatus('No GPS fix available');
            return;
        }

        if (!updateFresh) {
            setOfflineStatus('Signal too old');
            return;
        }

        if (!fixFresh) {
            setNoFixStatus('GPS fix too old');
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

        // Add a history marker for this GPS fix
        addHistoryMarker(data.lat, data.lon, lastFixTs);

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
                opacity: 0.7,
                interactive: false,
                pane: 'overlayPane' // Draw below markers
            }).addTo(map);
        }

        // UI aktualisieren
        updateUI(data);

        // Set status to online since we have fresh data
        setOnlineStatus();

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
    // Don't auto-set systemRunning - user controls this with Start/Stop buttons
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
    // Don't auto-set systemRunning - user controls this with Start/Stop buttons
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
    const liveIndicator = document.getElementById('liveIndicator');
    const badge = document.getElementById('statusBadge');

    if (text) text.textContent = title || '';
    if (sub) sub.textContent = subtitle || '';

    // Update badge background color based on state
    if (badge) {
        badge.className = 'flex items-center justify-between rounded-2xl text-white px-5 py-4 shadow-lg transition-all duration-300';
        badge.classList.add(state || 'connecting');
    }

    if (dot) {
        const liveClass = state === 'online' ? 'live' : '';
        dot.className = `badge-dot ${state || ''} ${liveClass}`.trim();
    }

    // Show pulse ring only when truly online (fresh updates)
    if (liveIndicator) {
        if (state === 'online') {
            liveIndicator.classList.remove('hidden');
        } else {
            liveIndicator.classList.add('hidden');
        }
    }
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

    const base =
        'rounded-xl border-2 px-4 py-2 text-sm font-semibold text-center shadow-sm w-full';
    const styles = {
        ok: 'border-emerald-300 bg-emerald-50 text-emerald-800',
        warn: 'border-amber-300 bg-amber-50 text-amber-800',
        alert: 'border-rose-300 bg-rose-50 text-rose-800',
        muted: 'border-slate-300 bg-white text-slate-700'
    };
    const variant = styles[mode] || styles.muted;
    el.className = `${base} ${variant}`;
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

        // Wait for GPS Reader to finish (30s timeout)
        setSystemStatus('GPS Reader starting... (timeout: 30s)', 'warn');
        const gpsResult = await waitForJob(gpsJobId, 30);

        if (!gpsResult.success) {
            if (gpsResult.error === 'timeout') {
                throw new Error('GPS Pi unreachable or not responding (timeout after 30s)');
            } else {
                throw new Error(`GPS Reader failed: ${gpsResult.message}`);
            }
        }

        setSystemStatus('✓ GPS Reader started. Starting MQTT Forwarder...', 'warn');

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

        // Wait for MQTT Forwarder to finish (30s timeout)
        setSystemStatus('MQTT Forwarder starting... (timeout: 30s)', 'warn');
        const mqttResult = await waitForJob(mqttJobId, 30);

        if (!mqttResult.success) {
            if (mqttResult.error === 'timeout') {
                throw new Error('Gateway unreachable or not responding (timeout after 30s)');
            } else {
                throw new Error(`MQTT Forwarder failed: ${mqttResult.message}`);
            }
        }

        setSystemStatus('✓ System running (GPS + MQTT)', 'ok');
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

        // Wait for MQTT Stop to finish (20s timeout)
        setSystemStatus('Stopping MQTT Forwarder... (timeout: 20s)', 'warn');
        const mqttResult = await waitForJob(mqttJobId, 20);

        if (!mqttResult.success) {
            if (mqttResult.error === 'timeout') {
                throw new Error('Gateway unreachable (timeout after 20s)');
            } else {
                throw new Error(`MQTT stop failed: ${mqttResult.message}`);
            }
        }

        setSystemStatus('✓ MQTT stopped. Stopping GPS Reader...', 'warn');

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

        // Wait for GPS Stop to finish (20s timeout)
        setSystemStatus('Stopping GPS Reader... (timeout: 20s)', 'warn');
        const gpsResult = await waitForJob(gpsJobId, 20);

        if (!gpsResult.success) {
            if (gpsResult.error === 'timeout') {
                throw new Error('GPS Pi unreachable (timeout after 20s)');
            } else {
                throw new Error(`GPS stop failed: ${gpsResult.message}`);
            }
        }

        setSystemStatus('✓ System stopped', 'ok');
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
async function waitForJob(jobId, timeoutSeconds = 30) {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = Math.ceil(timeoutSeconds * 1000 / CONFIG.JOB_STATUS_POLL_MS);

        const pollTimer = setInterval(async () => {
            attempts++;

            if (attempts > maxAttempts) {
                clearInterval(pollTimer);
                console.error(`Job ${jobId} timed out after ${timeoutSeconds}s`);
                resolve({ success: false, error: 'timeout', message: `Operation timed out after ${timeoutSeconds} seconds` });
                return;
            }

            try {
                const res = await fetch(`${CONFIG.API_URL}/api/job/status?job_id=${jobId}`);
                if (!res.ok) {
                    // Network error, keep trying
                    return;
                }

                const data = await res.json();
                const job = data?.job;

                if (!job) {
                    clearInterval(pollTimer);
                    resolve({ success: false, error: 'not_found', message: 'Job not found' });
                    return;
                }

                if (job.status === 'done') {
                    clearInterval(pollTimer);
                    resolve({ success: true, output: job.output });
                    return;
                }

                if (job.status === 'failed') {
                    clearInterval(pollTimer);
                    resolve({ success: false, error: 'failed', message: job.output || 'Job failed' });
                    return;
                }

                if (job.status === 'timeout') {
                    clearInterval(pollTimer);
                    resolve({ success: false, error: 'job_timeout', message: 'Job execution timed out on device' });
                    return;
                }

            } catch (err) {
                console.error('Job poll error:', err);
                // Network error, keep trying until maxAttempts
            }
        }, CONFIG.JOB_STATUS_POLL_MS);
    });
}

// Parse timestamp (number or string) to epoch ms, or null if invalid
function toMs(ts) {
    if (ts === null || ts === undefined) return null;
    const parsed = typeof ts === 'string' ? parseInt(ts, 10) : ts;
    // Timestamp is already in milliseconds, return directly
    return isNaN(parsed) ? null : parsed;
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
        const limit = CONFIG.HISTORY_LIMIT || 500;
        const res = await fetch(`${CONFIG.API_URL}/api/track?device=${CONFIG.DEVICE_ID}&limit=${limit}`);

        if (!res.ok) return;

        const dataRaw = await res.json();
        const data = Array.isArray(dataRaw) ? dataRaw.map(normalizePoint) : [];

        if (!Array.isArray(data) || data.length === 0) return;

        // Remember newest point for UI (may be invalid)
        const latest = data[0];
        // Last valid fix (may be older)
        const latestValidFix = findLatestValidFix(data);

        // Get last 10 valid fixes for history markers
        const last10ValidFixes = data.filter(p => isValidFix(p)).slice(0, maxHistoryMarkers);

        // Add history markers for last 10 fixes (newest first)
        last10ValidFixes.forEach(p => {
            addHistoryMarker(p.lat, p.lon, p.ts);
        });

        // Points in chronological order for the track
        data.slice().reverse().forEach(p => {
            if (isValidFix(p)) {
                trackPoints.push([p.lat, p.lon]);
            }
        });

        if (trackPoints.length > 0) {
            trackLine = L.polyline(trackPoints, {
                color: CONFIG.TRACK_COLOR_NORMAL,
                weight: 4,
                opacity: 0.7,
                interactive: false,
                pane: 'overlayPane' // Draw below markers
            }).addTo(map);

            map.fitBounds(trackLine.getBounds(), { padding: [50, 50] });
        }

        // Fallback: show last state in panel (prefer valid fix)
        const displayPoint = latestValidFix || (isValidFix(latest) ? latest : null);
        if (displayPoint) {
            lastPosition = displayPoint;
            lastGpsFix = displayPoint;
            updateUI(displayPoint);
            updateLastFixTimestamp(displayPoint.ts);
            ensureMarker(displayPoint.lat, displayPoint.lon, displayPoint.stolen);

            const tsCandidate = displayPoint.ts || latest?.ts;
            if (tsCandidate) {
                let tsValue = tsCandidate;
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

// Update countdown animation
function startUpdateCountdown() {
    const progressCircle = document.getElementById('updateProgress');
    if (!progressCircle) return;

    const circumference = 2 * Math.PI * 10; // radius = 10
    const duration = CONFIG.UPDATE_INTERVAL;
    const steps = 30; // 30 steps for smooth animation
    const stepDuration = duration / steps;
    let currentStep = 0;

    // Reset to full
    progressCircle.style.strokeDashoffset = '0';

    if (updateTimer) clearInterval(updateTimer);

    updateTimer = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const offset = circumference * progress;
        progressCircle.style.strokeDashoffset = `${offset}`;

        if (currentStep >= steps) {
            currentStep = 0;
            progressCircle.style.strokeDashoffset = '0';
        }
    }, stepDuration);
}

// Check if system is running based on fresh GPS data
async function checkSystemStatus() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/position?device=${CONFIG.DEVICE_ID}`);
        if (!res.ok) return;

        const data = await res.json();
        const lastUpdateTs = data.last_update_ts || data.ts;

        if (lastUpdateTs) {
            const now = Date.now();
            const lastUpdateMs = typeof lastUpdateTs === 'string' ? parseInt(lastUpdateTs, 10) : lastUpdateTs;
            const ageSeconds = (now - lastUpdateMs) / 1000;

            // If last update is less than 30 seconds old, system is likely running
            if (ageSeconds < 30) {
                systemRunning = true;
                updateButtonVisibility();
                setSystemStatus('✓ System running (GPS + MQTT)', 'ok');
            }
        }
    } catch (err) {
        console.error('Failed to check system status:', err);
    }
}

// App starten
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadHistory();
    updatePosition();

    // Check if system is already running
    checkSystemStatus();

    // Initial button visibility
    updateButtonVisibility();

    // Default system status
    setSystemStatus('System idle', 'muted');

    // Start update countdown animation
    startUpdateCountdown();

    // Regular updates
    setInterval(() => {
        updatePosition();
        startUpdateCountdown(); // Restart countdown on each update
    }, CONFIG.UPDATE_INTERVAL);
});

// Normalize coordinates/numbers from API
function normalizePoint(p) {
    if (!p || typeof p !== 'object') return {};
    const lat = p.lat != null ? parseFloat(p.lat) : NaN;
    const lon = p.lon != null ? parseFloat(p.lon) : NaN;
    const speed = p.speed != null ? parseFloat(p.speed) : p.speed_kn != null ? parseFloat(p.speed_kn) : 0;
    const course = p.course != null ? parseFloat(p.course) : p.course_deg != null ? parseFloat(p.course_deg) : 0;
    return { ...p, lat, lon, speed, course };
}

function isValidFix(p) {
    return Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && !(p.lat === 0 && p.lon === 0);
}

function findLatestValidFix(list) {
    if (!Array.isArray(list)) return null;
    for (const p of list) {
        if (isValidFix(p)) return p;
    }
    return null;
}
