/*jshint regexp:false */

/**
 * StateRegistry factory.
 * This factory might return null if the routing is disabled (by the config or if the address is not compatible with the browser).
 * This class provides access to the state registry as a service.
 */
define([
    'spoon/core/StateRegistry/StateRegistry',
    'services/address',
    'app-config',
    'amd-utils/lang/isString',
    'amd-utils/lang/isObject',
    'amd-utils/object/mixIn',
    'amd-utils/object/size',
    'has'
], function (StateRegistry, address, config, isString, isObject, mixIn, size, has) {

    'use strict';

    config = config || {};
    config = config.state || {};

    var registry = new StateRegistry(),
        states = config.states || [],
        curr,
        key,
        obj,
        pattern,
        fullPattern,
        constraints,
        priority,
        value,
        isLeaf,
        slashRegExp = /\/+$/g,
        paramsRegExp = /\(.+?\)/g,
        x,
        length,
        queue = [],
        arr = [];

    /**
     * Standardizes a pattern.
     * It ensures that it starts with a / and does not end with a /.
     *
     * @param {String} pattern The pattern to standardize
     *
     * @return {String} The standardized pattern
     */
    function standardizePattern(pattern) {
        if (pattern === '/') {
            return pattern;
        }

        if (pattern.charAt(0) !== '/') {
            pattern = '/' + pattern;
        }

        return pattern.replace(slashRegExp, '');
    }


    // Process the states and add them to the registry
    // The code bellow uses a stack (deep first) to avoid recursion
    queue.push({ obj: states });

    while (queue.length) {
        curr = queue.shift();
        obj = curr.obj;
        pattern = standardizePattern((curr.pattern ? curr.pattern : '') + (obj.$pattern || obj.key || ''));
        fullPattern = obj.$fullPattern ? standardizePattern(obj.$fullPattern) : null;
        constraints = mixIn(curr.constraints || {}, obj.$constraints);
        priority = obj.$priority || 0;
        delete obj.$pattern;
        delete obj.$constraints;
        delete obj.$fullPattern;
        delete obj.$priority;

        if (!size(constraints)) {
            constraints = null;
        }

        isLeaf = true;
        for (key in obj) {
            value = obj[key];
            key = key.replace(paramsRegExp, '');    // Remove the parentheses if any
            isLeaf = false;

            // Boolean falsy -> state has no route
            if (!value) {
                // We can add it already because the priority only apply to states with routes
                registry.register(curr.state ? curr.state + '.' + key : key);
            // String -> state has a route
            } else if (isString(obj[key])) {
                // Add to the array to be sorted later
                arr.push({
                    state: curr.state ? curr.state + '.' + key : key,
                    pattern:  standardizePattern(pattern + standardizePattern(value)),
                    constraints: constraints,
                    priority: priority
                });
            // Object -> add to the processing queue
            } else if (isObject(obj[key])) {
                queue.unshift({
                    obj: value,
                    state: curr.state ? curr.state + '.' + key : key,
                    key: key,
                    pattern: pattern,
                    constraints: constraints
                });
            } else if (has('debug')) {
                throw new Error('Unexpected "' + key + '" while parsing states.');
            }
        }

        if (curr.state) {
            arr.push({
                state: curr.state,
                pattern: fullPattern || pattern,
                constraints: constraints,
                priority: priority
            });
        }
    }

    // Sort the array according to the priority
    arr.sort(function (val1, val2) {
        if (val1.priority === val2.priority) {
            return 0;
        }

        if (val1.priority > val2.priority) {
            return -1;
        }

        return 1;
    });

    // Add the sorted array to the registry
    length = arr.length;
    for (x = 0; x < length; x += 1) {
        curr = arr[x];
        registry.register(curr.state, curr.pattern, curr.constraints);
    }

    // Inject the address if the routing is enabled
    if (!!config.routing) {
        registry.setAddress(address);
    }

    return registry;
});