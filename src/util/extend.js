define(function () {

    'use strict';

    function noop() {}

    function extend(parent, props) {
        // Get constructor from the initialize or create one by default
        var child,
            childProto,
            key;

        /*jshint validthis:true */
        if (typeof parent === 'function') {
            props = props || {};
        } else {
            props = parent || {};
            parent = this === window ? null : this;
        }

        child = props.initialize || (parent ? function () { return parent.apply(this, arguments); } : noop);

        if (parent) {
            child.prototype = Object.create(parent.prototype);
        }

        childProto = child.prototype;
        childProto.constructor = child;

        // Copy props to prototype
        for (key in props) {
            childProto[key] = props[key];
        }

        // Add the static .extend
        child.extend = extend;

        return child;
    }

    return extend;
});
