/**
 * The camera trajectory sampler: the times it chooses are its own, the curve between keyframes is three's, and the
 * two together are what the drawn path and its markers come from. Node-side and GPU-free.
 */

import { describe, expect, it } from 'vitest';
import { Project } from '../src/document/project.js';
import { addKeyframe, setInterpolation } from '../src/document/timeline.js';
import type { TrackTarget } from '../src/document/timeline.js';
import { cameraKeyframePositions, sampleCameraTrajectory } from '../src/animation/trajectory.js';

const CAMERA: TrackTarget = { kind: 'camera' };

function projectWithCameraKeys(
  keys: readonly { timeMs: number; value: [number, number, number] }[],
): Project {
  const project = new Project();
  project.timeline.durationMs = 1000;
  for (const key of keys) addKeyframe(project.timeline, CAMERA, 'position', key.timeMs, key.value);
  return project;
}

describe('camera trajectory', () => {
  it('samples the authored curve evenly over the clip, both ends included', () => {
    const project = projectWithCameraKeys([
      { timeMs: 0, value: [0, 0, 0] },
      { timeMs: 1000, value: [10, 0, 0] },
    ]);
    const points = sampleCameraTrajectory(project, 2);
    expect(points).toHaveLength(3);
    expect(points[0]!.toArray()).toEqual([0, 0, 0]);
    expect(points[1]!.toArray()).toEqual([5, 0, 0]);
    expect(points[2]!.toArray()).toEqual([10, 0, 0]);
  });

  it('follows the track interpolation rather than assuming a straight line', () => {
    const project = projectWithCameraKeys([
      { timeMs: 0, value: [0, 0, 0] },
      { timeMs: 500, value: [4, 8, 0] },
      { timeMs: 1000, value: [8, 0, 0] },
    ]);
    // `step` holds a keyframe's value until the next one, so a sample between two of them is exactly the earlier.
    setInterpolation(project.timeline, CAMERA, 'position', 'step');
    const stepped = sampleCameraTrajectory(project, 4);
    expect(stepped[1]!.toArray()).toEqual([0, 0, 0]);
    expect(stepped[2]!.toArray()).toEqual([4, 8, 0]);

    // The same sample under linear interpolation lands between them.
    setInterpolation(project.timeline, CAMERA, 'position', 'linear');
    expect(sampleCameraTrajectory(project, 4)[1]!.toArray()).toEqual([2, 4, 0]);
  });

  it('reports one marker point per keyframe, in time order', () => {
    const project = projectWithCameraKeys([
      { timeMs: 1000, value: [4, 5, 6] },
      { timeMs: 0, value: [1, 2, 3] },
    ]);
    expect(cameraKeyframePositions(project).map((point) => point.toArray())).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('draws nothing at all without a camera position track', () => {
    const empty = new Project();
    expect(sampleCameraTrajectory(empty)).toEqual([]);
    expect(cameraKeyframePositions(empty)).toEqual([]);
  });
});
