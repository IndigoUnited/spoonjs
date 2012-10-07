define(['./states'], function (states) {

    'use strict';

    return {
        // Address configuration
        address: {
            basePath: '/',
            html5: true
        },

        // State configuration
        state: {
            routing: true,
            states: states
        }
    };
});