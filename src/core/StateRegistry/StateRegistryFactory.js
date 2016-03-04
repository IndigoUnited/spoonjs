/*jshint loopfunc:true */

/**
 * StateRegistry factory.
 * This factory might return null if the routing is disabled (by the config or if the address is not compatible with the browser).
 * This class provides access to the state registry as a service.
 */
define([
    './StateRegistry',
    './Route',
    'services/address',
    'app-config',
    'mout/lang/isObject',
    'mout/lang/toArray',
    'mout/object/forOwn',
    'mout/object/hasOwn',
    'mout/object/fillIn',
    'mout/object/size',
    'mout/array/sort',
    '../../util/series',
    'has'
], function (StateRegistry, Route, address, config, isObject, toArray,
             forOwn, hasOwn, fillIn, size, sort, series, has) {

    'use strict';

    config = config || {};
    config = config.state || {};

    var registry = new StateRegistry(),
        trimSlashRegExp = /(^\/+)|(\/+$)/g,
        cleanDoubleSlashRegExp = /\/\/+/g,
        paramsRegExp = /\(.+?\)/g,
        queue = [],
        node;

    /**
     * Joins two patterns, standardizing them.
     *
     * @param {String} [pattern1] The first pattern
     * @param {String} [pattern2] The second pattern
     *
     * @return {String} The joined pattern
     */
    function patternJoin(pattern1, pattern2) {
        var joined;

        if (pattern1 != null && pattern2 != null) {
            joined = pattern1 + '/' + pattern2;
            joined = '/' + joined.replace(cleanDoubleSlashRegExp, '/').replace(trimSlashRegExp, '');

            return joined;
        }

        return pattern1 || pattern2;
    }

    /**
     * Chains a parent function with a child function (series).
     *
     * @param {Function} [parentFn] The parent function
     * @param {Function} [childFn]  The child function
     *
     * @return {Function} The chained function
     */
    function chainSeries(parentFn, childFn) {
        if (parentFn && childFn) {
            return function () {
                var args = toArray(arguments);
                var callback = args.pop();

                series.every([parentFn, childFn], function (fn, callback) {
                    args = args.concat([]);
                    args.push(callback);

                    return fn.apply(null, args);
                }, callback);
            };
        }

        return parentFn || childFn;
    }

    function normalizeEntry(entry) {
        // normalize entry itself to $url
        if (entry.value == null) {
            entry.value = { $url: null };
        } else if (typeof entry.value === 'string' || Array.isArray(entry.value)) {
            entry.value = { $url: entry.value };
        } else if (!hasOwn(entry.value, '$url')) {
            entry.value.$url = '/' + entry.key;
        }

        // entry.value.$url can be a string, an array of strings or an array of objects
        // normalize everything to an array of objects
        if (entry.value.$url) {
            entry.value.$url = (Array.isArray(entry.value.$url) ? entry.value.$url : [entry.value.$url])
            .map(function (url) {
                if (typeof url === 'string') {
                    url = { pattern: url };
                }

                url.supersede = !!(url.supersede || false);

                return url;
            });
            entry.value.$url = entry.value.$url.length ? entry.value.$url : null;
        }

        // entry.value.$validator can be a function or an object
        // normalize everything to an object
        if (entry.value.$validator) {
            if (typeof entry.value.$validator === 'function') {
                entry.value.$validator = { fn: entry.value.$validator };
            }

            entry.value.$validator.supersede = !!(entry.value.$validator.supersede || false);
        }

        // entry.value.$probe can be a function or an object
        // normalize everything to an object
        if (entry.value.$probe) {
            if (typeof entry.value.$probe === 'function') {
                entry.value.$probe = { fn: entry.value.$probe };
            }

            entry.value.$probe.supersede = !!(entry.value.$probe.supersede || false);
        }
    }

    function parseEntryAsNode(entry) {
        var node = {};
        var children;

        normalizeEntry(entry);

        node.state = entry.parentNode ? entry.parentNode.state + '.' + entry.key : entry.key;

        if (entry.value.$validator) {
            node.validator = entry.value.$validator.supersede ?
                entry.value.$validator.fn :
                chainSeries(entry.parentNode && entry.parentNode.validator, entry.value.$validator.fn);
        } else {
            node.validator = entry.parentNode && entry.parentNode.validator;
        }

        if (entry.value.$probe) {
            node.probe = entry.value.$probe.supersede ?
                entry.value.$probe.fn :
                chainSeries(entry.parentNode && entry.parentNode.probe, entry.value.$probe.fn);
        } else {
            node.probe = entry.parentNode && entry.parentNode.probe;
        }

        if (!entry.value.$url || (entry.parentNode && !entry.parentNode.urls)) {
            node.urls = null;
        } else if (!entry.parentNode) {
            node.urls = entry.value.$url.map(function (valueUrl) { return valueUrl.pattern; });
        } else {
            node.urls = [];

            entry.value.$url.forEach(function (valueUrl) {
                entry.parentNode.urls.forEach(function (parentUrl) {
                    node.urls.push(valueUrl.supersede ? valueUrl.pattern : patternJoin(parentUrl, valueUrl.pattern));
                });
            });
        }

        // Extract the children
        forOwn(entry.value, function (value, key) {
            if (key.charAt(0) !== '$') {
                children = children || [];
                children.push({ key: key, value: value });
            }
        });

        // If it has children, it is a branch
        if (children) {
            node.type = 'branch';
            node.children = children;
        } else {
            node.type = 'leaf';
        }

        return node;
    }


    // Process the states
    // The code bellow uses a stack (deep first) to avoid recursion
    forOwn(config.states, function (value, key) {
        queue.push({ parentNode: null, key: key.replace(paramsRegExp, ''), value: value });
    });

    while (queue.length) {
        node = parseEntryAsNode(queue.shift());

        // Register this state
        registry.register(node.state, node.validator);

        // Add to routes to be sorted later
        node.urls && node.urls.forEach(function (url) {
            registry.addRoute(new Route(node.state, url, node.probe));
        });

        // Keep iterating
        if (node.type === 'branch') {
            node.children.reverse().forEach(function (child) {
                queue.unshift({ parentNode: node, key: child.key, value: child.value });
            });
        }
    }

    // Inject the address if the routing is enabled
    if (!!config.routing) {
        registry.setAddress(address);
    }

    return registry;
});
