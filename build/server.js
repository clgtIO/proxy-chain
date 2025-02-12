'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.Server = exports.RequestError = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _http = require('http');

var _http2 = _interopRequireDefault(_http);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

var _underscore = require('underscore');

var _underscore2 = _interopRequireDefault(_underscore);

var _tools = require('./tools');

var _handler_forward = require('./handler_forward');

var _handler_forward2 = _interopRequireDefault(_handler_forward);

var _handler_tunnel_direct = require('./handler_tunnel_direct');

var _handler_tunnel_direct2 = _interopRequireDefault(_handler_tunnel_direct);

var _handler_tunnel_chain = require('./handler_tunnel_chain');

var _handler_tunnel_chain2 = _interopRequireDefault(_handler_tunnel_chain);

var _handler_custom_response = require('./handler_custom_response');

var _handler_custom_response2 = _interopRequireDefault(_handler_custom_response);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

// TODO:
// - Fail gracefully if target proxy fails (invalid credentials or non-existent)
// - Implement this requirement from rfc7230
//   "A proxy MUST forward unrecognized header fields unless the field-name
//    is listed in the Connection header field (Section 6.1) or the proxy
//    is specifically configured to block, or otherwise transform, such
//    fields.  Other recipients SHOULD ignore unrecognized header fields.
//    These requirements allow HTTP's functionality to be enhanced without
//    requiring prior update of deployed intermediaries."
// - Add param to prepareRequestFunction() that would allow the caller to kill a connection

// TODO:
// - Use connection pooling and maybe other stuff from:
// https://github.com/request/tunnel-agent/blob/master/index.js
// https://github.com/request/request/blob/master/lib/tunnel.js

var DEFAULT_AUTH_REALM = 'ProxyChain';
var DEFAULT_PROXY_SERVER_PORT = 8000;
var DEFAULT_TARGET_PORT = 80;

var REQUEST_ERROR_NAME = 'RequestError';

/**
 * Represents custom request error. The message is emitted as HTTP response
 * with a specific HTTP code and headers.
 * If this error is thrown from the `prepareRequestFunction` function,
 * the message and status code is sent to client.
 * By default, the response will have Content-Type: text/plain
 * and for the 407 status the Proxy-Authenticate header will be added.
 */

var RequestError = exports.RequestError = function (_Error) {
    _inherits(RequestError, _Error);

    function RequestError(message, statusCode, headers) {
        _classCallCheck(this, RequestError);

        var _this = _possibleConstructorReturn(this, (RequestError.__proto__ || Object.getPrototypeOf(RequestError)).call(this, message));

        _this.name = REQUEST_ERROR_NAME;
        _this.statusCode = statusCode;
        _this.headers = headers;

        Error.captureStackTrace(_this, RequestError);
        return _this;
    }

    return RequestError;
}(Error);

/**
 * Represents the proxy server.
 * It emits the 'requestFailed' event on unexpected request errors, with the following parameter `{ error, request }`.
 * It emits the 'connectionClosed' event when connection to proxy server is closed, with parameter `{ connectionId, stats }`.
 */


var Server = exports.Server = function (_EventEmitter) {
    _inherits(Server, _EventEmitter);

    /**
     * Initializes a new instance of Server class.
     * @param options
     * @param [options.port] Port where the server will listen. By default 8000.
     * @param [options.prepareRequestFunction] Custom function to authenticate proxy requests,
     * provide URL to chained upstream proxy or potentially provide function that generates a custom response to HTTP requests.
     * It accepts a single parameter which is an object:
     * ```{
     *   connectionId: Number,
     *   request: Object,
     *   username: String,
     *   password: String,
     *   hostname: String,
     *   port: Number,
     *   isHttp: Boolean
     * }```
     * and returns an object (or promise resolving to the object) with following form:
     * ```{
     *   requestAuthentication: Boolean,
     *   upstreamProxyUrl: String,
     *   customResponseFunction: Function
     * }```
     * If `upstreamProxyUrl` is false-ish value, no upstream proxy is used.
     * If `prepareRequestFunction` is not set, the proxy server will not require any authentication
     * and will not use any upstream proxy.
     * If `customResponseFunction` is set, it will be called to generate a custom response to the HTTP request.
     * It should not be used together with `upstreamProxyUrl`.
     * @param [options.authRealm] Realm used in the Proxy-Authenticate header and also in the 'Server' HTTP header. By default it's `ProxyChain`.
     * @param [options.verbose] If true, the server logs
     */
    function Server(options) {
        _classCallCheck(this, Server);

        var _this2 = _possibleConstructorReturn(this, (Server.__proto__ || Object.getPrototypeOf(Server)).call(this));

        options = options || {};

        if (options.port === undefined || options.port === null) {
            _this2.port = DEFAULT_PROXY_SERVER_PORT;
        } else {
            _this2.port = options.port;
        }
        _this2.prepareRequestFunction = options.prepareRequestFunction;
        _this2.authRealm = options.authRealm || DEFAULT_AUTH_REALM;
        _this2.verbose = !!options.verbose;
        _this2.httpAgent = options.httpAgent;

        // Key is handler ID, value is HandlerXxx instance
        _this2.handlers = {};
        _this2.lastHandlerId = 0;

        _this2.server = _http2.default.createServer();
        _this2.server.on('clientError', _this2.onClientError.bind(_this2));
        _this2.server.on('request', _this2.onRequest.bind(_this2));
        _this2.server.on('connect', _this2.onConnect.bind(_this2));

        _this2.stats = {
            httpRequestCount: 0,
            connectRequestCount: 0
        };
        return _this2;
    }

    _createClass(Server, [{
        key: 'log',
        value: function log(handlerId, str) {
            if (this.verbose) {
                var logPrefix = handlerId ? handlerId + ' | ' : '';
                console.log('ProxyServer[' + this.port + ']: ' + logPrefix + str);
            }
        }
    }, {
        key: 'onClientError',
        value: function onClientError(err, socket) {
            this.log(null, 'onClientError: ' + err);
            this.sendResponse(socket, 400, null, 'Invalid request');
        }

        /**
         * Handles normal HTTP request by forwarding it to target host or the upstream proxy.
         */

    }, {
        key: 'onRequest',
        value: function onRequest(request, response) {
            var _this3 = this;

            var handlerOpts = void 0;
            this.prepareRequestHandling(request).then(function (result) {
                handlerOpts = result;
                handlerOpts.srcResponse = response;

                var handler = void 0;
                if (handlerOpts.customResponseFunction) {
                    _this3.log(handlerOpts.id, 'Using HandlerCustomResponse');
                    handler = new _handler_custom_response2.default(handlerOpts);
                } else {
                    _this3.log(handlerOpts.id, 'Using HandlerForward');
                    handler = new _handler_forward2.default(handlerOpts);
                }

                _this3.handlerRun(handler);
            }).catch(function (err) {
                _this3.failRequest(request, err, handlerOpts);
            });
        }

        /**
         * Handles HTTP CONNECT request by setting up a tunnel either to target host or to the upstream proxy.
         * @param request
         * @param socket
         * @param head The first packet of the tunneling stream (may be empty)
         */

    }, {
        key: 'onConnect',
        value: function onConnect(request, socket, head) {
            var _this4 = this;

            var handlerOpts = void 0;
            this.prepareRequestHandling(request).then(function (result) {
                handlerOpts = result;
                handlerOpts.srcHead = head;

                var handler = void 0;
                if (handlerOpts.upstreamProxyUrlParsed) {
                    _this4.log(handlerOpts.id, 'Using HandlerTunnelChain');
                    handler = new _handler_tunnel_chain2.default(handlerOpts);
                } else {
                    _this4.log(handlerOpts.id, 'Using HandlerTunnelDirect');
                    handler = new _handler_tunnel_direct2.default(handlerOpts);
                }

                _this4.handlerRun(handler);
            }).catch(function (err) {
                _this4.failRequest(request, err, handlerOpts);
            });
        }

        /**
         * Authenticates a new request and determines upstream proxy URL using the user function.
         * Returns a promise resolving to an object that can be passed to construcot of one of the HandlerXxx classes.
         * @param request
         */

    }, {
        key: 'prepareRequestHandling',
        value: function prepareRequestHandling(request) {
            var _this5 = this;

            // console.log('XXX prepareRequestHandling');
            // console.dir(_.pick(request, 'url', 'method'));
            // console.dir(url.parse(request.url));

            var handlerOpts = {
                server: this,
                id: ++this.lastHandlerId,
                srcRequest: request,
                srcHead: null,
                trgParsed: null,
                upstreamProxyUrlParsed: null
            };

            this.log(handlerOpts.id, '!!! Handling ' + request.method + ' ' + request.url + ' HTTP/' + request.httpVersion);

            var socket = request.socket;

            var isHttp = false;

            // We need to consume socket errors, otherwise they could crash the entire process.
            // See https://github.com/apify/proxy-chain/issues/53
            // TODO: HandlerBase will also attach its own 'error' handler, we should only attach this one
            //  if HandlerBase doesn't do it, to avoid duplicate logs
            socket.on('error', function (err) {
                _this5.log(handlerOpts.id, 'Source socket emitted error: ' + (err.stack || err));
            });

            return Promise.resolve().then(function () {
                // console.dir(_.pick(request, 'url', 'headers', 'method'));
                // Determine target hostname and port
                if (request.method === 'CONNECT') {
                    // The request should look like:
                    //   CONNECT server.example.com:80 HTTP/1.1
                    // Note that request.url contains the "server.example.com:80" part
                    handlerOpts.trgParsed = (0, _tools.parseHostHeader)(request.url);

                    // If srcRequest.url does not match the regexp tools.HOST_HEADER_REGEX
                    // or the url is too long it will not be parsed so we throw error here.
                    if (!handlerOpts.trgParsed) {
                        throw new RequestError('Target "' + request.url + '" could not be parsed', 400);
                    }

                    _this5.stats.connectRequestCount++;
                } else {
                    // The request should look like:
                    //   GET http://server.example.com:80/some-path HTTP/1.1
                    // Note that RFC 7230 says:
                    // "When making a request to a proxy, other than a CONNECT or server-wide
                    //  OPTIONS request (as detailed below), a client MUST send the target
                    //  URI in absolute-form as the request-target"

                    var parsed = void 0;
                    try {
                        parsed = (0, _tools.parseUrl)(request.url);
                    } catch (e) {
                        // If URL is invalid, throw HTTP 400 error
                        throw new RequestError('Target "' + request.url + '" could not be parsed', 400);
                    }
                    // If srcRequest.url is something like '/some-path', this is most likely a normal HTTP request
                    if (!parsed.protocol) {
                        throw new RequestError('Hey, good try, but I\'m a HTTP proxy, not your ordinary web server :)', 400);
                    }
                    // Only HTTP is supported, other protocols such as HTTP or FTP must use the CONNECT method
                    if (parsed.protocol !== 'http:') {
                        throw new RequestError('Only HTTP protocol is supported (was ' + parsed.protocol + ')', 400);
                    }

                    handlerOpts.trgParsed = parsed;
                    isHttp = true;

                    _this5.stats.httpRequestCount++;
                }

                handlerOpts.trgParsed.port = handlerOpts.trgParsed.port || DEFAULT_TARGET_PORT;

                // Authenticate the request using a user function (if provided)
                if (!_this5.prepareRequestFunction) return { requestAuthentication: false, upstreamProxyUrlParsed: null };

                // Pause the socket so that no data is lost
                socket.pause();

                var funcOpts = {
                    connectionId: handlerOpts.id,
                    request: request,
                    username: null,
                    password: null,
                    hostname: handlerOpts.trgParsed.hostname,
                    port: handlerOpts.trgParsed.port,
                    isHttp: isHttp
                };

                var proxyAuth = request.headers['proxy-authorization'];
                if (proxyAuth) {
                    var auth = (0, _tools.parseProxyAuthorizationHeader)(proxyAuth);
                    if (!auth) {
                        throw new RequestError('Invalid "Proxy-Authorization" header', 400);
                    }
                    if (auth.type !== 'Basic') {
                        throw new RequestError('The "Proxy-Authorization" header must have the "Basic" type.', 400);
                    }
                    funcOpts.username = auth.username;
                    funcOpts.password = auth.password;
                }

                // User function returns a result directly or a promise
                return _this5.prepareRequestFunction(funcOpts);
            }).then(function (funcResult) {
                // If not authenticated, request client to authenticate
                if (funcResult && funcResult.requestAuthentication) {
                    throw new RequestError(funcResult.failMsg || 'Proxy credentials required.', 407);
                }

                if (funcResult && funcResult.upstreamProxyUrl) {
                    try {
                        handlerOpts.upstreamProxyUrlParsed = (0, _tools.parseUrl)(funcResult.upstreamProxyUrl);
                    } catch (e) {
                        throw new Error('Invalid "upstreamProxyUrl" provided: ' + e + ' (was "' + funcResult.upstreamProxyUrl + '"');
                    }

                    if (!handlerOpts.upstreamProxyUrlParsed.hostname || !handlerOpts.upstreamProxyUrlParsed.port) {
                        throw new Error('Invalid "upstreamProxyUrl" provided: URL must have hostname and port (was "' + funcResult.upstreamProxyUrl + '")'); // eslint-disable-line max-len
                    }
                    if (handlerOpts.upstreamProxyUrlParsed.protocol !== 'http:') {
                        throw new Error('Invalid "upstreamProxyUrl" provided: URL must have the "http" protocol (was "' + funcResult.upstreamProxyUrl + '")'); // eslint-disable-line max-len
                    }
                    if (/:/.test(handlerOpts.upstreamProxyUrlParsed.username)) {
                        throw new Error('Invalid "upstreamProxyUrl" provided: The username cannot contain the colon (:) character according to RFC 7617.'); // eslint-disable-line max-len
                    }
                }

                if (funcResult && funcResult.customResponseFunction) {
                    _this5.log(handlerOpts.id, 'Using custom response function');
                    handlerOpts.customResponseFunction = funcResult.customResponseFunction;
                    if (!isHttp) {
                        throw new Error('The "customResponseFunction" option can only be used for HTTP requests.');
                    }
                    if (typeof handlerOpts.customResponseFunction !== 'function') {
                        throw new Error('The "customResponseFunction" option must be a function.');
                    }
                }

                if (handlerOpts.upstreamProxyUrlParsed) {
                    _this5.log(handlerOpts.id, 'Using upstream proxy ' + (0, _tools.redactParsedUrl)(handlerOpts.upstreamProxyUrlParsed));
                }

                return handlerOpts;
            }).finally(function () {
                if (_this5.prepareRequestFunction) socket.resume();
            });
        }
    }, {
        key: 'handlerRun',
        value: function handlerRun(handler) {
            var _this6 = this;

            this.handlers[handler.id] = handler;

            handler.once('close', function (_ref) {
                var stats = _ref.stats;

                _this6.emit('connectionClosed', {
                    connectionId: handler.id,
                    stats: stats
                });
                delete _this6.handlers[handler.id];
                _this6.log(handler.id, '!!! Closed and removed from server');
            });

            handler.once('tunnelConnectResponded', function (_ref2) {
                var response = _ref2.response,
                    socket = _ref2.socket,
                    head = _ref2.head;

                _this6.emit('tunnelConnectResponded', {
                    connectionId: handler.id,
                    response: response,
                    socket: socket,
                    head: head
                });
            });

            handler.run();
        }

        /**
         * Sends a HTTP error response to the client.
         * @param request
         * @param err
         */

    }, {
        key: 'failRequest',
        value: function failRequest(request, err, handlerOpts) {
            var handlerId = handlerOpts ? handlerOpts.id : null;

            if (err.name === REQUEST_ERROR_NAME) {
                this.log(handlerId, 'Request failed (status ' + err.statusCode + '): ' + err.message);
                this.sendResponse(request.socket, err.statusCode, err.headers, err.message);
            } else {
                this.log(handlerId, 'Request failed with unknown error: ' + (err.stack || err));
                this.sendResponse(request.socket, 500, null, 'Internal error in proxy server');
                this.emit('requestFailed', { error: err, request: request });
            }

            // Emit 'connectionClosed' event if request failed and connection was already reported
            if (handlerOpts) {
                this.log(handlerId, 'Closed because request failed with error');
                this.emit('connectionClosed', {
                    connectionId: handlerOpts.id,
                    stats: { srcTxBytes: 0, srcRxBytes: 0 }
                });
            }
        }

        /**
         * Sends a simple HTTP response to the client and forcibly closes the connection.
         * @param socket
         * @param statusCode
         * @param headers
         * @param message
         */

    }, {
        key: 'sendResponse',
        value: function sendResponse(socket, statusCode, headers, message) {
            try {
                headers = headers || {};

                // TODO: We should use fully case-insensitive lookup here!
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'text/plain; charset=utf-8';
                }
                if (statusCode === 407 && !headers['Proxy-Authenticate'] && !headers['proxy-authenticate']) {
                    headers['Proxy-Authenticate'] = 'Basic realm="' + this.authRealm + '"';
                }
                if (!headers.Server) {
                    headers.Server = this.authRealm;
                }
                // These headers are required by e.g. PhantomJS, otherwise the connection would time out!
                if (!headers.Connection) {
                    headers.Connection = 'close';
                }
                if (!headers['Content-Length'] && !headers['content-length']) {
                    headers['Content-Length'] = Buffer.byteLength(message);
                }

                var msg = 'HTTP/1.1 ' + statusCode + ' ' + _http2.default.STATUS_CODES[statusCode] + '\r\n';
                _underscore2.default.each(headers, function (value, key) {
                    msg += key + ': ' + value + '\r\n';
                });
                msg += '\r\n' + message;

                // console.log("RESPONSE:\n" + msg);

                socket.write(msg, function () {
                    socket.end();

                    // Unfortunately calling end() will not close the socket if client refuses to close it.
                    // Hence calling destroy after a short while. One second should be more than enough
                    // to send out this small amount data.
                    setTimeout(function () {
                        socket.destroy();
                    }, 1000);
                });
            } catch (err) {
                this.log(null, 'Unhandled error in sendResponse(), will be ignored: ' + (err.stack || err));
            }
        }

        /**
         * Starts listening at a port specified in the constructor.
         * @param callback Optional callback
         * @return {(Promise|undefined)}
         */

    }, {
        key: 'listen',
        value: function listen(callback) {
            var _this7 = this;

            var promise = new Promise(function (resolve, reject) {
                // Unfortunately server.listen() is not a normal function that fails on error,
                // so we need this trickery
                var onError = function onError(err) {
                    _this7.log(null, 'Listen failed: ' + err);
                    removeListeners();
                    reject(err);
                };
                var onListening = function onListening() {
                    _this7.port = _this7.server.address().port;
                    _this7.log(null, 'Listening...');
                    removeListeners();
                    resolve();
                };
                var removeListeners = function removeListeners() {
                    _this7.server.removeListener('error', onError);
                    _this7.server.removeListener('listening', onListening);
                };

                _this7.server.on('error', onError);
                _this7.server.on('listening', onListening);
                _this7.server.listen(_this7.port);
            });

            return (0, _tools.nodeify)(promise, callback);
        }

        /**
         * Gets array of IDs of all active connections.
         * @returns {*}
         */

    }, {
        key: 'getConnectionIds',
        value: function getConnectionIds() {
            return _underscore2.default.keys(this.handlers);
        }

        /**
         * Gets data transfer statistics of a specific proxy connection.
         * @param {Number} connectionId ID of the connection handler.
         * It is passed to `prepareRequestFunction` function.
         * @return {Object} An object with statistics { srcTxBytes, srcRxBytes, trgTxBytes, trgRxBytes },
         * or null if connection does not exist or has been closed.
         */

    }, {
        key: 'getConnectionStats',
        value: function getConnectionStats(connectionId) {
            var handler = this.handlers && this.handlers[connectionId];
            if (!handler) return undefined;

            return handler.getStats();
        }

        /**
         * Closes the proxy server.
         * @param [closeConnections] If true, then all the pending connections from clients
         * to targets and upstream proxies will be forcibly aborted.
         * @param callback
         */

    }, {
        key: 'close',
        value: function close(closeConnections, callback) {
            if (typeof closeConnections === 'function') {
                callback = closeConnections;
                closeConnections = false;
            }

            if (closeConnections) {
                this.log(null, 'Closing pending handlers');
                var count = 0;
                _underscore2.default.each(this.handlers, function (handler) {
                    count++;
                    handler.close();
                });
                this.log(null, 'Destroyed ' + count + ' pending handlers');
            }

            if (this.server) {
                var server = this.server;

                this.server = null;
                var promise = _util2.default.promisify(server.close).bind(server)();
                return (0, _tools.nodeify)(promise, callback);
            }
        }
    }]);

    return Server;
}(_events2.default);