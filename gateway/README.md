# Raspberry Pi Gateway Job Poller

This directory contains the Raspberry Pi gateway code that polls the backend for jobs and executes them.

## Files

- `job_poller.py` - Main polling script that runs continuously
- `gps_reader.py` - GPS reading script (placeholder - needs implementation)
- `mqtt_forwarder.py` - MQTT forwarder that bridges local broker to AWS IoT Core
- `requirements.txt` - Python dependencies

## Setup on Raspberry Pi

### 1. Install Dependencies

```bash
pip3 install -r requirements.txt
```

### 2. Configure API URL

Edit `job_poller.py` and set the correct API URL:

```python
API_URL = "https://bike-api.dyntech.workers.dev"
PI_ID = "gateway"  # Should match the target in frontend config
POLL_INTERVAL = 5  # seconds between polls
```

### 3. Run the Poller

```bash
# Run in foreground (for testing)
python3 job_poller.py

# Run in background
nohup python3 job_poller.py > gateway.log 2>&1 &
```

## Stopping the Poller

There are **3 ways** to stop the poller gracefully:

### Method 1: CTRL+C
Press `CTRL+C` in the terminal (if running in foreground)

### Method 2: Stop File
Create a stop file:
```bash
touch /tmp/stop_gateway
```
The poller will detect this file and shut down within 1 second.

### Method 3: Kill Signal
Send SIGTERM signal:
```bash
# Find process ID
ps aux | grep job_poller.py

# Send SIGTERM
kill -TERM <pid>

# Or use pkill
pkill -TERM -f job_poller.py
```

## Run as Systemd Service (Recommended)

Create a systemd service file for automatic startup:

### 1. Create Service File

```bash
sudo nano /etc/systemd/system/gateway-poller.service
```

### 2. Add Service Configuration

```ini
[Unit]
Description=Gateway Job Poller
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/gateway
ExecStart=/usr/bin/python3 /home/pi/gateway/job_poller.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 3. Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable gateway-poller

# Start service now
sudo systemctl start gateway-poller

# Check status
sudo systemctl status gateway-poller

# View logs
sudo journalctl -u gateway-poller -f
```

### 4. Control Service

```bash
# Stop service
sudo systemctl stop gateway-poller

# Restart service
sudo systemctl restart gateway-poller

# Disable service
sudo systemctl disable gateway-poller
```

## Supported Job Types

The job poller supports the following job types:

### 1. `gps_read` - Read GPS Position
Executes the `gps_reader.py` script to read GPS coordinates.

**Job parameters:**
```json
{
  "type": "gps_read",
  "params": {
    "device": "pi9"
  }
}
```

### 2. `mqtt_forward` - Start MQTT Forwarder
Starts the `mqtt_forwarder.py` script in the background to forward MQTT messages from local broker to AWS IoT Core.

**Job parameters:**
```json
{
  "type": "mqtt_forward",
  "params": {
    "script_path": "mqtt_forwarder.py"
  }
}
```

The MQTT forwarder:
- Subscribes to `gateway/#` on local broker (127.0.0.1:1883)
- Forwards messages to AWS IoT Core with TLS authentication
- Maps topics: `gateway/*` → `sensors/*`
- Rate limits to 1 message per 10 seconds per topic

**Certificate requirements:**
- `/etc/mosquitto/certs/root-CA.crt`
- `/etc/mosquitto/certs/iot_gateway.cert.pem`
- `/etc/mosquitto/certs/iot_gateway.private.key`

## Implementing GPS Reading

The `gps_reader.py` script is a placeholder. You need to implement actual GPS reading logic:

1. Connect to GPS module (e.g., via serial port `/dev/ttyAMA0`)
2. Parse NMEA sentences
3. Extract latitude/longitude coordinates
4. Upload to backend API (`POST /api/position`)

Example implementation with `pynmea2`:

```python
import serial
import pynmea2
import requests

def read_gps(device_id):
    gps = serial.Serial('/dev/ttyAMA0', 9600, timeout=1)

    while True:
        line = gps.readline().decode('ascii', errors='replace')

        if line.startswith('$GPGGA'):
            msg = pynmea2.parse(line)

            if msg.latitude and msg.longitude:
                # Upload to backend
                requests.post(
                    'https://bike-api.dyntech.workers.dev/api/position',
                    json={
                        'device_id': device_id,
                        'lat': msg.latitude,
                        'lon': msg.longitude,
                        'timestamp': int(time.time())
                    }
                )

                return f"GPS updated: {msg.latitude}, {msg.longitude}"
```

## Logging

The poller logs all events to stdout with timestamps:
```
[2025-12-02 10:30:15] Gateway Job Poller started
[2025-12-02 10:30:20] Received job: abc-123 (type: gps_read)
[2025-12-02 10:30:22] Job abc-123 result reported: done (2000ms)
```

When running as a service, logs are available via:
```bash
sudo journalctl -u gateway-poller -f
```

## Troubleshooting

### Poller not receiving jobs
1. Check API URL is correct
2. Check PI_ID matches frontend config (`GATEWAY_TARGET`)
3. Check network connectivity: `curl https://bike-api.dyntech.workers.dev/api/job/poll?pi_id=gateway`

### GPS reader fails
1. Check GPS module is connected
2. Check serial port permissions: `sudo usermod -a -G dialout pi`
3. Check serial port path: `ls -l /dev/ttyAMA0`
4. Test GPS module: `cat /dev/ttyAMA0` (should show NMEA sentences)

### Stop file not working
1. Check file system permissions for `/tmp`
2. Try alternative location: `/var/tmp/stop_gateway`
3. Update `STOP_FILE` variable in `job_poller.py`
