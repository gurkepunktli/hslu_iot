#!/bin/bash
# Setup script for GPS Reader systemd service with auto-restart

echo "=== GPS Reader Service Setup ==="
echo ""

# Get current user and script directory
CURRENT_USER=$(whoami)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Current user: $CURRENT_USER"
echo "Script directory: $SCRIPT_DIR"
echo ""

# Check if mqtt_gps_reader.py exists
if [ ! -f "$SCRIPT_DIR/mqtt_gps_reader.py" ]; then
    echo "ERROR: mqtt_gps_reader.py not found at $SCRIPT_DIR/mqtt_gps_reader.py"
    exit 1
fi

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/gps-reader.service > /dev/null <<EOF
[Unit]
Description=GPS Reader - MQTT Publisher
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/python3 $SCRIPT_DIR/mqtt_gps_reader.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Restart on failure
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "Service file created at /etc/systemd/system/gps-reader.service"
echo ""

# Reload systemd
echo "Reloading systemd..."
sudo systemctl daemon-reload

# Enable service (auto-start on boot)
echo "Enabling service..."
sudo systemctl enable gps-reader

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The GPS Reader service is now configured but NOT started."
echo "It will be started/stopped via the job poller when you use the Web UI."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status gps-reader      # Check status"
echo "  sudo systemctl start gps-reader       # Start manually"
echo "  sudo systemctl stop gps-reader        # Stop manually"
echo "  sudo systemctl restart gps-reader     # Restart"
echo "  sudo journalctl -u gps-reader -f     # View logs (live)"
echo "  sudo journalctl -u gps-reader -n 50  # View last 50 log lines"
echo ""
