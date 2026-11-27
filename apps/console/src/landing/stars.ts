/**
 * The fixed WebGL background behind the story. It starts as a sky of stars,
 * gathers into the shapes of each step as the page scrolls (the wall, the
 * "402", the two rails, the payment ring) and relaxes back into stars.
 *
 * The shapes are drawn from random seeds, so they are illustrative. Under
 * reduced motion the field keeps its position for the scroll and does not
 * drift on its own.
 */

import * as THREE from "three";

type Rgb = readonly [number, number, number];
type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
const WHITE: Rgb = [0.85, 0.9, 1];
const BLUE: Rgb = [0.23, 0.51, 0.96];
const BLUE2: Rgb = [0.38, 0.65, 0.98];
const TEAL: Rgb = [0.18, 0.83, 0.75];
const DIM: Rgb = [0.35, 0.38, 0.45];
const ALARM: Rgb = [1, 0.45, 0.45];

/** Shape index of the stars, the field at rest. */
const STARS = 5;
/** Shape order along the scroll: stars, wall, 402, rails, ring, stars. */
const SEQUENCE = [STARS, 0, 1, 2, 3, 4, STARS];

/** Read a typed array without the `undefined` that noUncheckedIndexedAccess adds. */
function at(list: ArrayLike<number>, index: number): number {
  return list[index] ?? 0;
}

function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    // No WebGL: the canvas goes and the page keeps its static texture.
    return null;
  }
}

export function mountStars(canvas: HTMLCanvasElement, story: HTMLElement, reduce: MediaQueryList): void {
  const created = createRenderer(canvas);
  if (created === null) {
    canvas.remove();
    return;
  }
  const renderer: THREE.WebGLRenderer = created;
  const steps = [...story.querySelectorAll<HTMLElement>(".step")];
  const firstStep: HTMLElement | undefined = steps[0];
  const lastStep: HTMLElement | undefined = steps[steps.length - 1];
  const converge = document.querySelector<HTMLElement>("[data-converge]");
  const intro = story.querySelector<HTMLElement>("[data-intro]");
  if (firstStep === undefined || lastStep === undefined) return;
  const firstEl: HTMLElement = firstStep;
  const lastEl: HTMLElement = lastStep;

  const mobile = innerWidth < 820;
  const N = mobile ? 12000 : 26000;

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 0, 9.5);
  const group = new THREE.Group();
  scene.add(group);

  // One random seed per particle, reused by every shape so the particles keep
  // their identity as they move from one shape to the next.
  const R1 = new Float32Array(N);
  const R2 = new Float32Array(N);
  const R3 = new Float32Array(N);
  const R4 = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    R1[i] = Math.random();
    R2[i] = Math.random();
    R3[i] = Math.random();
    R4[i] = Math.random();
  }
  const WALL = Math.floor(N * 0.45);
  const STREAM = Math.floor(N * 0.75);

  // Brick wall in the y-z plane at x = 0. The gate version leaves a hole in
  // the middle for the requests to pass through.
  const wallPts = new Float32Array(WALL * 3);
  const gatePts = new Float32Array(WALL * 3);
  function brick(out: Float32Array, o: number, hole: boolean): void {
    for (;;) {
      const y = (Math.random() * 2 - 1) * 1.8;
      const z = (Math.random() * 2 - 1) * 1.3;
      const row = Math.floor((y + 1.8) / 0.3);
      const fy = ((y + 1.8) / 0.3) % 1;
      const off = row % 2 ? 0.3 : 0;
      const fz = ((z + 1.3 + off) / 0.6) % 1;
      if (fy < 0.12 || fy > 0.88 || fz < 0.06 || fz > 0.94) {
        if (Math.random() > 0.25) continue;
      }
      if (hole && Math.abs(y) < 0.62 && Math.abs(z) < 0.62) continue;
      out[o] = (Math.random() - 0.5) * 0.12;
      out[o + 1] = y;
      out[o + 2] = z;
      return;
    }
  }
  for (let i = 0; i < WALL; i += 1) {
    brick(wallPts, i * 3, false);
    brick(gatePts, i * 3, true);
  }

  // Points sampled from the "402" text, drawn offscreen.
  const text: number[] = [];
  const textCanvas = document.createElement("canvas");
  textCanvas.width = 700;
  textCanvas.height = 260;
  const tx = textCanvas.getContext("2d");
  if (tx) {
    tx.fillStyle = "#fff";
    tx.font = "800 230px Inter, Arial, sans-serif";
    tx.textAlign = "center";
    tx.textBaseline = "middle";
    tx.fillText("402", 350, 138);
    const pixels = tx.getImageData(0, 0, 700, 260).data;
    for (let y = 0; y < 260; y += 2) {
      for (let x = 0; x < 700; x += 2) {
        if (at(pixels, (y * 700 + x) * 4 + 3) > 128) text.push((x - 350) / 700 * 6.2, -(y - 130) / 700 * 6.2);
      }
    }
  }
  const textCount = text.length / 2;

  // Scratch position and colour of the particle being computed.
  const o: Vec3 = [0, 0, 0];
  const c: Vec3 = [0, 0, 0];

  function mixc(a: Rgb, b: Rgb, t: number, k: number): void {
    c[0] = (a[0] + (b[0] - a[0]) * t) * k;
    c[1] = (a[1] + (b[1] - a[1]) * t) * k;
    c[2] = (a[2] + (b[2] - a[2]) * t) * k;
  }
  function setc(a: Rgb, k: number): void {
    c[0] = a[0] * k;
    c[1] = a[1] * k;
    c[2] = a[2] * k;
  }
  function sphere(i: number, cx: number, cy: number, R: number): void {
    const th = TAU * at(R1, i);
    const ph = Math.acos(2 * at(R2, i) - 1);
    const r = R * (0.9 + 0.1 * at(R3, i));
    o[0] = cx + r * Math.sin(ph) * Math.cos(th);
    o[1] = cy + r * Math.cos(ph);
    o[2] = r * Math.sin(ph) * Math.sin(th);
  }
  function dust(i: number): void {
    const th = TAU * at(R1, i);
    const ph = Math.acos(2 * at(R2, i) - 1);
    const r = 4.5 + at(R3, i) * 4;
    o[0] = r * Math.sin(ph) * Math.cos(th);
    o[1] = r * Math.cos(ph) * 0.7;
    o[2] = r * Math.sin(ph) * Math.sin(th) - 2;
  }

  /** Fill `o` and `c` with particle `i` in shape `s` at time `t`. */
  function shape(s: number, i: number, t: number): void {
    if (s === STARS) {
      const j = i * 3;
      o[0] = at(STAR, j);
      o[1] = at(STAR, j + 1);
      o[2] = at(STAR, j + 2);
      c[0] = at(STARC, j);
      c[1] = at(STARC, j + 1);
      c[2] = at(STARC, j + 2);
      return;
    }
    const r1 = at(R1, i);
    const r2 = at(R2, i);
    const r3 = at(R3, i);
    const r4 = at(R4, i);
    if (i < WALL) {
      const w = i * 3;
      if (s === 0) {
        o[0] = at(wallPts, w);
        o[1] = at(wallPts, w + 1);
        o[2] = at(wallPts, w + 2);
        mixc(WHITE, BLUE2, r4 * 0.5, 0.85);
      } else if (s === 1) {
        o[0] = at(gatePts, w);
        o[1] = at(gatePts, w + 1);
        o[2] = at(gatePts, w + 2);
        mixc(WHITE, BLUE2, r4 * 0.5, 0.75);
      } else if (s === 2) {
        const k = Math.floor(r2 * textCount) * 2;
        o[0] = at(text, k) + (r3 - 0.5) * 0.03;
        o[1] = at(text, k + 1) + (r4 - 0.5) * 0.03;
        o[2] = (r1 - 0.5) * 0.25;
        mixc(WHITE, BLUE2, r4 * 0.6, 0.8);
      } else if (s === 3) {
        o[0] = -1.2 + at(wallPts, w) * 0.6;
        o[1] = at(wallPts, w + 1) * 0.85;
        o[2] = at(wallPts, w + 2) * 0.5;
        mixc(WHITE, BLUE2, r4 * 0.5, 0.45);
      } else if (s === 4) {
        o[0] = -1.6 + at(wallPts, w);
        o[1] = at(wallPts, w + 1) * 0.9;
        o[2] = at(wallPts, w + 2) * 0.8;
        mixc(WHITE, BLUE2, r4 * 0.5, 0.55);
      } else {
        // The final ring, the portal the stars relax through.
        const a = TAU * r1 + t * 0.05;
        const R = 2.3 + (r2 - 0.5) * 0.25;
        o[0] = Math.cos(a) * R;
        o[1] = Math.sin(a) * R;
        o[2] = (r3 - 0.5) * 0.3;
        mixc(WHITE, BLUE2, r4, 0.6);
      }
      return;
    }
    if (i < STREAM) {
      // Requests flowing in from the left.
      const sp = 0.05 + r3 * 0.05;
      const u = (r1 + t * sp) % 1;
      const jy = (r2 - 0.5) * 0.14;
      const jz = (r4 - 0.5) * 0.14;
      if (s === 0) {
        o[0] = -16 + u * 24;
        o[1] = jy;
        o[2] = jz;
        mixc(BLUE, BLUE2, r4, 0.9);
      } else if (s === 1) {
        o[0] = -16 + u * 19.2;
        o[1] = jy * (1 - u * 0.6);
        o[2] = jz * (1 - u * 0.6);
        if (o[0] > 2.4) o[0] = 2.4 + (o[0] - 2.4) * 0.2;
        mixc(BLUE, WHITE, u * 0.5, 0.95);
      } else if (s === 2) {
        // Piling up in front of the wall.
        const x = -16 + u * 13.4;
        const over = Math.max(0, x + 3.6);
        o[0] = Math.min(x, -3.6 + r3 * 0.25);
        o[1] = jy + (r2 - 0.5) * over * 2.6;
        o[2] = jz + (r4 - 0.5) * over * 2;
        mixc(BLUE, ALARM, Math.min(1, over * 2.2), 0.95);
      } else if (s === 3) {
        // Two rails, one arcing up and one down.
        const even = (i & 1) === 0;
        const sg = even ? 1 : -1;
        if (u < 0.45) {
          o[0] = -16 + (u / 0.45) * 14.8;
          o[1] = jy;
          o[2] = jz;
          mixc(BLUE2, WHITE, 0.3, 0.9);
        } else if (u < 0.82) {
          const v = (u - 0.45) / 0.37;
          o[0] = -1.2 + v * 3.4;
          o[1] = sg * Math.sin(v * Math.PI) * 1.5 + jy;
          o[2] = -sg * Math.sin(v * Math.PI) * 0.8 + jz;
          setc(even ? BLUE : TEAL, 1.1);
        } else {
          const v = (u - 0.82) / 0.18;
          o[0] = 2.2 + v * 1.0;
          o[1] = jy * (1 - v);
          o[2] = jz * (1 - v);
          mixc(even ? BLUE : TEAL, WHITE, v, 1);
        }
      } else if (s === 4) {
        // A third of the requests reach the origin; the rest orbit the wall.
        if (i % 3 === 0) {
          let x = -16 + u * 17.4;
          if (x > 1) x = 1 + (x - 1) * 0.25;
          o[0] = x;
          o[1] = jy;
          o[2] = jz;
          mixc(BLUE, WHITE, u * 0.4, 0.9);
          return;
        }
        const a = TAU * r1 + t * (0.25 + r3 * 0.1);
        const R = 1.9 + (r2 - 0.5) * 0.2;
        o[0] = -1.6 + Math.cos(a) * 0.55 * (r4 - 0.5);
        o[1] = Math.cos(a) * R;
        o[2] = Math.sin(a) * R * 0.95;
        setc(i & 1 ? TEAL : BLUE, 0.95);
      } else {
        // The equator that keeps flowing at the end.
        const a = TAU * r1 + t * 0.12;
        const R = 1.35 + (r2 - 0.5) * 0.08;
        o[0] = Math.cos(a) * R;
        o[1] = (r4 - 0.5) * 0.06;
        o[2] = Math.sin(a) * R;
        setc(i & 1 ? TEAL : BLUE2, 0.9);
      }
      return;
    }
    // The rest is dust, and the origin as a sphere.
    if (s === 0) {
      dust(i);
      setc(DIM, 0.4);
    } else if (s === 1) {
      sphere(i, 3.3, 0, 0.85);
      mixc(WHITE, BLUE2, r4 * 0.4, 0.75);
    } else if (s === 2) {
      sphere(i, 3.6, 0, 0.7);
      setc(DIM, 0.5);
    } else if (s === 3) {
      sphere(i, 3.6, 0, 0.75);
      mixc(WHITE, BLUE2, r4 * 0.4, 0.75);
    } else if (s === 4) {
      sphere(i, 2.2, 0, 1.25);
      mixc(WHITE, BLUE2, r4 * 0.3, 0.7);
    } else {
      sphere(i, 0, 0, 1.05);
      mixc(WHITE, BLUE2, r4 * 0.5, 0.75);
    }
  }

  // Stars: positions in a volume in front of the camera, rebuilt on resize.
  const STAR = new Float32Array(N * 3);
  const STARC = new Float32Array(N * 3);
  function buildStars(): void {
    const cz = camera.position.z;
    const tn = Math.tan((22.5 * Math.PI) / 180);
    const asp = camera.aspect;
    for (let i = 0; i < N; i += 1) {
      const j = i * 3;
      const d = 4 + Math.pow(at(R3, i), 0.7) * 46;
      const u = (at(R1, i) * 2 - 1) * 1.08;
      const v = (at(R2, i) * 2 - 1) * 1.08;
      STAR[j] = u * d * tn * asp;
      STAR[j + 1] = v * d * tn;
      STAR[j + 2] = cz - d;
      const b = (0.18 + Math.pow(at(R4, i), 4) * 0.75) * (1.25 - d / 60);
      const blue = at(R1, (i * 7) % N) < 0.22;
      STARC[j] = b * (blue ? 0.62 : 0.92);
      STARC[j + 1] = b * (blue ? 0.75 : 0.94);
      STARC[j + 2] = b;
    }
  }

  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const size = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    seed[i] = at(R1, (i * 13 + 7) % N);
    size[i] = 0.6 + Math.pow(at(R3, i), 3) * 1.6;
  }
  const positionAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("color", colorAttr);
  geometry.setAttribute("size", new THREE.BufferAttribute(size, 1));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seed, 1));

  // Pure additive blending with premultiplied colour: a dark point is
  // invisible and never darkens the background.
  const uniforms = {
    uPR: { value: renderer.getPixelRatio() },
    uScale: { value: 1 },
    uTime: { value: 0 },
    uTw: { value: 0 },
    uDim: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    premultipliedAlpha: true,
    vertexColors: true,
    uniforms,
    vertexShader: `attribute float size;attribute float seed;varying vec3 vC;uniform float uPR;uniform float uScale;uniform float uTime;uniform float uTw;uniform float uDim;
    void main(){float tw=1.-uTw*.5*(.5+.5*sin(uTime*(.5+seed*1.6)+seed*40.));vC=color*tw*uDim;vec4 mv=modelViewMatrix*vec4(position,1.);
    gl_PointSize=max(1.,size*uScale*(17./-mv.z))*uPR;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec3 vC;void main(){vec2 d=gl_PointCoord-.5;float a=smoothstep(.5,.1,length(d));vec3 rgb=vC*a;gl_FragColor=vec4(rgb,min(1.,max(rgb.r,max(rgb.g,rgb.b))*.6));}`,
  });
  group.add(new THREE.Points(geometry, material));

  // Per-shape rotation, horizontal extent and vertical offset. Each shape is
  // scaled to fit the free area to the right of the text column.
  const ROT: readonly (readonly [number, number])[] = [
    [0.55, 0.18],
    [0.35, 0.12],
    [0, 0],
    [0.3, 0.15],
    [0.5, 0.12],
    [0, 0],
  ];
  const BX: readonly (readonly [number, number])[] = [
    [-1.6, 1.6],
    [-1.2, 4.2],
    [-3.2, 4.4],
    [-1.4, 4.4],
    [-2.6, 3.5],
  ];
  const OY = [-0.1, -0.2, 0.1, -0.2, -0.2, 0];
  const OYM = [-4.7, -2.4, -2.6, -2.4, -2.4, 0];
  const SC: number[] = [1, 1, 1, 1, 1, 1];
  const OFF: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  let columnX = -1e9;

  function rotOf(s: number): readonly [number, number] {
    return ROT[s] ?? [0, 0];
  }
  function offOf(s: number): [number, number] {
    return OFF[s] ?? [0, 0];
  }
  function scaleOf(s: number): number {
    return SC[s] ?? 1;
  }

  function layout(): void {
    const w = innerWidth;
    const mob = w < 820;
    const halfHeight = Math.tan((22.5 * Math.PI) / 180) * camera.position.z;
    const halfWidth = halfHeight * camera.aspect;
    let left: number;
    let right: number;
    if (mob) {
      left = -halfWidth + 0.35;
      right = halfWidth - 0.35;
    } else {
      const column = firstEl.getBoundingClientRect().right;
      left = (column / w) * 2 * halfWidth - halfWidth + 0.4;
      right = halfWidth - 0.45;
    }
    columnX = mob ? -1e9 : left - 0.2;
    const cx = (left + right) / 2;
    const span = right - left;
    BX.forEach(([a, b], k) => {
      const sc = Math.min(1.05, span / (b - a));
      SC[k] = sc;
      OFF[k] = [cx - ((a + b) / 2) * sc, mob ? at(OYM, k) : at(OY, k)];
    });
    SC[5] = 1;
    OFF[5] = [0, 0];
  }

  let settled = false;
  function resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w < 820 ? 15 : 9.5;
    camera.updateProjectionMatrix();
    uniforms.uScale.value = w < 820 ? 1.3 : 1;
    buildStars();
    layout();
    settled = false;
  }
  addEventListener("resize", resize);
  resize();

  /** Map the scroll position to a point in SEQUENCE: anchors are the label, the intro, each step, and the end. */
  function progress(): number {
    const vh = innerHeight;
    const mid = vh * 0.5;
    const storyBox = story.getBoundingClientRect();
    const cb = converge ? converge.getBoundingClientRect() : { top: storyBox.top - vh, height: 0 };
    const ib = intro ? intro.getBoundingClientRect() : { top: storyBox.top, height: 0 };
    const endBox = lastEl.getBoundingClientRect();
    const ys = [
      cb.top + cb.height * 0.5,
      ib.top + ib.height * 0.5,
      ...steps.map((element) => {
        const box = element.getBoundingClientRect();
        return box.top + box.height * 0.5;
      }),
      endBox.top + endBox.height * 0.5 + 0.3 * vh,
    ];
    const start = ys[0];
    if (start === undefined || start > mid) return 0;
    for (let k = ys.length - 1; k >= 0; k -= 1) {
      const yk = ys[k];
      if (yk === undefined || yk > mid) continue;
      if (k === ys.length - 1) return k;
      const yn = ys[k + 1] ?? yk;
      const span = yn - yk;
      return span === 0 ? k : k + (mid - yk) / span;
    }
    return 0;
  }

  const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  let sq = 0;
  let mx = 0;
  let my = 0;
  let tmx = 0;
  let tmy = 0;
  let lastDraw = 0;
  let t = 0;
  let lastNow = performance.now();
  let prevKey = "";
  let settledAt = -1;
  addEventListener("pointermove", (event) => {
    tmx = event.clientX / innerWidth - 0.5;
    tmy = event.clientY / innerHeight - 0.5;
  });

  const A: Vec3 = [0, 0, 0];
  const CA: Vec3 = [0, 0, 0];
  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    const still = reduce.matches;

    const q = progress();
    sq = still ? q : sq + (q - sq) * (q > 5 ? 0.12 : 0.07);
    if (Math.abs(q - sq) < 0.0005) sq = q;
    if (!still) t += dt;
    const tt = still ? 0 : t;
    const mob = innerWidth < 820;

    const q0 = Math.min(5, Math.floor(sq));
    const f = sq - q0;
    const q1 = Math.min(6, q0 + 1);
    const k = ease(Math.min(1, Math.max(0, (f - 0.08) / 0.84)));
    const S0 = at(SEQUENCE, q0);
    const S1 = at(SEQUENCE, q1);
    const starsOnly = (S0 === STARS && k < 0.0005) || (S1 === STARS && k > 0.9995) || sq <= 0 || sq >= 6;
    const starW = S0 === STARS ? 1 - k : S1 === STARS ? k : 0;

    // The hero sits on a dimmer field so the simulator reads first.
    const minDim = mob ? 0.55 : 0.7;
    const dim = sq < 1 ? minDim + (1 - minDim) * Math.max(0, sq) : 1;
    uniforms.uTw.value = still ? 0 : starW;
    uniforms.uTime.value = t;
    uniforms.uDim.value = dim;

    // Stars at rest only twinkle, at about 30 frames a second.
    const which = sq >= 5.5 ? 6 : 0;
    if (starsOnly && settled && settledAt === which) {
      if (still) {
        const key = dim.toFixed(2);
        if (key === prevKey) return;
        prevKey = key;
      } else if (now - lastDraw < 33) {
        return;
      }
      lastDraw = now;
      renderer.render(scene, camera);
      return;
    }

    const gs0 = starsOnly ? STARS : S0;
    const gs1 = starsOnly ? STARS : S1;
    const gsc = scaleOf(gs0) + (scaleOf(gs1) - scaleOf(gs0)) * k;
    const gox = offOf(gs0)[0] + (offOf(gs1)[0] - offOf(gs0)[0]) * k;
    const from = starsOnly ? STARS : S0;

    for (let i = 0; i < N; i += 1) {
      shape(from, i, tt);
      A[0] = o[0];
      A[1] = o[1];
      A[2] = o[2];
      CA[0] = c[0];
      CA[1] = c[1];
      CA[2] = c[2];
      if (!starsOnly && k > 0.0005) {
        shape(S1, i, tt);
        const kk = Math.min(1, Math.max(0, k * 1.35 - at(R4, i) * 0.35));
        A[0] += (o[0] - A[0]) * kk;
        A[1] += (o[1] - A[1]) * kk;
        A[2] += (o[2] - A[2]) * kk;
        CA[0] += (c[0] - CA[0]) * kk;
        CA[1] += (c[1] - CA[1]) * kk;
        CA[2] += (c[2] - CA[2]) * kk;
        const bu = Math.sin(kk * Math.PI) * (S1 === STARS || S0 === STARS ? 1.4 : 0.35);
        A[0] += (at(R1, i) - 0.5) * bu;
        A[1] += (at(R2, i) - 0.5) * bu;
        A[2] += (at(R3, i) - 0.5) * bu;
      }
      // On desktop the stream only shows to the right of the text column.
      if (!mob && !starsOnly && i >= WALL && i < STREAM) {
        const fx = (0.3 + 0.7 * Math.min(1, Math.max(0, (A[0] * gsc + gox - columnX) / 1.2))) * (1 - starW) + starW;
        CA[0] *= fx;
        CA[1] *= fx;
        CA[2] *= fx;
      }
      const j = i * 3;
      const dr = starsOnly ? 0 : 0.012 * (1 - starW);
      const r = at(R1, i) * 40;
      pos[j] = A[0] + Math.sin(tt * 0.7 + r) * dr;
      pos[j + 1] = A[1] + Math.cos(tt * 0.6 + r * 1.3) * dr;
      pos[j + 2] = A[2] + Math.sin(tt * 0.5 + r * 0.7) * dr;
      col[j] = CA[0];
      col[j + 1] = CA[1];
      col[j + 2] = CA[2];
    }
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    // The group carries the shape to its place; the stars stay at the origin.
    const blend = (a: number, b: number): number => a + (b - a) * k;
    const g0 = starsOnly ? STARS : S0;
    const g1 = starsOnly ? STARS : S1;
    mx += (tmx - mx) * 0.04;
    my += (tmy - my) * 0.04;
    const wob = 1 - starW;
    const rot0 = rotOf(g0);
    const rot1 = rotOf(g1);
    group.rotation.y = blend(rot0[0], rot1[0]) + (mx * 0.3 + Math.sin(tt * 0.15) * 0.04) * wob;
    group.rotation.x = blend(rot0[1], rot1[1]) + my * 0.2 * wob;
    group.position.x = blend(offOf(g0)[0], offOf(g1)[0]);
    group.position.y = blend(offOf(g0)[1], offOf(g1)[1]);
    group.scale.setScalar(blend(scaleOf(g0), scaleOf(g1)));
    if (starsOnly) {
      group.rotation.set(0, 0, 0);
      group.position.set(0, 0, 0);
      group.scale.setScalar(1);
      settled = true;
      settledAt = which;
    } else {
      settled = false;
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
