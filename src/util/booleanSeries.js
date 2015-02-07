/*jshint plusplus:false*/

define(['has'], function (has) {

    'use strict';

    /**
     * Runs several functions in series that may interrupt
     * the pipeline if they "return" false.
     *
     * Supports sync and async (callback) usage of functions.
     *
     * @param {Array}    funcs    The functions to be run in series
     * @param {Function} callback The callback to call when done
     */
    function booleanSeries(funcs, callback) {
        var index = -1;

        function iterator() {
            var func = funcs[++index],
                carryOn;

            // Are we done?
            if (!func) {
                return callback(null, true);
            }

            // Catch any sync errors
            try {
                carryOn = func(function (err, carryOn) {
                    // Check if the user has mixed sync with async usage..
                    if (func !== funcs[index]) {
                        has('debug') && console.warn('[spoonjs] Sync usage mixed with async usage, ignoring async..');
                    }

                    // If there's an error or carry on === false, then abort
                    if (err || carryOn === false) {
                        callback(err, false);
                    } else {
                        iterator();
                    }
                });

                // Support sync usage
                if (typeof carryOn === 'boolean') {
                    if (!carryOn) {
                        callback(null, false);
                    } else {
                        iterator();
                    }
                }
            } catch (err) {
                callback(err, false);
            }
        }

        iterator();
    }

    return booleanSeries;
});
