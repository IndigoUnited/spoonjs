/**
 * StateRegistry class.
 */
define([
    'dejavu/Class',
    'dejavu/instanceOf',
    './StateRegistryInterface',
    'events-emitter/MixableEventsEmitter',
    'address/AddressInterface',
    './StateInterface',
    './State',
    './Route',
    'base-adapter/dom/Events',
    'mout/array/remove',
    'mout/object/hasOwn',
    'mout/string/startsWith',
    'mout/queryString/decode',
    'mout/queryString/encode',
    'has'
], function (Class, instanceOf, StateRegistryInterface, MixableEventsEmitter, AddressInterface, StateInterface, State, Route, Events, remove, hasOwn, startsWith, decode, encode, has) {

    'use strict';

    return Class.declare({
        $name: 'StateRegistry',
        $implements: StateRegistryInterface,
        $borrows: MixableEventsEmitter,

        _states: {},
        _routes: [],

        _currentState: null,
        _address: null,

        _destroyed: false,

        /**
         * Constructor.
         */
        initialize: function () {
            Events.on(document.body, 'click a', this._handleLinkClick);
        },

        /**
         * {@inheritDoc}
         */
        setAddress: function ($address) {
            this.unsetAddress();
            if ($address) {
                this._address = $address;

                // Listen to the address change
                $address.on(AddressInterface.EVENT_CHANGE, this._onChange, this);
            }

            return this;
        },


        /**
         * Unsets the address, if any.
         */
        unsetAddress: function () {
            if (this._address) {
                this._address.off(AddressInterface.EVENT_CHANGE, this._onChange, this);
                this._address = null;
            }
        },

        /**
         * {@inheritDoc}
         */
        parse: function ($route) {
            // Manually call the change handler with the passed route
            // or the address value (if available)
            var obj = {
                newValue: $route != null ? $route : (this._address ? this._address.getValue() : ''),
                oldValue: null,
                type: AddressInterface.TYPE_EXTERNAL_CHANGE
            };

            this._onChange(obj);

            return this;
        },

        /**
         * {@inheritDoc}
         */
        register: function (state, $pattern, $constraints) {
            if (has('debug') && this._states[state]) {
                throw new Error('State "' + state + '" is already registered.');
            }

            var route = $pattern != null ? new Route(state, $pattern, $constraints) : null;

            // Add to the states object
            this._states[state] = route;

            // Add to the routes array
            if (route) {
                this._routes.push(route);
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        unregister: function (state) {
            var route = this._states[state];

            // Remove it from the states object
            delete this._states[state];

            if (route) {
                // Remote if from the routes array
                remove(this._routes, route);
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        isRegistered: function (state) {
            return hasOwn(this._states, state);
        },

        /**
         * {@inheritDoc}
         */
        isRoutable: function (state) {
            return !!this._states[state];
        },


        /**
         * {@inheritDoc}
         */
        clear: function () {
            this._states = {};
            this._routes = [];

            return this;
        },

        /**
         * {@inheritDoc}
         */
        isValid: function (name) {
            return State.isValid(name);
        },

        /**
         * {@inheritDoc}
         */
        setCurrent: function (state, $params) {
            var previousState,
                fullName,
                tmp;

            if (!instanceOf(state, StateInterface)) {
                state = this._createStateInstance(state, $params);
            }

            // Only change if the current state is not the same
            if (!this.isCurrent(state)) {
                previousState = this._currentState;
                this._currentState = state;

                // Handle after change stuff
                this._postChangeHandler();

                // Emit the change
                tmp = this._currentState;
                fullName = this._currentState.getFullName();
                this._currentState.setCursor(0);
                this._emit(this.$static.EVENT_CHANGE, this._currentState, previousState);

                // If the final state name has changed in the process, inform the user
                // This happens if the final state is changed (tipically because of default state translations)
                if (has('debug') && tmp === this._currentState && fullName !== this._currentState.getFullName()) {
                    console.info('Final state after transition is "' + this._currentState.getFullName() + '".');
                }

                return true;
            }

            return false;
        },

        /**
         * {@inheritDoc}
         */
        getCurrent: function () {
            return this._currentState;
        },

        /**
         * {@inheritDoc}
         */
        isCurrent: function (state, $params) {
            // If no state is set simply return false
            if (!this._currentState) {
                return false;
            }

            // Build the state object
            if (!instanceOf(state, StateInterface)) {
                state = this._createStateInstance(state, $params);
            }

            return this._currentState.isFullyEqual(state);
        },

        /**
         * {@inheritDoc}
         */
        generateUrl: function (state, $params, $absolute) {
            var route = this._states[state],
                url;

            if (!route || !this._address) {
                return 'state://' + state + '/' + encode($params);
            }

            url = route.generateUrl($params);

            return this._address ? this._address.generateUrl(url, $absolute) : url;
        },

        /**
         * {@inheritDoc}
         */
        destroy: function () {
            if (!this._destroyed) {
                this._onDestroy();
                this._destroyed = true;
            }
        },

        ///////////////////////////////////////////////////////////////

        /**
         * Creates a new state instance.
         *
         * @param {String} state     The state name
         * @param {Object} [$params] The state parameters if the state was a string
         *
         * @return {StateInterface} The state instance
         */
        _createStateInstance: function (state, $params) {
            return new State(state, $params);
        },

        /**
         * Handles stuff after the state has changed.
         */
        _postChangeHandler: function () {
            var state = this._currentState.getFullName(),
                route;

            if (has('debug')) {
                console.info('State changed to "' + state + '".');
            }

            if (!this.isRegistered(state)) {
                if (has('debug')) {
                    console.warn('State "' + state + '" is not registered.');
                }
                if (this._address) {
                    this._address.reset();
                }
            } else if (this._address) {
                route = this._states[state];
                if (route) {
                    this._address.setValue(route.generateUrl(this._currentState.getParams()));
                } else {
                    this._address.reset();
                }
            }
        },

        /**
         * Handles the address change event.
         *
         * @param {Object} obj The address object containing the change details
         */
        _onChange: function (obj) {
            // Ignore the internal change event
            if (obj.type === AddressInterface.TYPE_INTERNAL_CHANGE) {
                return;
            }

            // Find if there's a matching route for the new address value
            var x,
                length = this._routes.length,
                route,
                found = false,
                value = obj.newValue,
                newState;

            if (!value) {
                value = '/';
            } else if (value.charAt(0) !== '/') {
                value = '/' + value;
            }

            for (x = 0; x < length; x += 1) {
                route = this._routes[x];

                if (route.test(value)) {
                    found = true;
                    newState = this._createStateInstance(route.getName(), route.match(value));
                    newState.getParams().$address = obj;
                    this.setCurrent(newState);
                    break;
                }
            }

            if (has('debug') && !found) {
                console.warn('No state matched the URL "' + value + '".');
            }
        },

        /**
         * Handles the click event on links.
         *
         * @param {Event}   event The click event
         * @param {Element} [$el] The link tag
         */
        _handleLinkClick: function (event, $el) {
            var element = $el || Events.getCurrentTarget(event),
                type = element.getAttribute('data-url-type'),
                url = element.href,
                state,
                params,
                pos;

            // Only parse links with state protocol
            if (startsWith(url, 'state://')) {
                event.preventDefault();

                // If the link is internal, then we just prevent default behaviour
                if (type !== 'internal') {
                    pos = url.lastIndexOf('/');
                    // Extract the name and the params
                    if (pos === -1) {
                        state = url.substr(8);
                    } else {
                        state = url.substring(8, pos);
                        params = decode(url.substr(pos + 1));
                    }

                    this.setCurrent(state, params);
                } else if (has('debug')) {
                    console.info('Link poiting to state "' + state + '" is flagged as internal and as such event#preventDefault() was called on the event.');
                }
            }
        }.$bound(),

        /**
         * Releases any listeners and resources.
         * This method is called only once after a destroy several call.
         *
         * @see StateRegistry#destroy
         */
        _onDestroy: function () {
            this.clear();
            this.off();

            Events.off(document.body, 'click a', this._handleLinkClick);

            this.unsetAddress();
            this._currentState = null;
        }
    });
});