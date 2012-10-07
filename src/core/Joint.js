/**
 * Joint abstract class.
 * A Joint represents a node in the hierarchy.
 */
define([
    'dejavu/AbstractClass',
    'events-emitter/EventsEmitter',
    'services/broadcaster',
    'amd-utils/array/insert',
    'amd-utils/array/remove'
], function (AbstractClass, EventsEmitter, broadcaster, insert, remove) {

    'use strict';

    // TODO: detect circular references

    return AbstractClass.declare({
        $name: 'Joint',

        _uplinks: [],
        _downlinks: [],
        _emitter: null,
        _destroyed: false,

        /**
         * Constructor.
         */
        initialize: function () {
            this._emitter = new EventsEmitter();
        },

        /**
         * Adds a listener for an upcast or broadcast event.
         * Duplicate listeners for the same event will be discarded.
         *
         * @param {String}   event      The event name
         * @param {Function} fn         The handler
         * @param {Object}   [$context] The context to be used to call the handler, defaults to the conector instance
         *
         * @return {Object} The instance itself to allow chaining
         */
        on: function (event, fn, $context) {
            var context = $context || this;

            this._emitter.on(event, fn, context);
            this.$static._broadcaster.on(event, fn, context);

            return this;
        },

        /**
         * Removes a previously added listener.
         *
         * @param {String}   event      The event name
         * @param {Function} fn         The handler
         * @param {Object}   [$context] The context passed to the on() function
         *
         * @return {Object} The instance itself to allow chaining
         */
        off: function (event, fn, $context) {
            var context = $context || this;

            this._emitter.off(event, fn, context);
            this.$static._broadcaster.off(event, fn, context);

            return this;
        },

        /**
         * Destroys the instance, releasing all of its resources.
         * Note that all links to this joint will also be destroyed if no remaining links are found.
         */
        destroy: function () {
            if (!this._destroyed) {
                this._onDestroy();
                this._destroyed = true;
            }
        },

        ////////////////////////////////////////////////////////////

        /**
         * Creates a link between this joint and another one.
         *
         * @param {Joint} joint Another joint to link to this one
         *
         * @return {Joint} The joint passed in as the argument
         */
        _link: function (joint) {
            insert(joint._uplinks, this);
            insert(this._downlinks, joint);

            return joint;
        },

        /**
         * Removes a previously created link between a joint and another one.
         *
         * @param {Joint} joint Another joint to link to this one
         *
         * @return {Object} The instance itself to allow chaining
         */
        _unlink: function (joint) {
            remove(joint._uplinks, this);
            remove(this._downlinks, joint);

            return this;
        },

        /**
         * Fires an event upwards the chain.
         *
         * @param {String}   event   The event name
         * @param {...mixed} [$args] The arguments to pass along with the event
         *
         * @return {Object} The instance itself to allow chaining
         */
        _upcast: function (event, $args) {
            var x,
                length,
                curr;

            // Check if the event will be handled locally
            // Otherwise we will keep upcasting upwards the chain
            if (this._emitter.has(event)) {
                this._emitter.emit.apply(this._emitter, arguments);
            } else {
                length = this._uplinks.length;

                // If we got no uplinks, then warn that this event was unhandled
                if (length) {
                    for (x = 0; x < length; x += 1) {
                        curr = this._uplinks[x];

                        // TODO: shall we refactor the code bellow to a function? it would decrease performance but developers could override it
                        // If this uplink explicit listens for this event, fire the callbacks and stop the propagation
                        if (curr._emitter.has(event)) {
                            curr._emitter.emit.apply(curr._emitter, arguments);
                        // Otherwise keep upcasting
                        } else {
                            curr._upcast.apply(curr, arguments);
                        }
                    }
                } else {
                    console.warn('Unhandled upcast event "' + event + '".');
                }
            }

            return this;
        },

        /**
         * Fires an event to all the joints.
         *
         * @param {String}   event   The event name
         * @param {...mixed} [$args] The arguments to pass along with the event
         *
         * @return {Object} The instance itself to allow chaining
         */
        _broadcast: function (event, $args) {
            var broadcaster = this.$static._broadcaster;

            broadcaster.broadcast.apply(broadcaster, arguments);

            return this;
        },

        /**
         * Function called after calling destroy().
         * This function is ensured to only be called once.
         * Subclasses should override this method to release their resources.
         */
        _onDestroy: function () {
            var broadcaster = this.$static._broadcaster,
                x,
                curr;


            // Remove the listeners from the broadcaster
            this._emitter.forEach(broadcaster.off, broadcaster);

            // Clear the listeners
            this._emitter.off();

            // Foreach uplink, automatically unlink this instance
            for (x = this._uplinks.length - 1; x >= 0; x -= 1) {
                this._uplinks[x]._unlink(this);
            }

            // Foreach downlink, automatically unlink it and destroy it if no more references exist to it
            for (x = this._downlinks.length - 1; x >= 0; x -= 1) {
                curr = this._downlinks[x];
                this._unlink(curr);
                if (!curr._uplinks.length) {
                    curr.destroy();
                }
            }

            // Null references
            this._uplinks = this._downlinks = this._emitter = null;
        },

        ////////////////////////////////////////////////////////////

        $statics: {
            _broadcaster: broadcaster
        }
    });
});