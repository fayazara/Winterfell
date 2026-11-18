/**
 * GLSL for the three passes:
 *
 *   1. scene   — raymarched world at low resolution (terrain, path, pines,
 *                castle, sky, fog, rolling mist, torch light)
 *   2. sprites — pixel-art hands + procedural torch flame, drawn into the
 *                same low-res target so their pixels match the world's
 *   3. post    — palette quantisation with ordered (Bayer) dithering, then
 *                nearest-neighbour upscale to the screen
 */

const COMMON = /* glsl */ `
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3){
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3. - 2. * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm4(vec2 p){
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; }
  return s;
}
float fbm2(vec2 p){
  float a = .5, s = 0.;
  for (int i = 0; i < 2; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; }
  return s;
}
`

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0., 1.); }
`

export const SCENE_FRAG = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragDepth;   // ray distance, 16-bit in RG

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uTanHalfFov;
uniform vec3 uTorchPos, uTorchColor;
uniform float uTorch, uTorchWorld;
uniform float uFog, uMist, uWind, uWindowGlow, uGround, uCloudCover, uCloudBand;
uniform vec3 uSkyTop, uHorizon, uSunColor, uSunDir, uAmbient, uHaze, uCloudLit, uCloudShade, uCloudHi;
uniform float uCel;
uniform vec3 uCastle;
uniform sampler2D uSky;
uniform float uPainted;    // 1 = painted sky panorama + painted props
uniform float uSdfProps;   // 1 = procedural trees/cottages (fallback)
uniform float uSdfCastle;  // 1 = procedural castle (fallback)

${COMMON}

#define CELL 8.0
#define HCELL 26.0
#define CSCALE 1.6

// ---------- world (mirrors world.ts) ----------
float pathX(float z){ return sin(z * 0.045) * 7. + sin(z * 0.017 + 1.3) * 10.; }
float terrainBase(vec2 p){ return fbm4(p * 0.035) * 9. - 3.; }
float ridged(vec2 p){
  float a = .5, s = 0.;
  for (int i = 0; i < 3; i++){ s += a * (1. - abs(2. * vnoise(p) - 1.)); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; }
  return s;
}
float terrain(vec2 p){
  float px = pathX(p.y);
  float d = abs(p.x - px);
  float h = terrainBase(p) + fbm2(p * 0.15 + vec2(5.3, 1.7));
  h += smoothstep(20., 150., d) * (30. + 25. * vnoise(p * 0.012));
  float m = 1. - smoothstep(1.5, 4., d);
  if (m > 0.) h = mix(h, terrainBase(vec2(px, p.y)) - 0.2, m);
  h += 16. * smoothstep(-50., 40., p.y);
  float far = smoothstep(-240., -420., p.y) * (1. - uPainted);
  if (far > 0.) h += far * (50. + 170. * ridged(p * 0.005));
  vec2 c = p - uCastle.xz;
  float hm = exp(-dot(c, c) / 2000.);
  if (hm > .001) h += hm * (58. + 14. * (ridged(p * 0.06) - .5));
  return h;
}

// ---------- SDF primitives ----------
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
float sdCyl(vec3 p, float r, float h0, float h1){
  vec2 d = vec2(length(p.xz) - r, max(h0 - p.y, p.y - h1));
  return min(max(d.x, d.y), 0.) + length(max(d, 0.));
}
float sdSpire(vec3 p, float r, float h0, float h1){
  float hh = h1 - h0;
  float k = clamp((p.y - h0) / hh, 0., 1.);
  float d = (length(p.xz) - r * (1. - k)) * hh / sqrt(hh * hh + r * r);
  return max(d, max(h0 - p.y, p.y - h1));
}
float crenel(vec3 p, float top){
  // battlement teeth around a cylinder top
  float a = atan(p.z, p.x) * 4.;
  return step(.5, fract(a)) * step(top - 1.2, p.y);
}

float castleRaw(vec3 q){
  float b = sdBox(q - vec3(0., 24., 0.), vec3(16., 42., 13.));
  if (b > 3.) return b;
  float d = sdBox(q - vec3(0., 2., 0.), vec3(10., 12., 7.));
  float cren = sdBox(vec3(mod(q.x, 2.) - 1., q.y - 14.6, abs(q.z) - 6.6), vec3(.5, .7, .45));
  d = min(d, cren);
  d = min(d, sdBox(q - vec3(-1., 10., .5), vec3(5., 18., 4.)));
  d = min(d, sdSpire(q - vec3(-1., 0., .5), 5.2, 28., 36.));
  vec3 c = vec3(abs(q.x) - 10., q.y, abs(q.z) - 7.);
  d = min(d, sdCyl(c, 2.3, -16., 22.));
  d = min(d, sdCyl(c, 2.8, 21., 23.));
  d = min(d, sdSpire(c, 2.9, 23., 33.));
  vec3 g = q - vec3(3., 0., -1.);
  d = min(d, sdCyl(g, 3., -16., 40.));
  d = min(d, sdCyl(g, 3.7, 38., 41.));
  d = min(d, sdCyl(g, 2.4, 41., 46.));
  d = min(d, sdSpire(g, 2.9, 46., 64.));
  d = min(d, sdCyl(q - vec3(-6., 0., 2.5), 1.5, -10., 34.));
  d = min(d, sdSpire(q - vec3(-6., 0., 2.5), 1.9, 34., 47.));
  d = min(d, sdCyl(q - vec3(7., 0., 3.), 1.7, -10., 29.));
  d = min(d, sdSpire(q - vec3(7., 0., 3.), 2.1, 29., 39.));
  // outer wall stepping down the crag
  d = min(d, sdBox(q - vec3(0., -4., 9.5), vec3(13., 7., .8)));
  d = min(d, sdCyl(vec3(abs(q.x) - 13., q.y, q.z - 9.5), 1.8, -14., 6.));
  return d;
}
float castle(vec3 q){ return castleRaw(q / CSCALE) * CSCALE; }

vec2 trees(vec3 p, float th){
  float best = 1e9, mat = 3.;
  vec2 base = floor(p.xz / CELL - .5);
  for (int j = 0; j < 2; j++)
  for (int i = 0; i < 2; i++){
    vec2 id = base + vec2(i, j);
    float r = hash12(id * 1.37 + 11.1);
    vec2 c = (id + .5) * CELL + (vec2(hash12(id + 3.1), hash12(id + 7.7)) - .5) * CELL * .45;
    float dp = abs(c.x - pathX(c.y));
    // meadows near the road are sparse, the valley walls are forest
    float keep = mix(.86, .2, smoothstep(14., 40., dp));
    if (r < keep || dp < 4.5 + r * 3.) continue;
    if (length(c - uCastle.xz) < 55.) continue;
    float kind = hash12(id + 21.7);
    float H = 7. + r * 8.;
    vec3 q = p - vec3(c.x, th, c.y);
    float k0 = clamp(q.y / H, 0., 1.);
    q.x += (sin(uTime * .9 + r * 20.) * .5 + sin(uTime * 2.1 + r * 7.) * .15) * uWind * .5 * k0 * k0;
    float trunk = sdCyl(q, .2 + .12 * r, -1., H * (kind < .55 ? .4 : .55));
    float fol;
    if (kind < .55){
      float y = q.y - H * .16;
      float hh = H * .84;
      float k = clamp(y / hh, 0., 1.);
      float tiers = 1. - .38 * fract(k * (3. + floor(r * 3.)) + r);
      float rad = (1.9 + r * .9) * (1. - k) * tiers;
      fol = max((length(q.xz) - rad) * .55, max(-y, y - hh));
    } else {
      float R = 2.4 + r * 1.4;
      vec3 cc = q - vec3(0., H * .62, 0.);
      float bump = .45 * sin(cc.x * 2.1 + r * 10.) * sin(cc.y * 2.3 + r * 4.) * sin(cc.z * 1.9);
      fol = (length(cc * vec3(1., 1.2, 1.)) - R + bump) * .6;
      fol = min(fol, (length(cc - vec3(R * .6, -R * .35, .3)) - R * .65 + bump) * .6);
    }
    if (trunk < best){ best = trunk; mat = 3.; }
    if (fol < best){ best = fol; mat = kind < .55 ? 4. : 8.; }
  }
  return vec2(best, mat);
}

vec2 houses(vec3 p, float th){
  vec2 id = floor(p.xz / HCELL);
  vec2 f = p.xz - (id + .5) * HCELL;
  float bound = HCELL * .5 - max(abs(f.x), abs(f.y)) + .5;
  float r = hash12(id * 2.1 + 5.);
  vec2 c = (id + .5) * HCELL + (vec2(hash12(id + 1.3), hash12(id + 8.1)) - .5) * HCELL * .35;
  float dp = abs(c.x - pathX(c.y));
  if (r < .5 || dp < 9. || dp > 60. || c.y < -150. || c.y > 60.) return vec2(bound, 0.);
  vec3 q = p - vec3(c.x, th, c.y);
  float a = r * 6.283;
  q.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * q.xz;
  float s = .8 + r * .5;
  q /= s;
  float body = sdBox(q - vec3(0., 1.1, 0.), vec3(2.6, 1.6, 1.8));
  vec3 q2 = q - vec3(0., 2.6, 0.);
  float roof = max(dot(vec2(abs(q2.z), q2.y), vec2(.7071)) - 1.45, max(-q2.y - .1, abs(q2.x) - 2.9));
  float chim = sdBox(q - vec3(1.6, 3.6, .6), vec3(.3, .8, .3));
  vec2 res = vec2(body * s, 6.);
  if (roof * s < res.x) res = vec2(roof * s, 7.);
  if (chim * s < res.x) res = vec2(chim * s, 6.);
  res.x = min(res.x, bound);
  return res;
}

vec2 map(vec3 p){
  float th = terrain(p.xz);
  vec2 res = vec2((p.y - th) * .5, 1.);
  float above = p.y - th;
  if (above < 16. && uSdfProps > .5){
    vec2 tr = trees(p, th);
    if (tr.x < res.x) res = tr;
  }
  if (above < 8. && uSdfProps > .5){
    vec2 hs = houses(p, th);
    if (hs.x < res.x) res = hs;
  }
  if (uSdfCastle > .5){
    float c = castle(p - uCastle);
    if (c < res.x) res = vec2(c, 5.);
  }
  return res;
}

vec3 calcNormal(vec3 p, float t){
  float e = .002 * t + .01;
  vec2 k = vec2(1, -1);
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x +
                   k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1., t = .25;
  for (int i = 0; i < 28; i++){
    float h = map(ro + rd * t).x;
    res = min(res, 7. * h / t);
    t += clamp(h, .25, 5.);
    if (res < .02 || t > 70.) break;
  }
  return clamp(res, 0., 1.);
}

vec2 voronoi(vec2 x){
  vec2 n = floor(x), f = fract(x);
  float m1 = 8., m2 = 8.;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = vec2(i, j);
    vec2 o = vec2(hash12(n + g), hash12(n + g + 19.7));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < m1){ m2 = m1; m1 = d; } else if (d < m2) m2 = d;
  }
  return vec2(sqrt(m1), sqrt(m2));
}

float windows(vec3 q, vec3 n){
  if (abs(n.y) > .45 || q.y < 2. || q.y > 44.) return 0.;
  float u = abs(n.x) > abs(n.z) ? q.z : q.x;
  vec2 g = vec2(u / 3., q.y / 4.5);
  vec2 id = floor(g), f = fract(g);
  float inside = step(.3, f.x) * step(f.x, .7) * step(.2, f.y) * step(f.y, .8);
  float lit = step(.72, hash12(id + sign(n.xz) * 13.));
  float flick = .75 + .25 * sin(uTime * (2. + hash12(id) * 3.) + id.x * 4.);
  return inside * (.35 + lit * flick);
}

// ---------- sky ----------
float cloudDensity(vec2 uv){
  float d = fbm4(uv);
  d += .5 * (fbm2(uv * 3.1 + 7.) - .45);
  return d;
}
vec3 sky(vec3 rd){
  float y = max(rd.y, 0.);
  vec3 col = mix(uHorizon, uSkyTop, pow(y, .55));
  float sd = max(dot(rd, uSunDir), 0.);
  col += uSunColor * (pow(sd, 6.) * .18 + pow(sd, 60.) * .35);
  if (sd > .9993) col = mix(col, vec3(1., .98, .92) * 1.6, .9);

  if (rd.y > 0.){
    vec2 uv = rd.xz / (rd.y + .14) * .9 + vec2(uTime * .006 * (.3 + uWind), uTime * .002);
    float d0 = cloudDensity(uv);
    float d1 = cloudDensity(uv + uSunDir.xz * .12);
    float th = mix(.7, .38, uCloudCover);
    float cov = smoothstep(th, th + mix(.16, .025, uCel), d0);
    float lit = clamp(.55 + (d0 - d1) * 3.5 + rd.y * .4, 0., 1.);
    float litq = mix(lit, floor(lit * 3.99) / 3., uCel);
    vec3 cc = mix(uCloudShade, uCloudLit, litq);
    cc = mix(cc, uCloudHi, step(.9, lit) * uCel);
    cc += uSunColor * pow(sd, 4.) * .25 * (1. - cov * .5);
    col = mix(col, cc, cov * smoothstep(0., .06, rd.y));
  }
  // far, faint ridge layer behind the real mountains
  float az = atan(rd.x, -rd.z);
  float m = .03 + .05 * fbm4(vec2(az * 2.2, 3.1));
  if (rd.y < m) col = mix(col, mix(uHaze, uHorizon, .5), .7);
  if (rd.y < 0.) col = uHaze;
  if (uPainted > 0.){
    // panorama spans 120 degrees of azimuth, mirrored beyond that
    float u = .5 + az / 2.0944;
    u = 1. - abs(1. - mod(u, 2.));
    float e = asin(clamp(rd.y, -1., 1.));
    float v = clamp((e + .07) / 1.178, 0., 1.);
    vec3 pc = texture(uSky, vec2(u, 1. - v)).rgb;
    col = mix(col, pc, uPainted);
  }
  return col;
}

// ---------- low mist ----------
vec4 mist(vec3 ro, vec3 rd, float tEnd, float jitter){
  float T = 1.;
  vec3 acc = vec3(0.);
  float tMax = min(tEnd, 80.);
  float dt = tMax / 10.;
  float t = dt * jitter;
  vec3 lc = uCloudLit * .9 + uSunColor * .15;
  for (int i = 0; i < 10; i++){
    vec3 p = ro + rd * t;
    float hgt = p.y - uGround;
    float base = exp(-max(hgt + 2., 0.) * .25);
    vec3 drift = vec3(uTime * (.35 * uWind + .08), 0., uTime * .05);
    float n = vnoise3(p * .07 + drift * .4) + .5 * vnoise3(p * .18 - drift * .6);
    float dens = max(n / 1.5 - .34, 0.) * base * uMist * .2;
    float a = 1. - exp(-dens * dt);
    acc += T * a * lc;
    T *= 1. - a;
    t += dt;
  }
  return vec4(acc, T);
}

vec3 torchScatter(vec3 ro, vec3 rd, float tEnd){
  vec3 q = ro - uTorchPos;
  float b = dot(rd, q);
  float h = sqrt(max(dot(q, q) - b * b, 1e-4));
  float res = (atan((tEnd + b) / h) - atan(b / h)) / h;
  return uTorchColor * uTorch * uTorchWorld * min(res, 6.) * .004;
}

float bayer4(vec2 p){
  ivec2 q = ivec2(mod(p, 4.));
  int i = q.y * 4 + q.x;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + .5) / 16.;
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2. - uRes) / uRes.y;
  vec3 rd = normalize(uCamFwd + (uv.x * uCamRight + uv.y * uCamUp) * uTanHalfFov);
  vec3 ro = uCamPos;

  float t = .05, mat = 0.;
  bool hit = false;
  const float TMAX = 900.;
  for (int i = 0; i < 240; i++){
    vec3 p = ro + rd * t;
    if (p.y > 280. && rd.y > 0.) break;
    vec2 h = map(p);
    if (h.x < .0015 * t + .002){ hit = true; mat = h.y; break; }
    t += h.x * (1. + t * .0015);
    if (t > TMAX) break;
  }

  vec3 skyc = sky(rd);
  vec3 col;
  float tEnd = hit ? t : TMAX;

  if (hit){
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, t);
    vec3 alb;
    float emis = 0., wrap = 0., spec = 0.;
    float tn = mix(1., .3, uCel); // cel look: cleaner flat surfaces
    if (mat < 1.5){
      float d = abs(p.x - pathX(p.z));
      float gn = vnoise(p.xz * .25);
      float gn2 = vnoise(p.xz * 1.3 + 4.);
      alb = mix(vec3(.16, .30, .12), vec3(.30, .44, .16), gn);
      alb = mix(alb, vec3(.42, .46, .18), smoothstep(.6, .85, vnoise(p.xz * .08 + 2.)) * .6);
      alb *= .85 + .3 * gn2 * tn;
      float w = sin(uTime * 1.4 + p.x * .3 + p.z * .22) * uWind;
      float blade = step(.6, vnoise(p.xz * vec2(6., 3.5) + vec2(w * .9, 0.)));
      alb = mix(alb, alb * 1.35 + vec3(.03, .04, 0.), blade * .6);
      float fh = hash12(floor(p.xz * 2.5));
      float flower = step(.975, fh) * step(3.5, d) * step(.5, vnoise(p.xz * .3 + 9.));
      alb = mix(alb, fh > .99 ? vec3(.9, .85, .7) : vec3(.85, .38, .16), flower);
      float rock = smoothstep(.8, .62, n.y);
      vec3 rockc = mix(vec3(.30, .28, .36), vec3(.48, .45, .52), mix(.5, vnoise(p.xz * .9 + p.y * .7), tn));
      rockc *= .8 + .4 * vnoise(vec2(p.x + p.z, p.y) * 2.5) * tn;
      rockc = mix(rockc, vec3(.36, .32, .62), uCel * .7);
      alb = mix(alb, rockc, rock);
      float snow = smoothstep(150., 200., p.y + vnoise(p.xz * .05) * 30.) * smoothstep(.5, .8, n.y);
      alb = mix(alb, vec3(.85, .86, .92), snow);
      float pw = 1.5 + .8 * vnoise(p.xz * .6);
      if (d < pw + 1.){
        vec2 v = voronoi(p.xz * 1.5);
        float edge = v.y - v.x;
        vec3 stone = mix(vec3(.66, .58, .46), vec3(.84, .76, .62), vnoise(p.xz * 4.));
        vec3 dirt = vec3(.38, .30, .22);
        vec3 pc = mix(dirt, stone, smoothstep(.06, .16, edge) * smoothstep(pw + .2, pw - .6, d));
        alb = mix(alb, pc, 1. - smoothstep(pw, pw + 1., d));
      }
    } else if (mat < 3.5){
      alb = vec3(.22, .16, .12) * (.7 + .5 * vnoise(vec2(p.y * 6., atan(p.x, p.z) * 3.)));
    } else if (mat < 4.5){
      alb = mix(vec3(.07, .15, .10), vec3(.16, .28, .16), clamp(n.y * .5 + .5, 0., 1.));
      alb *= .75 + .5 * vnoise(p.xz * 2.5 + p.y * 2.) * tn;
      wrap = .4;
    } else if (mat < 5.5){
      vec3 q = (p - uCastle) / CSCALE;
      alb = vec3(.30, .29, .38) * (.75 + .4 * vnoise(vec2(q.x + q.z, q.y) * 1.4));
      float course = step(.88, fract(q.y * 1.1));
      alb *= 1. - course * .25;
      if (q.y > 22. && n.y > .25) alb = vec3(.20, .21, .30);
      emis = windows(q, n) * uWindowGlow;
    } else if (mat < 6.5){
      float timber = step(.85, fract(p.y * 1.4)) + step(.9, fract((p.x + p.z) * .7));
      alb = mix(vec3(.80, .74, .62), vec3(.32, .22, .16), clamp(timber, 0., 1.) * .8);
    } else if (mat < 7.5){
      alb = vec3(.58, .24, .16) * (.75 + .4 * step(.5, fract(p.y * 4.)));
    } else {
      alb = mix(vec3(.14, .26, .12), vec3(.32, .46, .18), clamp(n.y * .5 + .5, 0., 1.));
      alb *= .75 + .5 * vnoise(p.xz * 3. + p.y * 3.) * tn;
      wrap = .5;
    }

    float ao = .4 + .6 * clamp(map(p + n * 1.2).x / 1.2, 0., 1.);
    float dif = max(dot(n, uSunDir) + wrap, 0.) / (1. + wrap);
    float sh = 1.;
    if (dif > .01 && t < 220.) sh = softShadow(p + n * .05, uSunDir);
    vec3 L = uTorchPos - p;
    float ld = length(L);
    L /= ld;
    float tAtt = uTorch * uTorchWorld / (1. + ld * ld * .1);

    float dsh = dif * sh;
    dsh = mix(dsh, smoothstep(.12, .2, dsh) * .55 + smoothstep(.5, .58, dsh) * .45, uCel);
    vec3 lig = uSunColor * dsh * 1.25;
    lig += uAmbient * (.55 + .45 * n.y) * ao * .85;
    lig += vec3(.25, .3, .12) * uSunColor * .12 * clamp(.5 - .5 * n.y, 0., 1.);
    lig += uTorchColor * tAtt * (max(dot(n, L), 0.) * .85 + .15) * 3.;
    col = alb * lig;
    // cel look: shadows go cool teal-violet instead of muddy brown
    col = mix(col, col * vec3(.7, .95, 1.45), (1. - dsh) * uCel * .7);

    // aerial perspective
    float fogAmt = 1. - exp(-t * uFog);
    vec3 hz = mix(uHaze, uHorizon, smoothstep(200., 800., t) * .5);
    hz += uSunColor * pow(max(dot(rd, uSunDir), 0.), 6.) * .3;
    col = mix(col, hz, fogAmt);
    // cloud band around the crag and the feet of the mountains
    float bandY = uCastle.y - 6.;
    float band = exp(-pow((p.y - bandY) / 12., 2.)) * smoothstep(80., 180., t) * uCloudBand;
    band *= .55 + .45 * vnoise(p.xz * .03 + vec2(uTime * .01, 0.));
    col = mix(col, uCloudLit * .95, clamp(band, 0., .85));
    col += vec3(1., .66, .32) * emis * (1. - fogAmt * .6);
  } else {
    col = skyc;
  }

  vec4 m = mist(ro, rd, tEnd, bayer4(gl_FragCoord.xy));
  col = col * m.a + m.rgb;
  col += torchScatter(ro, rd, tEnd);

  col = col / (1. + max(col - mix(.85, .95, uCel), 0.) * 1.4);
  fragColor = vec4(col, 1.);
  float dd = clamp(tEnd / 1000., 0., 1.);
  fragDepth = vec4(floor(dd * 255.) / 255., fract(dd * 255.), 0., 1.);
}
`

export const BILLBOARD_VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;   // quad corner, 0..1
layout(location = 1) in vec3 aBase;     // world position of the bottom centre
layout(location = 2) in vec2 aSize;     // width, height (m)
layout(location = 3) in vec4 aUV;       // atlas rect u0 v0 u1 v1 (v0 = top)
layout(location = 4) in vec2 aSway;     // amount, phase
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uTanHalfFov, uAspect, uTime, uWind;
out vec2 vUv;
out float vDepth;
out float vWorldY;
void main(){
  vec3 side = normalize(vec3(uCamRight.x, 0., uCamRight.z));
  float k = aCorner.y * aCorner.y;
  float sw = (sin(uTime * .9 + aSway.y) * .6 + sin(uTime * 2.1 + aSway.y * 1.7) * .2) * aSway.x * uWind * k;
  vec3 wp = aBase + side * ((aCorner.x - .5) * aSize.x + sw) + vec3(0., aCorner.y * aSize.y, 0.);
  vec3 d = wp - uCamPos;
  float x = dot(d, uCamRight), y = dot(d, uCamUp), z = dot(d, uCamFwd);
  vUv = vec2(mix(aUV.x, aUV.z, aCorner.x), mix(aUV.w, aUV.y, aCorner.y));
  vDepth = z;
  vWorldY = wp.y;
  const float n = .1, f = 3000.;
  gl_Position = vec4(x / (uTanHalfFov * uAspect), y / uTanHalfFov, z * (f + n) / (f - n) - 2. * f * n / (f - n), z);
}
`

export const BILLBOARD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in float vDepth;
in float vWorldY;
out vec4 fragColor;
uniform sampler2D uAtlas, uDepth;
uniform vec2 uRes;
uniform float uTanHalfFov, uFog, uCloudBand, uBandY;
uniform vec3 uTint, uHaze, uHorizon, uSunColor, uSunDir, uCloudLit, uCamFwd, uCamRight, uCamUp;
void main(){
  vec4 tx = texture(uAtlas, vUv);
  if (tx.a < .5) discard;
  vec2 uv = (gl_FragCoord.xy * 2. - uRes) / uRes.y;
  float t = vDepth * length(vec3(uv * uTanHalfFov, 1.));
  vec4 dt = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0);
  float sceneT = (dt.r + dt.g / 255.) * 1000.;
  if (t > sceneT + .4) discard;
  vec3 col = tx.rgb / tx.a * uTint;
  vec3 rd = normalize(uCamFwd + (uv.x * uCamRight + uv.y * uCamUp) * uTanHalfFov);
  float fogAmt = 1. - exp(-t * uFog);
  vec3 hz = mix(uHaze, uHorizon, smoothstep(200., 800., t) * .5);
  hz += uSunColor * pow(max(dot(rd, uSunDir), 0.), 6.) * .3;
  col = mix(col, hz, fogAmt);
  float band = exp(-pow((vWorldY - uBandY) / 12., 2.)) * smoothstep(80., 180., t) * uCloudBand;
  col = mix(col, uCloudLit * .95, clamp(band, 0., .85));
  fragColor = vec4(col, 1.);
}
`

export const SPRITE_VERT = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uRect;   // x, y, w, h in low-res pixels (GL origin bottom-left)
uniform vec2 uRes;
out vec2 vUv;
void main(){
  vUv = aPos * .5 + .5;
  vec2 px = uRect.xy + vUv * uRect.zw;
  gl_Position = vec4(px / uRes * 2. - 1., 0., 1.);
}
`

export const SPRITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uSize;        // sprite size in sprite pixels
uniform vec2 uFlame;       // flame centre in low-res pixels
uniform float uLightR, uTorch, uGlint, uTime;
uniform vec3 uTorchColor, uHandLight;
void main(){
  ivec2 tc = ivec2(clamp(floor(vec2(vUv.x, 1. - vUv.y) * uSize), vec2(0.), uSize - 1.));
  vec4 tx = texelFetch(uTex, tc, 0);
  if (tx.a < .05) discard;
  vec3 alb = tx.rgb;
  float d = distance(gl_FragCoord.xy, uFlame) / uLightR;
  float fl = uTorch / (1. + d * d * 1.6);
  vec3 col = alb * (uHandLight + uTorchColor * fl * .45);
  if (abs(tx.a - 200. / 255.) < .03){
    float g = sin(float(tc.y) * .06 - float(tc.x) * .03 + uGlint) * .5 + .5;
    col += uHandLight * pow(g, 18.) * .35;
  }
  if (abs(tx.a - 150. / 255.) < .03){
    col = alb * (.9 + .7 * uTorch * (.6 + .4 * sin(uTime * 9. + float(tc.x * 7 + tc.y * 3))));
  }
  fragColor = vec4(col, 1.);
}
`

export const FLAME_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uSize;
uniform float uTime, uWind, uTorch, uK;
${COMMON}
void main(){
  vec2 px = floor(vUv * uSize);
  vec2 uv = (px + .5) / uSize;
  float flick = .85 + .15 * uTorch;
  float fy = uv.y / (.7 * flick);
  float x = uv.x - .5;
  x -= (sin(uTime * 1.7) * .05 + uWind * .06) * fy * fy;
  x -= sin(uTime * 8. + fy * 7.) * .03 * fy;
  vec2 lp = px / uK;
  float n = vnoise(vec2(lp.x * .35, lp.y * .3 - uTime * 9.));
  float n2 = vnoise(vec2(lp.x * .7 + 9., lp.y * .5 - uTime * 13.));
  float w = .34 * pow(max(1. - fy, 0.), .65) * smoothstep(-.15, .12, fy);
  float heat = 1. - abs(x) / max(w, 1e-3);
  heat = heat * (1. - fy * .5) + (n - .5) * .6 + (n2 - .5) * .3 - fy * .12;

  vec3 col = vec3(0.);
  bool on = false;
  if (heat > -.02){
    on = true;
    if (heat > .62) col = vec3(1., .95, .77);
    else if (heat > .42) col = vec3(.96, .82, .48);
    else if (heat > .24) col = vec3(.91, .63, .25);
    else if (heat > .08) col = vec3(.79, .47, .18);
    else col = vec3(.60, .33, .16);
  }
  // embers drifting up
  for (int i = 0; i < 7; i++){
    float h = hash12(vec2(float(i) * 7.3, 1.9));
    float life = fract(uTime * (.3 + h * .35) + h * 7.);
    vec2 ep = vec2(.5 + (h - .5) * .5 + sin(uTime * 2. + h * 30.) * .1 * life + uWind * .1 * life,
                   .4 + life * .6) * uSize;
    if (all(equal(floor(ep), px)) && life < .92){
      on = true;
      col = life < .5 ? vec3(.96, .82, .48) : vec3(.79, .47, .18);
    }
  }
  if (!on) discard;
  fragColor = vec4(col * (1.05 + .25 * uTorch), 1.);
}
`

export const POST_FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform vec2 uLowRes, uOffset;
uniform float uScale, uDither, uFade;
uniform vec3 uPal[64];
uniform int uPalN, uUsePal;

float bayer4(ivec2 p){
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + .5) / 16.;
}
float cdist(vec3 a, vec3 b){
  vec3 d = a - b;
  return sqrt(dot(d * d, vec3(2., 4., 3.)));
}
void main(){
  ivec2 lp = ivec2(floor((gl_FragCoord.xy - uOffset) / uScale));
  lp = clamp(lp, ivec2(0), ivec2(uLowRes) - 1);
  vec3 c = texelFetch(uScene, lp, 0).rgb;
  vec2 uv = (vec2(lp) + .5) / uLowRes - .5;
  c *= 1. - dot(uv * vec2(.9, 1.2), uv * vec2(.9, 1.2)) * .9;
  c *= uFade;
  float b = bayer4(lp);
  vec3 o;
  if (uUsePal == 1){
    float d1 = 1e9, d2 = 1e9;
    vec3 c1 = vec3(0.), c2 = vec3(0.);
    for (int i = 0; i < 64; i++){
      if (i >= uPalN) break;
      float d = cdist(c, uPal[i]);
      if (d < d1){ d2 = d1; c2 = c1; d1 = d; c1 = uPal[i]; }
      else if (d < d2){ d2 = d; c2 = uPal[i]; }
    }
    float r = d1 / max(d1 + d2, 1e-5);
    o = b < r * uDither * 1.1 ? c2 : c1;
  } else {
    o = floor(c * 24. + mix(.5, b, uDither)) / 24.;
  }
  fragColor = vec4(o, 1.);
}
`
