#!/bin/bash
# Setup script for GPS Pi job poller service

echo "=== GPS Pi Job Poller Setup ==="
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
    echo "Please run this script from the gps_pi directory"
    exit 1
fi

# Create systemd service file
echo "Creating systemd service file..."
sudo tee /etc/systemd/system/gps-poller.service > /dev/null <<EOF
[Unit]
Description=GPS Pi Job Poller
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

echo "Service file created at /etc/systemd/system/gps-poller.service"
echo ""

# Reload systemd
echo "Reloading systemd..."
sudo systemctl daemon-reload

# Enable service
echo "Enabling service..."
sudo systemctl enable gps-poller

# Start service
echo "Starting service..."
sudo systemctl start gps-poller

# Wait a moment
sleep 2

# Check status
echo ""
echo "=== Service Status ==="
sudo systemctl status gps-poller --no-pager

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Useful commands:"
echo "  sudo systemctl status gps-poller     # Check status"
echo "  sudo systemctl stop gps-poller       # Stop service"
echo "  sudo systemctl restart gps-poller    # Restart service"
echo "  sudo journalctl -u gps-poller -f    # View logs"
