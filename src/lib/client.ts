import assert from 'node:assert';
import { isIPv4 } from 'node:net';
import { format } from 'node:util'; // node.js built-in

import { DIRECT_PROXY } from '../settings';
import { ConnectProxy } from './ConnectProxy';
import { UDPProxy } from './UDPProxy';
import { extract_ip_chain, sanitize } from '../util';
import { vpn_make, vpn_connect, VPNTarget } from './vpn';
import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
const textDecoder = new TextDecoder();

let lastlog: string | null = null;
let lastlogcount = 0;

export class Client {
    id: number;
    socket: WebSocket | null;
    ip_chain: string[];
    target: ConnectProxy | UDPProxy | VPNTarget | null;

    constructor(id: number, socket: WebSocket, request: IncomingMessage) {
        this.id = id;
        this.socket = socket;
        this.ip_chain = extract_ip_chain(request);
        this.target = null;
        this.socket.on('message', this.handle_message.bind(this));
        this.socket.on('error', this.handle_error.bind(this));
        this.socket.on('close', this.handle_close.bind(this));
        this.log("New client from ", this.ip_chain);
    }

    log(...args: any[]) {
        let line = [`[CLIENT ${this.id}]`, ...args].map(o => format("%s", o)).join(" ");
        if (lastlog != line) {
            if (lastlogcount > 0) {
                console.log(lastlog + ` [repeated ${lastlogcount} times]`);
            }
            console.log(line);
            lastlog = line;
            lastlogcount = 0;
        } else {
            lastlogcount++;
        }
    }

    send(data: ArrayBuffer | Buffer | Uint8Array | string) {
        let binary =
            Buffer.isBuffer(data) ||
            (data instanceof ArrayBuffer) ||
            ArrayBuffer.isView(data);
        if (this.socket) {
            this.socket.send(data, {binary});
        }
    }

    close() {
        let socket = this.socket;
        this.socket = null;
        if (socket) {
            socket.close();
        }
        let target = this.target;
        this.target = null;
        if (target) {
            target.close();
        }
    }

    handle_error() {
        this.log("Error");
        this.close();
    }

    handle_close() {
        this.socket = null;
        this.close();
    }

    handle_message(buffer: Buffer<ArrayBuffer>, isBinary: boolean) {
        // node.js specific fix: Convert Buffer to ArrayBuffer
        let data: ArrayBuffer | string = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        if (!isBinary) {
            data = textDecoder.decode(data);
        }
        if (this.target && typeof data !== 'string') {
            this.target.forward(data);
        } else {
            this.handle_command(data as string);
        }
    }

    handle_command(line: string) {
        const data = sanitize(line);
        const tokens = data.split(' ');
        const command = tokens[0];
        let response: string | null = null;
        if (command == 'MAKEVPN') {
            const game = tokens[1];
            const [serverCode, clientCode] = vpn_make(game!);
            response = `NEWVPN ${serverCode} ${clientCode}`;
        } else if (command == 'VPN') {
            const code = tokens[1];
            const bindport = parseInt(tokens[5]!, 10);
            this.target = vpn_connect(this, code!, bindport);
            if (this.target == null) {
                this.log(`VPN connect failed`);
                this.close();
                return;
            }
            response = 'BIND OK';
        } else if (command == 'PROXY') {
            assert(tokens[2] == 'TCP' || tokens[2] == 'UDP');
            const isUDP = (tokens[2] == 'UDP');
            const ip = sanitize(tokens[3]!);
            const port = parseInt(sanitize(tokens[4]!));
            assert(isIPv4(ip));
            assert(port >= 1 && port < 65536);
            this.target = route(this, isUDP, ip, port);
            if (!this.target) {
                this.log(`Proxy to udp=${isUDP}, ip=${ip}, port=${port} rejected`);
                response = 'PROXY FAIL';
            } else {
                response = 'PROXY OK';
            }
        } else {
            this.log('Unhandled command: ', data);
            this.close();
            return;
        }
        this.send(response);
    }

}

const PROXY_MAP = new Map(DIRECT_PROXY.map(([vip,ip,port]) => [vip, [ip, port]]));

function route(client: Client, isUDP: boolean, ip: string, port: number) {
    if (!isUDP && ip == '10.0.0.1' && port == 8080) {
        return new ConnectProxy(client);
    }
    if (isUDP && PROXY_MAP.has(ip)) {
        let [real_ip, real_port] = PROXY_MAP.get(ip)!;
        return new UDPProxy(client, real_ip as string, real_port as number);
    }

    return null;
}
