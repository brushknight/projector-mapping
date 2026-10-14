import { lit, nullable, num, obj, str } from '../../shared/lib/guard'

export const videoShape = obj({
  id: str, name: str, ref: str, source: lit('file', 'youtube'), url: nullable(str), youtubeId: nullable(str), sha: nullable(str), thumb: nullable(str),
  duration: nullable(num), width: nullable(num), height: nullable(num), createdAt: str,
})
export const importJobShape = obj({
  id: str, url: str, youtubeId: str, mode: lit('download', 'embed'), status: lit('running', 'done', 'failed'), progress: num, message: str,
  maxHeight: num, start: num, end: num, videoId: nullable(str), ref: nullable(str), createdAt: str,
})
