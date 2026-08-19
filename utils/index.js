"use strict";

module.exports = {
  ...require("./src/constants"),
  ...require("./src/math"),
  ...require("./src/color"),
  ...require("./src/shapes"),
  ...require("./src/transform"),
  ...require("./src/3d"),
  ...require("./src/rendering"),
  ...require("./src/typography"),
  ...require("./src/image"),
  ...require("./src/dom"),
  ...require("./src/environment"),
  ...require("./src/events"),
  ...require("./src/structure"),
  ...require("./src/io"),
  ...require("./src/data"),
  ...require("./src/sound"),
  ...require("./src/network"),
  // Higher-level, block functions built on top of the modules
  // above. Kept as a namespace (not spread) so block scripts call
  // `Forge.Behaviors.timer(...)` etc. instead of reaching into the raw
  // per-module functions directly.
  Behaviors: require("./src/behaviors")
};