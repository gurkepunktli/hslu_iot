# Bike Tracker IoT Project

GPS-based bike tracking system with theft detection, built with Raspberry Pi, MQTT, AWS IoT, and Cloudflare Workers.

## Project Structure

```
├── backend/          # Cloudflare Worker API (bike-api.dyntech.workers.dev)
├── frontend/         # Web Dashboard (bike.dyntech.workers.dev)
├── gateway/          # Gateway Raspberry Pi scripts
├── gps_pi/           # GPS Raspberry Pi scripts
├── light_pi/         # Light module Raspberry Pi scripts
├── docs/             # Documentation and guides
└── setup/            # Installation scripts for Raspberry Pi
```

## Essential Files

### Backend (Cloudflare Worker)
- `worker.js` - API server handling GPS data, theft status, and job queue
- `wrangler.toml` - Deployment configuration

### Frontend (Web Dashboard)
- `index.html` - Dashboard UI
- `app.js` - Frontend logic (map, tracking, controls)
- `config.js` - API configuration

### Gateway Pi
- `mqtt_forwarder.py` - Forwards MQTT messages to AWS IoT Core
- `job_poller.py` - Executes remote commands from backend
- `requirements.txt` - Python dependencies

### GPS Pi (pi9)
- `GpsTransmitter.py` - Main GPS transmitter with OLED display
- `mqtt_gps_reader.py` - Alternative: Simple GPS reader
- `job_poller.py` - Executes remote commands from backend
- `requirements.txt` - Python dependencies

### Light Pi
- `job_poller.py` - Controls rear light module via systemd
- `requirements.txt` - Python dependencies

## Quick Start

1. **Backend Deployment**: See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
2. **Raspberry Pi Setup**: See setup scripts in `setup/`
3. **Frontend**: Deploy using `wrangler deploy` in frontend/

## Documentation

- **Full Documentation**: [docs/README.md](docs/README.md)
- **Deployment Guide**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Component Guides**:
  - [GPS Pi Setup](docs/gps_pi.md)
  - [Gateway Setup](setup/gateway.md)
  - [Light Module](docs/light_pi.md)

## Features

- Real-time GPS tracking with live map
- Theft detection with Discord notifications
- Remote start/stop control
- Automatic rear light with ambient brightness sensor
- Brake light with accelerometer
- OLED display on GPS module
- 24-hour trip statistics

## Technology Stack

- **Hardware**: Raspberry Pi Zero W, GPS module, OLED display, Light sensors
- **Communication**: MQTT, AWS IoT Core
- **Backend**: Cloudflare Workers, DynamoDB
- **Frontend**: Vanilla JS, Leaflet maps
- **Languages**: Python, JavaScript
