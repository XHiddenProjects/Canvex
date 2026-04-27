import { Canvex } from "./canvex.js";
import { Helpers } from "./helpers.js";

export const Elements = class {
    /** @type {HTMLElement|null} */
    static #selected = null;

    /** @type {Set<HTMLElement>} */
    static #created = new Set();

    constructor() {}

    /**
     * Escapes HTML so plain text can be assigned safely through innerHTML.
     * @param {string} txt Raw text.
     * @returns {string} Escaped text.
     */
    static #strip(txt) {
        if (typeof txt !== "string") return "";
        return txt
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * Returns the container used for created DOM elements.
     * @returns {HTMLElement}
     */
    static #parent() {
        return Canvex?.parent instanceof HTMLElement ? Canvex.parent : document.body;
    }

    /**
     * Returns the canvas box in page coordinates.
     * Falls back to a zero-sized origin box when no canvas exists.
     * @returns {{left:number, top:number, width:number, height:number}}
     */
    static #canvasBox() {
        if (!(Canvex?.canvas instanceof HTMLCanvasElement)) {
            return { left: 0, top: 0, width: 0, height: 0 };
        }

        const rect = Canvex.canvas.getBoundingClientRect();
        return {
            left: rect.left + window.scrollX,
            top: rect.top + window.scrollY,
            width: rect.width || Canvex.canvas.width || Canvex.width || 0,
            height: rect.height || Canvex.canvas.height || Canvex.height || 0
        };
    }

    /**
     * Applies absolute positioning anchored to the canvas top-left corner.
     * @param {HTMLElement} el Element to initialize.
     * @returns {HTMLElement}
     */
    static #initCanvasOverlay(el) {
        const box = this.#canvasBox();
        el.style.position = "absolute";
        el.style.left = `${box.left}px`;
        el.style.top = `${box.top}px`;
        return el;
    }

    /**
     * Registers an element, appends it to the DOM, and selects it.
     * This is the internal helper used by all create methods.
     *
     * @param {HTMLElement} el Element to register.
     * @param {HTMLElement} [parent] Optional parent container.
     * @returns {HTMLElement} The appended element.
     */
    static addElement(el, parent = Elements.#parent()) {
        if (!(el instanceof HTMLElement)) {
            throw new TypeError("addElement(el) expects an HTMLElement");
        }

        if (!el.style.position) {
            this.#initCanvasOverlay(el);
        }

        if (!el.isConnected) {
            parent.insertAdjacentElement("beforeend", el);
        }

        this.#created.add(el);
        this.#selected = el;
        return el;
    }

    /**
     * Returns the currently selected element.
     * @returns {HTMLElement|null}
     */
    static selected() {
        return this.#selected;
    }

    /**
     * Selects the first element that matches a CSS selector.
     * @param {string} selector CSS selector.
     * @param {ParentNode} [container=document] Search root.
     * @returns {HTMLElement|null} Matching element.
     */
    static select(selector, container = document) {
        const el = container?.querySelector?.(selector) ?? null;
        this.#selected = el instanceof HTMLElement ? el : null;
        return this.#selected;
    }

    /**
     * Selects all elements that match a CSS selector.
     * @param {string} selector CSS selector.
     * @param {ParentNode} [container=document] Search root.
     * @returns {HTMLElement[]} Matching elements.
     */
    static selectAll(selector, container = document) {
        const list = Array.from(container?.querySelectorAll?.(selector) ?? []).filter(
            (el) => el instanceof HTMLElement
        );
        if (list.length > 0) {
            this.#selected = list[0];
        }
        return list;
    }

    /**
     * Creates a generic HTML element and appends it to the page.
     * @param {string} tagName HTML tag name.
     * @param {string} [html=''] Plain-text contents.
     * @returns {HTMLElement}
     */
    static createElement(tagName, html = "") {
        if (typeof tagName !== "string" || !tagName.trim()) {
            throw new TypeError("createElement(tagName) expects a non-empty string");
        }
        const el = document.createElement(tagName.trim());
        el.innerHTML = this.#strip(html);
        this.#initCanvasOverlay(el);
        return this.addElement(el);
    }

    /**
     * Creates an <a> element.
     * @param {string|URL} href Destination URL.
     * @param {string} html Plain-text label.
     * @param {'_blank'|'_top'|'_self'|'_parent'} [target='_blank'] Link target.
     * @returns {HTMLAnchorElement}
     */
    static createA(href, html, target = "_blank") {
        const el = document.createElement("a");
        el.href = href instanceof URL ? href.href : String(href ?? "");
        el.innerHTML = this.#strip(html ?? "");
        el.target = target || "_blank";
        this.#initCanvasOverlay(el);
        return /** @type {HTMLAnchorElement} */ (this.addElement(el));
    }

    /**
     * Creates a hidden <audio> element for simple playback.
     * @param {string|string[]} [src=''] Source URL(s).
     * @param {boolean} [autoplay=false] Whether playback should start automatically.
     * @param {boolean} [loop=false] Whether playback should loop.
     * @param {boolean} [muted=false] Whether playback should start muted.
     * @returns {HTMLAudioElement}
     */
    static createAudio(src = "", autoplay = false, loop = false, muted = false) {
        const el = document.createElement("audio");
        el.autoplay = Boolean(autoplay);
        el.loop = Boolean(loop);
        el.muted = Boolean(muted);
        el.preload = "auto";
        el.controls = false;
        el.hidden = true;

        if (Array.isArray(src)) {
            for (const entry of src) {
                const source = document.createElement("source");
                source.src = String(entry ?? "");
                el.appendChild(source);
            }
        } else if (src) {
            el.src = String(src);
        }

        this.#initCanvasOverlay(el);
        return /** @type {HTMLAudioElement} */ (this.addElement(el));
    }

    /**
     * Creates a <button> element.
     * @param {string} [label='Button'] Button label.
     * @param {string} [value=''] Button value.
     * @returns {HTMLButtonElement}
     */
    static createButton(label = "Button", value = "") {
        const el = document.createElement("button");
        el.type = "button";
        el.innerHTML = this.#strip(label);
        el.value = String(value ?? "");
        this.#initCanvasOverlay(el);
        return /** @type {HTMLButtonElement} */ (this.addElement(el));
    }

    /**
     * Creates a <video> element that captures webcam/microphone input.
     *
     * The element is returned immediately. When permissions are granted,
     * `srcObject` is populated with the live stream.
     *
     * @param {MediaStreamConstraints} [constraints={ video:true, audio:false }] Capture constraints.
     * @param {(stream: MediaStream) => void} [callback] Optional stream callback.
     * @returns {HTMLVideoElement}
     */
    static createCapture(constraints = { video: true, audio: false }, callback) {
        const el = document.createElement("video");
        el.autoplay = true;
        el.playsInline = true;
        el.muted = true;
        this.#initCanvasOverlay(el);
        this.addElement(el);

        if (navigator?.mediaDevices?.getUserMedia) {
            navigator.mediaDevices.getUserMedia(constraints)
                .then((stream) => {
                    el.srcObject = stream;
                    callback?.(stream);
                    const playAttempt = el.play();
                    if (playAttempt && typeof playAttempt.catch === "function") {
                        playAttempt.catch(() => {});
                    }
                })
                .catch((error) => {
                    el.dataset.error = String(error?.message ?? error);
                });
        } else {
            el.dataset.error = "getUserMedia is not available in this environment.";
        }

        return /** @type {HTMLVideoElement} */ (el);
    }

    /**
     * Creates a checkbox element wrapped in a <label>.
     * The returned label element exposes the checkbox as `.input`.
     * @param {string} [label=''] Plain-text label.
     * @param {boolean} [checked=false] Initial checked state.
     * @returns {HTMLLabelElement & { input: HTMLInputElement }}
     */
    static createCheckbox(label = "", checked = false) {
        const wrapper = document.createElement("label");
        const input = document.createElement("input");
        const span = document.createElement("span");

        input.type = "checkbox";
        input.checked = Boolean(checked);
        span.innerHTML = this.#strip(label);
        wrapper.append(input, span);
        wrapper.style.display = "inline-flex";
        wrapper.style.alignItems = "center";
        wrapper.style.gap = "0.35rem";
        this.#initCanvasOverlay(wrapper);
        wrapper.input = input;
        return /** @type {HTMLLabelElement & { input: HTMLInputElement }} */ (this.addElement(wrapper));
    }

    /**
     * Creates a color picker input.
     * @param {string} [value='#000000'] Initial color.
     * @returns {HTMLInputElement}
     */
    static createColorPicker(value = "#000000") {
        const el = document.createElement("input");
        el.type = "color";
        el.value = String(value || "#000000");
        this.#initCanvasOverlay(el);
        return /** @type {HTMLInputElement} */ (this.addElement(el));
    }

    /**
     * Creates a <div> element.
     * @param {string} [html=''] Plain-text contents.
     * @returns {HTMLDivElement}
     */
    static createDiv(html = "") {
        return /** @type {HTMLDivElement} */ (this.createElement("div", html));
    }

    /**
     * Creates a file input element.
     * @param {(files: FileList, event: Event) => void} [callback] Change callback.
     * @param {boolean} [multiple=false] Whether multiple files are allowed.
     * @param {string} [accept=''] Optional accept filter.
     * @returns {HTMLInputElement}
     */
    static createFileInput(callback, multiple = false, accept = "") {
        const el = document.createElement("input");
        el.type = "file";
        el.multiple = Boolean(multiple);
        if (accept) el.accept = String(accept);
        if (typeof callback === "function") {
            el.addEventListener("change", (event) => {
                callback(el.files, event);
            });
        }
        this.#initCanvasOverlay(el);
        return /** @type {HTMLInputElement} */ (this.addElement(el));
    }

    /**
     * Creates an <img> element.
     * @param {string} src Image source.
     * @param {string} [alt=''] Alternate text.
     * @param {(event: Event) => void} [callback] Load callback.
     * @returns {HTMLImageElement}
     */
    static createImg(src, alt = "", callback) {
        const el = document.createElement("img");
        el.src = String(src ?? "");
        el.alt = String(alt ?? "");
        if (typeof callback === "function") {
            el.addEventListener("load", callback, { once: true });
        }
        this.#initCanvasOverlay(el);
        return /** @type {HTMLImageElement} */ (this.addElement(el));
    }

    /**
     * Creates a text-like input element.
     * @param {string} [value=''] Initial value.
     * @param {string} [type='text'] Input type.
     * @param {string} [placeholder=''] Placeholder text.
     * @returns {HTMLInputElement}
     */
    static createInput(value = "", type = "text", placeholder = "") {
        const el = document.createElement("input");
        el.type = String(type || "text");
        el.value = String(value ?? "");
        el.placeholder = String(placeholder ?? "");
        this.#initCanvasOverlay(el);
        return /** @type {HTMLInputElement} */ (this.addElement(el));
    }

    /**
     * Creates a paragraph element.
     * @param {string} [html=''] Plain-text contents.
     * @returns {HTMLParagraphElement}
     */
    static createP(html = "") {
        return /** @type {HTMLParagraphElement} */ (this.createElement("p", html));
    }

    /**
     * Creates a radio-button group container.
     * The returned container exposes `.option(label, value, checked)` and `.value()` helpers.
     * @param {string} [name] Shared radio-group name.
     * @param {Array<string|{label:string,value:string,checked?:boolean}>} [options=[]] Initial options.
     * @returns {HTMLDivElement & { option: Function, value: Function }}
     */
    static createRadio(name = `radio-${Date.now()}-${Math.random().toString(36).slice(2)}`, options = []) {
        const wrapper = document.createElement("div");
        wrapper.dataset.radioName = name;
        wrapper.style.display = "inline-flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "0.25rem";
        this.#initCanvasOverlay(wrapper);

        wrapper.option = (label, value = label, checked = false) => {
            const line = document.createElement("label");
            const input = document.createElement("input");
            const span = document.createElement("span");
            input.type = "radio";
            input.name = name;
            input.value = String(value ?? label ?? "");
            input.checked = Boolean(checked);
            span.innerHTML = this.#strip(String(label ?? ""));
            line.style.display = "inline-flex";
            line.style.alignItems = "center";
            line.style.gap = "0.35rem";
            line.append(input, span);
            wrapper.appendChild(line);
            return input;
        };

        wrapper.value = () => {
            const selected = wrapper.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
            return selected ? selected.value : undefined;
        };

        for (const option of options) {
            if (typeof option === "object" && option !== null) {
                wrapper.option(option.label, option.value, option.checked);
            } else {
                wrapper.option(String(option), String(option), false);
            }
        }

        return /** @type {HTMLDivElement & { option: Function, value: Function }} */ (this.addElement(wrapper));
    }

    /**
     * Creates a <select> element.
     * @param {Array<string|{label:string,value:string,selected?:boolean}>} [options=[]] Initial options.
     * @param {boolean} [multiple=false] Whether multiple selection is allowed.
     * @returns {HTMLSelectElement}
     */
    static createSelect(options = [], multiple = false) {
        const el = document.createElement("select");
        el.multiple = Boolean(multiple);
        for (const option of options) {
            const opt = document.createElement("option");
            if (typeof option === "object" && option !== null) {
                opt.textContent = String(option.label ?? option.value ?? "");
                opt.value = String(option.value ?? option.label ?? "");
                opt.selected = Boolean(option.selected);
            } else {
                opt.textContent = String(option ?? "");
                opt.value = String(option ?? "");
            }
            el.appendChild(opt);
        }
        this.#initCanvasOverlay(el);
        return /** @type {HTMLSelectElement} */ (this.addElement(el));
    }

    /**
     * Creates a slider input.
     * @param {number} [min=0] Minimum value.
     * @param {number} [max=100] Maximum value.
     * @param {number} [value=min] Initial value.
     * @param {number} [step=1] Step interval.
     * @returns {HTMLInputElement}
     */
    static createSlider(min = 0, max = 100, value = min, step = 1) {
        const el = document.createElement("input");
        el.type = "range";
        el.min = String(min);
        el.max = String(max);
        el.value = String(value);
        el.step = String(step);
        this.#initCanvasOverlay(el);
        return /** @type {HTMLInputElement} */ (this.addElement(el));
    }

    /**
     * Creates a <span> element.
     * @param {string} [html=''] Plain-text contents.
     * @returns {HTMLSpanElement}
     */
    static createSpan(html = "") {
        return /** @type {HTMLSpanElement} */ (this.createElement("span", html));
    }

    /**
     * Creates a <video> element for simple playback.
     * @param {string|string[]} [src=''] Source URL(s).
     * @param {boolean} [controls=true] Whether controls should be visible.
     * @param {boolean} [loop=false] Whether playback should loop.
     * @param {boolean} [muted=false] Whether playback starts muted.
     * @param {boolean} [autoplay=false] Whether playback should start automatically.
     * @returns {HTMLVideoElement}
     */
    static createVideo(src = "", controls = true, loop = false, muted = false, autoplay = false) {
        const el = document.createElement("video");
        el.controls = Boolean(controls);
        el.loop = Boolean(loop);
        el.muted = Boolean(muted);
        el.autoplay = Boolean(autoplay);
        el.playsInline = true;
        el.preload = "auto";

        if (Array.isArray(src)) {
            for (const entry of src) {
                const source = document.createElement("source");
                source.src = String(entry ?? "");
                el.appendChild(source);
            }
        } else if (src) {
            el.src = String(src);
        }

        this.#initCanvasOverlay(el);
        return /** @type {HTMLVideoElement} */ (this.addElement(el));
    }

    /**
     * Positions the currently selected element inside the canvas.
     * The element is clamped so it stays fully visible within the canvas bounds.
     * @param {number} x Canvas-local x coordinate.
     * @param {number} y Canvas-local y coordinate.
     * @returns {HTMLElement}
     */
    static position(x, y) {
        const el = Elements.#selected;
        if (!(el instanceof HTMLElement)) {
            throw new Error("No selected element. Create or select an element first.");
        }
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new TypeError("position(x, y) expects finite numbers");
        }

        const box = this.#canvasBox();
        const width = el.offsetWidth || 0;
        const height = el.offsetHeight || 0;
        const maxX = Math.max(0, box.width - width);
        const maxY = Math.max(0, box.height - height);
        const localX = Helpers.clamp(Number(x), 0, maxX);
        const localY = Helpers.clamp(Number(y), 0, maxY);

        el.style.position = "absolute";
        el.style.left = `${box.left + localX}px`;
        el.style.top = `${box.top + localY}px`;
        this.#selected = el;
        return el;
    }

    /**
     * Sets the width and height of the selected element.
     * @param {number|string} width Width value.
     * @param {number|string} height Height value.
     * @param {HTMLElement} [el=Elements.#selected] Element to resize.
     * @returns {HTMLElement}
     */
    static size(width, height, el = Elements.#selected) {
        if (!(el instanceof HTMLElement)) {
            throw new Error("No selected element. Create or select an element first.");
        }
        el.style.width = typeof width === "number" ? `${width}px` : String(width);
        el.style.height = typeof height === "number" ? `${height}px` : String(height);
        this.#selected = el;
        return el;
    }

    /**
     * Sets an inline style property on the selected element.
     * @param {string} property CSS property name.
     * @param {string} value CSS property value.
     * @param {HTMLElement} [el=Elements.#selected] Element to style.
     * @returns {HTMLElement}
     */
    static style(property, value, el = Elements.#selected) {
        if (!(el instanceof HTMLElement)) {
            throw new Error("No selected element. Create or select an element first.");
        }
        el.style[property] = value;
        this.#selected = el;
        return el;
    }

    /**
     * Sets the selected element's text content using escaped HTML.
     * @param {string} html Plain-text content.
     * @param {HTMLElement} [el=Elements.#selected] Element to update.
     * @returns {HTMLElement}
     */
    static html(html, el = Elements.#selected) {
        if (!(el instanceof HTMLElement)) {
            throw new Error("No selected element. Create or select an element first.");
        }
        el.innerHTML = this.#strip(String(html ?? ""));
        this.#selected = el;
        return el;
    }

    /**
     * Removes all elements created by Elements, including stopping active capture streams.
     * @returns {void}
     */
    static removeElements() {
        for (const el of this.#created) {
            if (el instanceof HTMLVideoElement && el.srcObject instanceof MediaStream) {
                for (const track of el.srcObject.getTracks()) {
                    track.stop();
                }
            }
            el.remove();
        }
        this.#created.clear();
        this.#selected = null;
    }
    /**
 * Converts a raw string value into the most appropriate JavaScript type.
 *
 * Rules:
 * - "" stays ""
 * - "true" / "false" -> boolean
 * - "null" -> null
 * - numeric strings -> number
 * - JSON object/array strings -> parsed object/array
 * - everything else -> original string
 *
 * @param {*} raw - Raw input value.
 * @returns {*} Parsed JavaScript value.
 */
static #parseValue(raw) {
    if (raw == null) return "";

    // Already a non-string type
    if (typeof raw !== "string") return raw;

    const value = raw.trim();

    if (value === "") return "";

    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (value === "undefined") return undefined;

    // Strict numeric check
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
        return Number(value);
    }

    // JSON object / array
    if (
        (value.startsWith("{") && value.endsWith("}")) ||
        (value.startsWith("[") && value.endsWith("]"))
    ) {
        try {
            return JSON.parse(value);
        } catch {
            // fall through to string
        }
    }

    return raw;
}

/**
 * Gets or sets the value of the currently selected element.
 *
 * Getter mode:
 * - text input values -> string / number / boolean / object / array / null
 * - checkbox -> boolean
 * - number/range -> number
 * - file input -> File | File[] | null
 * - select[multiple] -> Array<*>
 * - radio wrapper -> selected value
 * - checkbox wrapper -> checked state
 *
 * Setter mode:
 * - checkbox / checkbox wrapper -> checked state
 * - number/range -> numeric string value
 * - radio / radio wrapper -> checks matching option
 * - select[multiple] -> selects matching options from an array
 * - file input -> can only be cleared with null / "" for browser security
 * - object / array values -> stored as JSON string for text-like elements
 *
 * @param {*} [v] Value to set. If omitted, the current value is returned.
 * @returns {*} Value of the selected element after get/set.
 */
static value(v) {
    const el = Elements.#selected;
    if (!el) return "";

    const isSetter = arguments.length > 0;

    const serializeValue = (value) => {
        if (value == null) return "";
        if (typeof value === "object") {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }
        return String(value);
    };

    const normalizeBoolean = (value) => {
        const parsed = typeof value === "string" ? Elements.#parseValue(value) : value;
        return Boolean(parsed);
    };

    const valuesEqual = (a, b) => {
        if (a === b) return true;
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return String(a) === String(b);
        }
    };

    // ------------------------------------------------------------
    // Wrapper: createCheckbox() -> <label> with .input
    // ------------------------------------------------------------
    if (el.input instanceof HTMLInputElement) {
        if (isSetter) {
            if (el.input.type === "checkbox") {
                el.input.checked = normalizeBoolean(v);
            } else {
                el.input.value = serializeValue(v);
            }
        }

        if (el.input.type === "checkbox") {
            return el.input.checked;
        }
        return Elements.#parseValue(el.input.value);
    }

    // ------------------------------------------------------------
    // Wrapper: createRadio() -> container with .value() helper
    // ------------------------------------------------------------
    if (!(el instanceof HTMLElement) && typeof el?.value === "function") {
        return isSetter ? v : Elements.#parseValue(el.value());
    }

    if (el instanceof HTMLElement && typeof el.value === "function" && !(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLTextAreaElement)) {
        if (isSetter) {
            const radios = Array.from(el.querySelectorAll('input[type="radio"]'));
            for (const radio of radios) {
                const radioValue = Elements.#parseValue(radio.value);
                radio.checked = valuesEqual(radioValue, v) || String(radio.value) === String(v);
            }
        }
        return Elements.#parseValue(el.value());
    }

    // ------------------------------------------------------------
    // Native input elements
    // ------------------------------------------------------------
    if (el instanceof HTMLInputElement) {
        const type = (el.type || "").toLowerCase();

        if (type === "checkbox") {
            if (isSetter) {
                el.checked = normalizeBoolean(v);
            }
            return el.checked;
        }

        if (type === "radio") {
            if (isSetter) {
                const parsed = Elements.#parseValue(el.value);
                el.checked = valuesEqual(parsed, v) || String(el.value) === String(v);
            }
            return el.checked ? Elements.#parseValue(el.value) : "";
        }

        if (type === "number" || type === "range") {
            if (isSetter) {
                el.value = v == null || v === "" ? "" : String(Number(v));
            }
            return el.value === "" ? "" : Number(el.value);
        }

        if (type === "file") {
            if (isSetter) {
                // Browser security only allows clearing programmatically.
                if (v == null || v === "") {
                    el.value = "";
                }
            }

            if (!el.files || el.files.length === 0) return null;
            return el.multiple ? Array.from(el.files) : el.files[0];
        }

        if (isSetter) {
            el.value = serializeValue(v);
        }
        return Elements.#parseValue(el.value);
    }

    // ------------------------------------------------------------
    // Select elements
    // ------------------------------------------------------------
    if (el instanceof HTMLSelectElement) {
        if (isSetter) {
            if (el.multiple) {
                const wanted = Array.isArray(v) ? v : [v];
                const normalizedWanted = wanted.map((item) =>
                    typeof item === "string" ? Elements.#parseValue(item) : item
                );

                for (const option of Array.from(el.options)) {
                    const parsed = Elements.#parseValue(option.value);
                    option.selected =
                        normalizedWanted.some((item) => valuesEqual(item, parsed)) ||
                        normalizedWanted.some((item) => String(item) === option.value);
                }
            } else {
                el.value = serializeValue(v);
            }
        }

        if (el.multiple) {
            return Array.from(el.selectedOptions).map((option) =>
                Elements.#parseValue(option.value)
            );
        }
        return Elements.#parseValue(el.value);
    }

    // ------------------------------------------------------------
    // Textarea
    // ------------------------------------------------------------
    if (el instanceof HTMLTextAreaElement) {
        if (isSetter) {
            el.value = serializeValue(v);
        }
        return Elements.#parseValue(el.value);
    }

    // ------------------------------------------------------------
    // Generic / contenteditable fallback
    // ------------------------------------------------------------
    if (el instanceof HTMLElement) {
        if (el.isContentEditable) {
            if (isSetter) {
                el.textContent = serializeValue(v);
            }
            return Elements.#parseValue(el.textContent ?? "");
        }

        if ("value" in el && typeof el.value !== "function") {
            if (isSetter) {
                el.value = serializeValue(v);
            }
            return Elements.#parseValue(el.value);
        }

        if (isSetter) {
            el.textContent = serializeValue(v);
        }
        return Elements.#parseValue(el.textContent ?? "");
    }

    return "";
}

/**
 * Triggers an callback on event
 * @param {Event} event Event name
 * @param {Function} callback Callback
 */
static on(event,callback){
    Elements.#selected?.addEventListener(event, callback);
}
};
