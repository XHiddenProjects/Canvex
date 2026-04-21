import { Helpers } from "./helpers.js";

export const math = class{
    static PI = Math.PI;
    static HALF_PI = Math.PI / 2;
    static QUARTER_PI = Math.PI / 4;
    static TWO_PI = Math.PI * 2;
    static E = Math.E;
    static SQRT2 = Math.SQRT2;
    static SQRT1_2 = Math.SQRT1_2;
    static LN2 = Math.LN2;
    static LN10 = Math.LN10;
    static LOG2E = Math.LOG2E;
    static LOG10E = Math.LOG10E;
    static TAU = Math.TAU;
    /**
     * Converts degrees to radians.
     * @param {number} degrees Angle in degrees.
     * @returns {number} Angle in radians.
     */
    static radians(degrees){
        return degrees * (Math.PI / 180);
    }
    /**
     * Converts radians to degrees.
     * @param {number} radians Angle in radians.
     * @returns {number} Angle in degrees.
     */
    static degrees(radians){
        return radians * (180 / Math.PI);
    }
    /**
     * Returns a random number within a specified range.
     * @param {number} min Minimum value.
     * @param {number} max Maximum value.
     * @param {boolean} [inclusive=false] Whether to include the maximum value.
     * @returns {number} Random number.
     */
    static random(min = 0, max = 1, inclusive = false){
        if (inclusive)
            return Math.random() * (max - min + 1) + min;
        else
            return Math.random() * (max - min) + min;
    }
    /**
     * Returns a random integer within a specified range.
     * @param {number} min Minimum value.
     * @param {number} max Maximum value.
     * @param {boolean} [inclusive=false] Whether to include the maximum value.
     * @returns {number} Random integer.
     */
    static randomInt(min = 0, max = 1, inclusive = false){
        if (inclusive)
            return Math.floor(Math.random() * (max - min + 1)) + min;
        else
            return Math.floor(Math.random() * (max - min)) + min;
    }
    /**
     * Maps a value from one range to another.
     * @param {number} value The value to map.
     * @param {number} start1 The lower bound of the first range.
     * @param {number} stop1 The upper bound of the first range.
     * @param {number} start2 The lower bound of the second range.
     * @param {number} stop2 The upper bound of the second range.
     * @param {boolean} [withinBounds=false] Whether to constrain the result within the second range.
     * @returns {number} The mapped value.
     */
    static map(value, start1, stop1, start2, stop2, [withinBounds = false] = []){
        const newval = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
        if(withinBounds){
            if (start2 < stop2) {
                return Math.min(Math.max(newval, start2), stop2);
            } else {
                return Math.min(Math.max(newval, stop2), start2);
            }
        }
        return newval;
    }
    /**
     * Linearly interpolates between two values by a given amount. 
     * @param {number} start The starting value.
     * @param {number} stop The ending value.
     * @param {number} amt The amount to interpolate by (0.0 to 1.0).
     * @returns {number} The interpolated value.
     */
    static lerp(start, stop, amt){
        return start + (stop - start) * Helpers.clamp(Number(amt) || 0, 0, 1);
    }
    /**
     * Returns the absolute value of a number.
     * @param {number} value The number to get the absolute value of.
     * @returns {number} The absolute value.
     */
    static abs(value){
        return Math.abs(value);
    }
    /**
     * Returns the largest integer less than or equal to a number.
     * @param {number} value The number to floor.
     * @returns {number} The floored value.
     */
    static floor(value){
        return Math.floor(value);
    }
    /**
     * Returns the smallest integer greater than or equal to a number.
     * @param {number} value The number to ceil.
     * @returns {number} The ceiled value.
     */
    static ceil(value){
        return Math.ceil(value);
    }
    /**
     * Constrains a value to be within a specified range.
     * @param {number} value The value to constrain.
     * @param {number} min The minimum value.
     * @param {number} max The maximum value.
     * @returns {number} The constrained value.
     */
    static constrain(value, min, max){
        return Helpers.clamp(value, min, max);
    }
    /**
     * Calculates the distance between two points.
     * @param {number} x1 The x-coordinate of the first point.
     * @param {number} y1 The y-coordinate of the first point.
     * @param {number} x2 The x-coordinate of the second point.
     * @param {number} y2 The y-coordinate of the second point.
     * @param {number} z1 The z-coordinate of the first point (optional).
     * @param {number} z2 The z-coordinate of the second point (optional).
     * @returns {number} The distance between the two points.
     */
    static dist(x1, y1, x2, y2, z1 = 0, z2 = 0){
        if(arguments.length === 4) return Math.hypot(x2 - x1, y2 - y1);
        else return Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    }
    /**
     * Returns the exponential of a number.
     * @param {number} value The number to calculate the exponential of.
     * @returns {number} The exponential value.
     */
    static exp(value){
        return Math.exp(value);
    }
    /**
     * Normalizes a value to be within the range [0, 1].
     * @param {number} value The value to normalize.
     * @param {number} start The lower bound of the range.
     * @param {number} stop The upper bound of the range.
     * @returns {number} The normalized value.
     */
    static norm(value, start, stop){
        return (value - start) / (stop - start);
    }
    /**
     * Calculates the magnitude of a vector.
     * @param {number} x The x-component of the vector.
     * @param {number} y The y-component of the vector.
     * @param {number} z The z-component of the vector (optional).
     * @returns {number} The magnitude of the vector.
     */
    static mag(x, y, z = 0){
        return Math.hypot(x, y, z);
    }
    /**
     * Returns the maximum of two or more numbers.
     * @param {...number} values The numbers to compare.
     * @return {number} The maximum value.
     */
    static max(...values){
        return Math.max(...values);
    }
    /**
     * Returns the minimum of two or more numbers.
     * @param {...number} values The numbers to compare.
     * @return {number} The minimum value.
     */
    static min(...values){
        return Math.min(...values);
    }
    /**
     * Returns the power of a number.
     * @param {number} base The base number.
     * @param {number} exponent The exponent.
     * @returns {number} The result of the power operation.
     */
    static pow(base, exponent){
        return Math.pow(base, exponent);
    }
    /**
     * Rounds a number to the nearest integer.
     * @param {number} value The number to round.
     * @returns {number} The rounded value.
     */
    static round(value){
        return Math.round(value);
    }
    /**
     * Returns the square of a number.
     * @param {number} value The number to square.
     * @returns {number} The squared value.
     */
    static sq(value){
        return this.pow(value, 2);
    }
    /**
     * Returns the square root of a number.
     * @param {number} value The number to calculate the square root of.
     * @returns {number} The square root value.
     */
    static sqrt(value){
        return Math.sqrt(value);
    }
    /**
     * Returns the fractional part of a number.
     * @param {number} value The number to get the fractional part of.
     * @returns {number} The fractional part of the number.
     */
    static frac(value){
        return value - Math.floor(value);
    }
}