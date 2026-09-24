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

/** The selection outline under one object's node: the library's hull group, or `undefined` when the object has none. */
function outlineOf(mirror: SceneMirror, id: string): THREE.Group | undefined {
  const node = mirror.objectOf(id);
  if (node === undefined) return undefined;
  return node.children.find(
    (child): child is THREE.Group =>
      child instanceof THREE.Group && child.children.some((grandchild) => grandchild instanceof THREE.Mesh),
  );
}

/** The depth the outline pass clips the hull against: the object's own instances with colour off (README D50). */
function outlineDepthOf(mirror: SceneMirror, id: string): THREE.InstancedMesh | undefined {
  const node = mirror.objectOf(id);
  if (!(node instanceof THREE.InstancedMesh)) return undefined;
  return node.children.find((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
}

describe('selection outline', () => {
  it("wraps a uniform object's own instances in a hidden hull", () => {
    const { project, id } = voxelObject(1, [[0, 0, 0], [2, 0, 0]]);
    const mirror = new SceneMirror(project);
    mirror.sync();
    const outline = outlineOf(mirror, id);
    if (outline === undefined) throw new Error('the object has no outline');
    // Hidden until the app says this object is the selected one: the outline is object mode's affordance, not a
    // decoration every object carries (README D39).
    expect(outline.visible).toBe(false);

    const hull = outline.children[0];
    const mesh = mirror.objectOf(id);
    if (!(hull instanceof THREE.InstancedMesh) || !(mesh instanceof THREE.InstancedMesh)) {
      throw new TypeError('expected the hull and the voxels to be instances');
    }
    // One hull per voxel, through the mesh's own instance buffer rather than a copy of it: every cube of the object is
    // wrapped, and a rebuild is the only thing that can change them.
    expect(hull.instanceMatrix).toBe(mesh.instanceMatrix);
    expect(hull.count).toBe(mesh.count);
    // The outline's own layer, so the pass that draws it can be restricted to it and the layer-1 decorations, every
    // other object, and the frame itself stay out (README D24, D50).
    expect(outline.layers.mask).toBe(1 << 3);
    expect(hull.layers.mask).toBe(1 << 3);

    // The depth the hull is cut against: the same instances with colour off, so the pass that draws the outline sees
    // this object's silhouette and no other object's — an adjacent object's depth is not in it, which is what keeps the
    // rim whole along a shared boundary (README D50).
    const depth = outlineDepthOf(mirror, id);
    if (depth === undefined) throw new Error('the object has no outline depth');
    expect(depth.instanceMatrix).toBe(mesh.instanceMatrix);
    expect(depth.count).toBe(mesh.count);
    expect(depth.layers.mask).toBe(1 << 3);
    expect(depth.visible).toBe(false);
    const depthMaterial = depth.material;
    if (!(depthMaterial instanceof THREE.MeshBasicMaterial)) throw new TypeError('expected the depth copy to be basic');
    expect(depthMaterial.colorWrite).toBe(false);

    // The hull's thickness is a share of the object's own cell, so the same share of half a cell is half the world
    // thickness: an object at a finer subdivision carries a proportionally finer outline, not the same one.
    const materialOf = (instance: THREE.InstancedMesh): THREE.ShaderMaterial => {
      const material = instance.material;
      if (!(material instanceof THREE.ShaderMaterial)) throw new TypeError('expected the hull to be a shader material');
      return material;
    };
    const fine = voxelObject(2, [[0, 0, 0]]);
    const fineMirror = new SceneMirror(fine.project);
    fineMirror.sync();
    const fineHull = outlineOf(fineMirror, fine.id)?.children[0];
    if (!(fineHull instanceof THREE.InstancedMesh)) throw new TypeError('the finer object has no hull');
    const unitThickness = materialOf(hull).uniforms['thickness']?.value as number;
    const fineThickness = materialOf(fineHull).uniforms['thickness']?.value as number;
    expect(unitThickness).toBeGreaterThan(0);
    expect(fineThickness).toBeCloseTo(unitThickness / 2, 6);
  });

  it('shows exactly the selected object, and keeps it across a rebuild', () => {
    const project = new Project();
    const firstGrid = UniformGrid.create(1);
    firstGrid.set(0, 0, 0, 0xff0000);
    const secondGrid = UniformGrid.create(1);
    secondGrid.set(1, 0, 0, 0x00ff00);
    const first = project.createVoxelObject({
      name: 'first',
      maskColor: 0x111111,
      payload: { kind: 'uniform', grid: firstGrid },
      position: new Vector3(),
    });
    const second = project.createVoxelObject({
      name: 'second',
      maskColor: 0x222222,
      payload: { kind: 'uniform', grid: secondGrid },
      position: new Vector3(),
    });
    const mirror = new SceneMirror(project);
    mirror.sync();

    mirror.setSelected(first.id);
    expect(outlineOf(mirror, first.id)?.visible).toBe(true);
    expect(outlineOf(mirror, second.id)?.visible).toBe(false);
    // The depth copy goes with it, and that is what keeps the pass honest: a second object's depth in it would clip the
    // selected object's rim again, which is the whole reason the pass exists (README D50).
    expect(outlineDepthOf(mirror, first.id)?.visible).toBe(true);
    expect(outlineDepthOf(mirror, second.id)?.visible).toBe(false);

    // A rebuild replaces the node and its outline together, so the mirror has to re-apply the selection itself:
    // otherwise any payload edit would drop the outline the user is looking at (README D4).
    mirror.markDirty(first.id);
    mirror.sync();
    expect(outlineOf(mirror, first.id)?.visible).toBe(true);
    expect(outlineOf(mirror, second.id)?.visible).toBe(false);
    expect(outlineDepthOf(mirror, first.id)?.visible).toBe(true);
    expect(outlineDepthOf(mirror, second.id)?.visible).toBe(false);

    mirror.setSelected(second.id);
    expect(outlineOf(mirror, first.id)?.visible).toBe(false);
    expect(outlineOf(mirror, second.id)?.visible).toBe(true);
    expect(outlineDepthOf(mirror, first.id)?.visible).toBe(false);
    expect(outlineDepthOf(mirror, second.id)?.visible).toBe(true);

    mirror.setSelected(null);
    expect(outlineOf(mirror, first.id)?.visible).toBe(false);
    expect(outlineOf(mirror, second.id)?.visible).toBe(false);
  });

  it('has no outline for a transform-only object, which has no instances to wrap', () => {
    const project = new Project();
    const group = project.createObject({ name: 'group', parentId: null, representation: 'empty' });
    const mirror = new SceneMirror(project);
    mirror.sync();
    mirror.setSelected(group.id);
    expect(outlineOf(mirror, group.id)).toBeUndefined();
  });
});

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
