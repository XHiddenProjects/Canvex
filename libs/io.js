import { Helpers } from "./helpers.js";
import { Canvex } from "./canvex.js";
export const IO = class{
    constructor(){}
    static JSON = 'json';
    static TEXT = 'text';
    static CSV = 'csv';
    static WAV = 'wav';
    static HTML = 'html';

    /**
     * Helper function to perform HTTP requests using XMLHttpRequest.
     * @param {String} path - The URL to which the request is sent. 
     * @param {String} method - The HTTP method to use (e.g., "GET", "POST"). Default is "GET".
     * @param {String} datatype - The expected data type of the response (e.g., "json", "text"). Default is "json". 
     * @param {*} data  - The data to be sent with the request (for POST, PUT, etc.). Default is null.
     * @param {Object} headers - The headers to include in the request.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the response data or rejects with an error.
     */
    static httpDo(path, method = "GET", datatype = "json", data = null, headers = {}, callback = null, errorCallback = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, path, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const result = xhr.responseText;
                        if (callback) callback(result);
                        resolve(result);
                    } else {
                        const error = new Error(`HTTP error! status: ${xhr.status}`);
                        if (errorCallback) errorCallback(error);
                        reject(error);
                    }
                }
            };
            xhr.send(JSON.stringify(data));
        });
    }
    /**
     * Performs an HTTP GET request.
     * @param {String} path - The URL to which the request is sent.
     * @param {String} datatype - The expected data type of the response (e.g., "json", "text"). Default is "json".
     * @param {Object} headers - The headers to include in the request.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the response data or rejects with an error.
     */
    static httpGet(path, datatype = "json", headers = {}, callback = null, errorCallback = null) {
        return IO.httpDo(path, "GET", datatype, null, headers, callback, errorCallback);
    }
    /**
     * Performs an HTTP POST request.
     * @param {String} path - The URL to which the request is sent.
     * @param {*} data - The data to be sent with the request.
     * @param {String} datatype - The expected data type of the response (e.g., "json", "text"). Default is "json".
     * @param {Object} headers - The headers to include in the request.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the response data or rejects with an error.
     */
    static httpPost(path, data = null, datatype = "json", headers = {}, callback = null, errorCallback = null) {
        return IO.httpDo(path, "POST", datatype, data, headers, callback, errorCallback);
    }
    /**
     * Loads a blob from the specified path.
     * @param {String} path - The URL from which to load the blob.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the loaded blob or rejects with an error.
     */
    static loadBlob(path, callback = null, errorCallback = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.responseType = "blob";
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const blob = xhr.response;
                        if (callback) callback(blob);
                        resolve(blob);
                    } else {
                        const error = new Error(`HTTP error! status: ${xhr.status}`);
                        if (errorCallback) errorCallback(error);
                        reject(error);
                    }
                }
            };
            xhr.send();
        });
    }
    /**
     * Loads an array of bytes from the specified path.
     * @param {String} path - The URL from which to load the bytes.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the loaded bytes or rejects with an error.
     */
    static loadBytes(path, callback = null, errorCallback = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.responseType = "arraybuffer";
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const bytes = new Uint8Array(xhr.response);
                        if (callback) callback(bytes);
                        resolve(bytes);
                    } else {
                        const error = new Error(`HTTP error! status: ${xhr.status}`);
                        if (errorCallback) errorCallback(error);
                        reject(error);
                    }
                }
            };
            xhr.send();
        });
    }
    /**
     * Loads a JSON object from the specified path.
     * @param {String} path - The URL from which to load the JSON.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the loaded JSON or rejects with an error.
     */
    static loadJSON(path, callback = null, errorCallback = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.responseType = "json";
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const json = xhr.response;
                        if (callback) callback(json);
                        resolve(json);
                    } else {
                        const error = new Error(`HTTP error! status: ${xhr.status}`);
                        if (errorCallback) errorCallback(error);
                        reject(error);
                    }
                }
            };
            xhr.send();
        });
    }
    /**
     * Loads a string from the specified path.
     * @param {String} path - The URL from which to load the string.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the loaded string or rejects with an error.
     */
    static loadString(path, callback = null, errorCallback = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.responseType = "text";
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const text = xhr.responseText;
                        if (callback) callback(text);
                        resolve(text);
                    } else {
                        const error = new Error(`HTTP error! status: ${xhr.status}`);
                        if (errorCallback) errorCallback(error);
                        reject(error);
                    }
                }
            };
            xhr.send();
        });
    }
    /**
     * Loads an XML document from the specified path.
     * @param {String} path - The URL from which to load the XML.
     * @param {Function} callback - The function to call on successful completion.
     * @param {Function} errorCallback - The function to call on error.
     * @returns {Promise} A promise that resolves with the loaded XML or rejects with an error.
     */
    static loadXML(path, callback = null, errorCallback = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", path, true);
            xhr.responseType = "document";
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        const xml = xhr.responseXML;
                        if (callback) callback(xml);
                        resolve(xml);
                    } else {
                        const error = new Error(`HTTP error! status: ${xhr.status}`);
                        if (errorCallback) errorCallback(error);
                        reject(error);
                    }
                }
            };
            xhr.send();
        });
    }
    /**
     * Saves data to a file. Note: In a browser environment, this will trigger a download.
     * @param {String|Object} objectOrFilename - If filename is provided, will save canvas as an image with either png or jpg extension depending on the filename. If object is provided, will save depending on the object and filename.
     * @param {String} filename - The filename to use for the download (if objectOrFilename is not a string).
     * @param {Object} options - Additional options, such as datatype for objects.
     */
    static save(objectOrFilename, filename = null, options = {}) {
        if (typeof objectOrFilename === "string") {
            const link = document.createElement("a");
            link.href = Canvex.canvas.toDataURL(`image/${objectOrFilename.split('.').pop()}`);
            link.download = objectOrFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else if (objectOrFilename instanceof HTMLCanvasElement) {
            const link = document.createElement("a");
            link.href = objectOrFilename.toDataURL(`image/${filename.split('.').pop()}`);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else if (objectOrFilename instanceof Object && filename) {
            const datatype = options.datatype || "json";
            let dataStr;
            if (datatype === "json") {
                dataStr = JSON.stringify(objectOrFilename, null, 2);
            } else if (datatype === "text") {
                dataStr = objectOrFilename.toString();
            } else if (datatype === "csv") {
                dataStr = objectOrFilename.map(row => row.join(",")).join("\n");
            } else {
                throw new Error(`Unsupported datatype: ${datatype}`);
            }
            const blob = new Blob([dataStr], { type: "text/plain" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
        } else {
            throw new Error("Invalid arguments for save function.");
        }
    }
    /**
     * Saves a JavaScript object as a JSON file.
     * @param {Object} object - The object to save.
     * @param {string} filename - The filename for the downloaded JSON file.
     */
    static saveJSON(object, filename) {
        IO.save(object, filename, { datatype: "json" });
    }
    /**
     * Saves a string to a text file.
     * @param {string|string[]} strings - The string or array of strings to save.
     * @param {string} filename - The filename for the downloaded text file.
     */
    static saveStrings(strings, filename) {
        IO.save(strings, filename, { datatype: "text" });
    }
    /**
     * Sets the element's content. (XML)
     * @example
     * 
     * myXML = await IO.loadXML('/assets/animals.xml');
     * let reptile = IO.getChild(myXML,'reptile');
     * IO.setContent(reptile,"New content for the XML element");
     * 
     * @param {HTMLCollectionOf<Element>} Element - The XML element to set content for.
     * @param {string} content - The content must be a string only.
     */
    static setContent(Element, content){
        if (Element instanceof Element) Element.textContent = content;
        else throw new Error("setContent can only be called on an XML Element.");
    }
    /**
     * Gets the content of an XML element. (XML)
     * @example
     * 
     * myXML = await IO.loadXML('/assets/animals.xml');
     * let reptile = IO.getChild(myXML,'reptile');
     * let content = IO.getContent(reptile);
     * 
     * @param {HTMLCollectionOf<Element>} Element - The XML element to get content from.
     * @returns {string} - The content of the XML element.
     */
    static getContent(Element){
        if (Element instanceof Element) return Element.textContent;
        else throw new Error("getContent can only be called on an XML Element.");
    }
    /**
     * Gets the first child element with the specified name. (XML)
     * @param {Element} xml - The XML element to search within.
     * @param {string} childName - The name of the child element to find.
     * @returns {Element|null} - The first child element with the specified name, or null if not found.
     */
    static getChild(Element, childName){
        if (Element instanceof Element) return Element.getElementsByTagName(childName)[0];
        else throw new Error("getChild can only be called on an XML Element.");
    }
    /**
     * Active writable stream instance.
     * @type {WritableStream|null}
     */
    static currentStream = null;

    /**
     * Active writer for the current stream.
     * @type {WritableStreamDefaultWriter|null}
     */
    static currentWriter = null;

    /**
     * Active filename for the current stream.
     * @type {string|null}
     */
    static currentFilename = null;

    /**
     * Returns the active writer, creating it if needed.
     *
     * @private
     * @returns {WritableStreamDefaultWriter}
     * @throws {Error} Thrown when there is no active stream.
     */
    static #ensureWriter() {
        if (!this.currentStream) {
            throw new Error(
                "No active stream. Please create a stream using IO.createWriter() before writing."
            );
        }

        if (!this.currentWriter) {
            try {
                this.currentWriter = this.currentStream.getWriter();
            } catch (error) {
                throw new Error(
                    "The current stream is already locked by another writer. Use IO.write()/IO.print()/IO.close() consistently, or manage the writer manually."
                );
            }
        }

        return this.currentWriter;
    }

    /**
     * Creates a writable stream for writing file data.
     *
     * The stream buffers written chunks in memory and triggers a browser download
     * when the stream is closed.
     *
     * @param {string} name Filename for the stream. If the extension is not already present, it will be appended.
     * @param {string} [extension='txt'] File extension to use when one is not already present.
     * @returns {WritableStream} A writable stream that can be used to write data. In a browser environment, closing the stream triggers a download.
     *
     * @example
     * IO.createWriter("notes", "txt");
     * await IO.print("Hello");
     * await IO.print("World");
     * await IO.close();
     */
    static createWriter(name, extension = 'txt') {
        if (this.currentStream || this.currentWriter) {
            throw new Error(
                "A stream is already active. Please close the current stream before creating a new one."
            );
        }

        const safeExtension = String(extension || 'txt').replace(/^\./, '');
        const safeName = String(name || 'output');
        const filename = safeName.endsWith(`.${safeExtension}`)
            ? safeName
            : `${safeName}.${safeExtension}`;

        const encoder = new TextEncoder();
        const chunks = [];

        const stream = new WritableStream({
            write(chunk) {
                if (typeof chunk === 'string') {
                    chunks.push(encoder.encode(chunk));
                    return;
                }

                if (chunk instanceof Uint8Array) {
                    chunks.push(chunk);
                    return;
                }

                if (chunk instanceof ArrayBuffer) {
                    chunks.push(new Uint8Array(chunk));
                    return;
                }

                if (chunk instanceof Blob) {
                    chunks.push(chunk);
                    return;
                }

                throw new TypeError(
                    'Unsupported chunk type. Expected string, Uint8Array, ArrayBuffer, or Blob.'
                );
            },

            close() {
                const blob = new Blob(chunks, { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);

                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = filename;
                anchor.style.display = 'none';

                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();

                // Delay revocation slightly so the browser has time to start the download.
                setTimeout(() => URL.revokeObjectURL(url), 0);
            },

            abort(reason) {
                console.error('Writer stream aborted:', reason);
            }
        });

        this.currentStream = stream;
        this.currentWriter = null;
        this.currentFilename = filename;

        return stream;
    }

    /**
     * Writes data to the current stream without appending a newline.
     *
     * @param {string|number|string[]|number[]|Uint8Array|ArrayBuffer|Blob} data Data to write.
     * @returns {Promise<void>} Resolves when the chunk has been written.
     *
     * @example
     * IO.createWriter("log");
     * await IO.write("Hello ");
     * await IO.write("world");
     * await IO.close();
     */
    static write(...data) {
        data = data.flat();
        const writer = this.#ensureWriter();

        let chunk;

        if (
            data instanceof Uint8Array ||
            data instanceof ArrayBuffer ||
            data instanceof Blob
        ) {
            chunk = data;
        } else if (Array.isArray(data)) {
            chunk = data.join('');
        } else {
            chunk = String(data);
        }

        return writer.write(chunk);
    }

    /**
     * Writes data to the current stream and appends a newline.
     *
     * For arrays, values are joined with newline characters and a final newline
     * is appended to the whole chunk.
     *
     * @param {string|number|string[]|number[]} data Data to print.
     * @returns {Promise<void>} Resolves when the chunk has been written.
     *
     * @example
     * IO.createWriter("output");
     * await IO.print("First line");
     * await IO.print(["Second line", "Third line"]);
     * await IO.close();
     */
    static print(...data) {
        data = data.flat();
        const writer = this.#ensureWriter();
        const chunk = Array.isArray(data)
            ? `${data.map(value => String(value)).join('\n')}\n`
            : `${String(data)}\n`;
        return writer.write(chunk);
    }

    /**
     * Closes the current stream and triggers the file download.
     *
     * @returns {Promise<void>} Resolves when the stream has been closed.
     * @throws {Error} Thrown when there is no active stream.
     *
     * @example
     * IO.createWriter("example", "txt");
     * await IO.print("Done");
     * await IO.close();
     */
    static async close() {
        const writer = this.#ensureWriter();

        try {
            await writer.close();
        } finally {
            try {
                writer.releaseLock?.();
            } catch {
                // Ignore release errors after close.
            }

            this.currentWriter = null;
            this.currentStream = null;
            this.currentFilename = null;
        }
    }

    /**
     * Aborts the current stream and clears internal writer state.
     *
     * @param {any} [reason='Aborted by user'] Abort reason.
     * @returns {Promise<void>}
     * @throws {Error} Thrown when there is no active stream.
     */
    static async abort(reason = 'Aborted by user') {
        const writer = this.#ensureWriter();

        try {
            await writer.abort(reason);
        } finally {
            try {
                writer.releaseLock?.();
            } catch {
                // Ignore release errors after abort.
            }

            this.currentWriter = null;
            this.currentStream = null;
            this.currentFilename = null;
        }
    }
}