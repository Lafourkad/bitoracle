/**
 * ShareLoader — loads and decrypts a threshold ML-DSA key share from disk.
 * Compatible with both Otzi PERMAFROST share files and our own keygen output.
 */

import { readFileSync } from 'fs';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import type { DecryptedShare } from './share-crypto.js';

interface EncryptedShareFile {
    v: 1;
    salt: string;
    iv: string;
    tag: string;
    data: string;
}

export class ShareLoader {
    /**
     * Load and decrypt a share file.
     * @param path — path to encrypted share JSON file
     * @param password — decryption password
     */
    static load(path: string, password: string): DecryptedShare {
        const raw = readFileSync(path, 'utf8');
        const file = JSON.parse(raw) as EncryptedShareFile;

        if (file.v !== 1) {
            throw new Error(`[ShareLoader] Unknown share file version: ${file.v}`);
        }

        const salt = Buffer.from(file.salt, 'hex');
        const iv = Buffer.from(file.iv, 'hex');
        const tag = Buffer.from(file.tag, 'hex');
        const data = Buffer.from(file.data, 'hex');

        const key = pbkdf2Sync(password, salt, 600_000, 32, 'sha256');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);

        let decrypted: string;
        try {
            decrypted = decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
        } catch {
            throw new Error('[ShareLoader] Decryption failed — wrong password or corrupted file');
        }

        const share = JSON.parse(decrypted) as DecryptedShare;
        this.validate(share);
        return share;
    }

    /**
     * Load from env vars (for CI/Docker deployments).
     * SHARE_PATH + SHARE_PASSWORD must be set.
     */
    static loadFromEnv(): DecryptedShare | null {
        const path = process.env['SHARE_PATH'];
        const password = process.env['SHARE_PASSWORD'];

        if (!path || !password) return null;

        console.log(`[ShareLoader] Loading share from ${path}`);
        return this.load(path, password);
    }

    private static validate(share: DecryptedShare): void {
        if (!share.partyId || !share.threshold || !share.parties || !share.publicKey) {
            throw new Error('[ShareLoader] Invalid share file — missing required fields');
        }
        if (share.threshold > share.parties) {
            throw new Error(`[ShareLoader] Invalid share: threshold (${share.threshold}) > parties (${share.parties})`);
        }
    }
}
