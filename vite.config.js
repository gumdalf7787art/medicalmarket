import { defineConfig } from 'vite';
import { readFileSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import domainFiles from './scripts/domain-files.json' with { type: 'json' };
const localEdition=existsSync('scripts/local-mode.json');
const entryHtml='<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>메디컬마켓</title><meta name="description" content="의료기기 견적요청 플랫폼. 다양한 의료장비를 살펴보고 간편하게 견적을 요청하세요."><meta property="og:type" content="website"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="메디컬마켓"><meta property="og:title" content="메디컬마켓 | 의료기기 견적요청 플랫폼"><meta property="og:description" content="다양한 의료장비를 살펴보고 간편하게 견적을 요청하세요."><meta property="og:url" content="https://medicalmarket.pages.dev/"><meta property="og:image" content="https://medicalmarket.pages.dev/assets/brand/medicalmarket-share.png"><meta property="og:image:secure_url" content="https://medicalmarket.pages.dev/assets/brand/medicalmarket-share.png"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1733"><meta property="og:image:height" content="907"><meta property="og:image:alt" content="의료기기 견적요청 플랫폼 메디컬마켓"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="메디컬마켓 | 의료기기 견적요청 플랫폼"><meta name="twitter:description" content="다양한 의료장비를 살펴보고 간편하게 견적을 요청하세요."><meta name="twitter:image" content="https://medicalmarket.pages.dev/assets/brand/medicalmarket-share.png"><link rel="icon" type="image/png" href="/assets/brand/medicalmarket-icon.png"><link rel="apple-touch-icon" href="/assets/brand/medicalmarket-icon.png"></head><body><div id="medicalmarket-root"></div><script type="module" src="/src/main.jsx"></script></body></html>';

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
  const views={auth:()=>authPage(id),account:()=>memberPage(id||'home'),home,'home-process':home,'home-categories':home,catalog,product:()=>detail(id),request,favorites:()=>cloudMode?memberPage('favorites'):favorites(),mine:()=>cloudMode?memberPage('requests'):mine(),ops:()=>adminPage(id),track:()=>cloudMode?memberPage('detail?id='+id):track(id),work:()=>cloudMode?cloudAdminRequests('requests?id='+encodeURIComponent(id)):work(id),quote:()=>cloudMode?cloudAdminRequests('requests?id='+encodeURIComponent(id)):quote(id)};
  const isAdmin=['ops','work','quote'].includes(route);
  document.title=route==='product'&&product(id)?product(id).name+' | 메디컬마켓':'메디컬마켓 시즌2';
  document.body.classList.toggle('is-browse',['catalog','favorites','product','request','mine','track'].includes(route));
  document.body.classList.toggle('is-member',!!authUser&&(['account'].includes(route)||cloudMode&&['favorites','mine','track'].includes(route)));
  document.body.classList.toggle('is-home',route==='home'||route.startsWith('home-'));
  document.body.classList.toggle('is-admin',isAdmin&&(!cloudMode||cloudAuthenticated));
  const homeRoute=route==='home'||route.startsWith('home-');
  const gated=isAdmin&&cloudMode&&!cloudAuthenticated;
  const content=gated?authGate():cloudMode&&!cloudReady&&!homeRoute?'<section class="page-skeleton" aria-label="화면 준비 중"><div></div><div></div></section>':(views[route]||missing)();
  renderApplication({route,id,isAdmin:isAdmin&&!gated,authUser,content:(cloudMode&&cloudError?'<p role="alert" class="notice warn">'+e(cloudError)+'</p>':'')+(isAdmin&&cloudMode&&(id==='dashboard'||!id)?cloudReplyDashboardNotice():'')+content,favorites:state.favorites.length,
    menus:adminMenus,newRequests:adminCount(0),replyCount:cloudMode?cloudReplyUnread:0,
    adminPage:route==='ops'?(id||'dashboard'):route==='quote'?'quotes':'requests'});
  if(isAdmin&&!gated&&window.innerWidth<750)document.querySelector('.admin-navigation').open=false;
  if(isAdmin&&!gated&&cloudMode)cloudReplyEnsureWatch();
  const tree=document.querySelector('.catalog-tree');if(tree)tree.scrollTop=categoryTreeScroll;
  if(route.startsWith('home-'))requestAnimationFrame(()=>document.getElementById(route)?.scrollIntoView({block:'start'}));
}
` + code.slice(end);
      return "import { matchesProductSearch, productSearchRank, highlightProductSearch } from '/server/product-search.js';\nimport { renderApplication } from '/src/ui.jsx';\nimport { readQuoteAttachment, makeQuotePdf } from '/src/quote-tools.js';\nimport { renderCustomerQuoteEmail, customerEmailSubject } from '/server/customer-quote.js';\n" + code;
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
      for (const name of localEdition?[]:['assets','supplier-email.html','sample-suppliers.json','privacy.html']) {
        if(existsSync(name)) cpSync(name,resolve('dist',name),{recursive:true});
      }
    },
  }],
  base:'./',
  publicDir:false,
  server:{port:5173,strictPort:true,proxy:localEdition?{'/api':{target:'http://127.0.0.1:8767',changeOrigin:true,headers:{Origin:'http://127.0.0.1:8767','Sec-Fetch-Site':'same-origin'}}}:undefined},
  build:{assetsDir:'_react',rollupOptions:{input:{index:resolve('index.html'),product:resolve('product.html')}}},
});
