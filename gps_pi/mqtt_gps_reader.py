#!/usr/bin/env python3
"""
MQTT GPS Reader for Pi9
Reads GPS data from serial port and publishes to MQTT broker on Gateway Pi.
"""

import time
import serial
import json
from paho.mqtt import client as mqtt

GATEWAY_IP = "172.30.2.50"
GATEWAY_PORT = 1883
TOPIC = "gateway/pi9/gps"

GPS_PORT = "/dev/ttyS0"
GPS_BAUD = 9600


def dm_to_deg(dm, direction):
    if not dm:
        return None
    try:
        if "." not in dm or len(dm) < 4:
            return None
        dot = dm.index(".")
        deg_len = dot - 2
        deg = int(dm[:deg_len])
        minutes = float(dm[deg_len:])
        val = deg + minutes / 60.0
        if direction in ("S", "W"):
            val = -val
        return val
    except Exception as e:
        print("dm_to_deg error:", e, dm, direction)
        return None


def parse_rmc(line):
    parts = line.split(",")
    if len(parts) < 10:
        print("RMC too short:", parts)
        return None

    status = parts[2]
    lat_raw = parts[3]
    lat_dir = parts[4]
    lon_raw = parts[5]
    lon_dir = parts[6]
    speed_raw = parts[7]
    course_raw = parts[8]

    fix = (status == "A")

    lat = dm_to_deg(lat_raw, lat_dir) if fix else None
    lon = dm_to_deg(lon_raw, lon_dir) if fix else None

    try:
        speed_kn = float(speed_raw) if speed_raw else None
    except ValueError:
        speed_kn = None

    try:
        course_deg = float(course_raw) if course_raw else None
    except ValueError:
        course_deg = None

    return {
        "fix": fix,
        "lat": lat,
        "lon": lon,
        "speed_kn": speed_kn,
        "course_deg": course_deg
    }


def main():
    print("Starting GPS Reader...")
    ser = serial.Serial(GPS_PORT, GPS_BAUD, timeout=1)

    client = mqtt.Client(client_id="pi9-gps")
    client.connect(GATEWAY_IP, GATEWAY_PORT, keepalive=60)
    client.loop_start()
    print("MQTT connected to", GATEWAY_IP, GATEWAY_PORT)

    while True:
        raw = ser.readline()
        if not raw:
            continue

        try:
            line = raw.decode("ascii", errors="ignore").strip()
        except Exception as e:
            print("Decode error:", e, raw)
            continue

        if not line:
            continue

        # Log all incoming data (for debugging, can be commented out later)
        print("NMEA:", line)

        # Many modules send $GNRMC instead of $GPRMC
        if line.startswith("$G") and "RMC" in line:
            parsed = parse_rmc(line) or {}

            payload = {
                "device": "pi9",
                "nmea": line,
                "ts": int(time.time() * 1000),
                "fix": parsed.get("fix", False)
            }

            if parsed.get("lat") is not None and parsed.get("lon") is not None:
                payload["lat"] = parsed["lat"]
                payload["lon"] = parsed["lon"]

            if parsed.get("speed_kn") is not None:
                payload["speed_kn"] = parsed["speed_kn"]

            if parsed.get("course_deg") is not None:
                payload["course_deg"] = parsed["course_deg"]

            client.publish(TOPIC, json.dumps(payload), qos=0)
            print("Sent to gateway:", payload)


if __name__ == "__main__":
    main()
