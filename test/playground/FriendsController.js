define(['spoon'], function (spoon) {

    'use strict';

    return spoon.Controller.extend({
        $name: 'FriendsController',

        _defaultState: 'requests',
        _states: {
            'index':   '_indexState',
            'requests': '_requestsSection'
        },

        _current: null,

        ////////////////////////////////////////////////

        /**
         *
         */
        _indexState: function (state) {
            console.log('[FriendsController] _indexState!!!');

            this.setState('requests');
        },

        /**
         *
         */
        _requestsSection: function () {
            console.log('[FriendsController] _requestsSection!!!');

            //this.setState('/');
            //this.setState('../');
            this.setState('../shop');
        }
    });
});