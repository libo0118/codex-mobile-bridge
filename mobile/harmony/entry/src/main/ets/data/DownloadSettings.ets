export const DEFAULT_DOWNLOAD_LIMIT_MIB: number = 200;
export const MAX_DOWNLOAD_LIMIT_MIB: number = 4096;

export function isDownloadLimitMiB(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DOWNLOAD_LIMIT_MIB;
}

export function parseDownloadLimitMiB(text: string): number | undefined {
  const value = text.trim();
  if (!new RegExp('^[0-9]{1,10}$').test(value)) return undefined;
  const parsed = Number(value);
  return isDownloadLimitMiB(parsed) ? parsed : undefined;
}

export function downloadLimitBytes(valueMiB: number): number {
  if (!isDownloadLimitMiB(valueMiB)) throw new Error('下载阈值须为 1–4096 MB 的整数');
  return valueMiB * 1024 * 1024;
}
