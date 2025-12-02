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
└── gateway/              # Raspberry Pi gateway code
    ├── job_poller.py     # Job polling daemon
    ├── mqtt_forwarder.py # MQTT → AWS IoT bridge
    ├── gps_reader.py     # GPS reader (placeholder)
    ├── requirements.txt  # Python dependencies
    └── README.md         # Gateway documentation
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

### 3. Gateway Setup (Raspberry Pi)

```bash
cd gateway

# Install dependencies
pip3 install -r requirements.txt

# Configure API URL in job_poller.py
# Start the poller
python3 job_poller.py
```

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

#### `gps_read`
Execute GPS reading script.
```json
{
  "type": "gps_read",
  "target": "gateway",
  "params": {
    "device": "pi9"
  }
}
```

#### `mqtt_forward`
Start MQTT forwarder daemon.
```json
{
  "type": "mqtt_forward",
  "target": "gateway",
  "params": {
    "script_path": "mqtt_forwarder.py"
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

## Gateway Job Poller

The job poller runs continuously on the Raspberry Pi and executes remote commands.

### Starting the Poller

```bash
# Foreground (for testing)
python3 gateway/job_poller.py

# Background
nohup python3 gateway/job_poller.py > gateway.log 2>&1 &

# Systemd service (recommended)
sudo systemctl start gateway-poller
```

### Stopping the Poller

Three methods for graceful shutdown:

1. **CTRL+C**: Press `Ctrl+C` in terminal
2. **Stop File**: `touch /tmp/stop_gateway`
3. **Kill Signal**: `kill -TERM <pid>`

### Job Execution Flow

```
Frontend User
    │
    ├─→ Click "GPS fix anfordern"
    │
    ├─→ POST /api/job (Backend)
    │
    ├─→ Job stored in KV (job_id: abc-123)
    │
    ↓
Gateway Pi
    │
    ├─→ GET /api/job/poll?pi_id=gateway
    │
    ├─→ Receives job object
    │
    ├─→ Executes Python script
    │
    ├─→ POST /api/job/result
    │
    ↓
Frontend
    │
    ├─→ Polling GET /api/job/status
    │
    └─→ Displays "GPS aktualisiert"
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

### GPS Pi
- Raspberry Pi (any model)
- GPS module (UART/Serial)
- Python 3.7+
- Serial port: `/dev/ttyS0`

### Gateway Pi
- Raspberry Pi (any model)
- Network connection
- Python 3.7+
- MQTT broker (Mosquitto)

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

### Gateway Issues

**Job poller not receiving jobs:**
```bash
# Check API connectivity
curl "https://bike-api.your-account.workers.dev/api/job/poll?pi_id=gateway"

# Check logs
tail -f gateway.log
```

**MQTT forwarder fails:**
```bash
# Verify certificates
ls -l /etc/mosquitto/certs/

# Test local MQTT broker
mosquitto_sub -h 127.0.0.1 -t "gateway/#"

# Test AWS IoT connection
openssl s_client -connect a217mym6eh7534-ats.iot.eu-central-1.amazonaws.com:8883 \
  -cert /etc/mosquitto/certs/iot_gateway.cert.pem \
  -key /etc/mosquitto/certs/iot_gateway.private.key
```

### Frontend Issues

**Map not loading:**
- Check browser console for errors
- Verify API_URL in `config.js`
- Check CORS headers in backend

**Jobs not updating:**
- Check job polling interval (2 seconds default)
- Verify gateway is running and polling
- Check job status API response

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
