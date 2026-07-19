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
  uv run --with trimesh --with numpy --with pillow tools/bake-assets/normalize_asset.py \
    --input web/public/scene-lab-assets/custom-item.glb \
    --target-height-mm 150 \
    --max-texture-size 2048

产出文件与输入同目录，文件名去掉原扩展名后缀 .norm.glb / .meta.json。
"""
import argparse
import hashlib
import json
import os
import sys
import traceback

import numpy as np
import trimesh
from PIL import Image


TEXTURE_FIELDS = (
    'baseColorTexture',
    'metallicRoughnessTexture',
    'normalTexture',
    'occlusionTexture',
    'emissiveTexture',
)


def load_scene(path):
    obj = trimesh.load(path, force='scene')
    if isinstance(obj, trimesh.Trimesh):
        scene = trimesh.Scene()
        scene.add_geometry(obj)
        return scene
    if isinstance(obj, trimesh.Scene):
        return obj
    raise ValueError(f'不支持的模型类型: {type(obj)}')


def resize_material_textures(scene, max_texture_size):
    if max_texture_size is None:
        return

    resized = {}
    for geometry in scene.geometry.values():
        material = getattr(geometry.visual, 'material', None)
        if material is None:
            continue
        for field in TEXTURE_FIELDS:
            image = getattr(material, field, None)
            if not isinstance(image, Image.Image):
                continue
            key = id(image)
            if key not in resized:
                width, height = image.size
                scale = min(1.0, max_texture_size / max(width, height))
                if scale < 1.0:
                    target = (max(1, round(width * scale)), max(1, round(height * scale)))
                    resized[key] = image.resize(target, Image.Resampling.LANCZOS)
                else:
                    resized[key] = image
            setattr(material, field, resized[key])


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_asset(input_path, target_height_mm, output_path=None, max_texture_size=2048):
    scene = load_scene(input_path)
    if scene.is_empty:
        raise ValueError('GLB 中未找到 geometry')

    resize_material_textures(scene, max_texture_size)

    bounds = scene.bounds
    if bounds is None:
        raise ValueError('无法计算包围盒')

    original_extents = scene.extents.astype(float)
    original_height = float(original_extents[1])
    if original_height <= 0:
        raise ValueError('模型 Y 轴（高度）尺寸无效，无法按高度缩放')

    scale = float(target_height_mm) / original_height
    scene.apply_scale(scale)

    scaled_bounds = scene.bounds
    min_y = float(scaled_bounds[0][1])
    center_x = float((scaled_bounds[0][0] + scaled_bounds[1][0]) / 2.0)
    center_z = float((scaled_bounds[0][2] + scaled_bounds[1][2]) / 2.0)
    scene.apply_translation([-center_x, -min_y, -center_z])

    final_bounds = scene.bounds
    final_extents = scene.extents.astype(float)

    input_base, _ = os.path.splitext(input_path)
    normalized_path = output_path or f'{input_base}.norm.glb'
    output_base, _ = os.path.splitext(normalized_path)
    meta_path = output_base.removesuffix('.norm') + '.meta.json'

    scene.export(normalized_path)
    bytes_count = os.path.getsize(normalized_path)
    checksum = sha256_file(normalized_path)

    meta = {
        'sourceFile': os.path.basename(input_path),
        'normalizedFile': os.path.basename(normalized_path),
        'bytes': bytes_count,
        'checksumSha256': checksum,
        'heightMm': round(float(target_height_mm), 3),
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
            'maxTextureSize': max_texture_size,
            'originalExtentsMm': [round(float(x), 6) for x in original_extents],
        },
    }
    with open(meta_path, 'w', encoding='utf-8') as file:
        json.dump(meta, file, ensure_ascii=False, indent=2)
        file.write('\n')

    return meta


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--target-height-mm', type=float, required=True)
    p.add_argument('--output', default=None, help='默认 <input 同目录同名>.norm.glb')
    p.add_argument('--max-texture-size', type=int, default=2048)
    args = p.parse_args()
    if args.max_texture_size < 1:
        raise ValueError('max-texture-size 必须为正整数')
    meta = normalize_asset(
        args.input,
        args.target_height_mm,
        args.output,
        args.max_texture_size,
    )
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'error': str(e), 'traceback': traceback.format_exc()}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
