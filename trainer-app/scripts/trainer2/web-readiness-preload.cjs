// Harness-only preload, inherited by Next's forked HTTP server. It does not
// provide a readiness endpoint or change application status/body/behavior.
/* eslint-disable @typescript-eslint/no-require-imports */
const { Server } = require('node:http');
const { createHmac } = require('node:crypto');
const key = process.env.TRAINER2_READINESS_KEY;
if (!/^[a-f0-9]{64}$/.test(key ?? '')) throw new Error('Missing task readiness key');
// Set by the preloaded root before Next forks, then inherited by that server.
const launcherPid = process.env.TRAINER2_READINESS_LAUNCHER_PID ??= String(process.pid);
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [request, response] = args;
    const url = new URL(request.url, 'http://127.0.0.1');
    const challenge = url.searchParams.get('readiness');
    if (request.method === 'GET' && url.pathname === '/trainer2/auth' && /^[a-f0-9]{32}$/.test(challenge ?? '')) {
      const pid = String(process.pid);
      response.setHeader('x-trainer2-readiness-pid', pid);
      response.setHeader('x-trainer2-readiness-proof', createHmac('sha256', key).update(challenge + '\n' + launcherPid + '\n' + pid).digest('hex'));
    }
  }
  return emit.call(this, event, ...args);
};
