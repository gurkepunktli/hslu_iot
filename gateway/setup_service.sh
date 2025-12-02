#!/bin/bash
# Setup script for Gateway job poller service

echo "=== Gateway Job Poller Setup ==="
echo ""

# Get current user
CURRENT_USER=$(whoami)
CURRENT_HOME=$(eval echo ~$CURRENT_USER)

echo "Current user: $CURRENT_USER"
echo "Home directory: $CURRENT_HOME"
echo ""

# Check if job_poller.py exists
if [ ! -f "$CURRENT_HOME/gateway/job_poller.py" ]; then
    echo "ERROR: job_poller.py not found at $CURRENT_HOME/gateway/job_poller.py"
    echo "Please copy the gateway folder to $CURRENT_HOME first"
    exit 1
fi

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/gateway-poller.service > /dev/null <<EOF
[Unit]
Description=Gateway Job Poller
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$CURRENT_HOME/gateway
ExecStart=/usr/bin/python3 $CURRENT_HOME/gateway/job_poller.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo "Service file created at /etc/systemd/system/gateway-poller.service"
echo ""

# Reload systemd
echo "Reloading systemd..."
sudo systemctl daemon-reload

# Enable service
echo "Enabling service..."
sudo systemctl enable gateway-poller

# Start service
echo "Starting service..."
sudo systemctl start gateway-poller

# Wait a moment
sleep 2

# Check status
echo ""
echo "=== Service Status ==="
sudo systemctl status gateway-poller --no-pager

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Useful commands:"
echo "  sudo systemctl status gateway-poller     # Check status"
echo "  sudo systemctl stop gateway-poller       # Stop service"
echo "  sudo systemctl restart gateway-poller    # Restart service"
echo "  sudo journalctl -u gateway-poller -f    # View logs"
