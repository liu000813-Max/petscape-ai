import React from 'react';
import { motion } from 'motion/react';
import { ease } from './data';

export function HeroFooter({ onOpen, onBrowseModules }) {
  return (
    <motion.footer className="hero-footer" initial={false} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5, duration: 1, ease }}>
      <div className="footer-left">
        <motion.div className="subtitle" initial={false} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, duration: 0.8, ease }}><span className="subtitle-dot" /><span>每一个洞口都是房间，每一层都是故事。</span></motion.div>
        <motion.h1 initial={false} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8, duration: 0.8, ease }}>为爱宠定制，<br />把想象打印成家。</motion.h1>
        <motion.div className="cta-row" initial={false} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1, duration: 0.8, ease }}><button className="cta-button primary" type="button" onClick={onOpen}>开始定制</button><button className="cta-button secondary" type="button" onClick={onBrowseModules}>浏览标品</button></motion.div>
      </div>
      <div className="footer-right"><span>宠物档案</span><span>爱宠装扮</span><span>3D 预览</span></div>
    </motion.footer>
  );
}
