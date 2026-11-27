import { guillocheCurves } from "./guilloche";

export type Rgb = readonly [number, number, number];
export type Point = { x: number; y: number };

/** Boxes measured from the DOM, in CSS pixels relative to the canvas. */
export type Geometry = {
  start: Point;
  ends: readonly [Point, Point, Point];
  /** Rivers fall downward instead of running to the right. */
  vertical: boolean;
  /** Centre and radius of the guilloche behind the rivers. */
  center: Point;
  radius: number;
};

type Options = {
  grains: number;
  colors: readonly [Rgb, Rgb, Rgb];
  guilloche: Rgb;
  /** Characters from empty to full. The first one should be a space. */
  ramp: string;
  cell: { width: number; height: number };
};

/** Seconds the packet takes to run the rivers. */
export const PACKET_SECONDS = 1.3;
const GUILLOCHE_TURN_SECONDS = 240;
const GUILLOCHE_STEPS = 900;

const GRAIN_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aGrain;
uniform vec2 uRes;
uniform vec2 uStart;
uniform vec2 uEnd[3];
uniform vec3 uShare;
uniform vec2 uCuts;
uniform vec3 uColor[3];
uniform float uTime;
uniform float uPacket;
uniform float uGain;
uniform float uWiden;
uniform float uVertical;
out vec3 vColor;
const float PI = 3.14159265;
void main() {
  int i = aGrain.x < uCuts.x ? 0 : (aGrain.x < uCuts.y ? 1 : 2);
  float share = uShare[i];
  float speed = 0.07 + 0.06 * fract(aGrain.y * 17.31 + aGrain.w * 3.7);
  float t = fract(aGrain.y + uTime * speed);
  vec2 p0 = uStart;
  vec2 p3 = uEnd[i];
  vec2 handle = uVertical > 0.5 ? vec2(0.0, (p3.y - p0.y) * 0.5) : vec2((p3.x - p0.x) * 0.5, 0.0);
  vec2 p1 = p0 + handle;
  vec2 p2 = p3 - handle;
  float u = 1.0 - t;
  vec2 pos = u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
  vec2 tangent = 3.0 * u * u * (p1 - p0) + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (p3 - p2);
  vec2 normal = normalize(vec2(-tangent.y, tangent.x) + vec2(1e-5));
  float width = (5.0 + 46.0 * sqrt(share)) * uWiden;
  float pinch = 0.4 + 0.6 * sin(PI * t);
  pos += normal * aGrain.z * width * 0.25 * pinch;
  float packet = exp(-pow((t - uPacket) / 0.05, 2.0));
  float alpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t)) * step(0.002, share);
  vColor = uColor[i] * alpha * uGain * (1.0 + 3.0 * packet);
  gl_Position = vec4(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0, 0.0, 1.0);
  gl_PointSize = aGrain.w * (1.0 + 3.0 * packet);
}`;

const GRAIN_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  float f = 1.0 - smoothstep(0.25, 0.5, length(gl_PointCoord - 0.5));
  outColor = vec4(vColor * f, 0.0);
}`;

const GUILLOCHE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uAngle;
out float vR;
void main() {
  float c = cos(uAngle);
  float s = sin(uAngle);
  vec2 p = vec2(c * aPos.x - s * aPos.y, s * aPos.x + c * aPos.y);
  vR = length(aPos);
  vec2 px = uCenter + p * uRadius;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const GUILLOCHE_FS = `#version 300 es
precision mediump float;
in float vR;
uniform vec3 uTint;
out vec4 outColor;
void main() {
  float fade = smoothstep(1.0, 0.6, vR) * smoothstep(0.2, 0.45, vR);
  outColor = vec4(uTint * fade, 0.0);
}`;

const ASCII_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const ASCII_FS = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uAtlas;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform float uDpr;
uniform float uHeight;
uniform float uGlyphs;
out vec4 outColor;
void main() {
  vec2 css = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uDpr;
  vec2 cell = floor(css / uCell);
  vec2 local = fract(css / uCell);
  vec3 c = texture(uField, vec2((cell.x + 0.5) / uGrid.x, 1.0 - (cell.y + 0.5) / uGrid.y)).rgb;
  float lum = max(c.r, max(c.g, c.b));
  float level = clamp(pow(lum, 0.65), 0.0, 1.0);
  float glyph = min(floor(level * uGlyphs), uGlyphs - 1.0);
  float ink = texture(uAtlas, vec2((glyph + local.x) / uGlyphs, local.y)).r;
  vec3 hue = c / max(lum, 1e-4);
  float intensity = clamp(lum * 1.4, 0.0, 1.0);
  vec3 text = hue * (0.12 + 0.95 * intensity) * ink;
  vec3 soft = texture(uField, vec2(css.x / (uCell.x * uGrid.x), 1.0 - css.y / (uCell.y * uGrid.y))).rgb;
  float softLum = max(soft.r, max(soft.g, soft.b));
  vec3 glow = soft / max(softLum, 1e-4) * (1.0 - exp(-softLum * 1.5)) * 0.16;
  vec3 rgb = text + glow;
  outColor = vec4(rgb, clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-3, Math.min(3, z));
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function locations(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]): Uniforms {
  const found: Uniforms = {};
  for (const name of names) found[name] = gl.getUniformLocation(program, name);
  return found;
}

/**
 * Three rivers of grains from one payment to three pots, drawn as ASCII.
 *
 * Grains and the guilloche are added into a small field, two texels per
 * character cell. A second pass reads one value per cell and picks the
 * character whose ink matches the brightness, tinted by the field's colour.
 */
export class Streams {
  private readonly gl: WebGL2RenderingContext;
  private readonly grainProgram: WebGLProgram;
  private readonly guillocheProgram: WebGLProgram;
  private readonly asciiProgram: WebGLProgram;
  private readonly grainVao: WebGLVertexArrayObject;
  private readonly guillocheVao: WebGLVertexArrayObject;
  private readonly guillocheCounts: number[] = [];
  private readonly field: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly atlas: WebGLTexture;
  private readonly u: { grain: Uniforms; guilloche: Uniforms; ascii: Uniforms };
  private readonly options: Options;
  private shares: [number, number, number] = [1, 0, 0];
  private target: [number, number, number] = [1, 0, 0];
  private packetStart = -Infinity;
  private grid = { cols: 1, rows: 1 };
  private size = { width: 1, height: 1, dpr: 1 };
  private lastFrame = 0;
  private fieldFormat: { internal: number; type: number };

  static create(canvas: HTMLCanvasElement, options: Options): Streams | null {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    try {
      return new Streams(gl, options);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext, options: Options) {
    this.gl = gl;
    this.options = options;
    const grain = compile(gl, GRAIN_VS, GRAIN_FS);
    const guilloche = compile(gl, GUILLOCHE_VS, GUILLOCHE_FS);
    const ascii = compile(gl, ASCII_VS, ASCII_FS);
    if (!grain || !guilloche || !ascii) throw new Error("shader");
    this.grainProgram = grain;
    this.guillocheProgram = guilloche;
    this.asciiProgram = ascii;
    this.u = {
      grain: locations(gl, grain, ["uRes", "uStart", "uEnd", "uShare", "uCuts", "uColor", "uTime", "uPacket", "uGain", "uWiden", "uVertical"]),
      guilloche: locations(gl, guilloche, ["uRes", "uCenter", "uRadius", "uAngle", "uTint"]),
      ascii: locations(gl, ascii, ["uField", "uAtlas", "uCell", "uGrid", "uDpr", "uHeight", "uGlyphs"]),
    };

    const data = new Float32Array(options.grains * 4);
    for (let i = 0; i < options.grains; i += 1) {
      data[i * 4] = Math.random();
      data[i * 4 + 1] = Math.random();
      data[i * 4 + 2] = gaussian();
      data[i * 4 + 3] = 1 + Math.random() * 0.9;
    }
    this.grainVao = gl.createVertexArray();
    gl.bindVertexArray(this.grainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);

    const curves = guillocheCurves(GUILLOCHE_STEPS);
    const joined = new Float32Array(curves.reduce((sum, curve) => sum + curve.length, 0));
    let offset = 0;
    for (const curve of curves) {
      joined.set(curve, offset);
      offset += curve.length;
      this.guillocheCounts.push(curve.length / 2);
    }
    this.guillocheVao = gl.createVertexArray();
    gl.bindVertexArray(this.guillocheVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, joined, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const floatTargets = gl.getExtension("EXT_color_buffer_float") !== null;
    this.fieldFormat = floatTargets
      ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT }
      : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.field = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    this.atlas = gl.createTexture();
  }

  /** Match the canvas to its CSS box and rebuild the field and glyph atlas. */
  resize(width: number, height: number): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = { width: Math.max(1, width), height: Math.max(1, height), dpr };
    const canvas = gl.canvas;
    canvas.width = Math.round(this.size.width * dpr);
    canvas.height = Math.round(this.size.height * dpr);
    const { cell } = this.options;
    this.grid = {
      cols: Math.ceil(this.size.width / cell.width),
      rows: Math.ceil(this.size.height / cell.height),
    };

    gl.bindTexture(gl.TEXTURE_2D, this.field);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.fieldFormat.internal,
      this.grid.cols * 2,
      this.grid.rows * 2,
      0,
      gl.RGBA,
      this.fieldFormat.type,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.field, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.buildAtlas(dpr);
  }

  private buildAtlas(dpr: number): void {
    const gl = this.gl;
    const { ramp, cell } = this.options;
    const glyphs = [...ramp];
    const w = Math.round(cell.width * dpr);
    const h = Math.round(cell.height * dpr);
    const canvas = document.createElement("canvas");
    canvas.width = w * glyphs.length;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `500 ${Math.round(h * 0.86)}px "JetBrains Mono", ui-monospace, monospace`;
    glyphs.forEach((glyph, index) => context.fillText(glyph, index * w + w / 2, h / 2 + h * 0.04));
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Rebuild the glyphs once the web font has arrived. */
  refreshGlyphs(): void {
    this.buildAtlas(this.size.dpr);
  }

  /** New split for the rivers. `instant` skips the easing, for reduced motion. */
  setShares(shares: readonly [number, number, number], instant = false): void {
    this.target = [shares[0], shares[1], shares[2]];
    if (instant) this.shares = [...this.target];
  }

  firePacket(now: number): void {
    this.packetStart = now;
  }

  /**
   * Draw one frame.
   *
   * @param now - Milliseconds, from `performance.now()`.
   * @param geometry - Boxes measured this frame.
   * @param still - Draw a fixed moment, with no easing and no packet.
   */
  frame(now: number, geometry: Geometry, still = false): void {
    const gl = this.gl;
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const ease = still ? 1 : 1 - Math.exp(-6 * dt);
    for (let i = 0; i < 3; i += 1) {
      const current = this.shares[i] ?? 0;
      this.shares[i] = current + ((this.target[i] ?? 0) - current) * ease;
    }
    const time = still ? 7.31 : now / 1000;
    const packetAge = (now - this.packetStart) / 1000;
    const packet = !still && packetAge < PACKET_SECONDS ? -0.1 + (packetAge / PACKET_SECONDS) * 1.2 : -10;

    const { width, height } = this.size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.grid.cols * 2, this.grid.rows * 2);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(this.guillocheProgram);
    const gu = this.u.guilloche;
    gl.uniform2f(gu["uRes"] ?? null, width, height);
    gl.uniform2f(gu["uCenter"] ?? null, geometry.center.x, geometry.center.y);
    gl.uniform1f(gu["uRadius"] ?? null, geometry.radius);
    gl.uniform1f(gu["uAngle"] ?? null, still ? 0 : ((time % GUILLOCHE_TURN_SECONDS) / GUILLOCHE_TURN_SECONDS) * Math.PI * 2);
    gl.uniform3f(gu["uTint"] ?? null, ...this.options.guilloche);
    gl.bindVertexArray(this.guillocheVao);
    let first = 0;
    for (const count of this.guillocheCounts) {
      gl.drawArrays(gl.LINE_STRIP, first, count);
      first += count;
    }

    gl.useProgram(this.grainProgram);
    const u = this.u.grain;
    const [a, b] = this.shares;
    gl.uniform2f(u["uRes"] ?? null, width, height);
    gl.uniform2f(u["uStart"] ?? null, geometry.start.x, geometry.start.y);
    gl.uniform2fv(u["uEnd"] ?? null, geometry.ends.flatMap((end) => [end.x, end.y]));
    gl.uniform3fv(u["uShare"] ?? null, this.shares);
    gl.uniform2f(u["uCuts"] ?? null, a, a + b);
    gl.uniform3fv(u["uColor"] ?? null, this.options.colors.flatMap((color) => [...color]));
    gl.uniform1f(u["uTime"] ?? null, time);
    gl.uniform1f(u["uPacket"] ?? null, packet);
    gl.uniform1f(u["uGain"] ?? null, 0.04 * (26_000 / this.options.grains));
    // A river only a few character rows tall reads as a line, not as ASCII.
    gl.uniform1f(u["uWiden"] ?? null, 1.6);
    gl.uniform1f(u["uVertical"] ?? null, geometry.vertical ? 1 : 0);
    gl.bindVertexArray(this.grainVao);
    gl.drawArrays(gl.POINTS, 0, this.options.grains);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.asciiProgram);
    const au = this.u.ascii;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.field);
    gl.uniform1i(au["uField"] ?? null, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(au["uAtlas"] ?? null, 1);
    gl.uniform2f(au["uCell"] ?? null, this.options.cell.width, this.options.cell.height);
    gl.uniform2f(au["uGrid"] ?? null, this.grid.cols, this.grid.rows);
    gl.uniform1f(au["uDpr"] ?? null, this.size.dpr);
    gl.uniform1f(au["uHeight"] ?? null, gl.canvas.height);
    gl.uniform1f(au["uGlyphs"] ?? null, [...this.options.ramp].length);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
