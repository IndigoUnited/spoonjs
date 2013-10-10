define([
    'mout/lang/isPlainObject',
    'mout/object/deepMixIn',
    'mout/array/combine'
], function (isPlainObject, deepMixIn, combine) {

    'use strict';

    function noop() {}

    function extend(parent, props, merge) {
        // Get constructor from the initialize or create one by default
        var child,
            childProto,
            parentProto,
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
            parentProto = parent.prototype;
            child.prototype = Object.create(parentProto);
        }

        childProto = child.prototype;
        childProto.constructor = child;

        // Copy props to prototype
        for (key in props) {
            childProto[key] = props[key];
        }

        // Take care of props that need to be merged
        if (parent && merge) {
            merge.forEach(function (prop) {
                var parentProp = parentProto[prop],
                    childProp = props[prop];

                if (!parentProp || !childProp) {
                    return;
                }

                // Merge objects
                if (isPlainObject(childProp) && isPlainObject(parentProp)) {
                    deepMixIn(childProp, parentProp);
                // Merge arrays
                } else if (Array.isArray(childProp) && Array.isArray(parentProp)) {
                    combine(childProp, parentProp);
                }
            });
        }

        // Take care of $name
        childProto.$name = childProto.$name || 'Unnamed';

        // Add the static .extend
        child.extend = parent.extend || extend;

        return child;
    }

    return extend;
});
