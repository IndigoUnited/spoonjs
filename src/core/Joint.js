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
        context = context || this;

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
        context = context || this;

        this._emitter.once(event, fn, context);
        broadcaster.once(event, fn, context);

        return this;
    };

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
        context = context || this;

        this._emitter.off(event, fn, context);
        broadcaster.off(event, fn, context);

        return this;
    };

    /**
     * Destroys the instance, releasing all of its resources.
     * Note that all downlinks will also be destroyed.
     */
    Joint.prototype.destroy = function () {
        if (!this._destroyed) {
            this._onDestroy();
            this._destroyed = true;
        }
    };

    ////////////////////////////////////////////////////////////

    /**
     * Creates a link between this joint and another one.
     *
     * @param {Joint} joint Another joint to link to this one
     *
     * @return {Joint} The joint passed in as the argument
     */
    Joint.prototype._link = function (joint) {
        if (has('debug') && joint._uplink && joint._uplink !== this) {
            throw new Error('"' + this.$name + '" is already linked to other joint');
        }

        if (joint._uplink !== this) {
            joint._uplink = this;
            insert(this._downlinks, joint);
            joint._emitter.emit('link', this);
        }

        return joint;
    };

    /**
     * Removes a previously created link between a joint and another one.
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
     * Fires an event upwards the chain.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype._upcast = function (event, args) {
        // Check if the event will be handled locally
        // Otherwise we will keep upcasting upwards the chain
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
        } else if (this._uplink) {
            this._uplink._upcast.apply(this._uplink, arguments);
        } else if (has('debug')) {
            console.warn('Unhandled upcast event "' + event + '".');
        }

        return this;
    };

    /**
     * Fires an event to all the joints.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype._broadcast = function (event, args) {
        broadcaster.broadcast.apply(broadcaster, arguments);

        return this;
    };

    /**
     * Method called after calling destroy().
     * Subclasses should override this method to release additional resources.
     *
     * The default implementation will also destroy any linked joints.
     */
    Joint.prototype._onDestroy = function () {
        var x,
            curr;

        // Remove the listeners from the broadcaster
        this._emitter.forEach(broadcaster.off, broadcaster);

        // Clear the listeners
        this._emitter.off();

        // Foreach uplink, automatically unlink this instance
        if (this._uplink) {
            this._uplink._unlink(this);
            this._uplink = null;
        }

        // Foreach downlink, automatically unlink it and destroy
        for (x = this._downlinks.length - 1; x >= 0; x -= 1) {
            curr = this._downlinks[x];
            this._unlink(curr);
            curr.destroy();
        }

        this._downlinks = null;
    };

    return Joint;
});
