import { Canvex } from "./canvex.js";
import { Canvas } from "./canvas.js";
import { Shapes } from "./shapes.js";
export const Charts = class{
    constructor(){

    }
    /**
     * Draws a bar graph to the canvas
     * @param {String[]} labels Array of labels to place for each bar
     * @param {[{label: String, data: Number[], backgroundColor: String[], borderColor: String[], borderWidth: Number}]} datasets Dataset to the bar chart
     * @param {{
     * animation: {
     *  target:{
     *      duration: Number,
     *      easing: String,
     *      delay: Number|undefined,
     *      loop: Boolean|undefined,
     *      type: String,
     *      from: Number|Color|Boolean,
     *      to: Number|Color|Boolean,
     *      fn: (from: T, to: T, factor: number)=>T
     *  },
     *  onProgress: (animation)=>{currentStep: Number, numSteps: Number},
     *  onComplete: ()=>T
     * }
     * }} options Configurations to the bar chart
     */
    static bar(labels,datasets,options){
       

    }
}