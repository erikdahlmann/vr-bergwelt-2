// Gelände, Himmel, Fluss und Fernberge für das Bergszenario.
import * as THREE from 'three';
import {
  texture, uv, attribute, vec2, vec3, vec4, float, mix, clamp,
  triplanarTexture
} from 'three/tsl';
import { kornTextur, normalAus, wasserNormal, himmelTextur, textur,
         wieseTextur, felsTextur, kiesTextur, makroTextur } from './texturen.js';

export const AREAL = 200;            // Kantenlänge in Metern
export const SPIELRADIUS = 94;       // begehbarer Radius
const SEITE = AREAL;

/* ---------- Rauschen (deterministisch, kein Zufall beim Laden) ---------- */
function hash2(i, j) {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177 | 0;
  return ((n ^ (n >> 16)) & 0x7fffffff) / 0x7fffffff;
}
export function rauschen(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
export function fbm(x, y, oktaven = 4) {
  let s = 0, amp = 0.5, frq = 1, norm = 0;
  for (let o = 0; o < oktaven; o++) { s += amp * rauschen(x * frq, y * frq); norm += amp; frq *= 2; amp *= 0.5; }
  return s / norm;
}
function glatt(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/* ---------- Fluss ---------- */
export function flussX(z) { return 18 * Math.sin(z * 0.028) + 6 * Math.sin(z * 0.071 + 1.3); }
export function bettY(z) { return 4.4 - (z + 100) * 0.03; }
export function wasserY(z) { return bettY(z) + 0.38; }
export function flussAbstand(x, z) { return Math.abs(x - flussX(z)); }

/* ---------- Höhe ---------- */
export function hoeheBei(x, z) {
  const r = Math.hypot(x, z);
  const huegel = fbm(x * 0.012 + 11, z * 0.012 + 7, 4) * 9.5
               + fbm(x * 0.05 + 3, z * 0.05 + 21, 3) * 2.4
               + fbm(x * 0.16 + 31, z * 0.16 + 5, 2) * 0.7;
  const rand = glatt(52, 102, r) * 27 * (0.75 + 0.5 * fbm(x * 0.02 + 51, z * 0.02 + 61, 2));
  let h = huegel + rand;
  // Felsstruktur: oben und an den Wänden rau
  const rau = Math.max(glatt(5, 17, huegel + rand * 0.7), glatt(42, 92, r));
  // Nur Wellen, die das Netz auch auflösen kann (ein Dreieck ist etwa 0,9 m breit).
  // Feineres Rauschen würde als Facettenmuster auffallen; das macht die Normalenkarte.
  h += (fbm(x * 0.13 + 77, z * 0.13 + 13, 2) - 0.5) * (0.6 + 4.2 * rau);
  h += (fbm(x * 0.3 + 5, z * 0.3 + 41, 2) - 0.5) * (0.18 + 1.1 * rau);
  // Flussrinne einschneiden
  const d = flussAbstand(x, z);
  const rinne = 1 - glatt(4.5, 16, d);
  const bett = bettY(z) - 0.9;
  h = h * (1 - rinne) + bett * rinne;
  return h;
}
export function neigungBei(x, z) {
  const e = 0.8;
  const hx = hoeheBei(x + e, z) - hoeheBei(x - e, z);
  const hz = hoeheBei(x, z + e) - hoeheBei(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}
export function imAreal(x, z) { return Math.hypot(x, z) < SPIELRADIUS; }

/* ---------- Tönung und Anteile je Punkt ----------
   Die Farbe kommt jetzt aus den Texturen. Die Vertexfarbe tönt nur noch. */
function bodenTon(x, z, h, neig, ziel) {
  const n = fbm(x * 0.09 + 71, z * 0.09 + 13, 3);
  const fein = (fbm(x * 0.9 + 5, z * 0.9 + 29, 2) - 0.5);
  // trockenere und saftigere Stellen
  const r = 0.92 + n * 0.22 + fein * 0.12;
  const gr = 0.94 + n * 0.16 + fein * 0.1;
  const b = 0.88 + n * 0.18 + fein * 0.12;
  ziel.setRGB(r, gr, b);
  return ziel;
}
export function anteile(x, z, h, neig) {
  const d = flussAbstand(x, z);
  const fels = Math.min(1, glatt(0.42, 0.9, neig) + glatt(13, 20, h) * 0.85);
  const kies = (1 - glatt(2.0, 8.0, d)) * 0.95;
  const schnee = glatt(23, 29, h + (fbm(x * 0.07 + 3, z * 0.07 + 8, 2) - 0.5) * 4);
  return { fels: Math.min(1, fels) * (1 - kies), kies, schnee };
}

/* ---------- Geländenetz ---------- */
export function erzeugeGelaende() {
  const seg = 220;
  const geo = new THREE.PlaneGeometry(SEITE, SEITE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const farben = new Float32Array(pos.count * 3);
  const aFels = new Float32Array(pos.count);
  const aKies = new Float32Array(pos.count);
  const aSchnee = new Float32Array(pos.count);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = hoeheBei(x, z);
    pos.setY(i, h);
    const neig = neigungBei(x, z);
    const an = anteile(x, z, h, neig);
    aFels[i] = an.fels; aKies[i] = an.kies; aSchnee[i] = an.schnee;
    bodenTon(x, z, h, neig, c);
    // Mulden und Rinnen leicht abdunkeln (wirkt wie Schattenlicht)
    const r1 = 1.6, r2 = 4.5;
    const umgebung = (
      hoeheBei(x + r1, z) + hoeheBei(x - r1, z) + hoeheBei(x, z + r1) + hoeheBei(x, z - r1) +
      hoeheBei(x + r2, z + r2) + hoeheBei(x - r2, z - r2) +
      hoeheBei(x + r2, z - r2) + hoeheBei(x - r2, z + r2)
    ) / 8;
    const mulde = Math.max(-1, Math.min(1, (h - umgebung) * 0.5));
    const licht = 0.93 + mulde * 0.17;
    farben[i * 3] = c.r * licht; farben[i * 3 + 1] = c.g * licht; farben[i * 3 + 2] = c.b * licht;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(farben, 3));
  geo.setAttribute('aFels', new THREE.BufferAttribute(aFels, 1));
  geo.setAttribute('aKies', new THREE.BufferAttribute(aKies, 1));
  geo.setAttribute('aSchnee', new THREE.BufferAttribute(aSchnee, 1));
  geo.computeVertexNormals();

  const wiese = textur(wieseTextur(512), 1, true);
  const fels = textur(felsTextur(512), 1, true);
  const kies = textur(kiesTextur(512), 1, true);
  const makro = textur(makroTextur(256), 1);
  const felsNormal = textur(normalAus(felsTextur(256), 2.2), 1);

  /* Zwei Maßstäbe mischen, der zweite gedreht – so fällt keine Kachel auf. */
  const zweiStufen = (karte, uvN, grob) => {
    const u2 = vec2(
      uvN.x.mul(0.62).sub(uvN.y.mul(0.78)),
      uvN.x.mul(0.78).add(uvN.y.mul(0.62))
    ).mul(grob).add(vec2(0.31, 0.57));
    return texture(karte, uvN).rgb.mul(0.58).add(texture(karte, u2).rgb.mul(0.42));
  };

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
  mat.normalMap = felsNormal;
  mat.normalMap.repeat.set(150, 150);
  mat.normalScale = new THREE.Vector2(0.6, 0.6);

  const aFelsN = clamp(attribute('aFels', 'float'), 0, 1);
  const aKiesN = clamp(attribute('aKies', 'float'), 0, 1);
  const aSchneeN = clamp(attribute('aSchnee', 'float'), 0, 1);
  const tonN = attribute('color', 'vec3');

  const grasFarbe = zweiStufen(wiese, uv().mul(72), 0.31);
  // Fels dreidimensional projiziert: an steilen Wänden zieht sich nichts mehr lang
  const felsFarbe = triplanarTexture(texture(fels), texture(fels), texture(fels), float(0.9)).rgb.mul(0.9);
  const kiesFarbe = zweiStufen(kies, uv().mul(151), 2.3);

  let farbe = mix(grasFarbe, felsFarbe, aFelsN);
  farbe = mix(farbe, kiesFarbe, aKiesN);
  farbe = mix(farbe, vec3(0.9, 0.93, 1.0).mul(felsFarbe.r.mul(0.45).add(0.72)), aSchneeN);

  // große weiche Flecken gegen Gleichförmigkeit
  const makroA = texture(makro, uv().mul(1.6)).r;
  const makroB = texture(makro, uv().mul(6.1).add(vec2(0.4, 0.13))).r;
  const fleck = makroA.mul(0.65).add(makroB.mul(0.35));
  farbe = farbe.mul(vec3(
    fleck.mul(0.46).add(0.80),
    fleck.mul(0.40).add(0.82),
    fleck.mul(0.44).add(0.78)
  ));

  mat.colorNode = vec4(farbe.mul(tonN), 1.0);

  const netz = new THREE.Mesh(geo, mat);
  netz.receiveShadow = true;
  netz.name = 'gelaende';
  return netz;
}

/* ---------- Wasser ---------- */
export function erzeugeFluss() {
  const schritte = 140, breite = 6.4;
  const geo = new THREE.PlaneGeometry(1, 1, 1, schritte);
  const pos = new Float32Array((schritte + 1) * 2 * 3);
  const uv = new Float32Array((schritte + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= schritte; i++) {
    const z = -100 + (200 * i) / schritte;
    const x = flussX(z);
    const dx = flussX(z + 0.5) - flussX(z - 0.5);
    const nx = 1 / Math.hypot(dx, 1), nz = -dx / Math.hypot(dx, 1);
    const y = wasserY(z);
    const b = breite * (0.75 + 0.35 * fbm(z * 0.08 + 3, 2, 2));
    for (let s = 0; s < 2; s++) {
      const sgn = s === 0 ? -1 : 1;
      const k = (i * 2 + s) * 3;
      pos[k] = x + nx * sgn * b * 0.5;
      pos[k + 1] = y;
      pos[k + 2] = z + nz * sgn * b * 0.5;
      uv[(i * 2 + s) * 2] = s;
      uv[(i * 2 + s) * 2 + 1] = i * 0.35;
    }
    if (i < schritte) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.deleteAttribute('normal');
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const wellen = textur(wasserNormal(256), 1);
  const mat = new THREE.MeshPhysicalNodeMaterial({
    color: 0x3f87a4, transparent: true, opacity: 0.85, roughness: 0.04,
    metalness: 0.2, side: THREE.DoubleSide,
    clearcoat: 1.0, clearcoatRoughness: 0.06, ior: 1.33,
    normalMap: wellen, normalScale: new THREE.Vector2(0.7, 0.7)
  });
  mat.userData.wellenKarte = wellen;
  const netz = new THREE.Mesh(geo, mat);
  netz.name = 'wasser';
  netz.userData.wellen = true;
  return netz;
}

/* ---------- Himmel ---------- */
export function erzeugeHimmel() {
  const tex = new THREE.CanvasTexture(himmelTextur(1024, 512));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  const kugel = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 32),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  kugel.name = 'himmel';
  return kugel;
}

/* ---------- Sonne am Himmel ---------- */
export function erzeugeSonne(richtung, sonnenLeinwand) {
  const tex = new THREE.CanvasTexture(sonnenLeinwand);
  tex.colorSpace = THREE.SRGBColorSpace;
  const scheibe = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, fog: false
    })
  );
  scheibe.position.copy(richtung).normalize().multiplyScalar(780);
  scheibe.renderOrder = -1;
  scheibe.name = 'sonne';
  return scheibe;
}

/* ---------- Fernberge ---------- */
export function erzeugeFernberge() {
  const seg = 180, ringR = 330, hoch = 150;
  const geo = new THREE.CylinderGeometry(ringR, ringR, hoch, seg, 1, true);
  geo.translate(0, hoch / 2 - 42, 0);
  const pos = geo.attributes.position;
  const farben = new Float32Array(pos.count * 3);
  const unten = new THREE.Color(0x6f839b), oben = new THREE.Color(0xdfe8f2);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const w = Math.atan2(z, x);
    const kamm = fbm(Math.cos(w) * 6 + 9, Math.sin(w) * 6 + 2, 4);
    const spitz = Math.pow(fbm(Math.cos(w) * 17 + 4, Math.sin(w) * 17 + 8, 3), 1.6);
    if (y > 20) {
      const neu = 8 + kamm * 86 + spitz * 46;
      pos.setY(i, neu);
      c.copy(unten).lerp(oben, glatt(55, 108, neu));
    } else {
      c.copy(unten).lerp(new THREE.Color(0x55657c), 0.5);
    }
    farben[i * 3] = c.r; farben[i * 3 + 1] = c.g; farben[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(farben, 3));
  geo.computeVertexNormals();
  const netz = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false
  }));
  netz.name = 'fernberge';
  return netz;
}
