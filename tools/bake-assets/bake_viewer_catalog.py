#!/usr/bin/env python3
import json
from pathlib import Path

from normalize_asset import normalize_asset


ROOT = Path(__file__).resolve().parents[2]
SCENE_ASSETS = ROOT / 'web/public/scene-assets'
ASSETS = (
    ('cheese-lounge-bed', ROOT / 'assets-3d/modules/cheese-lounge-bed/raw.glb'),
    ('banana-bed', ROOT / 'assets-3d/modules/banana-bed/raw.glb'),
    ('cheese-play-mat', ROOT / 'assets-3d/modules/cheese-play-mat/raw.glb'),
    ('cloud-moss-platform', SCENE_ASSETS / 'cloud-moss-teapot-platform.meshy.glb'),
    ('star-spiral-ramp', SCENE_ASSETS / 's-cloud-star-ramp.meshy.glb'),
)


def main():
    for asset_key, source_path in ASSETS:
        meta_path = SCENE_ASSETS / f'{asset_key}.meta.json'
        with meta_path.open(encoding='utf-8') as file:
            target_height_mm = json.load(file)['heightMm']
        meta = normalize_asset(
            str(source_path),
            target_height_mm,
            str(SCENE_ASSETS / f'{asset_key}.norm.glb'),
            max_texture_size=1024,
        )
        if meta['bytes'] > 8 * 1024 * 1024:
            raise ValueError(f'{asset_key} 超过 8MB：{meta["bytes"]} bytes')
        print(json.dumps({'assetKey': asset_key, **meta}, ensure_ascii=False))


if __name__ == '__main__':
    main()
