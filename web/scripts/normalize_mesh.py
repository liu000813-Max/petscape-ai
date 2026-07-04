#!/usr/bin/env python3
import argparse, json, sys, traceback
import numpy as np
import trimesh


def load_mesh(path):
    obj = trimesh.load(path, force='scene')
    if isinstance(obj, trimesh.Scene):
        if hasattr(obj, 'to_geometry'):
            geom = obj.to_geometry()
            if isinstance(geom, trimesh.Trimesh):
                return geom
        dumped = obj.dump(concatenate=True)
        if isinstance(dumped, trimesh.Trimesh):
            return dumped
        meshes = [g for g in dumped if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError('GLB 中未找到 mesh geometry')
        return trimesh.util.concatenate(meshes)
    if isinstance(obj, trimesh.Trimesh):
        return obj
    raise ValueError(f'不支持的模型类型: {type(obj)}')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--target-mm', type=float, required=True)
    args = p.parse_args()

    mesh = load_mesh(args.input)
    if mesh.vertices is None or len(mesh.vertices) == 0:
        raise ValueError('模型没有顶点')

    original_extents = mesh.extents.astype(float)

    # Meshy / glTF viewer convention in this project is Y-up. Rotate +90° around X:
    # old Y (height) becomes new Z, so PrusaSlicer receives a Z-up STL.
    rot = trimesh.transformations.rotation_matrix(np.deg2rad(90.0), [1, 0, 0])
    mesh.apply_transform(rot)
    rotated_extents = mesh.extents.astype(float)

    max_extent = float(np.max(rotated_extents))
    if max_extent <= 0:
        raise ValueError('模型尺寸无效，无法缩放')
    scale = float(args.target_mm) / max_extent
    mesh.apply_scale(scale)

    # Place the model on the print bed.
    min_z = float(mesh.bounds[0][2])
    mesh.apply_translation([0, 0, -min_z])

    # Center XY around origin; PrusaSlicer will place/validate it on the bed.
    center_xy = mesh.bounds[:, :2].mean(axis=0)
    mesh.apply_translation([-float(center_xy[0]), -float(center_xy[1]), 0])

    mesh.export(args.output)
    result = {
        'stlPath': args.output,
        'targetMm': float(args.target_mm),
        'actualExtentsMm': [round(float(x), 3) for x in mesh.extents],
        'boundsMm': [[round(float(v), 3) for v in row] for row in mesh.bounds],
        'transform': {
            'rotation': 'Y-up to Z-up: rotate +90deg around X',
            'scale': scale,
            'droppedToZ0': True,
            'centeredXY': True,
            'originalExtents': [round(float(x), 6) for x in original_extents],
            'rotatedExtents': [round(float(x), 6) for x in rotated_extents],
        },
    }
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'error': str(e), 'traceback': traceback.format_exc()}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
