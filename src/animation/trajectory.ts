/**
 * The camera path: where the authored camera travels, as plain points and nothing else.
 *
 * The sampling walks the active take through `document/camera.ts`'s own evaluator — the same evaluation a render uses,
 * cuts included — so no interpolation math is reimplemented here. What this file adds is the choice of times: an
 * evenly spaced walk over the clip, plus both sides of every segment boundary, which is what a polyline needs to stay
 * on the states the camera really passes through.
 */

import { Vector3 } from 'three';
import { activeTake, resolveSegmentAt } from '../document/camera.js';
import type { Project } from '../document/project.js';

/** How many segments the drawn path gets. Enough that a curved move reads as a curve at demo scale. */
export const CAMERA_PATH_SEGMENTS = 128;

/**
 * The active take's position sampled into a polyline — one run of `segments` even steps per segment, both ends of
 * each included. Sampling per segment rather than over the clip is what keeps a cut honest: each segment is asked for
 * its own state, so the polyline reaches the earlier shot's last state and then jumps to the later shot's first one,
 * which is exactly the travel the camera makes. An empty list means there is no camera to draw.
 */
export function sampleCameraTrajectory(project: Project, segments = CAMERA_PATH_SEGMENTS): Vector3[] {
  const take = activeTake(project.camera);
  if (take === undefined || take.segments.length === 0) return [];
  const steps = Math.max(1, Math.floor(segments));
  const perSegment = Math.max(1, Math.round(steps / take.segments.length));
  const points: Vector3[] = [];
  for (const segment of take.segments) {
    for (let step = 0; step <= perSegment; step += 1) {
      const time = segment.startMs + ((segment.endMs - segment.startMs) * step) / perSegment;
      points.push(resolveSegmentAt(segment, time, take.id).position);
    }
  }
  return points;
}

/**
 * One point per authored camera key, in take order: where the markers go. Separate from the sampled path because a
 * marker belongs to a key, not to a sample of the curve between two of them.
 */
export function cameraKeyframePositions(project: Project): Vector3[] {
  const take = activeTake(project.camera);
  if (take === undefined) return [];
  return take.segments.flatMap((segment) => segment.keys.map((key) => key.position.clone()));
}
