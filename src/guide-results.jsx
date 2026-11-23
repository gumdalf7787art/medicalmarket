import React,{useEffect,useState} from 'react';
export default function GuideResults({query}){
  const [rows,set]=useState([]);
  useEffect(()=>{
    set([]);
    if(!query)return;
    const controller=new AbortController();
    fetch('/api/guides?q='+encodeURIComponent(query),{signal:controller.signal}).then(r=>r.ok?r.json():{}).then(data=>{if(!controller.signal.aborted)set(data.guides||[]);}).catch(()=>{});
    return ()=>controller.abort();
  },[query]);
  if(!rows.length)return null;
  return <section className="guide-editor"><h2>제품 안내</h2><ul>{rows.slice(0,3).map(g=><li key={g.slug}><a href={'/guide/'+g.slug}>{g.title}</a></li>)}</ul><a href={'/guide?q='+encodeURIComponent(query)}>제품 안내 검색 결과 보기</a></section>;
}
