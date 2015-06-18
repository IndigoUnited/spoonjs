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
    'address/util/parseUrl',
    'address/util/trimSlashes',
    'mout/string/startsWith',
    'mout/string/endsWith',
    'has'
], function (config, AddressHash, AddressHTML5, parseUrl, trimSlashes, startsWith, endsWith, has) {

    'use strict';

    var options = {},
        address,
        useHTML5,
        pos,
        parsed,
        tmp;

    config = config || {};
    config = config.address || {};
    options.basePath = config.basePath || '/';
    options.translate = location.protocol === 'file:' ? false : config.translate;

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
            if (options.translate && location.href.indexOf('#') === -1) {
                parsed = parseUrl(location.href);
                parsed.pathname = '/' + trimSlashes.leading(parsed.pathname);
                options.basePath = trimSlashes(options.basePath);
                pos = parsed.pathname.indexOf('/' + options.basePath);

                if (pos === 0) {
                    // Extract the value after the base path
                    tmp = trimSlashes(location.pathname.substr(pos + options.basePath.length + 1));

                    if (tmp) {
                        // Disable the address
                        address.disable();
                        // Finally redirect
                        window.location = parsed.protocol + parsed.doubleSlash + parsed.host + '/' + options.basePath + '#/' + tmp;
                    }
                }
            }
        }
    }

    return address;
});
