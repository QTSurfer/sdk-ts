import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiListDatasets = vi.fn();
const apiCreateDataset = vi.fn();
const apiGetDataset = vi.fn();
const apiDeleteDataset = vi.fn();
const apiFinalizeDatasetUpload = vi.fn();
const apiGetDatasetUpload = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  listDatasets: apiListDatasets,
  createDataset: apiCreateDataset,
  getDataset: apiGetDataset,
  deleteDataset: apiDeleteDataset,
  finalizeDatasetUpload: apiFinalizeDatasetUpload,
  getDatasetUpload: apiGetDatasetUpload,
}));

const ok = <T>(data: T, status = 200) => ({ data, error: undefined, response: { status } as Response });

describe('dataset workflow', () => {
  beforeEach(() => {
    [apiListDatasets, apiCreateDataset, apiGetDataset, apiDeleteDataset, apiFinalizeDatasetUpload, apiGetDatasetUpload]
      .forEach((mock) => mock.mockReset());
  });

  it('uses the API dataset endpoints and preserves the upload session', async () => {
    const upload = { datasetId: 'ds_1', uploadId: 'up_1', upload: { url: 'https://upload.test', expiresInMinutes: 10 } };
    apiListDatasets.mockResolvedValue(ok({ datasets: [{ datasetId: 'ds_1', name: 'mine' }] }));
    apiCreateDataset.mockResolvedValue(ok(upload, 201));
    apiGetDataset.mockResolvedValue(ok({ datasetId: 'ds_1', name: 'mine' }));
    apiDeleteDataset.mockResolvedValue(ok({ datasetId: 'ds_1', deleted: true }));
    apiFinalizeDatasetUpload.mockResolvedValue(ok({ jobId: 'job_1' }, 202));
    apiGetDatasetUpload.mockResolvedValue(ok({ state: 'completed' }));
    const datasets = await import('../../src/workflows/datasets');

    await expect(datasets.listDatasets()).resolves.toEqual([{ datasetId: 'ds_1', name: 'mine' }]);
    await expect(datasets.createDataset({ name: 'mine', instrument: 'BTC/USDT' as never })).resolves.toEqual(upload);
    await expect(datasets.getDataset('ds_1')).resolves.toMatchObject({ datasetId: 'ds_1' });
    await expect(datasets.finalizeDatasetUpload('ds_1', 'up_1')).resolves.toEqual({ jobId: 'job_1' });
    await expect(datasets.getDatasetUpload('ds_1', 'up_1')).resolves.toEqual({ state: 'completed' });
    await expect(datasets.deleteDataset('ds_1')).resolves.toBeUndefined();
    expect(apiCreateDataset).toHaveBeenCalledWith({ body: { name: 'mine', instrument: 'BTC/USDT' } });
    expect(apiFinalizeDatasetUpload).toHaveBeenCalledWith({ path: { datasetId: 'ds_1', uploadId: 'up_1' } });
  });

  it('puts raw bytes to the presigned URL without API authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const { uploadDatasetFile } = await import('../../src/workflows/datasets');
    await uploadDatasetFile({ datasetId: 'ds_1', uploadId: 'up_1', upload: { url: 'https://upload.test', expiresInMinutes: 10 } } as never, 'csv', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://upload.test', { method: 'PUT', body: 'csv' });
  });
});
