import { CARS } from "../data.js";
import { CHARACTERS, combineStats } from "../kart/data.js";
export const STAT_FIELDS = [
  ["speed", "Top speed"],
  ["accel", "Acceleration"],
  ["handling", "Handling"],
  ["braking", "Braking"],
  ["drift", "Drift"],
  ["weight", "Weight"],
];
export function selectionStats(carId, characterId, mode = "classic") {
  const car = CARS.find((c) => c.id === carId) || CARS[0];
  const character =
    CHARACTERS.find((c) => c.id === characterId) || CHARACTERS[0];
  return {
    car,
    character,
    effective: mode === "kart" ? combineStats(car, character) : car,
  };
}
export function statRows(spec, previous) {
  return STAT_FIELDS.filter(([key]) => Number.isFinite(spec[key])).map(
    ([key, label]) => ({
      key,
      label,
      value: spec[key],
      percent: Math.max(0, Math.min(100, spec[key])),
      difference:
        previous && Number.isFinite(previous[key])
          ? spec[key] - previous[key]
          : 0,
    }),
  );
}
