# Bike Tracker IoT System

A complete IoT bike tracking system with real-time GPS monitoring, theft detection, and remote job execution. Built with Cloudflare Workers, Raspberry Pi, and AWS IoT Core.

![System Architecture](https://img.shields.io/badge/Architecture-Distributed%20IoT-blue)
![Backend](https://img.shields.io/badge/Backend-Cloudflare%20Workers-orange)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-yellow)
![Gateway](https://img.shields.io/badge/Gateway-Raspberry%20Pi-green)

## Features

- **Real-time GPS Tracking**: Live position updates on interactive map
- **Theft Detection**: Mark bike as stolen and track its location
- **Historical Track**: View GPS position history over time
- **Remote Job Execution**: Trigger actions on Raspberry Pi gateway via web interface
- **MQTT Bridge**: Forward sensor data from local broker to AWS IoT Core
- **Distributed Architecture**: Decoupled components for scalability

## System Architecture

```
┌─────────────┐
│  GPS Pi     │ Reads GPS via Serial
│  (pi9)      │ Publishes MQTT → gateway/pi9/gps
└──────┬──────┘
       │ MQTT (local)
       ↓
┌─────────────┐
│ Gateway Pi  │ Polls for jobs every 5s
│             │ Forwards MQTT → AWS IoT
└──────┬──────┘
       │ HTTPS
       ↓
┌─────────────┐
│  Backend    │ Cloudflare Worker
│  (Worker)   │ Job Queue + GPS API
└──────┬──────┘
       │ HTTPS
       ↓
┌─────────────┐
│  Frontend   │ Web Dashboard
│  (Browser)  │ Map + Remote Control
└─────────────┘
```

## Project Structure

```
.
├── backend/              # Cloudflare Worker backend
│   ├── worker.js         # API endpoints (GPS, jobs, status)
│   └── wrangler.toml     # Cloudflare configuration
│
├── frontend/             # Web dashboard
│   ├── index.html        # UI layout
│   ├── app.js            # Application logic
│   └── config.js         # Configuration
│
├── gateway/              # Gateway Pi code
│   ├── job_poller.py     # Job polling daemon (PI_ID: gateway)
│   ├── mqtt_forwarder.py # MQTT → AWS IoT bridge
│   ├── gps_reader.py     # GPS reader (placeholder)
│   ├── setup_service.sh  # Automated systemd setup
│   ├── requirements.txt  # Python dependencies
│   └── README.md         # Gateway documentation
│
└── gps_pi/               # GPS Pi code
    ├── job_poller.py     # Job polling daemon (PI_ID: pi9)
    ├── mqtt_gps_reader.py# GPS MQTT publisher
    ├── setup_service.sh  # Automated systemd setup
    ├── requirements.txt  # Python dependencies
    └── README.md         # GPS Pi documentation
```

## Quick Start

### 1. Backend Deployment (Cloudflare Workers)

```bash
cd backend
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create KV namespaces
wrangler kv:namespace create BIKE_STATUS
wrangler kv:namespace create JOB_QUEUE

# Update wrangler.toml with KV namespace IDs

# Deploy
wrangler deploy

# Set secrets
wrangler secret put AWS_ACCESS_KEY
wrangler secret put AWS_SECRET_KEY
wrangler secret put ADMIN_PIN
```

### 2. Frontend Deployment

```bash
cd frontend

# Update config.js with your Worker URL
# Deploy to any static hosting (Cloudflare Pages, Netlify, etc.)
```

### 3. GPS Pi Setup

```bash
# Copy files to GPS Pi
scp -r gps_pi pi@<gps-pi-ip>:~/

# SSH to GPS Pi
ssh pi@<gps-pi-ip>
cd ~/gps_pi

# Install dependencies
pip3 install -r requirements.txt

# Run automated setup (creates systemd service)
chmod +x setup_service.sh
./setup_service.sh

# Verify service is running
sudo systemctl status gps-poller
```

### 4. Gateway Pi Setup

```bash
# Copy files to Gateway Pi
scp -r gateway pi@172.30.2.50:~/

# SSH to Gateway Pi
ssh pi@172.30.2.50
cd ~/gateway

# Install dependencies
pip3 install -r requirements.txt

# Run automated setup (creates systemd service)
chmod +x setup_service.sh
./setup_service.sh

# Verify service is running
sudo systemctl status gateway-poller
```

### 5. Start System via Web UI

1. Open frontend in browser
2. Click **"Start System (GPS + MQTT)"** button
3. Wait for status: "✓ System läuft (GPS + MQTT)"
4. GPS data should now flow to the map!

## API Documentation

### Backend Endpoints

#### GPS Position

**GET `/api/position`**
- Returns current GPS position
- Response: `{ lat: number, lon: number, timestamp: number }`

**POST `/api/position`**
- Update GPS position
- Body: `{ device_id: string, lat: number, lon: number, timestamp: number }`

#### Theft Status

**GET `/api/stolen`**
- Returns theft status
- Response: `{ stolen: boolean }`

**POST `/api/stolen`**
- Update theft status
- Body: `{ stolen: boolean, pin: string }`

#### Job Queue

**POST `/api/job`**
- Create a new job
- Body: `{ type: string, target: string, params: object }`
- Response: `{ job_id: string }`

**GET `/api/job/poll?pi_id=<id>`**
- Gateway polls for pending jobs
- Response: `{ job: object | null }`

**POST `/api/job/result`**
- Report job completion
- Body: `{ job_id: string, status: string, output: string, duration_ms: number }`

**GET `/api/job/status?job_id=<id>`**
- Check job status
- Response: `{ job: object }`

### Supported Job Types

#### `start_gps_reader`
Start GPS reader on GPS Pi (target: `pi9`).
```json
{
  "type": "start_gps_reader",
  "target": "pi9",
  "params": {
    "device": "pi9"
  }
}
```

**What it does:**
- Starts `mqtt_gps_reader.py` in background
- Reads GPS from `/dev/ttyS0`
- Publishes to MQTT topic `gateway/pi9/gps`

#### `mqtt_forward`
Start MQTT forwarder on Gateway Pi (target: `gateway`).
```json
{
  "type": "mqtt_forward",
  "target": "gateway",
  "params": {
    "script_path": "mqtt_forwarder.py"
  }
}
```

**What it does:**
- Starts `mqtt_forwarder.py` in background
- Subscribes to `gateway/#` on local broker
- Forwards to AWS IoT as `sensors/#`
- Rate limits to 1 msg/10s per topic

#### `gps_read` (deprecated/placeholder)
Legacy GPS read job type.
```json
{
  "type": "gps_read",
  "target": "gateway",
  "params": {
    "device": "pi9"
  }
}
```

## Configuration

### Backend (`backend/wrangler.toml`)

```toml
name = "bike-api"

[vars]
AWS_REGION = "eu-central-1"
DYNAMODB_TABLE = "gpshistory"

kv_namespaces = [
  { binding = "BIKE_STATUS", id = "your-kv-id" },
  { binding = "JOB_QUEUE", id = "your-kv-id" }
]
```

### Frontend (`frontend/config.js`)

```javascript
const CONFIG = {
  API_URL: 'https://bike-api.your-account.workers.dev',
  DEVICE_ID: 'pi9',
  UPDATE_INTERVAL: 3000,
  JOB_STATUS_POLL_MS: 2000,
  GATEWAY_TARGET: 'gateway'
};
```

### Gateway (`gateway/job_poller.py`)

```python
API_URL = "https://bike-api.your-account.workers.dev"
PI_ID = "gateway"
POLL_INTERVAL = 5  # seconds
```

## Job Pollers

Both Raspberry Pis run job poller daemons that listen for remote commands from the backend.

### GPS Pi Job Poller

Listens for jobs with `target: "pi9"`.

```bash
# Status
sudo systemctl status gps-poller

# Logs
sudo journalctl -u gps-poller -f

# Manual start (testing)
python3 ~/gps_pi/job_poller.py
```

**Stop methods:**
1. **CTRL+C**: Press `Ctrl+C` in terminal
2. **Stop File**: `touch /tmp/stop_gps_pi`
3. **Kill Signal**: `kill -TERM <pid>`

### Gateway Pi Job Poller

Listens for jobs with `target: "gateway"`.

```bash
# Status
sudo systemctl status gateway-poller

# Logs
sudo journalctl -u gateway-poller -f

# Manual start (testing)
python3 ~/gateway/job_poller.py
```

**Stop methods:**
1. **CTRL+C**: Press `Ctrl+C` in terminal
2. **Stop File**: `touch /tmp/stop_gateway`
3. **Kill Signal**: `kill -TERM <pid>`

### Job Execution Flow

#### Single Button System Startup

```
Frontend User
    │
    ├─→ Click "Start System (GPS + MQTT)"
    │
    ├─→ POST /api/job (type: start_gps_reader, target: pi9)
    │
    ├─→ Job stored in KV (job_id: abc-123)
    │
    ↓
GPS Pi Poller
    │
    ├─→ GET /api/job/poll?pi_id=pi9
    │
    ├─→ Receives job → Starts mqtt_gps_reader.py
    │
    ├─→ POST /api/job/result (status: done)
    │
    ↓
Frontend
    │
    ├─→ Detects GPS job done
    │
    ├─→ POST /api/job (type: mqtt_forward, target: gateway)
    │
    ↓
Gateway Pi Poller
    │
    ├─→ GET /api/job/poll?pi_id=gateway
    │
    ├─→ Receives job → Starts mqtt_forwarder.py
    │
    ├─→ POST /api/job/result (status: done)
    │
    ↓
Frontend
    │
    └─→ Displays "✓ System läuft (GPS + MQTT)"
```

#### Data Flow After Startup

```
GPS Pi → MQTT (gateway/pi9/gps) → Gateway Pi → AWS IoT (sensors/pi9/gps) → DynamoDB → Backend API → Frontend Map
```

## MQTT Forwarder

Bridges local MQTT broker to AWS IoT Core.

### Features

- Subscribes to `gateway/#` topics on local broker
- Forwards to AWS IoT Core as `sensors/#`
- Rate limiting: 1 message per 10 seconds per topic
- TLS authentication with X.509 certificates

### Certificate Setup

```bash
# Place certificates in /etc/mosquitto/certs/
/etc/mosquitto/certs/root-CA.crt
/etc/mosquitto/certs/iot_gateway.cert.pem
/etc/mosquitto/certs/iot_gateway.private.key
```

### Starting the Forwarder

```bash
# Via job poller (recommended)
# Click "Start MQTT Forwarder" button in web UI

# Manual start
python3 gateway/mqtt_forwarder.py
```

## Development

### Running Locally

**Backend:**
```bash
cd backend
wrangler dev
```

**Frontend:**
```bash
cd frontend
python -m http.server 8000
```

**Gateway (simulation):**
```bash
cd gateway
python3 job_poller.py
```

### Testing Jobs

```bash
# Create a test job
curl -X POST https://bike-api.your-account.workers.dev/api/job \
  -H "Content-Type: application/json" \
  -d '{
    "type": "gps_read",
    "target": "gateway",
    "params": {"device": "pi9"}
  }'

# Check job status
curl "https://bike-api.your-account.workers.dev/api/job/status?job_id=<job_id>"
```

## Hardware Requirements

### GPS Pi (pi9)
- Raspberry Pi Zero W or similar
- GPS module (UART/Serial connected to `/dev/ttyS0`)
- Python 3.7+
- Network connection to Gateway Pi (MQTT)
- **Role**: Read GPS, publish to MQTT

### Gateway Pi (172.30.2.50)
- Raspberry Pi (any model)
- Python 3.7+
- Network connection (LAN/WLAN)
- MQTT broker (Mosquitto) running locally
- AWS IoT certificates in `/etc/mosquitto/certs/`
- **Role**: MQTT bridge to AWS IoT Core

## Security

- **TLS Encryption**: All HTTPS communication
- **X.509 Certificates**: AWS IoT Core authentication
- **Admin PIN**: Required for theft status updates
- **Rate Limiting**: MQTT message throttling
- **Input Validation**: All API endpoints validate inputs

## Environment Variables / Secrets

**Backend (Cloudflare Secrets):**
- `AWS_ACCESS_KEY`: AWS credentials for DynamoDB
- `AWS_SECRET_KEY`: AWS credentials for DynamoDB
- `ADMIN_PIN`: PIN for theft status updates

**Gateway:**
- AWS IoT endpoint in `mqtt_forwarder.py`
- Certificate paths in `/etc/mosquitto/certs/`

## Troubleshooting

### Backend Issues

**Worker not responding:**
```bash
# Check logs
wrangler tail

# Verify KV namespaces
wrangler kv:namespace list
```

### GPS Pi Issues

**Job poller not receiving jobs:**
```bash
# Check service status
sudo systemctl status gps-poller

# Check logs
sudo journalctl -u gps-poller -f

# Test API connectivity
curl "https://bike-api.dyntech.workers.dev/api/job/poll?pi_id=pi9"
```

**GPS not reading:**
```bash
# Check GPS module
cat /dev/ttyS0
# Should show NMEA sentences like $GNRMC,...

# Check if GPS has fix (needs open sky view!)
# Fix indicator in NMEA: $GNRMC,...,A,... (A = valid, V = invalid)
```

**GPS Reader not starting:**
```bash
# Check if script exists
ls -la ~/gps_pi/mqtt_gps_reader.py

# Check dependencies
pip3 list | grep -E "paho-mqtt|pyserial"

# Test manually
python3 ~/gps_pi/mqtt_gps_reader.py
```

### Gateway Pi Issues

**Job poller not receiving jobs:**
```bash
# Check service status
sudo systemctl status gateway-poller

# Check logs
sudo journalctl -u gateway-poller -f

# Test API connectivity
curl "https://bike-api.dyntech.workers.dev/api/job/poll?pi_id=gateway"
```

**MQTT forwarder fails:**
```bash
# Verify certificates
ls -l /etc/mosquitto/certs/
# Should show: root-CA.crt, iot_gateway.cert.pem, iot_gateway.private.key

# Test local MQTT broker
mosquitto_sub -h 127.0.0.1 -t "gateway/#"
# Should show messages from GPS Pi

# Test AWS IoT connection
openssl s_client -connect a217mym6eh7534-ats.iot.eu-central-1.amazonaws.com:8883 \
  -cert /etc/mosquitto/certs/iot_gateway.cert.pem \
  -key /etc/mosquitto/certs/iot_gateway.private.key
# Should connect successfully
```

**MQTT Forwarder not starting:**
```bash
# Check if script exists
ls -la ~/gateway/mqtt_forwarder.py

# Check dependencies
pip3 list | grep paho-mqtt

# Test manually
python3 ~/gateway/mqtt_forwarder.py
```

### Frontend Issues

**Map not loading:**
- Check browser console for errors
- Verify API_URL in `config.js`
- Check CORS headers in backend

**"Start System" button fails:**
- Check both pollers are running:
  - GPS Pi: `sudo systemctl status gps-poller`
  - Gateway Pi: `sudo systemctl status gateway-poller`
- Check job status in browser console (F12)
- Verify targets in `config.js`:
  - `GPS_PI_TARGET: 'pi9'`
  - `GATEWAY_TARGET: 'gateway'`

**System starts but no GPS data on map:**
- Check GPS Pi has valid GPS fix (needs open sky!)
- Check MQTT messages arriving on Gateway:
  ```bash
  mosquitto_sub -h 127.0.0.1 -t "gateway/#" -v
  ```
- Check DynamoDB table has recent entries
- Check backend API returns position:
  ```bash
  curl https://bike-api.dyntech.workers.dev/api/position
  ```

## Performance

- **Backend Latency**: ~50-100ms (Cloudflare Workers)
- **Job Polling**: 5 seconds interval (configurable)
- **GPS Updates**: 3 seconds interval (configurable)
- **MQTT Rate Limit**: 1 message/10 seconds per topic

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is part of an IoT course at HSLU (Hochschule Luzern).

## Acknowledgments

- Cloudflare Workers for serverless backend
- Leaflet.js for map visualization
- paho-mqtt for MQTT client
- AWS IoT Core for MQTT message routing

## Contact

Project Link: [https://github.com/gurkepunktli/hslu_iot](https://github.com/gurkepunktli/hslu_iot)

---

Built with ❤️ for IoT @ HSLU HS25
