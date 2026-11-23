export function guideBodyBlocks(body, imageCount) {
  const blocks=body.split(/\n\s*\n/).map(text=>text.trim()).filter(Boolean).map(text=>(
    text.startsWith('## ')?{type:'heading',text:text.slice(3)}:{type:'paragraph',text}
  ));
  const between=blocks.flatMap(({type},i)=>type==='paragraph'&&i+1<blocks.length?[i+1]:[]);
  const boundaries=imageCount<=between.length?between:[0,...between];
  if(imageCount>boundaries.length&&blocks.length)boundaries.push(blocks.length);
  const imagesByBoundary=new Map();
  for(let index=0;index<imageCount;index++){
    const slot=Math.round(index*(boundaries.length-1)/Math.max(1,imageCount-1));
    const boundary=boundaries[slot];
    const images=imagesByBoundary.get(boundary)||[];
    images.push({type:'image',index});
    imagesByBoundary.set(boundary,images);
  }
  return [...blocks.flatMap((block,i)=>[...(imagesByBoundary.get(i)||[]),block]),
    ...(imagesByBoundary.get(blocks.length)||[])];
}
