#!/bin/bash
# Setup script for Gateway job poller service

echo "=== Gateway Job Poller Setup ==="
echo ""

# Get current user and script directory
CURRENT_USER=$(whoami)
CURRENT_HOME=$(eval echo ~$CURRENT_USER)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Current user: $CURRENT_USER"
echo "Home directory: $CURRENT_HOME"
echo "Script directory: $SCRIPT_DIR"
echo ""

# Check if job_poller.py exists in current directory
if [ ! -f "$SCRIPT_DIR/job_poller.py" ]; then
    echo "ERROR: job_poller.py not found at $SCRIPT_DIR/job_poller.py"
    echo "Please run this script from the gateway directory"
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
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/python3 $SCRIPT_DIR/job_poller.py
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
