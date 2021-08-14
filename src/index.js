import { Server, RequestError } from './server';
import { parseUrl, redactUrl, redactParsedUrl } from './tools';
import {
    anonymizeProxy, closeAnonymizedProxy, listenConnectAnonymizedProxy, anonymizeProxyFromAgent,
} from './anonymize_proxy';
import { createTunnel, closeTunnel } from './tcp_tunnel_tools';

// Publicly exported functions and classes
const ProxyChain = {
    Server,
    RequestError,
    parseUrl,
    redactUrl,
    redactParsedUrl,
    anonymizeProxy,
    closeAnonymizedProxy,
    listenConnectAnonymizedProxy,
    anonymizeProxyFromAgent,
    createTunnel,
    closeTunnel,
};

module.exports = ProxyChain;
