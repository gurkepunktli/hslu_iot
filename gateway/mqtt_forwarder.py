#!/usr/bin/env python3
"""
MQTT Forwarder for Gateway
Forwards messages from local MQTT broker to AWS IoT Core.

This script runs continuously and forwards MQTT messages from the local
broker (127.0.0.1:1883) to AWS IoT Core with proper TLS authentication.

Topic mapping: gateway/* -> sensors/*
Rate limiting: Max 1 message per 10 seconds per topic
"""

import ssl
import json
import time
import math
import requests
from datetime import datetime
from paho.mqtt import client as mqtt

# Lokaler Broker (Gateway)
LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = 1883
LOCAL_TOPIC = "gateway/#"
# Zusätzliche Topics von GPS und Light Pi (legacy)
GPS_TOPIC = "gps"
LIGHT_TOPIC = "bike/light"

# AWS IoT
AWS_ENDPOINT = "a217mym6eh7534-ats.iot.eu-central-1.amazonaws.com"
AWS_PORT = 8883
CLIENT_ID = "iot_gateway"  # passt zu deiner Policy

CA_PATH = "/etc/mosquitto/certs/root-CA.crt"
CERT_PATH = "/etc/mosquitto/certs/iot_gateway.cert.pem"
KEY_PATH = "/etc/mosquitto/certs/iot_gateway.private.key"

# aus gateway/foo/bar soll sensors/foo/bar werden
REMOTE_PREFIX_IN = "gateway/"
REMOTE_PREFIX_OUT = "sensors/"

# Sekunden zwischen zwei Weiterleitungen pro Topic
MIN_INTERVAL_SEC = 10

# ---- Theft Detection Config ----
THEFT_DISTANCE_THRESHOLD = 10  # meters
DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1446116774998179861/elv96aMUltKQtfLIkTDdmVGzzQXpM3nJAkN193eMmZ5LHFy4FqTHHXzkJxDT3TZTH5Yo"

aws_client = None
last_forward = {}  # remote_topic -> timestamp der letzten Weiterleitung

# ---- Theft Detection State ----
last_locked_position = None  # (lat, lon) when lockmode activated
theft_alert_sent = False  # Prevents multiple alerts per lock cycle


def haversine_distance(pos1, pos2):
    """Calculate distance between two GPS coordinates in meters"""
    if not pos1 or not pos2:
        return 0
    lat1, lon1 = pos1
    lat2, lon2 = pos2
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def send_theft_alert(device_id, current_pos, distance_moved):
    """Send theft alert to Discord webhook"""
    global theft_alert_sent

    if theft_alert_sent:
        return

    lat, lon = current_pos
    google_maps_url = f"https://www.google.com/maps?q={lat},{lon}"

    payload = {
        "content": "🚨 **BIKE THEFT ALERT!**",
        "embeds": [{
            "title": f"🚴 Bike {device_id} moved while locked!",
            "description": f"The bike was moved **{distance_moved:.1f} meters** while in lock mode.",
            "color": 0xFF0000,
            "fields": [
                {
                    "name": "📍 Current Location",
                    "value": f"[{lat:.6f}, {lon:.6f}]({google_maps_url})",
                    "inline": False
                },
                {
                    "name": "📏 Distance Moved",
                    "value": f"{distance_moved:.1f} m",
                    "inline": True
                },
                {
                    "name": "⏰ Timestamp",
                    "value": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "inline": True
                }
            ],
            "thumbnail": {
                "url": "https://em-content.zobj.net/thumbs/120/apple/354/police-car-light_1f6a8.png"
            }
        }]
    }

    try:
        response = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=5)
        if response.status_code == 204:
            print(f"[{datetime.now()}] 🚨 Theft alert sent!")
            theft_alert_sent = True
    except Exception as e:
        print(f"[{datetime.now()}] Webhook error: {e}")


def check_theft(device_id, lat, lon, lockmode, fix):
    """Check if bike has been moved while locked"""
    global last_locked_position, theft_alert_sent

    # Only process valid GPS fixes
    if not fix or lat == 0 or lon == 0:
        return

    current_pos = (lat, lon)

    # Lockmode activated - save position
    if lockmode and last_locked_position is None:
        last_locked_position = current_pos
        theft_alert_sent = False
        print(f"[{datetime.now()}] 🔒 Lock position set")
        return

    # Lockmode deactivated - reset
    if not lockmode and last_locked_position is not None:
        last_locked_position = None
        theft_alert_sent = False
        print(f"[{datetime.now()}] 🔓 Lock released")
        return

    # Check for movement while locked
    if lockmode and last_locked_position:
        distance = haversine_distance(last_locked_position, current_pos)
        if distance > THEFT_DISTANCE_THRESHOLD:
            print(f"[{datetime.now()}] 🚨 THEFT! Moved {distance:.1f}m while locked!")
            send_theft_alert(device_id, current_pos, distance)


def on_local_connect(client, userdata, flags, rc):
    print("Local connected:", rc)
    client.subscribe(LOCAL_TOPIC)
    client.subscribe(GPS_TOPIC)
    client.subscribe(LIGHT_TOPIC)


def on_local_message(client, userdata, msg):
    global aws_client, last_forward

    topic = msg.topic
    payload = msg.payload

    # ---- Theft Detection for GPS messages ----
    if topic == "gps":
        try:
            gps_data = json.loads(payload.decode())
            device_id = gps_data.get("device", "pi9")
            lat = gps_data.get("lat", 0)
            lon = gps_data.get("long", 0)  # Note: GPS Pi uses "long" not "lon"
            lockmode = gps_data.get("lockmode", False)
            fix = gps_data.get("fix", False)

            check_theft(device_id, lat, lon, lockmode, fix)

            # Rename "long" to "lon" for AWS IoT Rule compatibility
            if "long" in gps_data:
                gps_data["lon"] = gps_data.pop("long")
                payload = json.dumps(gps_data).encode()
        except:
            pass  # Ignore parsing errors, continue with forwarding

    # Topic umbiegen:
    # - gateway/... -> sensors/...
    # - gps -> sensors/pi9/gps
    # - bike/light -> sensors/light/brightness
    if topic.startswith(REMOTE_PREFIX_IN):
        remote_topic = REMOTE_PREFIX_OUT + topic[len(REMOTE_PREFIX_IN):]
    elif topic == "gps":
        remote_topic = "sensors/pi9/gps"
    elif topic == "bike/light":
        remote_topic = "sensors/light/brightness"
    else:
        remote_topic = topic  # zur Sicherheit

    now = time.time()
    last_ts = last_forward.get(remote_topic, 0)

    # nur alle 10 s pro Topic weiterleiten
    if now - last_ts < MIN_INTERVAL_SEC:
        # Debug optional
        # print(f"Skipping {remote_topic}, last {now - last_ts:.1f}s ago")
        return

    last_forward[remote_topic] = now

    print(f"Forwarding {topic} -> {remote_topic}")
    aws_client.publish(remote_topic, payload, qos=0)


def connect_aws():
    global aws_client
    aws_client = mqtt.Client(client_id=CLIENT_ID)
    aws_client.tls_set(
        ca_certs=CA_PATH,
        certfile=CERT_PATH,
        keyfile=KEY_PATH,
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT
    )
    aws_client.connect(AWS_ENDPOINT, AWS_PORT, keepalive=60)
    aws_client.loop_start()
    print("Connected to AWS")


def main():
    connect_aws()

    local_client = mqtt.Client(client_id="local-forwarder")
    local_client.on_connect = on_local_connect
    local_client.on_message = on_local_message

    local_client.connect(LOCAL_HOST, LOCAL_PORT, keepalive=60)
    local_client.loop_forever()


if __name__ == "__main__":
    main()
