"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { bulbsFromDevices, commandForRgb, normalizeMqttUrl } = require("../src/index");

test("discovers Zigbee2MQTT light devices", () => {
  const devices = [
    {
      friendly_name: "Coordinator",
      type: "Coordinator",
    },
    {
      friendly_name: "Office lamp",
      definition: {
        exposes: [
          {
            type: "light",
            features: [
              { property: "state" },
              { property: "brightness" },
              { property: "color_xy" },
            ],
          },
        ],
      },
    },
    {
      friendly_name: "Wall switch",
      definition: {
        exposes: [{ type: "switch", property: "state" }],
      },
    },
  ];

  assert.deepEqual(bulbsFromDevices(devices), [
    {
      friendly_name: "Office lamp",
      pixel: 0,
    },
  ]);
});

test("turns black pixels into OFF commands", () => {
  assert.deepEqual(commandForRgb({ r: 0, g: 0, b: 0 }, {
    transitionSeconds: 0.5,
    turnOffAtBlack: true,
  }), {
    state: "OFF",
    transition: 0.5,
  });
});

test("normalizes MQTT broker URLs", () => {
  assert.equal(normalizeMqttUrl("mqtt:1883"), "mqtt://mqtt:1883");
  assert.equal(normalizeMqttUrl(" mqtt://broker:1883 "), "mqtt://broker:1883");
  assert.equal(normalizeMqttUrl(""), "mqtt://mqtt:1883");
});
