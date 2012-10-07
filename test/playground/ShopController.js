define(['spoon', './SomeView'], function (spoon, SomeView) {

    'use strict';

    return spoon.Controller.extend({
        $name: 'ShopController',

        _defaultState: 'index',
        _states: {
            'index':    '_indexState',
            'show(id)': '_showState'
        },

        _view: null,

        ////////////////////////////////////////////////

        /**
         *
         */
        _indexState: function (state) {
            console.log('[ShopController] _indexState!!!', state, this.getState());

            this._destroyView();

            this.setState('show', { id: 2 });
        },

        /**
         *
         */
        _showState: function (state) {
            console.log('[ShopController] _showState!!!', state, this.getState());

            this._destroyView();

            this._view = this._link(new SomeView(document.createElement('div')));
            document.getElementById('test').appendChild(this._view.getElement());
            this._view.render({
                hello: 'olá',
                world: 'mundo'
            });
        },

        /**
         *
         */
        _destroyView: function () {
            if (this._view) {
                this._view.destroy();
                this._view = null;
            }
        },

        /**
         *
         */
        _onDestroy: function () {
            this._destroyView();
            this.$super();
        }
    });
});