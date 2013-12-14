/*jshint regexp:false, eqeqeq:false*/

/**
 * Address factory.
 * This factory instantiates either the hash or html5 address according to the browser and the configuration.
 * This class provides access to the address as a service.
 */
define([
    'app-config',
    'address/AddressHash',
    'address/AddressHTML5',
    'mout/string/startsWith',
    'mout/string/endsWith',
    'has'
], function (config, AddressHash, AddressHTML5, startsWith, endsWith, has) {

    'use strict';

    var options = {},
        address,
        useHTML5,
        pos,
        tmp;

    config = config || {};
    config = config.address || {};
    options.basePath = config.basePath || '/';
    options.translate = location.protocol === 'file:' ? false : config.translate;

    // Ensure that the base path starts and ends with a /
    if (!endsWith(options.basePath, '/')) {
        options.basePath += '/';
    }
    if (!startsWith(options.basePath, '/')) {
        options.basePath = '/' + options.basePath;
    }

    useHTML5 = !!config.html5;

    if (useHTML5 && AddressHTML5.isCompatible()) {
        address = AddressHTML5.getInstance(options);

        // If we have an hash, set its value as the current one
        if (options.translate) {
            pos = location.href.indexOf('#');
            if (pos !== -1) {
                address.setValue(location.href.substr(pos + 1));
            }
        }
    } else {
        // If no address is compatible we return null
        if (!AddressHash.isCompatible()) {
            if (has('debug')) {
                console.warn('[spoonjs] No address compatible with the current browser.');
            }
            address = null;
        } else {
            address = AddressHash.getInstance(options);

            // Check if the URL is an HTML5 one and redirect it to the translated one
            if (options.translate && !address.getValue() && location.pathname.length > 1 && location.pathname.indexOf('#') === -1) {
                pos = location.pathname.indexOf(options.basePath);
                if (pos === 0) {
                    // Extract the value after the base path
                    tmp = location.pathname.substr(pos + options.basePath.length);
                    // Remove trailing slashes and file names
                    tmp = tmp.replace(/\/*$/g, '').replace(/[^\/]*\.[^\/]+$/, '');
                    if (tmp) {
                        // Disable the address
                        address.disable();
                        // Finally redirect
                        window.location = location.protocol + '//' + location.hostname + (location.port && location.port != 80 ? ':' + location.port : '') + options.basePath + '#/' + tmp;
                    }
                }
            }
        }
    }

    return address;
});
