import React from 'react';
import { Image } from 'lucide-react';

export function AssetPlaceholder({ title, ratio, icon: Icon = Image, tone = 'light' }) {
  return <div className={`asset-placeholder ${tone}`}><Icon size={22} strokeWidth={1.6} /><strong>{title}</strong><span>{ratio}</span></div>;
}
