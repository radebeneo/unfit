/**
 * Phase 4 — AES-256-GCM encryption for OAuth refresh tokens.
 *
 * TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).
 * Generate once with:  openssl rand -hex 32
 *
 * Stored format in the database:  <iv_hex>:<ciphertext_hex>:<tag_hex>
 */

function getKey(): ArrayBuffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
  // Convert to a concrete ArrayBuffer (not SharedArrayBuffer) for SubtleCrypto
  const buf = Buffer.from(hex, 'hex');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    getKey(),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // AES-GCM appends the 16-byte auth tag at the end of the cipher output
  const ciphertextWithTag = new Uint8Array(encrypted);
  const ciphertext = ciphertextWithTag.slice(0, -16);
  const tag = ciphertextWithTag.slice(-16);

  return [
    Buffer.from(iv).toString('hex'),
    Buffer.from(ciphertext).toString('hex'),
    Buffer.from(tag).toString('hex'),
  ].join(':');
}

export async function decrypt(stored: string): Promise<string> {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const key = await crypto.subtle.importKey(
    'raw',
    getKey(),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Reassemble ciphertext + tag (SubtleCrypto expects them concatenated)
  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}
