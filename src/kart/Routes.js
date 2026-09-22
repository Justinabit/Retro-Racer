import * as THREE from "three";
export function buildShortcuts(track) {
  track.routes = [];
  for (const [start, end] of [
    [0.173, 0.245],
    [0.589, 0.662],
  ]) {
    const a = track.at(start).p,
      b = track.at(end).p;
    const route = {
      start,
      end,
      length: a.distanceTo(b),
      points: [],
      width: 3.8,
    };
    const dir = b.clone().sub(a).normalize(),
      n = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    route.dir = dir;
    route.n = n;
    for (let i = 0; i <= 40; i++) route.points.push(a.clone().lerp(b, i / 40));
    const positions = [],
      indices = [];
    route.points.forEach((p, i) => {
      for (const side of [-1, 1])
        positions.push(
          p.x + n.x * side * route.width,
          p.y + 0.07,
          p.z + n.z * side * route.width,
        );
      if (i < 40) {
        const k = i * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: track.data.id === "winter" ? 0xadd9e6 : 0xa7986a,
        side: THREE.DoubleSide,
        roughness: 0.85,
      }),
    );
    mesh.receiveShadow = true;
    track.group.add(mesh);
    for (let i = 1; i < 40; i += 3)
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.7, 0.16),
          new THREE.MeshStandardMaterial({ color: 0xf3bf54 }),
        );
        post.position.copy(route.points[i]).addScaledVector(n, side * 4);
        post.position.y += 0.35;
        track.group.add(post);
      }
    track.routes.push(route);
  }
}
export function routeAt(route, s, lane = 0) {
  const t = THREE.MathUtils.clamp(
    (s - route.start) / (route.end - route.start),
    0,
    1,
  );
  const p = route.points[0]
    .clone()
    .lerp(route.points.at(-1), t)
    .addScaledVector(route.n, lane);
  return {
    p,
    dir: route.dir,
    n: route.n,
    yaw: Math.atan2(route.dir.x, route.dir.z),
  };
}
export function nearestRoute(track, pos, main) {
  let result = main || null,
    best = main?.distance ?? Infinity;
  for (const route of track.routes || []) {
    const a = route.points[0],
      b = route.points.at(-1),
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = THREE.MathUtils.clamp(
      ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / (dx * dx + dz * dz),
      0,
      1,
    );
    const p = a.clone().lerp(b, t),
      distance = Math.hypot(pos.x - p.x, pos.z - p.z);
    // Only enter the branch when actually within its narrow driveable surface.
    if (distance < best && distance < route.width + 1.8) {
      best = distance;
      result = {
        s: route.start + t * (route.end - route.start),
        distance,
        lateral: (pos.x - p.x) * route.n.x + (pos.z - p.z) * route.n.z,
        p,
        t: route.dir,
        n: route.n,
        route,
        width: route.width,
      };
    }
  }
  return result;
}
