"use strict";

const dgram = require("node:dgram");
const fs = require("node:fs");
const path = require("node:path");
const mqtt = require("mqtt");
const { applyDdpPacket, parseDdpPacket, readRgbAtPixel } = require("./ddp");
const { colorChanged, rgbToXyBrightness } = require("./color");

function envString(name, fallback) {
  return process.env[name] || fallback;
}

function normalizeMqttUrl(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "mqtt://mqtt:1883";
  }

  if (!trimmed.includes("://")) {
    return `mqtt://${trimmed}`;
  }

  return trimmed;
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadConfig() {
  return {
    autoDiscover: envBoolean("AUTO_DISCOVER", true),
    bulbsFile: envString("BULBS_FILE", "/config/bulbs.json"),
    changeThreshold: envNumber("CHANGE_THRESHOLD", 3),
    ddpHost: envString("DDP_HOST", "0.0.0.0"),
    ddpPort: envNumber("DDP_PORT", 4048),
    discoveryOutput: envString("DISCOVERY_OUTPUT", "/config/bulbs.generated.json"),
    frameIntervalMs: envNumber("FRAME_INTERVAL_MS", 750),
    mqttBaseTopic: envString("MQTT_BASE_TOPIC", "zigbee2mqtt").replace(/\/$/, ""),
    mqttPassword: process.env.MQTT_PASSWORD,
    mqttUrl: normalizeMqttUrl(envString("MQTT_URL", "mqtt://mqtt:1883")),
    mqttUsername: process.env.MQTT_USERNAME,
    publishBatchDelayMs: envNumber("PUBLISH_BATCH_DELAY_MS", 25),
    publishBatchSize: envNumber("PUBLISH_BATCH_SIZE", 25),
    publishRetain: envBoolean("PUBLISH_RETAIN", false),
    transitionSeconds: envNumber("TRANSITION_SECONDS", 0.5),
    turnOffAtBlack: envBoolean("TURN_OFF_AT_BLACK", true),
  };
}

function mqttTopic(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== "")
    .map((part) => String(part).replace(/^\/|\/$/g, ""))
    .join("/");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadBulbsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const bulbs = JSON.parse(contents);
  if (!Array.isArray(bulbs)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }

  return normalizeBulbs(bulbs);
}

function normalizeBulbs(bulbs) {
  return bulbs
    .map((bulb, index) => {
      if (typeof bulb === "string") {
        return {
          friendly_name: bulb,
          pixel: index,
        };
      }

      return {
        friendly_name: bulb.friendly_name || bulb.name,
        pixel: Number.isInteger(bulb.pixel) ? bulb.pixel : index,
      };
    })
    .filter((bulb) => bulb.friendly_name);
}

function flattenExposes(exposes) {
  const queue = Array.isArray(exposes) ? [...exposes] : [];
  const flattened = [];

  while (queue.length) {
    const expose = queue.shift();
    if (!expose || typeof expose !== "object") {
      continue;
    }

    flattened.push(expose);

    if (Array.isArray(expose.features)) {
      queue.push(...expose.features);
    }
  }

  return flattened;
}

function looksLikeLight(device) {
  if (!device || device.type === "Coordinator") {
    return false;
  }

  const exposes = flattenExposes(device.definition && device.definition.exposes);
  const properties = new Set(exposes.map((expose) => expose.property).filter(Boolean));

  return (
    exposes.some((expose) => expose.type === "light") ||
    properties.has("color_xy") ||
    properties.has("color_hs") ||
    (properties.has("brightness") && properties.has("state"))
  );
}

function bulbsFromDevices(devices) {
  if (!Array.isArray(devices)) {
    return [];
  }

  return normalizeBulbs(
    devices
      .filter(looksLikeLight)
      .map((device) => device.friendly_name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  );
}

function writeDiscoveryOutput(filePath, bulbs) {
  if (!filePath) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(bulbs, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
}

function commandForRgb(rgb, config) {
  const color = rgbToXyBrightness(rgb);

  if (color.brightness === 0 && config.turnOffAtBlack) {
    return {
      state: "OFF",
      transition: config.transitionSeconds,
    };
  }

  return {
    state: "ON",
    brightness: color.brightness,
    color: {
      x: color.x,
      y: color.y,
    },
    transition: config.transitionSeconds,
  };
}

function createBridge({ config, mqttClient, udpSocket }) {
  let bulbs = [];
  let frameBuffer = null;
  let lastFrameAt = 0;
  let flushTimer = null;
  let flushing = false;
  const lastPublished = new Map();

  function setBulbs(nextBulbs, source) {
    bulbs = normalizeBulbs(nextBulbs);
    console.log(`Loaded ${bulbs.length} bulb mappings from ${source}`);
  }

  async function publishChangedBulbs() {
    if (flushing || !frameBuffer || !bulbs.length || !mqttClient.connected) {
      return;
    }

    flushing = true;

    try {
      const changed = [];

      for (const bulb of bulbs) {
        const rgb = readRgbAtPixel(frameBuffer, bulb.pixel);
        if (!rgb || !colorChanged(lastPublished.get(bulb.friendly_name), rgb, config.changeThreshold)) {
          continue;
        }

        changed.push({ bulb, rgb });
      }

      for (let index = 0; index < changed.length; index += config.publishBatchSize) {
        const batch = changed.slice(index, index + config.publishBatchSize);

        await Promise.all(
          batch.map(({ bulb, rgb }) => {
            const topic = mqttTopic(config.mqttBaseTopic, bulb.friendly_name, "set");
            const payload = JSON.stringify(commandForRgb(rgb, config));

            return mqttClient.publishAsync(topic, payload, {
              qos: 0,
              retain: config.publishRetain,
            }).then(() => {
              lastPublished.set(bulb.friendly_name, rgb);
            });
          }),
        );

        if (index + config.publishBatchSize < changed.length && config.publishBatchDelayMs > 0) {
          await sleep(config.publishBatchDelayMs);
        }
      }
    } catch (error) {
      console.error("Failed to publish light commands:", error);
    } finally {
      lastFrameAt = Date.now();
      flushing = false;
    }
  }

  function scheduleFlush() {
    if (flushTimer) {
      return;
    }

    const elapsed = Date.now() - lastFrameAt;
    const delay = Math.max(config.frameIntervalMs - elapsed, 0);

    flushTimer = setTimeout(() => {
      flushTimer = null;
      publishChangedBulbs();
    }, delay);
  }

  function handleDdpPacket(message) {
    const parsedPacket = parseDdpPacket(message);
    if (!parsedPacket) {
      return;
    }

    frameBuffer = applyDdpPacket(frameBuffer, parsedPacket);
    scheduleFlush();
  }

  function handleMqttMessage(topic, payload) {
    if (topic !== mqttTopic(config.mqttBaseTopic, "bridge", "devices")) {
      return;
    }

    try {
      const discoveredBulbs = bulbsFromDevices(JSON.parse(payload.toString()));
      writeDiscoveryOutput(config.discoveryOutput, discoveredBulbs);

      if (config.autoDiscover) {
        setBulbs(discoveredBulbs, topic);
      }
    } catch (error) {
      console.error(`Failed to process ${topic}:`, error);
    }
  }

  async function start() {
    const configuredBulbs = loadBulbsFile(config.bulbsFile);
    if (configuredBulbs.length) {
      setBulbs(configuredBulbs, config.bulbsFile);
    } else if (!config.autoDiscover) {
      console.warn(`No bulbs loaded. Create ${config.bulbsFile} or enable AUTO_DISCOVER.`);
    }

    mqttClient.on("connect", () => {
      const discoveryTopic = mqttTopic(config.mqttBaseTopic, "bridge", "devices");
      console.log(`Connected to MQTT broker at ${config.mqttUrl}`);
      mqttClient.subscribe(discoveryTopic, { qos: 0 }, (error) => {
        if (error) {
          console.error(`Failed to subscribe to ${discoveryTopic}:`, error);
        } else {
          console.log(`Subscribed to ${discoveryTopic}`);
        }
      });
    });

    mqttClient.on("message", handleMqttMessage);
    mqttClient.on("error", (error) => console.error("MQTT error:", error));
    udpSocket.on("message", handleDdpPacket);
    udpSocket.on("error", (error) => console.error("DDP socket error:", error));

    udpSocket.bind(config.ddpPort, config.ddpHost, () => {
      console.log(`Listening for DDP frames on udp://${config.ddpHost}:${config.ddpPort}`);
    });
  }

  return {
    start,
    setBulbs,
  };
}

function main() {
  const config = loadConfig();
  let mqttClient;

  try {
    mqttClient = mqtt.connect(config.mqttUrl, {
      password: config.mqttPassword,
      username: config.mqttUsername,
    });
  } catch (error) {
    throw new Error(`Invalid MQTT_URL "${config.mqttUrl}": ${error.message}`);
  }

  const udpSocket = dgram.createSocket("udp4");
  const bridge = createBridge({ config, mqttClient, udpSocket });

  bridge.start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

  process.on("SIGTERM", () => {
    console.log("Shutting down");
    udpSocket.close();
    mqttClient.end();
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  bulbsFromDevices,
  commandForRgb,
  createBridge,
  loadConfig,
  looksLikeLight,
  normalizeMqttUrl,
  normalizeBulbs,
};
