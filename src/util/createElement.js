/*jshint regexp:false*/

define(function () {

    'use strict';

    // We cache the regular expressions because they will be used a lot of times
    // The memory used by them compensates the fact they will not be created over an over again
    var tagNameRegexp = /^(\w+)/i,
        idRegexp = /\#([\w\-]+)/i,
        classNameRegexp = /\.([\w\-]+)/ig,
        trimSpacesRegexp = /\s*=\s*/g,
        attributesRegexp = /\[([a-z\-]+)=['"]([\w\-]+)['"]\]/ig;

    /**
     * Creates a new element based on a CSS selector.
     * @credits Luís Couto <lcouto87@gmail.com>
     *
     * @param {String} selector The CSS selector
     *
     * @return {Element} The created element
     */
    function createElement(selector) {
        var elTagName = selector.match(tagNameRegexp),
            elId = selector.match(idRegexp),
            elClassName,
            elAttributes,
            classNames = '',
            el;

        // Trim spaces after and before a equal sign
        selector = selector.replace(trimSpacesRegexp, '=');

        // If there is still spaces, then the CSS selector is not a valid one
        if (selector.indexOf(' ') !== -1) {
            throw new Error('No spaces are allowed in the CSS selector.');
        }

        // Parse tag name
        if (elTagName) {
            el = document.createElement(elTagName[1]);
        } else {
            el = document.createElement('div');
        }

        // Parse id
        if (elId) {
            el.id = elId[1];
        }

        // Parse class name
        while ((elClassName = classNameRegexp.exec(selector))) {
            classNames += elClassName[1] + ' ';
        }

        if (classNames) {
            el.className = classNames.substr(0, classNames.length - 1);
        }

        // Parse attributes
        while ((elAttributes = attributesRegexp.exec(selector))) {
            el.setAttribute(elAttributes[1], elAttributes[2]);
        }

        // Reset the regular expressions lastIndex flags
        classNameRegexp.lastIndex = attributesRegexp.lastIndex = 0;

        return el;
    }

    return createElement;
});