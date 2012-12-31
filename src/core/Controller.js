/*jshint regexp:false*/

/**
 * Controller abstract class.
 */
define([
    'dejavu/AbstractClass',
    'dejavu/instanceOf',
    './Joint',
    './StateRegistry/StateInterface',
    'services/state',
    'amd-utils/lang/isFunction',
    'amd-utils/lang/isString',
    'amd-utils/string/startsWith',
    'amd-utils/object/size',
    'has'
], function (AbstractClass, instanceOf, Joint, StateInterface, stateRegistry, isFunction, isString, startsWith, size, has) {

    'use strict';

    var Controller = AbstractClass.declare({
        $name: 'Controller',
        $extends: Joint,

        _states: null,
        _statesParams: null,
        _defaultState: null,

        _currentState: null,
        _currentStateCursor: null,
        _currentStateBranchName: null,

        /**
         * Constructor.
         */
        initialize: function () {
            var key,
                tmp,
                func,
                matches,
                regExp;

            // Process the _states object if any
            if (this._states) {
                this._statesParams = {};
                regExp = this.$static._stateParamsRegExp;

                for (key in this._states) {
                    if (has('debug') && !key) {
                        throw new Error('Empty state detected in "' + this.$name + '".');
                    }
                    if (has('debug') && (key.indexOf('.') !== -1 || key.indexOf('/') !== -1)) {
                        throw new Error('States cannot contain dots or slashes (saw one in state "' + key + '" of "' + this.$name + '").');
                    }

                    // Process the params specified in the parentheses
                    matches = key.match(regExp);
                    if (matches) {
                        tmp = key.substr(0, key.indexOf('('));
                        this._states[tmp] = this._states[key];
                        delete this._states[key];
                        key = tmp;
                        this._statesParams[key] = matches[1].split(',');
                    } else {
                        this._states[key] = this._states[key];
                    }

                    // Check if it is a string or already a function
                    func = this._states[key];
                    if (isString(func)) {
                        func = this[func];
                        if (has('debug') && !isFunction(func)) {
                            throw new Error('State handler "' + key + '" of "' + this.$name + '" references an unknown function.');
                        }
                        this._states[key] = func;
                    }
                }

            } else {
                this._states = {};
                this._statesParams = {};
            }

            // Process the default state
            if (has('debug') && this._defaultState && !this._states[this._defaultState]) {
                throw new Error('The default state of "' + this.$name + '" points to an unknown state.');
            }

            this.$super();
        },

        /**
         * Get the current state name or null if none is set.
         *
         * @return {String} The state name or null if the cursor reached the end
         */
        getState: function () {
            if (!this._currentStateBranchName) {
                return null;
            }

            var pos = this._currentStateBranchName.indexOf('.');

            return pos === -1 ? this._currentStateBranchName : this._currentStateBranchName.substr(0, pos);
        },

        /**
         * Get the current state name, including the branch (hierarchy) state.
         * Returns null if none is set.
         *
         * @return {String} The branch state name
         */
        getBranchState: function () {
            return this._currentStateBranchName;
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
            return stateRegistry.generateUrl(this._generateFullStateName(state), $params);
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
            var absoluteStateName,
                x,
                length,
                curr,
                oldState,
                foundBranch,
                ret,
                tmp,
                hasChildControllers;

            // When a setState is called, we first check if the global state will be changed
            // If it does, we don't need do anything more because the state will propagate from the root controller
            // Otherwise, we check if the state is different from the current one in the controller

            // setState()
            if (!$state) {
                return this._setDefaultState($params);
            // setState('x.y.z', {})
            } else if (isString($state)) {
                absoluteStateName = this._generateFullStateName($state);
                $state = stateRegistry.getCurrent();
                if ($state) {
                    tmp = $state.getParams();
                    tmp.$origin = this;
                }

                ret = stateRegistry.setCurrent(absoluteStateName, $params);
                delete tmp.$origin;
    
                if (tmp) {
                    return this;
                }
            // setState(stateObj)
            } else {
                // Validate the state parameter
                // The state parameter can be an object containing the state parameters or a StateInterface instance
                // If it is an object containing the parameters, the state instance is referenced by the $state property
                $state = instanceOf($state, StateInterface) ?  $state : $state.$state;
                if (has('debug') && !instanceOf($state, StateInterface)) {
                    throw new Error('Invalid state instance.');
                }

                if (stateRegistry.setCurrent($state)) {
                    return this;
                }

                if (!$state.getName()) {
                    return this._setDefaultState($params);
                }
            }

            // The current global state is the same
            // Now we check if the state of this controller changed
            if (!this._currentState || !this._currentState.setCursor(this._currentStateCursor).isEqual($state, this._statesParams[$state.getName()])) {
                this._performStateChange($state);
            // If it didn't changed we must propagate down the controller's current branch
            } else {
                oldState = this._currentState;
                tmp = oldState ? oldState.getParams().$origin : null;
                this._currentState = $state;
                $state.next();

                length = this._downlinks.length;
                for (x = 0; x < length; x += 1) {
                    curr = this._downlinks[x];
                    if (curr instanceof Controller) {
                        if (tmp === curr || (curr._currentState && oldState.getFullName() === curr._currentState.getFullName())) {
                            curr.setState($state);
                            foundBranch = true;
                            break;
                        }
                        hasChildControllers = true;
                    }
                }

                if (has('debug') && (hasChildControllers || $state.getName()) && !foundBranch) {
                    console.warn('Could not propagate state "' + $state.getBranchName() + '" to any of the "' + this.$name + '" downlinks.');
                }
            }

            return this;
        },

        //////////////////////////////////////////////////////////////////

        /**
         * Generates a full state name.
         * Empty states can be used and will be mapped to the default states.
         *
         * If the name of the state starts with a /, it will be handled as an absolute state
         * If the name of the state starts with a ../, it will be handled as a relative state
         * Otherwise it will be handled as a local state
         *
         * @param {String} [$name] The state name
         *
         * @return {String} The full state name
         */
        _generateFullStateName: function ($name) {
            var matches,
                length,
                curr,
                x,
                localName;

            // We assume that all the uplinks are controllers
            // This may not be true if a developer implements a class that extends the Joint and links it to the controller

            if ($name) {
                // Check if it is an absolute name
                if ($name.charAt(0) === '/') {
                    $name = $name.substr(1);

                    if (!$name) {
                        curr = this;
                        while (curr._uplinks.length) {
                            curr = curr._uplinks[0];
                        }

                        $name = curr._generateFullStateName();
                    }

                    return $name;
                }

                // Check if it is a relative name
                if (startsWith($name, '../')) {
                    matches = $name.match(this.$static._relativeStateRegExp),
                    length = matches.length,
                    curr = this;

                    for (x = 1; x < length - 1; x += 1) {
                        if (has('debug') && !curr._uplinks.length) {
                            throw new Error('Cannot generate relative path because "' + this.$name + '" has no uplinks.');
                        }
                        curr = curr._uplinks[0];
                    }

                    return curr._generateFullStateName(matches[length - 1] || null);
                }

                // Check if it is a local name
                x = $name.indexOf('.');
                localName = x === -1 ? $name : $name.substr(0, x);

                if (has('debug') && !this._states[localName]) {
                    throw new Error('Unknown state "' + localName + '" in "' + this.$name + '".');
                }
            } else {
                // Check if the default state is set
                if (has('debug') && !this._defaultState) {
                    throw new Error('No default state defined in "' + this.$name + '".');
                }

                $name = this._defaultState;
            }

            // Generate the full state
            curr = this;
            while (curr._uplinks.length) {
                curr = curr._uplinks[0];
                $name = curr.getState() + ($name ? '.' + $name : '');
            }

            return $name;
        },

        /**
         * Changes the state to the default one.
         *
         * @param {Object} [$params] The state params
         *
         * @return {Controller} The instance itself to allow chaining
         */
        _setDefaultState: function ($params) {
            var absoluteStateName,
                tmp,
                state;

            if (this._defaultState) {
                absoluteStateName = this._generateFullStateName(this._defaultState);
                state = stateRegistry.getCurrent();
                if (state) {
                    tmp = state.getParams();
                    tmp.$origin = this;
                }

                stateRegistry.setCurrent(absoluteStateName, $params);
                delete tmp.$origin;
            } else if (has('debug') && size(this._states)) {
                console.warn('No state to be handled in "' + this.$name + '" by default.');
            }

            return this;
        },

        /**
         * Performs the state change, calling the state handler if any.
         *
         * @param {StateInterface} state The state
         */
        _performStateChange: function (state) {
            var localStateName = state.getName();

            this._currentState = state;
            this._currentStateCursor = state.getCursor();
            this._currentStateBranchName = state.getBranchName();
            this._currentState.next();

            if (!this._states[localStateName]) {
                if (has('debug')) {
                    console.warn('Unhandled state "' + localStateName + '" on controller "' + this.$name + '".');
                }
            } else {
                this._states[localStateName].call(this, state.getParams());
            }
        },

        ////////////////////////////////////////////////////////////////

        $statics: {
            _stateParamsRegExp: /\((.+?)\)/,
            _relativeStateRegExp: /^(\.\.\/)+(.*)/
        }
    });

    return Controller;
});
