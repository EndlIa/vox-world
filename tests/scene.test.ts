import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Vector3 } from 'three';
import { Project } from '../src/document/project.js';
import { DEFAULT_FAR, DEFAULT_FOV, DEFAULT_NEAR, activeTake, addTake, splitSegment, setSegmentProjection, upsertKey } from '../src/document/camera.js';
import { SceneMirror } from '../src/three-runtime/scene.js';
import { UniformGrid } from '../src/voxels/uniform/grid.js';

/**
 * The mirror's derived geometry is where a cell size can go wrong without any document value changing: the cell
 * coordinate is in cells and the offset it is drawn at is in world units, so a misplaced factor
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

/** The depth the outline pass clips the hull against: the object's own instances with colour off. */
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
    // decoration every object carries.
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
    // other object, and the frame itself stay out.
    expect(outline.layers.mask).toBe(1 << 3);
    expect(hull.layers.mask).toBe(1 << 3);

    // The depth the hull is cut against: the same instances with colour off, so the pass that draws the outline sees
    // this object's silhouette and no other object's — an adjacent object's depth is not in it, which is what keeps the
    // rim whole along a shared boundary.
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
    // selected object's rim again, which is the whole reason the pass exists.
    expect(outlineDepthOf(mirror, first.id)?.visible).toBe(true);
    expect(outlineDepthOf(mirror, second.id)?.visible).toBe(false);

    // A rebuild replaces the node and its outline together, so the mirror has to re-apply the selection itself:
    // otherwise any payload edit would drop the outline the user is looking at.
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

describe('project reload support', () => {
  it('forgets source meshes so a reused id cannot resurrect one', () => {
    const project = new Project();
    const placeholder = project.createObject({ name: 'placeholder', representation: 'empty' });
    const mirror = new SceneMirror(project);
    const mesh = new THREE.Mesh();
    mirror.attachSourceObject(placeholder.id, mesh, new THREE.Matrix4());
    mirror.sync();
    expect(mesh.parent).toBe(mirror.objectOf(placeholder.id));

    // What a load does: the app detaches the meshes it owns, the mirror forgets their records under the id the
    // loaded project reuses, and the next sync must not adopt them again.
    mesh.removeFromParent();
    mirror.clearSources();
    mirror.sync();

    expect(mesh.parent).toBeNull();
    expect(mirror.objectOf(placeholder.id)?.children ?? []).toEqual([]);
  });

  it('re-reads the project settings into the scene', () => {
    const project = new Project();
    const mirror = new SceneMirror(project);
    const ambient = mirror.scene.children.find((child) => child instanceof THREE.AmbientLight);
    if (!(ambient instanceof THREE.AmbientLight)) throw new TypeError('expected the ambient light');

    project.settings.background = 0x123456;
    project.settings.ambientIntensity = 0.25;
    mirror.applySettings();

    const background = mirror.scene.background;
    if (!(background instanceof THREE.Color)) throw new TypeError('expected a background colour');
    expect(background.getHex()).toBe(0x123456);
    expect(ambient.intensity).toBe(0.25);
  });

  it('builds the output camera on the camera model’s defaults, and never writes its pose in sync', () => {
    const project = new Project();
    const mirror = new SceneMirror(project);

    expect(mirror.camera.lens).toBe(DEFAULT_FOV);
    expect(mirror.camera.projection).toBe('perspective');
    expect(mirror.camera.near).toBe(DEFAULT_NEAR);
    expect(mirror.camera.far).toBe(DEFAULT_FAR);
    expect(mirror.camera.up.toArray()).toEqual([0, 0, 1]);
    expect(mirror.camera.name).toBe('camera');

    // The shot is not the mirror's to write: `animation/playback.ts` resolves the take onto this camera, and a sync
    // leaves whatever that put there alone.
    const before = mirror.camera.position.toArray();
    const key = project.camera.takes[0]?.segments[0]?.keys[0];
    if (key === undefined) throw new Error('fixture: the project holds no key to move');
    key.position.set(9, 9, 9);
    mirror.sync();
    expect(mirror.camera.position.toArray()).toEqual(before);
  });

  it('writes the active take\u2019s shot into the output camera, jumping at a cut', () => {
    const project = new Project();
    project.setDuration(1000);
    const mirror = new SceneMirror(project);
    const take = project.camera.takes[0];
    const segment = take?.segments[0];
    if (take === undefined || segment === undefined) throw new Error('fixture: no shot');

    const shot = (segmentId: string, timeMs: number, x: number, lens: number): void => {
      upsertKey(project.camera, take.id, segmentId, {
        timeMs,
        position: new THREE.Vector3(x, 0, 0),
        quaternion: new THREE.Quaternion(),
        lens,
      });
    };
    shot(segment.id, 0, 0, 30);
    shot(segment.id, 1000, 10, 70);

    mirror.applyShot(0);
    expect(mirror.camera.position.toArray()).toEqual([0, 0, 0]);
    expect(mirror.camera.lens).toBe(30);
    mirror.applyShot(500);
    expect(mirror.camera.position.x).toBeCloseTo(5, 12);
    expect(mirror.camera.lens).toBeCloseTo(50, 12);
    // The lens reaches the frame: the projection this camera draws with is rebuilt, not left stale.
    expect(mirror.camera.projectionMatrix.elements).toEqual(new THREE.PerspectiveCamera(50, 1, 0.1, 2000).projectionMatrix.elements);

    expect(splitSegment(project.camera, take.id, 500, 1000).ok).toBe(true);
    const later = take.segments[1];
    if (later === undefined) throw new Error('fixture: the split produced no second shot');
    shot(later.id, 500, 0, 50);
    mirror.applyShot(499.9);
    expect(mirror.camera.position.x).toBeCloseTo(4.999, 9);
    mirror.applyShot(500);
    expect(mirror.camera.position.toArray()).toEqual([0, 0, 0]);
  });

  it('renders an orthographic segment with an orthographic projection', () => {
    const project = new Project();
    project.setDuration(1000);
    const mirror = new SceneMirror(project);
    const take = project.camera.takes[0];
    const segment = take?.segments[0];
    if (take === undefined || segment === undefined) throw new Error('fixture: no shot');
    expect(setSegmentProjection(project.camera, take.id, segment.id, 'orthographic').ok).toBe(true);
    upsertKey(project.camera, take.id, segment.id, {
      timeMs: 0,
      position: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      lens: 8,
    });

    mirror.applyShot(0);
    expect(mirror.camera.projection).toBe('orthographic');
    const expected = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 2000);
    expect(mirror.camera.projectionMatrix.elements).toEqual(expected.projectionMatrix.elements);
    expect(mirror.camera.projectionMatrixInverse.elements).toEqual(expected.projectionMatrixInverse.elements);
  });
});

describe('applyShot take override', () => {
  it('writes a named take into the output camera without switching the active one', () => {
    const project = new Project();
    project.setDuration(1000);
    const mirror = new SceneMirror(project);
    const active = activeTake(project.camera);
    const segment = active?.segments[0];
    if (active === undefined || segment === undefined) throw new Error('fixture: no shot');
    upsertKey(project.camera, active.id, segment.id, {
      timeMs: 0,
      position: new THREE.Vector3(3, 0, 0),
      quaternion: new THREE.Quaternion(),
      lens: 40,
    });

    const other = addTake(project.camera, { name: 'Wide', durationMs: project.timeline.durationMs });
    const otherSegment = other.segments[0];
    if (otherSegment === undefined) throw new Error('fixture: the added take has no shot');
    upsertKey(project.camera, other.id, otherSegment.id, {
      timeMs: 0,
      position: new THREE.Vector3(-7, 0, 0),
      quaternion: new THREE.Quaternion(),
      lens: 70,
    });

    // No take named: the shot is the active take's, which is what the viewport previews.
    expect(mirror.applyShot(0)).toBe(true);
    expect(mirror.camera.position.toArray()).toEqual([3, 0, 0]);
    // A named take renders that plan without switching the editor's preview, which is what the export's own take does.
    expect(mirror.applyShot(0, other.id)).toBe(true);
    expect(mirror.camera.position.toArray()).toEqual([-7, 0, 0]);
    expect(mirror.camera.lens).toBe(70);
    expect(project.camera.activeTakeId).toBe(active.id);
    // An explicit take that names nothing writes nothing and reports it rather than substituting the active take, so a
    // stale export choice fails instead of rendering the wrong plan.
    expect(mirror.applyShot(0, 'take-999')).toBe(false);
    expect(mirror.camera.position.toArray()).toEqual([-7, 0, 0]);
  });
});
