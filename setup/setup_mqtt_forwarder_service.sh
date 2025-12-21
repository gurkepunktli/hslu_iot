#!/bin/bash
# Setup script for MQTT Forwarder systemd service with auto-restart

echo "=== MQTT Forwarder Service Setup ==="
echo ""

# Get current user and script directory
CURRENT_USER=$(whoami)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Current user: $CURRENT_USER"
echo "Script directory: $SCRIPT_DIR"
echo ""

# Check if mqtt_forwarder.py exists
if [ ! -f "$SCRIPT_DIR/mqtt_forwarder.py" ]; then
    echo "ERROR: mqtt_forwarder.py not found at $SCRIPT_DIR/mqtt_forwarder.py"
    exit 1
fi

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/mqtt-forwarder.service > /dev/null <<EOF
[Unit]
Description=MQTT Forwarder - Local to AWS IoT Core Bridge
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/python3 $SCRIPT_DIR/mqtt_forwarder.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "Service file created at /etc/systemd/system/mqtt-forwarder.service"
echo ""

# Reload systemd
echo "Reloading systemd..."
sudo systemctl daemon-reload

# Enable service (auto-start on boot)
echo "Enabling service..."
sudo systemctl enable mqtt-forwarder

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The MQTT Forwarder service is now configured but NOT started."
echo "It will be started/stopped via the job poller when you use the Web UI."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status mqtt-forwarder      # Check status"
echo "  sudo systemctl start mqtt-forwarder       # Start manually"
echo "  sudo systemctl stop mqtt-forwarder        # Stop manually"
echo "  sudo systemctl restart mqtt-forwarder     # Restart"
echo "  sudo journalctl -u mqtt-forwarder -f     # View logs (live)"
echo "  sudo journalctl -u mqtt-forwarder -n 50  # View last 50 log lines"
echo ""
