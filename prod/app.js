
/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.8 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.8',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && navigator && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                removeScript(id);
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            var c,
                                pkg = getOwn(config.pkgs, mod.map.id);
                            // For packages, only support config targeted
                            // at the main module.
                            c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                                      getOwn(config.config, mod.map.id);
                            return  c || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
                                        //Make sure it is not already the exports value
                                        cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            if (!config.map) {
                                config.map = {};
                            }
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

define("../bower_components/requirejs/require", function(){});

/*global requirejs*/

requirejs.config({
    baseUrl: './dev/src',
    paths: {
        'mout': '../bower_components/mout/src',
        'events-emitter': '../bower_components/events-emitter/src',
        'address': '../bower_components/address/src',
        'jquery': '../bower_components/jquery/jquery',
        'doT': '../bower_components/doT/doT',
        'text': '../bower_components/requirejs-text/text',
        'has': '../bower_components/has/has',
        'bootstrap': '../bower_components/bootstrap/js/bootstrap',
        'bootstrap-css': '../bower_components/bootstrap/css',
        'normalize-css': '../bower_components/normalize-css',
        'rainbow': '../bower_components/rainbow',
        'jquery.scrollTo': '../bower_components/jquery.scrollTo/jquery.scrollTo'
    },
    shim: {
        'jquery.scrollTo': {
            deps: ['jquery'],
            exports: '$'
        },
        'rainbow': {
            exports: 'Rainbow'
        },
        'rainbow/js/language/generic': {
            deps: ['rainbow/js/rainbow'],
            exports: 'Rainbow'
        },
        'rainbow/js/language/javascript': {
            deps: ['rainbow/js/language/generic'],
            exports: 'Rainbow'
        }
    },
    map: {
        '*': {
            // App config (defaults to dev but changes during build)
            'app-config': '../app/config/config_prod',

            // Spoon
            'spoon': '../bower_components/spoonjs/src/index',

            // Spoon aliases
            'spoon/Controller': '../bower_components/spoonjs/src/core/Controller',
            'spoon/View': '../bower_components/spoonjs/src/core/View',

            // Spoon services
            'services/broadcaster': '../bower_components/spoonjs/src/core/Broadcaster/BroadcasterFactory',
            'services/address': '../bower_components/spoonjs/src/core/Address/AddressFactory',
            'services/state': '../bower_components/spoonjs/src/core/StateRegistry/StateRegistryFactory'
        }
    },
    packages: [
        // CSS plugin
        {
            name: 'css',
            location: '../bower_components/require-css',
            main: 'css'
        }
    ]
});

define("../app/loader", function(){});

/**
 * MixableEventsEmitter.
 * This is an abstract class because it is meant to be mixed in and not used as a standalone class.
 * This was necessary because the fireEvent had to be declared protected.
 */
define('events-emitter/MixableEventsEmitter',[],function () {

    

    var hasOwn = Object.prototype.hasOwnProperty,
        slice = Array.prototype.slice;

    function MixableEventsEmitter() {}

    /**
     * Adds a new event listener.
     * If the listener is already attached, it won't get duplicated.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The listener
     * @param {Object}   [context] The context in which the function will be executed, defaults to the instance
     *
     * @return {MixableEventsEmitter} The instance itself to allow chaining
     */
    MixableEventsEmitter.prototype.on = function (event, fn, context) {
        var events;

        this._listeners = this._listeners || {};
        events = this._listeners[event] = this._listeners[event] || [];

        if (getListenerIndex.call(this, event, fn, context) === -1) {
            events.push({ fn: fn, callable: fn, context: context });
        }

        return this;
    };

    /**
     * Adds a new event listener that is removed automatically afterwards.
     * If the listener is already attached, it won't get duplicated.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The listener
     * @param {Object}   [context] The context in which the function will be executed, defaults to the instance
     *
     * @return {MixableEventsEmitter} The instance itself to allow chaining
     */
    MixableEventsEmitter.prototype.once = function (event, fn, context) {
        var events,
            callable,
            that = this;

        this._listeners = this._listeners || {};
        events = this._listeners[event] = this._listeners[event] || [];

        if (getListenerIndex.call(this, event, fn, context) === -1) {
            callable = function () {
                fn.apply(this, arguments);
                that.off(event, fn, context);
            };

            events.push({ fn: fn, callable: callable, context: context });
        }

        return this;
    };

    /**
     * Removes an existent event listener.
     * If no fn and context is passed, removes all event listeners of a given name.
     * If no event is specified, removes all events of all names.
     *
     * @param {String}   [event]   The event name
     * @param {Function} [fn]      The listener
     * @param {Object}   [context] The context passed to the on() function
     *
     * @return {MixableEventsEmitter} The instance itself to allow chaining
     */
    MixableEventsEmitter.prototype.off = function (event, fn, context) {
        this._listeners = this._listeners || {};

        if (!fn && arguments.length < 2) {
            clearListeners.call(this, event);
        } else {
            var index = getListenerIndex.call(this, event, fn, context);

            if (index !== -1) {
                if (this._firing) {
                    this._listeners[event][index] = {};
                } else {
                    if (this._listeners[event].length === 1) {
                        delete this._listeners[event];
                    } else {
                        this._listeners[event].splice(index, 1);
                    }
                }
            }
        }

        return this;
    };

    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * Emits an event.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {MixableEventsEmitter} The instance itself to allow chaining
     */
    MixableEventsEmitter.prototype._emit = function (event) {
        var listeners,
            params,
            x,
            curr;

        this._listeners = this._listeners || {};
        listeners = this._listeners[event];

        if (listeners) {
            params = slice.call(arguments, 1),
            this._firing = true;

            for (x = 0; x < listeners.length; x += 1) {
                curr = listeners[x];

                // Check if the listener has been deleted meanwhile
                if (hasOwn.call(curr, 'fn')) {
                    curr.callable.apply(curr.context || this, params);
                } else {
                    listeners.splice(x, 1);
                    x -= 1;
                }
            }

            if (listeners.length === 0) {
                delete this._listeners[event];
            }

            this._firing = false;
        }
        
        return this;
    };

    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * Gets a listener index.
     *
     * @param {String}   name      The event name
     * @param {Function} fn        The function
     * @param {Object}   [context] The context passed to the on() function
     *
     * @return {Number} The index of the listener if found or -1 if not found
     */
    function getListenerIndex(event, fn, context) {
        /*jshint validthis:true*/
        var events = this._listeners[event],
            x,
            curr;

        if (events) {
            for (x = events.length - 1; x >= 0; x -= 1) {
                curr = events[x];
                if (curr.fn === fn && curr.context === context) {
                    return x;
                }
            }
        }

        return -1;
    }

    /**
     * Removes all listeners of the given event name.
     * If no event is specified, removes all events of all names.
     *
     * @param {String} [event] The event name
     */
    function clearListeners(event) {
        var key;

        /*jshint validthis:true*/
        if (event) {
            if (this._firing) {
                this._listeners[event].length = 0;
            } else {
                delete this._listeners[event];
            }
        } else {
            if (this._firing) {
                for (key in this._listeners) {
                    this._listeners[key].length = 0;
                }
            } else {
                this._listeners = {};
            }
        }
    }

    // Export some control functions that are used internally
    // They could be useful to be used by others
    MixableEventsEmitter.getListenerIndex = getListenerIndex;
    MixableEventsEmitter.clearListeners = clearListeners;

    return MixableEventsEmitter;
});

/**
 * EventsEmitter.
 * This class is equal to its base one but exposes the fireEvent method.
 */
define('events-emitter/EventsEmitter',[
    './MixableEventsEmitter'
], function (MixableEventsEmitter) {

    

    var getListenerIndex = MixableEventsEmitter.getListenerIndex;

    function EventsEmmiter() {}

    EventsEmmiter.prototype = Object.create(MixableEventsEmitter.prototype);
    EventsEmmiter.prototype.constructor = EventsEmmiter;

    /**
     * Emits an event.
     *
     * @param {String}   event The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {EventsEmitter} The instance itself to allow chaining
     */
    EventsEmmiter.prototype.emit = function () {
        return this._emit.apply(this, arguments);
    };

    /**
     * Check if a listener is attached to a given event name.
     * If no function is passed, it will check if at least one listener is attached.
     *
     * @param {String}   event     The event name
     * @param {Function} [fn]      The listener
     * @param {Object}   [context] The context passed to the on() function
     *
     * @return {Boolean} True if it is attached, false otherwise
     */
    EventsEmmiter.prototype.has = function (event, fn, context) {
        var events,
            x;

        this._listeners = this._listeners || {};

        if (!fn) {
            events = this._listeners[event];
            if (!this._firing) {
                return !!events;
            } else {
                for (x = events.length - 1; x >= 0; x -= 1) {
                    if (events[x].fn) {
                        return true;
                    }
                }

                return false;
            }
        } else {
            return getListenerIndex.call(this, event, fn, context) !== -1;
        }

        return this;
    };

    /**
     * Cycles through all the events and its listeners.
     * The function will receive the event name and the handler for each iteration.
     *
     * @param {Function} fn        The function to be called for each iteration
     * @param {Object}   [context] The context to be used while calling the function, defaults to the instance
     *
     * @return {EventsEmmiter} The instance itself to allow chaining
     */
    EventsEmmiter.prototype.forEach = function (fn, context) {
        var key,
            x,
            length,
            currEvent,
            curr;

        this._listeners = this._listeners || {};
        context = context || this;

        for (key in this._listeners) {
            currEvent = this._listeners[key];

            length = currEvent.length;
            for (x = 0; x < length; x += 1) {
                curr = currEvent[x];
                if (curr.fn) {
                    fn.call(context, key, curr.fn, curr.context);
                }
            }
        }
    };

    return EventsEmmiter;
});

define('has',{});
/**
 * Broadcaster class.
 */
define('../bower_components/spoonjs/src/core/Broadcaster/Broadcaster',[
    'events-emitter/EventsEmitter',
    'has'
], function (EventsEmitter, has) {

    

    /**
     * Constructor.
     */
    function Broadcaster() {
        this._emitter = new EventsEmitter();
    }

    /**
     * Adds a new event listener.
     * If the listener is already attached, it won't get duplicated.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The listener
     * @param {Object}   [context] The context in which the function will be executed, defaults to the instance
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.on = function (event, fn, context) {
        this._emitter.on(event, fn, context);

        return this;
    };

    /**
     * Adds a new event listener that is removed automatically afterwards.
     * If the listener is already attached, it won't get duplicated.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The listener
     * @param {Object}   [context] The context in which the function will be executed, defaults to the instance
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.once = function (event, fn, context) {
        this._emitter.once(event, fn, context);

        return this;
    };

    /**
     * Removes an existent event listener.
     * If no fn and context is passed, removes all event listeners of a given name.
     * If no event is specified, removes all events of all names.
     *
     * @param {String}   [event]   The event name
     * @param {Function} [fn]      The listener
     * @param {Object}   [context] The context passed to the on() method
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.off = function (event, fn, context) {
        this._emitter.off(event, fn, context);

        return this;
    };

    /**
     * Emits a broadcast event.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass to each listener
     *
     * @return {Broadcaster} The instance itself to allow chaining
     */
    Broadcaster.prototype.broadcast = function (event, args) {
        // If we got no interested subjects, warn that this event was unhandled
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
        } else if (false) {
            console.warn('Unhandled broadcast event "' + event + '".');
        }

        return this;
    };

    return Broadcaster;
});

/**
 * Broadcaster factory.
 * This class provides access to the broadcaster as a service.
 */
define('../bower_components/spoonjs/src/core/Broadcaster/BroadcasterFactory',[
    './Broadcaster'
], function (Broadcaster) {

    

    return new Broadcaster();
});

define('../bower_components/spoonjs/src/util/extend',[],function () {

    

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

        // Take care of $name
        childProto.$name = childProto.$name || 'Unnamed';

        // Add the static .extend
        child.extend = extend;

        return child;
    }

    return extend;
});

define('mout/array/indexOf',[],function () {

    /**
     * Array.indexOf
     */
    function indexOf(arr, item, fromIndex) {
        fromIndex = fromIndex || 0;
        if (arr == null) {
            return -1;
        }

        var len = arr.length,
            i = fromIndex < 0 ? len + fromIndex : fromIndex;
        while (i < len) {
            // we iterate over sparse items since there is no way to make it
            // work properly on IE 7-8. see #64
            if (arr[i] === item) {
                return i;
            }

            i++;
        }

        return -1;
    }

    return indexOf;
});

define('mout/function/prop',[],function () {

    /**
     * Returns a function that gets a property of the passed object
     */
    function prop(name){
        return function(obj){
            return obj[name];
        };
    }

    return prop;

});

define('mout/object/hasOwn',[],function () {

    /**
     * Safer Object.hasOwnProperty
     */
     function hasOwn(obj, prop){
         return Object.prototype.hasOwnProperty.call(obj, prop);
     }

     return hasOwn;

});

define('mout/object/forIn',[],function () {

    var _hasDontEnumBug,
        _dontEnums;

    function checkDontEnum(){
        _dontEnums = [
                'toString',
                'toLocaleString',
                'valueOf',
                'hasOwnProperty',
                'isPrototypeOf',
                'propertyIsEnumerable',
                'constructor'
            ];

        _hasDontEnumBug = true;

        for (var key in {'toString': null}) {
            _hasDontEnumBug = false;
        }
    }

    /**
     * Similar to Array/forEach but works over object properties and fixes Don't
     * Enum bug on IE.
     * based on: http://whattheheadsaid.com/2010/10/a-safer-object-keys-compatibility-implementation
     */
    function forIn(obj, fn, thisObj){
        var key, i = 0;
        // no need to check if argument is a real object that way we can use
        // it for arrays, functions, date, etc.

        //post-pone check till needed
        if (_hasDontEnumBug == null) checkDontEnum();

        for (key in obj) {
            if (exec(fn, obj, key, thisObj) === false) {
                break;
            }
        }

        if (_hasDontEnumBug) {
            while (key = _dontEnums[i++]) {
                // since we aren't using hasOwn check we need to make sure the
                // property was overwritten
                if (obj[key] !== Object.prototype[key]) {
                    if (exec(fn, obj, key, thisObj) === false) {
                        break;
                    }
                }
            }
        }
    }

    function exec(fn, obj, key, thisObj){
        return fn.call(thisObj, obj[key], key, obj);
    }

    return forIn;

});

define('mout/object/forOwn',['./hasOwn', './forIn'], function (hasOwn, forIn) {

    /**
     * Similar to Array/forEach but works over object properties and fixes Don't
     * Enum bug on IE.
     * based on: http://whattheheadsaid.com/2010/10/a-safer-object-keys-compatibility-implementation
     */
    function forOwn(obj, fn, thisObj){
        forIn(obj, function(val, key){
            if (hasOwn(obj, key)) {
                return fn.call(thisObj, obj[key], key, obj);
            }
        });
    }

    return forOwn;

});

define('mout/lang/kindOf',[],function () {

    var _rKind = /^\[object (.*)\]$/,
        _toString = Object.prototype.toString,
        UNDEF;

    /**
     * Gets the "kind" of value. (e.g. "String", "Number", etc)
     */
    function kindOf(val) {
        if (val === null) {
            return 'Null';
        } else if (val === UNDEF) {
            return 'Undefined';
        } else {
            return _rKind.exec( _toString.call(val) )[1];
        }
    }
    return kindOf;
});

define('mout/lang/isKind',['./kindOf'], function (kindOf) {
    /**
     * Check if value is from a specific "kind".
     */
    function isKind(val, kind){
        return kindOf(val) === kind;
    }
    return isKind;
});

define('mout/lang/isArray',['./isKind'], function (isKind) {
    /**
     */
    var isArray = Array.isArray || function (val) {
        return isKind(val, 'Array');
    };
    return isArray;
});

define('mout/object/deepMatches',['./forOwn', '../lang/isArray'], function(forOwn, isArray) {

    function containsMatch(array, pattern) {
        var i = -1, length = array.length;
        while (++i < length) {
            if (deepMatches(array[i], pattern)) {
                return true;
            }
        }

        return false;
    }

    function matchArray(target, pattern) {
        var i = -1, patternLength = pattern.length;
        while (++i < patternLength) {
            if (!containsMatch(target, pattern[i])) {
                return false;
            }
        }

        return true;
    }

    function matchObject(target, pattern) {
        var result = true;
        forOwn(pattern, function(val, key) {
            if (!deepMatches(target[key], val)) {
                // Return false to break out of forOwn early
                return (result = false);
            }
        });

        return result;
    }

    /**
     * Recursively check if the objects match.
     */
    function deepMatches(target, pattern){
        if (target && typeof target === 'object') {
            if (isArray(target) && isArray(pattern)) {
                return matchArray(target, pattern);
            } else {
                return matchObject(target, pattern);
            }
        } else {
            return target === pattern;
        }
    }

    return deepMatches;

});

define('mout/function/makeIterator_',['./prop', '../object/deepMatches'], function(prop, deepMatches) {

    /**
     * Converts argument into a valid iterator.
     * Used internally on most array/object/collection methods that receives a
     * callback/iterator providing a shortcut syntax.
     */
    function makeIterator(src, thisObj){
        switch(typeof src) {
            case 'function':
                // function is the first to improve perf (most common case)
                return (typeof thisObj !== 'undefined')? function(val, i, arr){
                    return src.call(thisObj, val, i, arr);
                } : src;
            case 'object':
                // typeof null == "object"
                return (src != null)? function(val){
                    return deepMatches(val, src);
                } : src;
            case 'string':
            case 'number':
                return prop(src);
            default:
                return src;
        }
    }

    return makeIterator;

});

define('mout/array/filter',['../function/makeIterator_'], function (makeIterator) {

    /**
     * Array filter
     */
    function filter(arr, callback, thisObj) {
        callback = makeIterator(callback, thisObj);
        var results = [];
        if (arr == null) {
            return results;
        }

        var i = -1, len = arr.length, value;
        while (++i < len) {
            value = arr[i];
            if (callback(value, i, arr)) {
                results.push(value);
            }
        }

        return results;
    }

    return filter;

});

define('mout/array/unique',['./indexOf', './filter'], function(indexOf, filter){

    /**
     * @return {array} Array of unique items
     */
    function unique(arr){
        return filter(arr, isUnique);
    }

    function isUnique(item, i, arr){
        return indexOf(arr, item, i+1) === -1;
    }

    return unique;
});


define('mout/array/some',['../function/makeIterator_'], function (makeIterator) {

    /**
     * Array some
     */
    function some(arr, callback, thisObj) {
        callback = makeIterator(callback, thisObj);
        var result = false;
        if (arr == null) {
            return result;
        }

        var i = -1, len = arr.length;
        while (++i < len) {
            // we iterate over sparse items since there is no way to make it
            // work properly on IE 7-8. see #64
            if ( callback(arr[i], i, arr) ) {
                result = true;
                break;
            }
        }

        return result;
    }

    return some;
});

define('mout/array/contains',['./indexOf'], function (indexOf) {

    /**
     * If array contains values.
     */
    function contains(arr, val) {
        return indexOf(arr, val) !== -1;
    }
    return contains;
});

define('mout/array/difference',['./unique', './filter', './some', './contains'], function (unique, filter, some, contains) {


    /**
     * Return a new Array with elements that aren't present in the other Arrays.
     */
    function difference(arr) {
        var arrs = Array.prototype.slice.call(arguments, 1),
            result = filter(unique(arr), function(needle){
                return !some(arrs, function(haystack){
                    return contains(haystack, needle);
                });
            });
        return result;
    }

    return difference;

});

define('mout/lang/toArray',['./kindOf'], function (kindOf) {

    var _win = this;

    /**
     * Convert array-like object into array
     */
    function toArray(val){
        var ret = [],
            kind = kindOf(val),
            n;

        if (val != null) {
            if ( val.length == null || kind === 'String' || kind === 'Function' || kind === 'RegExp' || val === _win ) {
                //string, regexp, function have .length but user probably just want
                //to wrap value into an array..
                ret[ret.length] = val;
            } else {
                //window returns true on isObject in IE7 and may have length
                //property. `typeof NodeList` returns `function` on Safari so
                //we can't use it (#58)
                n = val.length;
                while (n--) {
                    ret[n] = val[n];
                }
            }
        }
        return ret;
    }
    return toArray;
});

define('mout/array/insert',['./difference', '../lang/toArray'], function (difference, toArray) {

    /**
     * Insert item into array if not already present.
     */
    function insert(arr, rest_items) {
        var diff = difference(toArray(arguments).slice(1), arr);
        if (diff.length) {
            Array.prototype.push.apply(arr, diff);
        }
        return arr.length;
    }
    return insert;
});

define('mout/array/remove',['./indexOf'], function(indexOf){

    /**
     * Remove a single item from the array.
     * (it won't remove duplicates, just a single item)
     */
    function remove(arr, item){
        var idx = indexOf(arr, item);
        if (idx !== -1) arr.splice(idx, 1);
    }

    return remove;
});

/**
 * Joint abstract class.
 * A Joint represents a node in the hierarchy.
 */
define('../bower_components/spoonjs/src/core/Joint',[
    'events-emitter/EventsEmitter',
    'services/broadcaster',
    '../util/extend',
    'mout/array/insert',
    'mout/array/remove',
    'has'
], function (EventsEmitter, broadcaster, extend, insert, remove, has) {

    

    /**
     * Constructor.
     */
    function Joint() {
        this._downlinks = [];
        this._emitter = new EventsEmitter();
    }

    Joint.extend = extend;

    /**
     * Adds a listener for an upcast or broadcast event.
     * Duplicate listeners for the same event will be discarded.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The handler
     * @param {Object}   [context] The context to be used to call the handler, defaults to the joint instance
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype.on = function (event, fn, context) {
        context = context || this;

        this._emitter.on(event, fn, context);
        broadcaster.on(event, fn, context);

        return this;
    };

    /**
     * Adds a one time listener for an upcast or broadcast event.
     * Duplicate listeners for the same event will be discarded.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The handler
     * @param {Object}   [context] The context to be used to call the handler, defaults to the joint instance
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype.once = function (event, fn, context) {
        context = context || this;

        this._emitter.once(event, fn, context);
        broadcaster.once(event, fn, context);

        return this;
    };

    /**
     * Removes a previously added listener.
     *
     * @param {String}   event     The event name
     * @param {Function} fn        The handler
     * @param {Object}   [context] The context passed to the on() method
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype.off = function (event, fn, context) {
        context = context || this;

        this._emitter.off(event, fn, context);
        broadcaster.off(event, fn, context);

        return this;
    };

    /**
     * Destroys the instance, releasing all of its resources.
     * Note that all downlinks will also be destroyed.
     */
    Joint.prototype.destroy = function () {
        if (!this._destroyed) {
            this._onDestroy();
            this._destroyed = true;
        }
    };

    ////////////////////////////////////////////////////////////

    /**
     * Creates a link between this joint and another one.
     *
     * @param {Joint} joint Another joint to link to this one
     *
     * @return {Joint} The joint passed in as the argument
     */
    Joint.prototype._link = function (joint) {
        if (false && joint._uplink && joint._uplink !== this) {
            throw new Error('"' + this.$name + '" is already linked to other joint');
        }

        if (joint._uplink !== this) {
            joint._uplink = this;
            insert(this._downlinks, joint);
            joint._emitter.emit('link', this);
        }

        return joint;
    };

    /**
     * Removes a previously created link between this joint and another one.
     *
     * @param {Joint} joint Another joint to link to this one
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype._unlink = function (joint) {
        remove(this._downlinks, joint);

        if (joint._uplink === this) {
            joint._uplink = null;
            joint._emitter.emit('unlink', this);
        }

        return this;
    };

    /**
     * Fires an event upwards the chain.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype._upcast = function (event, args) {
        // Check if the event will be handled locally
        // Otherwise we will keep upcasting upwards the chain
        if (this._emitter.has(event)) {
            this._emitter.emit.apply(this._emitter, arguments);
        } else if (this._uplink) {
            this._uplink._upcast.apply(this._uplink, arguments);
        } else if (false) {
            console.warn('Unhandled upcast event "' + event + '".');
        }

        return this;
    };

    /**
     * Fires an event to all the joints.
     *
     * @param {String}   event  The event name
     * @param {...mixed} [args] The arguments to pass along with the event
     *
     * @return {Joint} The instance itself to allow chaining
     */
    Joint.prototype._broadcast = function (event, args) {
        broadcaster.broadcast.apply(broadcaster, arguments);

        return this;
    };

    /**
     * Function called by destroy().
     * Subclasses should override this method to release additional resources.
     *
     * The default implementation will also destroy any linked joints.
     */
    Joint.prototype._onDestroy = function () {
        var x,
            curr;

        // Remove the listeners from the broadcaster
        this._emitter.forEach(broadcaster.off, broadcaster);

        // Clear the listeners
        this._emitter.off();

        // Foreach uplink, automatically unlink this instance
        if (this._uplink) {
            this._uplink._unlink(this);
            this._uplink = null;
        }

        // Foreach downlink, automatically unlink it and destroy
        for (x = this._downlinks.length - 1; x >= 0; x -= 1) {
            curr = this._downlinks[x];
            this._unlink(curr);
            curr.destroy();
        }

        this._downlinks = null;
    };

    return Joint;
});

define('mout/object/keys',['./forOwn'], function (forOwn) {

    /**
     * Get object keys
     */
     var keys = Object.keys || function (obj) {
            var keys = [];
            forOwn(obj, function(val, key){
                keys.push(key);
            });
            return keys;
        };

    return keys;

});

define('mout/object/values',['./forOwn'], function (forOwn) {

    /**
     * Get object values
     */
    function values(obj) {
        var vals = [];
        forOwn(obj, function(val, key){
            vals.push(val);
        });
        return vals;
    }

    return values;

});

define('mout/lang/isPlainObject',[],function () {

    /**
     * Checks if the value is created by the `Object` constructor.
     */
    function isPlainObject(value) {
        return (!!value && typeof value === 'object' &&
            value.constructor === Object);
    }

    return isPlainObject;

});

define('mout/object/mixIn',['./forOwn'], function(forOwn){

    /**
    * Combine properties from all the objects into first one.
    * - This method affects target object in place, if you want to create a new Object pass an empty object as first param.
    * @param {object} target    Target Object
    * @param {...object} objects    Objects to be combined (0...n objects).
    * @return {object} Target Object.
    */
    function mixIn(target, objects){
        var i = 0,
            n = arguments.length,
            obj;
        while(++i < n){
            obj = arguments[i];
            if (obj != null) {
                forOwn(obj, copyProp, target);
            }
        }
        return target;
    }

    function copyProp(val, key){
        this[key] = val;
    }

    return mixIn;
});

define('mout/lang/clone',['./kindOf', './isPlainObject', '../object/mixIn'], function (kindOf, isPlainObject, mixIn) {

    /**
     * Clone native types.
     */
    function clone(val){
        switch (kindOf(val)) {
            case 'Object':
                return cloneObject(val);
            case 'Array':
                return cloneArray(val);
            case 'RegExp':
                return cloneRegExp(val);
            case 'Date':
                return cloneDate(val);
            default:
                return val;
        }
    }

    function cloneObject(source) {
        if (isPlainObject(source)) {
            return mixIn({}, source);
        } else {
            return source;
        }
    }

    function cloneRegExp(r) {
        var flags = '';
        flags += r.multiline ? 'm' : '';
        flags += r.global ? 'g' : '';
        flags += r.ignorecase ? 'i' : '';
        return new RegExp(r.source, flags);
    }

    function cloneDate(date) {
        return new Date(+date);
    }

    function cloneArray(arr) {
        return arr.slice();
    }

    return clone;

});

define('mout/lang/deepClone',['./clone', '../object/forOwn', './kindOf', './isPlainObject'], function (clone, forOwn, kindOf, isPlainObject) {

    /**
     * Recursively clone native types.
     */
    function deepClone(val, instanceClone) {
        switch ( kindOf(val) ) {
            case 'Object':
                return cloneObject(val, instanceClone);
            case 'Array':
                return cloneArray(val, instanceClone);
            default:
                return clone(val);
        }
    }

    function cloneObject(source, instanceClone) {
        if (isPlainObject(source)) {
            var out = {};
            forOwn(source, function(val, key) {
                this[key] = deepClone(val, instanceClone);
            }, out);
            return out;
        } else if (instanceClone) {
            return instanceClone(source);
        } else {
            return source;
        }
    }

    function cloneArray(arr, instanceClone) {
        var out = [],
            i = -1,
            n = arr.length,
            val;
        while (++i < n) {
            out[i] = deepClone(arr[i], instanceClone);
        }
        return out;
    }

    return deepClone;

});


/*jshint eqeqeq:false*/

/**
 * State class.
 */
define('../bower_components/spoonjs/src/core/StateRegistry/State',[
    'mout/object/keys',
    'mout/object/values',
    'mout/lang/deepClone',
    'mout/array/filter',
    'has'
], function (keys, values, deepClone, filter, has) {

    

    /**
     * Constructor.
     *
     * Special parameters can be prefixed with $.
     * Those will not be taken into account in the comparisons.
     *
     * @param {String} name     The state name
     * @param {Object} [params] The state parameters
     */
    function State(name, params) {
        this._nrParts = 0;
        this._cursor = 0;

        this.setFullName(name);
        this.setParams(params);
    }

    /**
     * Get the full state name.
     *
     * @return {String} The full state name
     */
    State.prototype.getFullName = function () {
        return this._name;
    };

    /**
     * Sets the full state name.
     *
     * @param {String} name The full state name
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.setFullName = function (name) {
        if (false && !this.constructor.isValid(name)) {
            throw new Error('State name "' + name + '" has an invalid format.');
        }

        this._name = name;
        this._parts = name.split('.');
        this._nrParts = this._parts.length;
        this.setCursor(this._cursor);

        return this;
    };

    /**
     * Get the state name (the name immediately after the current cursor position).
     *
     * @return {String} The name
     */
    State.prototype.getName = function () {
        return this._cursor < this._nrParts ? this._parts[this._cursor] : null;
    };

    /**
     * Get the state parameters.
     *
     * @return {Object} The state parameters
     */
    State.prototype.getParams = function () {
        return this._params;
    };

    /**
     * Set the state parameters.
     *
     * @param {Object} params The state parameters
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.setParams = function (params) {
        this._params = params || {};

        return this;
    };

    /**
     * Advance the cursor position.
     * Note that the cursor is allowed to move forward to the last position, so that getName() returns null.
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.next = function () {
        if (this._cursor < this._nrParts) {
            this._cursor += 1;
        }

        return this;
    };

    /**
     * Recede the cursor position.
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.previous = function () {
        if (this._cursor > 1) {
            this._cursor -= 1;
        }

        return this;
    };

    /**
     * Get the current cursor position.
     *
     * @return {Number} The cursor position
     */
    State.prototype.getCursor = function () {
        return this._cursor;
    };

    /**
     * Sets the current cursor position.
     *
     * @param {Number} The new position
     *
     * @return {State} The instance itself to allow chaining
     */
    State.prototype.setCursor = function (cursor) {
        if (this._cursor > this._nrParts) {
            this._cursor = this._nrParts;
        } else if (this._cursor < 0) {
            this._cursor = 0;
        } else {
            this._cursor = cursor;
        }

        return this;
    };

    /**
     * Compares the instance to another one.
     * The state is considered to the same if the name and parameters are the same.
     * If parameter names are passed, those will be compared.
     * If no parameter names are passed, all parameters are compared.
     *
     * @param {State} state         The state
     * @param {Array} [stateParams] An array of parameter names to be compared
     *
     * @return {Boolean} True if the state is the same, false otherwise
     */
    State.prototype.isEqual = function (state, stateParams) {
        var x,
            curr;

        // Strict comparison first
        if (this === state) {
            return true;
        }

        // Compare the name
        if (this.getName() !== state.getName()) {
            return false;
        }

        // Compare the state params if any
        if (stateParams) {
            for (x = stateParams.length - 1; x >= 0; x -= 1) {
                curr = stateParams[x];
                if (this._params[curr] != state._params[curr]) {
                    return false;
                }
            }

            return true;
        }

        // Otherwise compare them all
        return this._compareObjects(this._params, state._params);
    };

    /**
     * Compares the instance to another one.
     * The state is considered to be fully equal if the full state name and parameters are the same.
     *
     * @param {State} state The state
     *
     * @return {Boolean} True if the state is fully equal, false otherwise.
     */
    State.prototype.isFullyEqual = function (state) {
        // Strict comparison first
        if (this === state) {
            return true;
        }

        // Compare the name
        if (this._name !== state._name) {
            return false;
        }

        // Compare all the params
        return this._compareObjects(this._params, state._params);
    };

    /**
     * Clones the state.
     *
     * @param {Boolean} [cloneParams] True to deep clone the params, false otherwise (defaults to false)
     *
     * @return {State} The cloned state
     */
    State.prototype.clone = function (cloneParams) {
        var ret;

        // Create new state
        ret = new State(this._name, cloneParams ? deepClone(this._params) : this._params);
        ret._cursor = this._cursor;

        return ret;
    };

    ////////////////////////////////////////////////////////

    /**
     * Compares two objects loosely and not recursively.
     *
     * @param {Object} obj1 The first object to be compared
     * @param {Object} obj2 The second object to be compared
     *
     * @return {Boolean} True if they are loosely equal, false otherwise
     */
    State.prototype._compareObjects = function (obj1, obj2) {
        var keys1 = keys(obj1),
            keys2 = keys(obj2),
            key,
            x;

        // Remove special keys
        keys1 = filter(keys1, function (key) {
            return key.charAt(0) !== '$';
        });
        keys2 = filter(keys2, function (key) {
            return key.charAt(0) !== '$';
        });

        // Compare the objects
        // We first compare the first with the second and then the second with the first
        for (x = keys1.length - 1; x >= 0; x -= 1) {
            key = keys1[x];

            if (obj1[key] != obj2[key]) {
                return false;
            }
        }
        for (x = keys2.length - 1; x >= 0; x -= 1) {
            key = keys2[x];

            if (obj2[key] != obj1[key]) {
                return false;
            }
        }

        return true;
    };

    ////////////////////////////////////////////////////////

    State._nameRegExp = /^([a-z0-9_\-]+(\.[a-z0-9_\-]+)*)?$/i;

    /**
     * Checks if a given state name is valid.
     *
     * @param {String} name The state name
     *
     * @return {Boolean} True if valid, false otherwise
     */
    State.isValid = function (name) {
        var regExp = this._nameRegExp || State._nameRegExp;

        return regExp.test(name);
    };

    return State;
});

define('mout/lang/toString',[],function () {

    /**
     * Typecast a value to a String, using an empty string value for null or
     * undefined.
     */
    function toString(val){
        return val == null ? '' : val.toString();
    }

    return toString;

});

define('mout/string/escapeRegExp',['../lang/toString'], function(toString) {

    var ESCAPE_CHARS = /[\\.+*?\^$\[\](){}\/'#]/g;

    /**
     * Escape RegExp string chars.
     */
    function escapeRegExp(str) {
        str = toString(str);
        return str.replace(ESCAPE_CHARS,'\\$&');
    }

    return escapeRegExp;

});

/*jshint regexp:false*/

/**
 * Route class.
 */
define('../bower_components/spoonjs/src/core/StateRegistry/Route',[
    'mout/string/escapeRegExp',
    'mout/object/hasOwn',
    'has'
], function (escapeRegExp, hasOwn, has) {

    

    /**
     * Constructor.
     *
     * @param {String} name          The name
     * @param {String} pattern       The pattern
     * @param {Object} [constraints] The constraints to apply to the parameters
     */
    function Route(name, pattern, constraints) {
        if (false && pattern.charAt(0) !== '/') {
            throw new Error('A route pattern must start with a /.');
        }

        constraints = constraints || {};

        var regExp = escapeRegExp(pattern),
            x,
            curr,
            tmp;

        this._name = name;
        this._pattern = pattern;
        this._constraints = constraints;

        // Extract the placeholder names
        this._placeholderNames = regExp.match(this.constructor._placeholdersEscapedRegExp);
        if (this._placeholderNames) {
            for (x = this._placeholderNames.length - 1; x >= 0; x -= 1) {
                curr = this._placeholderNames[x].slice(2, -2);
                tmp = constraints[curr] ? constraints[curr].toString().slice(1, -1) : '[^\/]+?';
                regExp = regExp.replace(this._placeholderNames[x], '(' + tmp + ')');
                this._placeholderNames[x] = curr;
            }
        }

        // Create a regexp for this pattern so it can be used to match against
        this._regExp = new RegExp('^' + regExp + '$');
    }

    /**
     * Get the route name.
     *
     * @return {String} The route name
     */
    Route.prototype.getName = function () {
        return this._name;
    };

    /**
     * Tests the route against an URL.
     *
     * @param {String} url The URL to check against
     *
     * @return {Boolean} True if it matches, false otherwise
     */
    Route.prototype.test = function (url) {
        // Simply test against the generated regexp
        return this._regExp.test(url);
    };

    /**
     * Similar to test but returns an object with all the placeholders filled in.
     * If the URL doesn't match against the route, null is returned.
     *
     * @param {String} url The URL to match against
     *
     * @return {Object} The object containing all the matches, or null if it doesn't match
     */
    Route.prototype.match = function (url) {
        var params,
            matches,
            x;

        // Simply match against the generated regexp
        matches = url.match(this._regExp);
        if (matches) {
            params = {};
            for (x = matches.length - 1; x >= 1; x -= 1) {
                params[this._placeholderNames[x - 1]] = matches[x];
            }
        } else {
            params = null;
        }

        return params;
    };

    /**
     * Generates an URL for this route.
     *
     * @param {Object} [params] An object containg the route parameters
     *
     * @return {String} The URL
     */
    Route.prototype.generateUrl = function (params) {
        var url = this._pattern,
            constraints = this._constraints || {},
            placeholderName,
            placeholderValue,
            length = this._placeholderNames ? this._placeholderNames.length : 0,
            x;

        if (length) {
            params = params || {};

            for (x = 0; x < length; x += 1) {
                placeholderName = this._placeholderNames[x];

                // Check if parameter was forgotten
                if (false && !hasOwn(params, placeholderName)) {
                    throw new Error('Missing param "' + placeholderName + '".');
                }

                // Coerce it into a string
                placeholderValue = '' + params[placeholderName];

                // Validate against the constraints
                if (false && constraints[placeholderName] && !constraints[placeholderName].test(placeholderValue)) {
                    throw new Error('Param "' + placeholderName + '" with value "' + placeholderValue + '" does not pass the constraint.');
                }

                // Replace it in the URL
                url = url.replace(this.constructor._placeholdersRegExp, placeholderValue);
            }
        }

        return url;
    };

    ////////////////////////////////////////////////////////

    Route._placeholdersRegExp = /\{.+?\}/;
    Route._placeholdersEscapedRegExp = /\\\{.+?\\\}/g;

    return Route;
});

define('mout/string/startsWith',['../lang/toString'], function (toString) {
    /**
     * Checks if string starts with specified prefix.
     */
    function startsWith(str, prefix) {
        str = toString(str);
        prefix = toString(prefix);

        return str.indexOf(prefix) === 0;
    }

    return startsWith;
});

define('mout/string/typecast',[],function () {

    var UNDEF;

    /**
     * Parses string and convert it into a native value.
     */
    function typecast(val) {
        var r;
        if ( val === null || val === 'null' ) {
            r = null;
        } else if ( val === 'true' ) {
            r = true;
        } else if ( val === 'false' ) {
            r = false;
        } else if ( val === UNDEF || val === 'undefined' ) {
            r = UNDEF;
        } else if ( val === '' || isNaN(val) ) {
            //isNaN('') returns false
            r = val;
        } else {
            //parseFloat(null || '') returns NaN
            r = parseFloat(val);
        }
        return r;
    }

    return typecast;
});

define('mout/lang/isString',['./isKind'], function (isKind) {
    /**
     */
    function isString(val) {
        return isKind(val, 'String');
    }
    return isString;
});

define('mout/queryString/decode',['../string/typecast', '../lang/isString', '../lang/isArray', '../object/hasOwn'], function (typecast, isString, isArray, hasOwn) {

    /**
     * Decode query string into an object of keys => vals.
     */
    function decode(queryStr, shouldTypecast) {
        var queryArr = (queryStr || '').replace('?', '').split('&'),
            count = -1,
            length = queryArr.length,
            obj = {},
            item, pValue, pName, toSet;

        while (++count < length) {
            item = queryArr[count].split('=');
            pName = item[0];
            if (!pName || !pName.length){
                continue;
            }
            pValue = shouldTypecast === false ? item[1] : typecast(item[1]);
            toSet = isString(pValue) ? decodeURIComponent(pValue) : pValue;
            if (hasOwn(obj,pName)){
                if(isArray(obj[pName])){
                    obj[pName].push(toSet);
                } else {
                    obj[pName] = [obj[pName],toSet];
                }
            } else {
                obj[pName] = toSet;
           }
        }
        return obj;
    }

    return decode;
});

define('mout/array/forEach',[],function () {

    /**
     * Array forEach
     */
    function forEach(arr, callback, thisObj) {
        if (arr == null) {
            return;
        }
        var i = -1,
            len = arr.length;
        while (++i < len) {
            // we iterate over sparse items since there is no way to make it
            // work properly on IE 7-8. see #64
            if ( callback.call(thisObj, arr[i], i, arr) === false ) {
                break;
            }
        }
    }

    return forEach;

});

define('mout/queryString/encode',['../object/forOwn','../lang/isArray','../array/forEach'], function (forOwn,isArray,forEach) {

    /**
     * Encode object into a query string.
     */
    function encode(obj){
        var query = [],
            arrValues, reg;
        forOwn(obj, function (val, key) {
            if (isArray(val)) {
                arrValues = key + '=';
                reg = new RegExp('&'+key+'+=$');
                forEach(val, function (aValue) {
                    arrValues += encodeURIComponent(aValue) + '&' + key + '=';
                });
                query.push(arrValues.replace(reg, ''));
            } else {
               query.push(key + '=' + encodeURIComponent(val));
            }
        });
        return (query.length) ? '?' + query.join('&') : '';
    }

    return encode;
});

/*!
 * jQuery JavaScript Library v1.10.2
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2013 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2013-07-03T13:48Z
 */
(function( window, undefined ) {

// Can't do this because several apps including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
// Support: Firefox 18+
//
var
	// The deferred used on DOM ready
	readyList,

	// A central reference to the root jQuery(document)
	rootjQuery,

	// Support: IE<10
	// For `typeof xmlNode.method` instead of `xmlNode.method !== undefined`
	core_strundefined = typeof undefined,

	// Use the correct document accordingly with window argument (sandbox)
	location = window.location,
	document = window.document,
	docElem = document.documentElement,

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$,

	// [[Class]] -> type pairs
	class2type = {},

	// List of deleted data cache ids, so we can reuse them
	core_deletedIds = [],

	core_version = "1.10.2",

	// Save a reference to some core methods
	core_concat = core_deletedIds.concat,
	core_push = core_deletedIds.push,
	core_slice = core_deletedIds.slice,
	core_indexOf = core_deletedIds.indexOf,
	core_toString = class2type.toString,
	core_hasOwn = class2type.hasOwnProperty,
	core_trim = core_version.trim,

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		return new jQuery.fn.init( selector, context, rootjQuery );
	},

	// Used for matching numbers
	core_pnum = /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,

	// Used for splitting on whitespace
	core_rnotwhite = /\S+/g,

	// Make sure we trim BOM and NBSP (here's looking at you, Safari 5.0 and IE)
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	// Match a standalone tag
	rsingleTag = /^<(\w+)\s*\/?>(?:<\/\1>|)$/,

	// JSON RegExp
	rvalidchars = /^[\],:{}\s]*$/,
	rvalidbraces = /(?:^|:|,)(?:\s*\[)+/g,
	rvalidescape = /\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,
	rvalidtokens = /"[^"\\\r\n]*"|true|false|null|-?(?:\d+\.|)\d+(?:[eE][+-]?\d+|)/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	},

	// The ready event handler
	completed = function( event ) {

		// readyState === "complete" is good enough for us to call the dom ready in oldIE
		if ( document.addEventListener || event.type === "load" || document.readyState === "complete" ) {
			detach();
			jQuery.ready();
		}
	},
	// Clean-up method for dom ready events
	detach = function() {
		if ( document.addEventListener ) {
			document.removeEventListener( "DOMContentLoaded", completed, false );
			window.removeEventListener( "load", completed, false );

		} else {
			document.detachEvent( "onreadystatechange", completed );
			window.detachEvent( "onload", completed );
		}
	};

jQuery.fn = jQuery.prototype = {
	// The current version of jQuery being used
	jquery: core_version,

	constructor: jQuery,
	init: function( selector, context, rootjQuery ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector.charAt(0) === "<" && selector.charAt( selector.length - 1 ) === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;

					// scripts is true for back-compat
					jQuery.merge( this, jQuery.parseHTML(
						match[1],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {
							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE and Opera return items
						// by name instead of ID
						if ( elem.id !== match[2] ) {
							return rootjQuery.find( selector );
						}

						// Otherwise, we inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return rootjQuery.ready( selector );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	},

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return core_slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num == null ?

			// Return a 'clean' array
			this.toArray() :

			// Return just the object
			( num < 0 ? this[ this.length + num ] : this[ num ] );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	ready: function( fn ) {
		// Add the callback
		jQuery.ready.promise().done( fn );

		return this;
	},

	slice: function() {
		return this.pushStack( core_slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: core_push,
	sort: [].sort,
	splice: [].splice
};

// Give the init function the jQuery prototype for later instantiation
jQuery.fn.init.prototype = jQuery.fn;

jQuery.extend = jQuery.fn.extend = function() {
	var src, copyIsArray, copy, name, options, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( length === i ) {
		target = this;
		--i;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	// Unique for each copy of jQuery on the page
	// Non-digits removed to match rinlinejQuery
	expando: "jQuery" + ( core_version + Math.random() ).replace( /\D/g, "" ),

	noConflict: function( deep ) {
		if ( window.$ === jQuery ) {
			window.$ = _$;
		}

		if ( deep && window.jQuery === jQuery ) {
			window.jQuery = _jQuery;
		}

		return jQuery;
	},

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Make sure body exists, at least, in case IE gets a little overzealous (ticket #5443).
		if ( !document.body ) {
			return setTimeout( jQuery.ready );
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.trigger ) {
			jQuery( document ).trigger("ready").off("ready");
		}
	},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray || function( obj ) {
		return jQuery.type(obj) === "array";
	},

	isWindow: function( obj ) {
		/* jshint eqeqeq: false */
		return obj != null && obj == obj.window;
	},

	isNumeric: function( obj ) {
		return !isNaN( parseFloat(obj) ) && isFinite( obj );
	},

	type: function( obj ) {
		if ( obj == null ) {
			return String( obj );
		}
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ core_toString.call(obj) ] || "object" :
			typeof obj;
	},

	isPlainObject: function( obj ) {
		var key;

		// Must be an Object.
		// Because of IE, we also have to check the presence of the constructor property.
		// Make sure that DOM nodes and window objects don't pass through, as well
		if ( !obj || jQuery.type(obj) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		try {
			// Not own constructor property must be Object
			if ( obj.constructor &&
				!core_hasOwn.call(obj, "constructor") &&
				!core_hasOwn.call(obj.constructor.prototype, "isPrototypeOf") ) {
				return false;
			}
		} catch ( e ) {
			// IE8,9 Will throw exceptions on certain host objects #9897
			return false;
		}

		// Support: IE<9
		// Handle iteration over inherited properties before own properties.
		if ( jQuery.support.ownLast ) {
			for ( key in obj ) {
				return core_hasOwn.call( obj, key );
			}
		}

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own.
		for ( key in obj ) {}

		return key === undefined || core_hasOwn.call( obj, key );
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	error: function( msg ) {
		throw new Error( msg );
	},

	// data: string of html
	// context (optional): If specified, the fragment will be created in this context, defaults to document
	// keepScripts (optional): If true, will include scripts passed in the html string
	parseHTML: function( data, context, keepScripts ) {
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		if ( typeof context === "boolean" ) {
			keepScripts = context;
			context = false;
		}
		context = context || document;

		var parsed = rsingleTag.exec( data ),
			scripts = !keepScripts && [];

		// Single tag
		if ( parsed ) {
			return [ context.createElement( parsed[1] ) ];
		}

		parsed = jQuery.buildFragment( [ data ], context, scripts );
		if ( scripts ) {
			jQuery( scripts ).remove();
		}
		return jQuery.merge( [], parsed.childNodes );
	},

	parseJSON: function( data ) {
		// Attempt to parse using the native JSON parser first
		if ( window.JSON && window.JSON.parse ) {
			return window.JSON.parse( data );
		}

		if ( data === null ) {
			return data;
		}

		if ( typeof data === "string" ) {

			// Make sure leading/trailing whitespace is removed (IE can't handle it)
			data = jQuery.trim( data );

			if ( data ) {
				// Make sure the incoming data is actual JSON
				// Logic borrowed from http://json.org/json2.js
				if ( rvalidchars.test( data.replace( rvalidescape, "@" )
					.replace( rvalidtokens, "]" )
					.replace( rvalidbraces, "")) ) {

					return ( new Function( "return " + data ) )();
				}
			}
		}

		jQuery.error( "Invalid JSON: " + data );
	},

	// Cross-browser xml parsing
	parseXML: function( data ) {
		var xml, tmp;
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		try {
			if ( window.DOMParser ) { // Standard
				tmp = new DOMParser();
				xml = tmp.parseFromString( data , "text/xml" );
			} else { // IE
				xml = new ActiveXObject( "Microsoft.XMLDOM" );
				xml.async = "false";
				xml.loadXML( data );
			}
		} catch( e ) {
			xml = undefined;
		}
		if ( !xml || !xml.documentElement || xml.getElementsByTagName( "parsererror" ).length ) {
			jQuery.error( "Invalid XML: " + data );
		}
		return xml;
	},

	noop: function() {},

	// Evaluates a script in a global context
	// Workarounds based on findings by Jim Driscoll
	// http://weblogs.java.net/blog/driscoll/archive/2009/09/08/eval-javascript-global-context
	globalEval: function( data ) {
		if ( data && jQuery.trim( data ) ) {
			// We use execScript on Internet Explorer
			// We use an anonymous function so that context is window
			// rather than jQuery in Firefox
			( window.execScript || function( data ) {
				window[ "eval" ].call( window, data );
			} )( data );
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var value,
			i = 0,
			length = obj.length,
			isArray = isArraylike( obj );

		if ( args ) {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	// Use native String.trim function wherever possible
	trim: core_trim && !core_trim.call("\uFEFF\xA0") ?
		function( text ) {
			return text == null ?
				"" :
				core_trim.call( text );
		} :

		// Otherwise use our own trimming functionality
		function( text ) {
			return text == null ?
				"" :
				( text + "" ).replace( rtrim, "" );
		},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArraylike( Object(arr) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				core_push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		var len;

		if ( arr ) {
			if ( core_indexOf ) {
				return core_indexOf.call( arr, elem, i );
			}

			len = arr.length;
			i = i ? i < 0 ? Math.max( 0, len + i ) : i : 0;

			for ( ; i < len; i++ ) {
				// Skip accessing in sparse arrays
				if ( i in arr && arr[ i ] === elem ) {
					return i;
				}
			}
		}

		return -1;
	},

	merge: function( first, second ) {
		var l = second.length,
			i = first.length,
			j = 0;

		if ( typeof l === "number" ) {
			for ( ; j < l; j++ ) {
				first[ i++ ] = second[ j ];
			}
		} else {
			while ( second[j] !== undefined ) {
				first[ i++ ] = second[ j++ ];
			}
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, inv ) {
		var retVal,
			ret = [],
			i = 0,
			length = elems.length;
		inv = !!inv;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			retVal = !!callback( elems[ i ], i );
			if ( inv !== retVal ) {
				ret.push( elems[ i ] );
			}
		}

		return ret;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value,
			i = 0,
			length = elems.length,
			isArray = isArraylike( elems ),
			ret = [];

		// Go through the array, translating each of the items to their
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}
		}

		// Flatten any nested arrays
		return core_concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var args, proxy, tmp;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = core_slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( core_slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	// Multifunctional method to get and set values of a collection
	// The value/s can optionally be executed if it's a function
	access: function( elems, fn, key, value, chainable, emptyGet, raw ) {
		var i = 0,
			length = elems.length,
			bulk = key == null;

		// Sets many values
		if ( jQuery.type( key ) === "object" ) {
			chainable = true;
			for ( i in key ) {
				jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
			}

		// Sets one value
		} else if ( value !== undefined ) {
			chainable = true;

			if ( !jQuery.isFunction( value ) ) {
				raw = true;
			}

			if ( bulk ) {
				// Bulk operations run against the entire set
				if ( raw ) {
					fn.call( elems, value );
					fn = null;

				// ...except when executing function values
				} else {
					bulk = fn;
					fn = function( elem, key, value ) {
						return bulk.call( jQuery( elem ), value );
					};
				}
			}

			if ( fn ) {
				for ( ; i < length; i++ ) {
					fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
				}
			}
		}

		return chainable ?
			elems :

			// Gets
			bulk ?
				fn.call( elems ) :
				length ? fn( elems[0], key ) : emptyGet;
	},

	now: function() {
		return ( new Date() ).getTime();
	},

	// A method for quickly swapping in/out CSS properties to get correct calculations.
	// Note: this method belongs to the css module but it's needed here for the support module.
	// If support gets modularized, this method should be moved back to the css module.
	swap: function( elem, options, callback, args ) {
		var ret, name,
			old = {};

		// Remember the old values, and insert the new ones
		for ( name in options ) {
			old[ name ] = elem.style[ name ];
			elem.style[ name ] = options[ name ];
		}

		ret = callback.apply( elem, args || [] );

		// Revert the old values
		for ( name in options ) {
			elem.style[ name ] = old[ name ];
		}

		return ret;
	}
});

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready );

		// Standards-based browsers support DOMContentLoaded
		} else if ( document.addEventListener ) {
			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", completed, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", completed, false );

		// If IE event model is used
		} else {
			// Ensure firing before onload, maybe late but safe also for iframes
			document.attachEvent( "onreadystatechange", completed );

			// A fallback to window.onload, that will always work
			window.attachEvent( "onload", completed );

			// If IE and not a frame
			// continually check to see if the document is ready
			var top = false;

			try {
				top = window.frameElement == null && document.documentElement;
			} catch(e) {}

			if ( top && top.doScroll ) {
				(function doScrollCheck() {
					if ( !jQuery.isReady ) {

						try {
							// Use the trick by Diego Perini
							// http://javascript.nwbox.com/IEContentLoaded/
							top.doScroll("left");
						} catch(e) {
							return setTimeout( doScrollCheck, 50 );
						}

						// detach all dom ready events
						detach();

						// and execute any waiting functions
						jQuery.ready();
					}
				})();
			}
		}
	}
	return readyList.promise( obj );
};

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

function isArraylike( obj ) {
	var length = obj.length,
		type = jQuery.type( obj );

	if ( jQuery.isWindow( obj ) ) {
		return false;
	}

	if ( obj.nodeType === 1 && length ) {
		return true;
	}

	return type === "array" || type !== "function" &&
		( length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj );
}

// All jQuery objects should point back to these
rootjQuery = jQuery(document);
/*!
 * Sizzle CSS Selector Engine v1.10.2
 * http://sizzlejs.com/
 *
 * Copyright 2013 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2013-07-03
 */
(function( window, undefined ) {

var i,
	support,
	cachedruns,
	Expr,
	getText,
	isXML,
	compile,
	outermostContext,
	sortInput,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + -(new Date()),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	hasDuplicate = false,
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}
		return 0;
	},

	// General-purpose constants
	strundefined = typeof undefined,
	MAX_NEGATIVE = 1 << 31,

	// Instance methods
	hasOwn = ({}).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	push_native = arr.push,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf if we can't use a native one
	indexOf = arr.indexOf || function( elem ) {
		var i = 0,
			len = this.length;
		for ( ; i < len; i++ ) {
			if ( this[i] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Acceptable operators http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")" + whitespace +
		"*(?:([*^$|!~]?=)" + whitespace + "*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|(" + identifier + ")|)|)" + whitespace + "*\\]",

	// Prefer arguments quoted,
	//   then not containing pseudos/brackets,
	//   then attribute selectors/non-parenthetical expressions,
	//   then anything else
	// These preferences are here to reduce the number of selectors
	//   needing tokenize in the PSEUDO preFilter
	pseudos = ":(" + characterEncoding + ")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|" + attributes.replace( 3, 8 ) + ")*)|.*)\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*" ),

	rsibling = new RegExp( whitespace + "*[+~]" ),
	rattributeQuotes = new RegExp( "=" + whitespace + "*([^\\]'\"]*)" + whitespace + "*\\]", "g" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rescape = /'|\\/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig" ),
	funescape = function( _, escaped, escapedWhitespace ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		// Support: Firefox
		// Workaround erroneous numeric interpretation of +"0x"
		return high !== high || escapedWhitespace ?
			escaped :
			// BMP codepoint
			high < 0 ?
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	};

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		(arr = slice.call( preferredDoc.childNodes )),
		preferredDoc.childNodes
	);
	// Support: Android<4.0
	// Detect silently failing push.apply
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			push_native.apply( target, slice.call(els) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;
			// Can't trust NodeList.length
			while ( (target[j++] = els[i++]) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var match, elem, m, nodeType,
		// QSA vars
		i, groups, old, nid, newContext, newSelector;

	if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
		setDocument( context );
	}

	context = context || document;
	results = results || [];

	if ( !selector || typeof selector !== "string" ) {
		return results;
	}

	if ( (nodeType = context.nodeType) !== 1 && nodeType !== 9 ) {
		return [];
	}

	if ( documentIsHTML && !seed ) {

		// Shortcuts
		if ( (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, context.getElementsByTagName( selector ) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && support.getElementsByClassName && context.getElementsByClassName ) {
				push.apply( results, context.getElementsByClassName( m ) );
				return results;
			}
		}

		// QSA path
		if ( support.qsa && (!rbuggyQSA || !rbuggyQSA.test( selector )) ) {
			nid = old = expando;
			newContext = context;
			newSelector = nodeType === 9 && selector;

			// qSA works strangely on Element-rooted queries
			// We can work around this by specifying an extra ID on the root
			// and working up from there (Thanks to Andrew Dupont for the technique)
			// IE 8 doesn't work on object elements
			if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
				groups = tokenize( selector );

				if ( (old = context.getAttribute("id")) ) {
					nid = old.replace( rescape, "\\$&" );
				} else {
					context.setAttribute( "id", nid );
				}
				nid = "[id='" + nid + "'] ";

				i = groups.length;
				while ( i-- ) {
					groups[i] = nid + toSelector( groups[i] );
				}
				newContext = rsibling.test( selector ) && context.parentNode || context;
				newSelector = groups.join(",");
			}

			if ( newSelector ) {
				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch(qsaError) {
				} finally {
					if ( !old ) {
						context.removeAttribute("id");
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key += " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key ] = value);
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return !!fn( div );
	} catch (e) {
		return false;
	} finally {
		// Remove from its parent by default
		if ( div.parentNode ) {
			div.parentNode.removeChild( div );
		}
		// release memory in IE
		div = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split("|"),
		i = attrs.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[i] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			( ~b.sourceIndex || MAX_NEGATIVE ) -
			( ~a.sourceIndex || MAX_NEGATIVE );

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( (cur = cur.nextSibling) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Detect xml
 * @param {Element|Object} elem An element or a document
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var doc = node ? node.ownerDocument || node : preferredDoc,
		parent = doc.defaultView;

	// If no document and documentElement is available, return
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Set our document
	document = doc;
	docElem = doc.documentElement;

	// Support tests
	documentIsHTML = !isXML( doc );

	// Support: IE>8
	// If iframe document is assigned to "document" variable and if iframe has been reloaded,
	// IE will throw "permission denied" error when accessing "document" variable, see jQuery #13936
	// IE6-8 do not support the defaultView property so parent will be undefined
	if ( parent && parent.attachEvent && parent !== parent.top ) {
		parent.attachEvent( "onbeforeunload", function() {
			setDocument();
		});
	}

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties (excepting IE8 booleans)
	support.attributes = assert(function( div ) {
		div.className = "i";
		return !div.getAttribute("className");
	});

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert(function( div ) {
		div.appendChild( doc.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Check if getElementsByClassName can be trusted
	support.getElementsByClassName = assert(function( div ) {
		div.innerHTML = "<div class='a'></div><div class='a i'></div>";

		// Support: Safari<4
		// Catch class over-caching
		div.firstChild.className = "i";
		// Support: Opera<10
		// Catch gEBCN failure to find non-leading classes
		return div.getElementsByClassName("i").length === 2;
	});

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert(function( div ) {
		docElem.appendChild( div ).id = expando;
		return !doc.getElementsByName || !doc.getElementsByName( expando ).length;
	});

	// ID find and filter
	if ( support.getById ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && documentIsHTML ) {
				var m = context.getElementById( id );
				// Check parentNode to catch when Blackberry 4.6 returns
				// nodes that are no longer in the document #6963
				return m && m.parentNode ? [m] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		// Support: IE6/7
		// getElementById is not reliable as a find shortcut
		delete Expr.find["ID"];

		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== strundefined ) {
				return context.getElementsByTagName( tag );
			}
		} :
		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( (elem = results[i++]) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find["CLASS"] = support.getElementsByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== strundefined && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See http://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( (support.qsa = rnative.test( doc.querySelectorAll )) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			div.innerHTML = "<select><option selected=''></option></select>";

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}
		});

		assert(function( div ) {

			// Support: Opera 10-12/IE8
			// ^= $= *= and empty values
			// Should not select anything
			// Support: Windows 8 Native Apps
			// The type attribute is restricted during .innerHTML assignment
			var input = doc.createElement("input");
			input.setAttribute( "type", "hidden" );
			div.appendChild( input ).setAttribute( "t", "" );

			if ( div.querySelectorAll("[t^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = rnative.test( (matches = docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join("|") );

	/* Contains
	---------------------------------------------------------------------- */

	// Element contains another
	// Purposefully does not implement inclusive descendent
	// As in, an element does not contain itself
	contains = rnative.test( docElem.contains ) || docElem.compareDocumentPosition ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = docElem.compareDocumentPosition ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var compare = b.compareDocumentPosition && a.compareDocumentPosition && a.compareDocumentPosition( b );

		if ( compare ) {
			// Disconnected nodes
			if ( compare & 1 ||
				(!support.sortDetached && b.compareDocumentPosition( a ) === compare) ) {

				// Choose the first element that is related to our preferred document
				if ( a === doc || contains(preferredDoc, a) ) {
					return -1;
				}
				if ( b === doc || contains(preferredDoc, b) ) {
					return 1;
				}

				// Maintain original order
				return sortInput ?
					( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
					0;
			}

			return compare & 4 ? -1 : 1;
		}

		// Not directly comparable, sort on existence of method
		return a.compareDocumentPosition ? -1 : 1;
	} :
	function( a, b ) {
		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;

		// Parentless nodes are either documents or disconnected
		} else if ( !aup || !bup ) {
			return a === doc ? -1 :
				b === doc ? 1 :
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	return doc;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	if ( support.matchesSelector && documentIsHTML &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch(e) {}
	}

	return Sizzle( expr, document, null, [elem] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],
		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val === undefined ?
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			(val = elem.getAttributeNode(name)) && val.specified ?
				val.value :
				null :
		val;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( (elem = results[i++]) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		for ( ; (node = elem[i]); i++ ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (see #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[5] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[3] && match[4] !== undefined ) {
				match[2] = match[4];

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() { return true; } :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== strundefined && elem.getAttribute("class") || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, outerCache, node, diff, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {
							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || (parent[ expando ] = {});
							cache = outerCache[ type ] || [];
							nodeIndex = cache[0] === dirruns && cache[1];
							diff = cache[0] === dirruns && cache[2];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						// Use previously-cached element index if available
						} else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
							diff = cache[1];

						// xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
						} else {
							// Use the same loop as above to seek `elem` from the start
							while ( (node = ++nodeIndex && node && node[ dir ] ||
								(diff = nodeIndex = 0) || start.pop()) ) {

								if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
									// Cache the index of each encountered element
									if ( useCache ) {
										(node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
									}

									if ( node === elem ) {
										break;
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifier
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute("xml:lang") || elem.getAttribute("lang")) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is only affected by element nodes and content nodes(including text(3), cdata(4)),
			//   not comment, processing instructions, or others
			// Thanks to Diego Perini for the nodeName shortcut
			//   Greater than "@" means alpha characters (specifically not starting with "#" or "?")
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeName > "@" || elem.nodeType === 3 || elem.nodeType === 4 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			// IE6 and 7 will map elem.type to 'text' for new HTML5 types (search, etc)
			// use getAttribute instead to test this case
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === elem.type );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

function tokenize( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( tokens = [] );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push({
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			});
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push({
					value: matched,
					type: type,
					matches: match
				});
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
}

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var data, cache, outerCache,
				dirkey = dirruns + " " + doneName;

			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});
						if ( (cache = outerCache[ dir ]) && cache[0] === dirkey ) {
							if ( (data = cache[1]) === true || data === cachedruns ) {
								return data === true;
							}
						} else {
							cache = outerCache[ dir ] = [ dirkey ];
							cache[1] = matcher( elem, context, xml ) || cachedruns;
							if ( cache[1] === true ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(
						// If the preceding token was a descendant combinator, insert an implicit any-element `*`
						tokens.slice( 0, i - 1 ).concat({ value: tokens[ i - 2 ].type === " " ? "*" : "" })
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	// A counter to specify which element is currently being matched
	var matcherCachedRuns = 0,
		bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, expandContext ) {
			var elem, j, matcher,
				setMatched = [],
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				outermost = expandContext != null,
				contextBackup = outermostContext,
				// We must always have either seed elements or context
				elems = seed || byElement && Expr.find["TAG"]( "*", expandContext && context.parentNode || context ),
				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1);

			if ( outermost ) {
				outermostContext = context !== document && context;
				cachedruns = matcherCachedRuns;
			}

			// Add elements passing elementMatchers directly to results
			// Keep `i` a string if there are no elements so `matchedCount` will be "00" below
			for ( ; (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;
					while ( (matcher = elementMatchers[j++]) ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
						cachedruns = ++matcherCachedRuns;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( (matcher = setMatchers[j++]) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, group /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !group ) {
			group = tokenize( selector );
		}
		i = group.length;
		while ( i-- ) {
			cached = matcherFromTokens( group[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );
	}
	return cached;
};

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function select( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		match = tokenize( selector );

	if ( !seed ) {
		// Try to minimize operations if there is only one group
		if ( match.length === 1 ) {

			// Take a shortcut and set the context if the root selector is an ID
			tokens = match[0] = match[0].slice( 0 );
			if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
					support.getById && context.nodeType === 9 && documentIsHTML &&
					Expr.relative[ tokens[1].type ] ) {

				context = ( Expr.find["ID"]( token.matches[0].replace(runescape, funescape), context ) || [] )[0];
				if ( !context ) {
					return results;
				}
				selector = selector.slice( tokens.shift().value.length );
			}

			// Fetch a seed set for right-to-left matching
			i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
			while ( i-- ) {
				token = tokens[i];

				// Abort if we hit a combinator
				if ( Expr.relative[ (type = token.type) ] ) {
					break;
				}
				if ( (find = Expr.find[ type ]) ) {
					// Search, expanding context for leading sibling combinators
					if ( (seed = find(
						token.matches[0].replace( runescape, funescape ),
						rsibling.test( tokens[0].type ) && context.parentNode || context
					)) ) {

						// If seed is empty or no tokens remain, we can return early
						tokens.splice( i, 1 );
						selector = seed.length && toSelector( tokens );
						if ( !selector ) {
							push.apply( results, seed );
							return results;
						}

						break;
					}
				}
			}
		}
	}

	// Compile and execute a filtering function
	// Provide `match` to avoid retokenization if we modified the selector above
	compile( selector, match )(
		seed,
		context,
		!documentIsHTML,
		results,
		rsibling.test( selector )
	);
	return results;
}

// One-time assignments

// Sort stability
support.sortStable = expando.split("").sort( sortOrder ).join("") === expando;

// Support: Chrome<14
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert(function( div1 ) {
	// Should return 1, but returns 4 (following)
	return div1.compareDocumentPosition( document.createElement("div") ) & 1;
});

// Support: IE<8
// Prevent attribute/property "interpolation"
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert(function( div ) {
	div.innerHTML = "<a href='#'></a>";
	return div.firstChild.getAttribute("href") === "#" ;
}) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	});
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert(function( div ) {
	div.innerHTML = "<input/>";
	div.firstChild.setAttribute( "value", "" );
	return div.firstChild.getAttribute( "value" ) === "";
}) ) {
	addHandle( "value", function( elem, name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	});
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert(function( div ) {
	return div.getAttribute("disabled") == null;
}) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return (val = elem.getAttributeNode( name )) && val.specified ?
				val.value :
				elem[ name ] === true ? name.toLowerCase() : null;
		}
	});
}

jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;


})( window );
// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.match( core_rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,
		// Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ? jQuery.inArray( fn, list ) > -1 : !!( list && list.length );
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				firingLength = 0;
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( list && ( !fired || stack ) ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};
jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var action = tuple[ 0 ],
								fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ](function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.done( newDefer.resolve )
										.fail( newDefer.reject )
										.progress( newDefer.notify );
								} else {
									newDefer[ action + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
								}
							});
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[0] ] = function() {
				deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = core_slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? core_slice.call( arguments ) : value;
					if( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});
jQuery.support = (function( support ) {

	var all, a, input, select, fragment, opt, eventName, isSupported, i,
		div = document.createElement("div");

	// Setup
	div.setAttribute( "className", "t" );
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";

	// Finish early in limited (non-browser) environments
	all = div.getElementsByTagName("*") || [];
	a = div.getElementsByTagName("a")[ 0 ];
	if ( !a || !a.style || !all.length ) {
		return support;
	}

	// First batch of tests
	select = document.createElement("select");
	opt = select.appendChild( document.createElement("option") );
	input = div.getElementsByTagName("input")[ 0 ];

	a.style.cssText = "top:1px;float:left;opacity:.5";

	// Test setAttribute on camelCase class. If it works, we need attrFixes when doing get/setAttribute (ie6/7)
	support.getSetAttribute = div.className !== "t";

	// IE strips leading whitespace when .innerHTML is used
	support.leadingWhitespace = div.firstChild.nodeType === 3;

	// Make sure that tbody elements aren't automatically inserted
	// IE will insert them into empty tables
	support.tbody = !div.getElementsByTagName("tbody").length;

	// Make sure that link elements get serialized correctly by innerHTML
	// This requires a wrapper element in IE
	support.htmlSerialize = !!div.getElementsByTagName("link").length;

	// Get the style information from getAttribute
	// (IE uses .cssText instead)
	support.style = /top/.test( a.getAttribute("style") );

	// Make sure that URLs aren't manipulated
	// (IE normalizes it by default)
	support.hrefNormalized = a.getAttribute("href") === "/a";

	// Make sure that element opacity exists
	// (IE uses filter instead)
	// Use a regex to work around a WebKit issue. See #5145
	support.opacity = /^0.5/.test( a.style.opacity );

	// Verify style float existence
	// (IE uses styleFloat instead of cssFloat)
	support.cssFloat = !!a.style.cssFloat;

	// Check the default checkbox/radio value ("" on WebKit; "on" elsewhere)
	support.checkOn = !!input.value;

	// Make sure that a selected-by-default option has a working selected property.
	// (WebKit defaults to false instead of true, IE too, if it's in an optgroup)
	support.optSelected = opt.selected;

	// Tests for enctype support on a form (#6743)
	support.enctype = !!document.createElement("form").enctype;

	// Makes sure cloning an html5 element does not cause problems
	// Where outerHTML is undefined, this still works
	support.html5Clone = document.createElement("nav").cloneNode( true ).outerHTML !== "<:nav></:nav>";

	// Will be defined later
	support.inlineBlockNeedsLayout = false;
	support.shrinkWrapBlocks = false;
	support.pixelPosition = false;
	support.deleteExpando = true;
	support.noCloneEvent = true;
	support.reliableMarginRight = true;
	support.boxSizingReliable = true;

	// Make sure checked status is properly cloned
	input.checked = true;
	support.noCloneChecked = input.cloneNode( true ).checked;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Support: IE<9
	try {
		delete div.test;
	} catch( e ) {
		support.deleteExpando = false;
	}

	// Check if we can trust getAttribute("value")
	input = document.createElement("input");
	input.setAttribute( "value", "" );
	support.input = input.getAttribute( "value" ) === "";

	// Check if an input maintains its value after becoming a radio
	input.value = "t";
	input.setAttribute( "type", "radio" );
	support.radioValue = input.value === "t";

	// #11217 - WebKit loses check when the name is after the checked attribute
	input.setAttribute( "checked", "t" );
	input.setAttribute( "name", "t" );

	fragment = document.createDocumentFragment();
	fragment.appendChild( input );

	// Check if a disconnected checkbox will retain its checked
	// value of true after appended to the DOM (IE6/7)
	support.appendChecked = input.checked;

	// WebKit doesn't clone checked state correctly in fragments
	support.checkClone = fragment.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE<9
	// Opera does not clone events (and typeof div.attachEvent === undefined).
	// IE9-10 clones events bound via attachEvent, but they don't trigger with .click()
	if ( div.attachEvent ) {
		div.attachEvent( "onclick", function() {
			support.noCloneEvent = false;
		});

		div.cloneNode( true ).click();
	}

	// Support: IE<9 (lack submit/change bubble), Firefox 17+ (lack focusin event)
	// Beware of CSP restrictions (https://developer.mozilla.org/en/Security/CSP)
	for ( i in { submit: true, change: true, focusin: true }) {
		div.setAttribute( eventName = "on" + i, "t" );

		support[ i + "Bubbles" ] = eventName in window || div.attributes[ eventName ].expando === false;
	}

	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	// Support: IE<9
	// Iteration over object's inherited properties before its own.
	for ( i in jQuery( support ) ) {
		break;
	}
	support.ownLast = i !== "0";

	// Run tests that need a body at doc ready
	jQuery(function() {
		var container, marginDiv, tds,
			divReset = "padding:0;margin:0;border:0;display:block;box-sizing:content-box;-moz-box-sizing:content-box;-webkit-box-sizing:content-box;",
			body = document.getElementsByTagName("body")[0];

		if ( !body ) {
			// Return for frameset docs that don't have a body
			return;
		}

		container = document.createElement("div");
		container.style.cssText = "border:0;width:0;height:0;position:absolute;top:0;left:-9999px;margin-top:1px";

		body.appendChild( container ).appendChild( div );

		// Support: IE8
		// Check if table cells still have offsetWidth/Height when they are set
		// to display:none and there are still other visible table cells in a
		// table row; if so, offsetWidth/Height are not reliable for use when
		// determining if an element has been hidden directly using
		// display:none (it is still safe to use offsets if a parent element is
		// hidden; don safety goggles and see bug #4512 for more information).
		div.innerHTML = "<table><tr><td></td><td>t</td></tr></table>";
		tds = div.getElementsByTagName("td");
		tds[ 0 ].style.cssText = "padding:0;margin:0;border:0;display:none";
		isSupported = ( tds[ 0 ].offsetHeight === 0 );

		tds[ 0 ].style.display = "";
		tds[ 1 ].style.display = "none";

		// Support: IE8
		// Check if empty table cells still have offsetWidth/Height
		support.reliableHiddenOffsets = isSupported && ( tds[ 0 ].offsetHeight === 0 );

		// Check box-sizing and margin behavior.
		div.innerHTML = "";
		div.style.cssText = "box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;";

		// Workaround failing boxSizing test due to offsetWidth returning wrong value
		// with some non-1 values of body zoom, ticket #13543
		jQuery.swap( body, body.style.zoom != null ? { zoom: 1 } : {}, function() {
			support.boxSizing = div.offsetWidth === 4;
		});

		// Use window.getComputedStyle because jsdom on node.js will break without it.
		if ( window.getComputedStyle ) {
			support.pixelPosition = ( window.getComputedStyle( div, null ) || {} ).top !== "1%";
			support.boxSizingReliable = ( window.getComputedStyle( div, null ) || { width: "4px" } ).width === "4px";

			// Check if div with explicit width and no margin-right incorrectly
			// gets computed margin-right based on width of container. (#3333)
			// Fails in WebKit before Feb 2011 nightlies
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			marginDiv = div.appendChild( document.createElement("div") );
			marginDiv.style.cssText = div.style.cssText = divReset;
			marginDiv.style.marginRight = marginDiv.style.width = "0";
			div.style.width = "1px";

			support.reliableMarginRight =
				!parseFloat( ( window.getComputedStyle( marginDiv, null ) || {} ).marginRight );
		}

		if ( typeof div.style.zoom !== core_strundefined ) {
			// Support: IE<8
			// Check if natively block-level elements act like inline-block
			// elements when setting their display to 'inline' and giving
			// them layout
			div.innerHTML = "";
			div.style.cssText = divReset + "width:1px;padding:1px;display:inline;zoom:1";
			support.inlineBlockNeedsLayout = ( div.offsetWidth === 3 );

			// Support: IE6
			// Check if elements with layout shrink-wrap their children
			div.style.display = "block";
			div.innerHTML = "<div></div>";
			div.firstChild.style.width = "5px";
			support.shrinkWrapBlocks = ( div.offsetWidth !== 3 );

			if ( support.inlineBlockNeedsLayout ) {
				// Prevent IE 6 from affecting layout for positioned elements #11048
				// Prevent IE from shrinking the body in IE 7 mode #12869
				// Support: IE<8
				body.style.zoom = 1;
			}
		}

		body.removeChild( container );

		// Null elements to avoid leaks in IE
		container = div = tds = marginDiv = null;
	});

	// Null elements to avoid leaks in IE
	all = select = fragment = opt = a = input = null;

	return support;
})({});

var rbrace = /(?:\{[\s\S]*\}|\[[\s\S]*\])$/,
	rmultiDash = /([A-Z])/g;

function internalData( elem, name, data, pvt /* Internal Use Only */ ){
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var ret, thisCache,
		internalKey = jQuery.expando,

		// We have to handle DOM nodes and JS objects differently because IE6-7
		// can't GC object references properly across the DOM-JS boundary
		isNode = elem.nodeType,

		// Only DOM nodes need the global jQuery cache; JS object data is
		// attached directly to the object so GC can occur automatically
		cache = isNode ? jQuery.cache : elem,

		// Only defining an ID for JS objects if its cache already exists allows
		// the code to shortcut on the same path as a DOM node with no cache
		id = isNode ? elem[ internalKey ] : elem[ internalKey ] && internalKey;

	// Avoid doing any more work than we need to when trying to get data on an
	// object that has no data at all
	if ( (!id || !cache[id] || (!pvt && !cache[id].data)) && data === undefined && typeof name === "string" ) {
		return;
	}

	if ( !id ) {
		// Only DOM nodes need a new unique ID for each element since their data
		// ends up in the global cache
		if ( isNode ) {
			id = elem[ internalKey ] = core_deletedIds.pop() || jQuery.guid++;
		} else {
			id = internalKey;
		}
	}

	if ( !cache[ id ] ) {
		// Avoid exposing jQuery metadata on plain JS objects when the object
		// is serialized using JSON.stringify
		cache[ id ] = isNode ? {} : { toJSON: jQuery.noop };
	}

	// An object can be passed to jQuery.data instead of a key/value pair; this gets
	// shallow copied over onto the existing cache
	if ( typeof name === "object" || typeof name === "function" ) {
		if ( pvt ) {
			cache[ id ] = jQuery.extend( cache[ id ], name );
		} else {
			cache[ id ].data = jQuery.extend( cache[ id ].data, name );
		}
	}

	thisCache = cache[ id ];

	// jQuery data() is stored in a separate object inside the object's internal data
	// cache in order to avoid key collisions between internal data and user-defined
	// data.
	if ( !pvt ) {
		if ( !thisCache.data ) {
			thisCache.data = {};
		}

		thisCache = thisCache.data;
	}

	if ( data !== undefined ) {
		thisCache[ jQuery.camelCase( name ) ] = data;
	}

	// Check for both converted-to-camel and non-converted data property names
	// If a data property was specified
	if ( typeof name === "string" ) {

		// First Try to find as-is property data
		ret = thisCache[ name ];

		// Test for null|undefined property data
		if ( ret == null ) {

			// Try to find the camelCased property
			ret = thisCache[ jQuery.camelCase( name ) ];
		}
	} else {
		ret = thisCache;
	}

	return ret;
}

function internalRemoveData( elem, name, pvt ) {
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var thisCache, i,
		isNode = elem.nodeType,

		// See jQuery.data for more information
		cache = isNode ? jQuery.cache : elem,
		id = isNode ? elem[ jQuery.expando ] : jQuery.expando;

	// If there is already no cache entry for this object, there is no
	// purpose in continuing
	if ( !cache[ id ] ) {
		return;
	}

	if ( name ) {

		thisCache = pvt ? cache[ id ] : cache[ id ].data;

		if ( thisCache ) {

			// Support array or space separated string names for data keys
			if ( !jQuery.isArray( name ) ) {

				// try the string as a key before any manipulation
				if ( name in thisCache ) {
					name = [ name ];
				} else {

					// split the camel cased version by spaces unless a key with the spaces exists
					name = jQuery.camelCase( name );
					if ( name in thisCache ) {
						name = [ name ];
					} else {
						name = name.split(" ");
					}
				}
			} else {
				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = name.concat( jQuery.map( name, jQuery.camelCase ) );
			}

			i = name.length;
			while ( i-- ) {
				delete thisCache[ name[i] ];
			}

			// If there is no data left in the cache, we want to continue
			// and let the cache object itself get destroyed
			if ( pvt ? !isEmptyDataObject(thisCache) : !jQuery.isEmptyObject(thisCache) ) {
				return;
			}
		}
	}

	// See jQuery.data for more information
	if ( !pvt ) {
		delete cache[ id ].data;

		// Don't destroy the parent cache unless the internal data object
		// had been the only thing left in it
		if ( !isEmptyDataObject( cache[ id ] ) ) {
			return;
		}
	}

	// Destroy the cache
	if ( isNode ) {
		jQuery.cleanData( [ elem ], true );

	// Use delete when supported for expandos or `cache` is not a window per isWindow (#10080)
	/* jshint eqeqeq: false */
	} else if ( jQuery.support.deleteExpando || cache != cache.window ) {
		/* jshint eqeqeq: true */
		delete cache[ id ];

	// When all else fails, null
	} else {
		cache[ id ] = null;
	}
}

jQuery.extend({
	cache: {},

	// The following elements throw uncatchable exceptions if you
	// attempt to add expando properties to them.
	noData: {
		"applet": true,
		"embed": true,
		// Ban all objects except for Flash (which handle expandos)
		"object": "clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"
	},

	hasData: function( elem ) {
		elem = elem.nodeType ? jQuery.cache[ elem[jQuery.expando] ] : elem[ jQuery.expando ];
		return !!elem && !isEmptyDataObject( elem );
	},

	data: function( elem, name, data ) {
		return internalData( elem, name, data );
	},

	removeData: function( elem, name ) {
		return internalRemoveData( elem, name );
	},

	// For internal use only.
	_data: function( elem, name, data ) {
		return internalData( elem, name, data, true );
	},

	_removeData: function( elem, name ) {
		return internalRemoveData( elem, name, true );
	},

	// A method for determining if a DOM node can handle the data expando
	acceptData: function( elem ) {
		// Do not set data on non-element because it will not be cleared (#8335).
		if ( elem.nodeType && elem.nodeType !== 1 && elem.nodeType !== 9 ) {
			return false;
		}

		var noData = elem.nodeName && jQuery.noData[ elem.nodeName.toLowerCase() ];

		// nodes accept data unless otherwise specified; rejection can be conditional
		return !noData || noData !== true && elem.getAttribute("classid") === noData;
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var attrs, name,
			data = null,
			i = 0,
			elem = this[0];

		// Special expections of .data basically thwart jQuery.access,
		// so implement the relevant behavior ourselves

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = jQuery.data( elem );

				if ( elem.nodeType === 1 && !jQuery._data( elem, "parsedAttrs" ) ) {
					attrs = elem.attributes;
					for ( ; i < attrs.length; i++ ) {
						name = attrs[i].name;

						if ( name.indexOf("data-") === 0 ) {
							name = jQuery.camelCase( name.slice(5) );

							dataAttr( elem, name, data[ name ] );
						}
					}
					jQuery._data( elem, "parsedAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				jQuery.data( this, key );
			});
		}

		return arguments.length > 1 ?

			// Sets one value
			this.each(function() {
				jQuery.data( this, key, value );
			}) :

			// Gets one value
			// Try to fetch any internally stored data first
			elem ? dataAttr( elem, key, jQuery.data( elem, key ) ) : null;
	},

	removeData: function( key ) {
		return this.each(function() {
			jQuery.removeData( this, key );
		});
	}
});

function dataAttr( elem, key, data ) {
	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {

		var name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();

		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
					data === "false" ? false :
					data === "null" ? null :
					// Only convert to a number if it doesn't change the string
					+data + "" === data ? +data :
					rbrace.test( data ) ? jQuery.parseJSON( data ) :
						data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			jQuery.data( elem, key, data );

		} else {
			data = undefined;
		}
	}

	return data;
}

// checks a cache object for emptiness
function isEmptyDataObject( obj ) {
	var name;
	for ( name in obj ) {

		// if the public data object is empty, the private is still empty
		if ( name === "data" && jQuery.isEmptyObject( obj[name] ) ) {
			continue;
		}
		if ( name !== "toJSON" ) {
			return false;
		}
	}

	return true;
}
jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = jQuery._data( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray(data) ) {
					queue = jQuery._data( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return jQuery._data( elem, key ) || jQuery._data( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				jQuery._removeData( elem, type + "queue" );
				jQuery._removeData( elem, key );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	// Based off of the plugin by Clint Helfers, with permission.
	// http://blindsignals.com/index.php/2009/07/jquery-delay/
	delay: function( time, type ) {
		time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
		type = type || "fx";

		return this.queue( type, function( next, hooks ) {
			var timeout = setTimeout( next, time );
			hooks.stop = function() {
				clearTimeout( timeout );
			};
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while( i-- ) {
			tmp = jQuery._data( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var nodeHook, boolHook,
	rclass = /[\t\r\n\f]/g,
	rreturn = /\r/g,
	rfocusable = /^(?:input|select|textarea|button|object)$/i,
	rclickable = /^(?:a|area)$/i,
	ruseDefault = /^(?:checked|selected)$/i,
	getSetAttribute = jQuery.support.getSetAttribute,
	getSetInput = jQuery.support.input;

jQuery.fn.extend({
	attr: function( name, value ) {
		return jQuery.access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	},

	prop: function( name, value ) {
		return jQuery.access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		name = jQuery.propFix[ name ] || name;
		return this.each(function() {
			// try/catch handles cases where IE balks (such as removing a property on window)
			try {
				this[ name ] = undefined;
				delete this[ name ];
			} catch( e ) {}
		});
	},

	addClass: function( value ) {
		var classes, elem, cur, clazz, j,
			i = 0,
			len = this.length,
			proceed = typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call( this, j, this.className ) );
			});
		}

		if ( proceed ) {
			// The disjunction here is for better compressibility (see removeClass)
			classes = ( value || "" ).match( core_rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					" "
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}
					elem.className = jQuery.trim( cur );

				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, clazz, j,
			i = 0,
			len = this.length,
			proceed = arguments.length === 0 || typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call( this, j, this.className ) );
			});
		}
		if ( proceed ) {
			classes = ( value || "" ).match( core_rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					""
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}
					elem.className = value ? jQuery.trim( cur ) : "";
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value;

		if ( typeof stateVal === "boolean" && type === "string" ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					classNames = value.match( core_rnotwhite ) || [];

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( type === core_strundefined || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					jQuery._data( this, "__className__", this.className );
				}

				// If the element has a class name or if we're passed "false",
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				this.className = this.className || value === false ? "" : jQuery._data( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	},

	val: function( value ) {
		var ret, hooks, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";
			} else if ( typeof val === "number" ) {
				val += "";
			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map(val, function ( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		option: {
			get: function( elem ) {
				// Use proper attribute retrieval(#6932, #12072)
				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :
					elem.text;
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// oldIE doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( jQuery.support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];
					if ( (option.selected = jQuery.inArray( jQuery(option).val(), values ) >= 0) ) {
						optionSet = true;
					}
				}

				// force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	},

	attr: function( elem, name, value ) {
		var hooks, ret,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === core_strundefined ) {
			return jQuery.prop( elem, name, value );
		}

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );

			} else if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {
			ret = jQuery.find.attr( elem, name );

			// Non-existent attributes return null, we normalize to undefined
			return ret == null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( core_rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( (name = attrNames[i++]) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( jQuery.expr.match.bool.test( name ) ) {
					// Set corresponding property to false
					if ( getSetInput && getSetAttribute || !ruseDefault.test( name ) ) {
						elem[ propName ] = false;
					// Support: IE<9
					// Also clear defaultChecked/defaultSelected (if appropriate)
					} else {
						elem[ jQuery.camelCase( "default-" + name ) ] =
							elem[ propName ] = false;
					}

				// See #9699 for explanation of this approach (setting first, then removal)
				} else {
					jQuery.attr( elem, name, "" );
				}

				elem.removeAttribute( getSetAttribute ? name : propName );
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !jQuery.support.radioValue && value === "radio" && jQuery.nodeName(elem, "input") ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to default in case type is set after value during creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	propFix: {
		"for": "htmlFor",
		"class": "className"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			return hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ?
				ret :
				( elem[ name ] = value );

		} else {
			return hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ?
				ret :
				elem[ name ];
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				// elem.tabIndex doesn't always return the correct value when it hasn't been explicitly set
				// http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				// Use proper attribute retrieval(#12072)
				var tabindex = jQuery.find.attr( elem, "tabindex" );

				return tabindex ?
					parseInt( tabindex, 10 ) :
					rfocusable.test( elem.nodeName ) || rclickable.test( elem.nodeName ) && elem.href ?
						0 :
						-1;
			}
		}
	}
});

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else if ( getSetInput && getSetAttribute || !ruseDefault.test( name ) ) {
			// IE<8 needs the *property* name
			elem.setAttribute( !getSetAttribute && jQuery.propFix[ name ] || name, name );

		// Use defaultChecked and defaultSelected for oldIE
		} else {
			elem[ jQuery.camelCase( "default-" + name ) ] = elem[ name ] = true;
		}

		return name;
	}
};
jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( i, name ) {
	var getter = jQuery.expr.attrHandle[ name ] || jQuery.find.attr;

	jQuery.expr.attrHandle[ name ] = getSetInput && getSetAttribute || !ruseDefault.test( name ) ?
		function( elem, name, isXML ) {
			var fn = jQuery.expr.attrHandle[ name ],
				ret = isXML ?
					undefined :
					/* jshint eqeqeq: false */
					(jQuery.expr.attrHandle[ name ] = undefined) !=
						getter( elem, name, isXML ) ?

						name.toLowerCase() :
						null;
			jQuery.expr.attrHandle[ name ] = fn;
			return ret;
		} :
		function( elem, name, isXML ) {
			return isXML ?
				undefined :
				elem[ jQuery.camelCase( "default-" + name ) ] ?
					name.toLowerCase() :
					null;
		};
});

// fix oldIE attroperties
if ( !getSetInput || !getSetAttribute ) {
	jQuery.attrHooks.value = {
		set: function( elem, value, name ) {
			if ( jQuery.nodeName( elem, "input" ) ) {
				// Does not return so that setAttribute is also used
				elem.defaultValue = value;
			} else {
				// Use nodeHook if defined (#1954); otherwise setAttribute is fine
				return nodeHook && nodeHook.set( elem, value, name );
			}
		}
	};
}

// IE6/7 do not support getting/setting some attributes with get/setAttribute
if ( !getSetAttribute ) {

	// Use this for any attribute in IE6/7
	// This fixes almost every IE6/7 issue
	nodeHook = {
		set: function( elem, value, name ) {
			// Set the existing or create a new attribute node
			var ret = elem.getAttributeNode( name );
			if ( !ret ) {
				elem.setAttributeNode(
					(ret = elem.ownerDocument.createAttribute( name ))
				);
			}

			ret.value = value += "";

			// Break association with cloned elements by also using setAttribute (#9646)
			return name === "value" || value === elem.getAttribute( name ) ?
				value :
				undefined;
		}
	};
	jQuery.expr.attrHandle.id = jQuery.expr.attrHandle.name = jQuery.expr.attrHandle.coords =
		// Some attributes are constructed with empty-string values when not defined
		function( elem, name, isXML ) {
			var ret;
			return isXML ?
				undefined :
				(ret = elem.getAttributeNode( name )) && ret.value !== "" ?
					ret.value :
					null;
		};
	jQuery.valHooks.button = {
		get: function( elem, name ) {
			var ret = elem.getAttributeNode( name );
			return ret && ret.specified ?
				ret.value :
				undefined;
		},
		set: nodeHook.set
	};

	// Set contenteditable to false on removals(#10429)
	// Setting to empty string throws an error as an invalid value
	jQuery.attrHooks.contenteditable = {
		set: function( elem, value, name ) {
			nodeHook.set( elem, value === "" ? false : value, name );
		}
	};

	// Set width and height to auto instead of 0 on empty string( Bug #8150 )
	// This is for removals
	jQuery.each([ "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = {
			set: function( elem, value ) {
				if ( value === "" ) {
					elem.setAttribute( name, "auto" );
					return value;
				}
			}
		};
	});
}


// Some attributes require a special call on IE
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !jQuery.support.hrefNormalized ) {
	// href/src property should get the full normalized URL (#10299/#12915)
	jQuery.each([ "href", "src" ], function( i, name ) {
		jQuery.propHooks[ name ] = {
			get: function( elem ) {
				return elem.getAttribute( name, 4 );
			}
		};
	});
}

if ( !jQuery.support.style ) {
	jQuery.attrHooks.style = {
		get: function( elem ) {
			// Return undefined in the case of empty string
			// Note: IE uppercases css property names, but if we were to .toLowerCase()
			// .cssText, that would destroy case senstitivity in URL's, like in "background"
			return elem.style.cssText || undefined;
		},
		set: function( elem, value ) {
			return ( elem.style.cssText = value + "" );
		}
	};
}

// Safari mis-reports the default selected property of an option
// Accessing the parent's selectedIndex property fixes it
if ( !jQuery.support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {
			var parent = elem.parentNode;

			if ( parent ) {
				parent.selectedIndex;

				// Make sure that it also works with optgroups, see #5701
				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
			return null;
		}
	};
}

jQuery.each([
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
});

// IE6/7 call enctype encoding
if ( !jQuery.support.enctype ) {
	jQuery.propFix.enctype = "encoding";
}

// Radios and checkboxes getter/setter
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	};
	if ( !jQuery.support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			// Support: Webkit
			// "" is returned instead of "on" if a value isn't specified
			return elem.getAttribute("value") === null ? "on" : elem.value;
		};
	}
});
var rformElems = /^(?:input|select|textarea)$/i,
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {
		var tmp, events, t, handleObjIn,
			special, eventHandle, handleObj,
			handlers, type, namespaces, origType,
			elemData = jQuery._data( elem );

		// Don't attach events to noData or text/comment nodes (but allow plain objects)
		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !(events = elemData.events) ) {
			events = elemData.events = {};
		}
		if ( !(eventHandle = elemData.handle) ) {
			eventHandle = elemData.handle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== core_strundefined && (!e || jQuery.event.triggered !== e.type) ?
					jQuery.event.dispatch.apply( eventHandle.elem, arguments ) :
					undefined;
			};
			// Add elem as a property of the handle fn to prevent a memory leak with IE non-native events
			eventHandle.elem = elem;
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( core_rnotwhite ) || [""];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !(handlers = events[ type ]) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener/attachEvent if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					// Bind the global event handler to the element
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );

					} else if ( elem.attachEvent ) {
						elem.attachEvent( "on" + type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

		// Nullify elem to prevent memory leaks in IE
		elem = null;
	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {
		var j, handleObj, tmp,
			origCount, t, events,
			special, handlers, type,
			namespaces, origType,
			elemData = jQuery.hasData( elem ) && jQuery._data( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( core_rnotwhite ) || [""];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;

			// removeData also checks for emptiness and clears the expando if empty
			// so use it instead of delete
			jQuery._removeData( elem, "events" );
		}
	},

	trigger: function( event, data, elem, onlyHandlers ) {
		var handle, ontype, cur,
			bubbleType, special, tmp, i,
			eventPath = [ elem || document ],
			type = core_hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = core_hasOwn.call( event, "namespace" ) ? event.namespace.split(".") : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf(".") >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf(":") < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join(".");
		event.namespace_re = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === (elem.ownerDocument || document) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( jQuery._data( cur, "events" ) || {} )[ event.type ] && jQuery._data( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && jQuery.acceptData( cur ) && handle.apply && handle.apply( cur, data ) === false ) {
				event.preventDefault();
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( eventPath.pop(), data ) === false) &&
				jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Can't use an .isFunction() check here because IE6/7 fails that test.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && elem[ type ] && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					try {
						elem[ type ]();
					} catch ( e ) {
						// IE<9 dies on focus/blur to hidden element (#1486,#12518)
						// only reproducible on winXP IE8 native, not IE9 in IE8 mode
					}
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, ret, handleObj, matched, j,
			handlerQueue = [],
			args = core_slice.call( arguments ),
			handlers = ( jQuery._data( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( (event.result = ret) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var sel, handleObj, matches, i,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

			/* jshint eqeqeq: false */
			for ( ; cur != this; cur = cur.parentNode || this ) {
				/* jshint eqeqeq: true */

				// Don't check non-elements (#13208)
				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.nodeType === 1 && (cur.disabled !== true || event.type !== "click") ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, handlers: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
		}

		return handlerQueue;
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop, copy,
			type = event.type,
			originalEvent = event,
			fixHook = this.fixHooks[ type ];

		if ( !fixHook ) {
			this.fixHooks[ type ] = fixHook =
				rmouseEvent.test( type ) ? this.mouseHooks :
				rkeyEvent.test( type ) ? this.keyHooks :
				{};
		}
		copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: IE<9
		// Fix target property (#1925)
		if ( !event.target ) {
			event.target = originalEvent.srcElement || document;
		}

		// Support: Chrome 23+, Safari?
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		// Support: IE<9
		// For mouse/key events, metaKey==false if it's undefined (#3368, #11328)
		event.metaKey = !!event.metaKey;

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var body, eventDoc, doc,
				button = original.button,
				fromElement = original.fromElement;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add relatedTarget, if necessary
			if ( !event.relatedTarget && fromElement ) {
				event.relatedTarget = fromElement === event.target ? original.toElement : fromElement;
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		focus: {
			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== safeActiveElement() && this.focus ) {
					try {
						this.focus();
						return false;
					} catch ( e ) {
						// Support: IE<9
						// If we error on focus to hidden element (#1486, #12518),
						// let .trigger() run the handlers
					}
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === safeActiveElement() && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},
		click: {
			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( jQuery.nodeName( this, "input" ) && this.type === "checkbox" && this.click ) {
					this.click();
					return false;
				}
			},

			// For cross-browser consistency, don't fire native .click() on links
			_default: function( event ) {
				return jQuery.nodeName( event.target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Even when returnValue equals to undefined Firefox will still show alert
				if ( event.result !== undefined ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

jQuery.removeEvent = document.removeEventListener ?
	function( elem, type, handle ) {
		if ( elem.removeEventListener ) {
			elem.removeEventListener( type, handle, false );
		}
	} :
	function( elem, type, handle ) {
		var name = "on" + type;

		if ( elem.detachEvent ) {

			// #8545, #7054, preventing memory leaks for custom events in IE6-8
			// detachEvent needed property on element, by name of that event, to properly expose it to GC
			if ( typeof elem[ name ] === core_strundefined ) {
				elem[ name ] = null;
			}

			elem.detachEvent( name, handle );
		}
	};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = ( src.defaultPrevented || src.returnValue === false ||
			src.getPreventDefault && src.getPreventDefault() ) ? returnTrue : returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;
		if ( !e ) {
			return;
		}

		// If preventDefault exists, run it on the original event
		if ( e.preventDefault ) {
			e.preventDefault();

		// Support: IE
		// Otherwise set the returnValue property of the original event to false
		} else {
			e.returnValue = false;
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;
		if ( !e ) {
			return;
		}
		// If stopPropagation exists, run it on the original event
		if ( e.stopPropagation ) {
			e.stopPropagation();
		}

		// Support: IE
		// Set the cancelBubble property of the original event to true
		e.cancelBubble = true;
	},
	stopImmediatePropagation: function() {
		this.isImmediatePropagationStopped = returnTrue;
		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// IE submit delegation
if ( !jQuery.support.submitBubbles ) {

	jQuery.event.special.submit = {
		setup: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Lazy-add a submit handler when a descendant form may potentially be submitted
			jQuery.event.add( this, "click._submit keypress._submit", function( e ) {
				// Node name check avoids a VML-related crash in IE (#9807)
				var elem = e.target,
					form = jQuery.nodeName( elem, "input" ) || jQuery.nodeName( elem, "button" ) ? elem.form : undefined;
				if ( form && !jQuery._data( form, "submitBubbles" ) ) {
					jQuery.event.add( form, "submit._submit", function( event ) {
						event._submit_bubble = true;
					});
					jQuery._data( form, "submitBubbles", true );
				}
			});
			// return undefined since we don't need an event listener
		},

		postDispatch: function( event ) {
			// If form was submitted by the user, bubble the event up the tree
			if ( event._submit_bubble ) {
				delete event._submit_bubble;
				if ( this.parentNode && !event.isTrigger ) {
					jQuery.event.simulate( "submit", this.parentNode, event, true );
				}
			}
		},

		teardown: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Remove delegated handlers; cleanData eventually reaps submit handlers attached above
			jQuery.event.remove( this, "._submit" );
		}
	};
}

// IE change delegation and checkbox/radio fix
if ( !jQuery.support.changeBubbles ) {

	jQuery.event.special.change = {

		setup: function() {

			if ( rformElems.test( this.nodeName ) ) {
				// IE doesn't fire change on a check/radio until blur; trigger it on click
				// after a propertychange. Eat the blur-change in special.change.handle.
				// This still fires onchange a second time for check/radio after blur.
				if ( this.type === "checkbox" || this.type === "radio" ) {
					jQuery.event.add( this, "propertychange._change", function( event ) {
						if ( event.originalEvent.propertyName === "checked" ) {
							this._just_changed = true;
						}
					});
					jQuery.event.add( this, "click._change", function( event ) {
						if ( this._just_changed && !event.isTrigger ) {
							this._just_changed = false;
						}
						// Allow triggered, simulated change events (#11500)
						jQuery.event.simulate( "change", this, event, true );
					});
				}
				return false;
			}
			// Delegated event; lazy-add a change handler on descendant inputs
			jQuery.event.add( this, "beforeactivate._change", function( e ) {
				var elem = e.target;

				if ( rformElems.test( elem.nodeName ) && !jQuery._data( elem, "changeBubbles" ) ) {
					jQuery.event.add( elem, "change._change", function( event ) {
						if ( this.parentNode && !event.isSimulated && !event.isTrigger ) {
							jQuery.event.simulate( "change", this.parentNode, event, true );
						}
					});
					jQuery._data( elem, "changeBubbles", true );
				}
			});
		},

		handle: function( event ) {
			var elem = event.target;

			// Swallow native change events from checkbox/radio, we already triggered them above
			if ( this !== elem || event.isSimulated || event.isTrigger || (elem.type !== "radio" && elem.type !== "checkbox") ) {
				return event.handleObj.handler.apply( this, arguments );
			}
		},

		teardown: function() {
			jQuery.event.remove( this, "._change" );

			return !rformElems.test( this.nodeName );
		}
	};
}

// Create "bubbling" focus and blur events
if ( !jQuery.support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler while someone wants focusin/focusout
		var attaches = 0,
			handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				if ( attaches++ === 0 ) {
					document.addEventListener( orig, handler, true );
				}
			},
			teardown: function() {
				if ( --attaches === 0 ) {
					document.removeEventListener( orig, handler, true );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var type, origFn;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) {
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		var elem = this[0];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
});
var isSimple = /^.[^:#\[\.,]*$/,
	rparentsprev = /^(?:parents|prev(?:Until|All))/,
	rneedsContext = jQuery.expr.match.needsContext,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend({
	find: function( selector ) {
		var i,
			ret = [],
			self = this,
			len = self.length;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter(function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			}) );
		}

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
		ret.selector = this.selector ? this.selector + " " + selector : selector;
		return ret;
	},

	has: function( target ) {
		var i,
			targets = jQuery( target, this ),
			len = targets.length;

		return this.filter(function() {
			for ( i = 0; i < len; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	not: function( selector ) {
		return this.pushStack( winnow(this, selector || [], true) );
	},

	filter: function( selector ) {
		return this.pushStack( winnow(this, selector || [], false) );
	},

	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			ret = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			for ( cur = this[i]; cur && cur !== context; cur = cur.parentNode ) {
				// Always skip document fragments
				if ( cur.nodeType < 11 && (pos ?
					pos.index(cur) > -1 :

					// Don't pass non-elements to Sizzle
					cur.nodeType === 1 &&
						jQuery.find.matchesSelector(cur, selectors)) ) {

					cur = ret.push( cur );
					break;
				}
			}
		}

		return this.pushStack( ret.length > 1 ? jQuery.unique( ret ) : ret );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[0] && this[0].parentNode ) ? this.first().prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return jQuery.inArray( this[0], jQuery( elem ) );
		}

		// Locate the position of the desired element
		return jQuery.inArray(
			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[0] : elem, this );
	},

	add: function( selector, context ) {
		var set = typeof selector === "string" ?
				jQuery( selector, context ) :
				jQuery.makeArray( selector && selector.nodeType ? [ selector ] : selector ),
			all = jQuery.merge( this.get(), set );

		return this.pushStack( jQuery.unique(all) );
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

function sibling( cur, dir ) {
	do {
		cur = cur[ dir ];
	} while ( cur && cur.nodeType !== 1 );

	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return jQuery.nodeName( elem, "iframe" ) ?
			elem.contentDocument || elem.contentWindow.document :
			jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var ret = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			ret = jQuery.filter( selector, ret );
		}

		if ( this.length > 1 ) {
			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				ret = jQuery.unique( ret );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				ret = ret.reverse();
			}
		}

		return this.pushStack( ret );
	};
});

jQuery.extend({
	filter: function( expr, elems, not ) {
		var elem = elems[ 0 ];

		if ( not ) {
			expr = ":not(" + expr + ")";
		}

		return elems.length === 1 && elem.nodeType === 1 ?
			jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [] :
			jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
				return elem.nodeType === 1;
			}));
	},

	dir: function( elem, dir, until ) {
		var matched = [],
			cur = elem[ dir ];

		while ( cur && cur.nodeType !== 9 && (until === undefined || cur.nodeType !== 1 || !jQuery( cur ).is( until )) ) {
			if ( cur.nodeType === 1 ) {
				matched.push( cur );
			}
			cur = cur[dir];
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var r = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				r.push( n );
			}
		}

		return r;
	}
});

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			/* jshint -W018 */
			return !!qualifier.call( elem, i, elem ) !== not;
		});

	}

	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		});

	}

	if ( typeof qualifier === "string" ) {
		if ( isSimple.test( qualifier ) ) {
			return jQuery.filter( qualifier, elements, not );
		}

		qualifier = jQuery.filter( qualifier, elements );
	}

	return jQuery.grep( elements, function( elem ) {
		return ( jQuery.inArray( elem, qualifier ) >= 0 ) !== not;
	});
}
function createSafeFragment( document ) {
	var list = nodeNames.split( "|" ),
		safeFrag = document.createDocumentFragment();

	if ( safeFrag.createElement ) {
		while ( list.length ) {
			safeFrag.createElement(
				list.pop()
			);
		}
	}
	return safeFrag;
}

var nodeNames = "abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|" +
		"header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",
	rinlinejQuery = / jQuery\d+="(?:null|\d+)"/g,
	rnoshimcache = new RegExp("<(?:" + nodeNames + ")[\\s/>]", "i"),
	rleadingWhitespace = /^\s+/,
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rtbody = /<tbody/i,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	manipulation_rcheckableType = /^(?:checkbox|radio)$/i,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /^$|\/(?:java|ecma)script/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

	// We have to close these tags to support XHTML (#13200)
	wrapMap = {
		option: [ 1, "<select multiple='multiple'>", "</select>" ],
		legend: [ 1, "<fieldset>", "</fieldset>" ],
		area: [ 1, "<map>", "</map>" ],
		param: [ 1, "<object>", "</object>" ],
		thead: [ 1, "<table>", "</table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		col: [ 2, "<table><tbody></tbody><colgroup>", "</colgroup></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

		// IE6-8 can't serialize link, script, style, or any html5 (NoScope) tags,
		// unless wrapped in a div with non-breaking characters in front of it.
		_default: jQuery.support.htmlSerialize ? [ 0, "", "" ] : [ 1, "X<div>", "</div>"  ]
	},
	safeFragment = createSafeFragment( document ),
	fragmentDiv = safeFragment.appendChild( document.createElement("div") );

wrapMap.optgroup = wrapMap.option;
wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

jQuery.fn.extend({
	text: function( value ) {
		return jQuery.access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().append( ( this[0] && this[0].ownerDocument || document ).createTextNode( value ) );
		}, null, value, arguments.length );
	},

	append: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		});
	},

	before: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		});
	},

	after: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		});
	},

	// keepData is for internal use only--do not document
	remove: function( selector, keepData ) {
		var elem,
			elems = selector ? jQuery.filter( selector, this ) : this,
			i = 0;

		for ( ; (elem = elems[i]) != null; i++ ) {

			if ( !keepData && elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem ) );
			}

			if ( elem.parentNode ) {
				if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
					setGlobalEval( getAll( elem, "script" ) );
				}
				elem.parentNode.removeChild( elem );
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			// Remove element nodes and prevent memory leaks
			if ( elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem, false ) );
			}

			// Remove any remaining nodes
			while ( elem.firstChild ) {
				elem.removeChild( elem.firstChild );
			}

			// If this is a select, ensure that it displays empty (#12336)
			// Support: IE<9
			if ( elem.options && jQuery.nodeName( elem, "select" ) ) {
				elem.options.length = 0;
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function () {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return jQuery.access( this, function( value ) {
			var elem = this[0] || {},
				i = 0,
				l = this.length;

			if ( value === undefined ) {
				return elem.nodeType === 1 ?
					elem.innerHTML.replace( rinlinejQuery, "" ) :
					undefined;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				( jQuery.support.htmlSerialize || !rnoshimcache.test( value )  ) &&
				( jQuery.support.leadingWhitespace || !rleadingWhitespace.test( value ) ) &&
				!wrapMap[ ( rtagName.exec( value ) || ["", ""] )[1].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for (; i < l; i++ ) {
						// Remove element nodes and prevent memory leaks
						elem = this[i] || {};
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch(e) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var
			// Snapshot the DOM in case .domManip sweeps something relevant into its fragment
			args = jQuery.map( this, function( elem ) {
				return [ elem.nextSibling, elem.parentNode ];
			}),
			i = 0;

		// Make the changes, replacing each context element with the new content
		this.domManip( arguments, function( elem ) {
			var next = args[ i++ ],
				parent = args[ i++ ];

			if ( parent ) {
				// Don't use the snapshot next if it has moved (#13810)
				if ( next && next.parentNode !== parent ) {
					next = this.nextSibling;
				}
				jQuery( this ).remove();
				parent.insertBefore( elem, next );
			}
		// Allow new content to include elements from the context set
		}, true );

		// Force removal if there was no new content (e.g., from empty arguments)
		return i ? this : this.remove();
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, callback, allowIntersection ) {

		// Flatten any nested arrays
		args = core_concat.apply( [], args );

		var first, node, hasScripts,
			scripts, doc, fragment,
			i = 0,
			l = this.length,
			set = this,
			iNoClone = l - 1,
			value = args[0],
			isFunction = jQuery.isFunction( value );

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( isFunction || !( l <= 1 || typeof value !== "string" || jQuery.support.checkClone || !rchecked.test( value ) ) ) {
			return this.each(function( index ) {
				var self = set.eq( index );
				if ( isFunction ) {
					args[0] = value.call( this, index, self.html() );
				}
				self.domManip( args, callback, allowIntersection );
			});
		}

		if ( l ) {
			fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, !allowIntersection && this );
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
				hasScripts = scripts.length;

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				for ( ; i < l; i++ ) {
					node = fragment;

					if ( i !== iNoClone ) {
						node = jQuery.clone( node, true, true );

						// Keep references to cloned scripts for later restoration
						if ( hasScripts ) {
							jQuery.merge( scripts, getAll( node, "script" ) );
						}
					}

					callback.call( this[i], node, i );
				}

				if ( hasScripts ) {
					doc = scripts[ scripts.length - 1 ].ownerDocument;

					// Reenable scripts
					jQuery.map( scripts, restoreScript );

					// Evaluate executable scripts on first document insertion
					for ( i = 0; i < hasScripts; i++ ) {
						node = scripts[ i ];
						if ( rscriptType.test( node.type || "" ) &&
							!jQuery._data( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

							if ( node.src ) {
								// Hope ajax is available...
								jQuery._evalUrl( node.src );
							} else {
								jQuery.globalEval( ( node.text || node.textContent || node.innerHTML || "" ).replace( rcleanScript, "" ) );
							}
						}
					}
				}

				// Fix #11809: Avoid leaking memory
				fragment = first = null;
			}
		}

		return this;
	}
});

// Support: IE<8
// Manipulating tables requires a tbody
function manipulationTarget( elem, content ) {
	return jQuery.nodeName( elem, "table" ) &&
		jQuery.nodeName( content.nodeType === 1 ? content : content.firstChild, "tr" ) ?

		elem.getElementsByTagName("tbody")[0] ||
			elem.appendChild( elem.ownerDocument.createElement("tbody") ) :
		elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = (jQuery.find.attr( elem, "type" ) !== null) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );
	if ( match ) {
		elem.type = match[1];
	} else {
		elem.removeAttribute("type");
	}
	return elem;
}

// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var elem,
		i = 0;
	for ( ; (elem = elems[i]) != null; i++ ) {
		jQuery._data( elem, "globalEval", !refElements || jQuery._data( refElements[i], "globalEval" ) );
	}
}

function cloneCopyEvent( src, dest ) {

	if ( dest.nodeType !== 1 || !jQuery.hasData( src ) ) {
		return;
	}

	var type, i, l,
		oldData = jQuery._data( src ),
		curData = jQuery._data( dest, oldData ),
		events = oldData.events;

	if ( events ) {
		delete curData.handle;
		curData.events = {};

		for ( type in events ) {
			for ( i = 0, l = events[ type ].length; i < l; i++ ) {
				jQuery.event.add( dest, type, events[ type ][ i ] );
			}
		}
	}

	// make the cloned public data object a copy from the original
	if ( curData.data ) {
		curData.data = jQuery.extend( {}, curData.data );
	}
}

function fixCloneNodeIssues( src, dest ) {
	var nodeName, e, data;

	// We do not need to do anything for non-Elements
	if ( dest.nodeType !== 1 ) {
		return;
	}

	nodeName = dest.nodeName.toLowerCase();

	// IE6-8 copies events bound via attachEvent when using cloneNode.
	if ( !jQuery.support.noCloneEvent && dest[ jQuery.expando ] ) {
		data = jQuery._data( dest );

		for ( e in data.events ) {
			jQuery.removeEvent( dest, e, data.handle );
		}

		// Event data gets referenced instead of copied if the expando gets copied too
		dest.removeAttribute( jQuery.expando );
	}

	// IE blanks contents when cloning scripts, and tries to evaluate newly-set text
	if ( nodeName === "script" && dest.text !== src.text ) {
		disableScript( dest ).text = src.text;
		restoreScript( dest );

	// IE6-10 improperly clones children of object elements using classid.
	// IE10 throws NoModificationAllowedError if parent is null, #12132.
	} else if ( nodeName === "object" ) {
		if ( dest.parentNode ) {
			dest.outerHTML = src.outerHTML;
		}

		// This path appears unavoidable for IE9. When cloning an object
		// element in IE9, the outerHTML strategy above is not sufficient.
		// If the src has innerHTML and the destination does not,
		// copy the src.innerHTML into the dest.innerHTML. #10324
		if ( jQuery.support.html5Clone && ( src.innerHTML && !jQuery.trim(dest.innerHTML) ) ) {
			dest.innerHTML = src.innerHTML;
		}

	} else if ( nodeName === "input" && manipulation_rcheckableType.test( src.type ) ) {
		// IE6-8 fails to persist the checked state of a cloned checkbox
		// or radio button. Worse, IE6-7 fail to give the cloned element
		// a checked appearance if the defaultChecked value isn't also set

		dest.defaultChecked = dest.checked = src.checked;

		// IE6-7 get confused and end up setting the value of a cloned
		// checkbox/radio button to an empty string instead of "on"
		if ( dest.value !== src.value ) {
			dest.value = src.value;
		}

	// IE6-8 fails to return the selected option to the default selected
	// state when cloning options
	} else if ( nodeName === "option" ) {
		dest.defaultSelected = dest.selected = src.defaultSelected;

	// IE6-8 fails to set the defaultValue to the correct value when
	// cloning other types of input fields
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			i = 0,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone(true);
			jQuery( insert[i] )[ original ]( elems );

			// Modern browsers can apply jQuery collections as arrays, but oldIE needs a .get()
			core_push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
});

function getAll( context, tag ) {
	var elems, elem,
		i = 0,
		found = typeof context.getElementsByTagName !== core_strundefined ? context.getElementsByTagName( tag || "*" ) :
			typeof context.querySelectorAll !== core_strundefined ? context.querySelectorAll( tag || "*" ) :
			undefined;

	if ( !found ) {
		for ( found = [], elems = context.childNodes || context; (elem = elems[i]) != null; i++ ) {
			if ( !tag || jQuery.nodeName( elem, tag ) ) {
				found.push( elem );
			} else {
				jQuery.merge( found, getAll( elem, tag ) );
			}
		}
	}

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], found ) :
		found;
}

// Used in buildFragment, fixes the defaultChecked property
function fixDefaultChecked( elem ) {
	if ( manipulation_rcheckableType.test( elem.type ) ) {
		elem.defaultChecked = elem.checked;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var destElements, node, clone, i, srcElements,
			inPage = jQuery.contains( elem.ownerDocument, elem );

		if ( jQuery.support.html5Clone || jQuery.isXMLDoc(elem) || !rnoshimcache.test( "<" + elem.nodeName + ">" ) ) {
			clone = elem.cloneNode( true );

		// IE<=8 does not properly clone detached, unknown element nodes
		} else {
			fragmentDiv.innerHTML = elem.outerHTML;
			fragmentDiv.removeChild( clone = fragmentDiv.firstChild );
		}

		if ( (!jQuery.support.noCloneEvent || !jQuery.support.noCloneChecked) &&
				(elem.nodeType === 1 || elem.nodeType === 11) && !jQuery.isXMLDoc(elem) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			// Fix all IE cloning issues
			for ( i = 0; (node = srcElements[i]) != null; ++i ) {
				// Ensure that the destination node is not null; Fixes #9587
				if ( destElements[i] ) {
					fixCloneNodeIssues( node, destElements[i] );
				}
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0; (node = srcElements[i]) != null; i++ ) {
					cloneCopyEvent( node, destElements[i] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		destElements = srcElements = node = null;

		// Return the cloned set
		return clone;
	},

	buildFragment: function( elems, context, scripts, selection ) {
		var j, elem, contains,
			tmp, tag, tbody, wrap,
			l = elems.length,

			// Ensure a safe fragment
			safe = createSafeFragment( context ),

			nodes = [],
			i = 0;

		for ( ; i < l; i++ ) {
			elem = elems[ i ];

			if ( elem || elem === 0 ) {

				// Add nodes directly
				if ( jQuery.type( elem ) === "object" ) {
					jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

				// Convert non-html into a text node
				} else if ( !rhtml.test( elem ) ) {
					nodes.push( context.createTextNode( elem ) );

				// Convert html into DOM nodes
				} else {
					tmp = tmp || safe.appendChild( context.createElement("div") );

					// Deserialize a standard representation
					tag = ( rtagName.exec( elem ) || ["", ""] )[1].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;

					tmp.innerHTML = wrap[1] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[2];

					// Descend through wrappers to the right content
					j = wrap[0];
					while ( j-- ) {
						tmp = tmp.lastChild;
					}

					// Manually add leading whitespace removed by IE
					if ( !jQuery.support.leadingWhitespace && rleadingWhitespace.test( elem ) ) {
						nodes.push( context.createTextNode( rleadingWhitespace.exec( elem )[0] ) );
					}

					// Remove IE's autoinserted <tbody> from table fragments
					if ( !jQuery.support.tbody ) {

						// String was a <table>, *may* have spurious <tbody>
						elem = tag === "table" && !rtbody.test( elem ) ?
							tmp.firstChild :

							// String was a bare <thead> or <tfoot>
							wrap[1] === "<table>" && !rtbody.test( elem ) ?
								tmp :
								0;

						j = elem && elem.childNodes.length;
						while ( j-- ) {
							if ( jQuery.nodeName( (tbody = elem.childNodes[j]), "tbody" ) && !tbody.childNodes.length ) {
								elem.removeChild( tbody );
							}
						}
					}

					jQuery.merge( nodes, tmp.childNodes );

					// Fix #12392 for WebKit and IE > 9
					tmp.textContent = "";

					// Fix #12392 for oldIE
					while ( tmp.firstChild ) {
						tmp.removeChild( tmp.firstChild );
					}

					// Remember the top-level container for proper cleanup
					tmp = safe.lastChild;
				}
			}
		}

		// Fix #11356: Clear elements from fragment
		if ( tmp ) {
			safe.removeChild( tmp );
		}

		// Reset defaultChecked for any radios and checkboxes
		// about to be appended to the DOM in IE 6/7 (#8060)
		if ( !jQuery.support.appendChecked ) {
			jQuery.grep( getAll( nodes, "input" ), fixDefaultChecked );
		}

		i = 0;
		while ( (elem = nodes[ i++ ]) ) {

			// #4087 - If origin and destination elements are the same, and this is
			// that element, do not do anything
			if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
				continue;
			}

			contains = jQuery.contains( elem.ownerDocument, elem );

			// Append to fragment
			tmp = getAll( safe.appendChild( elem ), "script" );

			// Preserve script evaluation history
			if ( contains ) {
				setGlobalEval( tmp );
			}

			// Capture executables
			if ( scripts ) {
				j = 0;
				while ( (elem = tmp[ j++ ]) ) {
					if ( rscriptType.test( elem.type || "" ) ) {
						scripts.push( elem );
					}
				}
			}
		}

		tmp = null;

		return safe;
	},

	cleanData: function( elems, /* internal */ acceptData ) {
		var elem, type, id, data,
			i = 0,
			internalKey = jQuery.expando,
			cache = jQuery.cache,
			deleteExpando = jQuery.support.deleteExpando,
			special = jQuery.event.special;

		for ( ; (elem = elems[i]) != null; i++ ) {

			if ( acceptData || jQuery.acceptData( elem ) ) {

				id = elem[ internalKey ];
				data = id && cache[ id ];

				if ( data ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Remove cache only if it was not already removed by jQuery.event.remove
					if ( cache[ id ] ) {

						delete cache[ id ];

						// IE does not allow us to delete expando properties from nodes,
						// nor does it have a removeAttribute function on Document nodes;
						// we must handle all of these cases
						if ( deleteExpando ) {
							delete elem[ internalKey ];

						} else if ( typeof elem.removeAttribute !== core_strundefined ) {
							elem.removeAttribute( internalKey );

						} else {
							elem[ internalKey ] = null;
						}

						core_deletedIds.push( id );
					}
				}
			}
		}
	},

	_evalUrl: function( url ) {
		return jQuery.ajax({
			url: url,
			type: "GET",
			dataType: "script",
			async: false,
			global: false,
			"throws": true
		});
	}
});
jQuery.fn.extend({
	wrapAll: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapAll( html.call(this, i) );
			});
		}

		if ( this[0] ) {
			// The elements to wrap the target around
			var wrap = jQuery( html, this[0].ownerDocument ).eq(0).clone(true);

			if ( this[0].parentNode ) {
				wrap.insertBefore( this[0] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstChild && elem.firstChild.nodeType === 1 ) {
					elem = elem.firstChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function(i) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	}
});
var iframe, getStyles, curCSS,
	ralpha = /alpha\([^)]*\)/i,
	ropacity = /opacity\s*=\s*([^)]*)/,
	rposition = /^(top|right|bottom|left)$/,
	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rmargin = /^margin/,
	rnumsplit = new RegExp( "^(" + core_pnum + ")(.*)$", "i" ),
	rnumnonpx = new RegExp( "^(" + core_pnum + ")(?!px)[a-z%]+$", "i" ),
	rrelNum = new RegExp( "^([+-])=(" + core_pnum + ")", "i" ),
	elemdisplay = { BODY: "block" },

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: 0,
		fontWeight: 400
	},

	cssExpand = [ "Top", "Right", "Bottom", "Left" ],
	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];

// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name.charAt(0).toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function isHidden( elem, el ) {
	// isHidden might be called from jQuery#filter function;
	// in that case, element will be second argument
	elem = el || elem;
	return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
}

function showHide( elements, show ) {
	var display, elem, hidden,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		values[ index ] = jQuery._data( elem, "olddisplay" );
		display = elem.style.display;
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = jQuery._data( elem, "olddisplay", css_defaultDisplay(elem.nodeName) );
			}
		} else {

			if ( !values[ index ] ) {
				hidden = isHidden( elem );

				if ( display && display !== "none" || !hidden ) {
					jQuery._data( elem, "olddisplay", hidden ? display : jQuery.css( elem, "display" ) );
				}
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.fn.extend({
	css: function( name, value ) {
		return jQuery.access( this, function( elem, name, value ) {
			var len, styles,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each(function() {
			if ( isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"columnCount": true,
		"fillOpacity": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": jQuery.support.cssFloat ? "cssFloat" : "styleFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that NaN and null values aren't set. See: #7116
			if ( value == null || type === "number" && isNaN( value ) ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// Fixes #8908, it can be done more correctly by specifing setters in cssHooks,
			// but it would mean to define eight (for every problematic property) identical functions
			if ( !jQuery.support.clearCloneStyle && value === "" && name.indexOf("background") === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {

				// Wrapped to prevent IE from throwing errors when 'invalid' values are provided
				// Fixes bug #5509
				try {
					style[ name ] = value;
				} catch(e) {}
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var num, val, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	}
});

// NOTE: we've included the "window" in window.getComputedStyle
// because jsdom on node.js will break without it.
if ( window.getComputedStyle ) {
	getStyles = function( elem ) {
		return window.getComputedStyle( elem, null );
	};

	curCSS = function( elem, name, _computed ) {
		var width, minWidth, maxWidth,
			computed = _computed || getStyles( elem ),

			// getPropertyValue is only needed for .css('filter') in IE9, see #12537
			ret = computed ? computed.getPropertyValue( name ) || computed[ name ] : undefined,
			style = elem.style;

		if ( computed ) {

			if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
				ret = jQuery.style( elem, name );
			}

			// A tribute to the "awesome hack by Dean Edwards"
			// Chrome < 17 and Safari 5.0 uses "computed value" instead of "used value" for margin-right
			// Safari 5.1.7 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
			// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
			if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

				// Remember the original values
				width = style.width;
				minWidth = style.minWidth;
				maxWidth = style.maxWidth;

				// Put in the new values to get a computed value out
				style.minWidth = style.maxWidth = style.width = ret;
				ret = computed.width;

				// Revert the changed values
				style.width = width;
				style.minWidth = minWidth;
				style.maxWidth = maxWidth;
			}
		}

		return ret;
	};
} else if ( document.documentElement.currentStyle ) {
	getStyles = function( elem ) {
		return elem.currentStyle;
	};

	curCSS = function( elem, name, _computed ) {
		var left, rs, rsLeft,
			computed = _computed || getStyles( elem ),
			ret = computed ? computed[ name ] : undefined,
			style = elem.style;

		// Avoid setting ret to empty string here
		// so we don't default to auto
		if ( ret == null && style && style[ name ] ) {
			ret = style[ name ];
		}

		// From the awesome hack by Dean Edwards
		// http://erik.eae.net/archives/2007/07/27/18.54.15/#comment-102291

		// If we're not dealing with a regular pixel number
		// but a number that has a weird ending, we need to convert it to pixels
		// but not position css attributes, as those are proportional to the parent element instead
		// and we can't measure the parent instead because it might trigger a "stacking dolls" problem
		if ( rnumnonpx.test( ret ) && !rposition.test( name ) ) {

			// Remember the original values
			left = style.left;
			rs = elem.runtimeStyle;
			rsLeft = rs && rs.left;

			// Put in the new values to get a computed value out
			if ( rsLeft ) {
				rs.left = elem.currentStyle.left;
			}
			style.left = name === "fontSize" ? "1em" : ret;
			ret = style.pixelLeft + "px";

			// Revert the changed values
			style.left = left;
			if ( rsLeft ) {
				rs.left = rsLeft;
			}
		}

		return ret === "" ? "auto" : ret;
	};
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox && ( jQuery.support.boxSizingReliable || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

// Try to determine the default display value of an element
function css_defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {
			// Use the already-created iframe if possible
			iframe = ( iframe ||
				jQuery("<iframe frameborder='0' width='0' height='0'/>")
				.css( "cssText", "display:block !important" )
			).appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = ( iframe[0].contentWindow || iframe[0].contentDocument ).document;
			doc.write("<!doctype html><html><body>");
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}

// Called ONLY from within css_defaultDisplay
function actualDisplay( name, doc ) {
	var elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),
		display = jQuery.css( elem[0], "display" );
	elem.remove();
	return display;
}

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				return elem.offsetWidth === 0 && rdisplayswap.test( jQuery.css( elem, "display" ) ) ?
					jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					}) :
					getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var styles = extra && getStyles( elem );
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				) : 0
			);
		}
	};
});

if ( !jQuery.support.opacity ) {
	jQuery.cssHooks.opacity = {
		get: function( elem, computed ) {
			// IE uses filters for opacity
			return ropacity.test( (computed && elem.currentStyle ? elem.currentStyle.filter : elem.style.filter) || "" ) ?
				( 0.01 * parseFloat( RegExp.$1 ) ) + "" :
				computed ? "1" : "";
		},

		set: function( elem, value ) {
			var style = elem.style,
				currentStyle = elem.currentStyle,
				opacity = jQuery.isNumeric( value ) ? "alpha(opacity=" + value * 100 + ")" : "",
				filter = currentStyle && currentStyle.filter || style.filter || "";

			// IE has trouble with opacity if it does not have layout
			// Force it by setting the zoom level
			style.zoom = 1;

			// if setting opacity to 1, and no other filters exist - attempt to remove filter attribute #6652
			// if value === "", then remove inline opacity #12685
			if ( ( value >= 1 || value === "" ) &&
					jQuery.trim( filter.replace( ralpha, "" ) ) === "" &&
					style.removeAttribute ) {

				// Setting style.filter to null, "" & " " still leave "filter:" in the cssText
				// if "filter:" is present at all, clearType is disabled, we want to avoid this
				// style.removeAttribute is IE Only, but so apparently is this code path...
				style.removeAttribute( "filter" );

				// if there is no filter style applied in a css rule or unset inline opacity, we are done
				if ( value === "" || currentStyle && !currentStyle.filter ) {
					return;
				}
			}

			// otherwise, set new filter values
			style.filter = ralpha.test( filter ) ?
				filter.replace( ralpha, opacity ) :
				filter + " " + opacity;
		}
	};
}

// These hooks cannot be added until DOM ready because the support test
// for it is not run until after DOM ready
jQuery(function() {
	if ( !jQuery.support.reliableMarginRight ) {
		jQuery.cssHooks.marginRight = {
			get: function( elem, computed ) {
				if ( computed ) {
					// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
					// Work around by temporarily setting element display to inline-block
					return jQuery.swap( elem, { "display": "inline-block" },
						curCSS, [ elem, "marginRight" ] );
				}
			}
		};
	}

	// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
	// getComputedStyle returns percent when specified for top/left/bottom/right
	// rather than make the css module depend on the offset module, we just check for it here
	if ( !jQuery.support.pixelPosition && jQuery.fn.position ) {
		jQuery.each( [ "top", "left" ], function( i, prop ) {
			jQuery.cssHooks[ prop ] = {
				get: function( elem, computed ) {
					if ( computed ) {
						computed = curCSS( elem, prop );
						// if curCSS returns percentage, fallback to offset
						return rnumnonpx.test( computed ) ?
							jQuery( elem ).position()[ prop ] + "px" :
							computed;
					}
				}
			};
		});
	}

});

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.hidden = function( elem ) {
		// Support: Opera <= 12.12
		// Opera reports offsetWidths and offsetHeights less than zero on some elements
		return elem.offsetWidth <= 0 && elem.offsetHeight <= 0 ||
			(!jQuery.support.reliableHiddenOffsets && ((elem.style && elem.style.display) || jQuery.css( elem, "display" )) === "none");
	};

	jQuery.expr.filters.visible = function( elem ) {
		return !jQuery.expr.filters.hidden( elem );
	};
}

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});
var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function(){
			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		})
		.filter(function(){
			var type = this.type;
			// Use .is(":disabled") so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !manipulation_rcheckableType.test( type ) );
		})
		.map(function( i, elem ){
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ){
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});

//Serialize an array of form elements or a set of
//key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// Item is non-scalar (array or object), encode its numeric index.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}
jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};
});

jQuery.fn.extend({
	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	}
});
var
	// Document location
	ajaxLocParts,
	ajaxLocation,
	ajax_nonce = jQuery.now(),

	ajax_rquery = /\?/,
	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)\r?$/mg, // IE leaves an \r character at EOL
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rurl = /^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,

	// Keep a copy of the old load method
	_load = jQuery.fn.load,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( core_rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			while ( (dataType = dataTypes[i++]) ) {
				// Prepend if requested
				if ( dataType[0] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					(structure[ dataType ] = structure[ dataType ] || []).unshift( func );

				// Otherwise append
				} else {
					(structure[ dataType ] = structure[ dataType ] || []).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		});
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var deep, key,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, response, type,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = url.slice( off, url.length );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax({
			url: url,

			// if "type" variable is undefined, then "GET" method will be used
			type: type,
			dataType: "html",
			data: params
		}).done(function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		}).complete( callback && function( jqXHR, status ) {
			self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
		});
	}

	return this;
};

// Attach a bunch of functions for handling common AJAX events
jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ){
	jQuery.fn[ type ] = function( fn ){
		return this.on( type, fn );
	};
});

jQuery.extend({

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: ajaxLocation,
		type: "GET",
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var // Cross-domain detection vars
			parts,
			// Loop variable
			i,
			// URL without anti-cache param
			cacheURL,
			// Response headers as string
			responseHeadersString,
			// timeout handle
			timeoutTimer,

			// To know if global events are to be dispatched
			fireGlobals,

			transport,
			// Response headers
			responseHeaders,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks("once memory"),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( (match = rheaders.exec( responseHeadersString )) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {
								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {
							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (#5866: IE7 issue with protocol-less urls)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" ).replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( core_rnotwhite ) || [""];

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? "80" : "443" ) ) !==
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? "80" : "443" ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		fireGlobals = s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger("ajaxStart");
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + ajax_nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ajax_nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
			// Abort if not done already and return
			return jqXHR.abort();
		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout(function() {
					jqXHR.abort("timeout");
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader("etag");
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger("ajaxStop");
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		});
	};
});

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {
	var firstDataType, ct, finalDataType, type,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

			// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s[ "throws" ] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}
// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /(?:java|ecma)script/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and global
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
		s.global = false;
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function(s) {

	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {

		var script,
			head = document.head || jQuery("head")[0] || document.documentElement;

		return {

			send: function( _, callback ) {

				script = document.createElement("script");

				script.async = true;

				if ( s.scriptCharset ) {
					script.charset = s.scriptCharset;
				}

				script.src = s.url;

				// Attach handlers for all browsers
				script.onload = script.onreadystatechange = function( _, isAbort ) {

					if ( isAbort || !script.readyState || /loaded|complete/.test( script.readyState ) ) {

						// Handle memory leak in IE
						script.onload = script.onreadystatechange = null;

						// Remove the script
						if ( script.parentNode ) {
							script.parentNode.removeChild( script );
						}

						// Dereference the script
						script = null;

						// Callback if not abort
						if ( !isAbort ) {
							callback( 200, "success" );
						}
					}
				};

				// Circumvent IE6 bugs with base elements (#2709 and #4378) by prepending
				// Use native DOM manipulation to avoid our domManip AJAX trickery
				head.insertBefore( script, head.firstChild );
			},

			abort: function() {
				if ( script ) {
					script.onload( undefined, true );
				}
			}
		};
	}
});
var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( ajax_nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( ajax_rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});
var xhrCallbacks, xhrSupported,
	xhrId = 0,
	// #5280: Internet Explorer will keep connections alive if we don't abort on unload
	xhrOnUnloadAbort = window.ActiveXObject && function() {
		// Abort all pending requests
		var key;
		for ( key in xhrCallbacks ) {
			xhrCallbacks[ key ]( undefined, true );
		}
	};

// Functions to create xhrs
function createStandardXHR() {
	try {
		return new window.XMLHttpRequest();
	} catch( e ) {}
}

function createActiveXHR() {
	try {
		return new window.ActiveXObject("Microsoft.XMLHTTP");
	} catch( e ) {}
}

// Create the request object
// (This is still attached to ajaxSettings for backward compatibility)
jQuery.ajaxSettings.xhr = window.ActiveXObject ?
	/* Microsoft failed to properly
	 * implement the XMLHttpRequest in IE7 (can't request local files),
	 * so we use the ActiveXObject when it is available
	 * Additionally XMLHttpRequest can be disabled in IE7/IE8 so
	 * we need a fallback.
	 */
	function() {
		return !this.isLocal && createStandardXHR() || createActiveXHR();
	} :
	// For all other browsers, use the standard XMLHttpRequest object
	createStandardXHR;

// Determine support properties
xhrSupported = jQuery.ajaxSettings.xhr();
jQuery.support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
xhrSupported = jQuery.support.ajax = !!xhrSupported;

// Create transport if the browser can provide an xhr
if ( xhrSupported ) {

	jQuery.ajaxTransport(function( s ) {
		// Cross domain only allowed if supported through XMLHttpRequest
		if ( !s.crossDomain || jQuery.support.cors ) {

			var callback;

			return {
				send: function( headers, complete ) {

					// Get a new xhr
					var handle, i,
						xhr = s.xhr();

					// Open the socket
					// Passing null username, generates a login popup on Opera (#2865)
					if ( s.username ) {
						xhr.open( s.type, s.url, s.async, s.username, s.password );
					} else {
						xhr.open( s.type, s.url, s.async );
					}

					// Apply custom fields if provided
					if ( s.xhrFields ) {
						for ( i in s.xhrFields ) {
							xhr[ i ] = s.xhrFields[ i ];
						}
					}

					// Override mime type if needed
					if ( s.mimeType && xhr.overrideMimeType ) {
						xhr.overrideMimeType( s.mimeType );
					}

					// X-Requested-With header
					// For cross-domain requests, seeing as conditions for a preflight are
					// akin to a jigsaw puzzle, we simply never set it to be sure.
					// (it can always be set on a per-request basis or even using ajaxSetup)
					// For same-domain requests, won't change header if already provided.
					if ( !s.crossDomain && !headers["X-Requested-With"] ) {
						headers["X-Requested-With"] = "XMLHttpRequest";
					}

					// Need an extra try/catch for cross domain requests in Firefox 3
					try {
						for ( i in headers ) {
							xhr.setRequestHeader( i, headers[ i ] );
						}
					} catch( err ) {}

					// Do send the request
					// This may raise an exception which is actually
					// handled in jQuery.ajax (so no try/catch here)
					xhr.send( ( s.hasContent && s.data ) || null );

					// Listener
					callback = function( _, isAbort ) {
						var status, responseHeaders, statusText, responses;

						// Firefox throws exceptions when accessing properties
						// of an xhr when a network error occurred
						// http://helpful.knobs-dials.com/index.php/Component_returned_failure_code:_0x80040111_(NS_ERROR_NOT_AVAILABLE)
						try {

							// Was never called and is aborted or complete
							if ( callback && ( isAbort || xhr.readyState === 4 ) ) {

								// Only called once
								callback = undefined;

								// Do not keep as active anymore
								if ( handle ) {
									xhr.onreadystatechange = jQuery.noop;
									if ( xhrOnUnloadAbort ) {
										delete xhrCallbacks[ handle ];
									}
								}

								// If it's an abort
								if ( isAbort ) {
									// Abort it manually if needed
									if ( xhr.readyState !== 4 ) {
										xhr.abort();
									}
								} else {
									responses = {};
									status = xhr.status;
									responseHeaders = xhr.getAllResponseHeaders();

									// When requesting binary data, IE6-9 will throw an exception
									// on any attempt to access responseText (#11426)
									if ( typeof xhr.responseText === "string" ) {
										responses.text = xhr.responseText;
									}

									// Firefox throws an exception when accessing
									// statusText for faulty cross-domain requests
									try {
										statusText = xhr.statusText;
									} catch( e ) {
										// We normalize with Webkit giving an empty statusText
										statusText = "";
									}

									// Filter status for non standard behaviors

									// If the request is local and we have data: assume a success
									// (success with no data won't get notified, that's the best we
									// can do given current implementations)
									if ( !status && s.isLocal && !s.crossDomain ) {
										status = responses.text ? 200 : 404;
									// IE - #1450: sometimes returns 1223 when it should be 204
									} else if ( status === 1223 ) {
										status = 204;
									}
								}
							}
						} catch( firefoxAccessException ) {
							if ( !isAbort ) {
								complete( -1, firefoxAccessException );
							}
						}

						// Call complete if needed
						if ( responses ) {
							complete( status, statusText, responses, responseHeaders );
						}
					};

					if ( !s.async ) {
						// if we're in sync mode we fire the callback
						callback();
					} else if ( xhr.readyState === 4 ) {
						// (IE6 & IE7) if it's in cache and has been
						// retrieved directly we need to fire the callback
						setTimeout( callback );
					} else {
						handle = ++xhrId;
						if ( xhrOnUnloadAbort ) {
							// Create the active xhrs callbacks list if needed
							// and attach the unload handler
							if ( !xhrCallbacks ) {
								xhrCallbacks = {};
								jQuery( window ).unload( xhrOnUnloadAbort );
							}
							// Add to list of active xhrs callbacks
							xhrCallbacks[ handle ] = callback;
						}
						xhr.onreadystatechange = callback;
					}
				},

				abort: function() {
					if ( callback ) {
						callback( undefined, true );
					}
				}
			};
		}
	});
}
var fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([+-])=|)(" + core_pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [function( prop, value ) {
			var tween = this.createTween( prop, value ),
				target = tween.cur(),
				parts = rfxnum.exec( value ),
				unit = parts && parts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

				// Starting value computation is required for potential unit mismatches
				start = ( jQuery.cssNumber[ prop ] || unit !== "px" && +target ) &&
					rfxnum.exec( jQuery.css( tween.elem, prop ) ),
				scale = 1,
				maxIterations = 20;

			if ( start && start[ 3 ] !== unit ) {
				// Trust units reported by jQuery.css
				unit = unit || start[ 3 ];

				// Make sure we update the tween properties later on
				parts = parts || [];

				// Iteratively approximate from a nonzero starting point
				start = +target || 1;

				do {
					// If previous iteration zeroed out, double until we get *something*
					// Use a string for doubling factor so we don't accidentally see scale as unchanged below
					scale = scale || ".5";

					// Adjust and apply
					start = start / scale;
					jQuery.style( tween.elem, prop, start + unit );

				// Update scale, tolerating zero or NaN from tween.cur()
				// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
				} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
			}

			// Update tween properties
			if ( parts ) {
				start = tween.start = +start || +target || 0;
				tween.unit = unit;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[ 1 ] ?
					start + ( parts[ 1 ] + 1 ) * parts[ 2 ] :
					+parts[ 2 ];
			}

			return tween;
		}]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	});
	return ( fxNow = jQuery.now() );
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( (tween = collection[ index ].call( animation, prop, value )) ) {

			// we're done with this property
			return tween;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

jQuery.Animation = jQuery.extend( Animation, {

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

function defaultPrefilter( elem, props, opts ) {
	/* jshint validthis: true */
	var prop, value, toggle, tween, hooks, oldfire,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHidden( elem ),
		dataShow = jQuery._data( elem, "fxshow" );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE does not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		if ( jQuery.css( elem, "display" ) === "inline" &&
				jQuery.css( elem, "float" ) === "none" ) {

			// inline-level elements accept inline-block;
			// block-level elements need to be inline with layout
			if ( !jQuery.support.inlineBlockNeedsLayout || css_defaultDisplay( elem.nodeName ) === "inline" ) {
				style.display = "inline-block";

			} else {
				style.zoom = 1;
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		if ( !jQuery.support.shrinkWrapBlocks ) {
			anim.always(function() {
				style.overflow = opts.overflow[ 0 ];
				style.overflowX = opts.overflow[ 1 ];
				style.overflowY = opts.overflow[ 2 ];
			});
		}
	}


	// show/hide pass
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {
				continue;
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );
		}
	}

	if ( !jQuery.isEmptyObject( orig ) ) {
		if ( dataShow ) {
			if ( "hidden" in dataShow ) {
				hidden = dataShow.hidden;
			}
		} else {
			dataShow = jQuery._data( elem, "fxshow", {} );
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;
			jQuery._removeData( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( prop in orig ) {
			tween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}
	}
}

function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, "" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE <=9
// Panic based approach to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || jQuery._data( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = jQuery._data( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each(function() {
			var index,
				data = jQuery._data( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// enable finishing flag on private data
			data.finish = true;

			// empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// turn off finishing flag
			delete data.finish;
		});
	}
});

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		attrs = { height: type },
		i = 0;

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth? 1 : 0;
	for( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p*Math.PI ) / 2;
	}
};

jQuery.timers = [];
jQuery.fx = Tween.prototype.init;
jQuery.fx.tick = function() {
	var timer,
		timers = jQuery.timers,
		i = 0;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	if ( timer() && jQuery.timers.push( timer ) ) {
		jQuery.fx.start();
	}
};

jQuery.fx.interval = 13;

jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};

// Back Compat <1.8 extension point
jQuery.fx.step = {};

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.animated = function( elem ) {
		return jQuery.grep(jQuery.timers, function( fn ) {
			return elem === fn.elem;
		}).length;
	};
}
jQuery.fn.offset = function( options ) {
	if ( arguments.length ) {
		return options === undefined ?
			this :
			this.each(function( i ) {
				jQuery.offset.setOffset( this, options, i );
			});
	}

	var docElem, win,
		box = { top: 0, left: 0 },
		elem = this[ 0 ],
		doc = elem && elem.ownerDocument;

	if ( !doc ) {
		return;
	}

	docElem = doc.documentElement;

	// Make sure it's not a disconnected DOM node
	if ( !jQuery.contains( docElem, elem ) ) {
		return box;
	}

	// If we don't have gBCR, just use 0,0 rather than error
	// BlackBerry 5, iOS 3 (original iPhone)
	if ( typeof elem.getBoundingClientRect !== core_strundefined ) {
		box = elem.getBoundingClientRect();
	}
	win = getWindow( doc );
	return {
		top: box.top  + ( win.pageYOffset || docElem.scrollTop )  - ( docElem.clientTop  || 0 ),
		left: box.left + ( win.pageXOffset || docElem.scrollLeft ) - ( docElem.clientLeft || 0 )
	};
};

jQuery.offset = {

	setOffset: function( elem, options, i ) {
		var position = jQuery.css( elem, "position" );

		// set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		var curElem = jQuery( elem ),
			curOffset = curElem.offset(),
			curCSSTop = jQuery.css( elem, "top" ),
			curCSSLeft = jQuery.css( elem, "left" ),
			calculatePosition = ( position === "absolute" || position === "fixed" ) && jQuery.inArray("auto", [curCSSTop, curCSSLeft]) > -1,
			props = {}, curPosition = {}, curTop, curLeft;

		// need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;
		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );
		} else {
			curElem.css( props );
		}
	}
};


jQuery.fn.extend({

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			parentOffset = { top: 0, left: 0 },
			elem = this[ 0 ];

		// fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is it's only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {
			// we assume that getBoundingClientRect is available when computed position is fixed
			offset = elem.getBoundingClientRect();
		} else {
			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top  += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		// note: when an element has margin: auto the offsetLeft and marginLeft
		// are the same in Safari causing offset.left to incorrectly be 0
		return {
			top:  offset.top  - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true)
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || docElem;
			while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position") === "static" ) ) {
				offsetParent = offsetParent.offsetParent;
			}
			return offsetParent || docElem;
		});
	}
});


// Create scrollLeft and scrollTop methods
jQuery.each( {scrollLeft: "pageXOffset", scrollTop: "pageYOffset"}, function( method, prop ) {
	var top = /Y/.test( prop );

	jQuery.fn[ method ] = function( val ) {
		return jQuery.access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? (prop in win) ? win[ prop ] :
					win.document.documentElement[ method ] :
					elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : jQuery( win ).scrollLeft(),
					top ? val : jQuery( win ).scrollTop()
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

function getWindow( elem ) {
	return jQuery.isWindow( elem ) ?
		elem :
		elem.nodeType === 9 ?
			elem.defaultView || elem.parentWindow :
			false;
}
// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return jQuery.access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height], whichever is greatest
					// unfortunately, this causes bug #3838 in IE6/8 only, but there is currently no good, small way to fix it.
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});
// Limit scope pollution from any deprecated API
// (function() {

// The number of elements contained in the matched element set
jQuery.fn.size = function() {
	return this.length;
};

jQuery.fn.andSelf = jQuery.fn.addBack;

// })();
if ( typeof module === "object" && module && typeof module.exports === "object" ) {
	// Expose jQuery as module.exports in loaders that implement the Node
	// module pattern (including browserify). Do not create the global, since
	// the user will be storing it themselves locally, and globals are frowned
	// upon in the Node module world.
	module.exports = jQuery;
} else {
	// Otherwise expose jQuery to the global object as usual
	window.jQuery = window.$ = jQuery;

	// Register as a named AMD module, since jQuery can be concatenated with other
	// files that may use define, but not via a proper concatenation script that
	// understands anonymous AMD modules. A named AMD is safest and most robust
	// way to register. Lowercase jquery is used because AMD module names are
	// derived from file names, and jQuery is normally delivered in a lowercase
	// file name. Do this after creating the global so that if an AMD module wants
	// to call noConflict to hide this version of jQuery, it will work.
	if ( typeof define === "function" && define.amd ) {
		define( "jquery", [], function () { return jQuery; } );
	}
}

})( window );

/**
 * StateRegistry class.
 */
define('../bower_components/spoonjs/src/core/StateRegistry/StateRegistry',[
    'events-emitter/MixableEventsEmitter',
    './State',
    './Route',
    'mout/array/remove',
    'mout/object/hasOwn',
    'mout/object/mixIn',
    'mout/string/startsWith',
    'mout/queryString/decode',
    'mout/queryString/encode',
    'has',
    'jquery'
], function (MixableEventsEmitter, State, Route, remove, hasOwn, mixIn, startsWith, decode, encode, has, $) {

    

    /**
     * Constructor.
     */
    function StateRegistry() {
        this._states = {};
        this._routes = [];
        this._destroyed = false;

        // Replace all functions that need to be bound
        this._handleLinkClick = this._handleLinkClick.bind(this);

        $(document.body).on('click', 'a', this._handleLinkClick);
    }

    mixIn(StateRegistry.prototype, MixableEventsEmitter.prototype);

    /**
     * Sets the address.
     *
     * @param {Address} [address] The address to set or null to unset it
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.setAddress = function (address) {
        this.unsetAddress();

        if (address) {
            this._address = address;
            address.on('change', this._onChange, this);
        }

        return this;
    };

    /**
     * Unsets the address.
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.unsetAddress = function () {
        if (this._address) {
            this._address.off('change', this._onChange, this);
            this._address = null;
            this._currentUrl = null;
        }
    };

    /**
     * Parses a given route.
     * If no route is passed, the current address value is used.
     * If a state is found for the route and is different from the current one, a transition
     * will occur and the change event will be emitted.
     *
     * This function is handy to kick-off the state registry.
     *
     * @param {String} [route] The route (URL fragment)
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.parse = function (route) {
        // Manually call the change handler with the passed route
        // or the address value (if available)
        var obj = {
            newValue: route != null ? route : (this._address ? this._address.getValue() : ''),
            oldValue: null,
            type: 'external'
        };

        this._onChange(obj);

        return this;
    };

    /**
     * Registers a map between a state and a route.
     * The pattern can have placeholders which will be used to fill a parameters object.
     * The constraints object is a simple key value object in which the keys are the placeholder names and the values are regular expressions.
     * An error will be thrown if the state being registered already exists.
     *
     * @param {String} state         The state
     * @param {String} [pattern]     The route pattern
     * @param {Object} [constraints] The route contraints
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.register = function (state, pattern, constraints) {
        if (false && this._states[state]) {
            throw new Error('State "' + state + '" is already registered.');
        }

        var route = pattern != null ? new Route(state, pattern, constraints) : null;

        // Add to the states object
        this._states[state] = route;

        // Add to the routes array
        if (route) {
            this._routes.push(route);
        }

        return this;
    };

    /**
     * Unregisters a state.
     *
     * @param {String} state The state
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.unregister = function (state) {
        var route = this._states[state];

        // Remove it from the states object
        delete this._states[state];

        if (route) {
            // Remote it from the routes array
            remove(this._routes, route);
        }

        return this;
    };

    /**
     * Unregisters all the registered states.
     *
     * @return {StateRegistry} The instance itself to allow chaining
     */
    StateRegistry.prototype.unregisterAll = function () {
        this._states = {};
        this._routes = [];

        return this;
    };

    /**
     * Checks if a state is registered.
     *
     * @param {String} state The state
     *
     * @return {Boolean} True if it is, false otherwise
     */
    StateRegistry.prototype.isRegistered = function (state) {
        return hasOwn(this._states, state);
    };

    /**
     * Checks if state is registered and has a route associated to it.
     *
     * @param {String} state The state
     *
     * @return {Boolean} True if it is, false otherwise
     */
    StateRegistry.prototype.isRoutable = function (state) {
        return !!this._states[state];
    };

    /**
     * Checks if a given state name is valid.
     *
     * @param {String} state The state
     *
     * @return {Boolean} True if valid, false otherwise
     */
    StateRegistry.prototype.isValid = function (state) {
        return State.isValid(state);
    };

    /**
     * Sets the current state.
     * If the state is not the same, the change event will be emited.
     * Also if the state has a route associated and the routing is enabled, the browser URL will be updated accordingly.
     *
     * The default implementation should handle these options:
     *  - force:   true to force the value to be changed even if the value is the same
     *  - route:   false to not change the address value
     *  - replace: true to replace the address value instead of adding a new history entry
     *
     * @param {String|State} state     The state name or the state object
     * @param {Object}       [params]  The state parameters if the state was a string
     * @param {Object}       [options] The options
     *
     * @return {Boolean} True if the transition was made, false otherwise
     */
    StateRegistry.prototype.setCurrent = function (state, params, options) {
        var previousState;

        // Handle args
        if (typeof state === 'string') {
            state = this._createStateInstance(state, params);
        } else {
            options = params;
        }

        // Set default options and merge them with the user ones
        options = mixIn({
            route: true,
            replace: !this._currentState  // Replace URL if it's the first state
        }, options || {});

        // Only change if the current state is not the same
        if (!this.isCurrent(state) || options.force) {
            previousState = this._currentState;
            this._currentState = state;

            // Handle after change stuff
            this._postChangeHandler(previousState, options);

            return true;
        }

        return false;
    };

    /**
     * Returns the current state.
     *
     * @return {State} The state
     */
    StateRegistry.prototype.getCurrent = function () {
        return this._currentState;
    };

    /**
     * Check if the current state is the same as the passed one.
     *
     * @param {String|State} state    The state name or the state object
     * @param {Object}       [params] The state parameters if the state was a string
     *
     * @return {Boolean} True if it is, false otherwise
     */
    StateRegistry.prototype.isCurrent = function (state, params) {
        // If no state is set simply return false
        if (!this._currentState) {
            return false;
        }

        // Build the state object
        if (typeof state === 'string') {
            state = this._createStateInstance(state, params);
        }

        return this._currentState.isFullyEqual(state);
    };

    /**
     * Generates an URL for a given state.
     * If no route is associated with the state, a state:// URL will be generated.
     *
     * @param {String|State} state      The state name or the state object
     * @param {Object}       [params]   The state parameters if the state was a string
     * @param {Boolean}      [absolute] True to only generate an absolute URL, false otherwise
     *
     * @return {String} The URL for the state or null if unable to generate one
     */
    StateRegistry.prototype.generateUrl = function (state, params, absolute) {
        var route = this._states[state],
            url;

        if (!route || !this._address) {
            return 'state://' + state + '/' + encode(params);
        }

        url = route.generateUrl(params);

        return this._address ? this._address.generateUrl(url, absolute) : url;
    };

    /**
     * Destroys the instance.
     */
    StateRegistry.prototype.destroy = function () {
        if (!this._destroyed) {
            this._onDestroy();
            this._destroyed = true;
        }
    };

    ///////////////////////////////////////////////////////////////

    /**
     * Creates a new state instance.
     *
     * @param {String} state    The state name
     * @param {Object} [params] The state parameters if the state was a string
     *
     * @return {State} The state instance
     */
    StateRegistry.prototype._createStateInstance = function (state, params) {
        return new State(state, params);
    };

    /**
     * Handles stuff after the state has changed.
     *
     * @param {State}  previousState The previous state
     * @param {Object} options       The options
     */
    StateRegistry.prototype._postChangeHandler = function (previousState, options) {
        var state = this._currentState.getFullName(),
            params = this._currentState.getParams(),
            url,
            route,
            tmp,
            fullName;

        if (false) {
            console.info('State changed to "' + state + '".');
            if (!this.isRegistered(state)) {
                console.warn('State "' + state + '" is not registered.');
            }
        }

        params.$info = params.$info || {};
        params.$info.newState = this._currentState;
        params.$info.previousState = previousState;

        // Set address value
        if (this._address && options.route) {
            route = this._states[state];
            if (!route) {
                this._address.reset();
                this._currentUrl = null;
            } else {
                url = route.generateUrl(params);
                this._address.setValue(url, options);
            }
        }

        fullName = this._currentState.getFullName();
        this._currentState.setCursor(0);

        // Emit the change
        tmp = this._currentState;
        this._emit('change', this._currentState, previousState);

        // If the final state name has changed in the process, inform the user
        // This happens if the final state is changed (tipically because of default state translations)
        if (false && tmp === this._currentState && fullName !== this._currentState.getFullName()) {
            console.info('Final state after transition is "' + this._currentState.getFullName() + '".');
        }
    };

    /**
     * Handles the address change event.
     *
     * @param {Object} obj The address object containing the change details
     */
    StateRegistry.prototype._onChange = function (obj) {
        var x,
            value = obj.newValue,
            length,
            route,
            state,
            params;

        // Ensure that the value starts with a /
        if (!startsWith(value, '/')) {
            value = '/' + value;
        }

        // Ignore if the URL is the same
        // This can happen because calls to address.setValue() from this class
        // generate a change event (internal)
        if (this._currentUrl === value) {
            return;
        }

        this._currentUrl = value;

        // Find if there's a matching route for the new address value
        length = this._routes.length;
        for (x = 0; x < length; x += 1) {
            route = this._routes[x];

            // Test the route against the value
            if (route.test(value)) {
                // Create the state instance
                state = this._createStateInstance(route.getName(), route.match(value));
                params = state.getParams();
                params.$info = {};

                // Associate the address info to the params
                if (obj.event) {
                    obj = mixIn({}, obj);
                    delete obj.event;       // Delete the event to avoid memory leaks
                }
                params.$info.address = obj;

                // Finally change to the state
                this.setCurrent(state);
                return;
            }
        }

        if (false) {
            console.warn('No state matched the URL "' + value + '".');
        }
    };

    /**
     * Handles the click event on links.
     *
     * @param {Event}   event The click event
     * @param {Element} [el]  The link tag
     */
    StateRegistry.prototype._handleLinkClick = function (event, el) {
        var element = el || event.currentTarget,
            type = element.getAttribute('data-url-type'),
            url = element.href,
            state,
            params,
            pos,
            options;

        // Only parse links with state protocol
        if (startsWith(url, 'state://')) {
            event.preventDefault();

            // If the link is internal, then we just prevent default behaviour
            if (type !== 'internal') {
                pos = url.lastIndexOf('/');
                // Extract the name and the params
                if (pos === -1) {
                    state = url.substr(8);
                } else {
                    state = url.substring(8, pos);
                    params = decode(url.substr(pos + 1));
                }

                // Extract options from attributes
                options = {
                    force: element.getAttribute('data-url-force') === 'true'
                    // No need to parse route and replace options here because they will be always false
                };

                this.setCurrent(state, params, options);
            } else if (false) {
                console.info('Link poiting to state "' + state + '" is flagged as internal and as such event#preventDefault() was called on the event.');
            }
        }
    };

    /**
     * Releases any listeners and resources.
     * This method is called only once after a destroy several call.
     *
     * @see StateRegistry#destroy
     */
    StateRegistry.prototype._onDestroy = function () {
        this.unregisterAll();
        this.off();

        $(document.body).off('click', 'a', this._handleLinkClick);

        this.unsetAddress();
        this._currentState = this._currenUrl = null;
    };

    return StateRegistry;
});

define('../app/config/states',[],function () {

    

    return {
        //home: '/',
        api: {
            topic: '/{name}'
        },
        guide: {
            $pattern: '/',
            topic: '/{name}'
        }
    };
});

define('../app/config/config',['./states'], function (states) {

    

    // This is the base configuration file
    // Define the framework options here as well as application specific ones

    return {
        // Address configuration
        address: {
            basePath: '/',
            html5: false,     // Disable HTML5 address because it needs the correct base path and mod rewrite activated
            translate: true   // Translate from HTML5 URLs to hash automatically (and vice-versa)
        },

        // State configuration
        state: {
            routing: true,  // Enable or disable routing (even with the routing disabled the application will work as expected)
            states: states  // States are imported from another file
        }
    };
});
define('mout/lang/isObject',['./isKind'], function (isKind) {
    /**
     */
    function isObject(val) {
        return isKind(val, 'Object');
    }
    return isObject;
});

define('mout/object/merge',['./hasOwn', '../lang/deepClone', '../lang/isObject'], function (hasOwn, deepClone, isObject) {

    /**
     * Deep merge objects.
     */
    function merge() {
        var i = 1,
            key, val, obj, target;

        // make sure we don't modify source element and it's properties
        // objects are passed by reference
        target = deepClone( arguments[0] );

        while (obj = arguments[i++]) {
            for (key in obj) {
                if ( ! hasOwn(obj, key) ) {
                    continue;
                }

                val = obj[key];

                if ( isObject(val) && isObject(target[key]) ){
                    // inception, deep merge objects
                    target[key] = merge(target[key], val);
                } else {
                    // make sure arrays, regexp, date, objects are cloned
                    target[key] = deepClone(val);
                }

            }
        }

        return target;
    }

    return merge;

});

define('../app/config/config_prod',['./config', 'mout/object/merge'], function (config, merge) {

    

    return merge(config, {
        env: 'prod',
        version: 1,

        // Address overrides
        address: {
            html5: true         // Setup prettier URLs by enabling HTML5
                                // If changed to true, the server needs to be able to rewrite URLs to the front controller
        }
    });
});

define('address/util/mixIn',[],function () {

    

    /**
     * Copies properies from an object to another.
     *
     * @param  {Object} target The target object
     * @param  {[type]} origin The object to copy from
     *
     * @return {Object} The target object
     */
    function mixIn(target, origin) {
        var key;

        for (key in origin) {
            target[key] = origin[key];
        }

        return target;
    }

    return mixIn;
});
/*jshint regexp:false*/

/**
 * Address.
 * This class serves as a base for both hash and html5 implementations.
 * Those simply need to implement the abstract functions to work correctly.
 *
 * This class also handles the clicks in the link tags (<a> tags).
 * If a link is meant to be a regular link, use the data-url-type="external".
 * If a link is mean to be an internal link but not handled by this address use data-url-type="internal".
 * Please note that links with target!="_self" and external urls are in general automatically ignored.
 * There is also a data-url-force option. When set to true, the value will be changed even if its the current one.
 */
define('address/Address',[
    'events-emitter/MixableEventsEmitter',
    'has',
    'jquery',
    './util/mixIn'
], function (MixableEventsEmitter, has, $, mixIn) {

    

    /**
     * Constructor.
     *
     * @param {Object} [options] The options
     */
    function Address(options) {
        var isCompatible = this.constructor.isCompatible || Address.isCompatible;

        this._enabled = true;

        if (!isCompatible.call(this.constructor))  {
            throw new Error('Address is not supported in this browser.');
        }

        // handleLinks can also be a string to handle only certain links (if the function returns true for the given url, then it will be handled)
        this._options = mixIn({ handleLinks: true }, options || {});

        // Cache the location scheme + userinfo + host + port
        this._locationSuhp = this._extractSuhpFromUrl(location.href);

        // Grab the current value
        this._value = this._readValue();

        // Replace all functions that need to be bound
        this._handleLinkClick = this._handleLinkClick.bind(this);

        // Listen to clicks in links
        if (this._options.handleLinks) {
            $(document.body).on('click', 'a', this._handleLinkClick);
        }

        if (false) {
            console.info('Initial address value: ' + this._value);
        }
    }

    mixIn(Address.prototype, MixableEventsEmitter.prototype);

    /**
     * Enables the address.
     *
     * @return {Address} The instance itself to allow chaining
     */
    Address.prototype.enable = function () {
        if (!this._enabled) {
            this._enabled = true;
            this._emit('enable');
        }

        return this;
    };

    /**
     * Disables the address.
     *
     * @return {Address} The instance itself to allow chaining
     */
    Address.prototype.disable = function () {
        if (this._enabled) {
            this._enabled = false;
            this._emit('disable');
        }

        return this;
    };

    /**
     * Returns the current address value.
     *
     * @param {String} [value] A value to be used instead of the address bar value
     *
     * @return {String} The current value
     */
    Address.prototype.getValue = function (value) {
        return value != null ? this._readValue(value) : this._value;
    };

    /**
     * Sets the address value.
     * If the resource changed, the change event will be fired (with type internal).
     *
     * The default implementation should handle these options:
     *  - force:  true to force the value to be changed even if the value is the same
     *  - silent: true to change the value with firing the change event
     *  - replace: true to replace the latest history entry instead of appending
     *
     * @param {String} value     The value to be set
     * @param {Object} [options] The options
     *
     * @return {Address} The instance itself to allow chaining
     */
    Address.prototype.setValue = function (value, options) {
        if (this._enabled) {
            var oldValue;

            options = options || {};

            if (this._value !== value || options.force) {
                oldValue = this._value;
                this._value = value;
                this._writeValue(value, options.replace);
                if (!options.silent) {
                    this._fireInternalChange(value, oldValue);
                }
            }
        }

        return this;
    };

    /**
     * Resets the internal state of address.
     * Clears the internal value and any other state.
     *
     * @return {Address} The instance itself to allow chaining
     */
    Address.prototype.reset = function () {
        this._value = null;

        return this;
    };

    /**
     * Generates an URL based on a given value.
     * By default the generated URL will be relative unless absolute is true.
     *
     * @param {String}  value      The value.
     * @param {Boolean} [absolute] True to generate an absolute URL, false otherwise (defaults to false)
     *
     * @return {String} The generated URL
     */
    Address.prototype.generateUrl = function (value, absolute) {
        throw new Error('This method must be implemented.');
    };

    /**
     * Destroys the instance.
     */
    Address.prototype.destroy = function () {
        if (!this._destroyed) {
            this._onDestroy();
            this._destroyed = true;
        }
    };

    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * Checks if a given URL is absolute.
     *
     * @param {String} url The url to check
     *
     * @return {Boolean} True if it's absolute, false otherwise
     */
    Address.prototype._isAbsoluteUrl = function (url) {
        var regExp = this.constructor._isAbsoluteUrlRegExp || Address._isAbsoluteUrlRegExp;

        return regExp.test(url);
    };

    /**
     * Extracts the scheme + userinfo + hostname + port from an URL
     *
     * @param {String} url The url to parse
     *
     * @return {String} The URL 'suhp' part or null if it is invalid
     */
    Address.prototype._extractSuhpFromUrl = function (url) {
        var regExp = this.constructor._urlParserRegExp || Address._urlParserRegExp,
            matches = regExp.exec(url), // see: https://gist.github.com/2428561
            shup = matches[3];

        shup = matches[3];

        return shup && shup.length ? shup : null;
    };

    /**
     * Checks if a given URL can be handled internally.
     * Returns false for relative URLs.
     * For absolute URLs, returns true if the scheme + userinfo + hostname + port is the same as the browser.
     * Subclasses might need to override this method.
     *
     * @return {Boolean} True if it is external, false otherwise
     */
    Address.prototype._isInternalUrl = function (url) {
        // We first check if the URL is absolute because the _extractSuhpFromUrl function is somewhat slower
        // So if an URL is absolute we do not need to run it
        return !this._isAbsoluteUrl(url) || this._extractSuhpFromUrl(url) === this._locationSuhp;
    };

    /**
     * Checks if a given URL belongs to another scheme, other than the http(s) one.
     *
     * @param {String} url The URL
     *
     * @return {Boolean} True if is, false otherwise
     */
    Address.prototype._isOtherScheme = function (url) {
        var pos = url.indexOf('://'),
            scheme;

        if (pos === -1) {
            return false;
        }

        scheme = url.substr(0, pos);

        return scheme !== 'http' && scheme !== 'https';
    };

    /**
     * Function to be invoked when a new value needs to be handled due to an external event.
     */
    Address.prototype._onNewValueByExternalEvent = function () {
        if (this._enabled) {
            var value = this._readValue(),
                oldValue = this._value;

            if (this._value !== value) {
                this._value = value;
                this._fireExternalChange(value, oldValue);
            }
        }
    };

    /**
     * Function to be invoked when a new value needs to be handled due to an link click.
     * Suppresses the normal link behaviour if handled.
     *
     * @param {String}  value     The value
     * @param {Object}  event     The event
     * @param {Boolean} [options] True to force the change even if the value is the same
     */
    Address.prototype._onNewValueByLinkClick = function (value, event, options) {
        if (this._enabled) {
            var oldValue;

            options = options || {};

            if (this._isInternalUrl(value)) {
                event.preventDefault();

                value = this._readValue(value);
                if (this._value !== value || options.force) {
                    oldValue = this._value;
                    this._value = value;
                    this._writeValue(value, options.replace);

                    if (!options.silent) {
                        this._fireLinkChange(value, oldValue, event);
                    }
                }
            } else if (false) {
                console.info('Link poiting to "' + value + '" was automatically interpreted as external.');
            }
        }
    };

    /**
     * Handles the click event on links.
     *
     * @param {Event}   event The click event
     * @param {Element} [el]  The link tag
     */
    Address.prototype._handleLinkClick = function (event, el) {
        var element = el || event.currentTarget,
            type = element.getAttribute('data-url-type'),
            ctrlKey = event.ctrlKey || event.metaKey,
            target = element.target,
            url =  element.href,
            options;

        if (!this._isOtherScheme(url)) {
            // Ignore the event if control is pressed
            // Ignore if the link specifies a target different than self
            // Ignore if the link rel attribute is internal or external
            if (!ctrlKey && (!target || target === '_self') && type !== 'external') {
                // If the link is internal, then we just prevent default behaviour
                if (type === 'internal') {
                    event.preventDefault();
                    if (false) {
                        console.info('Link poiting to "' + url + '" is flagged as internal and as such event#preventDefault() was called on the event.');
                    }
                } else {
                    // Extract options from attributes
                    options = {
                        force: element.getAttribute('data-url-force') === 'true',
                        replace: element.getAttribute('data-url-replace') === 'true',
                        silent: element.getAttribute('data-url-silent') === 'true'
                    };

                    // Handle the link click
                    this._onNewValueByLinkClick(url, event, options);
                }
            } else if (false && url) {
                console.info('Link poiting to "' + url + '" was ignored.');
            }
        }
    };

    /**
     * Fires a change event with type internal.
     *
     * @param {String} value    The current value
     * @param {String} oldValue The old value
     */
    Address.prototype._fireInternalChange = function (value, oldValue) {
        if (false) {
            console.info('Value changed to ' + value + ' (internally)');
        }

        this._emit('change', {
            newValue: value,
            oldValue: oldValue,
            type: 'internal'
        });
    };

    /**
     * Fires a change event with type external.
     *
     * @param {String} value    The current value
     * @param {String} oldValue The old value
     */
    Address.prototype._fireExternalChange = function (value, oldValue) {
        if (false) {
            console.info('Value changed to ' + value + ' (externally)');
        }

        this._emit('change', {
            newValue: value,
            oldValue: oldValue,
            type: 'external'
        });
    };

    /**
     * Fires a change event with type link.
     *
     * @param {String} value    The current value
     * @param {String} oldValue The old value
     * @param {Event}  event    The DOM event that cause the change
     */
    Address.prototype._fireLinkChange = function (value, oldValue, event) {
        if (false) {
            console.info('Value changed to ' + value + ' (link)');
        }

        this._emit('change', {
            newValue: value,
            oldValue: oldValue,
            type: 'link',
            event: event
        });
    };

    /**
     * Releases any listeners and resources.
     * This method is called only once after a destroy several call.
     *
     * @see Address#destroy
     */
    Address.prototype._onDestroy = function () {
        // Remove links listener
        $(document.body).off('click', 'a', this._handleLinkClick);

        // Clear the listeners
        this.off();
    };

    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * Reads and returns the current extracted value of the browser address URL.
     *
     * @param {String} [path] The path to be used instead of the browser address URL (can be a full url or a relative on)
     *
     * @return {String} The extracted value
     */
    Address.prototype._readValue = function (path) {
        throw new Error('This method must be implemented.');
    };

    /**
     * Writes a value to the browser address bar.
     * The value passed will generate and apply a new URL to the browser address bar.
     *
     * @param {String}  value     The value to be set
     * @param {Boolean} [replace] True to replace the last history entry, false otherwise
     */
    Address.prototype._writeValue = function (value, replace) {
        throw new Error('This method must be implemented.');
    };

    /////////////////////////////////////////////////////////////////////////////////////

    Address._isAbsoluteUrlRegExp = /^[a-z]{1,7}:\/\//i;
    Address._urlParserRegExp = /^(((([^:\/#\?]+:)?(?:(\/\/)((?:(([^:@\/#\?]+)(?:\:([^:@\/#\?]+))?)@)?(([^:\/#\?\]\[]+|\[[^\/\]@#?]+\])(?:\:([0-9]+))?))?)?)?((\/?(?:[^\/\?#]+\/+)*)([^\?#]*)))?(\?[^#]+)?)(#.*)?/;

    Address.isCompatible = function () {
        throw new Error('This method must be implemented.');
    };

    return Address;
});

/**
 * AddressHash.
 */
define('address/AddressHash',[
    './Address',
    'jquery'
], function (Address, $) {

    

    /**
     * {@inheritDoc}
     */
    function AddressHash(options) {
        Address.call(this, options);

        // Replace all functions that need to be bound
        this._onNewValueByExternalEvent = this._onNewValueByExternalEvent.bind(this);

        $(window).on('hashchange', this._onNewValueByExternalEvent);
    }

    AddressHash.prototype = Object.create(Address.prototype);
    AddressHash.prototype.constructor = AddressHash;

    /**
     * {@inheritDoc}
     */
    AddressHash.prototype.generateUrl = function (value, absolute) {
        // The relative URL does not need to include the location.pathname to work, so we skip it
        // All the relative URLs start with #
        var ret = '#' + this._encodeValue(value);

        return absolute ? this._locationSuhp + location.pathname + ret : ret;
    };

    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * {@inheritDoc}
     */
    AddressHash.prototype._readValue = function (path) {
        var hash = path || location.href,
            pos = hash.indexOf('#'),
            ret;

        hash = pos !== -1 ? hash.substr(pos + 1) : '';

        ret = decodeURIComponent(hash);
        ret = ret.replace(/%27/g, '\'');    // This replacement is a workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=407172

        return ret;
    };

    /**
     * {@inheritDoc}
     */
    AddressHash.prototype._writeValue = function (value, replace) {
        value = '#' + this._encodeValue(value);

        if (replace) {
            location.replace(value);
        } else {
            location.href = value;
        }
    };

    /**
     * Encodes the passed value to be safelly used.
     *
     * @param  {String} value The value to be encoded
     *
     * @return {String} The encoded value
     */
    AddressHash.prototype._encodeValue = function (value) {
        // Use encodeURI because its similar to encodeURIComponent but preserves some chars (without breaking) and prevents a bug in Safari
        value = encodeURI(value);

        // Encode the # because encodeURI does not handle it
        // This is actually only needed in IE and Opera, but we do it in every browser
        value = value.replace(/#/g, '%23');

        return value;
    };

    /**
     * {@inheritDoc}
     */
    AddressHash.prototype._isOtherScheme = function (url) {
        return url.charAt(0) === '#' ? false : Address.prototype._isOtherScheme.call(this, url);
    };

    /**
     * {@inheritDoc}
     */
    AddressHash.prototype._onDestroy = function () {
        $(window).off('hashchange', this._onNewValueByExternalEvent);

        AddressHash._instance = null;
        Address.prototype._onDestroy.call(this);
    };

    /////////////////////////////////////////////////////////////////////////////////////

    AddressHash._instance = null;

    /**
     * {@inheritDoc}
     */
    AddressHash.isCompatible = function () {
        // When IE8 is rendering with IE7 mode, it reports has having the event but it does not fire it!
        // Also IE in file protocol totally messes up when back & forward are clicked
        var docMode = document.documentMode;

        return ('onhashchange' in window && (docMode == null || docMode > 7) &&
               (navigator.userAgent.indexOf('MSIE') === -1 || location.protocol !== 'file:'));
    };

    /**
     * Creates a new instance of returns the current initialized  one.
     *
     * @param {Object} $options The options
     *
     * @return {AddressHash} The address
     */
    AddressHash.getInstance = function (options) {
        if (!AddressHash._instance) {
            AddressHash._instance = new AddressHash(options);
        }


        return AddressHash._instance;
    };

    return AddressHash;
});

define('address/util/startsWith',[],function () {

    

    /**
     * Verifies if a string starts with another.
     *
     * @param  {String} str    The string that will be checked
     * @param  {String} prefix The prefix to check
     *
     * @return {Boolean} True if it starts, false otherwise
     */
    function startsWith(str, prefix) {
        str = (str || '');
        prefix = (prefix || '');

        return str.indexOf(prefix) === 0;
    }

    return startsWith;
});
define('address/util/browser',[],function () {

    

    // This piece of code was copied from jquery-migrate

    function uaMatch(ua) {
        ua = ua.toLowerCase();

        var match = /(chrome)[ \/]([\w.]+)/.exec(ua) ||
            /(webkit)[ \/]([\w.]+)/.exec(ua) ||
            /(opera)(?:.*version|)[ \/]([\w.]+)/.exec(ua) ||
            /(msie) ([\w.]+)/.exec(ua) ||
            ua.indexOf('compatible') < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec(ua) ||
            [];

        return {
            browser: match[1] || '',
            version: match[2] || '0'
        };
    }

    var matched = uaMatch(navigator.userAgent),
        browser = {};

    if (matched.browser) {
        browser[matched.browser] = true;
        browser.version = matched.version;
    }

    // Chrome is Webkit, but Webkit is also Safari.
    if (browser.chrome) {
        browser.webkit = true;
    } else if (browser.webkit) {
        browser.safari = true;
    }

    return browser;
});
/**
 * AddressHTML5.
 */
define('address/AddressHTML5',[
    './Address',
    'jquery',
    './util/mixIn',
    './util/startsWith',
    './util/browser'
], function (Address, $, mixIn, startsWith, browser) {

    

    var emptyObj = {},
        emptyStr = '';

    /**
     * {@inheritDoc}
     */
    function AddressHTML5(options) {
        // Merge the options
        options = mixIn({ basePath: location.pathname + '/' }, options || {});

        // Prevent "The option is insecure" issue because values can't start with //
        // Also ensure that it starts with an /
        // Encode it to be valid in the comparisons because it can contain special chars
        this._basePath = this._encodeValue(options.basePath);
        this._basePath = '/' + this._trimLeadingSlashes(this._basePath);
        this._basePath = this._trimTrailingSlashes(this._basePath) + '/';

        this._baseElement = document.getElementsByTagName('base');

        Address.call(this, options);

        // Replace all functions that need to be bound
        this._onNewValueByExternalEvent = this._onNewValueByExternalEvent.bind(this);

        $(window).on('popstate', this._onNewValueByExternalEvent);
    }

    AddressHTML5.prototype = Object.create(Address.prototype);
    AddressHTML5.prototype.constructor = AddressHTML5;

    /**
     * {@inheritDoc}
     */
    AddressHTML5.prototype.setValue = function (value, absolute) {
        value = this._trimLeadingSlashes(value);

        return Address.prototype.setValue.call(this, value, absolute);
    };

    /**
     * {@inheritDoc}
     */
    AddressHTML5.prototype.generateUrl = function (value, absolute) {
        var ret = this._basePath + this._encodeValue(this._trimLeadingSlashes(value));

        return absolute ? this._locationSuhp + ret : ret;
    };

    /////////////////////////////////////////////////////////////////////////////////////

    /**
     * Trim starting slashes.
     *
     * @param {String} value The value to trim
     *
     * @return {String} The trimmed value
     */
    AddressHTML5.prototype._trimLeadingSlashes = function (value) {
        return value.replace(/^\/*/, '');
    };

    /**
     * Trim trailing slashes.
     *
     * @param {String} value The value to trim
     *
     * @return {String} The trimmed value
     */
    AddressHTML5.prototype._trimTrailingSlashes = function (value) {
        return value.replace(/\/*$/, '');
    };

    /**
     * {@inheritDoc}
     */
    AddressHTML5.prototype._isInternalUrl = function (url) {
        var ret = Address.prototype._isInternalUrl.call(this, url);

        if (ret) {
            // If is absolute, remove suhp part
            if (this._isAbsoluteUrl(url)) {
                url = url.substr(this._locationSuhp.length);
            }

            url = url.replace(/%27/g, '\'');    // This replacement is a workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=407172

            // Check if the URL starts with the full base path
            return startsWith(url, this._basePath);
        }

        return false;
    };

    /**
     * {@inheritDoc}
     */
    AddressHTML5.prototype._readValue = function (path) {
        var basePos,
            tmp,
            parsedPath;

        // If a value is passed we need to take care of it specially
        if (path) {
            // If it is an absolute URL, we need to ensure that it can be handled
            // If so, we remove the scheme + userinfo + hostname + port from the value
            if (this._isAbsoluteUrl(path)) {
                tmp = this._extractSuhpFromUrl(path);
                if (!tmp) {
                    throw new Error('Unable to parse URL: ' + path);
                }

                if (tmp !== this._locationSuhp) {
                    throw new Error('Can\'t parse external URL: ' + path);
                }
                parsedPath = path.substr(this._locationSuhp.length);
            } else {
                parsedPath = path;
            }
        } else {
            // Otherwise we assume the value from the browser URL
            // Note that we can't use location.pathname because Opera returns the value unencoded, so we use href and extract the initial part
            parsedPath = location.href.substr(this._locationSuhp.length);
        }

        parsedPath = parsedPath.replace(/%27/g, '\'');    // This replacement is a workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=407172

        // Extract the portion after the full base path
        basePos = parsedPath.indexOf(this._basePath);
        if (basePos !== -1) {
            parsedPath = parsedPath.substr(basePos + this._basePath.length);
        } else {
            throw new Error('Can\'t parse external URL: ' + (path || location.href));
        }

        // Remove the portion after ? if any
        tmp = parsedPath.indexOf('?');
        if (tmp !== -1) {
            parsedPath = parsedPath.substr(0, tmp);
        } else {
            // Remove the portion after # if any
            tmp = parsedPath.indexOf('#');
            if (tmp !== -1) {
                parsedPath = parsedPath.substr(0, tmp);
            }
        }

        return decodeURIComponent(parsedPath);
    };

    /**
     * {@inheritDoc}
     */
    AddressHTML5.prototype._writeValue = function (value, replace) {
        var path = this._basePath + this._encodeValue(value);

        if (replace) {
            history.replaceState(emptyObj, emptyStr, path);
        } else {
            history.pushState(emptyObj, emptyStr, path);

            // Fix a weird Opera bug (http://my.opera.com/community/forums/topic.dml?id=1185462)
            this._baseElement.href = this._baseElement.href;
        }
    };

    /**
     * Encodes the passed value to be safelly used.
     *
     * @param  {String} value The value to be encoded
     *
     * @return {String} The encoded value
     */
    AddressHTML5.prototype._encodeValue = function (value) {
        // Use encodeURI because its similar to encodeURIComponent but preserves some chars (without breaking) and prevents a bug in Safari
        value = encodeURI(value);

        // Some chars needs to be converted separately because encodeURI ignores it
        value = value.replace(/#/g, '%23');
        value = value.replace(/\?/g, '%3F');

        return value;
    };

    /**
     * {@inheritDoc}
     */
    AddressHTML5.prototype._onDestroy = function () {
        $(window).off('popstate', this._onNewValueByExternalEvent);

        AddressHTML5._instance = null;
        Address.prototype._onDestroy.call(this);
    };

    /////////////////////////////////////////////////////////////////////////////////////

    AddressHTML5._instance = null;

    /**
     * {@inheritDoc}
     */
    AddressHTML5.isCompatible = function () {
        var userAgent = navigator.userAgent.toLowerCase(),
            android = parseInt((/android (\d+)/.exec(userAgent) || [])[1], 10),
            safari = browser.webkit && !window.chrome && parseInt(browser.version, 10);

        // Android < 4 does not handle pushState correctly (http://code.google.com/p/android/issues/detail?id=17471)
        // There is quite few browsers for android besides the stock one but we disable it anyway

        // Safari < 6 has horrible problems with pushState
        // - e.g.: location.href returns the decoded value instead of the value we used in the pushState
        // - e.g.: not firing popstate on network busy

        // The same applies to PhantomJS (http://code.google.com/p/phantomjs/issues/detail?can=2&start=0&num=100&q=&colspec=ID%20Type%20Status%20Priority%20Milestone%20Owner%20Summary&groupby=&sort=&id=833)
        // Keep an eye on the link above; once the issue is fixed in PhantomJS, the code below might need to be adjusted

        // The file protocol is not supported so we return false for it.

        return window.history && !!history.pushState &&
               location.protocol !== 'file:' &&
               userAgent.indexOf('phantomjs') === -1 &&
               !(android && android < 4) &&
               !(safari && safari < 6);
    };

    /**
     * Creates a new instance of returns the current initialized  one.
     *
     * @param {Object} options The options
     *
     * @return {AddressHash} The address
     */
    AddressHTML5.getInstance = function (options) {
        if (!AddressHTML5._instance) {
            AddressHTML5._instance = new AddressHTML5(options);
        }

        return AddressHTML5._instance;
    };

    return AddressHTML5;
});
define('mout/string/endsWith',['../lang/toString'], function(toString) {
    /**
     * Checks if string ends with specified suffix.
     */
    function endsWith(str, suffix) {
        str = toString(str);
        suffix = toString(suffix);

        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    return endsWith;
});

/*jshint regexp:false, eqeqeq:false*/

/**
 * Address factory.
 * This factory instantiates either the hash or html5 address according to the browser and the configuration.
 * This class provides access to the address as a service.
 */
define('../bower_components/spoonjs/src/core/Address/AddressFactory',[
    'app-config',
    'address/AddressHash',
    'address/AddressHTML5',
    'mout/string/startsWith',
    'mout/string/endsWith',
    'has'
], function (config, AddressHash, AddressHTML5, startsWith, endsWith, has) {

    

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
            if (false) {
                console.warn('No address compatible with the current browser.');
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

define('mout/object/fillIn',['../array/forEach', './forOwn'], function (forEach, forOwn) {

    /**
     * Copy missing properties in the obj from the defaults.
     */
    function fillIn(obj, var_defaults){
        forEach(Array.prototype.slice.call(arguments, 1), function(base){
            forOwn(base, function(val, key){
                if (obj[key] == null) {
                    obj[key] = val;
                }
            });
        });
        return obj;
    }

    return fillIn;

});

define('mout/object/size',['./forOwn'], function (forOwn) {

    /**
     * Get object size
     */
    function size(obj) {
        var count = 0;
        forOwn(obj, function(){
            count++;
        });
        return count;
    }

    return size;

});

define('mout/array/sort',[],function () {

    /**
     * Merge sort (http://en.wikipedia.org/wiki/Merge_sort)
     */
    function mergeSort(arr, compareFn) {
        if (arr == null) {
            return [];
        } else if (arr.length < 2) {
            return arr;
        }

        if (compareFn == null) {
            compareFn = defaultCompare;
        }

        var mid, left, right;

        mid   = ~~(arr.length / 2);
        left  = mergeSort( arr.slice(0, mid), compareFn );
        right = mergeSort( arr.slice(mid, arr.length), compareFn );

        return merge(left, right, compareFn);
    }

    function defaultCompare(a, b) {
        return a < b ? -1 : (a > b? 1 : 0);
    }

    function merge(left, right, compareFn) {
        var result = [];

        while (left.length && right.length) {
            if (compareFn(left[0], right[0]) <= 0) {
                // if 0 it should preserve same order (stable)
                result.push(left.shift());
            } else {
                result.push(right.shift());
            }
        }

        if (left.length) {
            result.push.apply(result, left);
        }

        if (right.length) {
            result.push.apply(result, right);
        }

        return result;
    }

    return mergeSort;

});

/*jshint regexp:false */

/**
 * StateRegistry factory.
 * This factory might return null if the routing is disabled (by the config or if the address is not compatible with the browser).
 * This class provides access to the state registry as a service.
 */
define('../bower_components/spoonjs/src/core/StateRegistry/StateRegistryFactory',[
    './StateRegistry',
    'services/address',
    'app-config',
    'mout/lang/isObject',
    'mout/object/fillIn',
    'mout/object/size',
    'mout/array/sort',
    'has'
], function (StateRegistry, address, config, isObject, fillIn, size, sort, has) {

    

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

                queue.push(value);
            // String -> state has a route
            } else if (typeof value === 'string') {
                // Add to the array to be sorted later
                arr.push({
                    state: curr.$state ? curr.$state + '.' + key : key,
                    pattern: patternJoin(curr.$pattern, value),
                    constraints: curr.$constraints,
                    priority: curr.$priority || 0
                });
            } else if (false) {
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
    // We use mout's sort because it's stable!
    sort(arr, function (val1, val2) {
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

define('mout/object/pick',[],function(){

    /**
     * Return a copy of the object, filtered to only have values for the whitelisted keys.
     */
    function pick(obj, var_keys){
        var keys = typeof arguments[1] !== 'string'? arguments[1] : Array.prototype.slice.call(arguments, 1),
            out = {},
            i = 0, key;
        while (key = keys[i++]) {
            out[key] = obj[key];
        }
        return out;
    }

    return pick;

});

define('mout/array/findIndex',['../function/makeIterator_'], function (makeIterator) {

    /**
     * Returns the index of the first item that matches criteria
     */
    function findIndex(arr, iterator, thisObj){
        iterator = makeIterator(iterator, thisObj);
        if (arr == null) {
            return -1;
        }

        var i = -1, len = arr.length;
        while (++i < len) {
            if (iterator(arr[i], i, arr)) {
                return i;
            }
        }

        return -1;
    }

    return findIndex;
});

define('mout/array/find',['./findIndex'], function (findIndex) {

    /**
     * Returns first item that matches criteria
     */
    function find(arr, iterator, thisObj){
        var idx = findIndex(arr, iterator, thisObj);
        return idx >= 0? arr[idx] : void(0);
    }

    return find;

});

/*jshint regexp:false*/

/**
 * Controller abstract class.
 */
define('../bower_components/spoonjs/src/core/Controller',[
    './Joint',
    'services/state',
    'mout/string/startsWith',
    'mout/object/size',
    'mout/object/pick',
    'mout/object/mixIn',
    'mout/array/find',
    'has'
], function (Joint, stateRegistry, startsWith, size, pick, mixIn, find, has) {

    

    /**
     * Constructor.
     */
    function Controller() {
        Joint.call(this);

        this._parseStates();
    }

    Controller.extend = Joint.extend;
    Controller.prototype = Object.create(Joint.prototype);
    Controller.prototype.constructor = Controller;

    /**
     * Get the current state or null if none is set.
     *
     * @return {State} The state
     */
    Controller.prototype.getState = function () {
        return this._currentState;
    };

    /**
     * Generates an URL for a state.
     *
     * @param {String} name     The state name
     * @param {Object} [params] The state params
     *
     * @return {String} The generated URL
     */
    Controller.prototype.generateUrl = function (name, params) {
        var state;

        // Resolve the state
        state = this._resolveFullState(name);
        mixIn(state.params, params);

        return stateRegistry.generateUrl(state.fullName, state.params);
    };

    /**
     * Sets the current state.
     * If the state is the same, nothing happens.
     *
     * @param {String} [name]    The state name
     * @param {Object} [params]  The state params
     * @param {Object} [options] The options
     *
     * @return {Controller} The instance itself to allow chaining
     */
    Controller.prototype.setState = function (name, params, options) {
        var state;

        // Resolve the state
        state = this._resolveFullState(name);
        mixIn(state.params, params);

        // If the state is global, simply set it on the state registry
        if (state.name == null) {
            stateRegistry.setCurrent(state.fullName, state.params, options);
            return this;
        }

        // At this point the state is local
        // Check if the state is globally registered
        if (stateRegistry.isRegistered(state.fullName)) {
            // If so attempt to change the global state, aborting if it succeeded
            if (stateRegistry.setCurrent(state.fullName, state.params, options)) {
                return this;
            }

            // Since the global state is equal, grab it to avoid creating unnecessary
            // state objects.
            state = stateRegistry.getCurrent();
        } else {
            state = stateRegistry._createStateInstance(state.name, state.params);
        }

        return this.delegateState(state);
    };

    /**
     * Delegates a state to be handled by the controller.
     *
     * @param {Object|State} state The state parameter bag or a state instance
     *
     * @return {Controller} The instance itself to allow chaining
     */
    Controller.prototype.delegateState = function (state) {
        var name;

        // Assume app state if not passed
        if (!state) {
            state = stateRegistry.getCurrent();
        }

        state = state && (state.$info ? state.$info.newState : state);
        name = state && state.getName() || this._defaultState;

        // If still has no name it means there's no default state defined
        if (!name) {
            if (false && this._nrStates) {
                console.warn('No default state defined in "' + this.$name + '".');
            }

            return;
        }

        // Check if state exists
        if (!this._states[name]) {
            if (false) {
                console.warn('Unknown state "' + name + '" on controller "' + this.$name + '".');
            }

            return;
        }

        // If the current state is not the same, transition to it
        if (!this._isSameState(state)) {
            this._performStateChange(state);
        // Otherwise propagate it to child controllers
        } else {
            this._propagateState(state);
        }

        // Sync up the full state name with the application one
        // This is needed because default states might have been translated down the chain
        if (stateRegistry.getCurrent() === state) {
            this._currentState.setFullName(state.getFullName());
        }

        return this;
    };

    //////////////////////////////////////////////////////////////////

    /**
     * Parses the controller states.
     */
    Controller.prototype._parseStates = function () {
        var key,
            func,
            matches,
            regExp = this.constructor._stateParamsRegExp || Controller._stateParamsRegExp,
            states = this._states;

        this._states = {};
        this._nrStates = size(this._states);

        // Process the states object
        for (key in states) {
            func = states[key];

            // Process the params specified in the parentheses
            matches = key.match(regExp);
            if (matches) {
                key = key.substr(0, key.indexOf('('));
                this._states[key] = {};

                // If user specified state(*), then the state changes every time
                // even if the params haven't changed
                if (matches[1] === '*') {
                    this._states[key].wildcard = true;
                } else {
                    this._states[key].params = matches[1].split(/\s*,\s*/);
                }
            } else {
                this._states[key] = {};
            }

            if (false) {
                if (!stateRegistry.isValid(key)) {
                    throw new Error('State name "' + key + '" of "' + this.$name + '" has an invalid format.');
                }
                if (key.indexOf('.') !== -1) {
                    throw new Error('State name "' + key + '" of "' + this.$name + '" must be local (cannot contain dots).');
                }
            }

            // Check if it is a string or already a function
            if (typeof func === 'string') {
                func = this[func];
                this._states[key].fn = func;
            }

            if (false && typeof func !== 'function') {
                throw new Error('State handler "' + key + '" of "' + this.$name + '" references a nonexistent function.');
            }

            this._states[key].fn = func;
            this._states[key].params = this._states[key].params || [];
        }

        // Process the default state
        if (false && this._defaultState && !this._states[this._defaultState]) {
            throw new Error('The default state of "' + this.$name + '" points to an nonexistent state.');
        }
    };


    /**
     * Resolves a full state name.
     *
     * If name starts with a / then state is absolute.
     * If name starts with ../ then state is relative.
     * If empty will try to map to the default state.
     * Otherwise the full state name will be resolved from the local name.
     *
     * @param {String} [name] The state name
     *
     * @return {Object} The full state name and params
     */
    Controller.prototype._resolveFullState = function (name) {
        var state,
            ancestor,
            ancestorState;

        name = name || '';

        // Absolute
        if (name.charAt(0) === '/') {
            return {
                fullName: name.substr(1),
                params: {}
            };
        }

        // Relative
        if (startsWith(name, '../')) {
            if (false && (!this._uplink || !(this._uplink instanceof Controller))) {
                throw new Error('Cannot resolve relative state "' + name + '" in "' + this.$name + '".');
            }

            state = this._uplink._resolveFullState(name.substr(3));
            delete state.name;  // Remove name because state is not local

            return state;
        }

        state = {
            name: name,
            fullName: name,
            params: {}
        };

        // Local
        ancestor = this._uplink;
        while (ancestor && ancestor instanceof Controller) {
            ancestorState = ancestor.getState();
            if (!ancestorState) {
                // Break here, the ancestor is not in any state
                break;
            }

            // Concatenate name & mix in relevant params
            state.fullName = ancestorState.getName() + (state.fullName ? '.' + state.fullName : '');
            mixIn(state.params, ancestor._currentStateParams);

            ancestor = ancestor._uplink;
        }

        // Ensure names
        state.name = state.name || this._defaultState || '';
        state.fullName = state.fullName || this._defaultState || '';

        return state;
    };

    /**
     * Checks if a given state is the same as the current controller state.
     *
     * @param {State} state The state
     *
     * @return {Boolean} True if the same, false otherwise
     */
    Controller.prototype._isSameState = function (state) {
        var stateMeta;

        if (!this._currentState) {
            return false;
        }

        // Translate to default state if name is empty
        if (!state.getName()) {
            state = state.clone();
            state.setFullName(state.getFullName() + '.' + this._defaultState);
        }

        stateMeta = this._states[state.getName()];

        // Check if state is a wildcard
        if (stateMeta.wildcard) {
            return false;
        }

        // Check if equal
        return this._currentState.isEqual(state, stateMeta.params);
    };

    /**
     * Sets the current state based on the passed in state.
     * Updates all the necessary properties used internally.
     *
     * @param {State} state The state
     */
    Controller.prototype._setCurrentState = function (state) {
        var name,
            fullName,
            stateMeta;

        // Update current state
        this._previousState = this._currentState;
        this._currentState = state.clone();

        // Resolve to default state always
        if (!state.getName() && this._defaultState) {
            fullName = state.getFullName() ? state.getFullName() + '.' + this._defaultState : this._defaultState;
            this._currentState.setFullName(fullName);

            // Update also the state registry one
            if (state === stateRegistry.getCurrent()) {
                state.setFullName(fullName);
            }
        }

        name = this._currentState.getName();
        stateMeta = this._states[name];

        // Update state params being used by this controller
        this._currentStateParams = pick(this._currentState.getParams(), stateMeta.params);
    };

    /**
     * Performs the state change, calling the state handler if any.
     *
     * @param {State} state The state
     */
    Controller.prototype._performStateChange = function (state) {
        var stateMeta;

        // Update internal state
        this._setCurrentState(state);

        // Advance pointer
        state.next();

        // Execute handler
        stateMeta = this._states[this._currentState.getName()];
        stateMeta.fn.call(this, state.getParams());
    };

    /**
     * Attempts to propagate the state to one of the downlinks.
     *
     * @param {State} state The state
     */
    Controller.prototype._propagateState = function (state) {
        var name,
            curr,
            length,
            x;

        // Update internal state
        this._setCurrentState(state);

        // Advance pointer
        state.next();

        // Find suitable child controller to handle the state
        name = state.getName();
        length = this._downlinks.length;

        for (x = 0; x < length; x += 1) {
            curr = this._downlinks[x];

            if (curr instanceof Controller) {
                if (curr._states[name] || (!name && curr._defaultState)) {
                    curr.delegateState(state);
                    return;
                }
            }
        }

        if (name && false) {
            console.warn('No child controller of "' + this.$name + '" declared the "' + name + '" state.');
        }
    };

    ////////////////////////////////////////////////////////////////

    Controller._stateParamsRegExp = /\((.+?)\)/;

    return Controller;
});

/*jshint regexp:false*/

define('../bower_components/spoonjs/src/util/createElement',['jquery'], function ($) {

    

    // We cache the regular expressions because they will be used a lot of times
    // The memory used by them compensates the fact they will not be created over an over again
    var tagNameRegexp = /^(\w+)/i,
        idRegexp = /\#([\w\-]+)/i,
        classNameRegexp = /\.([\w\-]+)/ig,
        trimSpacesRegexp = /\s*=\s*/g,
        attributesRegexp = /\[([a-z\-]+)=['"]([\w\-]+)['"]\]/ig;

    /**
     * Creates a new element based on a CSS selector.
     *
     * @param {String} selector The CSS selector
     *
     * @return {Element} The created element
     */
    function createFromSelector(selector) {
        var elTagName = selector.match(tagNameRegexp),
            elId = selector.match(idRegexp),
            elClassName,
            elAttributes,
            classNames = '',
            el;

        // Trim spaces after and before a equal sign
        selector = selector.replace(trimSpacesRegexp, '=');

        // If there is still spaces, then the CSS selector is not a valid one
        if (selector.indexOf(' ') !== -1) {
            throw new Error('No spaces are allowed in the CSS selector.');
        }

        // Parse tag name
        if (elTagName) {
            el = document.createElement(elTagName[1]);
        } else {
            el = document.createElement('div');
        }

        // Parse id
        if (elId) {
            el.id = elId[1];
        }

        // Parse class name
        while ((elClassName = classNameRegexp.exec(selector))) {
            classNames += elClassName[1] + ' ';
        }

        if (classNames) {
            el.className = classNames.substr(0, classNames.length - 1);
        }

        // Parse attributes
        while ((elAttributes = attributesRegexp.exec(selector))) {
            el.setAttribute(elAttributes[1], elAttributes[2]);
        }

        // Reset the regular expressions lastIndex flags
        classNameRegexp.lastIndex = attributesRegexp.lastIndex = 0;

        return el;
    }

    function createElement(source) {
        var element;

        if (typeof source === 'string') {
            if (source.charAt(0) === '<' && source.charAt(source.length - 1) === '>') {
                element = source;
            } else {
                element = createFromSelector(source);
            }
        } else {
            element = source;
        }

        return $(element);
    }

    return createElement;
});
/*global Handlebars*/

/**
 * View abstract class.
 */
define('../bower_components/spoonjs/src/core/View',[
    './Joint',
    './Controller',
    '../util/createElement',
    'services/state',
    'mout/object/mixIn',
    'mout/object/forOwn',
    'mout/lang/isArray',
    'mout/lang/isPlainObject',
    'has',
    'jquery'
], function (Joint, Controller, createElement, stateRegistry, mixIn, forOwn, isArray, isPlainObject, has, $) {

    

    /* Remove replacer to avoid memory leaks */
    function remove() {
        /*jshint validthis:true*/
        var view = this.data('_spoon_view');

        if (view) {
            view.destroy();
        }

        // Just to be sure
        $.fn.remove.call(this);
    }

    /**
     * Constructor.
     *
     * @param {Element} [element] The DOM element for the view
     */
    function View(element) {
        Joint.call(this);

        // Clone events object to guarantee unicity among instances
        this._events = this._events ? mixIn({}, this._events) : {};

        // Assume the element or create one based on the _element property
        this._element = $(element ? element : createElement(this._element || 'div'));
        this._nativeElement = this._element.get(0);

        // Replace remove function to avoid memory leaks if the user
        // removes the element via jquery
        this._element.data('_spoon_view', this);
        this._element.remove = remove;

        // Listen to events
        this._listen();
    }

    View.extend = Joint.extend;
    View.prototype = Object.create(Joint.prototype);
    View.prototype.constructor = View;

    /**
     * Returns the view's element.
     *
     * @return {Element} The view's element
     */
    View.prototype.getElement = function () {
        return this._element;
    };

    /**
     * Convenience method to append the element's view to a target.
     * The target can be another view, a DOM element or a CSS selector.
     * If the target is another view, an additional selector can be passed to specify
     * the element where it will get appended.
     *
     * @param {Element|String|View} target   The target
     * @param {String}              [within] The selector in case the target is a view
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.appendTo = function (target, within) {
        if (target) {
            if (target instanceof View) {
                target = !within ? target._element : target._element.find(within).eq(0);
            } else if (typeof target === 'string') {
                target = $(target).eq(0);
            } else {
                target = $(target);
            }

            target.append(this._element);
        }

        return this;
    };

    /**
     * Convenience method to prepend the element's view to a target.
     * The target can be another view, a DOM element or a CSS selector.
     * If the target is another view, an additional selector can be passed to specify
     * the element where it will get appended.
     *
     * @param {Element|String|View} target   The target
     * @param {String}              [within] The selector in case the target is a view
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.prependTo = function (target, within) {
        if (target) {
            if (target instanceof View) {
                target = !within ? target._element : target._element.find(within).eq(0);
            } else if (typeof target === 'string') {
                target = $(target).eq(0);
            } else {
                target = $(target);
            }

            target.append(this._element);
        }

        return this;
    };

    /**
     * Renders the declared template with the supplied data.
     *
     * @param {Object|Array} [data] The data to pass to the template
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.render = function (data) {
        if (this._template) {
            this.clear();

            if (false && typeof this._template !== 'function') {
                throw new Error('Expected _template to be a compiled template (function).');
            }

            this._element.html(this._template(this._fillHelpers(data || {})));
        }

        return this;
    };

    /**
     * Clears the view's element.
     * Note that you must explicitly call _unlisten() to remove the DOM event listeners.
     *
     * @return {View} The instance itself to allow chaining
     */
    View.prototype.clear = function () {
        var children = this._element.children();

        children.remove();
        this._element.innerHTML = '';

        return this;
    };

    View.fromElement = function (element) {
        return $(element).data('_spoon_view');
    };

    ////////////////////////////////////////////////////////////

    /**
     * Listen to events.
     *
     * @param {Object} events An object with the events
     *
     * @return {Object} The same object
     */
    View.prototype._listen = function (events) {
        var eventType,
            selector,
            matches,
            eventsSplitter = this.constructor._eventsSplitter || View._eventsSplitter,
            that = this;

        events = events || this._events;

        forOwn(events, function (fn, key) {
            // If string, lookup the method in the instance
            if (typeof fn === 'string') {
                fn = this[fn];
            }

            if (false && !fn) {
                throw new Error('Event handler for "' + key + '" references an unknown function.');
            }

            // Skip if already listening
            if (fn._listening) {
                return;
            }

            events[key] = function (event) {
                fn.call(that, event, $(this));
            };

            matches = key.match(eventsSplitter);
            eventType = matches[1];
            selector = matches[2];

            this._element.on(eventType, selector, events[key]);
        }, this);

        return events;
    };

    /**
     * Unlistens to events.
     *
     * @param {Object} events An object with the events
     *
     * @return {Object} The same object
     */
    View.prototype._unlisten = function (events) {
        var key,
            eventType,
            selector,
            matches,
            fn,
            eventsSplitter = this.constructor._eventsSplitter || View._eventsSplitter;

        events = events || this._events;

        for (key in events) {
            fn = this._events[key];

            if (false && !fn) {
                throw new Error('Event handler for "' + key + '" references an unknown function.');
            }

            if (!fn._listening) {
                continue;
            }

            delete fn._listening;

            matches = key.match(eventsSplitter);
            eventType = matches[1];
            selector = matches[2];

            this._element.off(eventType, selector, fn);
        }

        return events;
    };

    /**
     * Generates an URL.
     *
     * @param {String} state    The state name
     * @param {Object} [params] The state params
     *
     * @return {String} The generated URL
     */
    View.prototype._generateUrl = function (state, params) {
        var controller = this._getController();

        if (false && !controller) {
            throw new Error('Could not find the controller responsible for "' + this.$name + '".');
        }

        return controller.generateUrl(state, params);
    };

    /**
     * Get the controller responsible for the view.
     * The view will be interpreted as the function context, so call this method with .call(view).
     *
     * @return {Controller} The view's controller
     */
    View.prototype._getController = function () {
        var uplink;

        // Return the cached controller if any
        if (this._controller) {
            return this._controller;
        }

        // Search for it in the uplink ancestors
        uplink = this._uplink;
        while (uplink) {
            if (uplink instanceof Controller) {
                return uplink;
            }

            uplink = uplink._uplink;
        }

        return null;
    };

    /**
     * Fills a target with helpers to be used in the templates.
     *
     * @param {Object|Array} target The target to be filled
     *
     * @return {Object|Array} The same target with the filled helpers
     */
    View.prototype._fillHelpers = function (target) {
        if (false && !isPlainObject(target) && !isArray(target)) {
            throw new Error('Expected a plain object or an array to be passed to the template.');
        }

        // Only needed for handlebars
        if (window.Handlebars) {
            target.$view = this;
        }

        target.$url = function (state, params) {
            return this._generateUrl(state, params);
        }.bind(this);

        return target;
    };

    /**
     * {@inheritDoc}
     */
    View.prototype._onDestroy = function () {
        Joint.prototype._onDestroy.call(this);

        // Destroy view element
        this._element.remove = $.fn.remove;
        this._element.remove();

        // Null references
        this._element = this._nativeElement = this._controller = null;
    };

    // Register handlebar helpers
    if (window.Handlebars) {
        Handlebars.registerHelper('url', function (state, params) {
            var key,
                value,
                hash = params.hash;

            state = this[state] || state;

            for (key in hash) {
                value = hash[key];
                hash[key] = this[key] || value;
            }

            return this.$view._generateUrl(state, hash);
        });
    }

    View._eventsSplitter = /^(\S+)\s*(.*)$/;

    return View;
});

// doT.js
// 2011, Laura Doktorova, https://github.com/olado/doT
//
// doT.js is an open source component of http://bebedo.com
// Licensed under the MIT license.
//
(function() {
	

	var doT = {
		version: '0.2.0',
		templateSettings: {
			evaluate:    /\{\{([\s\S]+?)\}\}/g,
			interpolate: /\{\{=([\s\S]+?)\}\}/g,
			encode:      /\{\{!([\s\S]+?)\}\}/g,
			use:         /\{\{#([\s\S]+?)\}\}/g,
			define:      /\{\{##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\}\}/g,
			conditional: /\{\{\?(\?)?\s*([\s\S]*?)\s*\}\}/g,
			iterate:     /\{\{~\s*(?:\}\}|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\}\})/g,
			varname: 'it',
			strip: true,
			append: true,
			selfcontained: false
		},
		template: undefined, //fn, compile template
		compile:  undefined  //fn, for express
	};

	var global = (function(){ return this || (0,eval)('this'); }());

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = doT;
	} else if (typeof define === 'function' && define.amd) {
		define('doT',[],function(){return doT;});
	} else {
		global.doT = doT;
	}

	function encodeHTMLSource() {
		var encodeHTMLRules = { "&": "&#38;", "<": "&#60;", ">": "&#62;", '"': '&#34;', "'": '&#39;', "/": '&#47;' },
			matchHTML = /&(?!#?\w+;)|<|>|"|'|\//g;
		return function(code) {
			return code ? code.toString().replace(matchHTML, function(m) {return encodeHTMLRules[m] || m;}) : code;
		};
	}
	global.encodeHTML = encodeHTMLSource();

	var startend = {
		append: { start: "'+(",      end: ")+'",      startencode: "'+encodeHTML(" },
		split:  { start: "';out+=(", end: ");out+='", startencode: "';out+=encodeHTML("}
	}, skip = /$^/;

	function resolveDefs(c, block, def) {
		return ((typeof block === 'string') ? block : block.toString())
		.replace(c.define || skip, function(m, code, assign, value) {
			if (code.indexOf('def.') === 0) {
				code = code.substring(4);
			}
			if (!(code in def)) {
				if (assign === ':') {
					def[code]= value;
				} else {
					eval("def['"+code+"']=" + value);
				}
			}
			return '';
		})
		.replace(c.use || skip, function(m, code) {
			var v = eval(code);
			return v ? resolveDefs(c, v, def) : v;
		});
	}

	function unescape(code) {
		return code.replace(/\\('|\\)/g, "$1").replace(/[\r\t\n]/g, ' ');
	}

	doT.template = function(tmpl, c, def) {
		c = c || doT.templateSettings;
		var cse = c.append ? startend.append : startend.split, str, needhtmlencode, sid=0, indv;

		if (c.use || c.define) {
			var olddef = global.def; global.def = def || {}; // workaround minifiers
			str = resolveDefs(c, tmpl, global.def);
			global.def = olddef;
		} else str = tmpl;

		str = ("var out='" + (c.strip ? str.replace(/(^|\r|\n)\t* +| +\t*(\r|\n|$)/g,' ')
					.replace(/\r|\n|\t|\/\*[\s\S]*?\*\//g,''): str)
			.replace(/'|\\/g, '\\$&')
			.replace(c.interpolate || skip, function(m, code) {
				return cse.start + unescape(code) + cse.end;
			})
			.replace(c.encode || skip, function(m, code) {
				needhtmlencode = true;
				return cse.startencode + unescape(code) + cse.end;
			})
			.replace(c.conditional || skip, function(m, elsecase, code) {
				return elsecase ?
					(code ? "';}else if(" + unescape(code) + "){out+='" : "';}else{out+='") :
					(code ? "';if(" + unescape(code) + "){out+='" : "';}out+='");
			})
			.replace(c.iterate || skip, function(m, iterate, vname, iname) {
				if (!iterate) return "';} } out+='";
				sid+=1; indv=iname || "i"+sid; iterate=unescape(iterate);
				return "';var arr"+sid+"="+iterate+";if(arr"+sid+"){var "+vname+","+indv+"=-1,l"+sid+"=arr"+sid+".length-1;while("+indv+"<l"+sid+"){"
					+vname+"=arr"+sid+"["+indv+"+=1];out+='";
			})
			.replace(c.evaluate || skip, function(m, code) {
				return "';" + unescape(code) + "out+='";
			})
			+ "';return out;")
			.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
			.replace(/(\s|;|}|^|{)out\+='';/g, '$1').replace(/\+''/g, '')
			.replace(/(\s|;|}|^|{)out\+=''\+/g,'$1out+=');

		if (needhtmlencode && c.selfcontained) {
			str = "var encodeHTML=(" + encodeHTMLSource.toString() + "());" + str;
		}
		try {
			return new Function(c.varname, str);
		} catch (e) {
			if (typeof console !== 'undefined') console.log("Could not create a template function: " + str);
			throw e;
		}
	};

	doT.compile = function(tmpl, def) {
		return doT.template(tmpl, null, def);
	};
}());

/**
 * @license RequireJS text 2.0.10 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    text = {
        version: '2.0.10',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.indexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1, name.length);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file.indexOf('\uFEFF') === 0) {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                errback(e);
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        errback(err);
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes,
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});

define('text!Application/assets/tmpl/app.html',[],function () { return '<div class="app-header">\n    <div class="spoon-logo">SpoonJS</div>\n    <ul>\n        <!--<li class="menu-home"><a href="{{! it.$url(\'home\') }}">Home</a></li>-->\n        <li class="menu-guide"><a href="{{! it.$url(\'guide\') }}">Home</a></li>\n        <li class="menu-api"><a href="{{! it.$url(\'api\') }}">API Reference</a></li>\n    </ul>\n</div>\n<div class="app-content"></div>\n';});

/*
 * css.normalize.js
 *
 * CSS Normalization
 *
 * CSS paths are normalized based on an optional basePath and the RequireJS config
 *
 * Usage:
 *   normalize(css, fromBasePath, toBasePath);
 *
 * css: the stylesheet content to normalize
 * fromBasePath: the absolute base path of the css relative to any root (but without ../ backtracking)
 * toBasePath: the absolute new base path of the css relative to the same root
 * 
 * Absolute dependencies are left untouched.
 *
 * Urls in the CSS are picked up by regular expressions.
 * These will catch all statements of the form:
 *
 * url(*)
 * url('*')
 * url("*")
 * 
 * @import '*'
 * @import "*"
 *
 * (and so also @import url(*) variations)
 *
 * For urls needing normalization
 *
 */

define('css/normalize',['require', 'module'], function(require, module) {
  
  // regular expression for removing double slashes
  // eg http://www.example.com//my///url/here -> http://www.example.com/my/url/here
  var slashes = /([^:])\/+/g
  var removeDoubleSlashes = function(uri) {
    return uri.replace(slashes, '$1/');
  }

  // given a relative URI, and two absolute base URIs, convert it from one base to another
  var protocolRegEx = /[^\:\/]*:\/\/([^\/])*/
  function convertURIBase(uri, fromBase, toBase) {
    if(uri.indexOf("data:") === 0)
      return uri;
    uri = removeDoubleSlashes(uri);
    // absolute urls are left in tact
    if (uri.match(/^\//) || uri.match(protocolRegEx))
      return uri;
    // if toBase specifies a protocol path, ensure this is the same protocol as fromBase, if not
    // use absolute path at fromBase
    var toBaseProtocol = toBase.match(protocolRegEx);
    var fromBaseProtocol = fromBase.match(protocolRegEx);
    if (fromBaseProtocol && (!toBaseProtocol || toBaseProtocol[1] != fromBaseProtocol[1] || toBaseProtocol[2] != fromBaseProtocol[2]))
      return absoluteURI(uri, fromBase);
    
    else {
      return relativeURI(absoluteURI(uri, fromBase), toBase);
    }
  };
  
  // given a relative URI, calculate the absolute URI
  function absoluteURI(uri, base) {
    if (uri.substr(0, 2) == './')
      uri = uri.substr(2);    
    
    var baseParts = base.split('/');
    var uriParts = uri.split('/');
    
    baseParts.pop();
    
    while (curPart = uriParts.shift())
      if (curPart == '..')
        baseParts.pop();
      else
        baseParts.push(curPart);
    
    return baseParts.join('/');
  };


  // given an absolute URI, calculate the relative URI
  function relativeURI(uri, base) {
    
    // reduce base and uri strings to just their difference string
    var baseParts = base.split('/');
    baseParts.pop();
    base = baseParts.join('/') + '/';
    i = 0;
    while (base.substr(i, 1) == uri.substr(i, 1))
      i++;
    while (base.substr(i, 1) != '/')
      i--;
    base = base.substr(i + 1);
    uri = uri.substr(i + 1);

    // each base folder difference is thus a backtrack
    baseParts = base.split('/');
    var uriParts = uri.split('/');
    out = '';
    while (baseParts.shift())
      out += '../';
    
    // finally add uri parts
    while (curPart = uriParts.shift())
      out += curPart + '/';
    
    return out.substr(0, out.length - 1);
  };
  
  var normalizeCSS = function(source, fromBase, toBase, cssBase) {

    fromBase = removeDoubleSlashes(fromBase);
    toBase = removeDoubleSlashes(toBase);

    var urlRegEx = /@import\s*("([^"]*)"|'([^']*)')|url\s*\(\s*(\s*"([^"]*)"|'([^']*)'|[^\)]*\s*)\s*\)/ig;
    var result, url, source;

    while (result = urlRegEx.exec(source)) {
      url = result[3] || result[2] || result[5] || result[6] || result[4];
      var newUrl;
      if (cssBase && url.substr(0, 1) == '/')
        newUrl = cssBase + url;
      else
        newUrl = convertURIBase(url, fromBase, toBase);
      var quoteLen = result[5] || result[6] ? 1 : 0;
      source = source.substr(0, urlRegEx.lastIndex - url.length - quoteLen - 1) + newUrl + source.substr(urlRegEx.lastIndex - quoteLen - 1);
      urlRegEx.lastIndex = urlRegEx.lastIndex + (newUrl.length - url.length);
    }
    
    return source;
  };
  
  normalizeCSS.convertURIBase = convertURIBase;
  
  return normalizeCSS;
});

/*
 * Require-CSS RequireJS css! loader plugin
 * 0.0.8
 * Guy Bedford 2013
 * MIT
 */

/*
 *
 * Usage:
 *  require(['css!./mycssFile']);
 *
 * NB leave out the '.css' extension.
 *
 * - Fully supports cross origin CSS loading
 * - Works with builds
 *
 * Tested and working in (up to latest versions as of March 2013):
 * Android
 * iOS 6
 * IE 6 - 10
 * Chome 3 - 26
 * Firefox 3.5 - 19
 * Opera 10 - 12
 * 
 * browserling.com used for virtual testing environment
 *
 * Credit to B Cavalier & J Hann for the elegant IE 6 - 9 hack.
 * 
 * Sources that helped along the way:
 * - https://developer.mozilla.org/en-US/docs/Browser_detection_using_the_user_agent
 * - http://www.phpied.com/when-is-a-stylesheet-really-loaded/
 * - https://github.com/cujojs/curl/blob/master/src/curl/plugin/css.js
 *
 */

define('css/css',['./normalize'], function(normalize) {
  function indexOf(a, e) { for (var i=0, l=a.length; i < l; i++) if (a[i] === e) return i; return -1 }

  if (typeof window == 'undefined')
    return { load: function(n, r, load){ load() } };

  // set to true to enable test prompts for device testing
  var testing = false;
  
  var head = document.getElementsByTagName('head')[0];

  var engine = window.navigator.userAgent.match(/Trident\/([^ ;]*)|AppleWebKit\/([^ ;]*)|Opera\/([^ ;]*)|rv\:([^ ;]*)(.*?)Gecko\/([^ ;]*)|MSIE\s([^ ;]*)/);
  var hackLinks = false;

  if (!engine) {}
  else if (engine[1] || engine[7]) {
    hackLinks = parseInt(engine[1]) < 6 || parseInt(engine[7]) <= 9;
    engine = 'trident';
  }
  else if (engine[2]) {
    // unfortunately style querying still doesnt work with onload callback in webkit
    hackLinks = true;
    engine = 'webkit';
  }
  else if (engine[3]) {
    // engine = 'opera';
  }
  else if (engine[4]) {
    hackLinks = parseInt(engine[4]) < 18;
    engine = 'gecko';
  }
  else if (testing)
    alert('Engine detection failed');
  
  //main api object
  var cssAPI = {};

  var absUrlRegEx = /^\/|([^\:\/]*:)/;
  
  cssAPI.pluginBuilder = './css-builder';

  // used by layer builds to register their css buffers
  
  // the current layer buffer items (from addBuffer)
  var curBuffer = [];

  // the callbacks for buffer loads
  var onBufferLoad = {};

  // the full list of resources in the buffer
  var bufferResources = [];

  cssAPI.addBuffer = function(resourceId) {
    // just in case layer scripts are included twice, also check
    // against the previous buffers
    if (indexOf(curBuffer, resourceId) != -1)
      return;
    if (indexOf(bufferResources, resourceId) != -1)
      return;
    curBuffer.push(resourceId);
    bufferResources.push(resourceId);
  }
  cssAPI.setBuffer = function(css, isLess) {
    var pathname = window.location.pathname.split('/');
    pathname.pop();
    pathname = pathname.join('/') + '/';

    var baseParts = require.toUrl('base_url').split('/');
    baseParts.pop();
    var baseUrl = baseParts.join('/') + '/';
    baseUrl = normalize.convertURIBase(baseUrl, pathname, '/');
    if (!baseUrl.match(absUrlRegEx))
      baseUrl = '/' + baseUrl;
    if (baseUrl.substr(baseUrl.length - 1, 1) != '/')
      baseUrl = baseUrl + '/';

    cssAPI.inject(normalize(css, baseUrl, pathname));

    // set up attach callback if registered
    // clear the current buffer for the next layer
    // (just the less or css part as we have two buffers in one effectively)
    for (var i = 0; i < curBuffer.length; i++) {
      // find the resources in the less or css buffer dependening which one this is
      if ((isLess && curBuffer[i].substr(curBuffer[i].length - 5, 5) == '.less') ||
        (!isLess && curBuffer[i].substr(curBuffer[i].length - 4, 4) == '.css')) {
        (function(resourceId) {
          // mark that the onBufferLoad is about to be called (set to true if not already a callback function)
          onBufferLoad[resourceId] = onBufferLoad[resourceId] || true;

          // set a short timeout (as injection isn't instant in Chrome), then call the load
          setTimeout(function() {
            if (typeof onBufferLoad[resourceId] == 'function')
              onBufferLoad[resourceId]();
            // remove from onBufferLoad to indicate loaded
            delete onBufferLoad[resourceId];
          }, 7);
        })(curBuffer[i]);

        // remove the current resource from the buffer
        curBuffer.splice(i--, 1);
      }
    }
  }
  cssAPI.attachBuffer = function(resourceId, load) {
    // attach can happen during buffer collecting, or between injection and callback
    // we assume it is not possible to attach multiple callbacks
    // requirejs plugin load function ensures this by queueing duplicate calls

    // check if the resourceId is in the current buffer
    for (var i = 0; i < curBuffer.length; i++)
      if (curBuffer[i] == resourceId) {
        onBufferLoad[resourceId] = load;
        return true;
      }

    // check if the resourceId is waiting for injection callback
    // (onBufferLoad === true is a shortcut indicator for this)
    if (onBufferLoad[resourceId] === true) {
      onBufferLoad[resourceId] = load;
      return true;
    }

    // if it's in the full buffer list and not either of the above, its loaded already
    if (indexOf(bufferResources, resourceId) != -1) {
      load();
      return true;
    }
  }

  var webkitLoadCheck = function(link, callback) {
    setTimeout(function() {
      for (var i = 0; i < document.styleSheets.length; i++) {
        var sheet = document.styleSheets[i];
        if (sheet.href == link.href)
          return callback();
      }
      webkitLoadCheck(link, callback);
    }, 10);
  }

  var mozillaLoadCheck = function(style, callback) {
    setTimeout(function() {
      try {
        style.sheet.cssRules;
        return callback();
      } catch (e){}
      mozillaLoadCheck(style, callback);
    }, 10);
  }

  // ie link detection, as adapted from https://github.com/cujojs/curl/blob/master/src/curl/plugin/css.js
  if (engine == 'trident' && hackLinks) {
    var ieStyles = [],
      ieQueue = [],
      ieStyleCnt = 0;
    var ieLoad = function(url, callback) {
      var style;
      ieQueue.push({
        url: url,
        cb: callback
      });
      style = ieStyles.shift();
      if (!style && ieStyleCnt++ < 31) {
        style = document.createElement('style');
        head.appendChild(style);
      }
      if (style)
        ieLoadNextImport(style);
    }
    var ieLoadNextImport = function(style) {
      var curImport = ieQueue.shift();
      if (!curImport) {
        style.onload = noop;
        ieStyles.push(style);
        return;  
      }
      style.onload = function() {
        curImport.cb(curImport.ss);
        ieLoadNextImport(style);
      };
      var curSheet = style.styleSheet;
      curImport.ss = curSheet.imports[curSheet.addImport(curImport.url)];
    }
  }

  // uses the <link> load method
  var createLink = function(url) {
    var link = document.createElement('link');
    link.type = 'text/css';
    link.rel = 'stylesheet';
    link.href = url;
    return link;
  }

  var noop = function(){}

  cssAPI.linkLoad = function(url, callback) {
    var timeout = setTimeout(function() {
      if (testing) alert('timeout');
      callback();
    }, waitSeconds * 1000 - 100);
    var _callback = function() {
      clearTimeout(timeout);
      if (link)
        link.onload = noop;
      // for style querying, a short delay still seems necessary
      setTimeout(callback, 7);
    }
    if (!hackLinks) {
      var link = createLink(url);
      link.onload = _callback;
      head.appendChild(link);
    }
    // hacks
    else {
      if (engine == 'webkit') {
        var link = createLink(url);
        webkitLoadCheck(link, _callback);
        head.appendChild(link);
      }
      else if (engine == 'gecko') {
        var style = document.createElement('style');
        style.textContent = '@import "' + url + '"';
        mozillaLoadCheck(style, _callback);
        head.appendChild(style);
      }
      else if (engine == 'trident')
        ieLoad(url, _callback);
    }
  }

  /* injection api */
  var progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'];
  var fileCache = {};
  var get = function(url, callback, errback) {
    if (fileCache[url]) {
      callback(fileCache[url]);
      return;
    }

    var xhr, i, progId;
    if (typeof XMLHttpRequest !== 'undefined')
      xhr = new XMLHttpRequest();
    else if (typeof ActiveXObject !== 'undefined')
      for (i = 0; i < 3; i += 1) {
        progId = progIds[i];
        try {
          xhr = new ActiveXObject(progId);
        }
        catch (e) {}
  
        if (xhr) {
          progIds = [progId];  // so faster next time
          break;
        }
      }
    
    xhr.open('GET', url, requirejs.inlineRequire ? false : true);
  
    xhr.onreadystatechange = function (evt) {
      var status, err;
      //Do not explicitly handle errors, those should be
      //visible via console output in the browser.
      if (xhr.readyState === 4) {
        status = xhr.status;
        if (status > 399 && status < 600) {
          //An http 4xx or 5xx error. Signal an error.
          err = new Error(url + ' HTTP status: ' + status);
          err.xhr = xhr;
          errback(err);
        }
        else {
          fileCache[url] = xhr.responseText;
          callback(xhr.responseText);
        }
      }
    };
    
    xhr.send(null);
  }
  //uses the <style> load method
  var styleCnt = 0;
  var curStyle;
  cssAPI.inject = function(css) {
    if (styleCnt < 31) {
      curStyle = document.createElement('style');
      curStyle.type = 'text/css';
      head.appendChild(curStyle);
      styleCnt++;
    }
    if (curStyle.styleSheet)
      curStyle.styleSheet.cssText += css;
    else
      curStyle.appendChild(document.createTextNode(css));
  }
  
  // NB add @media query support for media imports
  var importRegEx = /@import\s*(url)?\s*(('([^']*)'|"([^"]*)")|\(('([^']*)'|"([^"]*)"|([^\)]*))\))\s*;?/g;

  var pathname = window.location.pathname.split('/');
  pathname.pop();
  pathname = pathname.join('/') + '/';

  var loadCSS = function(fileUrl, callback, errback) {

    //make file url absolute
    if (!fileUrl.match(absUrlRegEx))
      fileUrl = '/' + normalize.convertURIBase(fileUrl, pathname, '/');

    get(fileUrl, function(css) {

      // normalize the css (except import statements)
      css = normalize(css, fileUrl, pathname);

      // detect all import statements in the css and normalize
      var importUrls = [];
      var importIndex = [];
      var importLength = [];
      var match;
      while (match = importRegEx.exec(css)) {
        var importUrl = match[4] || match[5] || match[7] || match[8] || match[9];

        importUrls.push(importUrl);
        importIndex.push(importRegEx.lastIndex - match[0].length);
        importLength.push(match[0].length);
      }

      // load the import stylesheets and substitute into the css
      var completeCnt = 0;
      for (var i = 0; i < importUrls.length; i++)
        (function(i) {
          loadCSS(importUrls[i], function(importCSS) {
            css = css.substr(0, importIndex[i]) + importCSS + css.substr(importIndex[i] + importLength[i]);
            var lenDiff = importCSS.length - importLength[i];
            for (var j = i + 1; j < importUrls.length; j++)
              importIndex[j] += lenDiff;
            completeCnt++;
            if (completeCnt == importUrls.length) {
              callback(css);
            }
          }, errback);
        })(i);

      if (importUrls.length == 0)
        callback(css);
    }, errback);
  }

  
  cssAPI.normalize = function(name, normalize) {
    if (name.substr(name.length - 4, 4) == '.css')
      name = name.substr(0, name.length - 4);
    
    return normalize(name);
  }
  
  var waitSeconds;
  var alerted = false;
  cssAPI.load = function(cssId, req, load, config, parse) {
    
    waitSeconds = waitSeconds || config.waitSeconds || 7;

    var resourceId = cssId + (!parse ? '.css' : '.less');

    // attach the load function to a buffer if there is one in registration
    // if not, we do a full injection load
    if (cssAPI.attachBuffer(resourceId, load))
      return;

    var fileUrl = req.toUrl(resourceId);
    
    if (!alerted && testing) {
      alert(hackLinks ? 'hacking links' : 'not hacking');
      alerted = true;
    }

    if (!parse) {
      cssAPI.linkLoad(fileUrl, load);
    }
    else {
      loadCSS(fileUrl, function(css) {
        // run parsing after normalization - since less is a CSS subset this works fine
        if (parse)
          css = parse(css, function(css) {
            cssAPI.inject(css);
            setTimeout(load, 7);
          });
      });
    }
  }

  if (testing)
    cssAPI.inspect = function() {
      if (stylesheet.styleSheet)
        return stylesheet.styleSheet.cssText;
      else if (stylesheet.innerHTML)
        return stylesheet.innerHTML;
    }
  
  return cssAPI;
});

define('css', ['css/css'], function (main) { return main; });

define('css!normalize-css/normalize',[],function(){});
define('css!Application/assets/css/app',[],function(){});
define('css!Application/assets/css/header',[],function(){});
define('Application/ApplicationView',[
    'spoon/View',
    'jquery',
    'doT',
    'text!./assets/tmpl/app.html',
    'css!normalize-css/normalize',
    'css!http://fonts.googleapis.com/css?family=Open+Sans:300,400,600,700',
    'css!./assets/css/app',
    'css!./assets/css/header'
], function (View, $, doT, tmpl) {

    

    return View.extend({
        $name: 'ApplicationView',

        _element: 'div#app',
        _template: doT.template(tmpl),

        /**
         * {@inheritDoc}
         */
        initialize: function (element) {
            View.call(this, element);

            this._onScroll = this._onScroll.bind(this);
        },

        /**
         * {@inheritDoc}
         */
        render: function () {
            View.prototype.render.call(this);

            this._headerHeight = this._element.find('.app-header').height();

            // Listen to the scroll in order to update the active topic
            $(document).on('scroll', this._onScroll);
        },

        /**
         * Sets the active menu.
         *
         * @param {String} menu The menu item name
         */
        setActiveMenu: function (menu) {
            if (this._lastActiveEl) {
                this._lastActiveEl.removeClass('active');
            }

            this._lastActiveEl = this._element.find('.menu-' + menu).addClass('active');

            document.body.scrollTop = 0;
        },

        /**
         * Handles the scroll event.
         */
        _onScroll: function () {
            if ($(window).scrollTop() > this._headerHeight) {
                this._element.addClass('scroll');
            } else {
                this._element.removeClass('scroll');
            }
        },

        /**
         * {@inheritDoc}
         */
        _onDestroy: function () {
            $(document).off('scroll', this._onScroll);
        }
    });
});
/**
 * @constant Minimum 32-bit signed integer value (-2^31).
 */
define('mout/number/MIN_INT',[],function(){
    return -2147483648;
});

/**
 * @constant Maximum 32-bit signed integer value. (2^31 - 1)
 */
define('mout/number/MAX_INT',[],function(){
    return 2147483647;
});

define('mout/random/random',[],function () {

    /**
     * Just a wrapper to Math.random. No methods inside mout/random should call
     * Math.random() directly so we can inject the pseudo-random number
     * generator if needed (ie. in case we need a seeded random or a better
     * algorithm than the native one)
     */
    function random(){
        return random.get();
    }

    // we expose the method so it can be swapped if needed
    random.get = Math.random;

    return random;

});

define('mout/random/rand',['./random', '../number/MIN_INT', '../number/MAX_INT'], function(random, MIN_INT, MAX_INT){

    /**
     * Returns random number inside range
     */
    function rand(min, max){
        min = min == null? MIN_INT : min;
        max = max == null? MAX_INT : max;
        return min + (max - min) * random();
    }

    return rand;
});

define('mout/random/randInt',['../number/MIN_INT', '../number/MAX_INT', './rand'], function(MIN_INT, MAX_INT, rand){

    /**
     * Gets random integer inside range or snap to min/max values.
     */
    function randInt(min, max){
        min = min == null? MIN_INT : ~~min;
        max = max == null? MAX_INT : ~~max;
        // can't be max + 0.5 otherwise it will round up if `rand`
        // returns `max` causing it to overflow range.
        // -0.5 and + 0.49 are required to avoid bias caused by rounding
        return Math.round( rand(min - 0.5, max + 0.499999999999) );
    }

    return randInt;
});

define('text!Content/Home/assets/tmpl/home.html',[],function () { return '<!--<img class="video-poster" src="{{= require.toUrl(\'Content/Home/assets/video/christmas_snow.jpg\') }}"/>\n<video preload="auto" autoplay="autoplay" loop="true">\n    <source src="{{= require.toUrl(\'Content/Home/assets/video/christmas_snow.mp4\' + it.rand) }}" type="video/mp4">\n    <source src="{{= require.toUrl(\'Content/Home/assets/video/christmas_snow.webm\' + it.rand) }}" type="video/webm">\n    <source src="{{= require.toUrl(\'Content/Home/assets/video/christmas_snow.ogv\' + it.rand) }}" type="video/ogg">\n</video>-->';});

define('css!Content/Home/assets/css/home',[],function(){});
define('Content/Home/HomeView',[
    'spoon/View',
    'jquery',
    'doT',
    'mout/random/randInt',
    'text!./assets/tmpl/home.html',
    'css!./assets/css/home'
], function (View, $, doT, randInt, tmpl) {

    

    return View.extend({
        $name: 'HomeView',

        _element: 'div.home',
        _template: doT.template(tmpl),

        /**
         * {@inheritDoc}
         */
        render: function () {
            // Chrome has a bug and we must generate a cache busting for the videos to get around it
            // See: http://stackoverflow.com/questions/14205668/html5-video-dynamically-generated-video-tag-plays-only-first-time
            View.prototype.render.call(this, {
                rand: window.chrome ? '?' + randInt(0) : ''
            });
        }
    });
});
define('mout/string/replaceAccents',['../lang/toString'], function(toString){
    /**
    * Replaces all accented chars with regular ones
    */
    function replaceAccents(str){
        str = toString(str);

        // verifies if the String has accents and replace them
        if (str.search(/[\xC0-\xFF]/g) > -1) {
            str = str
                    .replace(/[\xC0-\xC5]/g, "A")
                    .replace(/[\xC6]/g, "AE")
                    .replace(/[\xC7]/g, "C")
                    .replace(/[\xC8-\xCB]/g, "E")
                    .replace(/[\xCC-\xCF]/g, "I")
                    .replace(/[\xD0]/g, "D")
                    .replace(/[\xD1]/g, "N")
                    .replace(/[\xD2-\xD6\xD8]/g, "O")
                    .replace(/[\xD9-\xDC]/g, "U")
                    .replace(/[\xDD]/g, "Y")
                    .replace(/[\xDE]/g, "P")
                    .replace(/[\xE0-\xE5]/g, "a")
                    .replace(/[\xE6]/g, "ae")
                    .replace(/[\xE7]/g, "c")
                    .replace(/[\xE8-\xEB]/g, "e")
                    .replace(/[\xEC-\xEF]/g, "i")
                    .replace(/[\xF1]/g, "n")
                    .replace(/[\xF2-\xF6\xF8]/g, "o")
                    .replace(/[\xF9-\xFC]/g, "u")
                    .replace(/[\xFE]/g, "p")
                    .replace(/[\xFD\xFF]/g, "y");
        }
        return str;
    }
    return replaceAccents;
});

define('mout/string/removeNonWord',['../lang/toString'], function(toString){
    /**
     * Remove non-word chars.
     */
    function removeNonWord(str){
        str = toString(str);
        return str.replace(/[^0-9a-zA-Z\xC0-\xFF \-_]/g, '');
    }

    return removeNonWord;
});

define('mout/string/WHITE_SPACES',[],function() {
    /**
     * Contains all Unicode white-spaces. Taken from
     * http://en.wikipedia.org/wiki/Whitespace_character.
     */
    return [
        ' ', '\n', '\r', '\t', '\f', '\v', '\u00A0', '\u1680', '\u180E',
        '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006',
        '\u2007', '\u2008', '\u2009', '\u200A', '\u2028', '\u2029', '\u202F',
        '\u205F', '\u3000'
    ];
});

define('mout/string/ltrim',['../lang/toString', './WHITE_SPACES'], function(toString, WHITE_SPACES){
    /**
     * Remove chars from beginning of string.
     */
    function ltrim(str, chars) {
        str = toString(str);
        chars = chars || WHITE_SPACES;

        var start = 0,
            len = str.length,
            charLen = chars.length,
            found = true,
            i, c;

        while (found && start < len) {
            found = false;
            i = -1;
            c = str.charAt(start);

            while (++i < charLen) {
                if (c === chars[i]) {
                    found = true;
                    start++;
                    break;
                }
            }
        }

        return (start >= len) ? '' : str.substr(start, len);
    }

    return ltrim;
});

define('mout/string/rtrim',['../lang/toString', './WHITE_SPACES'], function(toString, WHITE_SPACES){
    /**
     * Remove chars from end of string.
     */
    function rtrim(str, chars) {
        str = toString(str);
        chars = chars || WHITE_SPACES;

        var end = str.length - 1,
            charLen = chars.length,
            found = true,
            i, c;

        while (found && end >= 0) {
            found = false;
            i = -1;
            c = str.charAt(end);

            while (++i < charLen) {
                if (c === chars[i]) {
                    found = true;
                    end--;
                    break;
                }
            }
        }

        return (end >= 0) ? str.substring(0, end + 1) : '';
    }

    return rtrim;
});

define('mout/string/trim',['../lang/toString', './WHITE_SPACES', './ltrim', './rtrim'], function(toString, WHITE_SPACES, ltrim, rtrim){
    /**
     * Remove white-spaces from beginning and end of string.
     */
    function trim(str, chars) {
        str = toString(str);
        chars = chars || WHITE_SPACES;
        return ltrim(rtrim(str, chars), chars);
    }

    return trim;
});

define('mout/string/slugify',['../lang/toString', './replaceAccents', './removeNonWord', './trim'], function(toString, replaceAccents, removeNonWord, trim){
    /**
     * Convert to lower case, remove accents, remove non-word chars and
     * replace spaces with the specified delimeter.
     * Does not split camelCase text.
     */
    function slugify(str, delimeter){
        str = toString(str);

        if (delimeter == null) {
            delimeter = "-";
        }
        str = replaceAccents(str);
        str = removeNonWord(str);
        str = trim(str) //should come after removeNonWord
                .replace(/ +/g, delimeter) //replace spaces with delimeter
                .toLowerCase();
        return str;
    }
    return slugify;
});

define('mout/array/map',['../function/makeIterator_'], function (makeIterator) {

    /**
     * Array map
     */
    function map(arr, callback, thisObj) {
        callback = makeIterator(callback, thisObj);
        var results = [];
        if (arr == null){
            return results;
        }

        var i = -1, len = arr.length;
        while (++i < len) {
            results[i] = callback(arr[i], i, arr);
        }

        return results;
    }

     return map;
});

/**
 * Copyright 2012 Craig Campbell
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Rainbow is a simple code syntax highlighter
 *
 * @preserve @version 1.1.9
 * @url rainbowco.de
 */
window['Rainbow'] = (function() {

    /**
     * array of replacements to process at the end
     *
     * @type {Object}
     */
    var replacements = {},

        /**
         * an array of start and end positions of blocks to be replaced
         *
         * @type {Object}
         */
        replacement_positions = {},

        /**
         * an array of the language patterns specified for each language
         *
         * @type {Object}
         */
        language_patterns = {},

        /**
         * an array of languages and whether they should bypass the default patterns
         *
         * @type {Object}
         */
        bypass_defaults = {},

        /**
         * processing level
         *
         * replacements are stored at this level so if there is a sub block of code
         * (for example php inside of html) it runs at a different level
         *
         * @type {number}
         */
        CURRENT_LEVEL = 0,

        /**
         * constant used to refer to the default language
         *
         * @type {number}
         */
        DEFAULT_LANGUAGE = 0,

        /**
         * used as counters so we can selectively call setTimeout
         * after processing a certain number of matches/replacements
         *
         * @type {number}
         */
        match_counter = 0,

        /**
         * @type {number}
         */
        replacement_counter = 0,

        /**
         * @type {null|string}
         */
        global_class,

        /**
         * @type {null|Function}
         */
        onHighlight;

    /**
     * cross browser get attribute for an element
     *
     * @see http://stackoverflow.com/questions/3755227/cross-browser-javascript-getattribute-method
     *
     * @param {Node} el
     * @param {string} attr     attribute you are trying to get
     * @returns {string|number}
     */
    function _attr(el, attr, attrs, i) {
        var result = (el.getAttribute && el.getAttribute(attr)) || 0;

        if (!result) {
            attrs = el.attributes;

            for (i = 0; i < attrs.length; ++i) {
                if (attrs[i].nodeName === attr) {
                    return attrs[i].nodeValue;
                }
            }
        }

        return result;
    }

    /**
     * adds a class to a given code block
     *
     * @param {Element} el
     * @param {string} class_name   class name to add
     * @returns void
     */
    function _addClass(el, class_name) {
        el.className += el.className ? ' ' + class_name : class_name;
    }

    /**
     * checks if a block has a given class
     *
     * @param {Element} el
     * @param {string} class_name   class name to check for
     * @returns {boolean}
     */
    function _hasClass(el, class_name) {
        return (' ' + el.className + ' ').indexOf(' ' + class_name + ' ') > -1;
    }

    /**
     * gets the language for this block of code
     *
     * @param {Element} block
     * @returns {string|null}
     */
    function _getLanguageForBlock(block) {

        // if this doesn't have a language but the parent does then use that
        // this means if for example you have: <pre data-language="php">
        // with a bunch of <code> blocks inside then you do not have
        // to specify the language for each block
        var language = _attr(block, 'data-language') || _attr(block.parentNode, 'data-language');

        // this adds support for specifying language via a css class
        // you can use the Google Code Prettify style: <pre class="lang-php">
        // or the HTML5 style: <pre><code class="language-php">
        if (!language) {
            var pattern = /\blang(?:uage)?-(\w+)/,
                match = block.className.match(pattern) || block.parentNode.className.match(pattern);

            if (match) {
                language = match[1];
            }
        }

        return language;
    }

    /**
     * makes sure html entities are always used for tags
     *
     * @param {string} code
     * @returns {string}
     */
    function _htmlEntities(code) {
        return code.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&(?![\w\#]+;)/g, '&amp;');
    }

    /**
     * determines if a new match intersects with an existing one
     *
     * @param {number} start1    start position of existing match
     * @param {number} end1      end position of existing match
     * @param {number} start2    start position of new match
     * @param {number} end2      end position of new match
     * @returns {boolean}
     */
    function _intersects(start1, end1, start2, end2) {
        if (start2 >= start1 && start2 < end1) {
            return true;
        }

        return end2 > start1 && end2 < end1;
    }

    /**
     * determines if two different matches have complete overlap with each other
     *
     * @param {number} start1   start position of existing match
     * @param {number} end1     end position of existing match
     * @param {number} start2   start position of new match
     * @param {number} end2     end position of new match
     * @returns {boolean}
     */
    function _hasCompleteOverlap(start1, end1, start2, end2) {

        // if the starting and end positions are exactly the same
        // then the first one should stay and this one should be ignored
        if (start2 == start1 && end2 == end1) {
            return false;
        }

        return start2 <= start1 && end2 >= end1;
    }

    /**
     * determines if the match passed in falls inside of an existing match
     * this prevents a regex pattern from matching inside of a bigger pattern
     *
     * @param {number} start - start position of new match
     * @param {number} end - end position of new match
     * @returns {boolean}
     */
    function _matchIsInsideOtherMatch(start, end) {
        for (var key in replacement_positions[CURRENT_LEVEL]) {
            key = parseInt(key, 10);

            // if this block completely overlaps with another block
            // then we should remove the other block and return false
            if (_hasCompleteOverlap(key, replacement_positions[CURRENT_LEVEL][key], start, end)) {
                delete replacement_positions[CURRENT_LEVEL][key];
                delete replacements[CURRENT_LEVEL][key];
            }

            if (_intersects(key, replacement_positions[CURRENT_LEVEL][key], start, end)) {
                return true;
            }
        }

        return false;
    }

    /**
     * takes a string of code and wraps it in a span tag based on the name
     *
     * @param {string} name     name of the pattern (ie keyword.regex)
     * @param {string} code     block of code to wrap
     * @returns {string}
     */
    function _wrapCodeInSpan(name, code) {
        return '<span class="' + name.replace(/\./g, ' ') + (global_class ? ' ' + global_class : '') + '">' + code + '</span>';
    }

    /**
     * finds out the position of group match for a regular expression
     *
     * @see http://stackoverflow.com/questions/1985594/how-to-find-index-of-groups-in-match
     *
     * @param {Object} match
     * @param {number} group_number
     * @returns {number}
     */
    function _indexOfGroup(match, group_number) {
        var index = 0,
            i;

        for (i = 1; i < group_number; ++i) {
            if (match[i]) {
                index += match[i].length;
            }
        }

        return index;
    }

    /**
     * matches a regex pattern against a block of code
     * finds all matches that should be processed and stores the positions
     * of where they should be replaced within the string
     *
     * this is where pretty much all the work is done but it should not
     * be called directly
     *
     * @param {RegExp} pattern
     * @param {string} code
     * @returns void
     */
    function _processPattern(regex, pattern, code, callback)
    {
        var match = regex.exec(code);

        if (!match) {
            return callback();
        }

        ++match_counter;

        // treat match 0 the same way as name
        if (!pattern['name'] && typeof pattern['matches'][0] == 'string') {
            pattern['name'] = pattern['matches'][0];
            delete pattern['matches'][0];
        }

        var replacement = match[0],
            start_pos = match.index,
            end_pos = match[0].length + start_pos,

            /**
             * callback to process the next match of this pattern
             */
            processNext = function() {
                var nextCall = function() {
                    _processPattern(regex, pattern, code, callback);
                };

                // every 100 items we process let's call set timeout
                // to let the ui breathe a little
                return match_counter % 100 > 0 ? nextCall() : setTimeout(nextCall, 0);
            };

        // if this is not a child match and it falls inside of another
        // match that already happened we should skip it and continue processing
        if (_matchIsInsideOtherMatch(start_pos, end_pos)) {
            return processNext();
        }

        /**
         * callback for when a match was successfully processed
         *
         * @param {string} replacement
         * @returns void
         */
        var onMatchSuccess = function(replacement) {
                // if this match has a name then wrap it in a span tag
                if (pattern['name']) {
                    replacement = _wrapCodeInSpan(pattern['name'], replacement);
                }

                // console.log('LEVEL', CURRENT_LEVEL, 'replace', match[0], 'with', replacement, 'at position', start_pos, 'to', end_pos);

                // store what needs to be replaced with what at this position
                if (!replacements[CURRENT_LEVEL]) {
                    replacements[CURRENT_LEVEL] = {};
                    replacement_positions[CURRENT_LEVEL] = {};
                }

                replacements[CURRENT_LEVEL][start_pos] = {
                    'replace': match[0],
                    'with': replacement
                };

                // store the range of this match so we can use it for comparisons
                // with other matches later
                replacement_positions[CURRENT_LEVEL][start_pos] = end_pos;

                // process the next match
                processNext();
            },

            // if this pattern has sub matches for different groups in the regex
            // then we should process them one at a time by rerunning them through
            // this function to generate the new replacement
            //
            // we run through them backwards because the match position of earlier
            // matches will not change depending on what gets replaced in later
            // matches
            group_keys = keys(pattern['matches']),

            /**
             * callback for processing a sub group
             *
             * @param {number} i
             * @param {Array} group_keys
             * @param {Function} callback
             */
            processGroup = function(i, group_keys, callback) {
                if (i >= group_keys.length) {
                    return callback(replacement);
                }

                var processNextGroup = function() {
                        processGroup(++i, group_keys, callback);
                    },
                    block = match[group_keys[i]];

                // if there is no match here then move on
                if (!block) {
                    return processNextGroup();
                }

                var group = pattern['matches'][group_keys[i]],
                    language = group['language'],

                    /**
                     * process group is what group we should use to actually process
                     * this match group
                     *
                     * for example if the subgroup pattern looks like this
                     * 2: {
                     *     'name': 'keyword',
                     *     'pattern': /true/g
                     * }
                     *
                     * then we use that as is, but if it looks like this
                     *
                     * 2: {
                     *     'name': 'keyword',
                     *     'matches': {
                     *          'name': 'special',
                     *          'pattern': /whatever/g
                     *      }
                     * }
                     *
                     * we treat the 'matches' part as the pattern and keep
                     * the name around to wrap it with later
                     */
                    process_group = group['name'] && group['matches'] ? group['matches'] : group,

                    /**
                     * takes the code block matched at this group, replaces it
                     * with the highlighted block, and optionally wraps it with
                     * a span with a name
                     *
                     * @param {string} block
                     * @param {string} replace_block
                     * @param {string|null} match_name
                     */
                    _replaceAndContinue = function(block, replace_block, match_name) {
                        replacement = _replaceAtPosition(_indexOfGroup(match, group_keys[i]), block, match_name ? _wrapCodeInSpan(match_name, replace_block) : replace_block, replacement);
                        processNextGroup();
                    };

                // if this is a sublanguage go and process the block using that language
                if (language) {
                    return _highlightBlockForLanguage(block, language, function(code) {
                        _replaceAndContinue(block, code);
                    });
                }

                // if this is a string then this match is directly mapped to selector
                // so all we have to do is wrap it in a span and continue
                if (typeof group === 'string') {
                    return _replaceAndContinue(block, block, group);
                }

                // the process group can be a single pattern or an array of patterns
                // _processCodeWithPatterns always expects an array so we convert it here
                _processCodeWithPatterns(block, process_group.length ? process_group : [process_group], function(code) {
                    _replaceAndContinue(block, code, group['matches'] ? group['name'] : 0);
                });
            };

        processGroup(0, group_keys, onMatchSuccess);
    }

    /**
     * should a language bypass the default patterns?
     *
     * if you call Rainbow.extend() and pass true as the third argument
     * it will bypass the defaults
     */
    function _bypassDefaultPatterns(language)
    {
        return bypass_defaults[language];
    }

    /**
     * returns a list of regex patterns for this language
     *
     * @param {string} language
     * @returns {Array}
     */
    function _getPatternsForLanguage(language) {
        var patterns = language_patterns[language] || [],
            default_patterns = language_patterns[DEFAULT_LANGUAGE] || [];

        return _bypassDefaultPatterns(language) ? patterns : patterns.concat(default_patterns);
    }

    /**
     * substring replace call to replace part of a string at a certain position
     *
     * @param {number} position         the position where the replacement should happen
     * @param {string} replace          the text we want to replace
     * @param {string} replace_with     the text we want to replace it with
     * @param {string} code             the code we are doing the replacing in
     * @returns {string}
     */
    function _replaceAtPosition(position, replace, replace_with, code) {
        var sub_string = code.substr(position);
        return code.substr(0, position) + sub_string.replace(replace, replace_with);
    }

   /**
     * sorts an object by index descending
     *
     * @param {Object} object
     * @return {Array}
     */
    function keys(object) {
        var locations = [],
            replacement,
            pos;

        for(var location in object) {
            if (object.hasOwnProperty(location)) {
                locations.push(location);
            }
        }

        // numeric descending
        return locations.sort(function(a, b) {
            return b - a;
        });
    }

    /**
     * processes a block of code using specified patterns
     *
     * @param {string} code
     * @param {Array} patterns
     * @returns void
     */
    function _processCodeWithPatterns(code, patterns, callback)
    {
        // we have to increase the level here so that the
        // replacements will not conflict with each other when
        // processing sub blocks of code
        ++CURRENT_LEVEL;

        // patterns are processed one at a time through this function
        function _workOnPatterns(patterns, i)
        {
            // still have patterns to process, keep going
            if (i < patterns.length) {
                return _processPattern(patterns[i]['pattern'], patterns[i], code, function() {
                    _workOnPatterns(patterns, ++i);
                });
            }

            // we are done processing the patterns
            // process the replacements and update the DOM
            _processReplacements(code, function(code) {

                // when we are done processing replacements
                // we are done at this level so we can go back down
                delete replacements[CURRENT_LEVEL];
                delete replacement_positions[CURRENT_LEVEL];
                --CURRENT_LEVEL;
                callback(code);
            });
        }

        _workOnPatterns(patterns, 0);
    }

    /**
     * process replacements in the string of code to actually update the markup
     *
     * @param {string} code         the code to process replacements in
     * @param {Function} onComplete   what to do when we are done processing
     * @returns void
     */
    function _processReplacements(code, onComplete) {

        /**
         * processes a single replacement
         *
         * @param {string} code
         * @param {Array} positions
         * @param {number} i
         * @param {Function} onComplete
         * @returns void
         */
        function _processReplacement(code, positions, i, onComplete) {
            if (i < positions.length) {
                ++replacement_counter;
                var pos = positions[i],
                    replacement = replacements[CURRENT_LEVEL][pos];
                code = _replaceAtPosition(pos, replacement['replace'], replacement['with'], code);

                // process next function
                var next = function() {
                    _processReplacement(code, positions, ++i, onComplete);
                };

                // use a timeout every 250 to not freeze up the UI
                return replacement_counter % 250 > 0 ? next() : setTimeout(next, 0);
            }

            onComplete(code);
        }

        var string_positions = keys(replacements[CURRENT_LEVEL]);
        _processReplacement(code, string_positions, 0, onComplete);
    }

    /**
     * takes a string of code and highlights it according to the language specified
     *
     * @param {string} code
     * @param {string} language
     * @param {Function} onComplete
     * @returns void
     */
    function _highlightBlockForLanguage(code, language, onComplete) {
        var patterns = _getPatternsForLanguage(language);
        _processCodeWithPatterns(_htmlEntities(code), patterns, onComplete);
    }

    /**
     * highlight an individual code block
     *
     * @param {Array} code_blocks
     * @param {number} i
     * @returns void
     */
    function _highlightCodeBlock(code_blocks, i, onComplete) {
        if (i < code_blocks.length) {
            var block = code_blocks[i],
                language = _getLanguageForBlock(block);

            if (!_hasClass(block, 'rainbow') && language) {
                language = language.toLowerCase();

                _addClass(block, 'rainbow');

                return _highlightBlockForLanguage(block.innerHTML, language, function(code) {
                    block.innerHTML = code;

                    // reset the replacement arrays
                    replacements = {};
                    replacement_positions = {};

                    // if you have a listener attached tell it that this block is now highlighted
                    if (onHighlight) {
                        onHighlight(block, language);
                    }

                    // process the next block
                    setTimeout(function() {
                        _highlightCodeBlock(code_blocks, ++i, onComplete);
                    }, 0);
                });
            }
            return _highlightCodeBlock(code_blocks, ++i, onComplete);
        }

        if (onComplete) {
            onComplete();
        }
    }

    /**
     * start highlighting all the code blocks
     *
     * @returns void
     */
    function _highlight(node, onComplete) {

        // the first argument can be an Event or a DOM Element
        // I was originally checking instanceof Event but that makes it break
        // when using mootools
        //
        // @see https://github.com/ccampbell/rainbow/issues/32
        //
        node = node && typeof node.getElementsByTagName == 'function' ? node : document;

        var pre_blocks = node.getElementsByTagName('pre'),
            code_blocks = node.getElementsByTagName('code'),
            i,
            final_blocks = [];

        // @see http://stackoverflow.com/questions/2735067/how-to-convert-a-dom-node-list-to-an-array-in-javascript
        // we are going to process all <code> blocks
        for (i = 0; i < code_blocks.length; ++i) {
            final_blocks.push(code_blocks[i]);
        }

        // loop through the pre blocks to see which ones we should add
        for (i = 0; i < pre_blocks.length; ++i) {

            // if the pre block has no code blocks then process it directly
            if (!pre_blocks[i].getElementsByTagName('code').length) {
                final_blocks.push(pre_blocks[i]);
            }
        }

        _highlightCodeBlock(final_blocks, 0, onComplete);
    }

    /**
     * public methods
     */
    return {

        /**
         * extends the language pattern matches
         *
         * @param {*} language     name of language
         * @param {*} patterns      array of patterns to add on
         * @param {boolean|null} bypass      if true this will bypass the default language patterns
         */
        extend: function(language, patterns, bypass) {

            // if there is only one argument then we assume that we want to
            // extend the default language rules
            if (arguments.length == 1) {
                patterns = language;
                language = DEFAULT_LANGUAGE;
            }

            bypass_defaults[language] = bypass;
            language_patterns[language] = patterns.concat(language_patterns[language] || []);
        },

        /**
         * call back to let you do stuff in your app after a piece of code has been highlighted
         *
         * @param {Function} callback
         */
        onHighlight: function(callback) {
            onHighlight = callback;
        },

        /**
         * method to set a global class that will be applied to all spans
         *
         * @param {string} class_name
         */
        addClass: function(class_name) {
            global_class = class_name;
        },

        /**
         * starts the magic rainbow
         *
         * @returns void
         */
        color: function() {

            // if you want to straight up highlight a string you can pass the string of code,
            // the language, and a callback function
            if (typeof arguments[0] == 'string') {
                return _highlightBlockForLanguage(arguments[0], arguments[1], arguments[2]);
            }

            // if you pass a callback function then we rerun the color function
            // on all the code and call the callback function on complete
            if (typeof arguments[0] == 'function') {
                return _highlight(0, arguments[0]);
            }

            // otherwise we use whatever node you passed in with an optional
            // callback function as the second parameter
            _highlight(arguments[0], arguments[1]);
        }
    };
}) ();

/**
 * adds event listener to start highlighting
 */
(function() {
    if (document.addEventListener) {
        return document.addEventListener('DOMContentLoaded', Rainbow.color, false);
    }
    window.attachEvent('onload', Rainbow.color);
}) ();

// When using Google closure compiler in advanced mode some methods
// get renamed.  This keeps a public reference to these methods so they can
// still be referenced from outside this library.
Rainbow["onHighlight"] = Rainbow.onHighlight;
Rainbow["addClass"] = Rainbow.addClass;

define("rainbow/js/rainbow", function(){});

/**
 * Generic language patterns
 *
 * @author Craig Campbell
 * @version 1.0.10
 */
Rainbow.extend([
    {
        'matches': {
            1: {
                'name': 'keyword.operator',
                'pattern': /\=/g
            },
            2: {
                'name': 'string',
                'matches': {
                    'name': 'constant.character.escape',
                    'pattern': /\\('|"){1}/g
                }
            }
        },
        'pattern': /(\(|\s|\[|\=|:)(('|")([^\\\1]|\\.)*?(\3))/gm
    },
    {
        'name': 'comment',
        'pattern': /\/\*[\s\S]*?\*\/|(\/\/|\#)[\s\S]*?$/gm
    },
    {
        'name': 'constant.numeric',
        'pattern': /\b(\d+(\.\d+)?(e(\+|\-)?\d+)?(f|d)?|0x[\da-f]+)\b/gi
    },
    {
        'matches': {
            1: 'keyword'
        },
        'pattern': /\b(and|array|as|b(ool(ean)?|reak)|c(ase|atch|har|lass|on(st|tinue))|d(ef|elete|o(uble)?)|e(cho|lse(if)?|xit|xtends|xcept)|f(inally|loat|or(each)?|unction)|global|if|import|int(eger)?|long|new|object|or|pr(int|ivate|otected)|public|return|self|st(ring|ruct|atic)|switch|th(en|is|row)|try|(un)?signed|var|void|while)(?=\(|\b)/gi
    },
    {
        'name': 'constant.language',
        'pattern': /true|false|null/g
    },
    {
        'name': 'keyword.operator',
        'pattern': /\+|\!|\-|&(gt|lt|amp);|\||\*|\=/g
    },
    {
        'matches': {
            1: 'function.call'
        },
        'pattern': /(\w+?)(?=\()/g
    },
    {
        'matches': {
            1: 'storage.function',
            2: 'entity.name.function'
        },
        'pattern': /(function)\s(.*?)(?=\()/g
    }
]);

define("rainbow/js/language/generic", ["rainbow/js/rainbow"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Rainbow;
    };
}(this)));

/**
 * Javascript patterns
 *
 * @author Craig Campbell
 * @version 1.0.8
 */
Rainbow.extend('javascript', [

    /**
     * matches $. or $(
     */
    {
        'name': 'selector',
        'pattern': /(\s|^)\$(?=\.|\()/g
    },
    {
        'name': 'support',
        'pattern': /\b(window|document)\b/g
    },
    {
        'matches': {
            1: 'support.property'
        },
        'pattern': /\.(length|node(Name|Value))\b/g
    },
    {
        'matches': {
            1: 'support.function'
        },
        'pattern': /(setTimeout|setInterval)(?=\()/g

    },
    {
        'matches': {
            1: 'support.method'
        },
        'pattern': /\.(getAttribute|push|getElementById|getElementsByClassName|log|setTimeout|setInterval)(?=\()/g
    },
    {
        'matches': {
            1: 'support.tag.script',
            2: [
                {
                    'name': 'string',
                    'pattern': /('|")(.*?)(\1)/g
                },
                {
                    'name': 'entity.tag.script',
                    'pattern': /(\w+)/g
                }
            ],
            3: 'support.tag.script'
        },
        'pattern': /(&lt;\/?)(script.*?)(&gt;)/g
    },

    /**
     * matches any escaped characters inside of a js regex pattern
     *
     * @see https://github.com/ccampbell/rainbow/issues/22
     *
     * this was causing single line comments to fail so it now makes sure
     * the opening / is not directly followed by a *
     *
     * @todo check that there is valid regex in match group 1
     */
    {
        'name': 'string.regexp',
        'matches': {
            1: 'string.regexp.open',
            2: {
                'name': 'constant.regexp.escape',
                'pattern': /\\(.){1}/g
            },
            3: 'string.regexp.close',
            4: 'string.regexp.modifier'
        },
        'pattern': /(\/)(?!\*)(.+)(\/)([igm]{0,3})/g
    },

    /**
     * matches runtime function declarations
     */
    {
        'matches': {
            1: 'storage',
            3: 'entity.function'
        },
        'pattern': /(var)?(\s|^)(\S*)(?=\s?=\s?function\()/g
    },

    /**
     * matches constructor call
     */
    {
        'matches': {
            1: 'keyword',
            2: 'entity.function'
        },
        'pattern': /(new)\s+(.*)(?=\()/g
    },

    /**
     * matches any function call in the style functionName: function()
     */
    {
        'name': 'entity.function',
        'pattern': /(\w+)(?=:\s{0,}function)/g
    }
]);

define("rainbow/js/language/javascript", ["rainbow/js/language/generic"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Rainbow;
    };
}(this)));

define('text!Common/assets/tmpl/document.html',[],function () { return '<div class="content-left"></div>\n<div class="content-right"></div>\n<div class="clear"></div>';});

define('text!Common/assets/tmpl/document_topics.html',[],function () { return '<ul>\n    {{~ it.topics :topic }}\n    <li class="topic_{{! it.generateTopicClass(topic) }}">\n        <a href="{{! it.$url(\'topic\', { name: it.normalizeTopic(topic) }) }}" data-url-force="true">{{! topic }}</a>\n        <ul>\n            {{~ it.subtopics[topic] :subtopic }}\n            {{ var subtopicName = subtopic.split(\'.\'); }}\n            {{ subtopicName = subtopicName[subtopicName.length - 1]; }}\n            <li class="topic_{{! it.generateTopicClass(subtopic) }}">\n                <a href="{{! it.$url(\'topic\', { name: it.normalizeTopic(subtopic) }) }}" data-force="true">{{! subtopicName }}</a>\n            </li>\n            {{~ }}\n        </ul>\n    </li>\n    {{~}}\n</ul>\n\n<div class="go-top">\n    <div class="arrow"></div>\n</div>';});

define('css!Common/assets/css/general',[],function(){});
define('css!Common/assets/css/document',[],function(){});
define('css!rainbow/themes/github',[],function(){});
/*!
 * jQuery.ScrollTo
 * Copyright (c) 2007-2013 Ariel Flesler - aflesler<a>gmail<d>com | http://flesler.blogspot.com
 * Dual licensed under MIT and GPL.
 *
 * @projectDescription Easy element scrolling using jQuery.
 * http://flesler.blogspot.com/2007/10/jqueryscrollto.html
 * @author Ariel Flesler
 * @version 1.4.6
 *
 * @id jQuery.scrollTo
 * @id jQuery.fn.scrollTo
 * @param {String, Number, DOMElement, jQuery, Object} target Where to scroll the matched elements.
 *	  The different options for target are:
 *		- A number position (will be applied to all axes).
 *		- A string position ('44', '100px', '+=90', etc ) will be applied to all axes
 *		- A jQuery/DOM element ( logically, child of the element to scroll )
 *		- A string selector, that will be relative to the element to scroll ( 'li:eq(2)', etc )
 *		- A hash { top:x, left:y }, x and y can be any kind of number/string like above.
 *		- A percentage of the container's dimension/s, for example: 50% to go to the middle.
 *		- The string 'max' for go-to-end. 
 * @param {Number, Function} duration The OVERALL length of the animation, this argument can be the settings object instead.
 * @param {Object,Function} settings Optional set of settings or the onAfter callback.
 *	 @option {String} axis Which axis must be scrolled, use 'x', 'y', 'xy' or 'yx'.
 *	 @option {Number, Function} duration The OVERALL length of the animation.
 *	 @option {String} easing The easing method for the animation.
 *	 @option {Boolean} margin If true, the margin of the target element will be deducted from the final position.
 *	 @option {Object, Number} offset Add/deduct from the end position. One number for both axes or { top:x, left:y }.
 *	 @option {Object, Number} over Add/deduct the height/width multiplied by 'over', can be { top:x, left:y } when using both axes.
 *	 @option {Boolean} queue If true, and both axis are given, the 2nd axis will only be animated after the first one ends.
 *	 @option {Function} onAfter Function to be called after the scrolling ends. 
 *	 @option {Function} onAfterFirst If queuing is activated, this function will be called after the first scrolling ends.
 * @return {jQuery} Returns the same jQuery object, for chaining.
 *
 * @desc Scroll to a fixed position
 * @example $('div').scrollTo( 340 );
 *
 * @desc Scroll relatively to the actual position
 * @example $('div').scrollTo( '+=340px', { axis:'y' } );
 *
 * @desc Scroll using a selector (relative to the scrolled element)
 * @example $('div').scrollTo( 'p.paragraph:eq(2)', 500, { easing:'swing', queue:true, axis:'xy' } );
 *
 * @desc Scroll to a DOM element (same for jQuery object)
 * @example var second_child = document.getElementById('container').firstChild.nextSibling;
 *			$('#container').scrollTo( second_child, { duration:500, axis:'x', onAfter:function(){
 *				alert('scrolled!!');																   
 *			}});
 *
 * @desc Scroll on both axes, to different values
 * @example $('div').scrollTo( { top: 300, left:'+=200' }, { axis:'xy', offset:-20 } );
 */

;(function( $ ){
	
	var $scrollTo = $.scrollTo = function( target, duration, settings ){
		$(window).scrollTo( target, duration, settings );
	};

	$scrollTo.defaults = {
		axis:'xy',
		duration: parseFloat($.fn.jquery) >= 1.3 ? 0 : 1,
		limit:true
	};

	// Returns the element that needs to be animated to scroll the window.
	// Kept for backwards compatibility (specially for localScroll & serialScroll)
	$scrollTo.window = function( scope ){
		return $(window)._scrollable();
	};

	// Hack, hack, hack :)
	// Returns the real elements to scroll (supports window/iframes, documents and regular nodes)
	$.fn._scrollable = function(){
		return this.map(function(){
			var elem = this,
				isWin = !elem.nodeName || $.inArray( elem.nodeName.toLowerCase(), ['iframe','#document','html','body'] ) != -1;

				if( !isWin )
					return elem;

			var doc = (elem.contentWindow || elem).document || elem.ownerDocument || elem;
			
			return /webkit/i.test(navigator.userAgent) || doc.compatMode == 'BackCompat' ?
				doc.body : 
				doc.documentElement;
		});
	};

	$.fn.scrollTo = function( target, duration, settings ){
		if( typeof duration == 'object' ){
			settings = duration;
			duration = 0;
		}
		if( typeof settings == 'function' )
			settings = { onAfter:settings };
			
		if( target == 'max' )
			target = 9e9;
			
		settings = $.extend( {}, $scrollTo.defaults, settings );
		// Speed is still recognized for backwards compatibility
		duration = duration || settings.duration;
		// Make sure the settings are given right
		settings.queue = settings.queue && settings.axis.length > 1;
		
		if( settings.queue )
			// Let's keep the overall duration
			duration /= 2;
		settings.offset = both( settings.offset );
		settings.over = both( settings.over );

		return this._scrollable().each(function(){
			// Null target yields nothing, just like jQuery does
			if (target == null) return;

			var elem = this,
				$elem = $(elem),
				targ = target, toff, attr = {},
				win = $elem.is('html,body');

			switch( typeof targ ){
				// A number will pass the regex
				case 'number':
				case 'string':
					if( /^([+-]=?)?\d+(\.\d+)?(px|%)?$/.test(targ) ){
						targ = both( targ );
						// We are done
						break;
					}
					// Relative selector, no break!
					targ = $(targ,this);
					if (!targ.length) return;
				case 'object':
					// DOMElement / jQuery
					if( targ.is || targ.style )
						// Get the real position of the target 
						toff = (targ = $(targ)).offset();
			}
			$.each( settings.axis.split(''), function( i, axis ){
				var Pos	= axis == 'x' ? 'Left' : 'Top',
					pos = Pos.toLowerCase(),
					key = 'scroll' + Pos,
					old = elem[key],
					max = $scrollTo.max(elem, axis);

				if( toff ){// jQuery / DOMElement
					attr[key] = toff[pos] + ( win ? 0 : old - $elem.offset()[pos] );

					// If it's a dom element, reduce the margin
					if( settings.margin ){
						attr[key] -= parseInt(targ.css('margin'+Pos)) || 0;
						attr[key] -= parseInt(targ.css('border'+Pos+'Width')) || 0;
					}
					
					attr[key] += settings.offset[pos] || 0;
					
					if( settings.over[pos] )
						// Scroll to a fraction of its width/height
						attr[key] += targ[axis=='x'?'width':'height']() * settings.over[pos];
				}else{ 
					var val = targ[pos];
					// Handle percentage values
					attr[key] = val.slice && val.slice(-1) == '%' ? 
						parseFloat(val) / 100 * max
						: val;
				}

				// Number or 'number'
				if( settings.limit && /^\d+$/.test(attr[key]) )
					// Check the limits
					attr[key] = attr[key] <= 0 ? 0 : Math.min( attr[key], max );

				// Queueing axes
				if( !i && settings.queue ){
					// Don't waste time animating, if there's no need.
					if( old != attr[key] )
						// Intermediate animation
						animate( settings.onAfterFirst );
					// Don't animate this axis again in the next iteration.
					delete attr[key];
				}
			});

			animate( settings.onAfter );			

			function animate( callback ){
				$elem.animate( attr, duration, settings.easing, callback && function(){
					callback.call(this, targ, settings);
				});
			};

		}).end();
	};
	
	// Max scrolling position, works on quirks mode
	// It only fails (not too badly) on IE, quirks mode.
	$scrollTo.max = function( elem, axis ){
		var Dim = axis == 'x' ? 'Width' : 'Height',
			scroll = 'scroll'+Dim;
		
		if( !$(elem).is('html,body') )
			return elem[scroll] - $(elem)[Dim.toLowerCase()]();
		
		var size = 'client' + Dim,
			html = elem.ownerDocument.documentElement,
			body = elem.ownerDocument.body;

		return Math.max( html[scroll], body[scroll] ) 
			 - Math.min( html[size]  , body[size]   );
	};

	function both( val ){
		return typeof val == 'object' ? val : { top:val, left:val };
	};

})( jQuery );
define("jquery.scrollTo", ["jquery"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.$;
    };
}(this)));

define('Common/DocumentView',[
    'spoon/View',
    'jquery',
    'doT',
    'mout/string/slugify',
    'mout/array/map',
    'rainbow/js/language/javascript',
    'text!./assets/tmpl/document.html',
    'text!./assets/tmpl/document_topics.html',
    'css!./assets/css/general',
    'css!./assets/css/document',
    'css!rainbow/themes/github',
    'jquery.scrollTo'
], function (View, $, doT, slugify, map, Rainbow, tmpl, topicsTmpl) {

    

    return View.extend({
        $name: 'DocumentView',

        _element: 'div.document',
        _template: doT.template(tmpl),
        _topicsTemplate: doT.template(topicsTmpl),

        _events: {
            'click .go-top': '_onGoTopClick'
        },

        /**
         * {@inheritDoc}
         */
        initialize: function () {
            View.call(this);

            this._onScroll = this._onScroll.bind(this);
        },

        /**
         * Sets the blocks.
         *
         * @param {Array} blocks The blocks
         */
        setBlocks: function (blocks) {
            this._blocks = blocks || [];
            this._headings = [];

            return this;
        },

        /**
         * {@inheritDoc}
         */
        render: function () {
            var x,
                block;

            View.prototype.render.call(this);

            this._leftEl = this._element.find('.content-left');
            this._rightEl = this._element.find('.content-right');

            // Render each block
            for (x = 0; x < this._blocks.length; x += 1) {
                block = $('<section></section>');
                block.append($(this._blocks[x]));
                this._leftEl.append(block);
            }

            // Parse and render the topics
            this._renderTopics();

            // Listen to the scroll in order to update the active topic
            $(document).on('scroll', this._onScroll);

            // HighlighT code
            // Add data-language="javascript" because Rainbow needs it
            this._element.find('.lang-js').attr('data-language', 'javascript');
            Rainbow.color(this._element.get(0));

            return this;
        },

        /**
         * Scrolls to a given topic.
         *
         * @param {String} topic The topic
         *
         * @return {DocumentView} Chaining!
         */
        scrollTo: function (topic) {
            $.scrollTo('.' + this._generateTopicClass(topic), 300, { offset: -70 });

            return this;
        },

        /**
         * Sets the active topic.
         *
         * @param {String} topic The topic
         *
         * @return {DocumentView} Chaining!
         */
        setActive: function (topic) {
            var parent;

            topic = topic.replace(/\(\)$/g, '');

            if (this._activeTopicEl) {
                this._activeTopicEl.removeClass('active');
                parent = this._activeTopicEl.parent().parent();
                if (parent.is('li')) {
                    parent.removeClass('active');
                }
            }

            this._activeTopicEl = this._rightEl.find('.topic_' + this._generateTopicClass(topic));
            this._activeTopicEl.addClass('active');
            parent = this._activeTopicEl.parent().parent();
            if (parent.is('li')) {
                parent.addClass('active');
            }

            return this;
        },

        /**
         * Renders the topics on the right.
         */
        _renderTopics: function () {
            var currTopic,
                topics = [],
                subtopics = {},
                headings,
                menuData,
                that = this;

            // Find all headings
            headings = this._element.find('.content-left').find('h1, h2');
            headings.each(function (index, topicEl) {
                var $topicEl = $(topicEl),
                    name = $topicEl.text();

                if (topicEl.nodeName.toLowerCase() === 'h1') {
                    currTopic = name;
                    topics.push(name);
                    subtopics[name] = [];
                } else {
                    subtopics[currTopic].push(name);
                }

                $topicEl.addClass(that._generateTopicClass(name));

                // Store information about the position
                that._headings.push({
                    top: $topicEl.offset().top - 80,
                    topic: name
                });
            });

            // Render the menu
            menuData = this._fillHelpers({
                topics: topics,
                subtopics: subtopics,
                normalizeTopic: this._normalizeTopic,
                generateTopicClass: this._generateTopicClass
            });
            this._rightEl.append(this._topicsTemplate(menuData));
        },

        /**
         * Normalizes a topic.
         *
         * @param {String} topic The topic to normalize
         *
         * @return {String} The normalized topic
         */
        _normalizeTopic: function (topic) {
            // If it's an API topic, simply remove parentheses
            if (topic.indexOf('.') !== -1) {
                return topic.replace(/\(\)$/, '');
            }

            return slugify(topic);
        },

        /**
         * Generates a class name for a topic.
         *
         * @param {String} topic The topic
         *
         * @return {String} The class name
         */
        _generateTopicClass: function (topic) {
            return slugify(topic);
        },

        /**
         * Handles the scroll event.
         */
        _onScroll: function () {
            if (this._activeTopicEl) {
                this._activeTopicEl.removeClass('active');
            }

            // Find the closest heading
            var heading,
                top = $(window).scrollTop(),
                x;

            for (x = this._headings.length - 1; x >= 0; x -= 1) {
                heading = this._headings[x];
                if (top >= heading.top) {
                    this.setActive(heading.topic);
                    return;
                }
            }

            // Fallback to the first one
            this.setActive(this._headings[0].topic);
        },

        /**
         * Handles the go top click event.
         */
        _onGoTopClick: function () {
            $.scrollTo({ top: 0, left: 0 }, 300);
        },

        /**
         * {@inheritDoc}
         */
        _onDestroy: function () {
            View.prototype._onDestroy.call(this);

            $(document).off('scroll', this._onScroll);
        }
    });
});

define('text!Content/ApiReference/assets/tmpl/controller.html',[],function () { return '<h1>Controller</h1>\n<p>Extends <a href="">Joint</a> class.</p>\n<p>A controller is a node in the hierarchy that exposes a module.<br>A module is a self contained unit that encapsulates a limited set of functionality.\nWhenever you want to use a module, you do so by instantiating its controller.</p>\n<p>Since this class is <code>abstract</code> it&#39;s meant to be extended and not used directly.\nPlease read below to know how to extend it.</p>\n<h2>controller.initialize()</h2>\n<p><code>constructor</code></p>\n<p>The controller constructor has no arguments.<br>Though, when a controller is responsible for an isolated feature/functionality that requires a DOM element,\nit&#39;s good practice to declare it in the constructor.</p>\n<p>Note that all child classes should call this method.</p>\n<pre><code class="lang-js">define([&#39;spoon/Controller&#39;], function (Controller) {\n    var MyController = Controller.extend({\n        //..\n        initialize: function () {\n            Controller.call(this);\n        },\n        //..\n    });\n\n    return MyController;\n});\n\n// Instantiation example\ndefine([&#39;path/to/MyController&#39;], function (MyController) {\n    var myCtrl = new MyController();\n    //..\n});</code></pre>\n<h2>controller._states</h2>\n<p><code>protected property</code> _states</p>\n<p>An object where keys are states and values the functions to run for that state.</p>\n<pre><code class="lang-js">_states: {\n    &#39;home&#39;: &#39;_homeState&#39;,\n    &#39;show(id)&#39;: &#39;_showState&#39;,\n    &#39;filter&#39;: function (state) {\n        // state is a parameter bag\n        // also contains additional information used internally\n    }\n}</code></pre>\n<h2>controller._defaultState</h2>\n<p><code>protected property</code> _defaultState</p>\n<p>The default state name of the controller, as a <code>string</code>.<br>Defaults to <code>index</code> if the <code>index</code> state is declared in `_states.</p>\n<pre><code class="lang-js">_defaultState: &#39;home&#39;</code></pre>\n<h2>controller.getState()</h2>\n<p><code>public method</code> <em>getState()</em></p>\n<p>Get the current state or null if none is set.</p>\n<p><strong>Returns</strong></p>\n<p>State - The state.</p>\n<h2>controller.setState()</h2>\n<p><code>public method</code> <em>setState([state], [params], [options])</em></p>\n<p>Sets the current state.<br>If the state is the same, nothing happens.</p>\n<p>When the <code>state</code> is a string, you can reference ancestors states relatively and absolutely.<br>Note that this will work work if those states are registered in the <code>StateRegistry</code>.<br>Read the example below.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state (optional)</td>\n<td>String</td>\n<td>The state name.</td>\n</tr>\n<tr>\n<td>params (optional)</td>\n<td>Object</td>\n<td>The state params to be used if the state is a string.</td>\n</tr>\n<tr>\n<td>options (optional)</td>\n<td>Object</td>\n<td>The options.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Controller - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">define([&#39;spoon/Controller&#39;], function (Controller) {\n    var MyController = Controller.extend({\n        _states: {\n            &#39;index&#39;: &#39;index&#39;,\n            &#39;show(id)&#39;: &#39;show&#39;\n        },\n\n        index: function () {\n            //..\n        },\n\n        show: function (state) {\n            console.log(&#39;To be done&#39;);\n\n            // Change the state referencing a local state\n            this.setState(&#39;index&#39;);\n\n            // You can also reference a state relatively or absolutely\n            // While this might be useful in some situations, avoid using it since your module\n            // is no longer self contained and easily reusable\n\n            // Will change the global state to the parent&#39;s home state\n            this.setState(&#39;../home&#39;);\n            // Will change the global state to the root controller&#39;s home state\n            this.setState(&#39;/home&#39;);\n        }\n    });\n\n    return MyController;\n});</code></pre>\n<h2>controller.delegateState()</h2>\n<p><code>public method</code> <em>delegateState(state)</em></p>\n<p>Delegates a state to be handled by the controller.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state (optional)</td>\n<td>...mixed</td>\n<td>The state parameter bag or instance</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Controller - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">define([&#39;spoon/Controller&#39;], function (Controller) {\n    var MyController = Controller.extend({\n        _states: {\n            &#39;index&#39;: &#39;index&#39;,\n            &#39;edit(id)&#39;: &#39;edit&#39;\n        },\n\n        index: function () {\n            //..\n        },\n\n        edit: function (state) {\n            if (this._editModule) {\n                this._editModule.destroy();\n            }\n\n            this._editModule = new EditModuleController();\n            // Delegate the state to to the child controller\n            // Note that the state argument is the state parameter bag that\n            // contains not only the state parameters but also additional data\n            // about the state itself used internally by the framework\n            this._editModule.delegateState(state);\n        }\n    });\n\n    return MyController;\n});</code></pre>\n<h2>controller.generateUrl()</h2>\n<p><code>public method</code> <em>generateUrl(state, [params])</em></p>\n<p>Generates an URL for a state.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String</td>\n<td>The state name.</td>\n</tr>\n<tr>\n<td>params (optional)</td>\n<td>Object</td>\n<td>The state params.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>String - The generated URL.</p>\n<pre><code class="lang-js">define([&#39;spoon/Controller&#39;], function (Controller) {\n    var MyController = Controller.extend({\n        _states: {\n            &#39;show(id)&#39;: &#39;show&#39;\n        },\n\n        show: function (state) {\n            console.log(&#39;URL for my state is:&#39;, this.generateUrl(&#39;show&#39;, { id: state.id }));\n            //..\n        }\n    });\n\n    return MyController;\n});</code></pre>\n';});

define('text!Content/ApiReference/assets/tmpl/view.html',[],function () { return '<h1>View</h1>\n<p>Extends <a href="">Joint</a> class.</p>\n<p>A view is a node in the hierarchy that has the role to display data (model) visually.<br>The view is free to instantiate other sub-views and link them to itself so that events flow upon the hierarchy.</p>\n<h2>view.initialize()</h2>\n<p><code>constructor</code></p>\n<p>All views need an DOM element to work on.<br>This element can be passed in the view constructor.\nIf none is passed, one will generated according to the <code>_element</code> property.</p>\n<p>Note that all child classes should call this method.</p>\n<p>Since this class is <code>abstract</code> it&#39;s meant to be extended and not used directly.\nPlease read below to know how to extend it.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>element (optional)</td>\n<td>Element</td>\n<td>The DOM element for the view.</td>\n</tr>\n</tbody>\n</table>\n<pre><code class="lang-js">define([&#39;spoon/View&#39;], function (MyView) {\n    var MyView = View.extend({\n        //..\n        initialize: function () {\n            View.call(this);\n        },\n        //..\n    });\n\n    return MyView;\n});\n\n// Instantiation example\ndefine([&#39;path/to/MyView&#39;], function (MyView) {\n    var myView = new MyView();\n    //..\n});</code></pre>\n<h2>view._element</h2>\n<p><code>protected property</code> _element</p>\n<p>A CSS selector used to build an element for the view in case one is not passed to the constructor.<br>Defaults to <code>div</code>.</p>\n<pre><code class="lang-js">_element: &#39;li.item&#39;\n\n// More complex element\n_element: &#39;div#main-view[data-foo=&quot;bar&quot;]&#39;</code></pre>\n<h2>view._template</h2>\n<p><code>protected property</code> _template</p>\n<p>A function that generates an HTML string or an Element.<br>If set, the <code>render()</code> method will call this function with the supplied data.<br>Defaults to <code>null</code>.</p>\n<pre><code class="lang-js">// Handlebars example\n_template: Handlebars.compile(&#39;&lt;div&gt;{{name}}&lt;/div&gt;&#39;)\n\n// doT example\n_template: doT.template(&#39;&lt;div&gt;{{=name}}&lt;/div&gt;&#39;)</code></pre>\n<h2>view._events</h2>\n<p><code>protected property</code> _events</p>\n<p>An object where keys are event selectors and values the functions to run when the event occurs.</p>\n<pre><code class="lang-js">_events: {\n    &#39;click .delete&#39;: &#39;_onDeleteClick&#39;,\n    &#39;submit form&#39;: &#39;_onSubmit&#39;,\n    &#39;mouseenter .pic&#39;: function (event, element) {\n        // event is the jquery event\n        // element is the jquery wrapped element\n    }\n}</code></pre>\n<h2>view.getElement()</h2>\n<p><code>public method</code> <em>getElement()</em></p>\n<p>Returns the view&#39;s element.</p>\n<p><strong>Returns</strong></p>\n<p>Element - The view&#39;s element.</p>\n<h2>view.appendTo()</h2>\n<p><code>public method</code> <em>appendTo(target, [within])</em></p>\n<p>Convenience method to append the element&#39;s view to a target.\nThe target can be another view, a DOM element or a CSS selector.\nIf the target is another view, an additional selector can be passed to specify the element where it will get appended.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>target</td>\n<td>Element/String/View</td>\n<td>The target.</td>\n</tr>\n<tr>\n<td>within (optional)</td>\n<td>String</td>\n<td>The selector in case the target is a view.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>View - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">// Append to an element referenced by a CSS selector\nvar myView = new MyView();\nmyView.appendTo(&#39;#content&#39;);\n\n// Append to another view\n// parentView is a reference to another view\nvar childView = new ListItemView();\nmyView.appendTo(parentView);\n\n// Append to another view, inside a specific element of it\nvar childView = new ListItemView();\nmyView.appendTo(parentView, &#39;.container&#39;);</code></pre>\n<h2>view.prependTo()</h2>\n<p><code>public method</code> <em>prependTo(target, [within])</em></p>\n<p>Convenience method to prepend the element&#39;s view to a target.\nThe target can be another view, a DOM element or a CSS selector.\nIf the target is another view, an additional selector can be passed to specify the element where it will get appended.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>target</td>\n<td>Element/String/View</td>\n<td>The target.</td>\n</tr>\n<tr>\n<td>within (optional)</td>\n<td>String</td>\n<td>The selector in case the target is a view.</td>\n</tr>\n</tbody>\n</table>\n<p>Please read the <a href="">appendTo()</a> example as its signature is the same.</p>\n<p><strong>Returns</strong></p>\n<p>View - The instance itself to allow chaining.</p>\n<h2>view.render()</h2>\n<p><code>public method</code> <em>render(data)</em></p>\n<p>Renders the declared template with the supplied data.<br>The passed data will be feed into the template function.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>data (optional)</td>\n<td>Object/Array</td>\n<td>The data to pass to the template (defaults to <code>{}</code>).</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>View - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">var myView = new MyView();\nmyView.appendTo(&#39;#content&#39;);\nmyView.render({\n    name: &#39;Indigo United&#39;,\n    email: &#39;hello@indigounited.com&#39;\n});</code></pre>\n<h2>view.clear()</h2>\n<p><code>public method</code> <em>clear()</em></p>\n<p>Clears the view&#39;s element.<br>Note that you must explicitly call <a href="">_unlisten()</a> to remove the DOM event listeners.</p>\n<p><strong>Returns</strong></p>\n<p>View - The instance itself to allow chaining.</p>\n<h2>view._listen()</h2>\n<p><code>protected method</code> <em>_listen(events)</em></p>\n<p>Listen to a set of events.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>events</td>\n<td>Object</td>\n<td>An object with the events (defaults to the declared <code>_events</code>).</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Object - The same object.</p>\n<pre><code class="lang-js">define([&#39;spoon/View&#39;], function (MyView) {\n    var MyView = View.extend({\n        //..\n        _events: {\n            &#39;click .btn-enable&#39;: &#39;_onEnableClick&#39;,\n            &#39;click .btn-disable&#39;: &#39;_onDisableClick&#39;\n        },\n\n        _enabledEvents: {\n            &#39;click .btn-save&#39;: &#39;_onSave&#39;,\n        },\n\n        _onEnableClick: function () {\n            this._listen(this._enabledEvents);\n        },\n\n        _onDisableClick: function () {\n            this._unlisten(this._enabledEvents);\n        },\n\n        _onSave: function () {\n            this._upcast(&#39;save&#39;, { /*.. */ });\n        }\n    });\n\n    return MyView;\n});</code></pre>\n<h2>view._unlisten()</h2>\n<p><code>protected method</code> <em>_unlisten(events)</em></p>\n<p>Unlistens to events.<br>Note that the exact same object reference passed to <a href="">_listen()</a> must be used.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>events</td>\n<td>Object</td>\n<td>An object with the events.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Object - The same object.</p>\n<p>Please read the <a href="">_listen()</a> for an usage example.</p>\n';});

define('text!Content/ApiReference/assets/tmpl/joint.html',[],function () { return '<h1>Joint</h1>\n<p>A Joint is a base class that all components considered a node in the hierarchy extend from.<br>It&#39;s functionality can be resumed to:</p>\n<ul>\n<li>Link and unlink other node to form the hierarchy</li>\n<li>Ability to listen and emit events to/from linked nodes or descendants</li>\n<li>Ability to listen and emit events to/from all nodes in the hierarchy (flood/broadcast)</li>\n</ul>\n<h2>joint.initialize()</h2>\n<p>Method called when instantiating a Joint.<br>Since this class is <code>abstract</code>, it&#39;s meant to be extended and not used directly.</p>\n<h2>joint.on()</h2>\n<p><code>public method</code> <em>on(event, fn, [context])</em></p>\n<p>Adds a listener for an upcast or broadcast event.<br>Duplicate listeners for the same event will be discarded.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>fn</td>\n<td>Function</td>\n<td>The handler.</td>\n</tr>\n<tr>\n<td>context (optional)</td>\n<td>Object</td>\n<td>The context to be used to call the handler, defaults to the joint instance.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">var myView = new MyView();\nmyView.on(&#39;delete&#39;, function () {\n    console.log(&#39;user wants to delete&#39;, arguments);\n});\n\nmyView = new MyView();\nmyView.on(&#39;save&#39;, function () {\n    console.log(&#39;user wants to save&#39;, arguments);\n}, this);</code></pre>\n<h2>joint.once()</h2>\n<p><code>public method</code> <em>once(event, fn, [context])</em></p>\n<p>Adds a one time listener for an upcast or broadcast event.<br>Duplicate listeners for the same event will be discarded.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>fn</td>\n<td>Function</td>\n<td>The handler.</td>\n</tr>\n<tr>\n<td>context (optional)</td>\n<td>Object</td>\n<td>The context to be used to call the handler, defaults to the joint instance.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The instance itself to allow chaining.</p>\n<h2>joint.off()</h2>\n<p><code>public method</code> <em>off(event, fn, [context])</em></p>\n<p>Removes a previously added listener.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>fn</td>\n<td>Function</td>\n<td>The handler.</td>\n</tr>\n<tr>\n<td>context (optional)</td>\n<td>Object</td>\n<td>The context passed to the on() method.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">var MyController = Controller.extend({\n    //..\n    index: function () {\n        this._view = this._link(new MyView());\n        this._view.on(&#39;delete&#39;, this._delete, this);\n\n        // Later..\n        this._view.off(&#39;delete&#39;);\n        // Or..\n        this._view.off(&#39;delete&#39;, this._delete, this);\n    },\n\n    _delete: function () {\n        //..\n    }\n});</code></pre>\n<h2>joint.destroy()</h2>\n<p><code>public method</code> <em>destroy()</em></p>\n<p>Destroys the instance, releasing all of its resources.<br>Note that all downlinks will also be destroyed.</p>\n<p>Internally calls <code>_onDestroy()</code> only once, even on consecutive calls to <code>destroy()</code>.</p>\n<h2>joint._link()</h2>\n<p><code>protected method</code> <em>_link(joint)</em></p>\n<p>Creates a link between this joint and another one.<br>Once linked, descendants events flow upwards the hierarchy chain.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>joint</td>\n<td>Joint</td>\n<td>Another joint to link to this one.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The joint passed in as the argument.</p>\n<pre><code class="lang-js">var MyController = Controller.extend({\n    //..\n    index: function () {\n        this._view = this._link(new MyView());\n        //..\n    }\n});</code></pre>\n<h2>joint._unlink()</h2>\n<p><code>protected method</code> <em>_unlink(joint)</em></p>\n<p>Removes a previously created link between this joint and another one.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>joint</td>\n<td>Joint</td>\n<td>Another joint to link to this one.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The instance itself to allow chaining.</p>\n<h2>joint._upcast()</h2>\n<p><code>protected method</code> <em>_upcast(event, [args])</em></p>\n<p>Fires an event upwards the chain.</p>\n<p><strong>Parameters</strong>:</p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>args (optional)</td>\n<td>...mixed</td>\n<td>The arguments to pass along with the event.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">var MyView = Controller.extend({\n    _events: {\n        &#39;click .btn&#39;: &#39;_onBtnClick&#39;\n    },\n\n    _onBtnClick: function () {\n        this._upcast(&#39;activate&#39;, &#39;foo&#39;, &#39;bar&#39;);\n    }\n});</code></pre>\n<h2>joint._broadcast()</h2>\n<p><code>protected method</code> <em>_broadcast(event, [args])</em></p>\n<p>Fires an event to all the joints.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>args (optional)</td>\n<td>...mixed</td>\n<td>The arguments to pass along with the event.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Joint - The instance itself to allow chaining.</p>\n<p>Please read the <a href="">_upcast()</a> for an usage example.</p>\n<h2>joint._onDestroy()</h2>\n<p><code>protected method</code> <em>_onDestroy()</em></p>\n<p>Method called by <code>destroy()</code>.<br>Subclasses should override this method to release additional resources.<br>The default implementation will also destroy any linked joints.</p>\n';});

define('text!Content/ApiReference/assets/tmpl/broadcaster.html',[],function () { return '<h1>Broadcaster</h1>\n<p><code>service</code></p>\n<p>A service responsible to broadcast events.<br>Whenever <code>_broadcast()</code> on a <code>Joint</code> is called, this service will be responsible to deliver it\nto every node in the hierarchy.</p>\n<p>The service maybe be accessed by requiring <code>services/broadcaster</code>.<br>You can replace this service by your own if it obeys the public interface.</p>\n<pre><code class="lang-js">define([&#39;services/broadcaster&#39;], function (broadcaster) {\n    //..\n});</code></pre>\n<h2>broadcaster.on()</h2>\n<p><code>public method</code> <em>on(event, fn, [context])</em></p>\n<p>Adds a new event listener.<br>If the listener is already attached, it won&#39;t get duplicated.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>fn</td>\n<td>Function</td>\n<td>The listener.</td>\n</tr>\n<tr>\n<td>context (optional)</td>\n<td>Object</td>\n<td>The context in which the function will be executed, defaults to the instance.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Broadcaster - The instance itself to allow chaining.</p>\n<h2>broadcaster.once()</h2>\n<p><code>public method</code> <em>once(event, fn, [context])</em></p>\n<p>Adds a new event listener that is removed automatically afterwards.<br>If the listener is already attached, it won&#39;t get duplicated.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>fn</td>\n<td>Function</td>\n<td>The listener.</td>\n</tr>\n<tr>\n<td>context (optional)</td>\n<td>Object</td>\n<td>The context in which the function will be executed, defaults to the instance.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Broadcaster - The instance itself to allow chaining.</p>\n<h2>broadcaster.off()</h2>\n<p><code>public method</code> <em>off([event], [fn], [context])</em></p>\n<p>Removes an existent event listener.<br>If no fn and context is passed, removes all event listeners of a given name.<br>If no event is specified, removes all events of all names.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event (optional)</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>fn (optional)</td>\n<td>Function</td>\n<td>The listener.</td>\n</tr>\n<tr>\n<td>context (optional)</td>\n<td>Object</td>\n<td>The context passed to the on() method.</td>\n</tr>\n</tbody>\n</table>\n<h2>broadcaster.broadcast()</h2>\n<p><code>public method</code> <em>broadcast(event, [args])</em></p>\n<p>Emits a broadcast event.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>event (optional)</td>\n<td>String</td>\n<td>The event name.</td>\n</tr>\n<tr>\n<td>args (optional)</td>\n<td>...mixed</td>\n<td>The listener.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Broadcaster - The instance itself to allow chaining.</p>\n';});

define('text!Content/ApiReference/assets/tmpl/state_registry.html',[],function () { return '<h1>StateRegistry</h1>\n<p><code>service</code></p>\n<p>A service responsible for the global application state.</p>\n<p>The service maybe be accessed by requiring <code>services/state</code>.<br>You can replace this service by your own if it obeys the public interface.</p>\n<pre><code class="lang-js">define([&#39;services/state&#39;], function (stateRegistry) {\n    //..\n});</code></pre>\n<h2>stateRegistry.setAddress()</h2>\n<p><code>public method</code> <em>setAddress([address])</em></p>\n<p>Sets the address.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>address (optional)</td>\n<td>Address</td>\n<td>The address to set or null to unset it.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>StateRegistry - The instance itself to allow chaining.</p>\n<h2>stateRegistry.unsetAddress()</h2>\n<p><code>public method</code> <em>unsetAddress()</em></p>\n<p>Unsets the address.</p>\n<p><strong>Returns</strong></p>\n<p>StateRegistry - The instance itself to allow chaining.</p>\n<h2>stateRegistry.parse()</h2>\n<p><code>public method</code> <em>parse([route])</em></p>\n<p>Parses a given route.\nIf no route is passed, the current address value is used.\nIf a state is found for the route and is different from the current one, a transition\nwill occur and the change event will be emitted.</p>\n<p>This function is handy to kick-off the state registry.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>route (optional)</td>\n<td>String</td>\n<td>The route (URL fragment).</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>StateRegistry - The instance itself to allow chaining.</p>\n<h2>stateRegistry.register()</h2>\n<p><code>public method</code> <em>register(state, [pattern], [constraints])</em></p>\n<p>Registers a map between a state and a route.\nThe pattern can have placeholders which will be used to fill a parameters object.\nThe constraints object is a simple key value object in which the keys are the placeholder names and the values are regular expressions.\nAn error will be thrown if the state being registered already exists.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String</td>\n<td>The state.</td>\n</tr>\n<tr>\n<td>pattern (optional)</td>\n<td>String</td>\n<td>The route pattern.</td>\n</tr>\n<tr>\n<td>constraints (optional)</td>\n<td>Object</td>\n<td>The route contraints.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>StateRegistry - The instance itself to allow chaining.</p>\n<h2>stateRegistry.unregister()</h2>\n<p><code>public method</code> <em>unregister(state)</em></p>\n<p>Unregisters a state.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String</td>\n<td>The state.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>StateRegistry - The instance itself to allow chaining.</p>\n<h2>stateRegistry.unregisterAll()</h2>\n<p><code>public method</code> <em>unregisterAll()</em></p>\n<p>Unregisters all the registered states.</p>\n<p><strong>Returns</strong></p>\n<p>StateRegistry - The instance itself to allow chaining.</p>\n<h2>stateRegistry.isRegistered()</h2>\n<p><code>public method</code> <em>isRegistered(state)</em></p>\n<p>Checks if a state is registered.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String</td>\n<td>The state.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Boolean - True if it is, false otherwise.</p>\n<h2>stateRegistry.isRoutable()</h2>\n<p><code>public method</code> <em>isRoutable(state)</em></p>\n<p>Checks if state is registered and has a route associated to it.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String</td>\n<td>The state.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Boolean - True if it is, false otherwise.</p>\n<h2>stateRegistry.isValid()</h2>\n<p><code>public method</code> <em>isValid(state)</em></p>\n<p>Checks if a given state name is valid.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String</td>\n<td>The state.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Boolean - True if valid, false otherwise.</p>\n<h2>stateRegistry.setCurrent()</h2>\n<p><code>public method</code> <em>setCurrent(state, [params], [options])</em></p>\n<p>Sets the current state.\nIf the state is not the same, the change event will be emited.\nAlso if the state has a route associated and the routing is enabled, the browser URL will be updated accordingly.</p>\n<p>The default implementation should handle these options:</p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>- force:</td>\n<td>true to force the value to be changed even if the value is the same</td>\n</tr>\n<tr>\n<td>- route:</td>\n<td>false to not change the address value</td>\n</tr>\n<tr>\n<td>- replace:</td>\n<td>true to replace the address value instead of adding a new history entry</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String/State</td>\n<td>The state name or the state object.</td>\n</tr>\n<tr>\n<td>params (optional)</td>\n<td>Object</td>\n<td>The state parameters if the state was a string.</td>\n</tr>\n<tr>\n<td>options (optional)</td>\n<td>Object</td>\n<td>The options</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Boolean - True if the transition was made, false otherwise.</p>\n<h2>stateRegistry.getCurrent()</h2>\n<p><code>public method</code> <em>getCurrent()</em></p>\n<p>Returns the current state.</p>\n<p><strong>Returns</strong></p>\n<p>State - The state.</p>\n<h2>stateRegistry.isCurrent()</h2>\n<p><code>public method</code> <em>isCurrent(state, [params])</em></p>\n<p>Check if the current state is the same as the passed one.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String/State</td>\n<td>The state name or the state object.</td>\n</tr>\n<tr>\n<td>params (optional)</td>\n<td>Object</td>\n<td>The state parameters if the state was a string.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Boolean - True if it is, false otherwise.</p>\n<h2>stateRegistry.generateUrl()</h2>\n<p><code>public method</code> <em>generateUrl(state, [params], [absolute])</em></p>\n<p>Generates an URL for a given state.\nIf no route is associated with the state, a state:// URL will be generated.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>state</td>\n<td>String/State</td>\n<td>The state name or the state object.</td>\n</tr>\n<tr>\n<td>params (optional)</td>\n<td>Object</td>\n<td>The state parameters if the state was a string.</td>\n</tr>\n<tr>\n<td>absolute (optional)</td>\n<td>Boolean</td>\n<td>True to only generate an absolute URL, false otherwise.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>String - The URL for the state or null if unable to generate one.</p>\n<h2>stateRegistry.destroy()</h2>\n<p><code>public method</code> <em>destroy()</em></p>\n<p>Destroys the instance.</p>\n';});

define('text!Content/ApiReference/assets/tmpl/address.html',[],function () { return '<h1>Address</h1>\n<p><code>service</code></p>\n<p>A service responsible to deal with the browser address bar.<br>This service is simply an pre-configured instance of <a href="https://github.com/IndigoUnited/address">IndigoUnited/address</a>. Head over that repository to find additional documentation.</p>\n<p>Please note that you should avoid accessing this service directly. URL&#39;s are not meant to be used directly in the application,\nstates are!</p>\n<p>The service maybe be accessed by requiring <code>services/address</code>.<br>You can replace this service by your own if it obeys the public interface.</p>\n<pre><code class="lang-js">define([&#39;services/address&#39;], function (address) {\n    //..\n});</code></pre>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>options (optional)</td>\n<td>Object</td>\n<td>The options.</td>\n</tr>\n</tbody>\n</table>\n<h2>address.enable()</h2>\n<p><code>public method</code> <em>enable()</em></p>\n<p>Enables the address.</p>\n<p><strong>Returns</strong></p>\n<p>Address - The instance itself to allow chaining.</p>\n<h2>address.disable()</h2>\n<p><code>public method</code> <em>disable()</em></p>\n<p>Disables the address.</p>\n<p><strong>Returns</strong></p>\n<p>Address - The instance itself to allow chaining.</p>\n<h2>address.getValue()</h2>\n<p><code>public method</code> <em>getValue([value])</em></p>\n<p>Returns the current address value.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>value (optional)</td>\n<td>String</td>\n<td>A value to be used instead of the address bar value.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>String - The current value.</p>\n<h2>address.setValue()</h2>\n<p><code>public method</code> <em>setValue(value, [options])</em></p>\n<p>Sets the address value.\nIf the resource changed, the change event will be fired (with type internal).</p>\n<p>The default implementation should handle these options:</p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>- force:</td>\n<td>true to force the value to be changed even if the value is the same</td>\n</tr>\n<tr>\n<td>- silent:</td>\n<td>true to change the value with firing the change event</td>\n</tr>\n<tr>\n<td>- replace:</td>\n<td>true to replace the latest history entry instead of appending</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>value</td>\n<td>String</td>\n<td>The value to be set.</td>\n</tr>\n<tr>\n<td>options (optional)</td>\n<td>Object</td>\n<td>The options.</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>Address - The instance itself to allow chaining.</p>\n<pre><code class="lang-js">define([&#39;services/address&#39;], function (address) {\n    address.setValue(&#39;/&#39;, { silent: true });\n});</code></pre>\n<h2>address.reset()</h2>\n<p><code>public method</code> <em>reset()</em></p>\n<p>Resets the internal state of address.\nClears the internal value and any other state.</p>\n<p><strong>Returns</strong></p>\n<p>Address - The instance itself to allow chaining.</p>\n<h2>address.generateUrl()</h2>\n<p><code>public method</code> <em>generateUrl(value, [absolute])</em></p>\n<p>Generates an URL based on a given value.\nBy default the generated URL will be relative unless absolute is true.</p>\n<p><strong>Parameters</strong></p>\n<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n<th></th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>value</td>\n<td>String</td>\n<td>The value.</td>\n</tr>\n<tr>\n<td>absolute (optional)</td>\n<td>Boolean</td>\n<td>True to generate an absolute URL, false otherwise (defaults to false).</td>\n</tr>\n</tbody>\n</table>\n<p><strong>Returns</strong></p>\n<p>String - The generated URL.</p>\n<pre><code class="lang-js">define([&#39;services/address&#39;], function (address) {\n    address.generateUrl(&#39;home&#39;);\n});</code></pre>\n<h2>address.destroy()</h2>\n<p><code>public method</code> <em>destroy()</em></p>\n<p>Destroys the instance.</p>\n';});

define('css!Content/ApiReference/assets/css/api_reference',[],function(){});
define('Content/ApiReference/ApiReferenceView',[
    '../../Common/DocumentView',
    'text!./assets/tmpl/controller.html',
    'text!./assets/tmpl/view.html',
    'text!./assets/tmpl/joint.html',
    'text!./assets/tmpl/broadcaster.html',
    'text!./assets/tmpl/state_registry.html',
    'text!./assets/tmpl/address.html',
    'css!./assets/css/api_reference'
], function (DocumentView, controllerTmpl, viewTmpl, jointTmpl, broadcasterTmpl, stateRegistryTmpl, addressTmpl) {

    

    return DocumentView.extend({
        $name: 'ApiReferenceView',

        _element: 'div.api-reference.document',

        /**
         * {@inheritDoc}
         */
        render: function () {
            this.setBlocks([controllerTmpl, viewTmpl, jointTmpl, broadcasterTmpl, stateRegistryTmpl, addressTmpl]);

            return DocumentView.prototype.render.call(this);
        }
    });
});
define('Content/ApiReference/ApiReferenceController',[
    'spoon/Controller',
    './ApiReferenceView'
], function (Controller, ApiReferenceView) {

    

    return Controller.extend({
        $name: 'ApiReferenceController',

        _defaultState: 'index',
        _states: {
            'index': '_indexState',
            'topic(*)': '_topicState'
        },

        /**
         * Constructor.
         *
         * @param {Element} element The element in which the module will work on
         */
        initialize: function (element) {
            Controller.call(this);

            this._view = this._link(new ApiReferenceView());
            this._view.appendTo(element);
        },

        /**
         * Index state handler.
         */
        _indexState: function () {
            this._renderView();
        },

        /**
         * Topic state handler.
         *
         * @param {Object} state The state parameter bag
         */
        _topicState: function (state) {
            this._renderView();
            this._view.scrollTo(state.name);
        },

        /**
         * Renders the view once.
         */
        _renderView: function () {
            if (!this._rendered) {
                this._view.render();
                this._rendered = true;
            }
        }
    });
});

define('text!Content/Guide/assets/tmpl/motivation.html',[],function () { return '<h1>Motivation</h1>\n<p>Even though frontend development has come a long way, and there are some good solutions out there, there are two main approaches:</p>\n<ol>\n<li><p>Go &quot;light&quot;, use a thin framework, that gives you a lot of flexibility, but ultimately leaves you responsible for some tedious, repetitive, and complex tasks.</p>\n</li>\n<li><p>Go &quot;enterprise&quot;, use some solution that gives you a lot with no effort, and find yourself fighting the framework, trying to customise something.</p>\n</li>\n</ol>\n<p>Not being happy with this, and taking advantage of our experience, we set out to build a framework that would solve these issues, and a few more that were bugging us. The main drive of the framework is to help developers build solid applications faster, without that bitter-sweet feeling the development simplicity will eventually turn into a nightmare of unmaintainable code due to undocumented framework compromises or even bad options by the developer.</p>\n<p>So, without getting too deep in the details, what makes <code>SpoonJS</code> a 3rd option?</p>\n<p>It&#39;s an <code>HMVC</code> framework, the &quot;H&quot; stands for hierarchical. Unlike other frameworks, that organise the files depending on the file extension, <code>SpoonJS</code> structures the project semantically, in terms of what feature the module accomplishes in the application. What this means is that the project is composed of modules, and the modularity can be seen both in the implementation, and project organisation.</p>\n';});

define('text!Content/Guide/assets/tmpl/concepts.html',[],function () { return '<h1>Concepts</h1>\n<h2>Modular projects</h2>\n<p>One of the most important philosophies of the framework is modular projects. This means that you organise and build your project around modules that connect and work together to form the application. They are connected hierarchically, forming a tree-like structure. A good analogy is when you are playing with LEGO, where you connect together tiny parts that form blocks that ultimately becomes a real-world object.</p>\n<p>But what is a module? A module is a component that is responsible for a specific functionality or role within your application. The more self-contained the module is, the more reusable and easily testable is. This also means that all necessary assets, such as <code>css</code>, <code>images</code> and <code>templates</code>, may also be bundled within the module.</p>\n<h2>Controllers</h2>\n<p>Controllers are typically (but not necessarily) the interface for a module. Having this said, one instantiates a module by instantiating its controller.</p>\n<p>Their main responsibility is to:</p>\n<ul>\n<li><p>Control the module state and flow, in terms of what is currently being shown to the user</p>\n<p>This is done with controller states, each one maps to an action being shown/performed.\nThe controller is free to instantiate the necessary views or even other modules, linking them to itself so that events flow upon the hierarchy.</p>\n</li>\n<li><p>Listens for the view events and acts upon them, either transitioning to a new state, requesting data or something else</p>\n</li>\n<li><p>Passes the data necessary for its view(s) in order to represent the data (model) visually.</p>\n<p>Note that the data may be manipulated according to what the view expects it to be</p>\n</li>\n</ul>\n<h2>Views</h2>\n<p>Views are used to represent a set of data visually. It may use a template engine to easily construct the HTML representation and to escape data to prevent <code>XSS</code> attacks.</p>\n<p>Their main responsibility is to:</p>\n<ul>\n<li><p>Make a visual representation of a set of data (model)</p>\n<p>A view can instantiate sub-views, linking them to itself so that events flow upon the hierarchy</p>\n</li>\n<li><p>Listen to DOM events and translate them to meaningful module events</p>\n</li>\n<li><p>Manage its DOM element, being entirely responsible for it</p>\n</li>\n</ul>\n<h2>Models</h2>\n<p>Application Model is a very delicate matter and there simply isn&#39;t a one size fits all solution. There are too many approaches on how the model could be implemented, each with its advantage, and the truth is, this shouldn&#39;t be in the core of the framework.</p>\n<p>Keeping this is mind, <code>SpoonJS</code> does not offer a solution for the Model in its core, although it will be providing a few libraries that you could use. This gives you full flexibility on how to implement the Model. You can either use one of the libraries we provide, implement your own, or simply use some SDK that you have been provided.</p>\n<h2>Events</h2>\n<p>There are two types of events in: DOM events and hierarchy events. The DOM events are managed by views and possibly mapped to meaningful hierarchy events.</p>\n<p>For the hierarchy events, there are two different models of events:</p>\n<ul>\n<li>Upcast events</li>\n</ul>\n<p>Upcasting events is very useful when you need to inform the parent module of something. In case the parent module does not know how to handle that information, it will automatically upcast the event, until a module is able to handle it. In case the event reaches the root module, and is not handled, a warning is issued in the console, making it easy to spot unhandled events.</p>\n<ul>\n<li>Broadcast events</li>\n</ul>\n<p>Broadcasting can be particularly useful when you want to inform the whole application that something happened, like &quot;user logged in&quot;, which would typically involve changes in several modules.</p>\n<h2>States &amp; Routing</h2>\n<p>One of the most complex tasks that developers face when developing applications is the state management.</p>\n<p>The application state can be distributed, since an interface is usually composed of multiple modules, each with its own state. Due to the complexity of some applications, many state-of-the-art frameworks leave this task to the developer, giving him full flexibility over the state management. Unfortunately, these ad-hoc solutions are often poor, many times taking flexibility away, and the developer ultimately is forced to use <em>dirty hacks</em>, to make things work together.</p>\n<p><code>SpoonJS</code> offers a complete solution for handling state, without losing flexibility. Each controller declaratively specifies which states it can handle, and provides a handler function per state. How the state is actually handled is completely up to the developer, giving him full control over the application.</p>\n<p>The application state can be described by a simple string in the format <code>/articles.show(172)</code>. Lets take a closer look at what it means:</p>\n<ul>\n<li><code>/</code> stands for root, meaning this is a full state, and the root controller (typically the Application controller) will be the starting point.</li>\n<li><code>.</code> separates local states, which are handled by the controllers, and get removed from the full state along the handler chain. Note that this state only references two local states, <code>articles</code> and <code>show(172)</code>, but it can be more complex, like <code>articles.something.something_else(40,parameter).show(172)</code>.</li>\n<li><code>articles</code> is the first local state, and the Application controller should have a handler for it, pushing the remaining state, <code>show(172)</code>, to whatever controller that should handle it.</li>\n<li><code>show(172)</code> actually stands for the <code>show</code> state, with a parameter. When declaring a state, you can provide a list of parameters, and these get fed into the handler.</li>\n</ul>\n<p>Another aspect that is usually tightly associated with state management is routing. <code>SpoonJS</code> offers a simple routing mechanism that maps the requested URLs to their respective state, and vice-versa. This routing mechanism gives the user full flexibility on what pattern matches a state.\nSince your application only knows states, you can add the state to routes mapping when you feel opportune to do so.</p>\n<h2>Services</h2>\n<p><code>SpoonJS</code> is built upon three services: <code>services/address</code>, <code>services/state</code>, <code>services/broadcaster</code>.</p>\n<p>You will rarely need to access them directly, but they are there in case you need to. These services are easily replaced in case you need to change\nthe framework behavior. This gives developers extra flexibility to modify the framework internals. Note that throughout your application, you can build your own services.</p>\n<p>Please read the associated <a href="">API Reference</a> for more details.</p>\n';});

define('text!Content/Guide/assets/tmpl/folder_structure.html',[],function () { return '<h1>Folder structure</h1>\n<p>Most frameworks out there organise projects in terms of file extension and, although simple, it makes it hard to have reusable components, and maintain big projects. This is one aspect in which Spoon.js stands out, organising the project files in a feature oriented fashion.</p>\n<p>Please check below a typical project file structure (note that a few files are omitted for simplicity, like favicon files, among others).</p>\n<pre><code>app/\n    config/\n        config.js          // base project configurations\n        config_dev.js      // you can have separate configurations for separate environments. In order to use different configs, would load a different file in the index.html file\n        config_prod.js\n    states.js              // states to routes configuration\n    bootstrap.js           // the script that boots the application\n    loader.js              // file that setups the AMD loader\nbower_components/          // external dependencies, managed by Bower\n    spoonjs\n    events-emitter\n    ...\ntasks/                                  // place where useful tasks live\n    generators/                         // you can change the generators to tweak the scaffolding process when using the CLI\n        module_create.js\n        controller_create.js\n        view_create.js\n        ...\n    server.js\n    build.js\n    install.js\nsrc/                 // this is where your application code lives\n    Application/     // the main module\n        assets/      // this is the ideal place for placing CSS files, images, templates, or anything else you feel appropriate\n                     // note that each module has its own assets folder. When deciding where to put a specific asset, you should try to put it in a common ancestor of all the modules that use that asset. If an asset is used project-wide, you should probably place it in the Application assets.\n            css/\n            img/\n            tmpl/\n        ApplicationController.js    // the root controller (can be changed in the bootstrap file)\n        ApplicationView.js\n    Content/                        // this folder only has modules within it, but it not a module by itself. You can create these folders if it helps you organise the project\n        Articles/\n            assets/\n                css/\n                img/\n                tmpl/\n            ArticleDetailsView.js\n            ArticlesController.js\n            ArticlesListView.js\n        Help/\n            assets/\n                css/\n                img/\n                tmpl/\n            HelpController.js\n            HelpView.js\n        Home/\n            assets/\n                css/\n                img/\n                tmpl/\n            HomeController.js\n            HomeView.js\n    Footer/\n        assets/\n            css/\n            img/\n            tmpl/\n        FooterController.js\n        FooterView.js\n    Header/\n        assets/\n            css/\n            img/\n            tmpl/\n        HeaderController.js\n        HeaderView.js\n    Menu/\n        assets/\n            css/\n            img/\n            tmpl/\n        MenuController.js\n        MenuView.js\nweb/\n    index_dev.html   // the project root HTML file (dev environment)\n    index_prod.html  // the project root HTML (prod environment)\n    favicon.ico\n    …                // other files, such as robots.txt, etc</code></pre>\n<p>As you can see, each project is composed of modules, which in their turn can be composed of other modules. Each module should have a very clear responsibility within the project, thus avoiding spaghetti code.</p>\n<p>The correlation between the module purpose and the file structure makes it really simple to understand where a module lives within a project, and what composes it.</p>\n<p>Still, when dealing with reusable modules, that could show up in several places in the application, you can place the module wherever you feel the right place is. Ultimately, this is a developer&#39;s choice.</p>\n<p>Since there is a clear separation of responsibilities, some modules might end up with some option that they don&#39;t know how to handle, and need to delegate that responsibility to another module. Considering modules do not implicitly hold a reference to their parent, they upcast events, delegating the responsibility to their parent, or even broadcast events, and the whole project will listen to it.</p>\n';});

define('text!Content/Guide/assets/tmpl/sample_application.html',[],function () { return '<h1>Sample application</h1>\n<p>The following guide aims to implement an application partially. The application is named <code>repo-browser</code> and is a tool to browse <code>GitHub</code> repositories.\nWhile some areas of the application won&#39;t be implemented, they will still be scaffolded and left empty.</p>\n<p>Below are the mock ups of the application that we will implement:</p>\n<p><img src="http://f.cl.ly/items/021T130I1W0E2A353X17/home.png" alt="Home"></p>\n<p>The user types in <code>org/repo</code> clicks the arrow button and enters the repo-browser of the specified directory.\nBy default, the selected menu should be <code>CODE</code>.</p>\n<p><img src="http://f.cl.ly/items/0K0q1y2t0U21330S2q1u/issues.png" alt="Issues"></p>\n<p>If the user selects issues, a list of the repository issues is listed. If one gets clicked the issue details are shown.</p>\n<p><img src="http://f.cl.ly/items/333V2X2C3A0H2O1W3x3U/issue_details.png" alt="Issue details"></p>\n<h2>Creating the project</h2>\n<p>The easiest way to get started with a <code>SpoonJS</code> project is by installing its <code>CLI</code> with <code>npm install -g spoonjs</code>.\nAll available commands as well as help usages can be seen with <code>spoon -h</code>.</p>\n<p>First, lets create the project by running <code>spoon project create repo-browser</code>.\nThis command might take some seconds to complete since all the necessary dependencies will be installed.<br>Afterwards, lets see what the tool generated for us by spawning a server with <code>spoon project run</code>. If you open the link, you should\nsee a congratulations message.</p>\n<p>What just happen?</p>\n<p>1 - The <code>CLI</code> has scaffolded a new project based on <a href="https://github.com/amdjs/amdjs-api/wiki/AMD">AMD</a>. If you are not familiar with it, we advise you to read it to be able to understand some parts of this guide.</p>\n<p>2 - A server running the <code>dev</code> environment has been spawned. Under the hood, <code>spoon project run</code> executed the <code>automaton</code>[1] task located in <code>tasks/server</code>. This gives you freedom to tweak that task to fulfill your project needs.</p>\n<p>3 - When you opened the link, the application has been bootstrapped by the <code>ApplicationController</code>. If you check out its code, you can easily see that it started in the <code>home</code> state that simply renders the the <code>HomeView</code> which has the congratulations message you have seen.</p>\n<h2>Home screen</h2>\n<p>To ease out the process of having some styles and UI components, we will include <a href="http://twitter.github.io/bootstrap/">Bootstrap</a> from twitter. <code>SpoonJS</code> advises you to work with <a href="http://bower.io">Bower</a> to manage your dependencies. You can install it with <code>npm install -g bower</code>. Then, type <code>bower install --save components-bootstrap</code>. The <code>save</code> flag will save the dependency into the <code>bower.json</code> file located in your project root folder. Afterwards, lets include <code>bootstrap</code> it in our <code>AMD</code> loader configuration by opening the <code>app/loader.js</code> file and adding:</p>\n<pre><code class="lang-js">    //..\n    paths: {\n        //..\n        &#39;bootstrap&#39;: &#39;../bower_components/components-bootstrap&#39;\n    },\n    shim: {\n        //..\n        &#39;bootstrap/js/bootstrap&#39;: {\n            deps: [&#39;jquery&#39;],\n            exports: &#39;$&#39;\n        }\n    }\n    //..</code></pre>\n<p>Then, lets make the <code>ApplicationView</code> include the bootstrap css file:</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/View&#39;,\n    //..\n    &#39;css!./assets/css/app&#39;,\n    &#39;css!bootstrap/css/bootstrap&#39;\n], function (View, $, doT, tmpl) {\n    //..\n});</code></pre>\n<p>As explained above, the <code>ApplicationController</code> is already rendering a <code>HomeView</code>.\nIf you open it in your favorite editor[2], you will see that its rendering a <code>doT</code> template. While this is the default template engine chosen for the scaffold process, you can change it to whatever you want. The <code>_template</code> property expects a function that outputs an HTML string or a DOM element.</p>\n<p>Lets change that template to have the initial repository input field and button. Replace <code>assets/tmpl/home.html</code>  with:</p>\n<pre><code class="lang-html">&lt;div class=&quot;wrapper&quot;&gt;\n    &lt;h1&gt;repo-browser&lt;/h1&gt;\n\n    &lt;div class=&quot;control-group input-append&quot;&gt;\n        &lt;input class=&quot;input-xlarge&quot; type=&quot;text&quot; placeholder=&quot;git://github.com/org/repo.git&quot; value=&quot;&quot;&gt;\n        &lt;button class=&quot;btn&quot; type=&quot;button&quot;&gt;Go!&lt;/button&gt;\n    &lt;/div&gt;\n&lt;/div&gt;</code></pre>\n<p><strong>NOTE:</strong> We advise you to place a valid repository in the <code>value</code> property when pasting the example above in the home.html. This way you will always have a repository to test every time you reload the page without having to be filling the input every time.</p>\n<p>Lets also tweek the appearance by adding the styles below to <code>assets/css/home.css</code>.<br>Since the <code>_element</code> property of the <code>HomeView</code> is <code>div.home</code> we can style the view easily.</p>\n<pre><code class="lang-css">.home {\n    display: table;\n    width: 100%;\n    height: 100%;\n    position: absolute;\n    top: 0;\n    bottom: 0;\n}\n\n.home .wrapper {\n    display: table-cell;\n    text-align: center;\n    vertical-align: middle;\n}\n\n.home h1 {\n    margin-bottom: 70px;\n    font-size: 64px;\n    text-shadow: 1px 1px #999;\n}</code></pre>\n<p>We now want to listen for clicks in the <code>Go!</code> button to enter the application. To do so, lets declare the event in the <code>_events</code> property of the <code>HomeView</code> like so:</p>\n<pre><code class="lang-js">//..\n_events: {\n    &#39;click .btn&#39;: &#39;_onBtnClick&#39;,\n    &#39;focus .input-append&#39;: function (e, el) {\n        // Remove the error class on focus\n        // Note that in this case we are using an inline function\n        el.removeClass(&#39;error&#39;);\n    }\n},\n\n_onBtnClick: function (e, el) {\n    var matches,\n        value = this._element.find(&#39;input&#39;).val();\n\n    console.log(&#39;User clicked go!&#39;);\n\n    // Validate input value and extract org and repo information\n    matches = value.match(/^git:\\/\\/github\\.com\\/(\\S+?)\\/(\\S+?)(?:\\.git)$/);\n\n    // If it&#39;s valid, upcast the event\n    if (matches) {\n        this._upcast(&#39;go&#39;, { org: matches[1], repo: matches[2] });\n    // Otherwise style with an error\n    } else {\n        el.closest(&#39;.input-append&#39;).addClass(&#39;error&#39;);\n    }\n}\n//..</code></pre>\n<p>NOTE: Don&#39;t forget to get your application running by typing : <code>spoon project run</code>. You can optionally give a specific port in which the application will run. To do so, just add the parameter <code>--port or -p</code>. Also remind that, to check on browser console, you may have to install <code>add-ons</code> or similar in order for that to run. </p>\n<p>The <code>_upcast</code> function allows you to emit events upwards the hierarchy chain. If you open up your browser console, you should see an unhandled event reported by the framework. This occurs because no one is handling the <code>go</code> event yet. Note that we access <code>this._element</code> to to look for the input. That property is a reference to the <code>jquery</code> element of the view.</p>\n<pre><code>User clicked go! HomeView.js:21\nUnhandled upcast event &quot;go&quot;.</code></pre>\n<p>To listen for the <code>go</code> event, lets attach a listener to the view instance in the <code>ApplicationController</code>.</p>\n<pre><code class="lang-js">//.. code inside the home state handler..\nthis._content.render();\n\nthis._content.on(&#39;go&#39;, function (target) {\n    this.setState(&#39;inner&#39;, { org: target.org, repo: target.repo });\n}.bind(this));</code></pre>\n<p>In this case, we want to switch to another state which we will name <code>inner</code>. This state will be responsible for initializing the interface you see in the second mockup. If you click on the <code>Go</code> button now you should see a warning:</p>\n<pre><code>Unhandled state &quot;inner&quot; on controller &quot;ApplicationController&quot;.</code></pre>\n<p>This happened because we haven&#39;t declared the <code>inner</code> state yet. To do so, simply add it to the <code>_states</code> object and its handler in the <code>ApplicationController</code>:</p>\n<pre><code class="lang-js">_states: {\n    &#39;home&#39;: &#39;_homeState&#39;,\n    &#39;inner&#39;: &#39;_innerState&#39;\n},\n\n//..\n\n/**\n * Inner state handler.\n *\n * @param {Object} state The state parameter bag\n */\n_innerState: function (state) {\n    this._destroyContent();\n\n    console.log(&#39;Setup the inner interface!&#39;);\n}</code></pre>\n<h2>Inner GUI</h2>\n<p>In the <code>inner</code> state, the user has the ability to browse the repository, checking out the code, issues, tags, etc.</p>\n<p>Since this part of the application is somewhat complex, lets do it in a separate module named <code>Content</code>.<br>To create a module, you can also use the <code>CLI</code> by executing <code>spoon module create &lt;name&gt;</code>. For the name field, type in <code>Content</code>. The generated module comes with a controller, a view and a few assets.</p>\n<p>If you analyse the second mockup carefully, you can identify two separate areas: the menu on the left and the current menu item being shown on the right.\nWe can easily structure our app thanks to the hierarchical states. In this case, our generated <code>ContentController</code> will have a state for each menu on the left.\nIn each state, we must ensure that:</p>\n<ul>\n<li>The current selected menu on the left is the correct one</li>\n<li>Destroy and create the interface to be shown on the right</li>\n</ul>\n<p>The content shown on the right can also be somewhat complex, therefore we will generate a separate module for each one:</p>\n<ul>\n<li><code>spoon module create Content/Code</code></li>\n<li><code>spoon module create Content/Issues</code></li>\n<li><code>spoon module create Content/Tags</code></li>\n<li><code>spoon module create Content/History</code></li>\n</ul>\n<p>Now lets setup the <code>ContentController</code> to do what has been described above:</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/Controller&#39;,\n    &#39;./ContentView&#39;,\n    &#39;./Code/CodeController&#39;,\n    &#39;./Issues/IssuesController&#39;,\n    &#39;./Tags/TagsController&#39;,\n    &#39;./History/HistoryController&#39;\n], function (Controller, ContentView, CodeController, IssuesController, TagsController, HistoryController) {\n\n    &#39;use strict&#39;;\n\n    return Controller.extend({\n        $name: &#39;ContentController&#39;,\n\n        _defaultState: &#39;code&#39;,\n        _states: {\n            &#39;code&#39;: &#39;_codeState&#39;,\n            &#39;issues&#39;: &#39;_issuesState&#39;,\n            &#39;tags&#39;: &#39;_tagsState&#39;,\n            &#39;history&#39;: &#39;_historyState&#39;\n        },\n\n        /**\n         * Constructor.\n         *\n         * @param {Element} element The element in which the module will work on\n         * @param {String}  org     The GitHub org\n         * @param {String}  repo    The GitHub repo\n         */\n        initialize: function (element, org, repo) {\n            Controller.call(this);\n\n            this._org = org;\n            this._repo = repo;\n\n            this._view = this._link(new ContentView());\n            this._view.appendTo(element);\n\n            this.once(&#39;link&#39;, function () {\n                this._view.render();\n                this._rightElement = this._view.getContentElement();\n            }.bind(this));\n        },\n\n        /**\n         * Code state handler.\n         *\n         * @param {Object} state The state parameter bag\n         */\n        _codeState: function (state) {\n            this._view.selectMenu(&#39;code&#39;);\n            this._destroyContent();\n\n            this._content = this._link(new CodeController(this._rightElement, this._org, this._repo));\n            this._content.delegateState(state);\n        },\n\n        /**\n         * Issues state handler.\n         *\n         * @param {Object} state The state parameter bag\n         */\n        _issuesState: function (state) {\n            this._view.selectMenu(&#39;issues&#39;);\n            this._destroyContent();\n\n            this._content = this._link(new IssuesController(this._rightElement, this._org, this._repo));\n            this._content.delegateState(state);\n        },\n\n        /**\n         * Tags state handler.\n         *\n         * @param {Object} state The state parameter bag\n         */\n        _tagsState: function (state) {\n            this._view.selectMenu(&#39;tags&#39;);\n            this._destroyContent();\n\n            this._content = this._link(new TagsController(this._rightElement, this._org, this._repo));\n            this._content.delegateState(state);\n        },\n\n        /**\n         * History state handler.\n         *\n         * @param {Object} state The state parameter bag\n         */\n        _historyState: function (state) {\n            this._view.selectMenu(&#39;history&#39;);\n            this._destroyContent();\n\n            this._content = this._link(new HistoryController(this._rightElement, this._org, this._repo));\n            this._content.delegateState(state);\n        },\n\n        /**\n         * Destroys the current content if any.\n         */\n        _destroyContent: function () {\n            if (this._content) {\n                this._content.destroy();\n                this._content = null;\n            }\n        }\n    });\n});</code></pre>\n<p>Next lets add some HTML and CSS in the <code>ContentView</code> template and css files:</p>\n<pre><code class="lang-html">&lt;div class=&quot;left&quot;&gt;\n    &lt;div class=&quot;back&quot;&gt;\n        &lt;a class=&quot;btn btn-small&quot; href=&quot;{{! it.$url(&#39;/home&#39;) }}&quot;&gt;&lt;i class=&quot;icon-chevron-left&quot;&gt;&lt;/i&gt; Back&lt;/a&gt;\n    &lt;/div&gt;\n    &lt;ul class=&quot;nav nav-list&quot;&gt;\n        &lt;li class=&quot;nav-header&quot;&gt;repo-browser&lt;/li&gt;\n        &lt;li class=&quot;code&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;code&#39;) }}&quot;&gt;Code&lt;/a&gt;&lt;/li&gt;\n        &lt;li class=&quot;issues&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;issues&#39;) }}&quot;&gt;Issues&lt;/a&gt;&lt;/li&gt;\n        &lt;li class=&quot;tags&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;tags&#39;) }}&quot;&gt;Tags&lt;/a&gt;&lt;/li&gt;\n        &lt;li class=&quot;history&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;history&#39;) }}&quot;&gt;History&lt;/a&gt;&lt;/li&gt;\n    &lt;/ul&gt;\n&lt;/div&gt;\n&lt;div class=&quot;right&quot;&gt;&lt;/div&gt;</code></pre>\n<p>Note that we are using the <code>$url</code> helper that <code>SpoonJS</code> provides to generate an URL for a state. For other template engines, a <code>$url</code> function is also provided that does exactly the same. For <code>Handlebars</code>, there&#39;s a <code>url</code> helper that does the same. It follows just as a reference:</p>\n<pre><code class="lang-html">&lt;li class=&quot;issues&quot;&gt;&lt;a href=&quot;{{url &quot;issues&quot; }}&quot;&gt;Issues&lt;/a&gt;&lt;/li&gt;</code></pre>\n<p>While we haven&#39;t yet associated any state to an URL, the application still works. One of the advantages of mapping URL to states is to make <code>back</code> and <code>forward</code> browser buttons work. Later on we will learn how to do that.</p>\n<p>In the html code above, there&#39;s a special meaning for the <code>/home</code> state. When prefixed with a <code>/</code>, it means that we are referencing the a state absolutely. In this case, the root home state.</p>\n<p>Ok, so let&#39;s define css file for the assets/css/content.css :</p>\n<pre><code class="lang-css">.content {\n    position: absolute;\n    left: 0;\n    right: 0;\n    bottom: 0;\n    top: 0;\n}\n\n.content .left {\n    width: 199px;\n    position: absolute;\n    top: 0;\n    bottom: 0;\n    background: #EEE;\n    border-right: 1px solid #CCC;\n}\n\n.content .right {\n    float: left;\n    position: absolute;\n    left: 200px;\n    right: 0;\n    bottom: 0;\n    top: 0;\n    padding: 20px;\n}\n\n.content .left .nav {\n    margin-top: 20px;\n}\n\n.content .left .back {\n    margin-top: 15px;\n    margin-left: 15px;\n}\n\n.content .right &gt; * {\n    width: 100%;\n    height: 100%;\n}</code></pre>\n<p>Note that we will be calling two functions from the <code>ContentView</code>: <code>getContentElement()</code> and <code>selectMenu()</code>.\nLets code them:</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/View&#39;,\n    &#39;jquery&#39;,\n    &#39;doT&#39;,\n    &#39;text!./assets/tmpl/content.html&#39;,\n    &#39;css!./assets/css/content&#39;\n], function (View, $, doT, tmpl) {\n\n    &#39;use strict&#39;;\n\n    return View.extend({\n        $name: &#39;ContentView&#39;,\n\n        _element: &#39;div.content&#39;,\n        _template: doT.template(tmpl),\n\n        /**\n         * Returns the element in which the right content will be shown.\n         *\n         * @return {Object} The jQuery element\n         */\n        getContentElement: function () {\n            return this._element.find(&#39;.right&#39;);\n        },\n\n        /**\n         * Sets the active menu.\n         *\n         * @param {String} item The item to activate, valid ones are &quot;code&quot;, &quot;issues&quot;, &quot;tags&quot; and &quot;history&quot;\n         */\n        selectMenu: function (item) {\n            this._element.find(&#39;.active&#39;).removeClass(&#39;active&#39;);\n            this._element.find(&#39;.&#39; + item).addClass(&#39;active&#39;);\n        }\n    });\n});</code></pre>\n<p>Now that we have our <code>Content</code> module pretty much ready, lets instantiate it in the <code>inner</code> state of the <code>ApplicationController</code>.</p>\n<p><strong>NOTE:</strong> You must require it in the <code>define</code> statement at the top of the file.</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/Controller&#39;,\n    &#39;./ApplicationView&#39;,\n    &#39;./HomeView&#39;,\n    &#39;./../Content/ContentController&#39;\n], function (Controller, ApplicationView, HomeView, ContentController) {\n ...</code></pre>\n<pre><code class="lang-js">/**\n * Inner state handler.\n *\n * @param {Object} state The state parameter bag\n */\n_innerState: function (state) {\n    this._destroyContent();\n\n    this._content = this._link(new ContentController(&#39;#content&#39;, state.org, state.repo));\n    this._content.delegateState(state);\n}</code></pre>\n<p>Note that we call the <code>delegateState</code> on the child controller. We are basically saying to <code>ContentController</code> that we are done handling this part of the state and it&#39;s up to him to handle the rest. We have also extracted the <code>org</code> and <code>repo</code> parameters from the state parameters and passed them to the constructor.</p>\n<p>And thats it! We easily scaffolded, bootstrapped and connected quite a few modules of our application in a very rapid way. But most importantly you got a feeling of organisation and separation of concerns thanks to the modular approach of the framework.</p>\n<h2>Issues list</h2>\n<p>Next, we will work on the list of issues of a repository. As such, we will work on the isolated <code>Issues</code> module we created before.\nSince you are getting familiar with <code>SpoonJS</code>, you should spot that the <code>IssuesController</code> will have two states: one for listing the issues and another to show the details of a particular issue. More states could be implemented later, for instance, a search state in case we had the functionality to search the list of issues.</p>\n<p>Having this said, let&#39;s create the <code>index</code> state:</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/Controller&#39;,\n    &#39;./IssuesView&#39;,\n    &#39;jquery&#39;\n], function (Controller, IssuesView, $) {\n\n    &#39;use strict&#39;;\n\n    return Controller.extend({\n        $name: &#39;IssuesController&#39;,\n\n        _defaultState: &#39;index&#39;,\n        _states: {\n            &#39;index&#39;: &#39;_indexState&#39;\n        },\n\n        /**\n         * Constructor.\n         *\n         * @param {Element} element The element in which the module will work on\n         * @param {String}  org     The GitHub org\n         * @param {String}  repo    The GitHub repo\n         */\n        initialize: function (element, org, repo) {\n            Controller.call(this);\n\n            this._element = element;\n            this._org = org;\n            this._repo = repo;\n        },\n\n        /**\n         * Index state handler.\n         *\n         * @param {Object} state The state parameter bag\n         */\n        _indexState: function (state) {\n            this._destroyContent();\n\n            this._content = this._link(new IssuesView());\n            this._content.appendTo(this._element);\n            this._content.loading();\n\n            $.get(&#39;https://api.github.com/repos/&#39; + this._org + &#39;/&#39; + this._repo + &#39;/issues&#39;)\n            .then(function (data) {\n                this._content.render({\n                    org: this._org,\n                    repo: this._repo,\n                    issues: data\n                });\n            }.bind(this), function () {\n                this._content.error();\n            }.bind(this));\n        },\n\n        /**\n         * Destroys the current content if any.\n         */\n        _destroyContent: function () {\n            if (this._content) {\n                this._content.destroy();\n                this._content = null;\n            }\n        }\n    });\n});</code></pre>\n<p>The <code>index</code> state instantiates the <code>IssuesView</code>, putting it into loading state. Afterwards, the issues from the repository are fetched through an <code>AJAX</code> call. Note that we advise users to create a <code>model</code> layer that is responsible to do these kind of requests but we will skip that for the sake of simplicity. When the request is done and succeeds, we call render with the array of issues, otherwise we put the <code>IsusesView</code> into error state.</p>\n<p><strong>NOTE:</strong> In order to keep this example simple as it should be, we&#39;ll not be dealing with pagination. Since git API returns chuncked data accessible through an offset and a limit, we&#39;ll keep our focus into just the first set of data received and we&#39;ll be displaying a flat array of elements not going deep into all results that git might have available. </p>\n<p>As seen above, we need to implement the <code>loading()</code> and <code>error()</code> methods in the <code>IssuesView</code> as well as its template and some styles to make the list look like the mockups:</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/View&#39;,\n    &#39;jquery&#39;,\n    &#39;doT&#39;,\n    &#39;text!./assets/tmpl/issues.html&#39;,\n    &#39;css!./assets/css/issues&#39;\n], function (View, $, doT, tmpl) {\n\n    &#39;use strict&#39;;\n\n    return View.extend({\n        $name: &#39;IssuesView&#39;,\n\n        _element: &#39;div.issues&#39;,\n        _template: doT.template(tmpl),\n\n        /**\n         * Sets the view state to loading.\n         */\n        loading: function () {\n            this._element.empty();\n            this._element.removeClass(&#39;error&#39;);\n            this._element.addClass(&#39;loading&#39;);\n        },\n\n        /**\n         * Sets the view state to error.\n         */\n        error: function () {\n            this._element.html(&#39;Oops, something went wrong..&#39;);\n            this._element.removeClass(&#39;loading&#39;);\n            this._element.addClass(&#39;error&#39;);\n        },\n\n        /**\n         * {@inheritDoc}\n         */\n        render: function (data) {\n            this._element.removeClass(&#39;loading error&#39;);\n\n            return View.prototype.render.call(this, data);\n        }\n    });\n});</code></pre>\n<pre><code class="lang-html">&lt;ul class=&quot;breadcrumb&quot;&gt;\n  &lt;li&gt;&lt;a href=&quot;{{! it.$url(&#39;../code&#39;) }}&quot;&gt;{{! it.org }}/{{! it.repo }}&lt;/a&gt; &lt;span class=&quot;divider&quot;&gt;/&lt;/span&gt;&lt;/li&gt;\n  &lt;li class=&quot;active&quot;&gt;Issues&lt;/li&gt;\n&lt;/ul&gt;\n\n&lt;ul class=&quot;issues-list&quot;&gt;\n    {{~it.issues :issue}}\n    &lt;li class=&quot;clearfix&quot;&gt;\n        &lt;div class=&quot;main-info&quot;&gt;\n            &lt;div class=&quot;title&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;details&#39;, { nr: issue.number }) }}&quot;&gt;{{! issue.title }}&lt;/a&gt; &lt;span class=&quot;nr&quot;&gt;(#{{! issue.number }})&lt;/span&gt;&lt;/div&gt;\n            &lt;div class=&quot;by&quot;&gt;Open by &lt;span class=&quot;user&quot;&gt;{{! issue.user.login }}&lt;/span&gt; {{! issue.created_at }}&lt;/div&gt;\n        &lt;/div&gt;\n        &lt;div class=&quot;labels&quot;&gt;\n            &lt;ul&gt;\n                {{~issue.labels :label}}\n                &lt;li style=&quot;background-color: #{{! label.color }}&quot;&gt;{{! label.name }}&lt;/li&gt;\n                {{~}}\n            &lt;/ul&gt;\n        &lt;/div&gt;\n    &lt;/li&gt;\n    {{~}}\n&lt;/ul&gt;</code></pre>\n<pre><code class="lang-css">.issues.loading {\n    background: url(&#39;../img/ajax-loader.gif&#39;) no-repeat center center;\n}\n\n.issues ul {\n    list-style: none;\n    margin: 0;\n}\n\n.issues .issues-list {\n    margin-top: 30px;\n}\n\n.issues .issues-list &gt; li {\n    border: 1px solid #e7e7e7;\n    border-bottom: 1px solid #ddd;\n    box-shadow: 0 1px 3px 0 #eee;\n    border-radius: 3px;\n    padding: 10px;\n    margin-top: 10px;\n}\n\n.issues .issues-list &gt; li:first-child {\n    margin-top: 0;\n}\n\n.issues .issues-list .main-info {\n    float: left;\n}\n\n.issues .issues-list .title {\n    font-size: 20px;\n}\n\n.issues .issues-list .nr {\n    font-size: 15px;\n}\n\n.issues .issues-list .by {\n    color: #666;\n}\n\n.issues .issues-list .user {\n    color: #0088CC;\n}\n\n.issues .issues-list .labels {\n    float: right;\n}\n\n.issues .issues-list .labels li {\n    float: left;\n    border-radius: 3px;\n    padding: 10px;\n    margin-left: 10px;\n}</code></pre>\n<p>Note that for the <code>loading</code> style we are using an animated gif downloaded from <a href="http://www.ajaxload.info/">ajaxload</a>. Feel free to download one of the available animated gifs and adjust the <code>issues.loading</code> css class.<br>The gif is located within the <code>img</code> folder of the module (repo-browser/src/Content/Issues/assets/img). If for some reason, this asset is shared across the application, you can store it where you feel more appropriate (e.g.: in the Application <code>assets/img</code> folder).</p>\n<h2>Issues details</h2>\n<p>The <code>details</code> state is very similar to what&#39;s being done in the <code>index</code> state in terms of flow. The only thing that changes is the GitHub API request and the view being rendered.\nAs such, we will need a new view that will be responsible to render the issue details. To create a view, you can use the <code>CLI</code> by executing <code>spoon view create &lt;name&gt;</code>. For the name field, type in <code>Content/Issues/IssueDetails</code>. This will generate the view as well as its <code>template</code> and <code>css</code> file.</p>\n<p>Let&#39;s start by creating the <code>details</code> state in the <code>IssuesController</code>:</p>\n<pre><code class="lang-js">_states: {\n    &#39;index&#39;: &#39;_indexState&#39;,\n    &#39;details(nr)&#39;: &#39;_detailsState&#39;\n},\n\n//..\n\n/**\n * Details state handler.\n *\n * @param {Object} state The state parameter bag\n */\n_detailsState: function (state) {\n    this._destroyContent();\n\n    this._content = this._link(new IssueDetailsView());\n    this._content.appendTo(this._element);\n    this._content.loading();\n\n    // Make both details and comments requests\n    $.when(\n        $.get(&#39;https://api.github.com/repos/&#39; + this._org + &#39;/&#39; + this._repo + &#39;/issues/&#39; + state.nr),\n        $.get(&#39;https://api.github.com/repos/&#39; + this._org + &#39;/&#39; + this._repo + &#39;/issues/&#39; + state.nr + &#39;/comments&#39;)\n    ).then(function (first, second) {\n        this._content.render({\n            org: this._org,\n            repo: this._repo,\n            issue: first[0],\n            comments: second[0]\n        });\n    }.bind(this), function () {\n        this._content.error();\n    }.bind(this));\n}</code></pre>\n<p><strong>Don&#39;t forget</strong> to require the <code>IssueDetailsView</code> at the top of the file.</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/Controller&#39;,\n    &#39;./IssuesView&#39;,\n    &#39;./IssueDetailsView&#39;,\n    &#39;jquery&#39;\n], function (Controller, IssuesView, IssueDetailsView, $) {\n ...</code></pre>\n<p>After, let&#39;s code the <code>IssueDetailsView</code> and tweak its <code>template</code> and <code>css</code> file:</p>\n<pre><code class="lang-js">define([\n    &#39;spoon/View&#39;,\n    &#39;jquery&#39;,\n    &#39;doT&#39;,\n    &#39;text!./assets/tmpl/issue_details.html&#39;,\n    &#39;css!./assets/css/issue_details&#39;\n], function (View, $, doT, tmpl) {\n\n    &#39;use strict&#39;;\n\n    return View.extend({\n        $name: &#39;IssueDetailsView&#39;,\n\n        _element: &#39;div.issue-details&#39;,\n        _template: doT.template(tmpl),\n\n        /**\n         * Sets the view state to loading.\n         */\n        loading: function () {\n            this._element.empty();\n            this._element.removeClass(&#39;error&#39;);\n            this._element.addClass(&#39;loading&#39;);\n        },\n\n        /**\n         * Sets the view state to error.\n         */\n        error: function () {\n            this._element.html(&#39;Oops, something went wrong..&#39;);\n            this._element.removeClass(&#39;loading&#39;);\n            this._element.addClass(&#39;error&#39;);\n        },\n\n        /**\n         * {@inheritDoc}\n         */\n        render: function (data) {\n            this._element.removeClass(&#39;loading error&#39;);\n\n            return View.prototype.render.call(this, data);\n        }\n    });\n});</code></pre>\n<pre><code class="lang-html">&lt;ul class=&quot;breadcrumb&quot;&gt;\n  &lt;li&gt;&lt;a href=&quot;{{! it.$url(&#39;../code&#39;) }}&quot;&gt;{{! it.org }}/{{! it.repo }}&lt;/a&gt; &lt;span class=&quot;divider&quot;&gt;/&lt;/span&gt;&lt;/li&gt;\n  &lt;li&gt;&lt;a href=&quot;{{! it.$url(&#39;index&#39;) }}&quot;&gt;Issues&lt;/a&gt; &lt;span class=&quot;divider&quot;&gt;/&lt;/span&gt;&lt;/li&gt;\n  &lt;li class=&quot;active&quot;&gt;{{! it.issue.title}}&lt;/li&gt;\n&lt;/ul&gt;\n\n&lt;div class=&quot;issue-box&quot;&gt;\n    &lt;div class=&quot;user-avatar&quot;&gt;&lt;img src=&quot;{{! it.issue.user.avatar_url }}&quot; alt=&quot;{{! it.issue.user.login }}&quot; /&gt;&lt;/div&gt;\n    &lt;div class=&quot;issue-wrapper&quot;&gt;\n        &lt;div class=&quot;clearfix&quot;&gt;\n            &lt;div class=&quot;main-info&quot;&gt;\n                &lt;div class=&quot;title&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;details&#39;, { nr: it.issue.number }) }}&quot;&gt;{{! it.issue.title }}&lt;/a&gt; &lt;span class=&quot;nr&quot;&gt;(#{{! it.issue.number }})&lt;/span&gt;&lt;/div&gt;\n                &lt;div class=&quot;by&quot;&gt;Open by &lt;span class=&quot;user&quot;&gt;{{! it.issue.user.login }}&lt;/span&gt; {{! it.issue.created_at }}&lt;/div&gt;\n            &lt;/div&gt;\n            {{ if (it.issue.labels.length) { }}}\n            &lt;div class=&quot;labels&quot;&gt;\n                &lt;ul&gt;\n                    {{~it.issue.labels :label}}\n                    &lt;li style=&quot;background-color: #{{! label.color }}&quot;&gt;{{! label.name }}&lt;/li&gt;\n                    {{~}}\n                &lt;/ul&gt;\n            &lt;/div&gt;\n            {{ } }}\n        &lt;/div&gt;\n        &lt;div class=&quot;body&quot;&gt;{{! it.issue.body }}&lt;/div&gt;\n    &lt;/div&gt;\n&lt;/div&gt;\n\n{{ if (it.issue.comments &gt; 0) { }}\n&lt;div class=&quot;issue-details issue-wrapper comments-total&quot;&gt;{{! it.issue.comments}} comment{{ if (it.issue.comments &gt; 1) { }}s{{ } }}&lt;/div&gt;\n&lt;div&gt;\n    {{~it.comments :comment}}\n        &lt;div class=&quot;issue-box&quot;&gt;\n            &lt;div class=&quot;issue-wrapper&quot;&gt;\n                &lt;div class=&quot;clearfix&quot;&gt;\n                    &lt;div class=&quot;main-info&quot;&gt;\n                        &lt;div class=&quot;by&quot;&gt;&lt;span class=&quot;user comment&quot;&gt;comment by&lt;/span&gt; &lt;span class=&quot;user&quot;&gt;{{! comment.user.login }}&lt;/span&gt; {{! comment.created_at }}&lt;/div&gt;\n                    &lt;/div&gt;\n                &lt;/div&gt;\n                &lt;div class=&quot;body&quot;&gt;{{! comment.body }}&lt;/div&gt;\n            &lt;/div&gt;\n        &lt;/div&gt;\n    {{~}}    \n&lt;/div&gt;\n{{ } }}</code></pre>\n<pre><code class="lang-css">.issue-details.loading {\n    background: url(&#39;../img/ajax-loader.gif&#39;) no-repeat center center;\n}\n\n.issue-details ul {\n    list-style: none;\n}\n\n.issue-details .issue-box {\n    position: relative;\n}\n\n.issue-details .issue-wrapper {\n    border: 1px solid #e7e7e7;\n    border-bottom: 1px solid #ddd;\n    box-shadow: 0 1px 3px 0 #eee;\n    border-radius: 3px;\n    padding: 10px;\n    margin-top: 10px;\n    margin-left: 60px;\n}\n\n.issue-details .user-avatar {\n    position: absolute;\n    top: 0;\n    left: 0;\n}\n\n.issue-details .user-avatar img {\n    width: 50px;\n    height: 50px;\n    border-radius: 3px;\n}\n\n.issue-details .main-info {\n    float: left;\n}\n\n.issue-details .labels {\n    float: right;\n}\n\n.issue-details .labels li {\n    float: left;\n    border-radius: 3px;\n    padding: 10px;\n    margin-left: 10px;\n}\n\n.issue-details .body {\n    margin-top: 10px;\n    border-radius: 3px;\n    background: #EEE;\n    padding: 20px;\n}\n\n.user {\n    font-size: 13px;\n    font-weight: bold;\n}\n\n.user.comment {\n    color: #0088CC;\n    font-weight: normal;\n}\n\n.comments-total {\n    color: #D96868;\n}</code></pre>\n<h2>State URLs</h2>\n<p>As mentioned before, you can map states to URLs. This will add support for back &amp; forward buttons, bookmarkable URLs among other things. These mappings can be done in the <code>app/config/states.js</code> file.</p>\n<pre><code class="lang-js">define(function () {\n\n    &#39;use strict&#39;;\n\n    return {\n        home: &#39;/&#39;,\n        inner: {\n            $pattern: &#39;/{org}/{repo}&#39;,\n            code: &#39;/&#39;,\n            issues: {\n                index: &#39;/&#39;,\n                details: {\n                    $pattern: &#39;/{nr}&#39;,\n                    $constraints: {\n                        nr: /\\d+/\n                    }\n                }\n            },\n            tags: &#39;/tags&#39;,\n            history: &#39;/history&#39;\n        }\n    };\n});</code></pre>\n<p>Since states are hierarchical, states in this file are declared with nesting. For instance, the state <code>inner.issues.index</code> maps exactly to that object key.</p>\n<p>There are some special keywords, prefixed with <code>$</code>, that have special meanings:</p>\n<ul>\n<li><code>$pattern</code> - Used to specify a pattern other than the assumed key.</li>\n<li><code>$fullPattern</code> - Used to specify the complete pattern.</li>\n<li><code>$constraints</code> - Adds validation to pattern parameters; If a constraint fails, the state is not matched.</li>\n<li><code>$order</code> - Used to specify the match order, since objects do not ensure order. The higher, the more precende they have.</li>\n</ul>\n<p>As we can see, there is a state that depends on 2 parameters <code>org</code> and <code>repo</code>.\nThis means that if either one changes, the state handler will be run. \n<strong>NOTE</strong> If a state is transitioned to itself, nothing will be done. </p>\n<p>Now try to run the application and access the issues list. \n<em>Did it work?</em></p>\n<p>As you could see in the browser console, the application failed to run, giving an error:</p>\n<pre><code>Error: Missing param &quot;org&quot;.\n    throw new Error(&#39;Missing param &quot;&#39; + placeholderName + &#39;&quot;.&#39;);</code></pre>\n<p>This happened precisely because the inner state depends on those two parameters we previously refered to. So, in order this to run, you&#39;ll have to inform your <code>ApplicationController</code> state <code>inner</code> that it should expect parameters. </p>\n<pre><code class="lang-js">    _states: {\n        &#39;home&#39;: &#39;_homeState&#39;,\n        &#39;inner(org, repo)&#39;: &#39;_innerState&#39;\n    },</code></pre>\n<p><strong>NOTE:</strong> As you can recall, in &#39;Content/assets/tmpl/content.html&#39; when defining the state urls, you did not define any additional parameters to that states, and you shouldn&#39;t either. It&#39;s up to <code>SpoonJS</code> framework to handle the state and understand that, somewhere up in the hierarchy, there are parameters that need to be added to the state (and are part of it) regardless you map or not the state to an URL representation.</p>\n<h2>Extras</h2>\n<h3>Date Plugin</h3>\n<p>As you could see when you ran the application, the date fields were not very user friendly, so now we&#39;re placing a possible solution to overcome that situation. For this example application we&#39;ll be using a jquery plugin called <code>timeago</code> that will allow us to see dates as time references. e.g. <code>1 minute ago</code>. More information can be seen here: <a href="http://timeago.yarp.com/"><a href="http://timeago.yarp.com/">http://timeago.yarp.com/</a></a></p>\n<p>To install the plugin into your application, you should ùse <code>bower</code> to install the dependencies. If you&#39;re having trouble remembering the full name of the dependency you want to install, you can query <code>bower</code> for a specific string by typing <code>bower search time</code>, that will outcome :</p>\n<pre><code>Search results:\n    ...\n    jquery-timeago git://github.com/rmm5t/jquery-timeago.git\n    ...</code></pre>\n<p>By looking at the results you can see that the plugin we&#39;re looking for is available, so let&#39;s install it locally into our sample application. Let&#39;s also add the <code>save</code> option to include the dependency into our project. </p>\n<pre><code>bower install jquery-timeago --save</code></pre>\n<p>Now we have component installed, he have to add it to the application loader <code>app/loader.js</code> so it will be avaiable globally to all modules. With this said :</p>\n<pre><code>paths: {\n        ...\n        &#39;bootstrap&#39;: &#39;../components/components-bootstrap&#39;,\n        &#39;jquery-timeago&#39;: &#39;../components/jquery-timeago/jquery.timeago&#39;\n    },\n    shim: {\n        &#39;bootstrap/js/bootstrap&#39;: {\n            deps: [&#39;jquery&#39;],\n            exports: &#39;$&#39;\n        },\n        &#39;jquery-timeago&#39;: {\n            deps: [&#39;jquery&#39;],\n            exports: &#39;$&#39;\n        }\n    },\n    ...</code></pre>\n<p>Notice that, since jquery-timeago needs jquery to be loaded in order for it to work, we have to &quot;shim it&quot;, so the shim configuration is needed above where we read that our plugin depends on jquery being loaded and exported as &#39;$&#39; variable. </p>\n<p>Now let&#39;s put things to work. We&#39;ll start by the issues list. So the new html for the <code>src/Content/Issues/assets/tmpl/issues.html</code> will be:</p>\n<pre><code class="lang-html">&lt;ul class=&quot;breadcrumb&quot;&gt;\n  &lt;li&gt;&lt;a href=&quot;{{! it.$url(&#39;../code&#39;) }}&quot;&gt;{{! it.org }}/{{! it.repo }}&lt;/a&gt; &lt;span class=&quot;divider&quot;&gt;/&lt;/span&gt;&lt;/li&gt;\n  &lt;li class=&quot;active&quot;&gt;Issues&lt;/li&gt;\n&lt;/ul&gt;\n\n&lt;ul class=&quot;issues-list&quot;&gt;\n    {{~it.issues :issue}}\n    &lt;li class=&quot;clearfix&quot;&gt;\n        &lt;div class=&quot;main-info&quot;&gt;\n            &lt;div class=&quot;title&quot;&gt;&lt;a href=&quot;{{! it.$url(&#39;details&#39;, { nr: issue.number }) }}&quot;&gt;{{! issue.title }}&lt;/a&gt; &lt;span class=&quot;nr&quot;&gt;(#{{! issue.number }})&lt;/span&gt;&lt;/div&gt;\n            &lt;div class=&quot;by&quot;&gt;Open by &lt;span class=&quot;user&quot;&gt;{{! issue.user.login }}&lt;/span&gt; &lt;abbr class=&quot;timeago&quot; title=&quot;{{! issue.created_at }}&quot;&gt;{{! issue.created_at }}&lt;/abbr&gt;&lt;/div&gt;\n        &lt;/div&gt;\n        &lt;div class=&quot;labels&quot;&gt;\n            &lt;ul&gt;\n                {{~issue.labels :label}}\n                &lt;li style=&quot;background-color: #{{! label.color }}&quot;&gt;{{! label.name }}&lt;/li&gt;\n                {{~}}\n            &lt;/ul&gt;\n        &lt;/div&gt;\n    &lt;/li&gt;\n    {{~}}\n&lt;/ul&gt;</code></pre>\n<p>With this new html, we&#39;ll be able to apply the plugin to the date fields. \n<strong>NOTE:</strong> When the plugin is first applied to a field, it starts a timer that fires periodically thus updating the time info seen by the end users. </p>\n<p>We also need to performe some changes in the <code>IssuesView</code>. These changes will be responsible for updating the date fields we&#39;ve defined previously in the html file. Basically, all we need to do is to import the plugin into the view and when rendering the template, apply the plugin to the respective fields. </p>\n<pre><code class="lang-js">define([\n    &#39;spoon/View&#39;,\n    &#39;jquery&#39;,\n    &#39;doT&#39;,\n    &#39;text!./assets/tmpl/issues.html&#39;,\n    &#39;css!./assets/css/issues&#39;,\n    &#39;jquery-timeago&#39;\n], function (View, $, doT, tmpl) {\n ...</code></pre>\n<p>The plugin import is the last in the queue because we chose to and we advise it to be like so. You can also see that we don&#39;t require the variable the variable as function parameters. This is because we don&#39;t a specific variable to that plugin since it&#39;s already bound to jquery, so we only need to use &#39;$&#39; and we have access to the plugin features and functions. </p>\n<p>By now, we only need to update the <code>render</code> function in the <code>IssuesView</code>.</p>\n<pre><code class="lang-js">    /**\n     * {@inheritDoc}\n     */\n    render: function (data) {\n        this._element.removeClass(&#39;loading error&#39;);\n\n        // just render the view, without returning it\n        // since we need the view rendered prior to \n        // applying the timeago() function\n        View.prototype.render.call(this, data);\n\n        // apply the timeago() function to all data elements\n        this._element.find(&#39;abbr.timeago&#39;).timeago();\n\n        // return this to allow method chaining\n        return this;\n    }</code></pre>\n<p>By now, you should be able to run the application and see the effect, so, try it out. </p>\n<p>We&#39;re almost done here. You just need to apply this changes to <code>IssueDetailsView</code> also. It should be pretty straightforward to you now, so please do so. </p>\n<h3>Markdown Renderer</h3>\n<p>With this tool applied to issues details, we&#39;ll be able to see markdown notation compiled to HTML notation. If you run the application now, you&#39;ll see that markdown is not recognized as HTMl being shown as plain text. To give a better style of that tags, let&#39;s install this tool:</p>\n<pre><code>bower install marked --save</code></pre>\n<p>So, for the tool to be available throughout the application, we have to add the dependency in the <code>app/loader</code>. So it comes:</p>\n<pre><code class="lang-js">paths: {\n        ...\n        &#39;jquery-timeago&#39;: &#39;../components/jquery-timeago/jquery.timeago&#39;,\n        &#39;marked&#39;: &#39;../components/marked/lib/marked&#39;\n    },</code></pre>\n<p>Now, we&#39;re going to apply this tool to all texts in the <code>IssueDetailsView</code>. \nThis means that all texts with markdown tags will be converted into html thus being rendered normally in the browser. </p>\n<pre><code class="lang-js">    /**\n     * {@inheritDoc}\n     */\n    render: function (data) {\n        this._element.removeClass(&#39;loading error&#39;);\n\n        View.prototype.render.call(this, data);\n\n        // apply the tool to all body texts (comments included)\n        $(&#39;div .body&#39;).each(function () {\n            $(this).html(marked($(this).html()));\n        });\n\n        this._element.find(&#39;abbr.timeago&#39;).timeago();\n\n        return this;\n    }</code></pre>\n';});

define('css!Content/Guide/assets/css/guide',[],function(){});
define('Content/Guide/GuideView',[
    '../../Common/DocumentView',
    'text!./assets/tmpl/motivation.html',
    'text!./assets/tmpl/concepts.html',
    'text!./assets/tmpl/folder_structure.html',
    'text!./assets/tmpl/sample_application.html',
    'css!./assets/css/guide'
], function (DocumentView, motivationTmpl, conceptsTmpl, folderStructureTmpl, sampleAppTmpl) {

    

    return DocumentView.extend({
        $name: 'GuideView',

        _element: 'div.guide.document',

        /**
         * {@inheritDoc}
         */
        render: function () {
            this.setBlocks([motivationTmpl, conceptsTmpl, folderStructureTmpl, sampleAppTmpl]);

            return DocumentView.prototype.render.call(this);
        }
    });
});
define('Content/Guide/GuideController',[
    'spoon/Controller',
    './GuideView'
], function (Controller, GuideView) {

    

    return Controller.extend({
        $name: 'GuideController',

        _defaultState: 'index',
        _states: {
            'index': '_indexState',
            'topic(name)': '_topicState'
        },

        /**
         * Constructor.
         *
         * @param {Element} element The element in which the module will work on
         */
        initialize: function (element) {
            Controller.call(this);

            this._view = this._link(new GuideView());
            this._view.appendTo(element);
        },

        /**
         * Index state handler.
         */
        _indexState: function () {
            this._renderView();
        },

        /**
         * Topic state handler.
         *
         * @param {Object} state The state parameter bag
         */
        _topicState: function (state) {
            this._renderView();
            this._view.scrollTo(state.name);
        },

        /**
         * Renders the view once.
         */
        _renderView: function () {
            if (!this._rendered) {
                this._view.render();
                this._rendered = true;
            }
        }
    });
});

define('Application/ApplicationController',[
    'spoon/Controller',
    './ApplicationView',
    '../Content/Home/HomeView',
    '../Content/ApiReference/ApiReferenceController',
    '../Content/Guide/GuideController'
], function (Controller, ApplicationView, HomeView, ApiReferenceController, GuideController) {

    

    return Controller.extend({
        $name: 'ApplicationController',

        _defaultState: 'guide',
        _states: {
            'home': '_homeState',
            'api': '_apiState',
            'guide': '_guideState'
        },

        /**
         * {@inheritDoc}
         */
        initialize: function () {
            Controller.call(this);

            // Instantiate and render the application view
            this._view = this._link(new ApplicationView());
            this._view
                .appendTo(document.body)
                .render();
        },

        /**
         * Home state handler.
         */
        _homeState: function () {
            this._destroyContent();

            this._view.setActiveMenu('home');
            this._content = this._link(new HomeView());
            this._content
                .appendTo(this._view, '.app-content')
                .render();
        },

        /**
         * Api state handler.
         *
         * @param {Object} state The state parameter bag
         */
        _apiState: function (state) {
            this._destroyContent();

            this._view.setActiveMenu('api');
            this._content = this._link(new ApiReferenceController('.app-content'));
            this._content.delegateState(state);
        },

        /**
         * Guide state handler.
         *
         * @param {Object} state The state parameter bag
         */
        _guideState: function (state) {
            this._destroyContent();

            this._view.setActiveMenu('guide');
            this._content = this._link(new GuideController('.app-content'));
            this._content.delegateState(state);
        },


        /**
         * Destroys the current content if any.
         */
        _destroyContent: function () {
            if (this._content) {
                this._content.destroy();
                this._content = null;
            }
        }
    });
});

require([
    'Application/ApplicationController',
    'services/state',
    'jquery'
], function (ApplicationController, stateRegistry, $) {

    

    $(document).ready(function () {
        // Initialize the Application controller
        var appController = new ApplicationController();

        // Listen to the state change event
        stateRegistry.on('change', appController.delegateState, appController);

        // Call parse() to make the state registry read the address value
        stateRegistry.parse();
    });
});

define("../app/bootstrap", function(){});
