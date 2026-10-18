import React, { useLayoutEffect, useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import parse, { attributesToProps, domToReact } from 'html-react-parser';

let root;
let revision = 0;

export function SiteHeader({ route, favorites, authUser }) {
  return <header className="site-header">
    <a href="#home" className="brand brand-logo" aria-label="메디컬마켓 홈"><img src="/assets/brand/medicalmarket-logo.png" alt="메디컬마켓 MEDICAL MARKET" width="2146" height="733" fetchPriority="high"/></a>
    <form id="header-search" className="header-search" role="search">
      <input name="query" aria-label="제품 검색" placeholder="어떤 의료장비를 찾으세요?" maxLength={100}/>
      <button type="submit" aria-label="제품 검색 실행"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>
    </form>
    <div className="member-header">{authUser?.role==='admin'?<a href="#ops" className="ops-link">운영 화면 ↗</a>:null}<a href={authUser?"#account":"#auth/login"}>{authUser?"마이페이지":"로그인"}</a>{!authUser?<a href="#auth/signup">회원가입</a>:null}</div>
  </header>;
}

export function AdminLayout({ page, menus, newRequests, replyCount, children }) {
  const current=page.split('-')[0];
  const title=menus.flatMap(g=>g[1]).find(m=>m[0]===current)?.[1]||'견적 업무';
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="#ops">메디컬마켓<small>OPERATIONS</small></a>
      <details className="admin-navigation" open><summary>운영 메뉴</summary>
        <nav aria-label="운영 관리 메뉴">{menus.map(([group,items])=><div className="admin-menu-group" key={group}>
          <p>{group}</p>{items.map(([key,label,icon])=><a key={key} href={'#ops'+(key==='dashboard'?'':'/'+key)}
            className={current===key?'selected':''} aria-current={current===key?'page':undefined}>
            <span aria-hidden="true">{icon}</span>{label}{key==='requests'&&newRequests>0?<b>{newRequests}</b>:key==='replies'&&replyCount>0?<b aria-label={'확인할 새 회신 '+replyCount+'건'}>{replyCount}</b>:null}
          </a>)}
        </div>)}</nav>
      </details>
      <div className="admin-sidebar-foot"><span className="admin-dot"/> 운영 관리<small>지정된 운영자 전용</small><a href="#home">고객 홈페이지 ↗</a></div>
    </aside>
    <div className="admin-main">
      <div className="admin-topbar"><span>운영 관리 <i>/</i> {title}</span><div><a href="#ops/requests">요청 검색</a><a href="#home">고객 화면 ↗</a><span className="admin-avatar">M</span></div></div>
      <div className="admin-content">{children}</div>
    </div>
  </div>;
}

// Contenteditable selection, execCommand undo, and the existing focused-region
// updates must never compete with React's reconciliation. Only these bounded
// regions retain DOM ownership. The surrounding page is a React element tree.
const mutableIds=new Set(['product-rich-editor','editor-gallery','market-banner','collection-results','category-flyout','auto-quote-preview']);
function DomRegion({ tag:Tag, props, html }) {
  const ref=useRef(null);
  useLayoutEffect(()=>{ref.current.innerHTML=html;},[html]);
  return <Tag {...props} ref={ref} suppressContentEditableWarning />;
}
function DeferredImage({props}) {
  const ref=useRef(null),[ready,setReady]=useState(false),[loaded,setLoaded]=useState(false);
  useEffect(()=>{if(!('IntersectionObserver' in window)){setReady(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setReady(true);observer.disconnect();}},{rootMargin:'800px 0px'});observer.observe(ref.current);return ()=>observer.disconnect();},[]);
  return <img {...props} ref={ref} src={ready?props.src:undefined} decoding="async" onLoad={()=>setLoaded(true)} style={{...props.style,...(!loaded&&!props.height?{minHeight:'160px'}:{})}}/>;
}
function TemplateContent({ html }) {
  const options={replace(node) {
    if(!node.attribs) return;
    const props=attributesToProps(node.attribs);
    if(node.name==='img'&&node.attribs.loading==='lazy')return <DeferredImage props={props}/>;
    if(node.name==='script') return <></>;
    // React select uses defaultValue on the select rather than selected options.
    if(node.name==='select') {
      const selected=[];
      const visit=children=>children?.forEach(n=>{if(n.name==='option'&&'selected' in (n.attribs||{}))selected.push(n.attribs.value??n.children?.map(x=>x.data||'').join(''));visit(n.children);});
      visit(node.children);
      if(selected.length) props.defaultValue=props.multiple?selected:selected[0];
      return React.createElement('select',props,domToReact(node.children,options));
    }
    if(node.name==='option'&&'selected' in props) {
      delete props.selected;
      return React.createElement('option',props,domToReact(node.children,options));
    }
    if(mutableIds.has(node.attribs.id)||(node.attribs.class||'').split(' ').includes('quote')) {
      // domutils serialization keeps table, SVG, whitespace and editor markup.
      return <DomRegion tag={node.name} props={props} html={innerMarkup(node)} />;
    }
  }};
  return <>{parse(html,options)}</>;
}

// html-react-parser exports DOM nodes with an outer serializer through domhandler
// compatible structures. Keep serialization explicit rather than DOM reparsing.
function innerMarkup(node) { return (node.children||[]).map(markup).join(''); }
function markup(node) {
  if(node.type==='text')return node.data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if(node.type==='comment')return '<!--'+node.data+'-->';
  const attrs=Object.entries(node.attribs||{}).map(([k,v])=>' '+k+'="'+v.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"').join('');
  const open='<'+node.name+attrs+'>';
  return /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(node.name)?open:open+innerMarkup(node)+'</'+node.name+'>';
}

export function CustomerPage({ content }) { return <TemplateContent html={content}/>; }
export function OperationsPage({ content }) { return <TemplateContent html={content}/>; }

function Application(props) {
  // Background product/session updates must not remount the home hero and
  // restart its entrance animation. Form-heavy routes retain their reset key.
  const pageKey=props.route==='home'||props.route.startsWith('home-')?'home':props.revision;
  return <>
    <SiteHeader route={props.route} favorites={props.favorites} authUser={props.authUser}/>
    <main id="app"><div key={pageKey} style={{display:'contents'}} data-react-page={props.route}>
      {props.isAdmin?<AdminLayout page={props.adminPage} menus={props.menus} newRequests={props.newRequests} replyCount={props.replyCount}>
        <OperationsPage content={props.content}/>
      </AdminLayout>:<CustomerPage content={props.content}/>}
    </div></main>
    <div id="toast" role="status" aria-live="polite"/>
    <footer className="company-footer">
      <div className="footer-grid">
        <div className="footer-brand"><a href="#home">메디컬마켓<small>MEDICAL MARKET</small></a><p>다양한 의료장비를 살펴보고,<br/>간편하게 견적을 요청하세요.</p></div>
        <nav aria-label="하단 이용 메뉴"><h3>이용 안내</h3><a href="#catalog">제품 검색</a><a href="#account">마이페이지</a><a href="#home-process">견적 요청 안내</a><a href="/privacy.html">개인정보처리방침</a></nav>
        <div className="footer-contact"><h3>문의 안내</h3><a href="tel:0234724177" className="footer-phone">02-3472-4177</a><a href="mailto:gumdalf7787@gmail.com">gumdalf7787@gmail.com</a><p>Fax · 02-585-3083</p></div>
      </div>
      <div className="footer-company"><strong>메디컬마켓 · (주)피지오컴퍼니</strong><p>대표: 최영호 <span>사업자등록번호: 736-81-01238</span><br/>주소: 서울특별시 송파구 마천로 30, 상가에이동 127·128호(방이동)</p><small>© {new Date().getFullYear()} 메디컬마켓 · (주)피지오컴퍼니. All rights reserved.</small></div>
    </footer>
  </>;
}

export function renderApplication(props) {
  root??=createRoot(document.getElementById('medicalmarket-root'));
  // Existing handlers query a newly rendered form immediately after render().
  // Synchronous commit preserves that contract and prevents lost form selections.
  flushSync(()=>root.render(<Application {...props} revision={++revision}/>));
}
