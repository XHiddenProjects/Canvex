import { Canvex } from "./canvex.js";

/**
 * Keyboard input utility.
 */
export const Keyboard = class {
  /**
   * The value of the last key typed.
   * @type {string|null}
   */
  static key = null;

  /**
   * The physical key code of the last key event.
   * Example: "KeyW", "ArrowUp", "Space"
   * @type {string|null}
   */
  static code = null;

  /**
   * The keyCode of the last key pressed.
   * @type {number|null}
   */
  static keyCode = null;

  /**
   * True if any key is currently pressed.
   * @type {boolean}
   */
  static keyIsPressed = false;

  /**
   * Set of currently pressed physical keys.
   * @type {Set<string>}
   * @private
   */
  static #pressedKeys = new Set();

  /**
   * Called once when any key is pressed.
   * Override this to handle the event.
   *
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  static keyPressed = (event) => {};

  /**
   * Called once when any key is released.
   * Override this to handle the event.
   *
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  static keyReleased = (event) => {};

  /**
   * Called once when a printable character key is typed.
   * Does not fire for modifier keys like Shift, Ctrl, Alt, etc.
   *
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  static keyTyped = (event) => {};

  /**
   * Returns true if the specified physical key is currently held down.
   *
   * Examples:
   * - "ArrowUp"
   * - "KeyW"
   * - "Space"
   * - "Enter"
   *
   * @param {string} code - A physical keyboard key code.
   * @returns {boolean}
   */
  static keyIsDown(code) {
    return this.#pressedKeys.has(code);
  }

  /**
   * Internal keydown handler.
   *
   * @param {KeyboardEvent} e
   * @returns {void}
   * @private
   */
  static #handleKeyDown(e) {
    this.key = e.key;
    this.code = e.code;
    this.keyCode = e.keyCode;
    this.keyIsPressed = true;

    const alreadyPressed = this.#pressedKeys.has(e.code);
    this.#pressedKeys.add(e.code);

    // Fire only once per actual press, not continuously while held
    if (!alreadyPressed) {
      this.keyPressed(e);
    }

    // Fire only for printable characters
    if (e.key.length === 1) {
      this.keyTyped(e);
    }
  }

  /**
   * Internal keyup handler.
   *
   * @param {KeyboardEvent} e
   * @returns {void}
   * @private
   */
  static #handleKeyUp(e) {
    this.key = e.key;
    this.code = e.code;
    this.keyCode = e.keyCode;

    this.#pressedKeys.delete(e.code);
    this.keyIsPressed = this.#pressedKeys.size > 0;

    this.keyReleased(e);
  }

  /**
   * Internal blur handler to prevent "stuck keys"
   * when the window loses focus.
   *
   * @returns {void}
   * @private
   */
  static #handleBlur() {
    this.#pressedKeys.clear();
    this.keyIsPressed = false;
  }

  /**
   * Automatically attach keyboard listeners when the class is evaluated.
   */
  static {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (e) => this.#handleKeyDown(e));
      window.addEventListener("keyup", (e) => this.#handleKeyUp(e));
      window.addEventListener("blur", () => this.#handleBlur());
    }
  }
}

/**
 * Pointer / mouse / touch input utility.
 */
export const pointer = class {
  /**
   * Current mouse X position relative to the target element.
   * If a canvas exists, this will be relative to the canvas.
   * Otherwise, it falls back to window coordinates.
   *
   * @type {number}
   */
  static mouseX = 0;

  /**
   * Current mouse Y position relative to the target element.
   * If a canvas exists, this will be relative to the canvas.
   * Otherwise, it falls back to window coordinates.
   *
   * @type {number}
   */
  static mouseY = 0;

  /**
   * Previous mouse X position relative to the target element.
   *
   * @type {number}
   */
  static pmouseX = 0;

  /**
   * Previous mouse Y position relative to the target element.
   *
   * @type {number}
   */
  static pmouseY = 0;

  /**
   * Current mouse X position in the browser window.
   *
   * @type {number}
   */
  static winMouseX = 0;

  /**
   * Current mouse Y position in the browser window.
   *
   * @type {number}
   */
  static winMouseY = 0;

  /**
   * Previous mouse X position in the browser window.
   *
   * @type {number}
   */
  static pwinMouseX = 0;

  /**
   * Previous mouse Y position in the browser window.
   *
   * @type {number}
   */
  static pwinMouseY = 0;

  /**
   * Horizontal mouse movement since the last event.
   *
   * @type {number}
   */
  static movedX = 0;

  /**
   * Vertical mouse movement since the last event.
   *
   * @type {number}
   */
  static movedY = 0;

  /**
   * True if any mouse button is currently pressed.
   *
   * @type {boolean}
   */
  static mouseIsPressed = false;

  /**
   * Tracks which mouse buttons are currently pressed.
   *
   * - `left`
   * - `middle`
   * - `right`
   *
   * @type {{ left: boolean, middle: boolean, right: boolean }}
   */
  static mouseButton = {
    left: false,
    middle: false,
    right: false,
  };

  /**
   * Array of current active touches.
   *
   * Each touch contains:
   * - `id`
   * - `x`
   * - `y`
   * - `winX`
   * - `winY`
   *
   * @type {Array<{id:number,x:number,y:number,winX:number,winY:number}>}
   */
  static touches = [];

  static get x(){
    return this.mouseX;
  }

  static get y(){
    return this.mouseY;
  }

  /**
   * Called once when a mouse button is clicked.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  static mouseClicked = (event) => {};

  /**
   * Called once when a mouse button is double-clicked.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  static doubleClicked = (event) => {};

  /**
   * Called when the mouse moves while a button is pressed.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  static mouseDragged = (event) => {};

  /**
   * Called when the mouse moves with no button pressed.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  static mouseMoved = (event) => {};

  /**
   * Called once when a mouse button is pressed.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  static mousePressed = (event) => {};

  /**
   * Called once when a mouse button is released.
   *
   * @param {MouseEvent} event
   * @returns {void}
   */
  static mouseReleased = (event) => {};

  /**
   * Called once when the mouse wheel moves.
   *
   * @param {WheelEvent} event
   * @returns {void}
   */
  static mouseWheel = (event) => {};

  /**
   * Requests pointer lock on an element.
   *
   * Note:
   * This must usually be called from a user gesture
   * such as a click or mousedown.
   *
   * @param {HTMLElement} [element=document.body]
   * @returns {void}
   */
  static requestPointerLock(element = document.body) {
    if (!element || typeof element.requestPointerLock !== "function") return;
    element.requestPointerLock();
  }

  /**
   * Exits the current pointer lock, if active.
   *
   * @returns {void}
   */
  static exitPointerLock() {
    if (typeof document !== "undefined" && typeof document.exitPointerLock === "function") {
      document.exitPointerLock();
    }
  }

  /**
   * Returns the target element used for local mouse coordinates.
   *
   * Priority:
   * 1. `window.Canvex.canvas` if available
   * 2. First `<canvas>` element in the document
   * 3. `null` (falls back to window coordinates)
   *
   * @returns {HTMLCanvasElement|null}
   * @private
   */
  static #getTargetElement() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return null;
    }

    if (window.Canvex && window.Canvex.canvas instanceof HTMLCanvasElement) {
      return window.Canvex.canvas;
    }

    return document.querySelector("canvas");
  }

  /**
   * Updates previous/current mouse position values from a mouse event.
   *
   * @param {MouseEvent} e
   * @returns {void}
   * @private
   */
  static #updateMousePosition(e) {
    this.pmouseX = this.mouseX;
    this.pmouseY = this.mouseY;
    this.pwinMouseX = this.winMouseX;
    this.pwinMouseY = this.winMouseY;

    this.winMouseX = e.clientX;
    this.winMouseY = e.clientY;

    const target = this.#getTargetElement();

    if (target) {
      const rect = target.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    } else {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    }

    this.movedX =
      typeof e.movementX === "number"
        ? e.movementX
        : this.winMouseX - this.pwinMouseX;

    this.movedY =
      typeof e.movementY === "number"
        ? e.movementY
        : this.winMouseY - this.pwinMouseY;
  }

  /**
   * Updates the current touch list from a touch event.
   *
   * @param {TouchEvent} e
   * @returns {void}
   * @private
   */
  static #updateTouches(e) {
    const target = this.#getTargetElement();
    const rect = target
      ? target.getBoundingClientRect()
      : { left: 0, top: 0 };

    this.touches = Array.from(e.touches, (touch) => ({
      id: touch.identifier,
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
      winX: touch.clientX,
      winY: touch.clientY,
    }));

    // Mirror the first touch into mouse-style coordinates if present.
    if (this.touches.length > 0) {
      const first = this.touches[0];

      this.pmouseX = this.mouseX;
      this.pmouseY = this.mouseY;
      this.pwinMouseX = this.winMouseX;
      this.pwinMouseY = this.winMouseY;

      this.mouseX = first.x;
      this.mouseY = first.y;
      this.winMouseX = first.winX;
      this.winMouseY = first.winY;

      this.movedX = this.mouseX - this.pmouseX;
      this.movedY = this.mouseY - this.pmouseY;
    }
  }

  /**
   * Updates a button state from a native mouse button value.
   *
   * 0 = left
   * 1 = middle
   * 2 = right
   *
   * @param {number} button
   * @param {boolean} pressed
   * @returns {void}
   * @private
   */
  static #setButton(button, pressed) {
    if (button === 0) this.mouseButton.left = pressed;
    if (button === 1) this.mouseButton.middle = pressed;
    if (button === 2) this.mouseButton.right = pressed;

    this.mouseIsPressed =
      this.mouseButton.left ||
      this.mouseButton.middle ||
      this.mouseButton.right;
  }

  /**
   * Clears all button/touch pressed states.
   *
   * @returns {void}
   * @private
   */
  static #resetPressState() {
    this.mouseButton.left = false;
    this.mouseButton.middle = false;
    this.mouseButton.right = false;
    this.mouseIsPressed = false;
    this.touches = [];
  }
  /**
   * Returns true if any mouse button is currently pressed.
   * @returns {boolean}
   */
  static get isPressed(){
    return this.mouseIsPressed;
  }

  /**
   * Automatically attach all input listeners on import.
   */
  static {
    

    window.addEventListener("mousemove", (e) => {
      this.#updateMousePosition(e);

      if (this.mouseIsPressed) {
        this.mouseDragged(e);
      } else {
        this.mouseMoved(e);
      }
    });

    window.addEventListener("mousedown", (e) => {
      this.#updateMousePosition(e);
      this.#setButton(e.button, true);
      this.mousePressed(e);
    });

    window.addEventListener("mouseup", (e) => {
      this.#updateMousePosition(e);
      this.#setButton(e.button, false);
      this.mouseReleased(e);
    });

    window.addEventListener("click", (e) => {
      this.#updateMousePosition(e);
      this.mouseClicked(e);
    });

    window.addEventListener("dblclick", (e) => {
      this.#updateMousePosition(e);
      this.doubleClicked(e);
    });

    window.addEventListener("wheel", (e) => {
      this.#updateMousePosition(e);
      this.mouseWheel(e);
    }, { passive: true });

    window.addEventListener("touchstart", (e) => {
      this.#updateTouches(e);
      this.mouseIsPressed = this.touches.length > 0;
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      this.#updateTouches(e);
      this.mouseIsPressed = this.touches.length > 0;

      if (this.mouseIsPressed) {
        this.mouseDragged(e);
      } else {
        this.mouseMoved(e);
      }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
      this.#updateTouches(e);
      this.mouseIsPressed = this.touches.length > 0;

      if (!this.mouseIsPressed) {
        this.#resetPressState();
      }
    }, { passive: true });

    window.addEventListener("touchcancel", () => {
      this.#resetPressState();
    }, { passive: true });

    window.addEventListener("blur", () => {
      this.#resetPressState();
    });
  }
};