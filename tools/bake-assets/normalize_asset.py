#!/usr/bin/env python3
"""
资产入库规范化：一次性烘焙 GLB，运行时零猜测。

输入：GLB + 目标真实高度 mm（沿 Y 轴，Y-up 是本项目 three.js 场景的约定，
与 web/scripts/normalize_mesh.py 的 STL 管线相反——那边要转 Z-up 给切片软件，
这里要保持 Y-up 给 three.js/GLTFLoader 直接消费）。

输出：
- <name>.norm.glb：1 unit = 1mm，包围盒 x/z 中心对齐 origin，min.y 贴地(=0)。
- <name>.meta.json：{ heightMm, footprint: { xMm, zMm } }，供运行时读取，
  不在浏览器里重新做 Box3 归一化猜测。

用法：
  uv run --with trimesh --with numpy scripts/normalize_asset.py \
    --input web/public/scene-lab-assets/custom-item.glb \
    --target-height-mm 150

产出文件与输入同目录，文件名去掉原扩展名后缀 .norm.glb / .meta.json。
"""
import argparse
import json
import os
import sys
import traceback

import numpy as np
import trimesh


def load_scene(path):
    obj = trimesh.load(path, force='scene')
    if isinstance(obj, trimesh.Trimesh):
        scene = trimesh.Scene()
        scene.add_geometry(obj)
        return scene
    if isinstance(obj, trimesh.Scene):
        return obj
    raise ValueError(f'不支持的模型类型: {type(obj)}')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--target-height-mm', type=float, required=True)
    p.add_argument('--output', default=None, help='默认 <input 同目录同名>.norm.glb')
    args = p.parse_args()

    scene = load_scene(args.input)
    if scene.is_empty:
        raise ValueError('GLB 中未找到 geometry')

    bounds = scene.bounds
    if bounds is None:
        raise ValueError('无法计算包围盒')

    original_extents = scene.extents.astype(float)
    original_height = float(original_extents[1])  # Y-up：高度 = Y 轴 extent
    if original_height <= 0:
        raise ValueError('模型 Y 轴（高度）尺寸无效，无法按高度缩放')

    scale = float(args.target_height_mm) / original_height
    scene.apply_scale(scale)

    # 缩放后重新取包围盒：贴地（min.y=0）+ x/z 居中到 origin
    scaled_bounds = scene.bounds
    min_y = float(scaled_bounds[0][1])
    center_x = float((scaled_bounds[0][0] + scaled_bounds[1][0]) / 2.0)
    center_z = float((scaled_bounds[0][2] + scaled_bounds[1][2]) / 2.0)
    scene.apply_translation([-center_x, -min_y, -center_z])

    final_bounds = scene.bounds
    final_extents = scene.extents.astype(float)

    base, ext = os.path.splitext(args.input)
    output_path = args.output or f'{base}.norm.glb'
    meta_path = f'{base}.meta.json'

    scene.export(output_path)

    meta = {
        'sourceFile': os.path.basename(args.input),
        'normalizedFile': os.path.basename(output_path),
        'heightMm': round(float(args.target_height_mm), 3),
        'footprint': {
            'xMm': round(float(final_extents[0]), 3),
            'zMm': round(float(final_extents[2]), 3),
        },
        'boundsMm': [[round(float(v), 3) for v in row] for row in final_bounds],
        'transform': {
            'convention': 'Y-up, 1 unit = 1mm',
            'scale': scale,
            'droppedToY0': True,
            'centeredXZ': True,
            'originalExtentsMm': [round(float(x), 6) for x in original_extents],
        },
    }
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'error': str(e), 'traceback': traceback.format_exc()}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
