# baked-mesh-codec.ts

**职责**：编码/解码 Bake Mesh 的几何、材质、纹理引用和项目 manifest。
**接口**：encodeGeometryAsset、decodeGeometryAsset、encodeMaterialAsset、decodeMaterialAsset、encodeManifest、decodeManifest、validateAsset、estimateBytes、version。
**内部**：保存纯二进制与可序列化 PBR 描述，不创建 Three.js 对象、不执行 Bake、不导入外部 GLB。
**依赖**：util/color、project。

## 本重构必须补齐

shithill 的 Bake Mesh 只存在于内存，项目文件只保存体素和动画文档。目标架构必须新增可持久化资产模型，使项目保存后能恢复自己生成的 Bake Mesh；这不等于 Load Bakes 或外部 GLB 导入。Bake Mesh 持久化不得新增相机专用动画字段或第二份动画文档，动画始终由项目顶层统一的 `AnimationDocument` 拥有。

## 项目 manifest

```text
BakedMeshManifest {
  version: 1;
  id: string;
  name: string;
  geometryAssetId: string;
  materialAssetId: string;
  transform: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    scale: { x: number; y: number; z: number };
  };
  visible: boolean;
  source: {
    scope: "scene" | "object";
    objectId?: string;
    mode: "all" | "color" | "colors" | "islands";
    sourceSceneVersion: number;
    color?: "#RRGGBB";
    islandConnectivity?: 6 | 26;
  };
}
```

项目文档保存 manifest 数组；几何和材质 bytes 通过 `geometryAssetId`/`materialAssetId` 存入 repository。`scope = "object"` 时必须提供存在的 `objectId`；`scope = "scene"` 时不得提供。名称 trim 后非空，空名称拒绝并保留旧名称；重复名称在 manifest 写入前确定性添加 `_2`、`_3`，选中身份仍使用 `id`，不能依赖名称。

## 资产 DTO

```text
BakedGeometryAsset {
  version: 1;
  geometry: {
    layout: "separate-arrays";
    position: ArrayBuffer;          // Float32
    normal: ArrayBuffer;            // Float32
    uv?: ArrayBuffer;               // Float32
    color?: ArrayBuffer;            // Float32 RGBA
    index: ArrayBuffer;             // Uint16/Uint32
    bounds: { min: Vector3; max: Vector3 };
  };
}

BakedMaterialAsset {
  version: 1;
  material: {
    baseColorFactor: "#RRGGBB" | [number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
    emissiveFactor: [number, number, number];
    emissiveIntensity: number;
    alpha: number;
    alphaMode: "OPAQUE" | "MASK" | "BLEND";
    alphaCutoff?: number;
    doubleSided: boolean;
    textureless: boolean;
    textures: {
      baseColor?: TextureAssetRef;
      metallicRoughness?: TextureAssetRef;
      normal?: TextureAssetRef;
      alpha?: TextureAssetRef;
      emissive?: TextureAssetRef;
    };
  };
}

TextureAssetRef {
  assetId: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  colorSpace: "srgb" | "linear";
  flipY: boolean;
  byteLength: number;
}
```

- `baseColor`、`emissive` 等颜色纹理标记 `srgb`；metallic-roughness、normal、alpha、occlusion 和其他数据纹理标记 `linear`。
- `flipY` 必须来自材质/纹理元数据并与 UV 方向一致；导出时不能再次猜测翻转。
- `textureless: true` 且没有 baseColor 纹理时，禁止恢复/导出时自动注入体素 atlas。顶点色存在时保留顶点色；不存在时只使用 PBR scalar factor。
- 纹理字节是共享资产，manifest 只保存引用。删除 Mesh 时减少引用；保存成功后 GC 零引用资产。

## 版本、原子性与配额

- 非当前 asset/manifest 版本返回 `UNSUPPORTED_VERSION`，不得迁移或部分解码。
- 解码先验证数组长度、index 范围、有限数值、alpha/metalness/roughness 范围和纹理引用，再创建运行时资源。
- 保存顺序为：写入新资产 → 校验读回 → 原子提交项目 manifest → 回收旧资产。失败保留原项目，临时资产必须删除。
- 资产字节使用实际 byte 配额，不适用 localStorage UTF-16 口径。容量不足返回 `QUOTA_EXCEEDED`，不能丢弃部分 Mesh 后仍报告项目保存成功。
- 加载项目时，只有 manifest 与所有引用资产都完整且校验通过才提交 Bake Mesh；缺失资产返回 `MISSING_BAKED_MESH_ASSET`，不得静默把 Mesh 删除后覆盖项目。
