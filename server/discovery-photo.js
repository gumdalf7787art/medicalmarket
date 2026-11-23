import officialPhotos from './discovery-photos.json' with {type:'json'};

export function discoveryPhoto(product) {
  if (!product.id?.startsWith('discovered-') || product.image) return product;
  const image=product.gallery?.[0] || officialPhotos[product.maker]?.[product.model];
  return typeof image==='string' ? {...product,image,gallery:[...new Set([image,...(product.gallery||[])])]} : product;
}
