#!/usr/bin/env python3
"""WP-B7-1 server-side mesh analyzer. JSON stdout on success, JSON stderr on failure."""
import argparse
import hashlib
import json
import math
import pathlib
import sys

import numpy as np
import trimesh


class AnalysisError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def load_mesh(path):
    try:
        loaded = trimesh.load(path, force="scene")
    except Exception as error:
        raise AnalysisError("mesh_load_failed", f"无法读取网格: {error}") from error
    if isinstance(loaded, trimesh.Scene):
        try:
            mesh = loaded.to_geometry()
        except Exception as error:
            raise AnalysisError("mesh_load_failed", f"无法合并场景网格: {error}") from error
    elif isinstance(loaded, trimesh.Trimesh):
        mesh = loaded
    else:
        raise AnalysisError("mesh_load_failed", f"不支持的网格类型: {type(loaded).__name__}")
    if mesh.vertices is None or mesh.faces is None or len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise AnalysisError("mesh_empty", "网格没有可分析的顶点或三角面")
    return mesh


def parse_dimensions(raw):
    try:
        values = [float(value) for value in raw.split(",")]
    except ValueError as error:
        raise AnalysisError("invalid_dimensions", "dimensionsMm 必须是三个数值") from error
    if len(values) != 3 or any(not math.isfinite(value) or value <= 0 or value > 10000 for value in values):
        raise AnalysisError("invalid_dimensions", "dimensionsMm 必须是三个 0~10000 的有限正数")
    return np.asarray(values, dtype=float)


def analyze(args):
    if args.geometry_unit != "millimeter":
        raise AnalysisError("unit_missing_or_unsupported", "geometryUnit 必须明确为 millimeter")
    if args.algorithm_version != "trimesh-volume.v0":
        raise AnalysisError("algorithm_version_unsupported", "不支持的网格分析算法版本")

    input_path = pathlib.Path(args.input)
    if not input_path.is_file():
        raise AnalysisError("mesh_not_found", "受控资产文件不存在")
    payload = input_path.read_bytes()
    checksum = hashlib.sha256(payload).hexdigest()
    if args.expected_sha256 and checksum != args.expected_sha256:
        raise AnalysisError("asset_checksum_mismatch", "资产内容与不可变 checksum 不一致")

    target_dimensions = parse_dimensions(args.dimensions_mm)
    mesh = load_mesh(input_path)
    if not mesh.is_watertight:
        raise AnalysisError("mesh_not_watertight", "网格不是闭合体，不能生成可信体积")

    source_extents = np.asarray(mesh.extents, dtype=float)
    if source_extents.shape != (3,) or np.any(~np.isfinite(source_extents)) or np.any(source_extents <= 0):
        raise AnalysisError("mesh_invalid_extents", "网格包围盒尺寸无效")
    axis_scales = target_dimensions / source_extents
    uniform_scale = float(np.mean(axis_scales))
    relative_spread = float(np.max(np.abs(axis_scales - uniform_scale)) / uniform_scale)
    if not math.isfinite(uniform_scale) or uniform_scale < 0.01 or uniform_scale > 100:
        raise AnalysisError("mesh_abnormal_scale", "目标尺寸要求异常缩放，拒绝分析")
    if relative_spread > 0.01:
        raise AnalysisError("mesh_non_uniform_dimensions", "目标 x/y/z 与原网格比例不一致")

    volume_mm3 = abs(float(mesh.volume)) * (uniform_scale ** 3)
    if not math.isfinite(volume_mm3) or volume_mm3 <= 0:
        raise AnalysisError("mesh_invalid_volume", "网格体积不是有限正数")

    return {
        "schemaVersion": "mesh-analysis-result.v0",
        "algorithmVersion": args.algorithm_version,
        "geometryUnit": "millimeter",
        "assetChecksum": checksum,
        "dimensionsMm": {
            "x": round(float(target_dimensions[0]), 6),
            "y": round(float(target_dimensions[1]), 6),
            "z": round(float(target_dimensions[2]), 6),
        },
        "volumeMm3": round(volume_mm3, 6),
        "triangleCount": int(len(mesh.faces)),
        "watertight": True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--geometry-unit", required=True)
    parser.add_argument("--dimensions-mm", required=True)
    parser.add_argument("--algorithm-version", required=True)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    print(json.dumps(analyze(args), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except AnalysisError as error:
        print(json.dumps({"code": error.code, "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(json.dumps({"code": "mesh_analysis_internal", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
