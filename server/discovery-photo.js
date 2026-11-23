const officialPhotos = {
  "인바디": {
    "InBody J50": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/95f1c379-b818-4fe1-b8ac-0fb35f89a32f_J50_m.png",
    "InBody270S": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/0ebde0f9-598d-496a-a4d4-4f101bd03b34_270%20(2).png",
    "InBody280": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/cf596202-1e1a-4796-82c8-eaddc1495246_280%20(1).png",
    "InBody380": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/183d37a1-811e-4e1e-9fe0-b556700b2b61_380.png",
    "InBody580": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/79b7dc0e-40ae-4f43-a056-0dab70129c25_580.png",
    "InBody770S": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/a96908c2-adcc-4d12-bc21-ac61d67198ff_770%20(2).png",
    "InBody970S": "https://inbodyinfra.blob.core.windows.net/inbodyhome/prod/product/6dbca4e8-5e27-45b6-b37a-9a84f32fe70c_970%20(2).png"
  },
  "알피니언메디칼시스템": {
    "ALPIUS 900": "https://www.alpinion.com/uploadImage/product/202503/1739827824000000000.png",
    "E-CUBE 8": "https://www.alpinion.com/uploadImage/product/202011/1606143035000000006.png",
    "E-CUBE 8 Diamond": "https://www.alpinion.com/uploadImage/product/202011/1606143035000000005.png",
    "E-CUBE 8LE": "https://www.alpinion.com/uploadImage/product/202011/1605141876000000005.png",
    "VIFU 2000": "https://www.alpinion.com/uploadImage/product/202503/1739827824000000001.png",
    "X-CUBE 50": "https://www.alpinion.com/uploadImage/product/202405/1716455870000000000.png",
    "X-CUBE 60": "https://www.alpinion.com/uploadImage/product/202403/1709107396000000007.png",
    "X-CUBE 70 with Elite": "https://www.alpinion.com/uploadImage/product/202605/1777427671000000011.png",
    "X-CUBE 90 with Elite": "https://www.alpinion.com/uploadImage/product/202403/1709107396000000006.png",
    "X-CUBE i8": "https://www.alpinion.com/uploadImage/product/202408/1718465777000000001.png",
    "X-CUBE i9": "https://www.alpinion.com/uploadImage/product/202306/1688013776000000000.png",
    "minisono": "https://www.alpinion.com/uploadImage/product/202101/1610409945000000050.png"
  },
  "비스토스": {
    "BT-100": "https://www.bistos.co.kr/wp-content/uploads/2024/08/Electric-Breast-Pump.png",
    "BT-1000": "https://www.bistos.co.kr/wp-content/uploads/2024/08/BT1000-008-1.png",
    "BT-200L": "https://www.bistos.co.kr/wp-content/uploads/2022/04/sub-banner-image-en-product-4-1.png",
    "BT-350": "https://www.bistos.co.kr/wp-content/uploads/2022/03/sub-banner-image-en-product-2-2-2.png",
    "BT-36": "https://www.bistos.co.kr/wp-content/uploads/2022/04/sub-banner-image-en-product-8-1.png",
    "BT-400": "https://www.bistos.co.kr/wp-content/uploads/2022/04/sub-banner-image-en-product-5-1.png",
    "BT-410": "https://www.bistos.co.kr/wp-content/uploads/2024/11/BT410A-1.png",
    "BT-500": "https://www.bistos.co.kr/wp-content/uploads/2022/03/sub-banner-image-en-product-5.png",
    "BT-550": "https://www.bistos.co.kr/wp-content/uploads/2022/04/sub-banner-image-en-product-6-1.png",
    "BT-770": "https://www.bistos.co.kr/wp-content/uploads/2022/04/sub-banner-image-en-product-3-1.png",
    "BT-800": "https://www.bistos.co.kr/wp-content/uploads/2024/04/Hybrid-CR.-BT-800.png"
  }
};

export function discoveryPhoto(product) {
  if (!product.id?.startsWith('discovered-') || product.image) return product;
  const image=product.gallery?.[0] || officialPhotos[product.maker]?.[product.model];
  return typeof image==='string' ? {...product,image,gallery:[...new Set([image,...(product.gallery||[])])]} : product;
}
