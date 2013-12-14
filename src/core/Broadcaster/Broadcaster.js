/**
 * Broadcaster class.
 */
define([
    'events-emitter/EventsEmitter',
    'has'
], function (EventsEmitter, has) {

    'use strict';

    /**
     * Constructor.
     */
    function Broadcaster() {
        this._emitter = new EventsEmitter();
    }

    /**
     * Adds a new event listener.
     * If the listener is already attached, it won't get duplicated.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The listener
     * @param {Object}   [context] The context in which the function will be executed, defaults to the instance
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.on = function (event, fn, context) {
        this._emitter.on(event, fn, context);

        return this;
    };

    /**
     * Adds a new event listener that is removed automatically afterwards.
     * If the listener is already attached, it won't get duplicated.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The listener
     * @param {Object}   [context] The context in which the function will be executed, defaults to the instance
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.once = function (event, fn, context) {
        this._emitter.once(event, fn, context);

        return this;
    };

    /**
     * Removes an existent event listener.
     * If no fn and context is passed, removes all event listeners of a given name.
     * If no event is specified, removes all events of all names.
     *
     * @param {String}   [event]   The event name
     * @param {Function} [fn]      The listener
     * @param {Object}   [context] The context passed to the on() method
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.off = function (event, fn, context) {
        this._emitter.off(event, fn, context);

        return this;
    };

    /**
     * Emits a broadcast event.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass to each listener
     *
     * @return {Boolean} True if it was handled, false otherwise
     */
    Broadcaster.prototype.broadcast = function (event, args) {
        // If we got no interested subjects, warn that this event was unhandled
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
            return true;
        }

        if (has('debug')) {
            console.warn('[spoonjs] Unhandled broadcast event "' + event + '".');
        }

        return false;
    };

    return Broadcaster;
});
