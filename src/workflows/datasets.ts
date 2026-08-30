import {
  createDataset as apiCreateDataset,
  deleteDataset as apiDeleteDataset,
  finalizeDatasetUpload as apiFinalizeDatasetUpload,
  getDataset as apiGetDataset,
  getDatasetUpload as apiGetDatasetUpload,
  listDatasets as apiListDatasets,
  openDatasetUpload as apiOpenDatasetUpload,
  type Dataset as ApiDataset,
  type DatasetCreated as ApiDatasetCreated,
  type DatasetUploadState as ApiDatasetUploadState,
  type DatasetUploadSession as ApiDatasetUploadSession,
  type DatasetWithLinks as ApiDatasetWithLinks,
  type Instrument,
} from '@qtsurfer/api-client';
import { QTSError } from '../errors';
import { requestFailed } from '../internal/requestError';

export type Dataset = ApiDataset;
export type DatasetDetail = ApiDatasetWithLinks;
export type DatasetUpload = ApiDatasetCreated;
/** A presigned upload session for another version of an existing dataset. */
export type DatasetUploadSession = ApiDatasetUploadSession;
export type DatasetUploadState = ApiDatasetUploadState;

export interface CreateDatasetRequest {
  name: string;
  instrument: Instrument;
}

export async function listDatasets(): Promise<Dataset[]> {
  const { data, error, response } = await apiListDatasets();
  if (error) throw requestFailed('datasets call', error, response?.status);
  if (!data) throw new QTSError('Empty datasets response');
  return data.datasets;
}

export async function createDataset(request: CreateDatasetRequest): Promise<DatasetUpload> {
  const { data, error, response } = await apiCreateDataset({ body: request });
  if (error) throw requestFailed('create dataset call', error, response?.status);
  if (!data) throw new QTSError('Empty create dataset response');
  return data;
}

/** Open the dataset's current upload session, or a new one after finalization. */
export async function openDatasetUpload(datasetId: string): Promise<DatasetUploadSession> {
  const { data, error, response } = await apiOpenDatasetUpload({ path: { datasetId } });
  if (error) throw requestFailed('open dataset upload call', error, response?.status);
  if (!data) throw new QTSError('Empty open dataset upload response');
  return data;
}

export async function getDataset(datasetId: string): Promise<DatasetDetail> {
  const { data, error, response } = await apiGetDataset({ path: { datasetId } });
  if (error) throw requestFailed('dataset call', error, response?.status);
  if (!data) throw new QTSError('Empty dataset response');
  return data;
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const { error, response } = await apiDeleteDataset({ path: { datasetId } });
  if (error) throw requestFailed('delete dataset call', error, response?.status);
}

export async function uploadDatasetFile(
  upload: DatasetUploadSession,
  file: BodyInit,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const request = fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await request(upload.upload.url, { method: 'PUT', body: file });
  } catch {
    // Fetch errors can retain the request URL, which is itself a credential.
    throw new QTSError('dataset upload transport failed');
  }
  if (!response.ok) {
    throw new QTSError(`dataset upload failed: HTTP ${response.status}`, undefined, response.status);
  }
}

export async function finalizeDatasetUpload(
  datasetId: string,
  uploadId: string,
): Promise<{ jobId: string }> {
  const { data, error, response } = await apiFinalizeDatasetUpload({
    path: { datasetId, uploadId },
  });
  if (error) throw requestFailed('finalize dataset upload call', error, response?.status);
  if (!data?.jobId) throw new QTSError('Missing jobId in finalize dataset upload response');
  return data;
}

export async function getDatasetUpload(
  datasetId: string,
  uploadId: string,
): Promise<DatasetUploadState> {
  const { data, error, response } = await apiGetDatasetUpload({ path: { datasetId, uploadId } });
  if (error) throw requestFailed('dataset upload call', error, response?.status);
  if (!data) throw new QTSError('Empty dataset upload response');
  return data;
}
