# Pi AP + Mosquitto setup (edge split E2)

Turns the Pi into the wireless host for the ESP32 reader: a WPA2 WiFi AP + a local
Mosquitto broker. Keeps the ESP32↔Pi link entirely off the factory network (plan §B).
The Pi still reaches the **cloud** over its own uplink — see the dual-uplink note below.

## Dual-uplink design (gives the client both ethernet and WiFi)

The **AP lives on the Pi's built-in WiFi (`wlan0`)**, fixed at `192.168.4.1`. The ESP32
always joins this AP, so its `CFG_MQTT_HOST` never changes regardless of how the Pi
reaches the cloud. The **cloud uplink is whatever is plugged in**:

- **Ethernet site** → `eth0`. Rock solid, no extra hardware. (Today's setup.)
- **WiFi-only site** → add a USB WiFi dongle as `wlan1`, a normal STA managed by
  NetworkManager / `wpa_supplicant`. (Single-radio AP+STA on the built-in chip is
  possible but flaky — don't ship it; use the dongle.)

Pin interface names by MAC (built-in vs dongle can swap on boot) via a systemd `.link`
file or udev rule so the built-in radio is always `wlan0`.

## Layout

| File | Goes to | Purpose |
|---|---|---|
| `hostapd.conf` | `/etc/hostapd/hostapd.conf` | the WPA2 AP (`mis-edge-ap`) on `wlan0` |
| `dnsmasq-edge.conf` | `/etc/dnsmasq.d/edge.conf` | DHCP for AP clients (Pi = 192.168.4.1) |
| `mosquitto-edge.conf` | `/etc/mosquitto/conf.d/edge.conf` | local broker on :1883 |

## Steps

1. **AP interface = built-in `wlan0`.** Give it the static address `192.168.4.1`
   (via `dhcpcd.conf` or systemd-networkd) and stop NetworkManager/wpa_supplicant from
   managing it. Keep `eth0` (or a `wlan1` dongle) as the cloud uplink. ESP32 keeps
   `CFG_MQTT_HOST=192.168.4.1`.
2. `sudo apt install hostapd dnsmasq mosquitto`
3. Drop the three files into place; set a real `wpa_passphrase` (mirror it into the ESP32
   `CFG_WIFI_PASS` / NVS `wifiPass`).
4. `sudo systemctl unmask hostapd && sudo systemctl enable --now hostapd dnsmasq mosquitto`
5. **Apply the inbound dedup schema:** `sudo mariadb edge_outbox < scripts/edge/edge_inbound.sql`
6. Build the Node-RED input adapter + clock responder — see
   `edge/nodered-snippets/README.md`.
7. Power the ESP32; confirm it associates (`iw dev wlan1 station dump`) and that
   `mosquitto_sub -t 'mis/edge/#' -v` shows `cycle`/`heartbeat`/`time/req` traffic.

## Security note

`allow_anonymous true` relies on the WPA2 AP as the only boundary — fine for a closed
bench/cabinet link. Switch Mosquitto to a `password_file` before any shared-network use.
