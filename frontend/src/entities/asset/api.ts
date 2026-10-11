import { http } from '../../shared/lib/http'
import type { Asset, AssetKind } from './types'

export const assetApi = {
  upload: (file: Blob, kind: AssetKind, filename = 'upload.jpg') => {
    const fd = new FormData()
    fd.append('file', file, filename)
    fd.append('kind', kind)
    return http.form<Asset>('/api/v1/assets', fd)
  },
}
