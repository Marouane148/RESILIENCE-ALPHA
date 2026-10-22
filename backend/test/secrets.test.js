import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { loadSecrets } from '../src/secrets.js';

describe('chargement des secrets', () => {
  afterEach(() => mock.restoreAll());

  it('utilise l’environnement sans Vault', async () => {
    const secrets = await loadSecrets({ PAYMENT_API_TOKEN: 'a', POSTGRES_PASSWORD: 'b' });
    assert.equal(secrets.source, 'environment');
    assert.equal(secrets.PAYMENT_API_TOKEN, 'a');
  });

  it('lit le secret KV v2 dans Vault avec le token applicatif', async () => {
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, token: options.headers['X-Vault-Token'] });
      return { ok: true, json: async () => ({ data: { data: { PAYMENT_API_TOKEN: 'from-vault', POSTGRES_PASSWORD: 'pw' } } }) };
    });
    const secrets = await loadSecrets({ VAULT_ADDR: 'http://vault:8200', VAULT_TOKEN: 'app-token' });
    assert.equal(secrets.source, 'vault');
    assert.equal(secrets.PAYMENT_API_TOKEN, 'from-vault');
    assert.equal(calls[0].url, 'http://vault:8200/v1/secret/data/resilience');
    assert.equal(calls[0].token, 'app-token');
  });

  it('échoue de façon explicite si Vault reste injoignable', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('connection refused'); });
    await assert.rejects(loadSecrets({ VAULT_ADDR: 'http://vault:8200', VAULT_TOKEN: 't' }, { retries: 2, delayMs: 1 }), /vault unavailable/);
  });
});
