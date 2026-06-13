# Pi AP + Mosquitto setup (edge split E2)

Turns the Pi into the wireless host for the ESP32 reader: a WPA2 WiFi AP + a local
Mosquitto broker. Keeps the ESP32↔Pi link entirely off the factory network (plan §B).
The Pi still reaches the **cloud** over its existing uplink (ethernet / wlan0) — see the
interface note below.

## Layout

| File | Goes to | Purpose |
|---|---|---|
| `hostapd.conf` | `/etc/hostapd/hostapd.conf` | the WPA2 AP (`mis-edge-ap`) |
| `dnsmasq-edge.conf` | `/etc/dnsmasq.d/edge.conf` | DHCP for AP clients (Pi = 192.168.4.1) |
| `mosquitto-edge.conf` | `/etc/mosquitto/conf.d/edge.conf` | local broker on :1883 |

## Steps

1. **Dedicated AP interface.** If the Pi uses built-in `wlan0` to reach the cloud, add a
   USB WiFi dongle for the AP (`wlan1`) so the uplink keeps working. Set the AP interface
   to a static `192.168.4.1`. Update `interface=` in `hostapd.conf` + `dnsmasq-edge.conf`
   and `CFG_MQTT_HOST=192.168.4.1` in the ESP32.
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
