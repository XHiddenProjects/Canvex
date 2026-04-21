import { Canvex } from "./canvex.js"
export const Image = class{
    // Blend Mode Constants
    static BLEND = 'normal';
    static NORMAL = 'normal';
    static MULTIPLY = 'multiply';
    static SCREEN = 'screen';
    static OVERLAY = 'overlay';
    static DARKEST = 'darken';
    static LIGHTEST = 'lighten';
    static DIFFERENCE = 'difference';
    static EXCLUSION = 'exclusion';
    static HARD_LIGHT = 'hard-light';
    static SOFT_LIGHT = 'soft-light';
    static DODGE = 'color-dodge';
    static BURN = 'color-burn';
    static ADD = 'add';
    static REPLACE = 'replace';
    
    // Filter Mode Constants
    static GRAYSCALE = 'grayscale';
    static INVERT = 'invert';
    static SEPIA = 'sepia';
    static BLUR = 'blur';
    static BRIGHTNESS = 'brightness';

    /**
     * Creates a new Image instance.
     */
    constructor(){
        this.width = 0;
        this.height = 0;
        this.pixels = new Uint8ClampedArray();
        this._pixelDensity = 1;
        this._canvas = null;
        this._ctx = null;
        this._isAnimated = false;
        this._frames = [];
        this._currentFrame = 0;
        this._isPlaying = false;
        this._frameDelay = 100;
        this._animationInterval = null;
    }

    /**
     * Gets or sets the pixel density of the image.
     * @param {Image} img - The image instance.
     * @param {number} [density] - The pixel density to set. If not provided, returns current density.
     * @returns {number|Image} The current pixel density if getting, or the Image instance for chaining if setting.
     */
    static pixelDensity(img, density){
        if(density !== undefined){
            img._pixelDensity = density;
            return img;
        }
        return img._pixelDensity;
    }

    /**
     * Loads pixel data from the internal canvas context into the pixels array.
     * Creates an internal canvas if it doesn't exist.
     * @param {Image} img - The image instance.
     * @returns {Image} This Image instance for method chaining.
     */
    static loadPixels(img){
        if(!img._canvas){
            img._canvas = document.createElement('canvas');
            img._canvas.width = img.width;
            img._canvas.height = img.height;
            img._ctx = img._canvas.getContext('2d');
        }
        const imageData = img._ctx.getImageData(0, 0, img.width, img.height);
        img.pixels = imageData.data;
        return img;
    }

    /**
     * Updates the internal canvas with the current pixel data.
     * Creates an internal canvas if it doesn't exist.
     * @param {Image} img - The image instance.
     * @returns {Image} This Image instance for method chaining.
     */
    static updatePixels(img){
        if(!img._canvas){
            img._canvas = document.createElement('canvas');
            img._canvas.width = img.width;
            img._canvas.height = img.height;
            img._ctx = img._canvas.getContext('2d');
        }
        const imageData = img._ctx.createImageData(img.width, img.height);
        imageData.data.set(img.pixels);
        img._ctx.putImageData(imageData, 0, 0);
        return img;
    }

    /**
     * Gets the color of a pixel at the specified coordinates.
     * @param {Image} img - The image instance.
     * @param {number} x - The x-coordinate of the pixel.
     * @param {number} y - The y-coordinate of the pixel.
     * @returns {number[]|null} An array [r, g, b, a] representing the pixel color, or null if out of bounds.
     */
    static get(img, x, y){
        if(x < 0 || x >= img.width || y < 0 || y >= img.height) return null;
        const index = (Math.floor(y) * img.width + Math.floor(x)) * 4;
        return [
            img.pixels[index],
            img.pixels[index + 1],
            img.pixels[index + 2],
            img.pixels[index + 3]
        ];
    }

    /**
     * Sets the color of a pixel at the specified coordinates.
     * @param {Image} img - The image instance.
     * @param {number} x - The x-coordinate of the pixel.
     * @param {number} y - The y-coordinate of the pixel.
     * @param {...(number|number[]|Object)} color - Color values as either an array [r, g, b, a], a color object {r, g, b, a}, or individual parameters (r, g, b, [a]).
     * @returns {Image} This Image instance for method chaining.
     */
    static set(img, x, y, ...color){
        if(x < 0 || x >= img.width || y < 0 || y >= img.height) return img;
        
        let r, g, b, a = 255;
        if(Array.isArray(color[0])){
            [r, g, b, a = 255] = color[0];
        } else if(color[0] && typeof color[0] === 'object' && !Array.isArray(color[0])){
            // Handle color objects like { r: 255, g: 0, b: 0, a: 255 }
            r = color[0].r ?? 0;
            g = color[0].g ?? 0;
            b = color[0].b ?? 0;
            a = color[0].a ?? 255;
        } else {
            [r, g, b, a = 255] = color;
        }
        const index = (Math.floor(y) * img.width + Math.floor(x)) * 4;
        img.pixels[index] = r;
        img.pixels[index + 1] = g;
        img.pixels[index + 2] = b;
        img.pixels[index + 3] = a;
        return img;
    }

    /**
     * Resizes the image to new dimensions using canvas scaling.
     * @param {Image} img - The image instance.
     * @param {number} newWidth - The new width in pixels.
     * @param {number} newHeight - The new height in pixels.
     * @returns {Image} This Image instance for method chaining.
     */
    static resize(img, newWidth, newHeight){
        const newPixels = new Uint8ClampedArray(newWidth * newHeight * 4);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        const imgData = ctx.createImageData(img.width, img.height);
        imgData.data.set(img.pixels);
        ctx.putImageData(imgData, 0, 0);

        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = newWidth;
        resizeCanvas.height = newHeight;
        const resizeCtx = resizeCanvas.getContext('2d');
        resizeCtx.drawImage(canvas, 0, 0, img.width, img.height, 0, 0, newWidth, newHeight);

        const resizedData = resizeCtx.getImageData(0, 0, newWidth, newHeight);
        img.pixels = resizedData.data;
        img.width = newWidth;
        img.height = newHeight;
        return img;
    }

    /**
     * Copies a region from a source image into this image.
     * @param {Image} destImg - The destination image instance.
     * @param {Image} srcImage - The source image to copy from.
     * @param {number} [sx=0] - Source x-coordinate.
     * @param {number} [sy=0] - Source y-coordinate.
     * @param {number} [sw=srcImage.width] - Source width.
     * @param {number} [sh=srcImage.height] - Source height.
     * @param {number} [dx=0] - Destination x-coordinate.
     * @param {number} [dy=0] - Destination y-coordinate.
     * @param {number} [dw=sw] - Destination width.
     * @param {number} [dh=sh] - Destination height.
     * @returns {Image} This Image instance for method chaining.
     */
    static copy(destImg, srcImage, sx = 0, sy = 0, sw = srcImage.width, sh = srcImage.height, dx = 0, dy = 0, dw = sw, dh = sh){
        const canvas = document.createElement('canvas');
        canvas.width = srcImage.width;
        canvas.height = srcImage.height;
        const ctx = canvas.getContext('2d');
        
        const imgData = ctx.createImageData(srcImage.width, srcImage.height);
        imgData.data.set(srcImage.pixels);
        ctx.putImageData(imgData, 0, 0);

        const destCanvas = document.createElement('canvas');
        destCanvas.width = destImg.width;
        destCanvas.height = destImg.height;
        const destCtx = destCanvas.getContext('2d');
        
        const destImgData = destCtx.createImageData(destImg.width, destImg.height);
        destImgData.data.set(destImg.pixels);
        destCtx.putImageData(destImgData, 0, 0);

        destCtx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
        
        const finalData = destCtx.getImageData(0, 0, destImg.width, destImg.height);
        destImg.pixels = finalData.data;
        return destImg;
    }

    /**
     * Applies an alpha mask to this image using another image's alpha channel.
     * @param {Image} img - The image instance.
     * @param {Image} maskImage - The image to use as a mask (alpha channel applied).
     * @returns {Image} This Image instance for method chaining.
     */
    static mask(img, maskImage){
        for(let i = 0; i < img.pixels.length; i += 4){
            const alpha = maskImage.pixels[i + 3] || maskImage.pixels[i];
            img.pixels[i + 3] = (img.pixels[i + 3] * alpha) / 255;
        }
        return img;
    }

    /**
     * Applies a filter effect to the image.
     * @param {Image} img - The image instance.
     * @param {'grayscale'|'invert'|'sepia'|'blur'|'brightness'} type - The type of filter: 'grayscale', 'invert', 'sepia', 'blur', or 'brightness'.
     * @param {number} [amount=1] - The intensity of the filter (meaning varies by filter type).
     * @returns {Image} This Image instance for method chaining.
     */
    static filter(img, type, amount = 1){
        switch(type.toLowerCase()){
            case 'grayscale':
                for(let i = 0; i < img.pixels.length; i += 4){
                    const gray = img.pixels[i] * 0.299 + img.pixels[i + 1] * 0.587 + img.pixels[i + 2] * 0.114;
                    img.pixels[i] = gray;
                    img.pixels[i + 1] = gray;
                    img.pixels[i + 2] = gray;
                }
                break;
            case 'invert':
                for(let i = 0; i < img.pixels.length; i += 4){
                    img.pixels[i] = 255 - img.pixels[i];
                    img.pixels[i + 1] = 255 - img.pixels[i + 1];
                    img.pixels[i + 2] = 255 - img.pixels[i + 2];
                }
                break;
            case 'sepia':
                for(let i = 0; i < img.pixels.length; i += 4){
                    const r = img.pixels[i];
                    const g = img.pixels[i + 1];
                    const b = img.pixels[i + 2];
                    img.pixels[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
                    img.pixels[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
                    img.pixels[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
                }
                break;
            case 'brightness':
                for(let i = 0; i < img.pixels.length; i += 4){
                    img.pixels[i] = Math.min(255, img.pixels[i] * amount);
                    img.pixels[i + 1] = Math.min(255, img.pixels[i + 1] * amount);
                    img.pixels[i + 2] = Math.min(255, img.pixels[i + 2] * amount);
                }
                break;
            case 'blur':
                Image._blurImage(img, amount);
                break;
        }
        return img;
    }

    /**
     * Internal helper method that applies a box blur filter to the image.
     * @private
     * @param {Image} img - The image instance.
     * @param {number} [radius=1] - The blur radius in pixels.
     */
    static _blurImage(img, radius = 1){
        const blurred = new Uint8ClampedArray(img.pixels.length);
        radius = Math.floor(radius);
        
        for(let y = 0; y < img.height; y++){
            for(let x = 0; x < img.width; x++){
                let r = 0, g = 0, b = 0, a = 0, count = 0;
                
                for(let dy = -radius; dy <= radius; dy++){
                    for(let dx = -radius; dx <= radius; dx++){
                        const px = x + dx;
                        const py = y + dy;
                        if(px >= 0 && px < img.width && py >= 0 && py < img.height){
                            const idx = (py * img.width + px) * 4;
                            r += img.pixels[idx];
                            g += img.pixels[idx + 1];
                            b += img.pixels[idx + 2];
                            a += img.pixels[idx + 3];
                            count++;
                        }
                    }
                }
                
                const idx = (y * img.width + x) * 4;
                blurred[idx] = r / count;
                blurred[idx + 1] = g / count;
                blurred[idx + 2] = b / count;
                blurred[idx + 3] = a / count;
            }
        }
        
        img.pixels = blurred;
    }

    /**
     * Blends another image with this image using the specified blend mode.
     * @param {Image} img - The image instance.
     * @param {Image} image - The image to blend with this one.
     * @param {string} [mode='normal'] - The blend mode: 'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'add', or 'replace'.
     * @param {number} [opacity=1] - The opacity of the blend (0-1).
     * @returns {Image} This Image instance for method chaining.
     */
    static blend(img, image, mode = 'normal', opacity = 1){
        const blendFunc = (cb, cs) => {
            switch(mode.toLowerCase()){
                case 'multiply':
                    return cb * cs;
                case 'screen':
                    return 1 - (1 - cb) * (1 - cs);
                case 'overlay':
                    return cb < 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
                case 'hard-light':
                    return cs < 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
                case 'soft-light':
                    return cs < 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * (cb < 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb) - cb);
                case 'darken':
                    return Math.min(cb, cs);
                case 'lighten':
                    return Math.max(cb, cs);
                case 'difference':
                    return Math.abs(cb - cs);
                case 'exclusion':
                    return cb + cs - 2 * cb * cs;
                case 'color-dodge':
                    return cs === 0 ? 0 : cb === 1 ? 1 : Math.min(1, cb / (1 - cs));
                case 'color-burn':
                    return cs === 1 ? 1 : cb === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
                case 'add':
                    return Math.min(1, cb + cs);
                case 'replace':
                    return cs;
                default: // normal
                    return cb * (1 - opacity) + cs * opacity;
            }
        };

        for(let i = 0; i < img.pixels.length; i += 4){
            const a = img.pixels[i] / 255;
            const b = img.pixels[i + 1] / 255;
            const c = img.pixels[i + 2] / 255;
            
            const a2 = image.pixels[i] / 255;
            const b2 = image.pixels[i + 1] / 255;
            const c2 = image.pixels[i + 2] / 255;

            const blended = [
                blendFunc(a, a2),
                blendFunc(b, b2),
                blendFunc(c, c2)
            ];

            img.pixels[i] = Math.min(255, blended[0] * 255);
            img.pixels[i + 1] = Math.min(255, blended[1] * 255);
            img.pixels[i + 2] = Math.min(255, blended[2] * 255);
        }
        return img;
    }

    /**
     * Saves the image as a PNG file by triggering a download.
     * @param {Image} img - The image instance.
     * @param {string} [filename='image.png'] - The filename for the downloaded image.
     * @returns {Image} This Image instance for method chaining.
     */
    static save(img, filename){
        if(!img._canvas){
            img._canvas = document.createElement('canvas');
            img._canvas.width = img.width;
            img._canvas.height = img.height;
            img._ctx = img._canvas.getContext('2d');
        }
        
        const imgData = img._ctx.createImageData(img.width, img.height);
        imgData.data.set(img.pixels);
        img._ctx.putImageData(imgData, 0, 0);

        const link = document.createElement('a');
        link.download = filename || 'image.png';
        link.href = img._canvas.toDataURL('image/png');
        link.click();
        return img;
    }

    /**
     * Resets all pixel data to transparent (alpha = 0).
     * @param {Image} img - The image instance.
     * @returns {Image} This Image instance for method chaining.
     */
    static reset(img){
        img.pixels.fill(0);
        return img;
    }

    /**
     * Gets the index of the currently displayed frame in a GIF animation.
     * @param {Image} img - The image instance.
     * @returns {number} The current frame index.
     */
    static getCurrentFrame(img){
        return img._currentFrame;
    }

    /**
     * Sets the current frame to display from the animation frames.
     * @param {Image} img - The image instance.
     * @param {number} frameIndex - The index of the frame to set (0-based).
     * @returns {Image} This Image instance for method chaining.
     */
    static setFrame(img, frameIndex){
        if(frameIndex >= 0 && frameIndex < img._frames.length){
            img._currentFrame = frameIndex;
            img.pixels = new Uint8ClampedArray(img._frames[frameIndex]);
        }
        return img;
    }

    /**
     * Gets the total number of frames in the animation.
     * @param {Image} img - The image instance.
     * @returns {number} The number of animation frames.
     */
    static numFrames(img){
        return img._frames.length;
    }

    /**
     * Starts playing the GIF animation from the current frame.
     * Does nothing if animation is already playing or no frames exist.
     * @param {Image} img - The image instance.
     * @returns {Image} This Image instance for method chaining.
     */
    static play(img){
        if(!img._isAnimated || img._isPlaying) return img;
        img._isPlaying = true;
        
        img._animationInterval = setInterval(() => {
            img._currentFrame = (img._currentFrame + 1) % img._frames.length;
            img.pixels = new Uint8ClampedArray(img._frames[img._currentFrame]);
        }, img._frameDelay);
        
        return img;
    }

    /**
     * Pauses the GIF animation at the current frame.
     * @param {Image} img - The image instance.
     * @returns {Image} This Image instance for method chaining.
     */
    static pause(img){
        if(img._animationInterval){
            clearInterval(img._animationInterval);
            img._animationInterval = null;
        }
        img._isPlaying = false;
        return img;
    }

    /**
     * Sets the delay between animation frames. If animation is playing, it restarts with the new delay.
     * @param {Image} img - The image instance.
     * @param {number} ms - The delay in milliseconds between frames.
     * @returns {Image} This Image instance for method chaining.
     */
    static delay(img, ms){
        img._frameDelay = ms;
        if(img._isPlaying){
            Image.pause(img);
            Image.play(img);
        }
        return img;
    }

    /**
     * Adds a frame to the animation. After adding a second frame, the image becomes animated.
     * @param {Image} img - The image instance.
     * @param {Uint8ClampedArray} pixelData - The pixel data for the frame.
     * @returns {Image} This Image instance for method chaining.
     */
    static addFrame(img, pixelData){
        img._frames.push(new Uint8ClampedArray(pixelData));
        if(img._frames.length > 1) img._isAnimated = true;
        return img;
    }

    /**
     * Draws the image to a canvas context at the specified position.
     * @param {Image} img - The image instance.
     * @param {number} [x=0] - The x-coordinate where the image will be drawn.
     * @param {number} [y=0] - The y-coordinate where the image will be drawn.
     * @param {number} [w=img.width] - The width to draw the image.
     * @param {number} [h=img.height] - The height to draw the image.
     * @returns {Image} This Image instance for method chaining.
     */
    static _draw(img, x = 0, y = 0, w, h){
        const ctx = Canvex.ctx;
        w = w ?? img.width;
        h = h ?? img.height;
        
        if (w === img.width && h === img.height) {
            const imageData = new ImageData(img.pixels, img.width, img.height);
            ctx.putImageData(imageData, x, y);
        } else {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext('2d');
            const imageData = new ImageData(img.pixels, img.width, img.height);
            tempCtx.putImageData(imageData, 0, 0);
            ctx.drawImage(tempCanvas, x, y, w, h);
        }
        return img;
    }

    /**
     * Loads an image from a file path and creates a new Image instance.
     * @static
     * @param {string} path - The file path or URL of the image to load.
     * @returns {Promise<Image>} Promise that resolves with the loaded Image instance.
     */
    static load(path){
        return new Promise((resolve, reject) => {
            const nativeImg = new window.Image();
            nativeImg.onload = function(){
                const canvexImg = new Image();
                canvexImg.width = this.width;
                canvexImg.height = this.height;
                
                const canvas = document.createElement('canvas');
                canvas.width = this.width;
                canvas.height = this.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(this, 0, 0);
                
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                
                canvexImg.pixels = imageData.data;
                resolve(canvexImg);
            }
            nativeImg.onerror = function(){
                reject(new Error(`Failed to load image from: ${path}`));
            }
            nativeImg.crossOrigin = 'anonymous';
            nativeImg.src = path;
        });
    }

}