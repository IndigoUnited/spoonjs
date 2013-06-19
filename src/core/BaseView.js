/*global Handlebars*/

/**
 * BaseView abstract class.
 */
define([
    './Joint',
    './Controller',
    '../util/createElement',
    'services/state',
    'dom-responder/DomResponder',
    'mout/lang/isFunction',
    'mout/lang/isArray',
    'mout/lang/isPlainObject',
    'mout/lang/isString',
    'has',
    'jquery'
], function (Joint, Controller, createElement, stateRegistry, DomResponder, isFunction, isArray, isPlainObject, isString, has, $) {

    'use strict';

    function createFrom(source) {
        if (isString(source)) {
            if (source.charAt(0) === '<' && source.charAt(source.length - 1) === '>') {
                return $(source);
            } else {
                return $(createElement(source));
            }
        } else {
            return $(source);
        }
    }

    /**
     * Constructor.
     *
     * @param {Element} [element] The DOM element for the view, defaults to document.body
     */
    function BaseView(element) {
        var key,
            func;

        // Assume the $element or create one based on the _element property
        this._element = element ? element : createFrom(this._element || 'div');
        this._nativeElement = Element.getNativeElement(this._element);

        // Initialize the dom responder
        this._dom = new DomResponder(this._element);

        // Process the _events object if any
        if (this._events) {
            for (key in this._events) {
                func = this._events[key];
                if (isString(func)) {
                    func = this[func];
                    if (has('debug') && !isFunction(func)) {
                        throw new Error('Event handler for "' + key + '" references an unknown function.');
                    }
                } else {
                    func = func.$member();
                }

                this._dom.on(key, func, this);
            }
        }

        Joint.call(this);

        // Start listening as soon as this view is linked (only if is the root)
        this.once('link', function () {
            if (this._isRoot()) {
                this._dom.listen();
            }
        }.bind(this));
    }

    BaseView.prototype = Object.create(Joint.prototype);
    BaseView.prototype.constructor = BaseView;

    /**
     * Returns the view's element.
     *
     * @return {Element} The view's element
     */
    BaseView.prototype.getElement = function () {
        return this._element;
    };

    /**
     * Convenience method to append the element's view to a target.
     * The target can be another view, a DOM element or a CSS selector.
     * If the target is another view, an additional selector can be passed to specify
     * the element where it will get appended.
     *
     * @param {Element|String|BaseView} target   The target
     * @param {String}                  [within] The selector in case the target is a view
     *
     * @return {BaseView} The instance itself to allow chaining
     */
    BaseView.prototype.appendTo = function (target, within) {
        if (target) {
            if (target instanceof BaseView) {
                target = !within ? target._element : $(target._element).find(within).get()[0];
            } else if (isString(target)) {
                target = $(target).get()[0];
            }

            $(target).append(this._element);
        }

        // Listen to DOM events if this is a root view
        if (this._isRoot()) {
            this._dom.listen();
        }

        return this;
    };

    /**
     * Convenience method to prepend the element's view to a target.
     * The target can be another view, a DOM element or a CSS selector.
     * If the target is another view, an additional selector can be passed to specify
     * the element where it will get appended.
     *
     * @param {Element|String|BaseView} target   The target
     * @param {String}                  [within] The selector in case the target is a view
     *
     * @return {BaseView} The instance itself to allow chaining
     */
    BaseView.prototype.prependTo = function (target, within) {
        if (target) {
            if (target instanceof BaseView) {
                target = !within ? target._element : $(target._element).find(within).get()[0];
            } else if (isString(target)) {
                target = $(target).get()[0];
            }

            $(target).append(this._element);
        }

        // Listen to DOM events if this is a root view
        if (this._isRoot()) {
            this._dom.listen();
        }

        return this;
    };

    /**
     * Listen to the declared DOM events.
     * Make the view listen to the declared DOM events, and also manage its descedants uplinked DOM events.
     *
     * @return {BaseView} The instance itself to allow chaining
     */
    BaseView.prototype.listen = function () {
        this._dom.listen();

        return this;
    };

    /**
     * Stop listening to DOM events.
     *
     * @return {BaseView} The instance itself to allow chaining
     */
    BaseView.prototype.unlisten = function () {
        this._dom.unlisten();

        return this;
    };

    ////////////////////////////////////////////////////////////

    /**
     * {@inheritDoc}
     */
    BaseView.prototype._link = function (view) {
        if (has('debug') && !(view instanceof BaseView)) {
            throw new Error('Views can only link other views.');
        }

        view._controller = this._controller;
        this._dom.addChild(view._dom);

        return Joint.prototype._link.call(this, view);
    };

    /**
     * {@inheritDoc}
     */
    BaseView.prototype._unlink = function (view) {
        if (view instanceof BaseView) {
            if (this._controller === view._controller) {
                view._controller = null;
            }

            this._dom.removeChild(view._dom);
        }

        return Joint.prototype._unlink.call(this, view);
    };

    /**
     * Checks if this view is the root view of a module or if it has been explicitly told to listen to DOM events.
     *
     * @return {Boolean} True if it is the root view, false otherwise
     */
    BaseView.prototype._isRoot = function () {
        // Check if it has been told to be listening
        if (this._dom.isListening()) {
            return true;
        }

        // Check if this view is the root view of the module
        if (this._uplink && this._uplink instanceof BaseView) {
            return false;
        }

        return true;
    };

    /**
     * Generates an URL.
     *
     * @param {String} state    The state name
     * @param {Object} [params] The state params
     *
     * @return {String} The generated URL
     */
    BaseView.prototype._generateUrl = function (state, params) {
        var controller = this._getController();

        if (has('debug') && !controller) {
            throw new Error('Could not find the controller responsible for "' + this.$name + '".');
        }

        return controller.generateUrl(state, params);
    };

    /**
     * Get the controller responsible for the view.
     * The view will be interpreted as the function context, so call this function with .call(view).
     *
     * @return {Controller} The view's controller
     */
    BaseView.prototype._getController = function () {
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
    BaseView.prototype._fillHelpers = function (target) {
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
    BaseView.prototype._onDestroy = function () {
        Joint.prototype._onDestroy.call(this);

        // Destroy responder
        this._dom.destroy();
        this._dom = null;

        // Destroy view element
        $(this._element).remove();

        // Null references
        this._element = this._nativeElement = null;
    };

    // Register handlebar helpers
    if (window.Handlebars) {
        Handlebars.registerHelper('url', function (state, params) {
            return this.$view._generateUrl(state, params.hash);
        });
    }

    return BaseView;
});
