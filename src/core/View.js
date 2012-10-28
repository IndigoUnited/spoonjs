/**
 * View abstract class.
 * This view is capable of being rendered and cleared.
 */
define([
    'dejavu/AbstractClass',
    './BaseView',
    'base-adapter/dom/Element',
    'amd-utils/lang/isFunction',
    'has'
], function (AbstractClass, BaseView, Element, isFunction, has) {

    'use strict';

    return AbstractClass.declare({
        $name: 'View',
        $extends: BaseView,

        //_template: null,  // This can't be declared because its actually a method and not a property.. and methods cannot replace properties.

        /**
         * Renders the declared template with the supplied data.
         * Note that if this view is not yet linked to its parent, it will make the
         * view listen to the declared DOM events, and also manage its descendants
         * uplinked DOM events.
         *
         * @param {Object} [$data] The data to pass to the template
         *
         * @return {View} The instance itself to allow chaining
         */
        render: function ($data) {
            // Render template if any
            if (this._template != null) {
                this.clear();

                if (has('debug') && !isFunction(this._template)) {
                    throw new Error('Expected _template to be a compiled template (function).');
                }

                Element.html(this._element, this._template(this._fillHelpers($data || {})));
            }

            // Listen to DOM events if this is a root view
            if (this._isRoot()) {
                this._dom.listen();
            }

            return this;
        },

        /**
         * Clears the view's element.
         * Note that you must explicitly call unlisten() to remove the DOM event listeners.
         *
         * @return {View} The instance itself to allow chaining
         */
        clear: function () {
            Element.remove(Element.children(this._element));
            this._element.innerHTML = '';

            return this;
        }
    });
});