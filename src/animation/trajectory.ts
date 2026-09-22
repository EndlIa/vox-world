/**
 * The camera path: where the authored camera travels, as plain points and nothing else.
 *
 * The sampling runs the clip `animation/compile.ts` builds through a scratch `AnimationMixer`, which is the same
 * evaluation a render uses — discrete, linear, or the smooth spline, exactly as the track is set up (README D2) —
 * so no interpolation math is reimplemented here. What this file adds is the choice of times: an evenly spaced
 * walk over the clip's length, which is what a polyline needs.
 */

import { AnimationClip, AnimationMixer, LoopOnce, Object3D, Vector3 } from 'three';
import { buildClip, channelBinding } from './compile.js';
import { findTrack } from '../document/timeline.js';
import type { TrackTarget } from '../document/timeline.js';
import type { Project } from '../document/project.js';

/** How many segments the drawn path gets. Enough that a curved move reads as a curve at demo scale. */
export const CAMERA_PATH_SEGMENTS = 128;

/** The camera target as the timeline names it; its binding name is `camera` plus the channel's path (D22). */
const CAMERA: TrackTarget = { kind: 'camera' };

/**
 * The authored camera's position channel sampled into a polyline: `segments` even steps over the clip, both ends
 * included. An empty list means the camera has no position track to draw, which is a normal state, not a failure.
 */
export function sampleCameraTrajectory(project: Project, segments = CAMERA_PATH_SEGMENTS): Vector3[] {
  const clip = buildClip(project);
  const name = `camera${channelBinding('position').path}`;
  const track = clip.tracks.find((entry) => entry.name === name);
  if (track === undefined) return [];

  // A scratch node bound by name: only the camera's own track goes into the sampling clip, so the mixer never
  // looks for an object track's node, and the root stays unnamed so the child is the one the binding finds.
  const node = new Object3D();
  node.name = 'camera';
  const root = new Object3D();
  root.add(node);
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(new AnimationClip(clip.name, clip.duration, [track]));
  // One pass that clamps at the end: a repeating action would fold the sample taken at the clip's length back onto
  // the first keyframe, and the drawn path has to reach the last one.
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const steps = Math.max(1, Math.floor(segments));
  const points: Vector3[] = [];
  for (let step = 0; step <= steps; step += 1) {
    mixer.setTime((clip.duration * step) / steps);
    points.push(node.position.clone());
  }
  mixer.uncacheRoot(root);
  return points;
}

/**
 * One point per authored camera position keyframe, in time order: where the markers go. Separate from the sampled
 * path because a marker belongs to a keyframe, not to a sample of the curve between two of them.
 */
export function cameraKeyframePositions(project: Project): Vector3[] {
  const track = findTrack(project.timeline, CAMERA, 'position');
  if (track === undefined) return [];
  return track.keyframes.map((keyframe) => new Vector3(keyframe.value[0], keyframe.value[1], keyframe.value[2]));
}
