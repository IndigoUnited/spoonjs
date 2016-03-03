/*jshint plusplus:false*/

define(['has'], function (has) {
    'use strict';

    /**
     * Iterate over an array in series asynchronously, aborting if one of them return false.
     *
     * Supports sync and async (callback) usage of functions.
     *
     * @param {Array}    array    The array to be iterated
     * @param {Function} iterator The iterator
     * @param {Function} callback The callback to call when done
     */
    function every(array, iterator, callback) {
        var index = -1;

        function iterate() {
            var item = array[++index],
                ret;

            // Are we done?
            if (!item) {
                return callback(null, true);
            }

            // Catch any sync errors
            try {
                ret = iterator(item, function (err, ret) {
                    // Check if the user has mixed sync with async usage..
                    if (item !== array[index]) {
                        has('debug') && console.warn('[spoonjs] Sync usage mixed with async usage, ignoring async..');
                    }

                    // If there's an error or return is falsy, we are done
                    if (err || !ret) {
                        callback(err, false, item);
                    } else {
                        iterate();
                    }
                });

                // Support sync usage
                if (typeof ret === 'boolean') {
                    if (!ret) {
                        callback(null, false, item);
                    } else {
                        iterate();
                    }
                }
            } catch (err) {
                callback(err, false, item);
            }
        }

        iterate();
    }

    /**
     * Iterate over an array in series asynchronously, aborting if one of them return true.
     *
     * Supports sync and async (callback) usage of functions.
     *
     * @param {Array}    array    The array to be iterated
     * @param {Function} iterator The iterator
     * @param {Function} callback The callback to call when done
     */
    function some(array, iterator, callback) {
        var index = -1;

        function iterate() {
            var item = array[++index],
                ret;

            // Are we done?
            if (!item) {
                return callback(null, false);
            }

            // Catch any sync errors
            try {
                ret = iterator(item, function (err, ret) {
                    // Check if the user has mixed sync with async usage..
                    if (item !== array[index]) {
                        has('debug') && console.warn('[spoonjs] Sync usage mixed with async usage, ignoring async..');
                    }

                    // If there's an error, we are done
                    if (err) {
                        callback(err);
                    // If the return value is truish, we are also done
                    } else if (ret) {
                        callback(err, true, item);
                    } else {
                        iterate();
                    }
                });

                // Support sync usage
                if (typeof ret === 'boolean') {
                    if (ret) {
                        callback(null, true, item);
                    } else {
                        iterate();
                    }
                }
            } catch (err) {
                callback(err, false, item);
            }
        }

        iterate();
    }

    return {
        every: every,
        some: some,
    };
});
