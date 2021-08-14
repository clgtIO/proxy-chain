// eslint-disable-next-line import/no-extraneous-dependencies
const ProxyAgent = require('proxy-agent');
const proxyChain = require('../build');
const SocksProxyAgent = require('socks-proxy-agent');

(async () => {
    const agent = new SocksProxyAgent({
        host: '145.239.75.187',
        port: 1081,
        protocol: 'socks:',
    });
    // const agent = new SocksProxyAgent('socks://145.239.75.187:1081');
    const newProxyUrl = await proxyChain.anonymizeProxyFromAgent(agent);
    console.log(newProxyUrl);
})();
