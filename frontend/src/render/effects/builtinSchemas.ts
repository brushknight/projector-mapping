/**
 * Param schemas of the built-in effects, copied from contract/catalog.json so the engine renders sensibly before the
 * catalog has loaded. The catalog passed in RenderInput wins when present.
 */
import type { ParamSchema } from '../../entities/effect/types'

export const BUILTIN_SCHEMAS: Record<string, ParamSchema> = {
  "drawing": {
    "strokes": { "type": "strokes", "default": [], "label": "strokes" },
    "reveal": { "type": "number", "min": 0, "max": 1, "default": 1, "label": "reveal" }
  },
  "grid-build": {
    "cells": {
      "type": "integer",
      "min": 2,
      "max": 32,
      "default": 8,
      "label": "cells"
    },
    "line": {
      "type": "number",
      "min": 1,
      "max": 8,
      "default": 2,
      "label": "line",
      "unit": "px"
    },
    "glow": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.5,
      "label": "glow"
    },
    "color": {
      "type": "color",
      "default": "#d8f8ff",
      "label": "color"
    }
  },
  "trace": {
    "mode": {
      "type": "enum",
      "options": [
        "border",
        "boomerang"
      ],
      "default": "border",
      "label": "mode"
    },
    "line": {
      "type": "number",
      "min": 1,
      "max": 12,
      "default": 3,
      "label": "line",
      "unit": "px"
    },
    "speed": {
      "type": "number",
      "min": 0.2,
      "max": 10,
      "default": 2,
      "label": "speed",
      "unit": "s"
    },
    "glow": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.62,
      "label": "glow"
    },
    "pixelStep": {
      "type": "number",
      "min": 0,
      "max": 12,
      "default": 0,
      "label": "pixel step",
      "unit": "px"
    },
    "color": {
      "type": "color",
      "default": "#e9fbff",
      "label": "color"
    }
  },
  "scan": {
    "direction": {
      "type": "enum",
      "options": [
        "down",
        "up",
        "left",
        "right"
      ],
      "default": "down",
      "label": "direction"
    },
    "width": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.15,
      "label": "band"
    },
    "color": {
      "type": "color",
      "default": "#e9fbff",
      "label": "color"
    }
  },
  "glitch": {
    "amount": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.5,
      "label": "amount"
    },
    "blocks": {
      "type": "integer",
      "min": 2,
      "max": 64,
      "default": 12,
      "label": "blocks"
    },
    "color": {
      "type": "color",
      "default": "#ffffff",
      "label": "color"
    }
  },
  "fill": {
    "color": {
      "type": "color",
      "default": "#ffffff",
      "label": "color"
    },
    "opacity": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 1,
      "label": "opacity"
    }
  },
  "particles": {
    "count": {
      "type": "integer",
      "min": 10,
      "max": 2000,
      "default": 200,
      "label": "count"
    },
    "speed": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.4,
      "label": "speed"
    },
    "size": {
      "type": "number",
      "min": 1,
      "max": 8,
      "default": 2,
      "label": "size",
      "unit": "px"
    },
    "color": {
      "type": "color",
      "default": "#ffffff",
      "label": "color"
    }
  },
  "label": {
    "text": {
      "type": "string",
      "default": "ZIMACUBE",
      "label": "text"
    },
    "size": {
      "type": "number",
      "min": 8,
      "max": 300,
      "default": 48,
      "label": "size",
      "unit": "px"
    },
    "color": {
      "type": "color",
      "default": "#ffffff",
      "label": "color"
    }
  },
  "pulse": {
    "bpm": {
      "type": "number",
      "min": 20,
      "max": 200,
      "default": 72,
      "label": "bpm"
    },
    "depth": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.6,
      "label": "depth"
    },
    "color": {
      "type": "color",
      "default": "#e9fbff",
      "label": "color"
    }
  },
  "highlight": {
    "color": {
      "type": "color",
      "default": "#e9fbff",
      "label": "color"
    },
    "edgeGlow": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.6,
      "label": "edge glow"
    },
    "fillOpacity": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.25,
      "label": "fill"
    }
  },
  "spin": {
    "rpm": {
      "type": "number",
      "min": 1,
      "max": 600,
      "default": 60,
      "label": "rpm"
    },
    "dashes": {
      "type": "integer",
      "min": 2,
      "max": 64,
      "default": 12,
      "label": "dashes"
    },
    "line": {
      "type": "number",
      "min": 1,
      "max": 12,
      "default": 3,
      "label": "line",
      "unit": "px"
    },
    "color": {
      "type": "color",
      "default": "#e9fbff",
      "label": "color"
    }
  },
  "converge": {
    "from": { "type": "enum", "options": ["current", "circle", "frame"], "default": "current", "label": "from" },
    "source": { "type": "enum", "options": ["static", "live", "color", "scenery"], "default": "static", "label": "light from" },
    "ease": { "type": "enum", "options": ["inOut", "in", "out", "linear"], "default": "inOut", "label": "ease" },
    "edge": { "type": "number", "min": 0, "max": 200, "default": 6, "label": "soft edge", "unit": "px" },
    "outline": { "type": "boolean", "default": false, "label": "outline at the end" }
  },
  "morph": {"from": {"type": "string", "default": "object", "label": "from"}, "to": {"type": "string", "default": "circle", "label": "to"}, "fill": {"type": "enum", "options": ["color", "light"], "default": "color", "label": "fill"}, "color": {"type": "color", "default": "#ffffff", "label": "colour"}, "colorTo": {"type": "color", "default": "#ffffff", "label": "colour at the end"}, "source": {"type": "enum", "options": ["static", "live", "color", "scenery"], "default": "static", "label": "light from"}, "ease": {"type": "enum", "options": ["inOut", "in", "out", "linear"], "default": "inOut", "label": "ease"}, "edge": {"type": "number", "min": 0, "max": 200, "default": 2, "label": "soft edge", "unit": "px"}, "outline": {"type": "boolean", "default": false, "label": "outline"}, "fromCx": {"type": "number", "min": -1, "max": 20000, "default": -1, "label": "from centre x", "unit": "px"}, "fromCy": {"type": "number", "min": -1, "max": 20000, "default": -1, "label": "from centre y", "unit": "px"}, "fromR": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "from radius", "unit": "px"}, "fromW": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "from width", "unit": "px"}, "fromH": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "from height", "unit": "px"}, "fromSize": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "from plate size", "unit": "px"}, "toCx": {"type": "number", "min": -1, "max": 20000, "default": -1, "label": "to centre x", "unit": "px"}, "toCy": {"type": "number", "min": -1, "max": 20000, "default": -1, "label": "to centre y", "unit": "px"}, "toR": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "to radius", "unit": "px"}, "toW": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "to width", "unit": "px"}, "toH": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "to height", "unit": "px"}, "toSize": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "to plate size", "unit": "px"}},
  "shape": {"shape": {"type": "string", "default": "circle", "label": "shape"}, "fill": {"type": "enum", "options": ["color", "light"], "default": "color", "label": "fill"}, "color": {"type": "color", "default": "#ffffff", "label": "colour"}, "colorTo": {"type": "color", "default": "#ffffff", "label": "colour at the end"}, "source": {"type": "enum", "options": ["static", "live", "color", "scenery"], "default": "static", "label": "light from"}, "ease": {"type": "enum", "options": ["inOut", "in", "out", "linear"], "default": "inOut", "label": "ease"}, "edge": {"type": "number", "min": 0, "max": 200, "default": 2, "label": "soft edge", "unit": "px"}, "outline": {"type": "boolean", "default": false, "label": "outline"}, "cx": {"type": "number", "min": -1, "max": 20000, "default": -1, "label": "centre x", "unit": "px"}, "cy": {"type": "number", "min": -1, "max": 20000, "default": -1, "label": "centre y", "unit": "px"}, "r": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "radius", "unit": "px"}, "w": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "width", "unit": "px"}, "h": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "height", "unit": "px"}, "size": {"type": "number", "min": 0, "max": 20000, "default": 0, "label": "plate size", "unit": "px"}}
}
