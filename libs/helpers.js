export const Helpers = class {
    /**
     * Creates a URL builder
     * @param {{protocol?: string, domain?: string, path?: string[], parameters?: object, fragments?: string}} structure
     */
    static URLBuilder(structure = {}) {
        structure = {
            protocol: 'http',
            domain: '',
            path: [],
            parameters: {},
            fragments: '',
            ...structure
        };

        const builder = {
            /**
             * Sets or updates query parameters
             * @param {object} params
             * @returns {object} builder
             */
            setParameter(params = {}) {
                structure.parameters = {
                    ...structure.parameters,
                    ...params
                };
                return builder;
            },
            /**
             * Sets the fragment value
             * @param {String} frag Fragment
             * @returns {String} Updated fragment
             */
            setFragment(frag=''){
                structure.fragments = encodeURIComponent(frag);
                return builder;
            },
            /**
             * Converts the builder to a URL string
             * @returns {String} Converted URL string
             */
            toString() {
                const query = Object.entries(structure.parameters)
                    .map(([k, v]) =>
                        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
                    )
                    .join('&');

                const path = structure.path.length
                    ? '/' + structure.path.map(p => p.replace(/^\/|\/$/g, '')).join('/')
                    : '';

                return (
                    `${structure.protocol}://${structure.domain}` +
                    path +
                    (query ? `?${query}` : '') +
                    (structure.fragments ? `#${encodeURIComponent(structure.fragments)}` : '')
                );
            },
            /**
             * Converts the URL to a CSS background url
             */
            toCSSBg(){
                const bg = builder.toString();
                return `url('${bg}')`;
            }
        };

        return builder;
    }
    /**
     * Generates a unique id
     * @param {string} [prefix=''] Add a prefix to the id
     * @param {Boolean} [more_entropy=false]  Increase the length of ID to 23 instead of 13
     * @returns {String} Unique ID
     */
    static uniqid(prefix='', more_entropy=false){
        const chars = '012345678abcdef',
        len = more_entropy ? 23 : 13;
        let id='';
        for(let i=0;i<len;i++) id+=chars[Math.floor(Math.random()*chars.length)];
        return `${prefix}${id}`;
    }
    /**
     * 
     * @param {String|{red:?Number,green:?Number,blue:?Number,alpha:?Number}} settings Color configuration 
     * @returns {{rgb: Function, rgba: Function, hex: Function, hsl: Function, hsla: Function, raw: Function}} CSS color string
     */
    static color(settings = {}) {
        const state = Helpers.#parseColor(settings);
        return {
            /**
             * RGB object
             * @returns {String} RGB string
             */
            rgb: () => `rgb(${state.r}, ${state.g}, ${state.b})`,
            /**
             * RGBA object
             * @returns {String} RGBA string
             */
            rgba: () => `rgba(${state.r}, ${state.g}, ${state.b}, ${state.a})`,
            /**
             * Hexadecimal object
             * @returns {String} Hex string
             */
            hex: () => Helpers.#toHex(state),
            /**
             * HSL object
             * @returns {String} HSL string
             */
            hsl: () => Helpers.#toHSL(state),
            /**
             * HSLA object
             * @returns {String} HSLA string
             */
            hsla: () => Helpers.#toHSL(state, true),
            /**
             * Raw object
             * @returns {{r: number, g: number, b: number, a: number}} Raw color object
             */
            raw: () => ({ ...state })
        };
    }

    /* ================== PARSING ================== */

    static #parseColor(input) {
        if (typeof input === 'string') {
            if (input.startsWith('#')) return Helpers.#hexToRGBA(input);
            if (input.startsWith('rgb')) return Helpers.#cssRGBToRGBA(input);
            if (input.startsWith('hsl')) return Helpers.#cssHSLToRGBA(input);
        }

        return Helpers.#objectToRGBA(input);
    }

    static #objectToRGBA(o) {
        if ('h' in o) {
            return Helpers.#hslToRGBA(o);
        }

        return {
            r: o.r ?? o.red ?? 0,
            g: o.g ?? o.green ?? o.red,
            b: o.b ?? o.blue ?? o.red,
            a: o.a ?? o.alpha ?? 1
        };
    }

    /* ================== HEX ================== */

    static #hexToRGBA(hex) {
        hex = hex.replace('#', '');

        if (hex.length === 3) {
            hex = [...hex].map(c => c + c).join('');
        }

        const hasAlpha = hex.length === 8;

        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: hasAlpha ? parseInt(hex.slice(6, 8), 16) / 255 : 1
        };
    }

    static #toHex({ r, g, b, a }) {
        const hex = (v) => v.toString(16).padStart(2, '0');
        return a < 1
            ? `#${hex(r)}${hex(g)}${hex(b)}${hex(Math.round(a * 255))}`
            : `#${hex(r)}${hex(g)}${hex(b)}`;
    }

    /* ================== RGB ================== */

    static #cssRGBToRGBA(str) {
        const nums = str.match(/[\d.]+/g).map(Number);
        return {
            r: nums[0],
            g: nums[1],
            b: nums[2],
            a: nums[3] ?? 1
        };
    }

    /* ================== HSL ================== */

    static #cssHSLToRGBA(str) {
        const nums = str.match(/[\d.]+/g).map(Number);
        return Helpers.#hslToRGBA({
            h: nums[0],
            s: nums[1],
            l: nums[2],
            a: nums[3] ?? 1
        });
    }

    static #hslToRGBA({ h, s, l, a = 1 }) {
        s /= 100;
        l /= 100;

        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;

        let r = 0, g = 0, b = 0;

        if (h < 60) [r, g, b] = [c, x, 0];
        else if (h < 120) [r, g, b] = [x, c, 0];
        else if (h < 180) [r, g, b] = [0, c, x];
        else if (h < 240) [r, g, b] = [0, x, c];
        else if (h < 300) [r, g, b] = [x, 0, c];
        else [r, g, b] = [c, 0, x];

        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255),
            a
        };
    }

    static #toHSL({ r, g, b, a = 1 }, withAlpha = false) {
        r /= 255; g /= 255; b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;

        let h = 0;
        if (d !== 0) {
            h =
                max === r ? ((g - b) / d) % 6 :
                max === g ? (b - r) / d + 2 :
                (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }

        const l = (max + min) / 2;
        const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

        const H = Math.round(h);
        const S = Math.round(s * 100);
        const L = Math.round(l * 100);

        return withAlpha
            ? `hsla(${H}, ${S}%, ${L}%, ${a})`
            : `hsl(${H}, ${S}%, ${L}%)`;
    }

    /**
     * Clamp a number between a minimum and maximum value.
     *
     * @param {number} value - The value to clamp.
     * @param {number} min - Minimum allowed value.
     * @param {number} max - Maximum allowed value.
     * @returns {number} The clamped value.
     *
     * @throws {TypeError} If any argument is not a finite number.
     *
     * @example
     * Helpers.clamp(10, 0, 5);   // 5
     * Helpers.clamp(-3, 0, 100); // 0
     * Helpers.clamp(50, 0, 100); // 50
     */
    static clamp(value, min, max) {
        if (
            !Number.isFinite(value) ||
            !Number.isFinite(min) ||
            !Number.isFinite(max)
        ) {
            throw new TypeError("Clamp arguments must be finite numbers");
        }

        if (min > max) {
            // Optional safety swap
            [min, max] = [max, min];
        }

        return Math.max(min, Math.min(max, value));
    }
}