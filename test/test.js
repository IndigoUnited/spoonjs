/*jshint strict:false, node:true, onevar:false*/

// If we are at node then we use phantomjs + mocha-phantomjs
if (!(typeof window !== 'undefined' && window.navigator && window.document)) {
    var fs           = require('fs');
    var cp           = require('child_process');
    var createServer = require('http-server').createServer;

    // Start an HTTP Server to serve the files
    // This is needed because some tests fail intentionally in the file protocol
    var server = createServer({ root: __dirname + '/../' });
    server.listen(8081, '0.0.0.0', function () {
        var phantomjsBin = __dirname + '/../node_modules/.bin/phantomjs';
        var command = phantomjsBin + ' ' + __dirname + '/../node_modules/mocha-phantomjs/lib/mocha-phantomjs.coffee ' + 'http://localhost:8081/test/tester.html';
        var tests;

        fs.stat(phantomjsBin, function (error) {
            if (error) {
                phantomjsBin = 'phantomjs';
            }

            if (process.platform === 'win32') {
                tests = cp.spawn('cmd', ['/s', '/c', command], { customFds: [0, 1, 2] });
            } else {
                tests = cp.spawn('sh', ['-c', command], { customFds: [0, 1, 2] });
            }
            tests.on('exit', function (code) {
                process.exit(code ? 1 : 0);
            });
        });
    });

} else {
    var paths = {
        'mout': '../components/mout/src',
        'dejavu': '../components/dejavu/dist/amd/strict',
        'events-emitter': '../components/events-emitter/src',
        'base-adapter': '../components/base-adapter/src/adapters/jquery',
        'address': '../components/address/src',
        'dom-responder':  '../components/dom-responder/src',
        'jquery': '../node_modules/base-adapter-libs/jquery/jquery',
        'has': '../components/has/has',

        'app-config': './config',

        // Services
        'services/broadcaster': '../src/core/Broadcaster/BroadcasterFactory',
        'services/address': '../src/core/Address/AddressFactory',
        'services/state': '../src/core/StateRegistry/StateRegistryFactory'
    },
        map = {
            '*': {
                'base-adapter/src': '../components/base-adapter/src'
            }
        },
        packages = [
            {
                name: 'spoon',
                location: '../src'
            }
        ];

    require({
        baseUrl: './',
        paths: paths,
        map: map,
        packages: packages,
        waitSeconds: (window.location.protocol === 'file:' || window.location.href.indexOf('://localhost') !== -1) ? 5 : 45, // Fail early locally
        urlArgs: 'bust=' + (+new Date())
    });

    define(['base-adapter/dom/Utilities', 'has'], function (Utilities, has) {

        has.add('debug', !!window.console && !!console.info && !!console.log);

        Utilities.ready(function () {
            require(['app-config'], function (config) {
                // Turn  off translation in order for the url to not be translated
                // TODO: think of a better way to do this
                config.address = config.address || {};
                config.address.translate = false;

                require([
                    'specs/core',
                    'specs/console'
                ], function () {
                    if (window.mochaPhantomJS) {
                        mochaPhantomJS.run();
                    } else {
                        mocha.run();
                    }
                });
            });
        });
    });
}