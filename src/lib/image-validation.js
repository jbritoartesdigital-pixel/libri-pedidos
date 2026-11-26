// Bounded structural verification before private storage. Not an antivirus or a full pixel decoder.
const ascii=(b,p,n)=>String.fromCharCode(...b.subarray(p,p+n));
const maxPixels=60_000_000;
const dims=(w,h)=>Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w*h<=maxPixels;
const be=(b,p,n=4)=>{let v=0;for(let i=0;i<n;i++)v=v*256+b[p+i];return v;};
const le=(b,p,n=4)=>{let v=0;for(let i=n-1;i>=0;i--)v=v*256+b[p+i];return v;};
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(b,a,z){let c=0xffffffff;for(let i=a;i<z;i++)c=crcTable[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function png(b){
 if(b.length<45||![137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return false;
 let p=8,idat=false,ihdr=false,bytes=0;
 while(p+12<=b.length){
  const n=be(b,p),type=ascii(b,p+4,4),end=p+12+n;
  if(end>b.length||!Number.isSafeInteger(end)||crc(b,p+4,end-4)!==be(b,end-4))return false;
  if(!ihdr){if(type!=='IHDR'||n!==13||!dims(be(b,p+8),be(b,p+12)))return false;ihdr=true;}
  else if(type==='IHDR')return false;
  if(type==='IDAT'){idat=true;bytes+=n;}
  if(type==='IEND')return n===0&&idat&&bytes>0&&end===b.length;
  p=end;
 }
 return false;
}
function jpeg(b){
 if(b.length<25||b[0]!==255||b[1]!==216)return false;
 let p=2,frame=false,scan=false;
 while(p<b.length){
  if(b[p++]!==255)return false;while(p<b.length&&b[p]===255)p++;
  const m=b[p++];if(m===217)return frame&&scan&&p===b.length;
  if(m===216||m===0||m===1||m>=208&&m<=215||p+2>b.length)return false;
  const n=be(b,p,2);if(n<2||p+n>b.length)return false;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(m)){
   if(n<8||!dims(be(b,p+5,2),be(b,p+3,2)))return false;frame=true;
  }
  p+=n;
  if(m===218){
   if(!frame||n<6)return false;scan=true;
   while(p<b.length){
    if(b[p]!==255){p++;continue;}
    let q=p+1;while(q<b.length&&b[q]===255)q++;
    if(q===b.length)return false;
    if(b[q]===0||b[q]>=208&&b[q]<=215){p=q+1;continue;}
    break;
   }
  }
 }
 return false;
}
function webp(b){
 if(b.length<20||ascii(b,0,4)!=='RIFF'||ascii(b,8,4)!=='WEBP'||le(b,4)+8!==b.length)return false;
 let p=12,image=false,animated=false;
 while(p+8<=b.length){
  const t=ascii(b,p,4),n=le(b,p+4),a=p+8,z=a+n+(n&1);
  if(z>b.length)return false;
  if(t==='VP8X'){if(n!==10||!dims(1+le(b,a+4,3),1+le(b,a+7,3)))return false;animated=!!(b[a]&2);}
  if(t==='VP8 '){if(n<10||b[a+3]!==157||b[a+4]!==1||b[a+5]!==42||!dims(le(b,a+6,2)&16383,le(b,a+8,2)&16383))return false;image=true;}
  if(t==='VP8L'){if(n<5||b[a]!==47||!dims(1+(le(b,a+1,4)&16383),1+((le(b,a+1,4)>>>14)&16383)))return false;image=true;}
  if(t==='ANMF'&&animated&&n>24&&dims(1+le(b,a+6,3),1+le(b,a+9,3)))image=true;
  p=z;
 }
 return image&&p===b.length;
}
function heif(b){
 let p=0,brand=false,meta=false,media=false;
 const brands=new Set(['heic','heix','hevc','hevx','mif1','msf1','heim','heis','hevm','hevs']);
 while(p+8<=b.length){
  const type=ascii(b,p+4,4);let n=be(b,p),head=8;
  if(n===1){if(p+16>b.length)return false;n=be(b,p+8,8);head=16;}
  else if(n===0)n=b.length-p;
  if(!Number.isSafeInteger(n)||n<head||p+n>b.length)return false;
  if(p===0&&type!=='ftyp')return false;
  if(type==='ftyp'){if(n<head+8||(n-head-8)%4)return false;brand=brands.has(ascii(b,p+head,4));for(let q=p+head+8;q+4<=p+n;q+=4)brand||=brands.has(ascii(b,q,4));}
  if(type==='meta'){if(n<head+12)return false;let q=p+head+4,handler=false,location=false,info=false,properties=false;while(q+8<=p+n){const m=be(b,q),t=ascii(b,q+4,4);if(m<8||q+m>p+n)return false;handler||=t==='hdlr';location||=t==='iloc';info||=t==='iinf';properties||=t==='iprp';if(t==='idat'&&m>8)media=true;q+=m;}if(q!==p+n||!handler||!location||!info||!properties)return false;meta=true;}
  if(type==='mdat'&&n>head)media=true;
  p+=n;
 }
 return p===b.length&&brand&&meta&&media;
}
export function validImageStructure(bytes,mime){
 if(!(bytes instanceof Uint8Array)||bytes.length<12)return false;
 if(mime==='image/png')return png(bytes);
 if(mime==='image/jpeg')return jpeg(bytes);
 if(mime==='image/webp')return webp(bytes);
 if(mime==='image/heic'||mime==='image/heif')return heif(bytes);
 return false;
}
export async function validateImageFile(file,mime,max){
 if(!file||!Number.isSafeInteger(file.size)||file.size<=0||file.size>max)return false;
 return validImageStructure(new Uint8Array(await file.arrayBuffer()),mime);
}
