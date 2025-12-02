#!/bin/bash
# Setup sudoers for Gateway to allow systemctl commands without password

echo "=== Setting up sudoers for Gateway ==="
echo ""

CURRENT_USER=$(whoami)

echo "Current user: $CURRENT_USER"
echo ""

# Create sudoers file for mqtt-forwarder service control
echo "Creating sudoers configuration..."
sudo tee /etc/sudoers.d/gateway-services > /dev/null <<EOF
# Allow $CURRENT_USER to control mqtt-forwarder service without password
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl start mqtt-forwarder
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl stop mqtt-forwarder
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart mqtt-forwarder
$CURRENT_USER ALL=(ALL) NOPASSWD: /bin/systemctl status mqtt-forwarder
EOF

# Set correct permissions
sudo chmod 0440 /etc/sudoers.d/gateway-services

# Validate sudoers file
echo "Validating sudoers configuration..."
if sudo visudo -c -f /etc/sudoers.d/gateway-services; then
    echo ""
    echo "=== Setup Complete ==="
    echo "User $CURRENT_USER can now control mqtt-forwarder service without password"
else
    echo ""
    echo "ERROR: Sudoers configuration is invalid!"
    sudo rm /etc/sudoers.d/gateway-services
    exit 1
fi
