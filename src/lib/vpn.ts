import assert from 'node:assert';
import { randint, inet_ntop, inet_pton } from '../util';
import { randomBytes } from 'node:crypto';
import { Client } from './client';

function rand_vpn_code() {
    return randomBytes(6).toString("hex").toUpperCase();
}

const vpns = new Map();

class VPN {
    serverCode: string;
    clientCode: string;
    game: string | null;
    targets: Map<string, VPNTarget>;

    constructor() {
        this.serverCode = rand_vpn_code();
        this.clientCode = rand_vpn_code();
        this.game = null; // not tracked
        this.targets = new Map();
        vpns.set(this.serverCode, this);
        vpns.set(this.clientCode, this);
    }

    route(ip: string, port: number) {
        let addr = `${ip}:${port}`;
        if (this.targets.has(addr)) {
            return this.targets.get(addr);
        }
        return null;
    }
};

export function vpn_make(game: string) {
    const vpn = new VPN();
    return [vpn.serverCode, vpn.clientCode];
}

export function vpn_connect(client: Client, code: string, bindport: number) {
    if (!vpns.has(code)) return null;
    const vpn = vpns.get(code);
    return new VPNTarget(vpn, client, code, bindport);
}

export class VPNTarget {
    vpn: VPN;
    client: Client;
    bindport: number;
    ip: string;
    addr: string;

    constructor(vpn: VPN, client: Client, code: string, bindport: number) {
        this.vpn = vpn;
        this.client = client;
        this.bindport = bindport;
        if (code == vpn.serverCode) {
            this.ip = '172.16.0.1';
        } else if (code == vpn.clientCode) {
            this.ip = `172.${randint(16, 32)}.${randint(1, 254)}.${randint(1, 254)}`;
        } else {
            throw new Error('Invalid code');
        }
        this.addr = `${this.ip}:${this.bindport}`;
        vpn.targets.set(this.addr, this);
        client.log(`VPN connect to ${this.addr}`);
    }

    // Forward a message from the client
    forward(data: ArrayBuffer) {
        // Data is encapsulated with a 12 byte header.
        // Magic      - 4 bytes 0x778B4CF3
        // Dest IP    - 4 bytes 0xAABBCCDD for AA.BB.CC.DD
        // Dest Port  - 2 bytes
        // Packet Len - 2 bytes
        const EP_MAGIC = 0x778B4CF3;
        assert(data instanceof ArrayBuffer);
        const view = new DataView(data);
        assert(data.byteLength >= 12);
        assert(view.getUint32(0) == EP_MAGIC);
        const dest_ip = inet_ntop(data.slice(4, 8));
        const dest_port = view.getUint16(8);
        const pktlen = view.getUint16(10);
        assert(data.byteLength == 12 + pktlen);
        const remote = this.vpn.route(dest_ip, dest_port);
        if (!remote) {
            // Packet is dropped
            this.client.log(`${this.addr} -> ${dest_ip}:${dest_port} (dropped)`);
            return;
        } else {
            this.client.log(`${this.addr} -> ${remote.addr}`);
        }

        // Rewrite the header to contain source ip/port
        (new Uint8Array(data, 4, 4)).set(new Uint8Array(inet_pton(this.ip)));
        view.setUint16(8, this.bindport);
        remote.client.send(data);
    }

    close() {
        this.vpn.targets.delete(this.addr);
        this.client.close();
    }
}
