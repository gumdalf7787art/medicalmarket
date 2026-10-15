import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import parse, { attributesToProps, domToReact } from 'html-react-parser';

let root;
let revision = 0;

export function SiteHeader({ route, favorites }) {
  return <header>
    <a href="#home" className="brand"><span>메디컬마켓<small>MEDICAL MARKET</small></span></a>
    <nav aria-label="주 메뉴">
      <a className={route==='home'?'active':''} href="#home">홈</a>
      <a className={route==='catalog'?'active':''} href="#catalog">제품 탐색</a>
      <a className={route==='favorites'?'active':''} href="#favorites">관심제품 <span id="favorite-count">{favorites}</span></a>
      <a className={route==='mine'?'active':''} href="#mine">요청 목록 보기</a>
    </nav>
    <a href="#ops" className="ops-link">운영 화면 ↗</a>
  </header>;
}

export function AdminLayout({ page, menus, newRequests, children }) {
  const current=page.split('-')[0];
  const title=menus.flatMap(g=>g[1]).find(m=>m[0]===current)?.[1]||'견적 업무';
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="#ops">메디컬마켓<small>OPERATIONS</small></a>
      <details className="admin-navigation" open><summary>운영 메뉴</summary>
        <nav aria-label="운영 관리 메뉴">{menus.map(([group,items])=><div className="admin-menu-group" key={group}>
          <p>{group}</p>{items.map(([key,label,icon])=><a key={key} href={'#ops'+(key==='dashboard'?'':'/'+key)}
            className={current===key?'selected':''} aria-current={current===key?'page':undefined}>
            <span aria-hidden="true">{icon}</span>{label}{key==='requests'&&newRequests>0?<b>{newRequests}</b>:null}
          </a>)}
        </div>)}</nav>
      </details>
      <div className="admin-sidebar-foot"><span className="admin-dot"/> 로컬 운영 화면<small>로그인·운영 DB 연결 전</small><a href="#home">고객 홈페이지 ↗</a></div>
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
function TemplateContent({ html }) {
  const options={replace(node) {
    if(!node.attribs) return;
    const props=attributesToProps(node.attribs);
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
  return <>
    <SiteHeader route={props.route} favorites={props.favorites}/>
    <main id="app"><div key={props.revision} style={{display:'contents'}} data-react-page={props.route}>
      {props.isAdmin?<AdminLayout page={props.adminPage} menus={props.menus} newRequests={props.newRequests}>
        <OperationsPage content={props.content}/>
      </AdminLayout>:<CustomerPage content={props.content}/>}
    </div></main>
    <div id="toast" role="status" aria-live="polite"/>
    <footer>MEDICAL MARKET SEASON 2 <span>단계 1 · 고객과 운영자의 업무 흐름 확인</span></footer>
  </>;
}

export function renderApplication(props) {
  root??=createRoot(document.getElementById('medicalmarket-root'));
  // Existing handlers query a newly rendered form immediately after render().
  // Synchronous commit preserves that contract and prevents lost form selections.
  flushSync(()=>root.render(<Application {...props} revision={++revision}/>));
}
