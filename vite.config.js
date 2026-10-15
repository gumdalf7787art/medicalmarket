import { defineConfig } from 'vite';
import { readFileSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import domainFiles from './scripts/domain-files.json' with { type: 'json' };
const localEdition=existsSync('scripts/local-mode.json');
const entryHtml='<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>메디컬마켓</title></head><body><div id="medicalmarket-root"></div><script type="module" src="/src/main.jsx"></script></body></html>';

// This adapter preserves the proven workflow handlers and storage schema while
// React owns the route tree. Source files remain readable, independently editable.
function medicalMarketDomain() {
  return {
    name: 'medicalmarket-domain',
    resolveId(id) { if (id === 'virtual:medicalmarket-domain') return '\0' + id; },
    load(id) {
      if (id !== '\0virtual:medicalmarket-domain') return;
      let code = domainFiles.map(file => {
        this.addWatchFile(resolve(file));
        return `\n// ---- ${file} ----\n` + readFileSync(resolve(file), 'utf8');
      }).join('\n');
      const start = code.indexOf('function render(){');
      const end = code.indexOf("\ndocument.addEventListener('click',ev=>{const b=ev.target.closest('button')", start);
      if (start < 0 || end < 0) throw new Error('Route adapter no longer matches app.js; review the migration boundary.');
      code = code.slice(0,start) + `
function render(){
  const [route,id]=(location.hash.slice(1)||(['/product','/product.html'].includes(location.pathname)?'product/'+(new URLSearchParams(location.search).get('id')||''):'home')).split('/');
  const views={home,'home-process':home,'home-categories':home,catalog,product:()=>detail(id),request,favorites,mine,ops:()=>adminPage(id),track:()=>track(id),work:()=>work(id),quote:()=>quote(id)};
  const isAdmin=['ops','work','quote'].includes(route);
  document.title=route==='product'&&product(id)?product(id).name+' | 메디컬마켓':'메디컬마켓 시즌2';
  document.body.classList.toggle('is-browse',['catalog','favorites','product','request','mine','track'].includes(route));
  document.body.classList.toggle('is-home',route==='home'||route.startsWith('home-'));
  document.body.classList.toggle('is-admin',isAdmin);
  const content=cloudMode&&!cloudReady?'<section class="admin-panel">제품 정보를 불러오는 중입니다.</section>':(views[route]||missing)();
  renderApplication({route,id,isAdmin,content:(cloudMode&&cloudError?'<p role="alert" class="notice warn">'+e(cloudError)+'</p>':'')+content,favorites:state.favorites.length,
    menus:adminMenus,newRequests:adminCount(0),
    adminPage:route==='ops'?(id||'dashboard'):route==='quote'?'quotes':'requests'});
  if(isAdmin&&window.innerWidth<750)document.querySelector('.admin-navigation').open=false;
  const tree=document.querySelector('.catalog-tree');if(tree)tree.scrollTop=categoryTreeScroll;
  if(route.startsWith('home-'))requestAnimationFrame(()=>document.getElementById(route)?.scrollIntoView({block:'start'}));
}
` + code.slice(end);
      return "import { renderApplication } from '/src/ui.jsx';\n" + code;
    },
  };
}

export default defineConfig({
  plugins: [medicalMarketDomain(), {
    name:'medicalmarket-static-files',
    transformIndexHtml: {order:'pre',handler:()=>entryHtml},
    closeBundle() {
      // Allowlisted runtime files only. Never publish Python, SQL, private mail,
      // credentials, tests, or the original business directory in dist.
      for (const name of localEdition?[]:['assets','supplier-email.html','sample-suppliers.json']) {
        if(existsSync(name)) cpSync(name,resolve('dist',name),{recursive:true});
      }
    },
  }],
  base:'./',
  publicDir:false,
  server:{port:5173,strictPort:true,proxy:localEdition?{'/api':{target:'http://127.0.0.1:8767',changeOrigin:true,headers:{Origin:'http://127.0.0.1:8767','Sec-Fetch-Site':'same-origin'}}}:undefined},
  build:{assetsDir:'_react',rollupOptions:{input:{index:resolve('index.html'),product:resolve('product.html')}}},
});
