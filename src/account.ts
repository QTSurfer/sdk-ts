import {
  getAccount as apiGetAccount,
  getAccountUsage as apiGetAccountUsage,
  type Account,
  type AccountUsage,
} from '@qtsurfer/api-client';
import { QTSError } from './errors';
import { requestFailed } from './internal/requestError';

/** Read the authenticated account's tier and limits. */
export async function getAccount(): Promise<Account> {
  const { data, error, response } = await apiGetAccount();
  if (error) throw requestFailed('get account call', error, response?.status);
  if (!data) throw new QTSError('Empty account response');
  return data;
}

/** Read the authenticated account's current resource and storage usage. */
export async function getAccountUsage(): Promise<AccountUsage> {
  const { data, error, response } = await apiGetAccountUsage();
  if (error) throw requestFailed('get account usage call', error, response?.status);
  if (!data) throw new QTSError('Empty account-usage response');
  return data;
}
