import {
  createCollection as apiCreateCollection,
  createDataset as apiCreateDataset,
  deleteCollection as apiDeleteCollection,
  deleteDataset as apiDeleteDataset,
  finalizeDatasetUpload as apiFinalizeDatasetUpload,
  getDataset as apiGetDataset,
  getDatasetUpload as apiGetDatasetUpload,
  getDatasetImport as apiGetDatasetImport,
  getCollection as apiGetCollection,
  importDataset as apiImportDataset,
  listDatasets as apiListDatasets,
  listCollections as apiListCollections,
  moveDataset as apiMoveDataset,
  openDatasetUpload as apiOpenDatasetUpload,
  updateCollection as apiUpdateCollection,
  type Collection,
  type CollectionCreateRequest,
  type CollectionDeleted,
  type CollectionUpdateRequest,
  type Dataset as ApiDataset,
  type DatasetCreated as ApiDatasetCreated,
  type DatasetUploadState as ApiDatasetUploadState,
  type DatasetUploadSession as ApiDatasetUploadSession,
  type DatasetImportCreated as ApiDatasetImportCreated,
  type DatasetImportRequest as ApiDatasetImportRequest,
  type DatasetImportState as ApiDatasetImportState,
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
export type DatasetImportRequest = ApiDatasetImportRequest;
export type DatasetImport = ApiDatasetImportCreated;
export type DatasetImportState = ApiDatasetImportState;

export interface CreateDatasetRequest {
  name: string;
  instrument: Instrument;
  /** Create the dataset in this collection when supplied. */
  collectionId?: string;
}

/** Options for listing owned datasets. */
export interface DatasetListOptions {
  includeDeleted?: boolean;
  /** Filter by collection id, or pass `'none'` for datasets at the root. */
  collectionId?: string;
}

/** List owned datasets, optionally filtered by collection and deletion status. */
export async function listDatasets(options?: DatasetListOptions): Promise<Dataset[]> {
  const { data, error, response } = await apiListDatasets({ query: options });
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

/** Start an external-history import and return its dataset and import identifiers. */
export async function importDataset(request: DatasetImportRequest): Promise<DatasetImport> {
  const { data, error, response } = await apiImportDataset({ body: request });
  if (error) throw requestFailed('import dataset call', error, response?.status, response?.headers?.get('Retry-After') ?? undefined);
  if (!data) throw new QTSError('Empty import dataset response');
  return data;
}

/** Read one external-history import's fetch and ingestion state. */
export async function getDatasetImport(datasetId: string, importId: string): Promise<DatasetImportState> {
  const { data, error, response } = await apiGetDatasetImport({ path: { datasetId, importId } });
  if (error) throw requestFailed('dataset import call', error, response?.status);
  if (!data) throw new QTSError('Empty dataset import response');
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

/** Move a dataset to a collection, or pass `null` to move it back to the root. */
export async function moveDataset(datasetId: string, collectionId: string | null): Promise<DatasetDetail> {
  const { data, error, response } = await apiMoveDataset({ path: { datasetId }, body: { collectionId } });
  if (error) throw requestFailed('move dataset call', error, response?.status);
  if (!data) throw new QTSError('Empty move dataset response');
  return data;
}

/** List owned collections with their dataset counts. */
export async function getCollections(): Promise<Collection[]> {
  const { data, error, response } = await apiListCollections();
  if (error) throw requestFailed('list collections call', error, response?.status);
  if (!data) throw new QTSError('Empty collections response');
  return data.collections;
}

/** Read a collection and its dataset counts. */
export async function getCollection(collectionId: string): Promise<Collection> {
  const { data, error, response } = await apiGetCollection({ path: { collectionId } });
  if (error) throw requestFailed('get collection call', error, response?.status);
  if (!data) throw new QTSError('Empty collection response');
  return data;
}

/** Create a collection. Its name must be unique among your collections. */
export async function createCollection(request: CollectionCreateRequest): Promise<Collection> {
  const { data, error, response } = await apiCreateCollection({ body: request });
  if (error) throw requestFailed('create collection call', error, response?.status);
  if (!data) throw new QTSError('Empty create collection response');
  return data;
}

/** Rename a collection or change its description. Pass a null description to remove it. */
export async function updateCollection(collectionId: string, request: CollectionUpdateRequest): Promise<Collection> {
  const { data, error, response } = await apiUpdateCollection({ path: { collectionId }, body: request });
  if (error) throw requestFailed('update collection call', error, response?.status);
  if (!data) throw new QTSError('Empty update collection response');
  return data;
}

/** Delete a collection and return its datasets to the root. */
export async function deleteCollection(collectionId: string): Promise<CollectionDeleted> {
  const { data, error, response } = await apiDeleteCollection({ path: { collectionId } });
  if (error) throw requestFailed('delete collection call', error, response?.status);
  if (!data) throw new QTSError('Empty delete collection response');
  return data;
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
