import { resolveAssetUrl } from '../../../api/request';
import type { LocalMaterialFile } from './types';

export function resolveLocalMaterialUrl(material: Pick<LocalMaterialFile, 'serverFileUrl' | 'url'>) {
  return resolveAssetUrl(material.serverFileUrl || material.url);
}
