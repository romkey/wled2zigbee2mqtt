# wled2zigbee2mqtt

Bridge WLED DDP RGB output to Zigbee bulbs controlled by Zigbee2MQTT.

The service listens for DDP packets on UDP port `4048`, treats each Zigbee bulb as one RGB pixel, converts incoming RGB values to Zigbee2MQTT light commands, and publishes those commands over MQTT.

## How It Works

1. WLED sends DDP RGB data to this service.
2. Pixel `0` maps to the first bulb, pixel `1` maps to the second bulb, and so on.
3. The bridge converts each changed RGB pixel to a Zigbee2MQTT payload with `state`, `brightness`, `color.x`, `color.y`, and `transition`.
4. Commands are published to `zigbee2mqtt/<friendly_name>/set`.

Zigbee bulbs are much slower than addressable LEDs, so the bridge throttles frames. The default `FRAME_INTERVAL_MS` is `750`, which is a safer starting point for a large Zigbee network than WLED's native frame rate.

## Quick Start

Create a bulb mapping:

```sh
cp .env.example .env
cp config/bulbs.example.json config/bulbs.json
```

Edit `.env` for your MQTT broker, then edit `config/bulbs.json` so the `friendly_name` values match the device names in Zigbee2MQTT.

Start the bridge:

```sh
docker compose up --build
```

Configure WLED:

- Sync interface: `DDP`
- Target IP: the Docker host running this bridge
- Port: `4048`
- Pixel count: the number of Zigbee bulbs you want to control

## Zigbee2MQTT Discovery

The bridge subscribes to:

```text
zigbee2mqtt/bridge/devices
```

When Zigbee2MQTT publishes its device list, the bridge finds devices that expose light capabilities and writes a generated mapping to:

```text
config/bulbs.generated.json
```

With `AUTO_DISCOVER=true`, the generated mapping is used automatically when `config/bulbs.json` does not exist. For stable ordering, copy `config/bulbs.generated.json` to `config/bulbs.json` and edit the `pixel` values.

## Configuration

All configuration is via environment variables:

- `MQTT_URL`: MQTT broker URL. Defaults to `mqtt://mqtt:1883`.
- `MQTT_USERNAME`: optional MQTT username.
- `MQTT_PASSWORD`: optional MQTT password.
- `MQTT_BASE_TOPIC`: Zigbee2MQTT base topic. Defaults to `zigbee2mqtt`.
- `DDP_HOST`: UDP bind address. Defaults to `0.0.0.0`.
- `DDP_PORT`: UDP DDP listen port. Defaults to `4048`.
- `AUTO_DISCOVER`: use Zigbee2MQTT-discovered lights if no bulb file is present. Defaults to `true`.
- `BULBS_FILE`: explicit bulb mapping file. Defaults to `/config/bulbs.json`.
- `DISCOVERY_OUTPUT`: where discovered bulbs are written. Defaults to `/config/bulbs.generated.json`.
- `FRAME_INTERVAL_MS`: minimum time between Zigbee publish batches. Defaults to `750`.
- `CHANGE_THRESHOLD`: minimum RGB channel change before republishing a bulb. Defaults to `3`.
- `TRANSITION_SECONDS`: Zigbee transition time for light changes. Defaults to `0.5`.
- `TURN_OFF_AT_BLACK`: send `state: OFF` for black pixels. Defaults to `true`.
- `PUBLISH_BATCH_SIZE`: number of MQTT commands published concurrently. Defaults to `25`.
- `PUBLISH_BATCH_DELAY_MS`: delay between publish batches. Defaults to `25`.
- `PUBLISH_RETAIN`: retain MQTT light command messages. Defaults to `false`.

## Bulb Mapping Format

`config/bulbs.json` can contain objects:

```json
[
  { "friendly_name": "Living Room Lamp", "pixel": 0 },
  { "friendly_name": "Kitchen Lamp", "pixel": 1 }
]
```

It can also contain strings. In that case, pixels are assigned in array order:

```json
[
  "Living Room Lamp",
  "Kitchen Lamp"
]
```

## Notes

- Zigbee is not designed for high frame rate animation. Start with slow WLED effects and a larger `FRAME_INTERVAL_MS`, then tune downward carefully.
- Color support depends on the bulbs. Devices without color support may accept brightness and state but ignore `color`.
- If your MQTT broker is not named `mqtt` on the Compose network, update `MQTT_URL` in `compose.yaml`.
