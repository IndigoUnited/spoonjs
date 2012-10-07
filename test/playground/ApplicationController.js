define(['spoon', 'services/state', './FriendsController', './ShopController'], function (spoon, stateRegistry, FriendsController, ShopController) {

    'use strict';

    return spoon.Controller.extend({
        $name: 'ApplicationController',

        _defaultState: 'shop',
        _states: {
            'shop': '_shopState',
            'friends': '_friendsState'
        },

        _current: null,

        ////////////////////////////////////////////////////////////

        /**
         *
         */
        _shopState: function (state) {
            console.log('[ApplicationController] _shopState!!!', state, this.getState());

            this._destroyCurrent();
            this._current = this._link(new ShopController());
            this._current.setState(state);
        },

        /**
         *
         */
        _friendsState: function (state) {
            console.log('[ApplicationController] _friendsState!!!');

            this._destroyCurrent();
            this._current = this._link(new FriendsController());
            this._current.setState(state);
        },

        /**
         *
         */
        _destroyCurrent: function () {
            if (this._current) {
                this._current.destroy();
                this._current = null;
            }
        },

        /**
         *
         */
        _onDestroy: function () {
            this._destroyCurrent();
            this.$super();
        }
    });
});