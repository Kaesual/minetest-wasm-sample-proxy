import assert from 'node:assert';
import { sanitize } from '../util';
import { DIRECT_PROXY } from '../settings';
import { Client } from './client';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const CONNECTION_ESTABLISHED_REPLY = textEncoder.encode('HTTP/1.0 200 Connection Established\r\nProxy-agent: Apache/2.4.41 (Ubuntu)\r\n\r\n');

// Not sure what this does, but it seems irrelevant.
const GEOIP_RESPONSE = `HTTP/1.1 200 OK
Server: nginx/1.24.0
Date: %NOW%
Content-Type: application/json
Content-Length: 19
Connection: keep-alive
Cache-Control: max-age=604800, private
Access-Control-Allow-Origin: *

{"continent":"NA"}
`;

const LIST_RESPONSE = `HTTP/1.1 200 OK
Server: nginx/1.24.0
Date: %NOW%
Content-Type: application/json
Content-Length: %LENGTH%
Last-Modified: %NOW%
Connection: keep-alive
Access-Control-Allow-Origin: *

%PAYLOAD%
`;

const PAYLOAD = {
    'total': { 'servers': DIRECT_PROXY.length, 'clients': 0 },
    'total_max': { 'server': DIRECT_PROXY.length, 'clients': 0 },
    'list': DIRECT_PROXY.map(([vip, ip, port]) => {
        return {
            'address': vip,
            'ip': vip,
            'port': port,
            'proto_min': 37,
            'proto_max': 42,
       }}),
};

// Fake a CONNECT proxy to simulate servers.minetest.net response
export class ConnectProxy {
    client: Client;
    firstLine: boolean;
    conn: any;

    constructor(client: Client) {
        this.client = client;
        this.firstLine = true;
        this.conn = null;
    }

    forward(buffer: ArrayBuffer) {
        if (this.firstLine) {
            this.firstLine = false;
            this.handle_handshake(buffer);
            return;
        }
        if (!(buffer instanceof ArrayBuffer)) {
            throw new Error("ConnectProxy received non-binary messages");
        }
        const data = textDecoder.decode(buffer);
        assert(data.endsWith('\r\n\r\n'));
        const lines = data.split('\r\n');
        assert(lines.length >= 1);
        const tokens = lines[0]!.split(' ');
        assert(tokens[0] == 'GET');
        assert(tokens[1]);
        const url = sanitize(tokens[1]!);
        const now = (new Date()).toUTCString();
        let response: string;
        if (url.startsWith('/geoip')) {
            response = GEOIP_RESPONSE.replace(/%NOW%/g, now);
        } else if (url.startsWith('/list')) {
            const payload = JSON.stringify(PAYLOAD);
            response = LIST_RESPONSE.replace(/%NOW%/g, now).replace('%LENGTH%', `${payload.length + 1}`).replace('%PAYLOAD%', payload);
            this.client.log("Sending virtual server list")
        } else {
            this.client.log(`Invalid GET request for ${url}`);
            this.client.close();
            return;
        }
        this.client.send(textEncoder.encode(response));
    }

    handle_handshake(buffer: ArrayBuffer) {
        // The CONNECT line and it's headers could be split among several packets.
        // In a real server, this would aggregate data until it sees \r\n\r\n
        // But minetest-wasm always sends it as one packet, so just assume that.
        const data = textDecoder.decode(buffer);
        assert(data.endsWith('\r\n\r\n'));
        const lines = data.split('\r\n');
        assert(lines.length >= 1);
        const tokens = lines[0]!.split(' ');
        assert.strictEqual(tokens.length, 3);
        assert.strictEqual(tokens[0], 'CONNECT');
        assert.strictEqual(tokens[2], 'HTTP/1.1');
        const host_port = tokens[1]!.split(':');
        assert.strictEqual(host_port.length, 2);
        const host = host_port[0];
        const port = parseInt(host_port[1]!);
        if (host != 'servers.minetest.net' || port != 80) {
            this.client.log(`Ignoring request to proxy to ${host}:${port}`);
            this.client.close();
            return;
        }
        this.client.log('Connected for server list');
        this.client.send(CONNECTION_ESTABLISHED_REPLY);
    }

    close() {
        this.client.close();
    }
}
