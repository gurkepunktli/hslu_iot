#!/usr/bin/env python3
"""
GPS Reader Script
Reads GPS coordinates and uploads them to the backend.
This is a placeholder - implement actual GPS reading logic here.
"""

import sys
import json
import time
from datetime import datetime

def read_gps(device_id):
    """
    Read GPS coordinates from the device.

    TODO: Implement actual GPS reading logic:
    - Connect to GPS module (e.g., via serial port)
    - Parse NMEA sentences
    - Extract lat/lon coordinates
    - Upload to backend API
    """

    print(f"Reading GPS for device: {device_id}", file=sys.stderr)

    # Placeholder implementation
    # Replace this with actual GPS reading code

    # Example: Read from GPS module
    # import serial
    # gps = serial.Serial('/dev/ttyAMA0', 9600, timeout=1)
    # nmea_sentence = gps.readline()
    # lat, lon = parse_nmea(nmea_sentence)

    # For now, return a success message
    result = {
        "status": "success",
        "device": device_id,
        "timestamp": datetime.now().isoformat(),
        "message": "GPS read completed (placeholder)"
    }

    # Simulate GPS reading delay
    time.sleep(2)

    return json.dumps(result)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: gps_reader.py <device_id>", file=sys.stderr)
        sys.exit(1)

    device_id = sys.argv[1]

    try:
        output = read_gps(device_id)
        print(output)
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
