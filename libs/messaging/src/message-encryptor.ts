// ============================================
// Message Encryptor - AES encryption for RabbitMQ payloads
// Encrypts sensitive job data before publishing to the queue
// ============================================

import CryptoJS from 'crypto-js';

/**
 * Encrypts a plaintext string using AES.
 * Used before publishing job payloads to RabbitMQ.
 */
export function encryptMessage(data: string, key: string): string {
    return CryptoJS.AES.encrypt(data, key).toString();
}

/**
 * Decrypts an AES-encrypted string back to plaintext.
 * Used by the worker when consuming from RabbitMQ.
 */
export function decryptMessage(encrypted: string, key: string): string {
    const bytes = CryptoJS.AES.decrypt(encrypted, key);
    return bytes.toString(CryptoJS.enc.Utf8);
}
