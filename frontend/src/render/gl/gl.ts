/** Small WebGL2 helpers: programs with uniform caches, render targets, a fullscreen triangle. */

export class GLProgram {
  readonly prog: WebGLProgram
  private locs = new Map<string, WebGLUniformLocation | null>()
  constructor(private gl: WebGL2RenderingContext, prog: WebGLProgram) {
    this.prog = prog
  }
  use() {
    this.gl.useProgram(this.prog)
    return this
  }
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name)
      this.locs.set(name, l)
    }
    return l
  }
  f1(n: string, v: number) { const l = this.loc(n); if (l) this.gl.uniform1f(l, v) }
  i1(n: string, v: number) { const l = this.loc(n); if (l) this.gl.uniform1i(l, v) }
  u1(n: string, v: number) { const l = this.loc(n); if (l) this.gl.uniform1ui(l, v) }
  f2(n: string, a: number, b: number) { const l = this.loc(n); if (l) this.gl.uniform2f(l, a, b) }
  f3(n: string, a: number, b: number, c: number) { const l = this.loc(n); if (l) this.gl.uniform3f(l, a, b, c) }
  f4(n: string, a: number, b: number, c: number, d: number) { const l = this.loc(n); if (l) this.gl.uniform4f(l, a, b, c, d) }
  v2(n: string, v: Float32Array) { const l = this.loc(n); if (l) this.gl.uniform2fv(l, v) }
  v3(n: string, v: Float32Array) { const l = this.loc(n); if (l) this.gl.uniform3fv(l, v) }
  v1(n: string, v: Float32Array) { const l = this.loc(n); if (l) this.gl.uniform1fv(l, v) }
  m3(n: string, v: Float32Array) { const l = this.loc(n); if (l) this.gl.uniformMatrix3fv(l, false, v) }
  tex(n: string, unit: number, t: WebGLTexture | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    this.i1(n, unit)
  }
}

export class ShaderError extends Error {}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'compile failed'
    gl.deleteShader(sh)
    throw new ShaderError(log)
  }
  return sh
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): GLProgram {
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  let f: WebGLShader
  try {
    f = compile(gl, gl.FRAGMENT_SHADER, fs)
  } catch (e) {
    gl.deleteShader(v)
    throw e
  }
  const p = gl.createProgram()!
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.bindAttribLocation(p, 0, 'a_pos')
  gl.bindAttribLocation(p, 1, 'a_uv')
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? 'link failed'
    gl.deleteProgram(p)
    throw new ShaderError(log)
  }
  return new GLProgram(gl, p)
}

export interface Target {
  fb: WebGLFramebuffer
  tex: WebGLTexture
  width: number
  height: number
  stencil: WebGLRenderbuffer | null
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, withStencil = false, linear = true): Target {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fb = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  let stencil: WebGLRenderbuffer | null = null
  if (withStencil) {
    stencil = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, stencil)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { fb, tex, width, height, stencil }
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null | undefined) {
  if (!t) return
  gl.deleteFramebuffer(t.fb)
  gl.deleteTexture(t.tex)
  if (t.stencil) gl.deleteRenderbuffer(t.stencil)
}

/** Keeps targets by key and recreates them only when the size changes. */
export class TargetPool {
  private map = new Map<string, Target>()
  constructor(private gl: WebGL2RenderingContext) {}
  get(key: string, w: number, h: number, stencil = false): Target {
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    const t = this.map.get(key)
    if (t && t.width === w && t.height === h && !!t.stencil === stencil) return t
    deleteTarget(this.gl, t)
    const n = createTarget(this.gl, w, h, stencil)
    this.map.set(key, n)
    return n
  }
  /** Deletes targets whose key is not in `keep` (and starts with prefix). */
  prune(prefix: string, keep: Set<string>) {
    for (const [k, t] of this.map) if (k.startsWith(prefix) && !keep.has(k)) {
      deleteTarget(this.gl, t)
      this.map.delete(k)
    }
  }
  dispose() {
    for (const t of this.map.values()) deleteTarget(this.gl, t)
    this.map.clear()
  }
}

export function bindTarget(gl: WebGL2RenderingContext, t: Target | null, w?: number, h?: number) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null)
  gl.viewport(0, 0, t ? t.width : w!, t ? t.height : h!)
}

/** A VAO with one big triangle covering clip space (a_pos = clip xy, a_uv = 0..1). */
export function fullscreenVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
  gl.bindVertexArray(null)
  return vao
}

/** A reusable dynamic mesh (interleaved x, y, u, v + indices). */
export class DynMesh {
  readonly vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private ibo: WebGLBuffer
  count = 0
  type: number
  constructor(private gl: WebGL2RenderingContext) {
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    this.ibo = gl.createBuffer()!
    this.type = gl.UNSIGNED_SHORT
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bindVertexArray(null)
  }
  set(verts: Float32Array, indices: Uint16Array | Uint32Array) {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
    this.count = indices.length
    this.type = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
  }
  draw(mode?: number) {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.drawElements(mode ?? gl.TRIANGLES, this.count, this.type, 0)
    gl.bindVertexArray(null)
  }
  dispose() {
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.vbo)
    this.gl.deleteBuffer(this.ibo)
  }
}
