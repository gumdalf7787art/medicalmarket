import {origin} from '../server/guides.js';
export function onRequestGet(){
  return new Response('User-agent: *\nDisallow: /api/\nSitemap: '+origin+'/sitemap.xml\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
}
