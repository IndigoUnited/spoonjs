/*jshint regexp:false */

/**
 * StateRegistry factory.
 * This factory might return null if the routing is disabled (by the config or if the address is not compatible with the browser).
 * This class provides access to the state registry as a service.
 */
define([
    './StateRegistry',
    'services/address',
    'app-config',
    'mout/lang/isObject',
    'mout/object/fillIn',
    'mout/object/size',
    'has'
], function (StateRegistry, address, config, isObject, fillIn, size, has) {

    'use strict';

    /**
     * Joins two patterns, standardizing them.
     *
     * @param {String} pattern1 The first pattern
     * @param {String} pattern2 The second pattern
     *
     * @return {String} The joined pattern
     */
    function patternJoin(pattern1, pattern2) {
        var joined;

        pattern1 = pattern1 ? pattern1.replace(trimSlashRegExp, '') : '';
        pattern2 = pattern2 ? pattern2.replace(trimSlashRegExp, '') : '';

        joined = pattern1 + '/' + pattern2;

        if (joined.charAt(0) !== '/') {
            joined = '/' + joined;
        }

        joined = joined.replace(cleanSlashRegExp, '/').replace(trimSlashRegExp, '');

        return joined || '/';
    }

    config = config || {};
    config = config.state || {};

    var registry = new StateRegistry(),
        states = config.states || [],
        curr,
        key,
        value,
        trimSlashRegExp = /\/+$/g,
        cleanSlashRegExp = /\/\/+/g,
        paramsRegExp = /\(.+?\)/g,
        x,
        length,
        queue = [],
        arr = [];

    // Process the states and add them to the registry
    // The code bellow uses a stack (deep first) to avoid recursion
    queue.push(states);

    while (queue.length) {
        curr = queue.shift();

        for (key in curr) {
            if (key.charAt(0) === '$') {
                continue;
            }

            value = curr[key];
            key = key.replace(paramsRegExp, '');    // Remove the parentheses if any

            // Boolean falsy -> state has no route
            if (!value) {
                // We can add it already because the priority only apply to states with routes
                registry.register(curr.$state ? curr.$state + '.' + key : key);
            // Object -> add to the processing queue
            } else if (isObject(value)) {
                value.$state = curr.$state ? curr.$state + '.' + key : key;
                value.$pattern = curr.$fullPattern || patternJoin(curr.$pattern, value.$pattern || key);
                value.$constraints = fillIn(value.$constraints || {}, curr.$constraints);

                queue.unshift(value);
            // String -> state has a route
            } else if (typeof value === 'string') {
                // Add to the array to be sorted later
                arr.push({
                    state: curr.$state ? curr.$state + '.' + key : key,
                    pattern: patternJoin(curr.$pattern, value),
                    constraints: curr.$constraints,
                    priority: curr.$priority || 0
                });
            } else if (has('debug')) {
                throw new Error('Unexpected "' + key + '" while parsing states.');
            }
        }

        if (curr.$state) {
            arr.push({
                state: curr.$state,
                pattern: curr.$fullPattern || curr.$pattern,
                constraints: curr.$constraints,
                priority: curr.$priority || 0
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
