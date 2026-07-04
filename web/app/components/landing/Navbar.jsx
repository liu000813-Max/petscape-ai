import React from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { ease } from './data';
import { GridIcon } from './GridIcon';

export function Navbar({ onOpen, onBrowseModules, onLogoClick }) {
  return (
    <motion.header className="navbar" initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.8, ease }}>
      <div className="nav-left">
        <button className="brand-button" type="button" aria-label="PetScape" onClick={onLogoClick}><img className="brand-logo" src="/assets/petscape-logo.png" alt="PetScape" /></button>
        <button className="menu-pill" type="button" onClick={onOpen}><span className="dark-circle light-circle"><Plus size={12} strokeWidth={3} /></span><span>菜单</span></button>
        <div className="tags-pill nav-tags"><span>宠物形象</span><span>标品社区</span></div>
      </div>
      <div className="nav-right"><button className="system-pill" type="button" onClick={onBrowseModules}><span className="dark-circle"><GridIcon /></span><span>白底标品</span></button></div>
    </motion.header>
  );
}
