// ============================================
// BIKE TRACKER APP
// ============================================

let map, marker, trackLine;
let isStolen = false;
let lastPosition = null;
const trackPoints = [];
let currentJobId = null;
let jobPollTimer = null;

// Karte initialisieren
function initMap() {
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    });

    const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
            maxZoom: 19,
            attribution: 'Tiles © Esri'
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

        if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
            setOfflineStatus();
            return;
        }

        if (lat === 0 && lon === 0) {
            setNoFixStatus();
            return;
        }

        data.lat = lat;
        data.lon = lon;

        lastPosition = data;
        const latlng = [data.lat, data.lon];
        
        // Marker erstellen oder aktualisieren
        if (marker) {
            marker.setLatLng(latlng);
            marker.setIcon(createBikeIcon(data.stolen));
        } else {
            marker = L.marker(latlng, { icon: createBikeIcon(data.stolen) }).addTo(map);
            map.setView(latlng, 16);
        }
        
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

        // Online/Offline anhand Alter des letzten Signals (10 Minuten)
        if (data.ts) {
            let tsValue = data.ts;
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

    } catch (err) {
        console.error('Update failed:', err);
        setOfflineStatus();
        document.getElementById('loading').classList.add('hidden');
    }
}

// UI mit Daten aktualisieren
function updateUI(data) {
    // Knoten zu km/h umrechnen
    const speedKmh = (data.speed * 1.852).toFixed(1);
    
    document.getElementById('speed').textContent = `${speedKmh} km/h`;
                        document.getElementById('course').textContent = (data.course?.toFixed(0) || 0) + '\u00B0';
    document.getElementById('coords').textContent = `${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`;
    
    // Zeitstempel formatieren
    if (data.ts) {
        const date = new Date(parseInt(data.ts) || data.ts);
        const dateStr = date.toLocaleDateString('de-CH');
        const timeStr = date.toLocaleTimeString('de-CH');
        document.getElementById('lastUpdate').textContent = `${dateStr} ${timeStr}`;
    }
}

// Online-Status setzen
function setOnlineStatus() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.className = 'status-dot';
    if (isStolen) {
        dot.classList.add('stolen');
    }
    text.textContent = isStolen ? 'STOLEN' : 'Online';
}

// Offline-Status setzen
function setOfflineStatus() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.className = 'status-dot offline';
    text.textContent = 'No connection';
}

// Error: No GPS fix available
function setNoFixStatus() {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.className = 'status-dot nofix';
    text.textContent = 'Error: No GPS fix available';
}


// Diebstahl-UI aktualisieren
function updateStolenUI(stolen) {
    isStolen = stolen;

    const banner = document.getElementById('stolenBanner');
    const dot = document.getElementById('statusDot');
    const btn = document.getElementById('btnStolen');
    const text = document.getElementById('statusText');

    if (stolen) {
        banner.classList.add('active');
        dot.classList.add('stolen');
        text.textContent = 'STOLEN';
        btn.className = 'btn-stolen clear';
        btn.textContent = 'Unlock bike';
    } else {
        banner.classList.remove('active');
        dot.classList.remove('stolen');
        text.textContent = 'Online';
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
        
        const data = await res.json();
        
        if (data.error) {
            alert('Error: ' + data.error);
            updateStolenUI(isStolen); // Reset button
            return;
        }
        
        updateStolenUI(data.stolen);
        
        // Marker-Icon aktualisieren
        if (marker) {
            marker.setIcon(createBikeIcon(data.stolen));
        }
        
    } catch (err) {
        console.error('Error:', err);
        alert('Connection error. Please try again.');
        updateStolenUI(isStolen); // Reset button
    }
    
    btn.disabled = false;
}

// Karte auf Fahrrad zentrieren
function centerMap() {
    if (lastPosition) {
        map.setView([lastPosition.lat, lastPosition.lon], 16);
    }
}

// GPS-Job anstossen (Frontend-Button)
async function requestGpsFix() {
    const btn = document.getElementById('btnGps');
    const statusEl = document.getElementById('jobStatus');
    if (!btn || !statusEl) return;

    btn.disabled = true;
    statusEl.textContent = 'Job wird angelegt...';

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'gps_read',
                target: CONFIG.GATEWAY_TARGET,
                params: { device: CONFIG.DEVICE_ID }
            })
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        currentJobId = data.job_id;

        if (!currentJobId) {
            throw new Error('job_id missing');
        }

        statusEl.textContent = 'Warte auf Gateway...';
        jobPollTimer = setInterval(pollJobStatus, CONFIG.JOB_STATUS_POLL_MS);
    } catch (err) {
        console.error('Job start failed:', err);
        statusEl.textContent = 'Fehler beim Job-Start';
        btn.disabled = false;
        currentJobId = null;
        if (jobPollTimer) {
            clearInterval(jobPollTimer);
            jobPollTimer = null;
        }
    }
}

// MQTT Forwarder starten
async function startMqttForwarder() {
    const btn = document.getElementById('btnMqtt');
    const statusEl = document.getElementById('mqttStatus');
    if (!btn || !statusEl) return;

    btn.disabled = true;
    statusEl.textContent = 'Job wird angelegt...';

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/job`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'mqtt_forward',
                target: CONFIG.GATEWAY_TARGET,
                params: { script_path: 'mqtt_forwarder.py' }
            })
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const jobId = data.job_id;

        if (!jobId) {
            throw new Error('job_id missing');
        }

        statusEl.textContent = 'Warte auf Gateway...';

        // Poll status for this specific job
        const pollTimer = setInterval(async () => {
            try {
                const statusRes = await fetch(`${CONFIG.API_URL}/api/job/status?job_id=${jobId}`);
                if (!statusRes.ok) {
                    throw new Error(`HTTP ${statusRes.status}`);
                }
                const statusData = await statusRes.json();
                const job = statusData?.job;

                if (!job) {
                    statusEl.textContent = 'Job nicht gefunden';
                    clearInterval(pollTimer);
                    btn.disabled = false;
                    return;
                }

                if (job.status === 'done') {
                    statusEl.textContent = 'MQTT Forwarder gestartet';
                    clearInterval(pollTimer);
                    btn.disabled = false;
                    return;
                }

                if (['failed', 'timeout'].includes(job.status)) {
                    statusEl.textContent = `Fehler: ${job.status}`;
                    clearInterval(pollTimer);
                    btn.disabled = false;
                    return;
                }

                statusEl.textContent = 'Gateway arbeitet...';
            } catch (err) {
                console.error('Status poll failed:', err);
                statusEl.textContent = 'Status-Check fehlgeschlagen';
                clearInterval(pollTimer);
                btn.disabled = false;
            }
        }, CONFIG.JOB_STATUS_POLL_MS);

    } catch (err) {
        console.error('MQTT job start failed:', err);
        statusEl.textContent = 'Fehler beim Job-Start';
        btn.disabled = false;
    }
}

// Job-Status pollen
async function pollJobStatus() {
    if (!currentJobId) return;
    const statusEl = document.getElementById('jobStatus');
    const btn = document.getElementById('btnGps');
    if (!statusEl || !btn) return;

    try {
        const res = await fetch(`${CONFIG.API_URL}/api/job/status?job_id=${currentJobId}`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        const job = data?.job;

        if (!job) {
            statusEl.textContent = 'Job nicht gefunden';
            clearInterval(jobPollTimer);
            jobPollTimer = null;
            btn.disabled = false;
            currentJobId = null;
            return;
        }

        if (job.status === 'queued') {
            statusEl.textContent = 'Gateway arbeitet...';
            return;
        }

        if (job.status === 'done') {
            statusEl.textContent = 'GPS aktualisiert';
            clearInterval(jobPollTimer);
            jobPollTimer = null;
            btn.disabled = false;
            currentJobId = null;
            updatePosition(); // frische Position vom Backend holen
            return;
        }

        if (['failed', 'timeout'].includes(job.status)) {
            statusEl.textContent = `Job: ${job.status}`;
            clearInterval(jobPollTimer);
            jobPollTimer = null;
            btn.disabled = false;
            currentJobId = null;
            return;
        }
    } catch (err) {
        console.error('Status poll failed:', err);
        statusEl.textContent = 'Status-Check fehlgeschlagen';
        clearInterval(jobPollTimer);
        jobPollTimer = null;
        btn.disabled = false;
        currentJobId = null;
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

            // Online/Offline anhand Alter des Signals
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
    
    // Regelmässige Updates
    setInterval(updatePosition, CONFIG.UPDATE_INTERVAL);
});










