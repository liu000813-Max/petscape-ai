import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BadgeCheck, Camera, Plus, Rotate3D, ShoppingBag } from 'lucide-react';
import { ease } from './data';

export function DetailDrawer({ open, onClose }) {
  return <AnimatePresence>{open && <motion.aside className="detail-drawer" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.45, ease }}><button className="drawer-close" type="button" onClick={onClose} aria-label="关闭详情"><Plus size={15} strokeWidth={2.5} /></button><div className="drawer-kicker">AI 交付链路</div><h2>从可分享视觉，到可玩的宠物角色预览。</h2><p>产品从大众物种入口开始，让用户创建宠物档案、生成 3D 形象、添加付费装扮，再把可打印模块放进真实 3D 场景。</p><div className="drawer-grid"><div><Camera size={18} /><strong>上传宠物</strong><span>照片、物种、体型、档案名</span></div><div><Rotate3D size={18} /><strong>3D 预览</strong><span>游戏角色式旋转查看器</span></div><div><ShoppingBag size={18} /><strong>付费装扮</strong><span>每个穿戴物都有明确价格</span></div><div><BadgeCheck size={18} /><strong>打印模块</strong><span>纯白底标准 SKU 社区</span></div></div></motion.aside>}</AnimatePresence>;
}
