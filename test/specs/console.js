define(['spoon'], function () {

    'use strict';

    describe('spoon', function () {

        it('should not throw an error executing console.*', function () {

            var methods = [
                'log',
                'debug',
                'info',
                'warn',
                'error'
            ],
                x;

            for (x = methods.length - 1; x >= 0; x -= 1) {
                console[methods[x]]('foo');
            }

        });

    });

});