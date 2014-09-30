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
    'jquery',
    'jquery-destroy-event'
], function (Joint, Controller, createElement, stateRegistry, mixIn, forOwn, isArray, isPlainObject, has, $) {

    'use strict';

    // Default url helper
    function urlHelper() {
        throw new Error('Attempted to use "url" helper without calling "_renderTemplate".');
    }

    /**
     * Constructor.
     *
     * @param {Element} [element] The DOM element for the view
     */
    function View(element) {
        var template;

        Joint.call(this);

        // Clone events object to guarantee unicity among instances
        this._events = this._events ? mixIn({}, this._events) : {};

        // Assume the element or create one based on the _element property
        this._setupElement(element ? element : createElement(this._element || 'div'));

        // Convert template strings to functions
        template = this._template;
        if (typeof template === 'string') {
            this._template = function () { return template; };
        }
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
     * Sets the view element.
     * The previous element will be removed.
     *
     * @param {Element} element The view's element
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.setElement = function (element) {
        // Clear and remove old element
        this._unlisten();
        this._element.remove();

        // Setup new element
        this._setupElement(element);

        return this;
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

            target.prepend(this._element);
        }

        return this;
    };

    /**
     * Convenience method to detach a view's element from the DOM.
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.detach = function () {
        this._element.detach();

        return this;
    };

    /**
     * Renders the declared template with the supplied data.
     *
     * @param {Mixed} [data] The data to pass to the template
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.render = function (data) {
        if (has('debug') && this._rendered) {
            console.warn('Calling render on "' + this.$name + '" when it is already rendered.');
            console.warn('Some views might not be prepared for double rendering, consider creating an "update" method.');
        }

        this._element.children().remove();

        if (this._template) {
            if (has('debug') && typeof this._template !== 'string' && typeof this._template !== 'function') {
                throw new Error('Expected _template to be a string or compiled template (function).');
            }

            this._element.html(this._renderTemplate(this._template, data));
        }

        this._rendered = true;

        return this;
    };

    /**
     * Returns the view's instance associated with an element.
     *
     * @param {Element} element The element
     *
     * @return {View} The associated view or null if there's no view associated
     */
    View.fromElement = function (element) {
        return $(element).data('_spoon_view');
    };

    /**
     * Returns the view's instance associated with an element or the closest
     * ancestor (similar to jQuery).
     *
     * @param {Element} element The element
     *
     * @return {View} The associated view or null if there's no view associated
     */
    View.closest = function (element) {
        var view;

        element = $(element);

        do {
            // Break if we are at the root or if there's no element
            if (!element.length || element[0] === document.body) {
                break;
            }

            view = element.data('_spoon_view');
            if (view) {
                break;
            }

            element = element.parent();
        } while (true);

        return view;
    };

    /**
     * Instruct the extend to merge events.
     *
     * {@inheritDoc}
     */
    View.extend = function (parent, props, merge) {
        merge = merge || [];
        merge.push('_events');

        return Joint.extend.call(this, parent, props, merge);
    };

    // Custom helpers can be added here
    View.helpers = {
        url: urlHelper
    };

    // --------------------------------------------

    /**
     * Setups the view's element.
     *
     * @param {Element} element The element
     */
    View.prototype._setupElement = function (element) {
        var that = this;

        element = $(element);

        if (has('debug') && element.data('_spoon_view')) {
            throw new Error('A view is already instantiated for the same element.');
        }

        this._element = element;
        this._nativeElement = this._element.get(0);
        this._rendered = false;

        // Listen to the special "destroy" event when the element is removed externally via
        // .remove(), .html() or equivalents
        this._element.data('_spoon_view', this);
        this._element.on('destroy._spoon_view', function () {
            that.destroy();
        });

        // Listen to events
        this._listen();
    };

    /**
     * Listen to events.
     *
     * @param {Object} events An object with the events
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
            if (fn._fn) {
                return;
            }

            events[key] = function (event, data) {
                fn.call(that, event, $(this), data);
            };
            events[key]._fn = fn;

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
            fn = events[key];

            if (has('debug') && !fn) {
                throw new Error('Event handler for "' + key + '" references an unknown function.');
            }

            if (!fn._fn) {
                continue;
            }

            events[key] = events[key]._fn;
            delete fn._fn;

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
     * @param {String}  state      The state name
     * @param {Object}  [params]   The state params
     * @param {Boolean} [absolute] True to generate an absolute URL, false otherwise
     *
     * @return {String} The generated URL
     */
    View.prototype._generateUrl = function (state, params, absolute) {
        var controller = this._getController();

        if (has('debug') && !controller) {
            throw new Error('Could not find the controller responsible for "' + this.$name + '".');
        }

        return controller.generateUrl(state, params, absolute);
    };

    /**
     * Get the controller responsible for the view.
     * The view will be interpreted as the function context, so call this method with .call(view).
     *
     * @return {Controller} The view's controller
     */
    View.prototype._getController = function () {
        var uplink;

        // Return the cached controller if any
        if (this._controller) {
            return this._controller;
        }

        // Search for it in the uplink ancestors
        uplink = this._uplink;
        while (uplink) {
            if (uplink instanceof Controller) {
                return uplink;
            }

            uplink = uplink._uplink;
        }

        return null;
    };

    /**
     * Renders a template, setting up helpers.
     *
     * @param {Function} tmpl   The template function
     * @param {Mixed}    [data] The template data
     *
     * @return {String} The rendered HTML
     */
    View.prototype._renderTemplate = function (tmpl, data) {
        var that = this,
            helpers = View.helpers,
            rendered;

        // Set helpers that are contextually related to the view
        helpers.url = function (state, params, absolute) {
            return that._generateUrl(state, params, absolute);
        };

        // Render
        rendered = tmpl.call(helpers, data);

        // Restore helpers
        helpers.url = urlHelper;

        return rendered;
    };

    /**
     * {@inheritDoc}
     */
    View.prototype._onDestroy = function () {
        Joint.prototype._onDestroy.call(this);

        // Destroy view element
        this._element.off('._spoon_view');  // Avoid "destroy" recursion
        this._element.remove();

        // Null references
        this._element = this._nativeElement = this._controller = null;
    };

    View._eventsSplitter = /^(\S+)\s*(.*)$/;

    // --------------------------------------------

    // Register handlebars helper
    if (window.Handlebars) {
        Handlebars.registerHelper('url', function (state, options) {
            return View.helpers.url(state, options.hash);
        });
    }

    // Expose globals for those weird template engines..
    window.spoonViewHelpers = View.helpers;

    return View;
});
