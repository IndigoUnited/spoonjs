/**
 * Joint abstract class.
 * A Joint represents a node in the hierarchy.
 */
define([
    'events-emitter/EventsEmitter',
    'services/broadcaster',
    '../util/extend',
    'mout/array/insert',
    'mout/array/remove',
    'has'
], function (EventsEmitter, broadcaster, extend, insert, remove, has) {

    'use strict';

    /**
     * Constructor.
     */
    function Joint() {
        this._downlinks = [];
        this._emitter = new EventsEmitter();
    }

    Joint.extend = extend;

    /**
     * Adds a listener for an upcast or broadcast event.
     * Duplicate listeners for the same event will be discarded.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The handler
     * @param {Object}   [context] The context to be used to call the handler, defaults to the joint instance
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype.on = function (event, fn, context) {
        this._emitter.on(event, fn, context);
        broadcaster.on(event, fn, context);

        return this;
    };

    /**
     * Adds a one time listener for an upcast or broadcast event.
     * Duplicate listeners for the same event will be discarded.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The handler
     * @param {Object}   [context] The context to be used to call the handler, defaults to the joint instance
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype.once = function (event, fn, context) {
        this._emitter.once(event, fn, context);
        broadcaster.once(event, fn, context);

        return this;
    };

    Joint.prototype.one = Joint.prototype.once;

    /**
     * Removes a previously added listener.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The handler
     * @param {Object}   [context] The context passed to the on() method
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype.off = function (event, fn, context) {
        this._emitter.off(event, fn, context);
        broadcaster.off(event, fn, context);

        return this;
    };

    /**
     * Checks if the instance is linked.
     *
     * @return {Boolean} True if it is, false otherwise
     */
    Joint.prototype.isLinked = function () {
        return !!this._uplink;
    };

    /**
     * Checks if the instance is destroyed.
     *
     * @return {Boolean} True if it is, false otherwise
     */
    Joint.prototype.isDestroyed = function () {
        return !!this._destroyed;
    };

    /**
     * Destroys the instance, releasing all of its resources.
     * Note that all downlinks will also be destroyed.
     */
    Joint.prototype.destroy = function () {
        if (!this._destroyed) {
            this._destroyed = true;
            this._onDestroy();
        }
    };

    // --------------------------------------------

    /**
     * Creates a link between this joint and another one.
     *
     * @param {Joint} joint Another joint to link to this one
     *
     * @return {Joint} The joint passed in as the argument
     */
    Joint.prototype._link = function (joint) {
        if (has('debug') && joint._uplink && joint._uplink !== this) {
            throw new Error('"' + joint.$name + '" is already linked to other joint');
        }

        if (joint._uplink !== this) {
            joint._uplink = this;
            insert(this._downlinks, joint);
            joint._emitter.emit('link', this);
        }

        return joint;
    };

    /**
     * Removes a previously created link between this joint and another one.
     *
     * @param {Joint} joint Another joint to link to this one
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype._unlink = function (joint) {
        remove(this._downlinks, joint);

        if (joint._uplink === this) {
            joint._uplink = null;
            joint._emitter.emit('unlink', this);
        }

        return this;
    };

    /**
     * Fires an event.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Joint.prototype._emit = function (event, args) {
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
            return true;
        }

        return false;
    };

    /**
     * Fires an event upwards the chain.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Joint.prototype._bubbleUp = function (event, args) {
        if (this._uplink) {
            return this._uplink._upcast.apply(this._uplink, arguments);
        }

        if (has('debug')) {
            console.warn('[spoonjs] Unhandled upcast event "' + event + '".');
        }

        return false;
    };

    /**
     * Fires an event downwards the chain.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Joint.prototype._bubbleDown = function (event, args) {
        var x,
            length,
            last,
            curr,
            currHandled,
            handled = false;

        // Cycle each downlink
        length = this._downlinks.length;
        for (x = 0; x < length; x += 1) {
            curr = this._downlinks[x];

            // Protect against triggered events that cause the destruction of links
            if (!curr || curr === last) {
                continue;
            }

            currHandled = curr._downcast.apply(curr, arguments);
            if (currHandled) {
                handled = true;
            }
        }

        return handled;
    };

    /**
     * Fires an event upwards the chain, starting in this Joint.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Joint.prototype._upcast = function (event, args) {
        // Check if the event will be handled locally
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
            return true;
        }

        // Otherwise we will keep upcasting upwards the chain
        if (this._uplink) {
            return this._uplink._upcast.apply(this._uplink, arguments);
        }

        if (has('debug')) {
            console.warn('[spoonjs] Unhandled upcast event "' + event + '".');
        }

        return false;
    };

    /**
     * Fires an event downwards the chain, starting in this Joint.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Joint.prototype._downcast = function (event, args) {
        var x,
            length,
            last,
            curr,
            currHandled,
            handled = false;

        // Check if the event will be handled locally
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
            return true;
        }

        // Cycle each downlink
        length = this._downlinks.length;
        for (x = 0; x < length; x += 1) {
            curr = this._downlinks[x];

            // Protect against triggered events that cause the destruction of links
            if (!curr || curr === last) {
                continue;
            }

            currHandled = curr._downcast.apply(curr, arguments);
            if (currHandled) {
                handled = true;
            }
        }

        return handled;
    };

    /**
     * Fires an event to all the joints.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Joint.prototype._broadcast = function (event, args) {
        return broadcaster.broadcast.apply(broadcaster, arguments);
    };

    /**
     * Function called by destroy().
     * Subclasses should override this method to release additional resources.
     *
     * The default implementation will also destroy any linked joints.
     */
    Joint.prototype._onDestroy = function () {
        var x,
            curr;

        // Foreach downlink, automatically destroy
        for (x = this._downlinks.length - 1; x >= 0; x -= 1) {
            curr = this._downlinks[x];
            curr && curr.destroy();  // We need to check if it still exists
        }
        this._downlinks = null;

        // Foreach uplink, automatically unlink this instance
        if (this._uplink) {
            this._uplink._unlink(this);
            this._uplink = null;
        }

        // Remove the listeners from the broadcaster
        this._emitter.forEach(broadcaster.off, broadcaster);

        // Clear the listeners
        this._emitter.off();
    };

    return Joint;
});
