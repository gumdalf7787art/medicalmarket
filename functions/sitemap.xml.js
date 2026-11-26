import {initialize, origin} from '../server/guides.js';

export async function onRequestGet({env}) {
  const db = env.DB;
  await initialize(db);
  const [products, guides] = await db.batch([
    db.prepare('SELECT id FROM mm_products WHERE published = 1 AND deleted = 0 ORDER BY id'),
    db.prepare(`
      SELECT g.slug FROM mm_guides g JOIN mm_products p ON p.id = g.product_id
      WHERE g.published = 1 AND p.published = 1 AND p.deleted = 0
      ORDER BY g.slug
    `)
  ]);

  const paths = [
    '/',
    '/guide',
    ...products.results.map(({id}) => '/product?id=' + encodeURIComponent('managed-' + id)),
    ...guides.results.map(({slug}) => '/guide/' + encodeURIComponent(slug))
  ];
  const urls = paths.map(path => '<url><loc>' + origin + path + '</loc></url>');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.join('') + '</urlset>';
  return new Response(xml, {headers: {'Content-Type': 'application/xml; charset=utf-8'}});
}
