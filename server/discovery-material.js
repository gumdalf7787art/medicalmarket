import {failure} from './cloud.js';

export function reviewMaterial(data) {
  const {gallery, paragraphs} = data;
  if (!Array.isArray(gallery) || !gallery.length || gallery.length > 160 ||
      gallery.some(path => typeof path !== 'string' || !/^\/media\/[a-f0-9-]{36}\.webp$/.test(path))) {
    throw failure('저장된 제품 사진을 확인해 주세요.');
  }
  if (!Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > 200 ||
      paragraphs.some(text => typeof text !== 'string' || !text.trim() || /https?:\/\//i.test(text)) ||
      paragraphs.join('').length > 45000) throw failure('검토한 상세 설명을 입력해 주세요.');
  const escape = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const figures = Array.isArray(data.figures) ? data.figures : [];
  const descriptionHtml=paragraphs.map((p,i)=>{
    const n=figures[i];
    const image=Number.isInteger(n) && n>=0 && n<gallery.length ? '<figure><img loading="lazy" src="'+gallery[n]+'" alt="제품 상세 사진"></figure>' : '';
    return '<p>'+escape(p.trim())+'</p>'+image;
  }).join('');
  return {image:gallery[0],gallery:[...new Set(gallery)],descriptionHtml};
}

export async function saveMaterial(env,data) {
  const material=reviewMaterial(data);
  for (const path of material.gallery) {
    if (!await env.MEDIA.head('product-images/'+path.slice(7))) throw failure('사진 업로드를 먼저 완료해 주세요.',422);
  }
  const version=crypto.randomUUID();
  const result=await env.DB.prepare(`INSERT INTO mm_discovery_material(supplier_id,identity,payload,version)
    SELECT supplier_id,identity,?,? FROM mm_discovery WHERE supplier_id=? AND identity=? AND decision=''
    ON CONFLICT(supplier_id,identity) DO UPDATE SET payload=excluded.payload,version=excluded.version`)
    .bind(JSON.stringify(material),version,data.supplier,data.identity).run();
  if (!result.meta.changes) throw failure('미처리 초안을 확인해 주세요.',409);
  return {version};
}
