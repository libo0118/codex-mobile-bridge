import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import fileUri from '@ohos.file.fileuri';
import util from '@ohos.util';
import { camera, cameraPicker } from '@kit.CameraKit';

export class CameraPhoto {
  path: string;
  uri: string;
  constructor(path: string, uri: string) { this.path = path; this.uri = uri; }
}

function acceptTokens(types: string[]): string[] {
  const tokens: string[] = [];
  for (const entry of types) {
    for (const value of entry.split(',')) {
      const token = value.trim().toLowerCase();
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

export function acceptsCameraPhoto(types: string[]): boolean {
  return acceptTokens(types).some((value: string): boolean =>
    value === 'image/*' || value === 'image/jpeg' || value === '.jpg' || value === '.jpeg');
}

export async function capturePhoto(context: common.UIAbilityContext, canOpen: () => boolean): Promise<CameraPhoto | undefined> {
  const path = context.cacheDir + '/bridge-camera-' + util.generateRandomUUID() + '.jpg';
  let created = false;
  let ready = false;
  try {
    const createdFile = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
    created = true;
    await fs.close(createdFile);
    if (!canOpen()) return undefined;
    const uri = fileUri.getUriFromPath(path);
    const profile: cameraPicker.PickerProfile = { cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK, saveUri: uri };
    const result = await cameraPicker.pick(context, [cameraPicker.PickerMediaType.PHOTO], profile);
    if (result.resultCode !== 0) return undefined;
    if (result.resultUri !== uri || !uri.startsWith('file://') || result.mediaType !== cameraPicker.PickerMediaType.PHOTO) {
      throw new Error('相机返回的照片无效');
    }
    const photo = await fs.open(uri, fs.OpenMode.READ_ONLY);
    try { if ((await fs.stat(photo.fd)).size <= 0) throw new Error('拍摄的照片为空'); }
    finally { await fs.close(photo); }
    ready = true;
    return new CameraPhoto(path, uri);
  } finally {
    if (created && !ready) fs.unlinkSync(path);
  }
}

export function discardCapture(photo: CameraPhoto): void { fs.unlinkSync(photo.path); }

let captureCacheChecked = false;
export function clearStaleCaptures(context: common.UIAbilityContext): void {
  if (captureCacheChecked) return;
  captureCacheChecked = true;
  for (const name of fs.listFileSync(context.cacheDir)) {
    if (new RegExp('^bridge-camera-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.jpg$').test(name)) {
      fs.unlinkSync(context.cacheDir + '/' + name);
    }
  }
}
