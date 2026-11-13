import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataMissing, loadCountry, loadProvinces } from '../../src/earth/regions';

afterEach(() => vi.unstubAllGlobals());

describe('region data loading', () => {
  it('treats a missing provinces file as a country without provinces', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(loadProvinces('ZZA')).resolves.toMatchObject({ features: [] });
  });

  it('treats an HTML page (a dev server or host fallback) as a missing file', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(loadProvinces('ZZF')).resolves.toMatchObject({ features: [] });
  });

  it('fails when provinces could not be downloaded, instead of pretending there are none', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(loadProvinces('ZZB')).rejects.toThrow(/503/);
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    await expect(loadProvinces('ZZC')).rejects.toThrow();
  });

  it('marks a missing country file as missing, and other failures as errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(loadCountry('ZZD')).rejects.toBeInstanceOf(DataMissing);
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    const err = await loadCountry('ZZE').catch((e) => e);
    expect(err).not.toBeInstanceOf(DataMissing);
  });
});
