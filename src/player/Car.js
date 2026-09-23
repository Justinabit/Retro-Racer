import { createCharacter } from "../kart/Character.js";
import { CHARACTERS } from "../kart/data.js";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const bodyGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.08);
export class Car {
  constructor(spec, paint, custom = {}, player = false) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.wheels = [];
    this.steering = [];
    this.player = player;
    const mat = (c) =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: 0.42,
        metalness: 0.18,
      });
    this.paint = mat(paint || spec.color);
    this.dark = mat("#242b2c");
    this.chrome = mat("#adb5af");
    this.glass = new THREE.MeshStandardMaterial({
      color: "#345e65",
      roughness: 0.22,
      metalness: 0.15,
    });
    this.wheelMat = mat(custom.wheels || "#c5c4b7");
    this.red = new THREE.MeshStandardMaterial({
      color: "#8f211b",
      emissive: "#ff2718",
      emissiveIntensity: 0.35,
    });
    this.white = new THREE.MeshStandardMaterial({
      color: "#fff1ca",
      emissive: "#ffe4a0",
      emissiveIntensity: 0.8,
    });
    const box = (x, y, z, sx, sy, sz, m, parent = this.body) => {
      const mesh = new THREE.Mesh(
        sx > 1.5 && sy > 0.13 && sz > 1 ? bodyGeo : boxGeo,
        m,
      );
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const long = spec.body === 2 ? 1.12 : spec.body === 3 ? 0.88 : 1;
    this.long = long;
    box(0, 0.68, 0, 2.12, 0.46, 4.6 * long, this.paint);
    box(0, 0.43, 0, 2.02, 0.2, 4.3 * long, this.dark);
    box(0, 0.91, 0.85, 2.04, 0.16, 2.7 * long, this.paint);
    box(0, 0.93, -1.66 * long, 2.08, 0.16, 1.04, this.paint);
    // A raked, six-sided glasshouse, built as real geometry.
    if (!spec.kart) {
      const v = [
        -1, 0.95, -1.35, 1, 0.95, -1.35, -0.83, 1.65, -0.85, 0.83, 1.65, -0.85,
        -0.8, 1.65, 0.45, 0.8, 1.65, 0.45, -1, 0.95, 1.23, 1, 0.95, 1.23,
      ];
      const idx = [
        0, 2, 3, 0, 3, 1, 2, 4, 5, 2, 5, 3, 4, 6, 7, 4, 7, 5, 0, 6, 4, 0, 4, 2,
        1, 3, 5, 1, 5, 7, 0, 1, 7, 0, 7, 6,
      ];
      for (let i = 0; i < v.length; i += 3) {
        if (spec.body === 1) {
          v[i] *= 1.02;
          v[i + 1] = 0.95 + (v[i + 1] - 0.95) * 0.65;
          v[i + 2] *= 1.08;
        }
        if (spec.body === 3) {
          v[i + 1] = 0.95 + (v[i + 1] - 0.95) * 1.3;
          v[i + 2] -= 0.2;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const cabin = new THREE.Mesh(g, this.glass);
      cabin.castShadow = true;
      this.body.add(cabin);
      box(
        0,
        spec.body === 1 ? 1.44 : spec.body === 3 ? 1.87 : 1.66,
        spec.body === 3 ? -0.4 : -0.2,
        1.7,
        0.085,
        1.38,
        this.paint,
      );
      box(-0.89, 1.28, -0.23, 0.075, 0.65, 0.1, this.paint).rotation.z = -0.13;
      box(0.89, 1.28, -0.23, 0.075, 0.65, 0.1, this.paint).rotation.z = 0.13;
    }
    // Window trim, mirrors, handles, bumpers, pop-up headlamps and exhaust.
    [-1, 1].forEach((side) => {
      box(side * 1.15, 1.08, 0.67, 0.3, 0.18, 0.35, this.paint);
      box(side * 1.13, 1.09, 0.48, 0.25, 0.13, 0.025, this.glass);
      box(side * 1.069, 0.84, -0.24, 0.018, 0.045, 0.24, this.chrome);
      box(side * 0.72, 0.79, 2.32 * long, 0.52, 0.22, 0.035, this.white);
      box(side * 0.74, 0.83, -2.32 * long, 0.52, 0.17, 0.04, this.red);
      box(side * 0.57, 0.4, -2.4 * long, 0.19, 0.17, 0.24, this.chrome);
      box(side * 0.7, 0.63, 2.335 * long, 0.12, 0.09, 0.025, mat("#f5ac4b"));
    });
    box(0, 0.52, 2.33 * long, 2.15, 0.16, 0.13, this.dark);
    box(0, 0.51, -2.33 * long, 2.15, 0.18, 0.13, this.dark);
    box(0, 0.77, 2.345 * long, 0.55, 0.15, 0.02, this.dark);
    box(0, 0.73, -2.35 * long, 0.45, 0.14, 0.02, mat("#eee2b8"));
    for (const z of [-1.42 * long, 1.45 * long])
      for (const x of [-1.07, 1.07]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, 0.43, z);
        this.body.add(pivot);
        if (z > 0) this.steering.push(pivot);
        const wheel = new THREE.Group();
        pivot.add(wheel);
        const tire = new THREE.Mesh(
          new THREE.CylinderGeometry(0.43, 0.43, 0.3, 12),
          this.dark,
        );
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        wheel.add(tire);
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.315, 8),
          this.wheelMat,
        );
        hub.rotation.z = Math.PI / 2;
        wheel.add(hub);
        for (let a = 0; a < 5; a++) {
          const spoke = box(0, 0, 0, 0.327, 0.055, 0.43, this.chrome, wheel);
          spoke.rotation.x = (a * Math.PI) / 5;
        }
        this.wheels.push(wheel);
        box(x, 0.88, z, 0.18, 0.08, 1.02, this.paint);
      }
    this.spoiler = new THREE.Group();
    this.body.add(this.spoiler);
    box(-0.71, 1.16, -1.94 * long, 0.09, 0.4, 0.14, this.dark, this.spoiler);
    box(0.71, 1.16, -1.94 * long, 0.09, 0.4, 0.14, this.dark, this.spoiler);
    box(0, 1.4, -1.98 * long, 2.23, 0.12, 0.47, this.paint, this.spoiler);
    this.spoiler.visible = custom.spoiler !== false;
    this.stripes = new THREE.Group();
    this.body.add(this.stripes);
    [-0.29, 0.29].forEach((x) => {
      box(x, 1.002, 1.47, 0.18, 0.01, 1.26, mat("#eee7d4"), this.stripes);
      box(
        x,
        spec.body === 1 ? 1.488 : spec.body === 3 ? 1.915 : 1.705,
        spec.body === 3 ? -0.4 : -0.2,
        0.16,
        0.012,
        1.36,
        mat("#eee7d4"),
        this.stripes,
      );
    });
    this.stripes.visible = custom.decal !== false;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ebe5d3";
    ctx.beginPath();
    ctx.arc(64, 64, 53, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#293631";
    ctx.font = "italic 800 70px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(custom.number || "86").slice(0, 2), 62, 87);
    const tex = new THREE.CanvasTexture(canvas);
    const numberMat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.6,
    });
    for (const side of [-1, 1]) {
      const badge = new THREE.Mesh(
        new THREE.PlaneGeometry(0.61, 0.61),
        numberMat,
      );
      badge.position.set(side * 1.067, 0.76, -0.28);
      badge.rotation.y = (side * Math.PI) / 2;
      this.body.add(badge);
    }
    // Merge each animated wheel's five spokes into one mesh.
    for (const wheel of this.wheels) {
      wheel.updateMatrixWorld(true);
      const spokes = wheel.children.filter((m) => m.material === this.chrome);
      const geos = spokes.map((m) => {
        m.updateMatrix();
        return m.geometry.clone().applyMatrix4(m.matrix);
      });
      const merged = new THREE.Mesh(mergeGeometries(geos), this.chrome);
      wheel.add(merged);
      spokes.forEach((m) => wheel.remove(m));
      geos.forEach((g) => g.dispose());
    }
    // Consolidate fixed bodywork and each wheel into material batches.
    this.body.updateMatrixWorld(true);
    const dynamic = new Set();
    this.wheels.forEach((w) => w.traverse((o) => dynamic.add(o)));
    this.steering.forEach((w) => dynamic.add(w));
    const meshes = [];
    this.body.traverse((o) => {
      if (o.isMesh && !dynamic.has(o)) {
        let visible = true;
        for (let p = o; p && p !== this.body; p = p.parent)
          visible = visible && p.visible;
        if (visible) meshes.push(o);
      }
    });
    const batches = new Map();
    for (const m of meshes) {
      const geom = m.geometry.clone().applyMatrix4(m.matrixWorld);
      geom.deleteAttribute("uv");
      if (m.material.map) {
        geom.dispose();
        continue;
      }
      const key = m.material.uuid;
      if (!batches.has(key))
        batches.set(key, { material: m.material, geos: [] });
      let final = geom;
      if (geom.index) {
        final = geom.toNonIndexed();
        geom.dispose();
      }
      batches.get(key).geos.push(final);
      m.removeFromParent();
      if (m.geometry !== boxGeo && m.geometry !== bodyGeo) m.geometry.dispose();
    }
    for (const { material, geos } of batches.values()) {
      const m = new THREE.Mesh(mergeGeometries(geos), material);
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
      geos.forEach((g) => g.dispose());
    }
    if (spec.kart) {
      const character =
        CHARACTERS.find((c) => c.id === spec.character) || CHARACTERS[0];
      this.driver = createCharacter(character, CHARACTERS.indexOf(character));
      this.driver.position.set(0, 0.88, -0.4);
      this.body.add(this.driver);
    }
    if (player) {
      this.headlights = new THREE.Group();
      this.group.add(this.headlights);
      for (const x of [-0.72, 0.72]) {
        const light = new THREE.SpotLight(0xffedc0, 28, 65, 0.38, 0.6, 1.3);
        light.position.set(x, 0.9, 2);
        light.target.position.set(x, 0.15, 30);
        this.headlights.add(light, light.target);
      }
    }
  }
  update(dt, speed, steer, brake, night = false) {
    this.wheels.forEach((w) => (w.rotation.x += (speed * dt) / 0.43));
    this.steering.forEach((p) => (p.rotation.y = steer * 0.42));
    this.red.emissiveIntensity = brake ? 3 : 0.4;
    this.white.emissiveIntensity = night ? 2.8 : 0.15;
    if (this.headlights) this.headlights.visible = night;
    this.body.rotation.z = THREE.MathUtils.lerp(
      this.body.rotation.z,
      -steer * Math.min(Math.abs(speed) / 65, 1) * 0.055,
      1 - Math.exp(-9.75 * dt),
    );
  }
  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry !== boxGeo && o.geometry !== bodyGeo)
          o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }
}
