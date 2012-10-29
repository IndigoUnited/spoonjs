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
                'dir',
                'trace',
                'group',
                'groupCollapsed',
                'groupEnd',
                'time',
                'timeEnd'
            ],
            i;

        window.console = {};
        for (i = keys.length - 1; i >= 0; i -= 1) {
            window.console[keys[i]] = emptyFunc;
        }
    }
});