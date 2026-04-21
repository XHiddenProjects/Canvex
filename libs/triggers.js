import { math } from "./math.js";
import { Canvex } from "./canvex.js";
export const Triggers = class {
    static #_triggered = false;
  /**
   * Checks for collision between two circles and executes a callback if they collide.
   * @param {number} x1 - X coordinate of the center of the first circle.
   * @param {number} y1 - Y coordinate of the center of the first circle.
   * @param {number} x2 - X coordinate of the center of the second circle.
   * @param {number} y2 - Y coordinate of the center of the second circle.
   * @param {number} [r1=0] - Radius of the first circle.
   * @param {number} [r2=0] - Radius of the second circle.
   * @param {Function} callback - The function to call if a collision is detected.
   */
  static collision(x1, y1, x2, y2, r1=0, r2=0, callback) {
    const distance = math.dist(x1,y1, x2, y2);
    if (distance < r1 + r2) callback();
  }
  /**
   * Trigger a callback function once when a specified condition is met.
   * @param {Function} condition - A function that returns a boolean indicating whether the trigger condition is met. In a frame
   * @param {Function} callback - The function to call when the condition is met.
   */
  static once(callback) {
    if (!this.#_triggered) {
        callback();
        this.#_triggered = true;
    }
  }
  /**
   * Trigger a callback function every time a specified condition is met.
   * @param {Function} callback - The function to call when the condition is met.
   */
  static always(callback) {
    callback();
  }
  /**
   * Trigger a callback function if a specified condition is met.
   * @param {Function} condition - A function that returns a boolean indicating whether the trigger condition is met.
   * @param {Function} callback - The function to call when the condition is met.
   * @example
   * // Example usage:
   * let count = 0;
   * function condition() {
   *   return count < 5;
   * }
   * function callback() {
   *   console.log("Condition met! Count: " + count);
   *   count++;
   * }
   * Triggers.conditional(condition, callback);
   */
  static conditional(condition, callback) {
    if(condition()) callback();
  }

}