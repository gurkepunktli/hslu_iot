# Light Pi - Rear Light Controller

This directory contains the job poller for the rear light module. It listens for jobs from the backend and starts/stops the light service on the light Pi.

## Files
- `job_poller.py` - Polls `/api/job/poll?pi_id=lightpi` and handles `start_light_module` / `stop_light_module` by calling the systemd service `bike-light`.
- `requirements.txt` - Python dependencies for the poller.

## Prerequisites on the Light Pi
- Systemd service `bike-light` that starts your rear light script (the one with TSL2561/MMA8452Q). Example:
  ```ini
  [Unit]
  Description=Bike Rear Light
  After=network.target

  [Service]
  Type=simple
  User=pi
  WorkingDirectory=/home/pi/light
  ExecStart=/usr/bin/python3 /home/pi/light/rear_light.py
  Restart=always
  RestartSec=5
  StandardOutput=journal
  StandardError=journal

  [Install]
  WantedBy=multi-user.target
  ```

## Setup
```bash
sudo apt-get install python3-pip
cd ~/light_pi
pip3 install -r requirements.txt
```

Optional systemd for the poller:
```ini
[Unit]
Description=Light Job Poller
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/light_pi
ExecStart=/usr/bin/python3 /home/pi/light_pi/job_poller.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable light-poller
sudo systemctl start light-poller
```

## How it works
1. Frontend Start-Button: creates job `start_light_module` with `target=lightpi`.
2. `job_poller.py` polls `/api/job/poll?pi_id=lightpi`, receives the job, and runs `systemctl start bike-light`.
3. On Stop, the frontend sends `stop_light_module`, and the poller calls `systemctl stop bike-light`.

