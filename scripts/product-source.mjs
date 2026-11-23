import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

const {html,url,selector,model}=JSON.parse(readFileSync(0,'utf8'));
const doc=new JSDOM(html,{url}).window.document;
doc.querySelectorAll('script,style,nav,header,footer,noscript,[role=navigation]').forEach(node=>node.remove());
const root=(selector && doc.querySelector(selector)) || (!selector && (doc.querySelector('main,article,[role=main]') || doc.body));
if (!root) throw Error('Product content selector did not match.');
const normalize=text=>text.replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
if (!normalize(doc.title+' '+root.textContent).includes(normalize(model))) throw Error('Model missing from source page.');
const paragraphs=[...new Set(Array.from(root.querySelectorAll('h1,h2,h3,h4,p,li,tr,dt,dd'),node=>
  (node.matches('tr') ? Array.from(node.cells,c=>c.textContent.trim()).join(' · ') : node.textContent).replace(/\s+/g,' ').trim()).filter(Boolean))];
const images=new Set();
function add(raw) {
  if (!raw) return;
  try { const address=new URL(raw,url); if(address.protocol==='https:') images.add(address.href); } catch {}
}
for(const node of root.querySelectorAll('img,picture source,[style*="url("]')) {
  const candidates=(node.getAttribute('data-srcset')||node.getAttribute('srcset')||'').split(',').map(s=>s.trim().split(/\s+/)).filter(a=>a[0]);
  candidates.sort((a,b)=>(parseFloat(b[1])||1)-(parseFloat(a[1])||1));
  add(node.getAttribute('data-original')||node.getAttribute('data-src')||candidates[0]?.[0]||node.getAttribute('src'));
  for(const match of (node.getAttribute('style')||'').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(match[1]);
}
process.stdout.write(JSON.stringify({paragraphs,images:[...images].map(url=>({url}))}));
