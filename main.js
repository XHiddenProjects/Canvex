import { Canvex } from "./libs/canvex.js";
import { Canvas } from "./libs/canvas.js";
import { Shapes } from "./libs/shapes.js";
import { Interaction } from "./libs/interaction.js";
import { Camera } from "./libs/camera.js";
import { math } from "./libs/math.js";
import { Charts } from "./libs/charts.js";

window.setup = function () {
  // Canvas is 100x100 to match reference images
  Canvex.createCanvas(0, 0, 200, 200);
};

window.draw = function () {
  Canvas.background(200);
  Charts.bar();
};
