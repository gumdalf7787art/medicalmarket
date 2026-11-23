import {failure} from './cloud.js';

export const sources = {
  inbody: {maker:'인바디', url:'https://inbody.com/kr/ko/products/category/body-composition'},
  alpinion: {maker:'알피니언메디칼시스템', url:'https://www.alpinion.com/kr/product/product_intro.do', mirror:'https://www.alpinion.co.kr/kr/product/product_list_ultra.do'},
  bistos0340: {maker:'비스토스', url:'https://www.bistos.co.kr/products/'}
};

// Model names transcribed from the official lists on 2026-11-23.
// The list itself is the primary source when a stable detail link is unavailable.
export const pilot = {
  "bistos0340": [
    {
      "model": "BT-350",
      "url": "https://www.bistos.co.kr/fetal-monitor-bt-350/"
    },
    {
      "model": "BT-200L"
    },
    {
      "model": "BT-770",
      "url": "https://www.bistos.co.kr/patient-monitor-model-bt-780-bt-770-bt-740/"
    },
    {
      "model": "BT-400",
      "url": "https://www.bistos.co.kr/neonatal-phototherapy-unit-model-bt-400/"
    },
    {
      "model": "BT-500",
      "url": "https://www.bistos.co.kr/infant-incubator-model-bt-500/"
    },
    {
      "model": "BT-550",
      "url": "https://www.bistos.co.kr/infant-warmer-model-bt-550/"
    },
    {
      "model": "BT-100",
      "url": "https://www.bistos.co.kr/electric-breast-pump-model-bt-100/"
    },
    {
      "model": "BT-36"
    },
    {
      "model": "BT-410",
      "url": "https://www.bistos.co.kr/head-worn-light-model-bt-410/"
    },
    {
      "model": "BT-800",
      "url": "https://www.bistos.co.kr/hybrid-cr-bt-800/"
    },
    {
      "model": "BT-1000"
    }
  ],
  "inbody": [
    {
      "model": "InBody970S",
      "url": "https://inbody.com/products/category/body-composition/6"
    },
    {
      "model": "InBody770S",
      "url": "https://inbody.com/products/category/body-composition/5"
    },
    {
      "model": "InBody580",
      "url": "https://inbody.com/products/category/body-composition/4"
    },
    {
      "model": "InBody380",
      "url": "https://inbody.com/products/category/body-composition/3"
    },
    {
      "model": "InBody280",
      "url": "https://inbody.com/products/category/body-composition/85"
    },
    {
      "model": "InBody270S",
      "url": "https://inbody.com/products/category/body-composition/2"
    },
    {
      "model": "InBody J50",
      "url": "https://inbody.com/products/category/body-composition/1"
    }
  ],
  "alpinion": [
    {
      "model": "X-CUBE 90 with Elite",
      "url": "https://www.alpinion.com/en/product/product_view_xc90.do?productKey=KEY.0412156059000003202"
    },
    {
      "model": "X-CUBE 70 with Elite",
      "url": "https://www.alpinion.com/en/product/product_view_xc70.do?productKey=KEY.0412156059000003203"
    },
    {
      "model": "X-CUBE 60",
      "url": "https://www.alpinion.com/en/product/product_view_xc60.do?productKey=KEY.1665842613000021659"
    },
    {
      "model": "X-CUBE 50",
      "url": "https://www.alpinion.com/en/product/product_view_xc50.do?productKey=KEY.1716454476000000474"
    },
    {
      "model": "X-CUBE i9",
      "url": "https://www.alpinion.com/en/product/product_view_xci9.do?productKey=KEY.1688010261000007042"
    },
    {
      "model": "X-CUBE i8",
      "url": "https://www.alpinion.com/en/product/product_view_xci8.do?productKey=KEY.1702733072000077335"
    },
    {
      "model": "E-CUBE 8 Diamond",
      "url": "https://www.alpinion.com/en/product/product_view_ec8d.do?productKey=KEY.1505083248000000083"
    },
    {
      "model": "E-CUBE 8",
      "url": "https://www.alpinion.com/en/product/product_view_ec8.do?productKey=KEY.1505083248000000097"
    },
    {
      "model": "E-CUBE 8LE",
      "url": "https://www.alpinion.com/en/product/product_view_ec8le.do?productKey=KEY.1505083248000000126"
    },
    {
      "model": "minisono",
      "url": "https://www.alpinion.com/en/product/product_view_minisono.do?productKey=KEY.1606967910000000200"
    },
    {
      "model": "ALPIUS 900"
    },
    {
      "model": "VIFU 2000"
    }
  ]
};

export const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s‐‑–—_-]/g,'');

export function modelFromLink(key, url, label) {
  const path = url.pathname;
  const title = label.replace(/\s+/g,' ').trim();
  if (key === 'inbody' && /\/products\/category\/body-composition\/\d+\/?$/.test(path))
    return title.match(/^InBody\s*(?:J\s*)?\d+[A-Za-z]*(?!\w)/i)?.[0];
  if (key === 'alpinion' && /\/product\/product_view_[\w]+\.do$/.test(path))
    return title.match(/^(?:[EX]-CUBE\s+[\w]+(?:\s+(?:with Elite|Diamond))?|minisono|(?:ALPIUS|VIFU)\s+\d+)$/i)?.[0];
  if (key === 'bistos0340')
    return title.match(/^(?:Model\s*:\s*|More Info\s+)(BT[- ]\d+[A-Z]*)$/i)?.[1];
}

export async function collect(key, mirror=false) {
  let sourceUrl = mirror ? sources[key].mirror : sources[key].url;
  if (!sourceUrl) throw failure('공식 목록 주소를 확인해 주세요.');
  const hosts = new Set([sources[key].url,sources[key].mirror].filter(Boolean).map(value=>new URL(value).hostname.replace(/^www\./,'')));
  const trusted = url=>url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&hosts.has(url.hostname.replace(/^www\./,''));
  let response;
  for(let hop=0;hop<4;hop++){
    try { response = await fetch(sourceUrl,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'text/html','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7'}}); }
    catch { throw failure('공식 사이트 연결 시간 초과 또는 접속 제한',422); }
    if(![301,302,303,307,308].includes(response.status))break;
    const next=new URL(response.headers.get('location')||'',sourceUrl);
    if(!trusted(next))throw failure('공식 목록 이동 주소를 확인해 주세요.',422);
    sourceUrl=next.href;
  }
  if (!response.ok) throw failure('공식 사이트가 HTTP '+response.status+'로 응답했습니다.',422);
  const found = new Map();
  let current;
  const anchors = {
    element(el) {
      current = null;
      let url;
      try { url = new URL(el.getAttribute('href'),sourceUrl); } catch { return; }
      if (!trusted(url)) return;
      const anchor = {url,text:''};
      current = anchor;
      el.onEndTag(()=>{
        const model = modelFromLink(key,url,anchor.text);
        if (model) found.set(compact(model),{model,url:url.href});
        current = null;
      });
    },
    text(chunk) { if (current && current.text.length < 1000) current.text += chunk.text; }
  };
  await new HTMLRewriter().on('a[href]',anchors).transform(response).arrayBuffer();
  if (!found.size) throw failure('공식 페이지에서 모델 링크를 찾지 못했습니다.',422);
  return [...found.values()];
}
