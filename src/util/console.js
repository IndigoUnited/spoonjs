/*jshint regexp:false*/

/**
 *
 */
define([
    
], function () {

    'use strict';

    //if (typeof(window.console) === 'undefined') {
        var emptyFunc = function () { },
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

        while (i--) {
            window.console[keys[i]] = emptyFunc;
        }
 
    //}
});