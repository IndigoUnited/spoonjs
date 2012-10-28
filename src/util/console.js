/*jshint regexp:false*/

/**
 * Inject dummy console if not present.
 * This is simply to prevent code from throwing errors in browsers such as IE.
 * All the console.* should be stripped when building stuff but.. you know..
 */
define(function () {

    'use strict';

    if (typeof window.console === 'undefined') {
        var emptyFunc = function () {},
            keys = [
                'log',
                'debug',
                'info',
                'warn',
                'error',
                'assert',
                'clear',
                'dir',
                'dirxml',
                'trace',
                'group',
                'groupCollapsed',
                'groupEnd',
                'time',
                'timeEnd',
                'profile',
                'profileEnd',
                'count',
                'exception',
                'table'
            ],
            i = keys.length;

        window.console = {};
        while ((i -= 1)) {
            window.console[keys[i]] = emptyFunc;
        }

    }
});