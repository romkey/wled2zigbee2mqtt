"use strict";

const DDP_HEADER_LENGTH = 10;

function parseDdpPacket(packet) {
  if (!Buffer.isBuffer(packet)) {
    throw new TypeError("DDP packet must be a Buffer");
  }

  if (packet.length < DDP_HEADER_LENGTH) {
    return null;
  }

  const dataLength = packet.readUInt16BE(8);
  const dataStart = DDP_HEADER_LENGTH;
  const dataEnd = dataStart + dataLength;

  if (dataEnd > packet.length) {
    return null;
  }

  return {
    flags: packet[0],
    sequence: packet[1],
    dataType: packet[2],
    destination: packet[3],
    offset: packet.readUInt32BE(4),
    data: packet.subarray(dataStart, dataEnd),
  };
}

function applyDdpPacket(frameBuffer, parsedPacket) {
  if (!parsedPacket || !parsedPacket.data.length) {
    return frameBuffer;
  }

  const requiredLength = parsedPacket.offset + parsedPacket.data.length;
  let nextFrameBuffer = frameBuffer;

  if (!nextFrameBuffer || nextFrameBuffer.length < requiredLength) {
    nextFrameBuffer = Buffer.alloc(requiredLength);
    if (frameBuffer) {
      frameBuffer.copy(nextFrameBuffer);
    }
  }

  parsedPacket.data.copy(nextFrameBuffer, parsedPacket.offset);
  return nextFrameBuffer;
}

function readRgbAtPixel(frameBuffer, pixel) {
  const offset = pixel * 3;

  if (!frameBuffer || offset + 2 >= frameBuffer.length) {
    return null;
  }

  return {
    r: frameBuffer[offset],
    g: frameBuffer[offset + 1],
    b: frameBuffer[offset + 2],
  };
}

module.exports = {
  DDP_HEADER_LENGTH,
  parseDdpPacket,
  applyDdpPacket,
  readRgbAtPixel,
};
