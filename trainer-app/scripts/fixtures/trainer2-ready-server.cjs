/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('node:http');
const { fork } = require('node:child_process');
if (process.argv[2] !== 'serve') {
  const server = fork(__filename, ['serve'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  server.on('message', message => process.send(message));
  process.on('message', () => server.send('stop'));
  server.on('exit', code => process.exit(code ?? 1));
} else {
  const html = '<!doctype html><html><head><title>Trainer</title></head><body><main><h1>Trainer2 sign in</h1><p>Signed out.</p><form action="/trainer2/auth/sign-in" method="post"><label>Passcode<input name="passcode" type="password" required minlength="12" maxlength="128" autocomplete="current-password"></label><button type="submit">Sign in</button></form></main></body></html>';
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html); });
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port, pid: process.pid }));
  process.on('message', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
