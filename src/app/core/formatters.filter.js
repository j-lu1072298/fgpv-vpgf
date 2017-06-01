/* global linkifyStr, linkifyHtml, moment */

import linkifyStr from 'linkifyjs/string';
import * as moment from 'moment-timezone';

/**
 * @name autolink
 * @constant
 * @memberof app.common
 * @description
 *
 * The autolink filter using https://github.com/SoapBox/linkifyjs.
 */
angular
    .module('app.core')
    .filter('autolink', autolink)
    .filter('dateTimeZone', dateTimeZone);

function dateTimeZone() {
    const userTimeZone = moment.tz.guess();

    return dateTimeZone;

    /**
     * Formats a given date with the users current timezone
     *
     * @function dateTimeZone
     * @param {Number} esriDate epoch time to convert
     * @param {String} [format=YYYY-MM-D H:MM:SSA z] moment format string for output date/time
     * @return {String} data/time adjusted to users timezone
     */
    function dateTimeZone(esriDate, format = 'YYYY-MM-D H:MM:SSA z') {
        if (esriDate) {
            const time = moment.tz(esriDate, userTimeZone).format(format);
            // if esriDate is not valid, assume it follows 'format'
            return time !== 'Invalid date' ? time : moment.tz(esriDate, format, userTimeZone).format(format);
        } else {
            // if field is blank or null, don't show 'invalid date', just leave it blank.
            return '';
        }
    }
}

function autolink() {
    const defaultOptions = { className: 'rv-linkified', ignoreTags: ['script'] };

    return autolink;

    /**
     * Autolinks strings; doesn't not modify the original.
     *
     * @function autolink
     * @param {Array|String} items array of strings or a single string to autolink
     * @param {Object} options [optional = {}] linkifyjs options object; the only default changed is classname (rv-linkified) for consistency
     * @return {Array|String} array or string of autolinked strings
     */
    function autolink(items, options = {}) {
        // item must be a string
        const results = Array.isArray(items) ?
            items.map(process) :
            process(items);

        return results;

        /**
         * Autolink helper function.
         *
         * @function process
         * @private
         * @param {String} item string to autolink
         * @return {String} autolinked string
         */
        function process(item) {
            // check if we need to use linkify html or linkify string
            const html = /<(?=.*? .*?\/ ?>|br|hr|input|!--|wbr)[a-z]+.*?>|<([a-z]+).*?<\/\1>/; // https://regex101.com/r/cX0eP2/1
            const opts = angular.extend(defaultOptions, options);
            return (html.test(item)) ?
                linkifyHtml((item || '').toString(), opts) : linkifyStr((item || '').toString(), opts);
        }
    }
}
