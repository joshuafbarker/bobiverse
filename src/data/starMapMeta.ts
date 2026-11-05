/**
 * Tiny helpers for the star-map page chrome (not part of the canvas engine).
 */
import { systems } from "./index";

const unknown = systems.filter((s) => !s.galacticXYZly);
export const unplottableNote =
  unknown.length > 0
    ? `Location unknown: ${unknown.map((s) => s.name).join(", ")} — no reliable coordinates; not plotted.`
    : "";
