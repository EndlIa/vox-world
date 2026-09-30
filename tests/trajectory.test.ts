/**
 * The camera path: the times it chooses are its own, the curve is `document/camera.ts`'s own evaluation, and the two
 * together are what the drawn path and its markers come from. Node-side and GPU-free.
 */

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Project } from '../src/document/project.js';
import { activeTake, splitSegment, upsertKey } from '../src/document/camera.js';
import { cameraKeyframePositions, sampleCameraTrajectory } from '../src/animation/trajectory.js';

/** A project whose one shot holds a key at each time the caller names, over a one-second clip. */
function projectWithShots(states: readonly { timeMs: number; position: [number, number, number] }[]): Project {
  const project = new Project();
  project.setDuration(1000);
  const take = activeTake(project.camera);
  const segment = take?.segments[0];
  if (take === undefined || segment === undefined) throw new Error('fixture: the project has no shot');
  for (const state of states) {
    upsertKey(project.camera, take.id, segment.id, {
      timeMs: state.timeMs,
      position: new Vector3(...state.position),
      quaternion: new Quaternion(),
      lens: 50,
    });
  }
  return project;
}

describe('camera trajectory', () => {
  it('samples the authored curve evenly over the shot, both ends included', () => {
    const project = projectWithShots([
      { timeMs: 0, position: [0, 0, 0] },
      { timeMs: 1000, position: [10, 0, 0] },
    ]);
    const points = sampleCameraTrajectory(project, 2);
    expect(points).toHaveLength(3);
    expect(points[0]!.toArray()).toEqual([0, 0, 0]);
    expect(points[1]!.toArray()).toEqual([5, 0, 0]);
    expect(points[2]!.toArray()).toEqual([10, 0, 0]);
  });

  it('reaches both of a cut\u2019s states instead of smoothing over the seam', () => {
    const project = projectWithShots([{ timeMs: 1000, position: [8, 0, 0] }]);
    const take = activeTake(project.camera);
    const first = take?.segments[0];
    if (take === undefined || first === undefined) throw new Error('fixture: no shot to split');
    expect(splitSegment(project.camera, take.id, 500, project.timeline.durationMs).ok).toBe(true);
    const second = take.segments[1];
    if (second === undefined) throw new Error('fixture: the split produced no second shot');
    upsertKey(project.camera, take.id, second.id, {
      timeMs: 500,
      position: new Vector3(0, 9, 0),
      quaternion: new Quaternion(),
      lens: 50,
    });

    // Each shot is sampled on its own, so the earlier one ends at its own last state and the later one starts at its
    // own first: the two samples at the cut are the jump itself rather than a line across it.
    const points = sampleCameraTrajectory(project, 2).map((point) => point.toArray());
    const cutIndex = points.findIndex((point) => point[1] === 9);
    expect(cutIndex).toBeGreaterThan(0);
    expect(points[cutIndex - 1]![1]).toBe(0);
  });

  it('reports one marker point per authored key, in time order', () => {
    const project = projectWithShots([
      { timeMs: 1000, position: [4, 5, 6] },
      { timeMs: 0, position: [1, 2, 3] },
    ]);
    expect(cameraKeyframePositions(project).map((point) => point.toArray())).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('draws a single key as one repeated point, which is what the panel calls no path', () => {
    const project = projectWithShots([{ timeMs: 0, position: [0, 0, 0] }]);
    const points = sampleCameraTrajectory(project, 2);
    expect(points.length).toBeGreaterThan(1);
    expect(points.every((point) => point.toArray().join() === '0,0,0')).toBe(true);
    expect(cameraKeyframePositions(project)).toHaveLength(1);
  });
});
