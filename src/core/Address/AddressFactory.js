/*jshint regexp:false*/

/**
 * Address factory.
 * This factory instantiates either the hash or html5 address according to the browser and the configuration.
 * This class provides access to the address as a service.
 */
define([
    'address/AddressHash',
    'address/AddressHTML5',
    'app-config',
    'amd-utils/string/endsWith'
], function (AddressHash, AddressHTML5, config, endsWith) {

    'use strict';

    var options = {},
        address,
        useHTML5,
        pos,
        tmp;

    config = config || {},
    config = config.address || {};
    options.handleLinks = false;

    useHTML5 = !!config.html5;

    if (useHTML5 && AddressHTML5.isCompatible()) {
        options.basePath = config.basePath + (endsWith(config.basePath, '/') ? '' : '/');
        address = AddressHTML5.getInstance(options);

        // If we have an hash, set its value as the current one
        pos = location.href.indexOf('#');
        if (pos !== -1) {
            address.setValue(location.href.substr(pos + 1));
        }
    } else {
        // If no address is compatible we return null
        if (!AddressHash.isCompatible()) {
            console.warn('No address compatible with the current browser.');
            address = null;
        } else {
            address = AddressHash.getInstance(options);

            // Check if the URL is an HTML5 one and redirect it to the translated one
            if (!address.getValue()) {
                pos = location.href.indexOf(options.basePath);
                if (pos !== -1) {
                    tmp = location.href.substr(pos + options.basePath.length);
                    tmp = tmp.replace(/\/*$/g, '').replace(/\/.+\..+/g, '');

                    if (tmp && tmp !== '/#' + address.getValue()) {
                        window.location = location.protocol + '//' + location.host + (location.port ? ':' + location.port : '') + '/' + options.basePath + '/#' + tmp;
                    }
                }
            }
        }
    }

    return address;
});