import { ServerOptions, WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'node:http';
import { Client } from './lib/client';
import { PROXY_PORT } from './settings';

const options: ServerOptions = {};
options.port = PROXY_PORT;
const wss = new WebSocketServer(options);

let connId = 1;
wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    new Client(connId++, socket, request);
});

console.log(`Proxy listening on port ${PROXY_PORT}`);
