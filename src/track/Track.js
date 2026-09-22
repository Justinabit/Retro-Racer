import { buildShortcuts, nearestRoute } from "../kart/Routes.js";
import * as THREE from "three";
export const mod = (v, n) => ((v % n) + n) % n;
export class Track {
  constructor(data) {
    this.data = data;
    this.width = 17;
    this.count = 720;
    this.curve = new THREE.CatmullRomCurve3(
      data.shape.map(
        ([x, z], i) =>
          new THREE.Vector3(x, Math.sin(i * 1.6) * data.elevation, z),
      ),
      true,
      "centripetal",
    );
    this.length = this.curve.getLength();
    this.points = [];
    this.tangents = [];
    this.normals = [];
    for (let i = 0; i < this.count; i++) {
      const p = this.curve.getPointAt(i / this.count),
        t = this.curve.getTangentAt(i / this.count).normalize();
      this.points.push(p);
      this.tangents.push(t);
      this.normals.push(new THREE.Vector3(t.z, 0, -t.x).normalize());
    }
    this.group = new THREE.Group();
    this.build();
    if (data.kart) buildShortcuts(this);
  }
  at(s, lane = 0) {
    const f = mod(s, 1) * this.count,
      i = Math.floor(f),
      j = (i + 1) % this.count,
      t = f - i;
    const p = this.points[i].clone().lerp(this.points[j], t),
      dir = this.tangents[i].clone().lerp(this.tangents[j], t).normalize(),
      n = new THREE.Vector3(dir.z, 0, -dir.x);
    p.addScaledVector(n, lane);
    return { p, dir, n, yaw: Math.atan2(dir.x, dir.z) };
  }
  nearest(pos) {
    let min = Infinity,
      index = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i],
        d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2;
      if (d < min) {
        min = d;
        index = i;
      }
    }
    const a = this.points[index],
      t = this.tangents[index],
      n = this.normals[index];
    const along = (pos.x - a.x) * t.x + (pos.z - a.z) * t.z;
    return nearestRoute(this, pos, {
      s: mod(index / this.count + along / this.length, 1),
      distance: Math.sqrt(min),
      lateral: (pos.x - a.x) * n.x + (pos.z - a.z) * n.z,
      p: a,
      t,
      n,
      index,
    });
  }
  strip(inner, outer, material, height = 0.025) {
    const positions = [],
      indices = [],
      uv = [];
    for (let i = 0; i <= this.count; i++) {
      const k = i % this.count,
        p = this.points[k],
        n = this.normals[k];
      uv.push(0, i / this.count, 1, i / this.count);
      positions.push(
        p.x + n.x * inner,
        p.y + height,
        p.z + n.z * inner,
        p.x + n.x * outer,
        p.y + height,
        p.z + n.z * outer,
      );
      if (i < this.count) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setIndex(indices);
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
  build() {
    const night = this.data.night || ["city", "circuit"].includes(this.data.id);
    const material = (c) =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: night ? 0.38 : 0.92,
        side: THREE.DoubleSide,
      });
    this.strip(
      -11,
      11,
      material(this.data.id === "forest" ? 0x877a5c : 0xbab093),
      -0.04,
    );
    const asphalt = material(this.data.road);
    const pixels = new Uint8Array(128 * 128 * 4);
    let seed = 42;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const grain = 220 + (seed % 35);
      pixels[i] = grain;
      pixels[i + 1] = grain;
      pixels[i + 2] = grain;
      pixels[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(pixels, 128, 128, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 100);
    texture.needsUpdate = true;
    asphalt.map = texture;
    this.strip(-8.5, 8.5, asphalt);
    this.strip(-8.3, -8.12, material(0xe9e2c9), 0.04);
    this.strip(8.12, 8.3, material(0xe9e2c9), 0.04);
    const dashGeo = new THREE.BoxGeometry(0.15, 0.025, 3.4),
      dashMat = material(0xe6dcc2);
    const dashes = new THREE.InstancedMesh(
      dashGeo,
      dashMat,
      Math.floor(this.length / 8),
    );
    const obj = new THREE.Object3D();
    for (let i = 0; i < dashes.count; i++) {
      const { p, yaw } = this.at(i / dashes.count);
      obj.position.copy(p);
      obj.position.y += 0.065;
      obj.rotation.set(0, yaw, 0);
      obj.updateMatrix();
      dashes.setMatrixAt(i, obj.matrix);
    }
    this.group.add(dashes);
    const curbCount = Math.floor(this.length / 2.5);
    const curbMats = [
      material(0xe9dec5),
      material(this.data.id === "city" ? 0xa14de0 : 0xd76442),
    ];
    for (let c = 0; c < 2; c++) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.65, 0.16, 2.55),
        curbMats[c],
        curbCount,
      );
      for (let i = 0; i < curbCount; i++) {
        const { p, yaw } = this.at(
          (Math.floor(i / 2) * 2 + c) / curbCount,
          i % 2 === 0 ? -8.85 : 8.85,
        );
        obj.position.copy(p);
        obj.position.y += 0.08;
        obj.rotation.set(0, yaw, 0);
        obj.updateMatrix();
        mesh.setMatrixAt(i, obj.matrix);
      }
      this.group.add(mesh);
    }
    // Alternating start/finish tiles, plus the actual starting grid.
    for (let x = -8; x < 8; x += 1)
      for (let z = 0; z < 2; z++) {
        const { p, yaw } = this.at(0.001 + z / this.length, x + 0.5);
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.035, 1),
          material((x + z) % 2 ? 0xeee7d6 : 0x303a36),
        );
        tile.position.copy(p);
        tile.position.y += 0.09;
        tile.rotation.y = yaw;
        this.group.add(tile);
      }
    for (let i = 0; i < 8; i++) {
      const { p, yaw } = this.at(
        0.013 + Math.floor(i / 2) * 0.006,
        i % 2 ? -3 : 3,
      );
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.035, 0.16),
        dashMat,
      );
      line.position.copy(p);
      line.position.y += 0.08;
      line.rotation.y = yaw;
      this.group.add(line);
    }
    // Visible rails prevent leaving the road without invisible walls.
    const rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.43, 5.1),
      material(night ? 0x738392 : 0xb0b4a0),
      Math.floor(this.length / 5) * 2,
    );
    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.17, 1, 0.17),
      material(0x596259),
      rails.count,
    );
    for (let i = 0; i < rails.count; i++) {
      const { p, yaw } = this.at(
        Math.floor(i / 2) / (rails.count / 2),
        i % 2 ? -12 : 12,
      );
      const s = Math.floor(i / 2) / (rails.count / 2);
      const opening =
        this.data.kart &&
        ((s > 0.166 && s < 0.251) ||
          (s > 0.582 && s < 0.668) ||
          this.openEdge(s));
      obj.scale.setScalar(opening ? 0 : 1);
      obj.position.copy(p);
      obj.position.y += 0.8;
      obj.rotation.set(0, yaw, 0);
      obj.updateMatrix();
      rails.setMatrixAt(i, obj.matrix);
      obj.position.y -= 0.35;
      obj.updateMatrix();
      posts.setMatrixAt(i, obj.matrix);
    }
    this.group.add(rails, posts);
  }
  openEdge(s) {
    return (
      this.data.openEdges && ((s > 0.4 && s < 0.48) || (s > 0.8 && s < 0.86))
    );
  }
  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
export class RaceProgress {
  constructor(s = 0) {
    this.lap = 0;
    this.checkpoint = 1;
    this.previous = s;
    this.total = 0;
    this.finished = false;
    this.wrongWay = false;
  }
  update(s, headingDot = 1) {
    let delta = s - this.previous;
    if (delta > 0.5) delta--;
    if (delta < -0.5) delta++;
    this.wrongWay = headingDot < -0.35;
    this.previous = s;
    if (Math.abs(delta) > 0.12 || this.finished) return false;
    const gate = this.checkpoint / 12;
    const distance = mod(s - gate, 1);
    if (delta > 0 && distance < 0.045) {
      this.checkpoint++;
      if (this.checkpoint === 13) {
        this.lap++;
        this.checkpoint = 1;
        this.finished = this.lap >= 3;
        this.total = this.lap;
        return true;
      }
    }
    this.total =
      this.lap +
      (this.checkpoint - 1) / 12 +
      Math.min(1 / 12, mod(s - (this.checkpoint - 1) / 12, 1));
    return false;
  }
}

/** Completed laps tie at the finish; earlier finish time must win that tie. */
export function rankRacers(racers) {
  return racers.slice().sort((a, b) => {
    const aDone = Number.isFinite(a.finishedAt),
      bDone = Number.isFinite(b.finishedAt);
    if (aDone && bDone) return a.finishedAt - b.finishedAt;
    if (aDone !== bDone) return aDone ? -1 : 1;
    return b.progress - a.progress;
  });
}
