import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activeYouTube, youtubeEmbedUrl, youtubeIdOfRef, youtubeLook } from '../../render/youtube'
import type { Layer, Scene } from '../scene/types'
import { youtubeId, youtubeRef } from './types'

const scene: Scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contract/fixtures/scene.json', import.meta.url)), 'utf8'))
const ID = 'aqz-KE-bpKQ'

describe('youtube links (§14)', () => {
  it('parses watch, youtu.be and Shorts links', () => {
    expect(youtubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(youtubeId(`http://youtube.com/watch?v=${ID}&t=12s&list=x`)).toBe(ID)
    expect(youtubeId(`https://m.youtube.com/watch?feature=share&v=${ID}`)).toBe(ID)
    expect(youtubeId(`https://youtu.be/${ID}?si=abc`)).toBe(ID)
    expect(youtubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
    expect(youtubeId(`  https://youtube.com/shorts/${ID}/  `)).toBe(ID)
  })

  it('rejects everything else', () => {
    for (const bad of ['', 'not a url', `ftp://youtu.be/${ID}`, `https://vimeo.com/${ID}`, 'https://youtu.be/short', `https://www.youtube.com/embed/${ID}`, 'https://www.youtube.com/watch?v=has spaces!!', `https://evil.com/watch?v=${ID}`]) {
      expect(youtubeId(bad), bad).toBeNull()
    }
  })

  it('reads layer refs', () => {
    expect(youtubeRef(`youtube:${ID}`)).toBe(ID)
    expect(youtubeRef('asset:abc')).toBeNull()
    expect(youtubeIdOfRef(`youtube:${ID}`)).toBe(ID)
    expect(youtubeIdOfRef('youtube:bad')).toBeNull()
  })

  it('builds the muted looping embed URL', () => {
    const u = new URL(youtubeEmbedUrl(ID, 12.4, 32))
    expect(u.origin + u.pathname).toBe(`https://www.youtube-nocookie.com/embed/${ID}`)
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ autoplay: '1', mute: '1', loop: '1', playlist: ID, controls: '0', start: '12', end: '32', playsinline: '1', rel: '0' })
    expect(new URL(youtubeEmbedUrl(ID)).searchParams.has('end')).toBe(false)
  })
})

describe('the active YouTube layer', () => {
  const visible = (s: Scene, on: boolean): Scene => ({
    ...s,
    backdrop: { ...s.backdrop, scenery: { layers: s.backdrop.scenery.layers.map((l) => (l.id === 'lay_waves' ? { ...l, visible: on } : l)) } },
  })

  it('is none while the layer is hidden or another mode is on air', () => {
    expect(activeYouTube({ ...scene, mode: 'scenery' })).toBeNull()
    expect(activeYouTube(visible(scene, true))).toBeNull() // the fixture is in static mode
  })

  it('is the lowest visible youtube layer of the drawn stack', () => {
    const s = { ...visible(scene, true), mode: 'scenery' as const }
    expect(activeYouTube(s)).toMatchObject({ layerId: 'lay_waves', videoId: ID, start: 12, end: 0, blur: 0.2, brightness: 0.8, level: 1 })
    const second: Layer = { ...s.backdrop.scenery.layers[0], id: 'lay_yt2', ref: 'youtube:AAAAAAAAAAA' }
    const two = { ...s, backdrop: { ...s.backdrop, scenery: { layers: [...s.backdrop.scenery.layers, second] } } }
    expect(activeYouTube(two)?.layerId).toBe('lay_waves')
    expect(activeYouTube(s, { solo: { surfaceIds: ['srf_top'] } })).toBeNull()
    expect(activeYouTube(s, { layerOnly: 'lay_flowers' })).toBeNull()
  })

  it('shows as the underlay in objects mode with its level', () => {
    const s = { ...visible(scene, true), mode: 'objects' as const, underlay: { on: true, from: 'scenery' as const, level: 0.4 } }
    expect(activeYouTube(s)).toMatchObject({ layerId: 'lay_waves', level: 0.4 })
  })

  it('turns the photo controls into CSS', () => {
    const look = youtubeLook({ blur: 0.5, brightness: 0.5, warmth: 0 }, 1080)
    expect(look).toEqual({ blurPx: 15, brightness: 0.7, tint: [255, 255, 255] })
    const warm = youtubeLook({ blur: 0, brightness: 0.5, warmth: 1 }, 540)
    expect(warm.tint[0]).toBe(255)
    expect(warm.tint[2]).toBeLessThan(200)
  })
})
