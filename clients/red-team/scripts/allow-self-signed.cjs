// Allow all HTTPS connections to accept self-signed certs in dev.
// Patches at every level: env var, https global agent, undici, and tls.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const https = require("https");
https.globalAgent = new https.Agent({ rejectUnauthorized: false });

const tls = require("tls");
const origConnect = tls.connect;
tls.connect = function (options, ...args) {
  if (typeof options === "object") options.rejectUnauthorized = false;
  return origConnect.call(this, options, ...args);
};

try {
  const { Agent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
} catch {}
