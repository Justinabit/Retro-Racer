import * as THREE from "three";
export function label(text, color = "#f4e8cc", bg = "#303b42") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = color;
  ctx.font = "bold 38px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 79);
  const map = new THREE.CanvasTexture(c);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(11, 2.75),
    new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }),
  );
}
export function createAdventureEnvironment(track) {
  const d = track.data,
    group = new THREE.Group();
  const sky = d.id === "sky",
    winter = d.id === "winter",
    jungle = d.id === "jungle",
    lava = d.id === "volcano",
    city = d.id === "metropolis";
  const box = new THREE.BoxGeometry(1, 1, 1),
    cone = new THREE.ConeGeometry(1, 1, 7),
    rock = new THREE.DodecahedronGeometry(1, 0),
    cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const batches = new Map(),
    animated = [];
  let seed = d.seed;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const add = (geo, color, p, scale, glow = 0) => {
    const key = geo.uuid + color + glow;
    if (!batches.has(key))
      batches.set(key, {
        geo,
        mat: new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: glow,
          roughness: 0.75,
        }),
        objects: [],
      });
    const o = new THREE.Object3D();
    o.position.copy(p);
    o.scale.set(...scale);
    o.updateMatrix();
    batches.get(key).objects.push(o.matrix);
  };
  const pos = (s, lane = 0, up = 0) => {
    const p = track.at(s, lane).p;
    p.y += up;
    return p;
  };
  if (!sky) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.MeshStandardMaterial({ color: d.ground, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -d.elevation - 8;
    ground.receiveShadow = true;
    group.add(ground);
    // A terrain bank follows both edges instead of leaving an elevated ribbon over empty space.
    for (let i = 0; i < 300; i++)
      for (const side of [-1, 1]) {
        const p = pos(i / 300, side * 19, -12);
        if (!track.nearest(p).route)
          add(city ? box : rock, d.ground, p, [18, 17, 18]);
      }
  }
  for (let i = 0; i < 210; i++) {
    const s = i / 210,
      side = i % 2 ? 1 : -1,
      lane = side * (25 + rnd() * 95),
      p = pos(s, lane, -2);
    if (track.nearest(p).distance < 22) continue;
    if (city) {
      const h = 18 + rnd() * 95,
        w = 12 + rnd() * 15,
        depth = 12 + rnd() * 12;
      add(
        box,
        [0x39465d, 0x43536a, 0x555278][i % 3],
        p.clone().add(new THREE.Vector3(0, h / 2, 0)),
        [w, h, depth],
      );
      for (let y = 8; y < h; y += 9)
        for (const side of [-1, 1]) {
          add(
            box,
            i % 2 ? 0x68c6d3 : 0xd18eb8,
            p.clone().add(new THREE.Vector3(0, y, side * (depth / 2 + 0.06))),
            [w * 0.8, 0.8, 0.1],
            1,
          );
          add(
            box,
            0x819dd9,
            p.clone().add(new THREE.Vector3(side * (w / 2 + 0.06), y, 0)),
            [0.1, 0.8, depth * 0.8],
            0.8,
          );
        }
      if (i % 8 === 0)
        add(
          box,
          0xefa980,
          p.clone().add(new THREE.Vector3(0, h + 2, 0)),
          [11, 3, 13],
          0.6,
        );
    } else if (jungle || winter) {
      add(cylinder, 0x685e4b, p, [1, 14, 1]);
      for (let k = 0; k < 3; k++)
        add(
          cone,
          winter
            ? k === 2
              ? 0xe8eeee
              : 0x64938c
            : [0x326b50, 0x477f55, 0x669858][k],
          p.clone().add(new THREE.Vector3(0, 7 + k * 4, 0)),
          [8 - k * 1.7, 13, 8 - k * 1.7],
        );
      if (i % 8 === 0)
        add(
          rock,
          winter ? 0xd7e1e4 : 0x77966d,
          p.clone().add(new THREE.Vector3(12, -2, 0)),
          [9, 6, 8],
        );
    } else if (sky) {
      add(
        cone,
        0x8b9c96,
        p.clone().add(new THREE.Vector3(0, -16, 0)),
        [18, -35, 18],
      );
      add(
        cylinder,
        0x8ab995,
        p.clone().add(new THREE.Vector3(0, 1, 0)),
        [18, 4, 18],
      );
      if (i % 4 === 0)
        add(
          rock,
          0xe4e9e2,
          p.clone().add(new THREE.Vector3(0, -45, 0)),
          [42, 7, 19],
        );
    } else {
      add(
        lava ? rock : cylinder,
        lava ? [0x4d4850, 0x6b5358][i % 2] : [0x996345, 0xbe8b61][i % 2],
        p,
        [8 + rnd() * 18, 14 + rnd() * 45, 10 + rnd() * 18],
      );
      if (!lava && i % 4 === 0) {
        add(
          cylinder,
          0x6b8860,
          p.clone().add(new THREE.Vector3(12, 2, 8)),
          [0.8, 9, 0.8],
        );
        add(
          box,
          0x6b8860,
          p.clone().add(new THREE.Vector3(13, 4, 8)),
          [4, 1, 1],
        );
      }
    }
  }
  // Distant landmarks give every destination a different silhouette.
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2,
      p = new THREE.Vector3(Math.sin(a) * 950, 20, Math.cos(a) * 950);
    add(
      cone,
      winter ? 0xd5e2e8 : lava ? 0x654653 : jungle ? 0x4f7969 : 0xb38f72,
      p,
      [100, 120 + rnd() * 180, 100],
    );
  }
  const waterColor = lava ? 0xff673e : winter ? 0xa7d8e0 : 0x6dc2c2;
  if (!city) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(sky ? 100 : 1700, sky ? 900 : 1300),
      new THREE.MeshStandardMaterial({
        color: waterColor,
        emissive: lava ? waterColor : 0,
        emissiveIntensity: lava ? 0.65 : 0,
        metalness: 0.25,
        roughness: 0.3,
        transparent: true,
        opacity: 0.85,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(sky ? 400 : 80, sky ? -65 : -d.elevation - 7, 0);
    group.add(water);
    water.userData.baseY = water.position.y;
    animated.push(water);
  }
  // Elevated viaduct, sky bridges, and checkpoint gantries.
  for (let i = 0; i < 100; i++) {
    const p = pos(i / 100, 0, -8);
    add(box, sky ? 0xb1b4a0 : 0x716c67, p, [20, 1.4, 5]);
    if (!sky) add(box, 0x746f6b, pos(i / 100, 0, -24), [3, 32, 3]);
  }
  for (let i = 0; i < 12; i++) {
    const loc = track.at(i / 12),
      sign = label(
        i === 0 ? "START / FINISH" : `CHECKPOINT ${String(i).padStart(2, "0")}`,
        d.accent,
      );
    sign.position.copy(loc.p);
    sign.position.y += 7;
    sign.rotation.y = loc.yaw + Math.PI;
    group.add(sign);
    for (const side of [-1, 1])
      add(box, 0x58636a, pos(i / 12, side * 10, 3.5), [0.5, 7, 0.5]);
  }
  for (const route of track.routes) {
    const sign = label("↗ SHORTCUT · NARROW", "#f2ca6a");
    const loc = track.at(route.start - 0.003, -7);
    sign.position.copy(loc.p);
    sign.position.y += 4.5;
    sign.scale.setScalar(0.65);
    sign.rotation.y = loc.yaw + Math.PI;
    group.add(sign);
  }
  if (!sky) {
    for (let i = 0; i < 14; i++) {
      const loc = track.at(0.46 + i * 0.0019),
        g = new THREE.Group();
      g.position.copy(loc.p);
      g.rotation.y = loc.yaw;
      const mat = new THREE.MeshStandardMaterial({
        color: jungle ? 0x828b69 : winter ? 0xd4e1df : 0x656375,
      });
      for (const x of [-11, 11]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 9), mat);
        m.position.set(x, 4, 0);
        g.add(m);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 2, 9), mat);
      roof.position.y = 9;
      g.add(roof);
      group.add(g);
    }
  }
  if (jungle)
    for (let k = 0; k < 5; k++)
      add(box, 0x8f9475, pos(0.55, -85, 5 + k * 7), [
        65 - k * 10,
        7,
        60 - k * 9,
      ]);
  if (lava) {
    add(cone, 0x513c48, new THREE.Vector3(110, 70, -30), [100, 180, 100]);
    add(cylinder, 0xff8053, new THREE.Vector3(110, 155, -30), [12, 2, 12], 1);
  }
  if (winter)
    for (let k = 0; k < 5; k++) {
      add(box, 0x967e72, pos(0.88, -45 - k * 20, 4), [14, 10, 14]);
      add(cone, 0xe9edef, pos(0.88, -45 - k * 20, 12), [13, 8, 13]);
    }
  if (city)
    for (let i = 0; i < 3; i++) {
      const sign = label(
        ["UPPER CITY", "NIGHT MARKET", "SKYWAY 09"][i],
        "#91d4e5",
        "#3f365b",
      );
      sign.position.copy(pos(0.1 + i * 0.25, 30, 18));
      sign.scale.setScalar(2);
      group.add(sign);
    }
  for (const { geo, mat, objects } of batches.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, objects.length);
    objects.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  }
  let snow;
  if (winter || lava) {
    const arr = new Float32Array(600 * 3);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = (rnd() - 0.5) * 1400;
      arr[i + 1] = rnd() * 100;
      arr[i + 2] = (rnd() - 0.5) * 1400;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    snow = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: winter ? 0xffffff : 0xffa46b,
        size: winter ? 0.6 : 0.8,
        transparent: true,
        opacity: 0.65,
      }),
    );
    group.add(snow);
  }
  return {
    group,
    night: d.night,
    update(time) {
      animated.forEach(
        (m) => (m.position.y = m.userData.baseY + Math.sin(time * 0.6) * 0.06),
      );
      if (snow) snow.position.y = -((time * 3) % 30);
    },
    dispose() {
      const geos = new Set(),
        mats = new Set();
      group.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) mats.add(o.material);
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
    },
  };
}
