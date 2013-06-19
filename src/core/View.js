/**
 * View abstract class.
 * This view is capable of being rendered and cleared.
 */
define([
    './BaseView',
    'mout/lang/isFunction',
    'has',
    'jquery'
], function (BaseView, isFunction, has, $) {

    'use strict';

    function View() {}

    View.prototype = Object.create(BaseView.prototype);
    View.prototype.constructor = View;

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
        // Render template if any
        if (this._template != null) {
            this.clear();

            if (has('debug') && !isFunction(this._template)) {
                throw new Error('Expected _template to be a compiled template (function).');
            }

            $(this._element).html(this._template(this._fillHelpers(data || {})));
        }

        // Listen to DOM events if this is a root view
        if (this._isRoot()) {
            this._dom.listen();
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
        var children = $(this._element).children().get();

        $(children).remove();
        this._element.innerHTML = '';

        return this;
    };

    return View;
});