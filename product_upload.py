from pathlib import Path
from io import BytesIO
import base64,hashlib,warnings
from PIL import Image,ImageOps,ImageSequence,UnidentifiedImageError
ROOT=Path(__file__).resolve().parent
Image.MAX_IMAGE_PIXELS=40_000_000

def save_image(payload):
 try:data=base64.b64decode(payload.get('base64',''),validate=True)
 except (ValueError,TypeError):raise ValueError('사진을 읽을 수 없습니다.')
 if not data or len(data)>8*1024*1024:raise ValueError('사진은 8MB 이하로 등록해 주세요.')
 try:
  with warnings.catch_warnings():
   warnings.simplefilter('error',Image.DecompressionBombWarning)
   with Image.open(BytesIO(data)) as source:
    if source.format not in ('JPEG','PNG','GIF','WEBP'):raise ValueError('JPG·PNG·WEBP·GIF 사진만 등록할 수 있습니다.')
    count=getattr(source,'n_frames',1)
    if count>100 or source.width*source.height*count>100_000_000:raise ValueError('사진이 너무 큽니다. 크기 또는 애니메이션 길이를 줄여 주세요.')
    frames=[];durations=[]
    for frame in ImageSequence.Iterator(source):
     img=ImageOps.exif_transpose(frame).convert('RGBA' if 'A' in frame.getbands() or 'transparency' in source.info else 'RGB')
     img.thumbnail((1920,1920),Image.Resampling.LANCZOS)
     frames.append(img);durations.append(frame.info.get('duration',100))
    output=BytesIO()
    opts=dict(format='WEBP',quality=85,method=6)
    if len(frames)>1:opts.update(save_all=True,append_images=frames[1:],duration=durations,loop=source.info.get('loop',0))
    frames[0].save(output,**opts)
    optimized=output.getvalue();width,height=frames[0].size
 except (UnidentifiedImageError,OSError,Image.DecompressionBombError,Image.DecompressionBombWarning):raise ValueError('정상적인 이미지 파일인지 확인해 주세요.')
 relative='assets/uploads/'+hashlib.sha256(optimized).hexdigest()+'.webp'
 target=ROOT/relative;target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists():target.write_bytes(optimized)
 return {'url':relative,'size':len(optimized),'originalSize':len(data),'width':width,'height':height,'optimized':True}
