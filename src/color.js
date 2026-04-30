"use strict";

function srgbToLinear(value) {
  const normalized = value / 255;
  return normalized > 0.04045
    ? Math.pow((normalized + 0.055) / 1.055, 2.4)
    : normalized / 12.92;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function rgbToXyBrightness({ r, g, b }) {
  const red = srgbToLinear(r);
  const green = srgbToLinear(g);
  const blue = srgbToLinear(b);

  const x = red * 0.664511 + green * 0.154324 + blue * 0.162028;
  const y = red * 0.283881 + green * 0.668433 + blue * 0.047685;
  const z = red * 0.000088 + green * 0.07231 + blue * 0.986039;
  const total = x + y + z;
  const brightness = Math.round(clamp(Math.max(r, g, b), 0, 255));

  if (total === 0 || brightness === 0) {
    return {
      brightness: 0,
      x: 0,
      y: 0,
    };
  }

  return {
    brightness,
    x: Number(clamp(x / total, 0, 1).toFixed(4)),
    y: Number(clamp(y / total, 0, 1).toFixed(4)),
  };
}

function colorChanged(previous, next, threshold) {
  if (!previous) {
    return true;
  }

  return (
    Math.abs(previous.r - next.r) >= threshold ||
    Math.abs(previous.g - next.g) >= threshold ||
    Math.abs(previous.b - next.b) >= threshold
  );
}

module.exports = {
  colorChanged,
  rgbToXyBrightness,
};
