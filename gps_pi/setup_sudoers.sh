#!/bin/bash
# Setup sudoers for GPS Pi to allow systemctl commands without password

echo "=== Setting up sudoers for GPS Pi ==="
echo ""

CURRENT_USER=$(whoami)

echo "Current user: $CURRENT_USER"
echo ""

# Create sudoers file for gps-reader service control
echo "Creating sudoers configuration..."
sudo tee /etc/sudoers.d/gps-pi-services > /dev/null <<EOF
# Allow $CURRENT_USER to control gps-reader service without password
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl start gps-reader
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl stop gps-reader
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart gps-reader
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl status gps-reader
EOF

# Set correct permissions
sudo chmod 0440 /etc/sudoers.d/gps-pi-services

# Validate sudoers file
echo "Validating sudoers configuration..."
if sudo visudo -c -f /etc/sudoers.d/gps-pi-services; then
    echo ""
    echo "=== Setup Complete ==="
    echo "User $CURRENT_USER can now control gps-reader service without password"
else
    echo ""
    echo "ERROR: Sudoers configuration is invalid!"
    sudo rm /etc/sudoers.d/gps-pi-services
    exit 1
fi
