import React from 'react';

export function ProductRender({ module }) {
  if (module.image) {
    return (
      <div className="product-render has-image" aria-label={`${module.title} 白底商品图`}>
        <img className="product-image" src={module.image} alt={`${module.title} 白底商品图`} />
        <em>白底商品图 / 1:1</em>
      </div>
    );
  }

  return (
    <div className="product-render" aria-label={`${module.title} 白底商品图`}>
      <div className={`print-object ${module.shape}`}>
        <span className="hole h1" /><span className="hole h2" /><span className="hole h3" />
      </div>
      <span className="product-shadow" />
      <em>白底商品图 / 1:1</em>
    </div>
  );
}
