/**
 * AES-256-GCM encryption for imported wallet private keys.
 *
 * Uses the keeper's KEEPER_PRIVATE_KEY (hex) as key material.
 * The encryption key is derived via SHA-256 so we always get a 32-byte key
 * regardless of the input key length.
 *
 * Format: iv:authTag:ciphertext (all hex-encoded)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

/**
 * Derive a 32-byte AES key from the keeper's private key.
 */
function deriveEncryptionKey(): Buffer {
    const keeperKey = process.env.KEEPER_PRIVATE_KEY;
    if (!keeperKey) throw new Error('KEEPER_PRIVATE_KEY not set — cannot encrypt/decrypt wallets');
    return createHash('sha256').update(keeperKey).digest();
}

/**
 * Encrypt a private key (hex string) using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all hex)
 */
export function encryptPrivateKey(plainKey: string): string {
    const key = deriveEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plainKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a private key encrypted by encryptPrivateKey().
 * Input format: iv:authTag:ciphertext (all hex)
 */
export function decryptPrivateKey(encrypted: string): `0x${string}` {
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted key format');

    const [ivHex, authTagHex, ciphertext] = parts;
    const key = deriveEncryptionKey();
    const iv = Buffer.from(ivHex!, 'hex');
    const authTag = Buffer.from(authTagHex!, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext!, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // Ensure it's a valid hex key
    if (!decrypted.startsWith('0x')) {
        return `0x${decrypted}` as `0x${string}`;
    }
    return decrypted as `0x${string}`;
}
