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
from paho.mqtt import client as mqtt

# Lokaler Broker (Gateway)
LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = 1883
LOCAL_TOPIC = "gateway/#"
# Zusätzliches Topic vom GPS-Sender (legacy)
EXTRA_TOPIC = "gps"

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

aws_client = None
last_forward = {}  # remote_topic -> timestamp der letzten Weiterleitung


def on_local_connect(client, userdata, flags, rc):
    print("Local connected:", rc)
    client.subscribe(LOCAL_TOPIC)
    client.subscribe(EXTRA_TOPIC)


def on_local_message(client, userdata, msg):
    global aws_client, last_forward

    topic = msg.topic
    payload = msg.payload

    # Topic umbiegen: gateway/... -> sensors/...; gps -> sensors/pi9/gps
    if topic.startswith(REMOTE_PREFIX_IN):
        remote_topic = REMOTE_PREFIX_OUT + topic[len(REMOTE_PREFIX_IN):]
    elif topic == "gps":
        remote_topic = "sensors/pi9/gps"
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
