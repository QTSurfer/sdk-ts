import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiListDatasets = vi.fn();
const apiCreateDataset = vi.fn();
const apiGetDataset = vi.fn();
const apiDeleteDataset = vi.fn();
const apiFinalizeDatasetUpload = vi.fn();
const apiGetDatasetUpload = vi.fn();
const apiOpenDatasetUpload = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  listDatasets: apiListDatasets,
  createDataset: apiCreateDataset,
  getDataset: apiGetDataset,
  deleteDataset: apiDeleteDataset,
  finalizeDatasetUpload: apiFinalizeDatasetUpload,
  getDatasetUpload: apiGetDatasetUpload,
  openDatasetUpload: apiOpenDatasetUpload,
}));

const ok = <T>(data: T, status = 200) => ({ data, error: undefined, response: { status } as Response });

describe('dataset workflow', () => {
  beforeEach(() => {
    [apiListDatasets, apiCreateDataset, apiGetDataset, apiDeleteDataset, apiFinalizeDatasetUpload, apiGetDatasetUpload, apiOpenDatasetUpload]
      .forEach((mock) => mock.mockReset());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the API dataset endpoints and preserves the upload session', async () => {
    const upload = { datasetId: 'ds_1', uploadId: 'up_1', upload: { url: 'https://upload.test', expiresInMinutes: 10 } };
    apiListDatasets.mockResolvedValue(ok({ datasets: [{ datasetId: 'ds_1', name: 'mine' }] }));
    apiCreateDataset.mockResolvedValue(ok(upload, 201));
    apiGetDataset.mockResolvedValue(ok({ datasetId: 'ds_1', name: 'mine' }));
    apiDeleteDataset.mockResolvedValue(ok({ datasetId: 'ds_1', deleted: true }));
    apiFinalizeDatasetUpload.mockResolvedValue(ok({ jobId: 'job_1' }, 202));
    apiGetDatasetUpload.mockResolvedValue(ok({ state: 'completed' }));
    apiOpenDatasetUpload.mockResolvedValue(ok({ uploadId: 'up_2', upload: { url: 'https://upload.test/2', expiresInMinutes: 15 } }, 201));
    const datasets = await import('../../src/workflows/datasets');

    await expect(datasets.listDatasets()).resolves.toEqual([{ datasetId: 'ds_1', name: 'mine' }]);
    await expect(datasets.createDataset({ name: 'mine', instrument: 'BTC/USDT' as never })).resolves.toEqual(upload);
    await expect(datasets.getDataset('ds_1')).resolves.toMatchObject({ datasetId: 'ds_1' });
    await expect(datasets.finalizeDatasetUpload('ds_1', 'up_1')).resolves.toEqual({ jobId: 'job_1' });
    await expect(datasets.getDatasetUpload('ds_1', 'up_1')).resolves.toEqual({ state: 'completed' });
    await expect(datasets.openDatasetUpload('ds_1')).resolves.toEqual({
      uploadId: 'up_2', upload: { url: 'https://upload.test/2', expiresInMinutes: 15 },
    });
    await expect(datasets.deleteDataset('ds_1')).resolves.toBeUndefined();
    expect(apiCreateDataset).toHaveBeenCalledWith({ body: { name: 'mine', instrument: 'BTC/USDT' } });
    expect(apiFinalizeDatasetUpload).toHaveBeenCalledWith({ path: { datasetId: 'ds_1', uploadId: 'up_1' } });
    expect(apiOpenDatasetUpload).toHaveBeenCalledWith({ path: { datasetId: 'ds_1' } });
  });

  it('puts raw bytes to the presigned URL without API authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const { uploadDatasetFile } = await import('../../src/workflows/datasets');
    await uploadDatasetFile(
      { uploadId: 'up_1', upload: { url: 'https://upload.test', expiresInMinutes: 10 } },
      'csv',
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith('https://upload.test', { method: 'PUT', body: 'csv' });
  });

  it('uses the platform fetch when no custom transport is supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchImpl);
    const { uploadDatasetFile } = await import('../../src/workflows/datasets');

    await uploadDatasetFile(
      { uploadId: 'up_1', upload: { url: 'https://upload.test', expiresInMinutes: 10 } },
      'csv',
    );

    expect(fetchImpl).toHaveBeenCalledWith('https://upload.test', { method: 'PUT', body: 'csv' });
  });

  it('hides the presigned URL when the upload transport fails', async () => {
    const url = 'https://upload.test/secret-signature';
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`fetch failed for ${url}`));
    const { uploadDatasetFile } = await import('../../src/workflows/datasets');

    const error = await uploadDatasetFile(
      { uploadId: 'up_1', upload: { url, expiresInMinutes: 10 } },
      'csv',
      fetchImpl,
    ).catch((failure: unknown) => failure);

    expect(String(error)).toContain('dataset upload transport failed');
    expect(String(error)).not.toContain('secret-signature');
  });

  it('surfaces a spent upload session as a 409 so callers can open a new one', async () => {
    apiFinalizeDatasetUpload.mockResolvedValue({
      data: undefined,
      error: { code: 409, message: 'upload session already produced a version' },
      response: { status: 409 } as Response,
    });
    const { finalizeDatasetUpload } = await import('../../src/workflows/datasets');
    await expect(finalizeDatasetUpload('ds_1', 'up_1')).rejects.toMatchObject({ status: 409 });
  });
});
