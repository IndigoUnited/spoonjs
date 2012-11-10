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
    'amd-utils/array/remove',
    'amd-utils/object/hasOwn',
    'amd-utils/string/startsWith',
    'amd-utils/queryString/decode',
    'amd-utils/queryString/encode',
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
         *
         */
        initialize: function () {
            Events.on(document.body, 'click a', this._handleLinkClick);
        },

        /**
         * {@inheritDoc}
         */
        setAddress: function ($address) {
            this._unsetAddress();
            if ($address) {
                this._address = $address;

                // Listen to the external change
                $address.on(AddressInterface.EVENT_EXTERNAL_CHANGE, this._onChange, this);

                // Manually call the change handler with the current address value
                this._onChange($address.getValue());
            }

            return this;
        },

        /**
         * {@inheritDoc}
         */
        register: function (state, $pattern, $constraints) {
            if (has('debug') && this._states[state]) {
                throw new Error('State "' + state + '" is already registered.');
            }

            var route = $pattern ? new Route(state, $pattern, $constraints) : null;

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
        clear: function () {
            this._states = {};
            this._routes = [];

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
        hasRoute: function (state) {
            return !!this._states[state];
        },

        /**
         * {@inheritDoc}
         */
        setCurrent: function (state, $params) {
            var previousState;

            if (!instanceOf(state, StateInterface)) {
                state = new State(state, $params);
            }

            // Only change if the current state is not the same
            if (!this.isCurrent(state)) {
                previousState = this._currentState;
                this._currentState = state;

                // Handle after change stuff
                this._postChangeHandler();

                // Emit the change
                this._currentState.setCursor(0);
                this._emit(this.$static.EVENT_CHANGE, this._currentState, previousState);

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
                state = new State(state, $params);
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
            } else if (this._address) {
                route = this._states[state];
                if (route) {
                    this._address.setValue(route.generateUrl(this._currentState.getParams()));
                }
            }
        },

        /**
         * Handles the address external and link change event.
         *
         * @param {String} value The new address value
         */
        _onChange: function (value) {
            var x,
                length = this._routes.length,
                curr,
                found = false;

            if (!value) {
                value = '/';
            } else if (value.charAt(0) !== '/') {
                value = '/' + value;
            }

            for (x = 0; x < length; x += 1) {
                curr = this._routes[x];

                if (curr.test(value)) {
                    found = true;
                    this.setCurrent(curr.getName(), curr.match(value));
                    break;
                }
            }

            if (has('debug') && !found) {
                console.warn('No state matched the URL "' + value + '".');
            }
        },

        /**
         * Unsets the address, if any.
         */
        _unsetAddress: function () {
            if (this._address) {
                this._address.off(AddressInterface.EVENT_EXTERNAL_CHANGE, this._onChange, this);
                this._address = null;
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
                target = element.target,
                ctrlKey = event.ctrlKey || event.metaKey,
                value,
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

            } else if (this._address) {
                // Ignore the event if control is pressed
                // Ignore if the link specifies a target different than self
                // Ignore if the link rel attribute is internal or external
                if (!ctrlKey && (!target || target === '_self') && type !== 'external') {
                    event.preventDefault();
                    // If the link is internal, then we just prevent default behaviour
                    if (type === 'internal') {
                        if (has('debug')) {
                            console.info('Link poiting to "' + url + '" is flagged as internal and as such event#preventDefault() was called on the event.');
                        }
                    } else {
                        // The getValue() will throw an error if the value is not recognizable by the address
                        try {
                            value = this._address.getValue(url);
                        } catch (e) {
                            if (has('debug')) {
                                console.info('Link poiting to "' + url + '" was automatically interpreted as external.');
                            }
                        }
                        this._onChange(value);
                    }
                } else if (has('debug')) {
                    console.info('Link poiting to "' + url + '" was ignored.');
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

            this._unsetAddress();
            this._currentState = null;
        }
    });
});