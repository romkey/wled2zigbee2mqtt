"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applyDdpPacket, parseDdpPacket, readRgbAtPixel } = require("../src/ddp");

test("parses and applies a DDP RGB packet", () => {
  const packet = Buffer.from([
    0x41, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x06,
    0xff, 0x80, 0x00,
    0x00, 0x20, 0xff,
  ]);

  const parsed = parseDdpPacket(packet);
  const frame = applyDdpPacket(null, parsed);

  assert.equal(parsed.offset, 0);
  assert.deepEqual(readRgbAtPixel(frame, 0), { r: 255, g: 128, b: 0 });
  assert.deepEqual(readRgbAtPixel(frame, 1), { r: 0, g: 32, b: 255 });
});

test("rejects truncated DDP packets", () => {
  const packet = Buffer.from([
    0x41, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x06,
    0xff,
  ]);

  assert.equal(parseDdpPacket(packet), null);
});
