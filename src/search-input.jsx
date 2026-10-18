import React,{useState,useEffect,useRef,useId} from 'react';
import categories from '../server/search-categories.js';
import {searchPlan,normalizeSearch} from '../server/product-search.js';

export default function SearchInput(props){
 const [value,setValue]=useState(props.defaultValue??props.value??''),[open,setOpen]=useState(false),[items,setItems]=useState([]),[busy,setBusy]=useState(false),[active,setActive]=useState(-1),[composing,setComposing]=useState(false);
 const ref=useRef(null),listId=useId(),query=value.trim().slice(0,100);
 useEffect(()=>{setItems([]);setActive(-1);setBusy(false);if(!open||!query||composing)return;
  const plan=searchPlan(query),normalized=normalizeSearch(query);
  const matched=categories.filter(c=>plan.every(g=>g.categoryIds.includes(c.id))).sort((a,b)=>Number(normalizeSearch(b.name)===normalized)-Number(normalizeSearch(a.name)===normalized)||a.name.length-b.name.length).slice(0,3);
  const categoryItems=matched.map(c=>({label:c.name,detail:categories.find(parent=>parent.id===c.id.slice(0,-2))?.name||'',type:'카테고리',href:'#catalog/'+c.id+'/1'}));
  setItems(categoryItems);setBusy(true);const controller=new AbortController();
  const timer=setTimeout(async()=>{try{
   const response=await fetch('/api/cloud/products?page=1&q='+encodeURIComponent(query),{signal:controller.signal});if(!response.ok)throw Error();
   const data=await response.json();if(controller.signal.aborted)return;
   const names=[...new Set((data.products||[]).map(p=>p.name).filter(Boolean))].slice(0,5);
   setItems([...categoryItems,...names.map(name=>({label:name,type:'제품',href:'#catalog/all/1?q='+encodeURIComponent(name)}))]);
  }catch{/* Ordinary search remains usable if suggestions are unavailable. */}finally{if(!controller.signal.aborted)setBusy(false);}},220);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,open,composing]);
 useEffect(()=>{const close=()=>setOpen(false);window.addEventListener('hashchange',close);return()=>window.removeEventListener('hashchange',close);},[]);
 const select=item=>{setOpen(false);setActive(-1);setValue(item.label);location.hash=item.href;};
 const {value:ignored,defaultValue:ignoredDefault,...inputProps}=props;
 return <span className="search-autocomplete" ref={ref} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <input {...inputProps} value={value} maxLength={100} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open&&!!query&&!composing} aria-controls={listId} aria-activedescendant={active>=0?listId+'-'+active:undefined}
   onChange={event=>{setValue(event.target.value);setOpen(true);setActive(-1);}}
   onFocus={()=>setOpen(true)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}
   onKeyDown={event=>{if(event.nativeEvent.isComposing||composing)return;if(event.key==='Escape'){event.preventDefault();setOpen(false);setActive(-1);}else if((event.key==='ArrowDown'||event.key==='ArrowUp')&&items.length){event.preventDefault();setOpen(true);setActive(i=>(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length);}else if(event.key==='Enter'){if(open&&items[active]){event.preventDefault();select(items[active]);}else setOpen(false);}}}/>
  {open&&query&&!composing&&<span className="search-suggestions" id={listId} role="listbox" aria-label="검색 추천">
   {items.map((item,index)=><span key={item.href} id={listId+'-'+index} role="option" aria-selected={index===active} className={'search-suggestion'+(index===active?' is-active':'')} onMouseDown={event=>event.preventDefault()} onClick={()=>select(item)}><small>{item.type}</small><span>{item.label}{item.detail&&<em>{item.detail}</em>}</span><b aria-hidden="true">↗</b></span>)}
   <span className="search-suggestion-status" role="status">{busy?'관련 제품을 찾고 있습니다…':items.length?'↑ ↓ 선택 · Enter 검색':'추천 항목이 없습니다. Enter로 검색해 보세요.'}</span>
  </span>}
 </span>;
}
