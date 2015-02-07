define(function () {

    'use strict';

    function booleanSeries(funcs, callback) {
        function iterator(index) {
            var func = funcs[index],
                carryOn;

            // Are we done?
            if (!func) {
                return callback(null, true);
            }

            try {
                carryOn = funcs[index](function (err, carryOn) {
                    // If there's an error or carry on === false, then abort
                    if (err || carryOn === false) {
                        return callback(err, false);
                    }

                    iterator(index + 1);
                });

                if (carryOn === false) {
                    callback(null, false);
                } else {
                    iterator(index + 1);
                }
            } catch (err) {
                callback(err);
            }
        }

        iterator(0);
    }

    return booleanSeries;
});
