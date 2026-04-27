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
    /** @type {number} @private Current seeded PRNG state as an unsigned 32-bit integer. */
    static #seed = 0x12345678;

    /** @type {boolean} @private Whether the seeded PRNG should be used. */
    static #useSeed = false;

    /** @type {number|null} @private Cached second Gaussian sample from Box-Muller. */
    static #gaussianSpare = null;

    /**
     * Returns a uniform random number in the range [0, 1).
     *
     * If {@link math.randomSeed} has been called, this uses an internal seeded
     * linear congruential generator (LCG). Otherwise it falls back to
     * `Math.random()`.
     *
     * @returns {number} A pseudorandom number in the range [0, 1).
     * @private
     */
    static #randomUnit(){
        if (!this.#useSeed) {
            return Math.random();
        }

        this.#seed = (1664525 * this.#seed + 1013904223) >>> 0;
        return this.#seed / 0x100000000;
    }

    /**
     * Returns a random value.
     *
     * Supported signatures:
     * - `random()` → random number in the range [0, 1)
     * - `random(max)` → random number in the range [0, max)
     * - `random(min, max, inclusive)` → random number in the requested range
     * - `random(array)` → random element from the array, or `undefined` when empty
     *
     * When {@link math.randomSeed} has been called, this method uses the same
     * seeded PRNG as {@link math.randomGaussian}; otherwise it falls back to
     * `Math.random()`.
     *
     * @param {number|Array<*>} [min=0] - Minimum value, maximum value, or array.
     * @param {number} [max=1] - Maximum value when using numeric ranges.
     * @param {boolean} [inclusive=false] - Whether to include the maximum value.
     * @returns {*|number|undefined} A random number or a random array element.
     * @throws {TypeError} Thrown when the provided arguments are not supported.
     *
     * @example
     * math.random();
     *
     * @example
     * math.random(10);
     *
     * @example
     * math.random(5, 15, true);
     *
     * @example
     * math.random(["red", "green", "blue"]);
     */
    static random(min = 0, max = 1, inclusive = false){
        if (Array.isArray(min)) {
            if (arguments.length > 1) {
                throw new TypeError('random(array) does not accept additional arguments');
            }
            if (min.length === 0) return undefined;
            const index = Math.floor(this.#randomUnit() * min.length);
            return min[index];
        }

        if (!Number.isFinite(min)) {
            throw new TypeError('min must be a finite number or an array');
        }

        if (arguments.length === 1) {
            max = min;
            min = 0;
        }

        if (!Number.isFinite(max)) {
            throw new TypeError('max must be a finite number');
        }

        if (typeof inclusive !== 'boolean') {
            throw new TypeError('inclusive must be a boolean');
        }

        if (max < min) {
            [min, max] = [max, min];
        }

        const rand = this.#randomUnit();
        return inclusive
            ? rand * (max - min + 1) + min
            : rand * (max - min) + min;
    }

    /**
     * Returns a normally distributed random number.
     *
     * This method generates values using the Box-Muller transform.
     *
     * - With no arguments, it returns a value from a standard normal distribution
     *   with mean `0` and standard deviation `1`.
     * - With arguments, it returns a value from a normal distribution with the
     *   specified `mean` and `standardDeviation`.
     *
     * If {@link math.randomSeed} was previously called, the output is reproducible.
     *
     * @param {number} [mean=0] - The mean (center) of the normal distribution.
     * @param {number} [standardDeviation=1] - The standard deviation (spread) of
     * the normal distribution. Must be greater than or equal to `0`.
     * @returns {number} A random number sampled from the requested normal distribution.
     * @throws {TypeError} Thrown when `mean` or `standardDeviation` is not finite.
     * @throws {RangeError} Thrown when `standardDeviation` is negative.
     */
    static randomGaussian(mean = 0, standardDeviation = 1){
        if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation)) {
            throw new TypeError('mean and standardDeviation must be finite numbers');
        }

        if (standardDeviation < 0) {
            throw new RangeError('standardDeviation must be greater than or equal to 0');
        }

        if (standardDeviation === 0) {
            return mean;
        }

        if (this.#gaussianSpare !== null) {
            const spare = this.#gaussianSpare;
            this.#gaussianSpare = null;
            return mean + spare * standardDeviation;
        }

        let u = 0;
        let v = 0;

        while (u === 0) u = this.#randomUnit();
        while (v === 0) v = this.#randomUnit();

        const magnitude = Math.sqrt(-2.0 * Math.log(u));
        const z0 = magnitude * Math.cos(this.TWO_PI * v);
        const z1 = magnitude * Math.sin(this.TWO_PI * v);

        this.#gaussianSpare = z1;
        return mean + z0 * standardDeviation;
    }

    /**
     * Sets the random seed used by seeded random functions.
     *
     * After calling this method, {@link math.random}, {@link math.randomInt},
     * and {@link math.randomGaussian} become deterministic until the seed is
     * changed again or the environment is reloaded.
     *
     * Calling `randomSeed()` also clears any cached Gaussian sample so that
     * future normal samples are fully reproducible from the new seed.
     *
     * @param {number} seed - The seed value to use. Any finite number is accepted.
     * The value is converted to an unsigned 32-bit integer internally.
     * @returns {number} The normalized unsigned 32-bit seed actually stored.
     * @throws {TypeError} Thrown when `seed` is not a finite number.
     */
    static randomSeed(seed){
        if (!Number.isFinite(seed)) {
            throw new TypeError('seed must be a finite number');
        }

        this.#seed = Math.floor(seed) >>> 0;
        this.#useSeed = true;
        this.#gaussianSpare = null;
        return this.#seed;
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
            return Math.floor(this.#randomUnit() * (max - min + 1)) + min;
        else
            return Math.floor(this.#randomUnit() * (max - min)) + min;
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