/*jshint regexp:false*/

/**
 * Controller abstract class.
 */
define([
    'dejavu/AbstractClass',
    './Joint',
    'services/state',
    'mout/lang/isFunction',
    'mout/lang/isString',
    'mout/string/startsWith',
    'mout/object/size',
    'mout/array/find',
    'has'
], function (AbstractClass, Joint, stateRegistry, isFunction, isString, startsWith, size, find, has) {

    'use strict';

    var Controller = AbstractClass.declare({
        $name: 'Controller',
        $extends: Joint,

        _states: null,
        _statesParams: null,
        _defaultState: null,
        _nrStates: 0,

        _currentState: null,

        /**
         * Constructor.
         */
        initialize: function () {
            var key,
                tmp,
                func,
                matches,
                regExp = this.$static._stateParamsRegExp;

            this._statesParams = {};
            this._states = this._states || {};
            this._nrStates = size(this._states);

            // Process the _states object
            for (key in this._states) {
                // Process the params specified in the parentheses
                matches = key.match(regExp);
                if (matches) {
                    tmp = key.substr(0, key.indexOf('('));
                    this._states[tmp] = this._states[key];
                    delete this._states[key];
                    key = tmp;
                    this._statesParams[key] = matches[1].split(',');
                } else {
                    this._statesParams[key] = [];
                }

                if (has('debug')) {
                    if (!stateRegistry.isValid(key)) {
                        throw new Error('State name "' + key + '" of "' + this.$name + '" has an invalid format.');
                    }
                    if (key.indexOf('.') !== -1) {
                        throw new Error('State name "' + key + '" of "' + this.$name + '" must be local (cannot contain dots).');
                    }
                }

                // Check if it is a string or already a function
                func = this._states[key];
                if (isString(func)) {
                    func = this[func];
                    if (has('debug') && !isFunction(func)) {
                        throw new Error('State handler "' + key + '" of "' + this.$name + '" references a nonexistent function.');
                    }
                    this._states[key] = func;
                }
            }

            // Process the default state
            if (has('debug') && this._defaultState && !this._states[this._defaultState]) {
                throw new Error('The default state of "' + this.$name + '" points to an nonexistent state.');
            }

            this.$super();
        },

        /**
         * Get the current state or null if none is set.
         *
         * @return {StateInterface} The state
         */
        getState: function () {
            return this._currentState;
        },

        /**
         * Generates an URL for a state.
         *
         * @param {String} state     The state name
         * @param {Object} [$params] The state params
         *
         * @return {String} The generated URL
         */
        generateUrl: function (state, $params) {
            return stateRegistry.generateUrl(this._resolveFullState(state), $params);
        },

        /**
         * Sets the current state.
         * If the state is the same, nothing happens.
         *
         * @param {String|Object|StateInterface} [$state]  The state name, the state parameter bag or a state instance
         * @param {Object}                       [$params] The state params to be used if the state is a string
         *
         * @return {Controller} The instance itself to allow chaining
         */
        setState: function ($state, $params) {
            var name,
                fullName;

            if (!this._nrStates) {
                return this;
            }

            // 1st - Try to make the state transition globally and only proceed if it didn't changed
            //       Also extract the local and full name of the state
            if (!$state || isString($state)) {
                // Resolve to the full name
                fullName = this._resolveFullState($state);

                // Change the state globally, and abort if actually changed
                if (stateRegistry.setCurrent(fullName, $params)) {
                    return this;
                }

                name = $state;
            } else {
                $state = $state.$state || $state;

                // Change the state globally, and abort if actually changed
                if (stateRegistry.setCurrent($state)) {
                    return this;
                }

                name = $state.getName();
                $params = $state.getParams();
            }

            $state = stateRegistry.getCurrent();
            $state.setParams($params);

            // 2nd - If no name is found check if we got a default state
            if (!name && !this._defaultState) {
                throw new Error('No default state defined in "' + this.$name + '".');
            }

            // 3rd - Check if the state of the controller actually changed
            if (!this._isSameState($state)) {
                this._performStateChange($state);
            // 4th - If not, propagate the state downwards
            } else {
                this._propagateState($state);
            }

            // 5th - Sync up the full state name with the application one
            //       This is needed because default states might have been translated down the chain
            if (stateRegistry.getCurrent() === $state) {
                this._currentState.setFullName($state.getFullName());
            }

            return this;
        },

        //////////////////////////////////////////////////////////////////

        /**
         * Checks if a given state is the same as the current controller state.
         *
         * @param {StateInterface} state The state
         *
         * @return {Boolean} True if the same, false otherwise
         */
        _isSameState: function (state) {
            if (!this._currentState) {
                return false;
            }

            var tmp,
                params = this._statesParams[state.getName()],
                isEqual;

            // Check if equal
            if (this._currentState.isEqual(state, params)) {
                return true;
            }

            // Check if equal when expanding the state to the default one
            if (!state.getName() && this._currentState.getName() === this._defaultState) {
                tmp = state.getFullName();
                params = this._statesParams[this._defaultState];
                state.setFullName(state.getFullName() + '.' + this._defaultState);
                isEqual = this._currentState.isEqual(state, params);
                state.setFullName(tmp);

                if (isEqual) {
                    return true;
                }
            }

            return false;
        },

        /**
         * Resolves a full state name.
         *
         * If name starts with a / then state is absolute.
         * If name starts with ../ then state is relative.
         * If empty will try to map to the default state.
         * Otherwise the full state name will be resolved from the local name.
         *
         * @param {String} [$name] The state name
         *
         * @return {String} The full state name
         */
        _resolveFullState: function ($name) {
            var matches,
                length,
                curr,
                currState,
                x;

            // TODO: this function must be improved:
            //       - it must account for local names with a .
            $name = $name || '';

            // Absolute
            if ($name.charAt(0) === '/') {
                return $name.substr(1);
            }

            // Relative
            if (startsWith($name, '../')) {
                matches = $name.split(this.$static._relativeStateRegExp),
                length = matches.length,
                curr = this;

                for (x = 0; x < length - 1; x += 1) {
                    if (has('debug') && (!curr._uplink || !(curr._uplink instanceof Controller))) {
                        throw new Error('Cannot generate full state from "' + $name + '" in "' + this.$name + '".');
                    }
                    curr = curr._uplink;
                }

                return curr._resolveFullState(matches[length - 1] || null);
            }

            // Local
            curr = this._uplink;
            while (curr && curr instanceof Controller) {
                currState = curr.getState();
                if (!currState && has('debug')) {
                    throw new Error('Unable to resolve full state: "' + curr.$name + '" has no current state.');
                }
                $name = currState.getName() + ($name ? '.' + $name : '');
                curr = curr._uplink;
            }

            return $name;
        },

        /**
         * Performs the state change, calling the state handler if any.
         *
         * @param {StateInterface} state The state
         */
        _performStateChange: function (state) {
            var name,
                fullName;

            this._currentState = state.clone();

            // Resolve to default state always
            if (!state.getName() && this._defaultState) {
                fullName = state.getFullName() ? state.getFullName() + '.' + this._defaultState : this._defaultState;
                this._currentState.setFullName(fullName);
                stateRegistry.getCurrent().setFullName(fullName); // Update also the state registry one
            }

            name = this._currentState.getName();
            state.next();

            if (this._states[name]) {
                this._states[name].call(this, state.getParams());
            } else if (has('debug')) {
                console.warn('Unhandled state "' + name + '" on controller "' + this.$name + '".');
            }
        },

        /**
         * Attempts to propagate the state to one of the downlinks.
         *
         * @param {StateInterface} state The state
         */
        _propagateState: function (state) {
            var name,
                fullName,
                curr,
                length,
                x;

            this._currentState = state.clone();

            // Resolve to default state always
            if (!state.getName() && this._defaultState) {
                fullName = state.getFullName() ? state.getFullName() + '.' + this._defaultState : this._defaultState;
                this._currentState.setFullName(fullName);
                stateRegistry.getCurrent().setFullName(fullName); // Update also the state registry one
            }

            state.next();
            name = state.getName();
            length = this._downlinks.length;

            for (x = 0; x < length; x += 1) {
                curr = this._downlinks[x];

                if (curr instanceof Controller) {
                    if (curr._states[name] || (!name && curr._defaultState)) {
                        curr.setState(state);
                        return;
                    }
                }
            }

            if (name && has('debug')) {
                console.warn('Could not propagate state "' + name + '" to any of the "' + this.$name + '" downlinks.');
            }
        },

        ////////////////////////////////////////////////////////////////

        $statics: {
            _stateParamsRegExp: /\((.+?)\)/,
            _relativeStateRegExp: /\.\.\//
        }
    });

    return Controller;
});
