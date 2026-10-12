import type { PostFx, Theme } from '../themes/types';
import { BLUR_FRAG, COMPOSITE_FRAG, DOWN_FRAG, styleFrag, VERT } from './shaders';

type Uniforms = Record<string, WebGLUniformLocation | null>;
interface Prog { p: WebGLProgram; u: Uniforms }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture[]; w: number; h: number }

export interface FrameParams {
  time: number;
  mirror: boolean;
  glitch: number;
  rain: number;
  rainColor: number[];
  palette: Float32Array; // 색 5개 × rgb
  post: PostFx;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private styles = new Map<string, Prog>();
  private style: Prog | null = null;
  private down: Prog;
  private blur: Prog;
  private comp: Prog;
  private srcTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private overlayTex: WebGLTexture;
  private hasMask = false;
  private maskW = 1;
  private maskH = 1;
  private styleT: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('이 브라우저는 WebGL2 를 지원하지 않습니다.');
    this.gl = gl;
    this.down = this.program(DOWN_FRAG);
    this.blur = this.program(BLUR_FRAG);
    this.comp = this.program(COMPOSITE_FRAG);
    this.srcTex = this.texture(gl.LINEAR);
    this.maskTex = this.texture(gl.NEAREST);
    this.overlayTex = this.texture(gl.LINEAR);
    gl.bindVertexArray(gl.createVertexArray());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  /** 테마의 픽셀 규칙을 엔진 셰이더에 끼워 컴파일한다(테마별 1회). */
  setTheme(theme: Theme) {
    let prog = this.styles.get(theme.id);
    if (!prog) {
      prog = this.program(styleFrag(theme.glsl));
      this.styles.set(theme.id, prog);
    }
    this.style = prog;
  }

  private program(frag: string): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u: Uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i)!.name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  private texture(filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return t;
  }

  private target(w: number, h: number, count: number): Target {
    const gl = this.gl;
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex: WebGLTexture[] = [];
    for (let i = 0; i < count; i++) {
      const t = this.texture(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      tex.push(t);
    }
    gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private free(t: Target | null) {
    if (!t) return;
    t.tex.forEach((x) => this.gl.deleteTexture(x));
    this.gl.deleteFramebuffer(t.fb);
  }

  resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    [this.styleT, this.bloomA, this.bloomB].forEach((t) => this.free(t));
    this.styleT = this.target(w, h, 2);
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    this.bloomA = this.target(bw, bh, 1);
    this.bloomB = this.target(bw, bh, 1);
  }

  setSource(src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  setMask(data: Uint8Array | null, w: number, h: number) {
    const gl = this.gl;
    this.hasMask = !!data;
    if (!data) return;
    this.maskW = w;
    this.maskH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  setOverlay(c: HTMLCanvasElement | OffscreenCanvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private pass(prog: Prog, target: Target | null, setup: (u: Uniforms) => void) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.width, target ? target.h : this.height);
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(f: FrameParams) {
    const gl = this.gl;
    const s = this.styleT!, a = this.bloomA!, b = this.bloomB!;
    if (!this.style) throw new Error('setTheme 먼저');

    this.pass(this.style, s, (u) => {
      this.bind(0, this.srcTex, u.uSrc);
      this.bind(1, this.maskTex, u.uMask);
      this.bind(2, this.overlayTex, u.uOverlay);
      gl.uniform2f(u.uTexel, 1 / this.width, 1 / this.height);
      gl.uniform2f(u.uMaskStep, 1 / this.maskW, 1 / this.maskH);
      gl.uniform1f(u.uHasMask, this.hasMask ? 1 : 0);
      gl.uniform1f(u.uMirror, f.mirror ? 1 : 0);
      gl.uniform1f(u.uTime, f.time);
      gl.uniform1f(u.uOverlayGlow, f.post.overlayGlow);
      gl.uniform3fv(u['uPal[0]'], f.palette);
    });

    this.pass(this.down, a, (u) => {
      this.bind(0, s.tex[1], u.uTex);
      gl.uniform2f(u.uTexel, 1 / s.w, 1 / s.h);
    });
    for (let i = 0; i < 2; i++) {
      this.pass(this.blur, b, (u) => {
        this.bind(0, a.tex[0], u.uTex);
        gl.uniform2f(u.uDir, (1.5 + i) / a.w, 0);
      });
      this.pass(this.blur, a, (u) => {
        this.bind(0, b.tex[0], u.uTex);
        gl.uniform2f(u.uDir, 0, (1.5 + i) / a.h);
      });
    }

    const fx = f.post;
    this.pass(this.comp, null, (u) => {
      this.bind(0, s.tex[0], u.uColor);
      this.bind(1, s.tex[1], u.uGlow);
      this.bind(2, a.tex[0], u.uBloom);
      gl.uniform2f(u.uRes, this.width, this.height);
      gl.uniform1f(u.uTime, f.time);
      gl.uniform1f(u.uGlitch, f.glitch);
      gl.uniform1f(u.uRain, f.rain);
      gl.uniform3fv(u.uRainColor, f.rainColor);
      gl.uniform1f(u.uGlowAmt, fx.glow);
      gl.uniform1f(u.uBloomAmt, fx.bloom);
      gl.uniform1f(u.uChroma, fx.chroma);
      gl.uniform1f(u.uScan, fx.scanlines);
      gl.uniform1f(u.uGrain, fx.grain);
      gl.uniform1f(u.uVignette, fx.vignette);
      gl.uniform1f(u.uExposure, fx.exposure);
    });
  }
}
