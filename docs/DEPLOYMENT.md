# Raspberry Pi Deployment Guide

This guide explains how to deploy and setup the systemd services for GPS reader and MQTT forwarder with automatic restart capabilities.

## Overview

The system uses systemd services to ensure that GPS reader and MQTT forwarder processes automatically restart if they crash. This prevents the "offline after several minutes" issue.

## GPS Pi (pi9) Setup

### 1. Install Python Dependencies

```bash
cd ~/gps_pi
pip3 install paho-mqtt gpsd-py3 requests
```

### 2. Setup Sudoers (Allow systemctl without password)

```bash
cd ~/gps_pi
chmod +x setup_sudoers.sh
./setup_sudoers.sh
```

This allows the pi user to control the gps-reader service without entering a password.

### 3. Setup GPS Reader Service

```bash
cd ~/gps_pi
chmod +x setup_gps_reader_service.sh
./setup_gps_reader_service.sh
```

This creates `/etc/systemd/system/gps-reader.service` with auto-restart enabled.

### 4. Setup Job Poller Service

```bash
cd ~/gps_pi
chmod +x setup_service.sh
./setup_service.sh
```

This creates and starts the `gps-pi-poller.service` that polls for jobs from the backend.

### 5. Verify Services

```bash
# Check job poller status
sudo systemctl status gps-pi-poller

# GPS reader service will be started/stopped via the Web UI
# You can check its status with:
sudo systemctl status gps-reader
```

## Gateway Setup

### 1. Install Python Dependencies

```bash
cd ~/gateway
pip3 install paho-mqtt awscrt awsiot requests
```

### 2. Setup Sudoers (Allow systemctl without password)

```bash
cd ~/gateway
chmod +x setup_sudoers.sh
./setup_sudoers.sh
```

This allows the pi user to control the mqtt-forwarder service without entering a password.

### 3. Setup MQTT Forwarder Service

```bash
cd ~/gateway
chmod +x setup_mqtt_forwarder_service.sh
./setup_mqtt_forwarder_service.sh
```

This creates `/etc/systemd/system/mqtt-forwarder.service` with auto-restart enabled.

### 4. Setup Job Poller Service

```bash
cd ~/gateway
chmod +x setup_service.sh
./setup_service.sh
```

This creates and starts the `gateway-poller.service` that polls for jobs from the backend.

### 5. Verify Services

```bash
# Check job poller status
sudo systemctl status gateway-poller

# MQTT forwarder service will be started/stopped via the Web UI
# You can check its status with:
sudo systemctl status mqtt-forwarder
```

## How It Works

1. **Job Pollers** run as systemd services and automatically start on boot
2. **GPS Reader** and **MQTT Forwarder** are controlled via the Web UI:
   - When you click "Start System" in the Web UI, it sends a job to the respective Pi
   - The job poller executes `sudo systemctl start <service>`
   - The service starts and runs with `Restart=always` configuration
   - If the service crashes, systemd automatically restarts it after 5 seconds
3. **Automatic Recovery**: If GPS reader or MQTT forwarder crash, they restart automatically without manual intervention

## Useful Commands

### GPS Pi

```bash
# View GPS reader logs (live)
sudo journalctl -u gps-reader -f

# View job poller logs
sudo journalctl -u gps-pi-poller -f

# Restart job poller
sudo systemctl restart gps-pi-poller

# Check service status
sudo systemctl status gps-reader
sudo systemctl status gps-pi-poller
```

### Gateway

```bash
# View MQTT forwarder logs (live)
sudo journalctl -u mqtt-forwarder -f

# View job poller logs
sudo journalctl -u gateway-poller -f

# Restart job poller
sudo systemctl restart gateway-poller

# Check service status
sudo systemctl status mqtt-forwarder
sudo systemctl status gateway-poller
```

## Troubleshooting

### Service won't start

1. Check logs: `sudo journalctl -u <service-name> -n 50`
2. Check service file: `sudo systemctl cat <service-name>`
3. Reload systemd: `sudo systemctl daemon-reload`

### Permission denied errors

1. Verify sudoers file: `sudo cat /etc/sudoers.d/gps-pi-services` or `/etc/sudoers.d/gateway-services`
2. Re-run setup_sudoers.sh if needed

### Job poller not receiving jobs

1. Check network connectivity: `ping bike-api.dyntech.workers.dev`
2. Check job poller logs: `sudo journalctl -u gateway-poller -f` or `sudo journalctl -u gps-pi-poller -f`
3. Verify PI_ID in job_poller.py matches the backend configuration

### GPS/MQTT service keeps crashing

1. Check service logs for error messages: `sudo journalctl -u <service> -n 100`
2. Check Python script exists: `ls -l mqtt_gps_reader.py` or `ls -l mqtt_forwarder.py`
3. Verify Python dependencies are installed: `pip3 list`
