export async function readQuoteAttachment(file){
 const name=file.name||'',ext=name.split('.').pop().toLowerCase();
 if(file.size>8*1024*1024)throw Error('8MB 초과 파일은 Gmail에서 직접 확인해 주세요.');
 const bytes=await file.arrayBuffer();
 if(['txt','csv','tsv'].includes(ext))return new TextDecoder('utf-8').decode(bytes).slice(0,100000);
 if(ext==='pdf'){
  const pdfjs=await import('pdfjs-dist/build/pdf.mjs');
  const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const document=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
  let out='';for(let n=1;n<=Math.min(document.numPages,20);n++){const page=await document.getPage(n),content=await page.getTextContent();out+='\n'+content.items.map(item=>item.str||'').join(' ');if(out.length>100000)break;}
  await document.destroy();if(!out.trim())throw Error('스캔 PDF라 글자를 추출할 수 없습니다. 첨부파일을 직접 확인해 주세요.');return out.slice(0,100000);
 }
 if(ext==='xlsx'||ext==='docx'){
  const JSZip=(await import('jszip')).default,zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  if(ext==='docx'){
   const item=zip.file('word/document.xml');if(!item||item._data.uncompressedSize>2*1024*1024)throw Error('문서 내용을 읽을 수 없습니다.');
   const xml=new DOMParser().parseFromString(await item.async('string'),'application/xml');return [...xml.getElementsByTagName('w:p')].map(p=>p.textContent).join('\n').slice(0,100000);
  }
  const strings=[];const shared=zip.file('xl/sharedStrings.xml');if(shared){if(shared._data.uncompressedSize>2*1024*1024)throw Error('엑셀 내용이 너무 큽니다.');const xml=new DOMParser().parseFromString(await shared.async('string'),'application/xml');for(const item of xml.getElementsByTagName('si'))strings.push(item.textContent);}
  const sheets=Object.keys(zip.files).filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x)).slice(0,10);let out='';
  for(const sheet of sheets){const item=zip.file(sheet);if(item._data.uncompressedSize>2*1024*1024)continue;const xml=new DOMParser().parseFromString(await item.async('string'),'application/xml');out+='\n['+sheet+']\n';for(const row of xml.getElementsByTagName('row')){const cells=[];for(const cell of row.getElementsByTagName('c')){const value=cell.getElementsByTagName('v')[0]?.textContent||cell.getElementsByTagName('is')[0]?.textContent||'';cells.push(cell.getAttribute('t')==='s'?strings[Number(value)]||'':value);}out+=cells.join(' | ')+'\n';if(out.length>100000)break;}if(out.length>100000)break;}
  if(!out.trim())throw Error('엑셀에서 텍스트를 찾지 못했습니다.');return out.slice(0,100000);
 }
 throw Error('이 형식은 자동 분석을 지원하지 않습니다. 첨부파일을 직접 확인해 주세요.');
}

export async function makeQuotePdf(element){
 const [{default:html2canvas},{jsPDF}]=await Promise.all([import('html2canvas'),import('jspdf')]);
 const canvas=await html2canvas(element,{scale:2,backgroundColor:'#ffffff',useCORS:false,logging:false,windowWidth:794});
 const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
 pdf.addImage(canvas.toDataURL('image/jpeg',0.92),'JPEG',0,0,210,297,undefined,'FAST');
 const bytes=new Uint8Array(pdf.output('arraybuffer'));
 if(bytes.length>8*1024*1024)throw Error('PDF가 8MB를 초과합니다.');
 return bytes;
}
