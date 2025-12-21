# GPS Pi (pi9) - Job Poller

This directory contains the GPS Pi code that polls the backend for jobs and controls the GPS reader.

## Files

- `job_poller.py` - Main polling script for GPS Pi
- `mqtt_gps_reader.py` - Simple GPS reader (deprecated, see note below)
- `GpsTransmitter.py` - OLED-enabled GPS sender (publishes always with fix true/false)
- `requirements.txt` - Python dependencies

**Note:** The actual GPS reader used in production is `/home/iotlabpi4/programs/project/GpsTransmitter.py` on the Pi, which includes:
- OLED display and button support for lockmode
- Subscribes to `bike/light` topic to adjust display brightness based on ambient light
- Sends GPS data with `long` instead of `lon` field
- Includes `brightness` field (received from Light Pi) in GPS payload

## Setup on GPS Pi

### 1. Copy Files to Pi

```bash
# From your computer
scp -r gps_pi/ pi@<gps-pi-ip>:~/
```

### 2. Install Dependencies

```bash
ssh pi@<gps-pi-ip>
cd ~/gps_pi
pip3 install -r requirements.txt
```

### 3. Configure Settings

Check `job_poller.py`:
```python
API_URL = "https://bike-api.dyntech.workers.dev"
PI_ID = "pi9"
POLL_INTERVAL = 5
```

Check `mqtt_gps_reader.py` (legacy) or `GpsTransmitter.py` (OLED):
```python
MQTT_HOST = "172.30.2.50"
MQTT_PORT = 1883
MQTT_TOPIC = "gateway/pi9/gps"  # expected by gateway forwarder
DEVICE_ID = "pi9"

GPS_PORT = "/dev/ttyS0"  # Adjust if needed
GPS_BAUD = 9600
```

### 4. Start Job Poller

```bash
# Foreground (for testing)
python3 job_poller.py

# Background
nohup python3 job_poller.py > gps_poller.log 2>&1 &
```

## How It Works

1. User clicks "Start GPS Reader (Pi9)" button in web UI
2. Backend creates job with `type: "start_gps_reader"` and `target: "pi9"`
3. GPS Pi job_poller polls `/api/job/poll?pi_id=pi9`
4. Receives job and starts `mqtt_gps_reader.py` in background
5. GPS reader reads from serial port and publishes to MQTT
6. Job poller reports success back to backend
7. Web UI shows "GPS Reader gestartet"

## Stopping

### Stop Job Poller
```bash
# Method 1: CTRL+C
# Method 2: Stop file
touch /tmp/stop_gps_pi

# Method 3: Kill signal
pkill -TERM -f "job_poller.py"
```

### Stop GPS Reader
```bash
pkill -f "mqtt_gps_reader.py"
pkill -f "GpsTransmitter.py"
```

## Systemd Services

### GPS Reader Service

The systemd service `/etc/systemd/system/gps-reader.service` should point to the production GPS script:

```ini
[Unit]
Description=GPS Reader Service for Pi9
After=network.target

[Service]
Type=simple
User=iotlabpi4
WorkingDirectory=/home/iotlabpi4/programs/project
ExecStart=/usr/bin/python3 /home/iotlabpi4/programs/project/GpsTransmitter.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Job Poller Service (Optional)

Create `/etc/systemd/system/gps-poller.service`:

```ini
[Unit]
Description=GPS Pi Job Poller
After=network.target

[Service]
Type=simple
User=iotlabpi4
WorkingDirectory=/home/iotlabpi4/gps_pi
ExecStart=/usr/bin/python3 /home/iotlabpi4/gps_pi/job_poller.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gps-poller gps-reader
sudo systemctl start gps-poller gps-reader
```

## Troubleshooting

**Job poller not receiving jobs:**
```bash
# Test API connection
curl "https://bike-api.dyntech.workers.dev/api/job/poll?pi_id=pi9"
```

**GPS reader fails:**
```bash
# Check serial port
ls -l /dev/ttyS0

# Test GPS output
cat /dev/ttyS0
```

**MQTT not connecting:**
```bash
# Test MQTT broker on gateway
mosquitto_pub -h 172.30.2.50 -t "test" -m "hello"
```
