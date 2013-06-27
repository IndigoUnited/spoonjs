/*global Handlebars*/

/**
 * View abstract class.
 */
define([
    './Joint',
    './Controller',
    '../util/createElement',
    'services/state',
    'mout/object/mixIn',
    'mout/object/forOwn',
    'mout/lang/isArray',
    'mout/lang/isPlainObject',
    'has',
    'jquery'
], function (Joint, Controller, createElement, stateRegistry, mixIn, forOwn, isArray, isPlainObject, has, $) {

    'use strict';

    /**
     * Constructor.
     *
     * @param {Element} [element] The DOM element for the view, defaults to document.body
     */
    function View(element) {
        Joint.call(this);

        // Clone events object to guarantee unicity among instances
        this._events = this._events ? mixIn({}, this._events) : {};

        // Assume the element or create one based on the _element property
        this._element = element ? element : createElement(this._element || 'div');
        this._nativeElement = this._element.get(0);

        // Listen to events
        this._listen();
    }

    View.extend = Joint.extend;
    View.prototype = Object.create(Joint.prototype);
    View.prototype.constructor = View;

    /**
     * Returns the view's element.
     *
     * @return {Element} The view's element
     */
    View.prototype.getElement = function () {
        return this._element;
    };

    /**
     * Convenience method to append the element's view to a target.
     * The target can be another view, a DOM element or a CSS selector.
     * If the target is another view, an additional selector can be passed to specify
     * the element where it will get appended.
     *
     * @param {Element|String|View} target   The target
     * @param {String}              [within] The selector in case the target is a view
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.appendTo = function (target, within) {
        if (target) {
            if (target instanceof View) {
                target = !within ? target._element : target._element.find(within).eq(0);
            } else if (typeof target === 'string') {
                target = $(target).eq(0);
            } else {
                target = $(target);
            }

            target.append(this._element);
        }

        return this;
    };

    /**
     * Convenience method to prepend the element's view to a target.
     * The target can be another view, a DOM element or a CSS selector.
     * If the target is another view, an additional selector can be passed to specify
     * the element where it will get appended.
     *
     * @param {Element|String|View} target   The target
     * @param {String}              [within] The selector in case the target is a view
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.prependTo = function (target, within) {
        if (target) {
            if (target instanceof View) {
                target = !within ? target._element : target._element.find(within).eq(0);
            } else if (typeof target === 'string') {
                target = $(target).eq(0);
            } else {
                target = $(target);
            }

            target.append(this._element);
        }

        return this;
    };

    /**
     * Renders the declared template with the supplied data.
     * Note that if this view is not yet linked to its parent, it will make the
     * view listen to the declared DOM events, and also manage its descendants
     * uplinked DOM events.
     *
     * @param {Object|Array} [data] The data to pass to the template
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.render = function (data) {
        if (this._template) {
            this.clear();

            if (has('debug') && typeof this._template !== 'function') {
                throw new Error('Expected _template to be a compiled template (function).');
            }

            this._element.html(this._template(this._fillHelpers(data || {})));
        }

        return this;
    };

    /**
     * Clears the view's element.
     * Note that you must explicitly call unlisten() to remove the DOM event listeners.
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.clear = function () {
        var children = this._element.children();

        children.remove();
        this._element.innerHTML = '';

        return this;
    };

    ////////////////////////////////////////////////////////////

    /**
     * Listen to events.
     *
     * @param {Object} events An object with the events.
     *
     * @return {Object} The same object
     */
    View.prototype._listen = function (events) {
        var eventType,
            selector,
            matches,
            eventsSplitter = this.constructor._eventsSplitter || View._eventsSplitter,
            that = this;

        events = events || this._events;

        forOwn(events, function (fn, key) {
            // If string, lookup the method in the instance
            if (typeof fn === 'string') {
                fn = this[fn];
            }

            if (has('debug') && !fn) {
                throw new Error('Event handler for "' + key + '" references an unknown function.');
            }

            // Skip if already listening
            if (fn._listening) {
                return;
            }

            events[key] = function (event) {
                fn.call(that, event, $(this));
            };

            matches = key.match(eventsSplitter);
            eventType = matches[1];
            selector = matches[2];

            this._element.on(eventType, selector, events[key]);
        }, this);

        return events;
    };

    /**
     * Unlistens to events.
     *
     * @param {Object} events An object with the events
     *
     * @return {Object} The same object
     */
    View.prototype._unlisten = function (events) {
        var key,
            eventType,
            selector,
            matches,
            fn,
            eventsSplitter = this.constructor._eventsSplitter || View._eventsSplitter;

        events = events || this._events;

        for (key in events) {
            fn = this._events[key];

            if (has('debug') && !fn) {
                throw new Error('Event handler for "' + key + '" references an unknown function.');
            }

            if (!fn._listening) {
                continue;
            }

            delete fn._listening;

            matches = key.match(eventsSplitter);
            eventType = matches[1];
            selector = matches[2];

            this._element.off(eventType, selector, fn);
        }

        return events;
    };

    /**
     * Generates an URL.
     *
     * @param {String} state    The state name
     * @param {Object} [params] The state params
     *
     * @return {String} The generated URL
     */
    View.prototype._generateUrl = function (state, params) {
        var controller = this._getController();

        if (has('debug') && !controller) {
            throw new Error('Could not find the controller responsible for "' + this.$name + '".');
        }

        return controller.generateUrl(state, params);
    };

    /**
     * Get the controller responsible for the view.
     * The view will be interpreted as the function context, so call this method with .call(view).
     *
     * @return {Controller} The view's controller
     */
    View.prototype._getController = function () {
        // Return the cached controller if any
        if (this._controller) {
            return this._controller;
        }

        // Search for it in the uplink ancestors
        if (this._uplink) {
            this._controller = this._uplink instanceof Controller ?
                this._uplink :
                this._uplink._getController();

            return this._controller;
        }

        return null;
    };

    /**
     * Fills a target with helpers to be used in the templates.
     *
     * @param {Object|Array} target The target to be filled
     *
     * @return {Object|Array} The same target with the filled helpers
     */
    View.prototype._fillHelpers = function (target) {
        if (has('debug') && !isPlainObject(target) && !isArray(target)) {
            throw new Error('Expected a plain object or an array to be passed to the template.');
        }

        // Only needed for handlebars
        if (window.Handlebars) {
            target.$view = this;
        }

        target.$url = function (state, params) {
            return this._generateUrl(state, params);
        }.bind(this);

        return target;
    };

    /**
     * {@inheritDoc}
     */
    View.prototype._onDestroy = function () {
        Joint.prototype._onDestroy.call(this);

        // Destroy view element
        this._element.remove();

        // Null references
        this._element = this._nativeElement = null;
    };

    // Register handlebar helpers
    if (window.Handlebars) {
        Handlebars.registerHelper('url', function (state, params) {
            return this.$view._generateUrl(state, params.hash);
        });
    }

    View._eventsSplitter = /^(\S+)\s*(.*)$/;

    return View;
});
