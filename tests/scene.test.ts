import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { Project } from '../src/document/project.js';
import { SceneMirror } from '../src/three-runtime/scene.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';

/**
 * The mirror's derived geometry is where a cell size can go wrong without any document value changing: the cell
 * coordinate is in cells and the offset it is drawn at is in world units (README D41, D43), so a misplaced factor
 * shows up as blocks that drift apart as the subdivision rises.
 */
function voxelObject(subdivision: number, cells: [number, number, number][]): { project: Project; id: string } {
  const project = new Project();
  const grid = UniformGrid.create(subdivision);
  for (const [x, y, z] of cells) grid.set(x, y, z, 0x3366ff);
  const object = project.createVoxelObject({
    name: 'cube',
    maskColor: 0x112233,
    payload: { kind: 'uniform', grid },
    position: new Vector3(10, 0, -3),
  });
  return { project, id: object.id };
}

/** One row per instance, so instance order never decides the result. */
function instances(mirror: SceneMirror, id: string): { translations: string[]; width: number } {
  const mesh = mirror.objectOf(id);
  if (!(mesh instanceof THREE.InstancedMesh)) throw new TypeError('expected an InstancedMesh');
  const matrix = new THREE.Matrix4();
  const translations: string[] = [];
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    translations.push(new Vector3().setFromMatrixPosition(matrix).toArray().join(','));
  }
  return { translations: translations.sort(), width: (mesh.geometry as THREE.BoxGeometry).parameters.width };
}

describe('derived voxel geometry', () => {
  it("draws one cube the size of the object's own cell, centered half a cell past its index", () => {
    const unit = voxelObject(1, [[3, 0, 0]]);
    const unitMirror = new SceneMirror(unit.project);
    unitMirror.sync();
    expect(instances(unitMirror, unit.id)).toEqual({ translations: ['3.5,0.5,0.5'], width: 1 });

    // The same cell coordinate at subdivision 2 is drawn half as far out and half as wide, and the object's own
    // placement is what sits between the two: the geometry must not carry the placement itself.
    const fine = voxelObject(2, [[3, 0, 0]]);
    const fineMirror = new SceneMirror(fine.project);
    fineMirror.sync();
    expect(instances(fineMirror, fine.id)).toEqual({ translations: ['1.75,0.25,0.25'], width: 0.5 });
  });

  it("pivots the content center on the object's own lattice", () => {
    const unit = voxelObject(1, [[0, 0, 0], [1, 1, 1]]);
    const unitMirror = new SceneMirror(unit.project);
    unitMirror.sync();
    expect(unitMirror.contentCenterOf(unit.id).toArray()).toEqual([1, 1, 1]);

    const fine = voxelObject(4, [[0, 0, 0], [1, 1, 1]]);
    const fineMirror = new SceneMirror(fine.project);
    fineMirror.sync();
    expect(fineMirror.contentCenterOf(fine.id).toArray()).toEqual([0.25, 0.25, 0.25]);
  });
});
