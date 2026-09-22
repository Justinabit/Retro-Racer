import { createAdventureEnvironment } from "../kart/World.js";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
export function createEnvironment(track) {
  if (track.data.kart) return createAdventureEnvironment(track);
  const data = track.data,
    group = new THREE.Group(),
    staticGroup = new THREE.Group();
  group.add(staticGroup);
  let seed = data.seed;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const night = ["city", "circuit"].includes(data.id),
    forest = data.id === "forest",
    coast = data.id === "coast",
    desert = data.id === "desert";
  const mats = new Map();
  const mat = (c, glow = 0) => {
    const key = `${c}-${glow}`;
    if (!mats.has(key))
      mats.set(
        key,
        new THREE.MeshStandardMaterial({
          color: c,
          roughness: 0.83,
          emissive: c,
          emissiveIntensity: glow,
        }),
      );
    return mats.get(key);
  };
  const add = (geo, c, pos, scale = [1, 1, 1], rot = 0, glow = 0) => {
    const m = new THREE.Mesh(geo, mat(c, glow));
    m.position.set(...pos);
    m.scale.set(...scale);
    m.rotation.y = rot;
    m.castShadow = true;
    m.receiveShadow = true;
    staticGroup.add(m);
    return m;
  };
  const box = new THREE.BoxGeometry(1, 1, 1),
    cone = new THREE.ConeGeometry(1, 1, 6),
    rock = new THREE.DodecahedronGeometry(1, 0),
    cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  const terrainGeo = new THREE.PlaneGeometry(1800, 1800, 95, 95);
  terrainGeo.rotateX(-Math.PI / 2);
  const arr = terrainGeo.attributes.position;
  const color = [];
  const base = new THREE.Color(data.ground);
  for (let i = 0; i < arr.count; i++) {
    const x = arr.getX(i),
      z = arr.getZ(i);
    const nearest = track.nearest({ x, z });
    const d = nearest.distance;
    let y = nearest.p.y - 0.3;
    if (d > 20)
      y = THREE.MathUtils.lerp(
        y,
        -3 + Math.sin(x * 0.027) * Math.cos(z * 0.021) * 3,
        Math.min((d - 20) / 65, 1),
      );
    if (coast && x < -130 && d > 20) y -= Math.min((d - 20) * 0.7, 16);
    arr.setY(i, y);
    const c = base.clone().multiplyScalar(0.9 + rnd() * 0.16);
    color.push(c.r, c.g, c.b);
  }
  terrainGeo.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  terrain.receiveShadow = true;
  group.add(terrain);
  let water = null;
  if (coast || forest) {
    water = new THREE.Mesh(
      new THREE.PlaneGeometry(coast ? 2200 : 45, 2200),
      new THREE.MeshStandardMaterial({
        color: coast ? 0x4f9699 : 0x7bada4,
        roughness: 0.26,
        metalness: 0.35,
        transparent: true,
        opacity: 0.9,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(coast ? -970 : -30, -4.5, 0);
    group.add(water);
    if (coast) {
      for (let i = 0; i < 65; i++) {
        add(
          box,
          0xb9c8b6,
          [-260 - rnd() * 650, -4.4, -600 + rnd() * 1200],
          [5 + rnd() * 65, 0.03, 0.22],
          0,
        );
      }
    }
  }
  // Terrain silhouettes and distant mesas.
  for (let i = 0; i < 45; i++) {
    const angle = (i / 45) * Math.PI * 2,
      d = 390 + rnd() * 420;
    const x = 70 + Math.sin(angle) * d,
      z = Math.cos(angle) * d;
    if (coast && x < -200) continue;
    const h = 30 + rnd() * (desert ? 125 : 100);
    add(
      desert ? cylinder : cone,
      desert
        ? [0xa96b4c, 0xb87d55, 0xc69065][i % 3]
        : forest
          ? 0x71836a
          : 0xa49b7a,
      [x, h * 0.34 - 15, z],
      [50 + rnd() * 90, h, 50 + rnd() * 80],
      rnd() * 6,
    );
    if (desert)
      add(
        cylinder,
        0xd3a075,
        [x, h * 0.78 - 15, z],
        [34 + rnd() * 20, h * 0.18, 36 + rnd() * 20],
        rnd() * 6,
      );
  }
  function palm(x, y, z, size = 1) {
    const root = new THREE.Vector3(x, y, z);
    for (let j = 0; j < 5; j++) {
      const seg = add(
        cylinder,
        j % 2 ? 0x85785a : 0x988260,
        [x + j * 0.13 * size, y + (j + 0.5) * 1.9 * size, z],
        [0.22 * size, 1.95 * size, 0.22 * size],
      );
      seg.rotation.z = -0.07;
    }
    const top = y + 9.5 * size;
    for (let a = 0; a < 7; a++) {
      const points = [],
        indices = [];
      for (let j = 0; j < 5; j++) {
        const t = j / 4,
          ang = (a / 7) * Math.PI * 2;
        const len = t * 5.1 * size,
          yy = top + Math.sin(t * Math.PI) * 1.3 * size - t * 1.3 * size,
          w = Math.sin(t * Math.PI) * 0.65 * size;
        points.push(
          x + 0.6 * size + Math.sin(ang) * len + Math.cos(ang) * w,
          yy,
          z + Math.cos(ang) * len - Math.sin(ang) * w,
          x + 0.6 * size + Math.sin(ang) * len - Math.cos(ang) * w,
          yy,
          z + Math.cos(ang) * len + Math.sin(ang) * w,
        );
        if (j < 4) {
          const k = j * 2;
          indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat(a % 2 ? 0x63745a : 0x83926a));
      m.material.side = THREE.DoubleSide;
      staticGroup.add(m);
    }
    return root;
  }
  if (coast) {
    for (const [s, lane, size] of [
      [0.829, -20, 1.05],
      [0.841, -19, 0.92],
      [0.866, -19, 1.3],
      [0.883, -21, 1.15],
      [0.892, 22, 1.4],
    ]) {
      const { p } = track.at(s, lane);
      palm(p.x, p.y - 0.5, p.z, size);
    }
    for (let i = 0; i < 7; i++) {
      add(
        rock,
        i % 2 ? 0x859a89 : 0x718d82,
        [-420 - i * 24, -2 + i * 2, -350 + i * 23],
        [50, 22 + i * 3, 60],
        i * 0.7,
      );
    }
  }
  function tree(x, y, z, s) {
    add(cylinder, 0x615747, [x, y + 2 * s, z], [0.4 * s, 4 * s, 0.4 * s]);
    for (let j = 0; j < 3; j++)
      add(
        cone,
        [0x405b44, 0x577052, 0x67835c][j],
        [x, y + (4 + j * 1.6) * s, z],
        [(3.2 - j * 0.7) * s, 5 * s, (3.2 - j * 0.7) * s],
        rnd() * 6,
      );
  }
  function sign(text, p, yaw, width = 9, color = "#eddfb6") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const c = canvas.getContext("2d");
    c.fillStyle = color;
    c.fillRect(0, 0, 512, 128);
    c.fillStyle = "#2d3934";
    c.font = "italic 900 61px Arial";
    c.textAlign = "center";
    c.fillText(text, 256, 84);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(canvas),
        roughness: 0.7,
        side: THREE.DoubleSide,
        emissive: night ? 0xffffff : 0,
        emissiveIntensity: night ? 0.3 : 0,
      }),
    );
    mesh.position.copy(p);
    mesh.rotation.y = yaw;
    group.add(mesh);
    return mesh;
  }
  // Roadside props are placed from the road normal, never arbitrarily on the racing line.
  const count = forest ? 220 : coast ? 100 : 90;
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const { p, yaw } = track.at(
      rnd(),
      side * (18 + rnd() * (forest ? 95 : 45)),
    );
    const near = track.nearest(p);
    if (near.distance < 15) continue;
    let y = near.p.y - 0.5;
    const { x, z } = p;
    if (coast) {
      if (x < -140 && near.distance > 35) continue;
      palm(x, y, z, 0.7 + rnd() * 0.8);
      if (i % 5 === 0)
        add(rock, 0xaaa184, [x + 5, y + 0.7, z + 3], [2.5, 2, 3], rnd() * 6);
    } else if (forest) tree(x, y, z, 0.8 + rnd() * 1.5);
    else if (desert) {
      if (i % 3 === 0) {
        add(cylinder, 0x6a7653, [x, y + 2, z], [0.5, 5, 0.5]);
        add(box, 0x6a7653, [x + 1, y + 2.6, z], [2, 0.5, 0.5]);
        add(cylinder, 0x6a7653, [x + 1.7, y + 3.4, z], [0.3, 1.7, 0.3]);
      } else
        add(
          rock,
          [0xb78058, 0xa37050, 0xcf9c6e][i % 3],
          [x, y + 2, z],
          [2 + rnd() * 5, 3 + rnd() * 8, 2 + rnd() * 4],
          rnd() * 6,
        );
    } else if (data.id === "city") {
      const h = 15 + rnd() * 65,
        w = 8 + rnd() * 13;
      add(
        box,
        [0x35434f, 0x3b4955, 0x273643][i % 3],
        [x, y + h / 2, z],
        [w, h, w],
        yaw,
      );
      for (let j = 3; j < h; j += 5) {
        add(
          box,
          i % 2 ? 0x5eadc1 : 0xc76caa,
          [x, y + j, z + w / 2 + 0.02],
          [w * 0.8, 0.6, 0.06],
          0,
          0.9,
        );
      }
      if (i % 5 === 0) {
        const p2 = new THREE.Vector3(x, y + 9, z + w / 2 + 0.1);
        sign(
          ["ARCADE", "夜 • DRIVE", "RETRO", "MIDNIGHT"][i % 4],
          p2,
          0,
          7,
          i % 2 ? "#bc82bd" : "#72bfc4",
        );
      }
    } else {
      add(box, 0x727b76, [x, y + 2, z], [16, 4, 9], yaw);
      add(box, 0xbba998, [x, y + 4.4, z], [16, 0.4, 10], yaw);
      for (let j = 0; j < 3; j++)
        add(
          box,
          [0xc59765, 0x758f86, 0xadb3a0][j],
          [x, y + 2 + j * 0.75, z + j * 1.5],
          [15, 0.35, 1.8],
          yaw,
        );
    }
  }
  for (let i = 0; i < 28; i++) {
    const { p, yaw } = track.at(i / 28, 14.6);
    add(
      cylinder,
      night ? 0x55616b : 0x797e70,
      [p.x, p.y + 5, p.z],
      [0.13, 10, 0.13],
    );
    add(box, 0x87918a, [p.x, p.y + 10, p.z], [4, 0.15, 0.22], yaw);
    add(
      box,
      night ? 0xffd89b : 0xe4dbc1,
      [p.x - 1.7 * Math.cos(yaw), p.y + 9.8, p.z + 1.7 * Math.sin(yaw)],
      [1, 0.15, 0.7],
      yaw,
      night ? 2 : 0,
    );
    if (night && i % 4 === 0) {
      const l = new THREE.PointLight(0xffd9a0, 55, 32, 1.7);
      l.position.set(p.x, p.y + 8, p.z);
      group.add(l);
    }
    if (i % 4 === 1) {
      const v = track.at((i + 0.2) / 28, -14);
      sign(
        "› › ›",
        v.p.clone().add(new THREE.Vector3(0, 2.1, 0)),
        v.yaw + Math.PI,
        5,
        "#ebbb59",
      );
      add(box, 0x686c58, [v.p.x, v.p.y + 1, v.p.z], [0.16, 2, 0.16]);
    }
  }
  // Start gantry, trackside architecture, and bridge supports.
  const start = track.at(0.002);
  const gate = new THREE.Group();
  gate.position.copy(start.p);
  gate.rotation.y = start.yaw;
  group.add(gate);
  for (const x of [-10.4, 10.4]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 10, 0.45),
      mat(0x5c695e),
    );
    m.position.set(x, 5, 0);
    gate.add(m);
  }
  const banner = sign(
    "PIXEL RACER",
    start.p.clone().add(new THREE.Vector3(0, 10, 0)),
    start.yaw + Math.PI,
    21,
    "#e9d6ae",
  );
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(21, 2.8, 0.28),
    mat(0x3f5147),
  );
  backing.position.set(0, 10, 0.2);
  gate.add(backing);
  for (let i = 0; i < 18; i++) {
    const { p } = track.at(i / 18);
    if (p.y > 1) {
      add(box, 0x9b9787, [p.x, p.y - 6, p.z], [8, 12, 2]);
    }
  }
  // A real tunnel through a short section of the lap.
  if (coast || data.id === "city") {
    for (let i = 0; i < 9; i++) {
      const { p, yaw } = track.at(0.56 + i * 0.003);
      add(
        box,
        coast ? 0x898575 : 0x424d5b,
        [p.x, p.y + 6, p.z],
        [24, 1.5, 5],
        yaw,
      );
      for (const side of [-1, 1]) {
        const v = track.at(0.56 + i * 0.003, side * 11);
        add(
          box,
          coast ? 0x959181 : 0x424d5b,
          [v.p.x, v.p.y + 2.5, v.p.z],
          [1.4, 6, 5],
          yaw,
        );
      }
    }
  }
  if (coast || desert) {
    const { p, yaw } = track.at(0.15, 30);
    add(
      box,
      coast ? 0xe0c8a2 : 0xd9ba89,
      [p.x, p.y + 3, p.z],
      [20, 6, 12],
      yaw,
    );
    add(box, 0x866752, [p.x, p.y + 6.2, p.z], [23, 0.55, 15], yaw);
    sign(
      coast ? "SURF • 86" : "GAS & GO",
      p.clone().add(new THREE.Vector3(0, 5, 6.1)),
      0,
      13,
    );
    for (let j = 0; j < 4; j++)
      add(
        box,
        0x526d6b,
        [p.x - 7 + j * 4.5, p.y + 2.6, p.z + 6.05],
        [2.6, 2.5, 0.1],
        0,
      );
  }
  // Distant sun and softly layered cloud banks.
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(coast ? 48 : forest ? 24 : 18, 32, 16),
    new THREE.MeshBasicMaterial({
      color: night ? 0xe4e4cb : 0xf6cf95,
      fog: false,
    }),
  );
  sun.position.set(coast ? -450 : -290, night ? 220 : 55, coast ? -420 : -570);
  group.add(sun);
  for (let i = 0; i < 12 && !night; i++) {
    add(
      rock,
      coast ? 0xead6b8 : 0xe3ddd0,
      [-600 + rnd() * 1200, 170 + rnd() * 70, -500 + rnd() * 1000],
      [45 + rnd() * 65, 3 + rnd() * 5, 12 + rnd() * 15],
      rnd() * 6,
    );
  }
  // Merge static geometry by material to keep roadside detail inexpensive.
  staticGroup.updateMatrixWorld(true);
  const batches = new Map();
  staticGroup.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geo.index) {
      const indexed = geo;
      geo = geo.toNonIndexed();
      indexed.dispose();
    }
    geo.deleteAttribute("uv");
    const key = o.material.uuid;
    if (!batches.has(key)) batches.set(key, { mat: o.material, geos: [] });
    batches.get(key).geos.push(geo);
  });
  for (const { mat: material, geos } of batches.values()) {
    const geo = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  const oldGeometry = new Set();
  staticGroup.traverse((o) => {
    if (o.isMesh) oldGeometry.add(o.geometry);
  });
  oldGeometry.forEach((g) => g.dispose());
  group.remove(staticGroup);
  return {
    group,
    water,
    night,
    update(t) {
      if (water)
        water.material.color.setHSL(
          coast ? 0.49 : 0.43,
          0.29,
          0.42 + Math.sin(t * 0.3) * 0.012,
        );
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
