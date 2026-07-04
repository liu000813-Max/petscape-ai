import React from 'react';
import { ChevronRight } from 'lucide-react';
import { flowSteps } from './data';

export function OrderFlowSection() {
  return <section className="order-section"><div className="section-copy"><span>订单闭环</span><h2>从免费效果图开始，到真实打印产品送到家。</h2></div><div className="flow-row">{flowSteps.map((step, index) => <div className="flow-step" key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong>{index < flowSteps.length - 1 && <ChevronRight size={18} />}</div>)}</div></section>;
}
