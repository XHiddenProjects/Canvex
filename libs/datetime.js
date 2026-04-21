import { Canvex } from "./canvex.js";
import { TimeFormat } from "./timeformat.min.js";
export const DateTime = class {
    /**
     * Returns the number of milliseconds since the Canvex sketch started.
     * @returns {number}
     */
    static get millis(){
        return Canvex._millis;
    }
    /**
     * Returns the current second (0-59).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Second (0-59)
     */
    static second(datetime){
        if(!datetime) return new Date().getSeconds();
        return new Date(datetime).getSeconds();
    }
    /**
     * Returns the current minute (0-59).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Minute (0-59)
     */
    static minute(datetime){
        if(!datetime) return new Date().getMinutes();
        return new Date(datetime).getMinutes();
    }
    /**
     * Returns the current hour (0-23).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Hour (0-23)
     */    
    static hour(datetime){
        if(!datetime) return new Date().getHours();
        return new Date(datetime).getHours();
    }
    /**
     * Returns the current day of the month (1-31).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Day of the month (1-31)
     */
    static day(datetime){
        if(!datetime) return new Date().getDate();
        return new Date(datetime).getDate();
    }
    /**
     * Returns the current month (0-11).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Month (0-11)
     */
    static month(datetime){
        if(!datetime) return new Date().getMonth();
        return new Date(datetime).getMonth();
    }
    /**
     * Returns the current year (e.g., 2024).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Year (e.g., 2024)
     */
    static year(datetime){
        if(!datetime) return new Date().getFullYear();
        return new Date(datetime).getFullYear();
    }
    /**
     * Converts a datetime string or timestamp to a Unix timestamp (milliseconds since January 1, 1970).
     * @param {Date|string|number} [datetime=null] - Optional datetime string or timestamp. If not provided, the current date and time will be used.
     * @returns {number} Unix timestamp (milliseconds since January 1, 1970)
     */
    static timestamp(datetime){
        if(!datetime) return Date.now();
        return new Date(datetime).getTime();
    }
    /**
     * Constructs a Date object from the provided date and time components. Any components that are not provided will default to the current date and time values.
     * @param {Object} param0 - An object containing the date and time components.
     * @param {number} [param0.year] - The year.
     * @param {number} [param0.month] - The month (0-11).
     * @param {number} [param0.day] - The day of the month (1-31).
     * @param {number} [param0.hour] - The hour (0-23).
     * @param {number} [param0.minute] - The minute (0-59).
     * @param {number} [param0.second] - The second (0-59).
     * @param {number} [param0.millisecond] - The millisecond (0-999).
     * @returns {Date} The updated date and time.
     */
    static construct({ year, month, day, hour, minute, second, millisecond } = {}){
        const datetime = new Date();
        if(year !== undefined) datetime.setFullYear(year);
        if(month !== undefined) datetime.setMonth(month);
        if(day !== undefined) datetime.setDate(day);
        if(hour !== undefined) datetime.setHours(hour);
        if(minute !== undefined) datetime.setMinutes(minute);
        if(second !== undefined) datetime.setSeconds(second);
        if(millisecond !== undefined) datetime.setMilliseconds(millisecond);
        return datetime;
    }
    /**
     * Formats a datetime according to a specified format string.
     * @param {Date|string|number} datetime - The datetime to format.
     * @param {string} formatString - The format string.
     * @see {@link https://www.php.net/manual/en/datetime.format.php|PHP's date() function} for format string options.
     * @returns {string} The formatted datetime.
     */
    static format(datetime, formatString){
        if(arguments.length === 1){
            formatString = datetime;
            datetime = new Date();
        }
        return TimeFormat.set(datetime).format(formatString);
    }
    /**
     * Returns the current date and time as a Date object.
     * @returns {Date} The current date and time.
     */
    static get NOW(){
        return new Date();
    }
    
}