import {initialize,origin} from '../server/guides.js';
export async function onRequestGet({env}){
  await initialize(env.DB);
  const {results}=await env.DB.prepare('SELECT g.slug,g.updated FROM mm_guides g JOIN mm_products p ON p.id=g.product_id WHERE g.published=1 AND p.published=1 AND p.deleted=0').all();
  const entries=['','/guide',...results.map(r=>'/guide/'+r.slug)];
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries.map(path=>'<url><loc>'+origin+path+'</loc></url>').join('')+'</urlset>',{headers:{'Content-Type':'application/xml; charset=utf-8'}});
}
