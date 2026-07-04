import React from 'react';
import { Camera, Upload, WandSparkles } from 'lucide-react';
import { AssetPlaceholder } from './AssetPlaceholder';

export function UploadVibeSection() {
  return <section className="builder-section"><div className="builder-left"><span className="eyebrow">上传与 Vibe 描述</span><h2>上传真实环境，再描述你想要的宠物小家。</h2><p>当前 demo 保留上传位、生成路径和订单交接逻辑，后续可连接生图模型、混元 3D 和生产报价。</p><div className="prompt-box"><WandSparkles size={18} /><span>森林奶酪屋，童话厨房氛围，适合花枝鼠钻洞、觅食和攀爬。</span><button type="button">生成</button></div></div><div className="upload-grid"><AssetPlaceholder title="当前笼箱照片" ratio="4:3" icon={Upload} /><AssetPlaceholder title="宠物照片" ratio="1:1" icon={Camera} /></div></section>;
}
