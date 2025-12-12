#!/usr/bin/env python3
"""
GPS transmitter for Pi9
- Liest GPS von /dev/ttyS0
- Zeigt Status auf dem OLED
- Publisht GPS-Daten via MQTT an das Gateway (Topic gateway/pi9/gps)
- Sendet immer einen Datensatz (mit fix=true/false), damit das UI auch bei No-Fix aktualisiert
"""

import json
import math
import threading
import time

import busio
import digitalio
import paho.mqtt.client as mqtt
import pynmea2
import requests
import RPi.GPIO as GPIO
import serial
from PIL import Image, ImageDraw, ImageFont
from board import D24, D25, D26, MOSI, SCK
import adafruit_ssd1306

# ---- CONFIG ----
BUTTON_PIN = 4
GPS_PORT = "/dev/ttyS0"
BAUD = 9600
STATUS_API = "https://bike-api.dyntech.workers.dev/api/status?device=pi9"
STATUS_CHECK_INTERVAL = 10  # seconds between API checks

MQTT_HOST = "172.30.2.50"
MQTT_PORT = 1883
MQTT_TOPIC = "gateway/pi9/gps"  # Topic, das der Forwarder nach AWS weiterleitet
DEVICE_ID = "pi9"

# ---- Display brightness state (shared between threads) ----
display_state = {"contrast": 255, "lock": threading.Lock()}


# ---- MQTT Callbacks ----
def on_connect(client, userdata, flags, reason_code, properties):
    """Subscribe to light topic when connected"""
    print(f"Connected to MQTT broker with result code {reason_code}")
    client.subscribe("bike/light")


def on_message(client, userdata, msg):
    """Handle incoming brightness messages"""
    try:
        brightness = msg.payload.decode()
        with display_state["lock"]:
            if brightness == "dark":
                display_state["contrast"] = 0  # Low contrast for dark conditions
                print("[MQTT] Brightness: DARK - Setting low contrast")
            elif brightness == "bright":
                display_state["contrast"] = 255  # High contrast for bright conditions
                print("[MQTT] Brightness: BRIGHT - Setting high contrast")
    except Exception as e:
        print(f"Error processing brightness message: {e}")


# ---- MQTT Setup ----
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message
client.connect(MQTT_HOST, MQTT_PORT, 60)
client.loop_start()  # Start background thread for MQTT

# ---- Stolen Status (shared between threads) ----
stolen_status = {"stolen": False, "lock": threading.Lock()}
last_status_check = 0


def fetch_stolen_status():
    """Background thread function to fetch stolen status"""
    try:
        response = requests.get(STATUS_API, timeout=5)
        if response.status_code == 200:
            data = response.json()
            with stolen_status["lock"]:
                stolen_status["stolen"] = data.get("stolen", False)
    except Exception as e:
        print(f"Status check failed: {e}")


# ---- OLED Setup ----
spi = busio.SPI(SCK, MOSI)
display = adafruit_ssd1306.SSD1306_SPI(
    64, 48, spi, dc=digitalio.DigitalInOut(D24), reset=digitalio.DigitalInOut(D25), cs=digitalio.DigitalInOut(D26)
)
font = ImageFont.load_default()

# ---- Button Setup ----
GPIO.setmode(GPIO.BCM)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
lockmode = False
last_press = 0

# ---- GPS Serial ----
ser = serial.Serial(GPS_PORT, BAUD, timeout=1)


# ---- Haversine Distance (meters) ----
def distance(a, b):
    if not a or not b:
        return 0
    lat1, lon1 = a
    lat2, lon2 = b
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(x), math.sqrt(1 - x))


last_pos = None
last_time = None
speed = 0
lat = lon = alt = 0
last_contrast = None  # Track last set contrast to avoid unnecessary updates
fix_state = False

try:
    while True:
        # ---- Check stolen status periodically (non-blocking) ----
        current_time = time.time()
        if current_time - last_status_check > STATUS_CHECK_INTERVAL:
            thread = threading.Thread(target=fetch_stolen_status, daemon=True)
            thread.start()
            last_status_check = current_time

        # ---- Button toggle ----
        if GPIO.input(BUTTON_PIN) == 0 and time.time() - last_press > 0.3:
            lockmode = not lockmode
            last_press = time.time()

        # ---- Read GPS ----
        line = ser.readline().decode(errors="ignore")
        if line.startswith("$GPGGA"):
            print("GPS data: ", line.strip())
            try:
                msg = pynmea2.parse(line)
                fix_state = msg.gps_qual > 0
                lat = msg.latitude or 0
                lon = msg.longitude or 0
                alt = msg.altitude or 0
                pos = (lat, lon)
                t = time.time()
                if last_pos and last_time:
                    d = distance(last_pos, pos)
                    dt = t - last_time
                    speed = (d / dt) * 3.6 if dt else 0  # km/h
                last_pos, last_time = pos, t
            except Exception as e:
                print(f"GPS parse failed: {e}")

        # ---- Get current stolen status (thread-safe) ----
        with stolen_status["lock"]:
            is_stolen = stolen_status["stolen"]

        # ---- Update display contrast if changed ----
        with display_state["lock"]:
            current_contrast = display_state["contrast"]

        if current_contrast != last_contrast:
            display.contrast(current_contrast)
            last_contrast = current_contrast

        # ---- OLED Display ----
        img = Image.new("1", (64, 48))
        draw = ImageDraw.Draw(img)
        if is_stolen:
            draw.text((0, 10), "Tracking", font=font, fill=255)
            draw.text((0, 22), "Bike...", font=font, fill=255)
        elif lockmode:
            draw.text((10, 18), "LOCKED", font=font, fill=255)
        else:
            draw.text((0, 0), f"{speed:.1f} km/h", font=font, fill=255)
        display.image(img)
        display.show()

        # ---- Send to Gateway (immer mit ts + fix) ----
        payload = {
            "device": DEVICE_ID,
            "ts": int(time.time() * 1000),
            "fix": bool(fix_state),
            "lat": lat,
            "long": lon,
            "alt": alt,
            "lockmode": lockmode,
            "nmea": line.strip() if line else "",
        }
        if speed:
            payload["speed_kn"] = speed / 1.852  # optional speed in knots

        try:
            client.publish(MQTT_TOPIC, json.dumps(payload), qos=0)
            print("Published payload: ", payload)
        except Exception as e:
            print("MQTT publish failed:", e)

        time.sleep(1)

except KeyboardInterrupt:
    print("\nStopping...")
finally:
    client.loop_stop()
    client.disconnect()
    GPIO.cleanup()
    ser.close()
