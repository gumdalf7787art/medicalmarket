"""Browser-free product collection, review, media storage and publication."""
import argparse
import hashlib
import html
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urljoin
from urllib.request import Request, build_opener, HTTPCookieProcessor, HTTPRedirectHandler

from PIL import Image, ImageOps

SITE = 'https://medicalmarket.co.kr'
DISCOVERY = '/api/discovery'
PRODUCTS = '/api/cloud/products'
HOSTS = {'inbody': {'inbody.com', 'inbodyinfra.blob.core.windows.net'},
         'alpinion': {'alpinion.com', 'alpinion.co.kr'}, 'bistos0340': {'bistos.co.kr'}}


def encoded(data):
    return json.dumps(data, ensure_ascii=False).encode()


def trusted(url, key):
    u = urlsplit(url)
    if u.scheme != 'https' or u.username or u.password or u.port or (u.hostname or '').removeprefix('www.') not in HOSTS[key]:
        raise ValueError('Unsupported official source: ' + url)
    return url


class OfficialRedirect(HTTPRedirectHandler):
    def __init__(self, key):
        self.key = key

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, trusted(newurl, self.key))


def download(url, key, limit):
    req = Request(trusted(url, key), headers={'User-Agent': 'MedicalMarket-ProductCollector/1.0', 'Accept-Language': 'ko,en;q=0.7'})
    with build_opener(OfficialRedirect(key)).open(req, timeout=35) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Official source exceeds download limit')
        return data, response.geturl(), response.headers.get_content_charset() or 'utf-8'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class Market:
    def __init__(self):
        self.client = build_opener(NoRedirect(), HTTPCookieProcessor(CookieJar()))
        self.call('/api/auth/login', {'email': os.environ['MM_PRODUCT_EMAIL'], 'password': os.environ['MM_PRODUCT_PASSWORD']})

    def call(self, path, data=None, headers=None):
        body = data if isinstance(data, bytes) or data is None else encoded(data)
        req = Request(SITE + path, body, {'Origin': SITE, 'Content-Type': 'application/json', **(headers or {})})
        with self.client.open(req, timeout=60) as response:
            return json.load(response)

    def upload(self, data):
        return self.call('/api/cloud/image', data, {'Content-Type': 'image/webp',
                         'X-Image-SHA256': hashlib.sha256(data).hexdigest()})['url']


def webp(image, size):
    image = image.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, 'WEBP', quality=90, method=4)
    return output.getvalue()


def upload_gallery(api, draft):
    gallery = []
    for item in draft['images']:
        data, _, _ = download(item['url'], draft['key'], 32 << 20)
        with Image.open(io.BytesIO(data)) as source:
            if source.width * source.height > 60_000_000:
                raise ValueError('Image exceeds pixel limit')
            image = ImageOps.exif_transpose(source)
            if 'crop' in item:
                x, y, right, bottom = item['crop']
                if not (0 <= x < right <= image.width and 0 <= y < bottom <= image.height):
                    raise ValueError('Invalid crop rectangle')
                image = image.crop((x, y, right, bottom))
            path = api.upload(webp(image, 3000))
            if path not in gallery:
                api.call('/api/cloud/image', webp(image, 480), {'Content-Type': 'image/webp', 'X-Thumbnail-For': path.split('/')[-1]})
                gallery.append(path)
    if not 1 <= len(gallery) <= 50:
        raise ValueError('Select between 1 and 50 distinct product images')
    return gallery


def collect(api, args):
    rows = api.call(DISCOVERY)['rows']
    row, = [r for r in rows if r['identity'] == args.identity and r['supplier_id'] == args.supplier]
    raw, url, charset = download(args.json_url or row['source_url'], args.key, 8 << 20)
    if args.json_url:
        record = json.loads(raw)
        for part in args.record.split('.') if args.record else ():
            record = record[int(part)] if isinstance(record, list) else record[part]
        if str(record[args.model_field]).casefold().split() != row['model'].casefold().split():
            raise ValueError('Official data record model does not match')
        def strings(field):
            value = record[field]
            values = value if isinstance(value, list) else [value]
            if not all(isinstance(v, str) for v in values):
                raise ValueError('Expected text or an array of text in ' + field)
            return values
        material = dict(paragraphs=strings(args.text_field),
                        images=[{'url': trusted(urljoin(url, u), args.key)} for u in strings(args.images_field)])
    else:
        source = subprocess.run(['node', str(Path(__file__).with_name('product-source.mjs'))],
                                input=encoded(dict(html=raw.decode(charset), url=url, selector=args.selector, model=row['model'])),
                                stdout=subprocess.PIPE, check=True)
        material = json.loads(source.stdout)
    draft = dict(key=args.key, supplier=args.supplier, identity=args.identity, model=row['model'], name=row['model'],
                 source=row['source_url'], evidence=url, category=row['category'] or row['recommendedCategory'], **material)
    if row['decision'] == 'published':
        product = api.call(PRODUCTS + '?' + urlencode({'admin': 1, 'id': row['product_id']}))['product']
        draft.update(product=product['id'], revision=product['revision'])
    elif row['decision'] or row['kind'] != 'draft':
        raise ValueError('Existing match: review supplier link instead')
    with args.file.open('x', encoding='utf-8') as out:
        json.dump(draft, out, ensure_ascii=False, indent=2)
    return {'review': str(args.file)}


def run(args, api):
    if args.action == 'scan':
        return api.call(DISCOVERY, {'action': 'scan', 'key': args.key})
    if args.action == 'list':
        return api.call(DISCOVERY)
    if args.action == 'link':
        return api.call(DISCOVERY, dict(action='link', supplier=args.supplier, identity=args.identity, product=args.product))
    if args.action == 'collect':
        return collect(api, args)
    raw = args.file.read_bytes()
    draft = json.loads(raw.decode('utf-8-sig'))
    receipt = args.file.with_suffix(args.file.suffix + '.receipt')
    digest = hashlib.sha256(raw).hexdigest()
    base = {k: draft[k] for k in ('supplier', 'identity')}
    if args.action == 'prepare':
        gallery = upload_gallery(api, draft)
        if not draft['paragraphs'] or any(not p.strip() or 'http://' in p.lower() or 'https://' in p.lower() for p in draft['paragraphs']):
            raise ValueError('Review product description paragraphs')
        staged = {'digest': digest, 'gallery': gallery}
        if 'product' not in draft:
            staged.update(api.call(DISCOVERY, dict(action='prepare', **base, gallery=gallery, paragraphs=draft['paragraphs'])))
        temp = receipt.with_suffix('.receipt.tmp')
        temp.write_bytes(encoded(staged))
        temp.replace(receipt)
        return {'review': str(args.file), 'images': len(gallery)}
    staged = json.loads(receipt.read_bytes())
    if digest != staged['digest']:
        raise ValueError('Review file changed: run prepare again')
    if 'product' in draft:
        product = api.call(PRODUCTS + '?' + urlencode({'admin': 1, 'id': draft['product']}))['product']
        if product['revision'] != draft['revision'] or not product['published'] or product['deleted'] or product['model'] != draft['model']:
            raise ValueError('Product changed: collect and review again')
        product.update(image=staged['gallery'][0], gallery=staged['gallery'], name=draft['name'],
                       categoryIds=list(dict.fromkeys([draft['category'], *product['categoryIds'][1:]])),
                       descriptionHtml=''.join('<p>'+html.escape(p)+'</p>' for p in draft['paragraphs']))
        pid = api.call(PRODUCTS, product)['product']['id']
    else:
        pid = api.call(DISCOVERY, dict(action='publish', **base, version=staged['version'], name=draft['name'], category=draft['category']))['product']
    saved = api.call(PRODUCTS + '?' + urlencode({'id': pid}))['product']
    if saved['gallery'] != staged['gallery'] or saved['image'] != staged['gallery'][0] or not saved['descriptionHtml']:
        raise ValueError('Public product verification failed: ' + pid)
    # Verify the public card and actual thumbnail without the administrator cookie.
    public = build_opener(NoRedirect())
    page = 1
    while True:
        query = urlencode({'q': draft['model'], 'page': page})
        with public.open(SITE + PRODUCTS + '?' + query, timeout=35) as response:
            results = json.load(response)
        if any(p['id'] == pid and p['image'] == saved['image'] for p in results['products']):
            break
        if page >= results['pages']:
            raise ValueError('Published product missing from search: ' + pid)
        page += 1
    with public.open(SITE + saved['image'] + '?thumb=1', timeout=35) as response:
        if response.read(12)[8:] != b'WEBP' or response.headers.get('X-Image-Variant') != 'thumbnail':
            raise ValueError('Public thumbnail verification failed: ' + pid)
    return {'product': pid, 'verified': True, 'images': len(saved['gallery'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('session', help='Run JSON argument arrays from stdin with one authenticated session')
    commands.add_parser('list')
    commands.add_parser('scan').add_argument('key', choices=HOSTS)
    get = commands.add_parser('collect')
    get.add_argument('key', choices=HOSTS)
    get.add_argument('supplier')
    get.add_argument('identity')
    get.add_argument('file', type=Path)
    get.add_argument('--selector', help='Product detail CSS selector')
    get.add_argument('--json-url', help='Official JSON endpoint for dynamically loaded details')
    get.add_argument('--record', default='', help='Dot-separated path to the product record, including array indices')
    get.add_argument('--model-field', default='model')
    get.add_argument('--text-field', default='paragraphs')
    get.add_argument('--images-field', default='images')
    link = commands.add_parser('link')
    for key in ('supplier', 'identity', 'product'):
        link.add_argument(key)
    for action in ('prepare', 'publish'):
        commands.add_parser(action).add_argument('file', type=Path)
    args = parser.parse_args()
    try:
        api = Market()
        if args.action == 'session':
            for line in sys.stdin:
                if not line.strip():
                    continue
                argv = json.loads(line)
                if not isinstance(argv, list) or not argv or not all(isinstance(v, str) for v in argv) or argv[0] == 'session':
                    raise ValueError('Expected a JSON array of command arguments')
                print(json.dumps(run(parser.parse_args(argv), api), ensure_ascii=False), flush=True)
        else:
            print(json.dumps(run(args, api), ensure_ascii=False, indent=2))
    except HTTPError as error:
        sys.exit(f'HTTP {error.code} at {error.url}: {error.read(500).decode(errors="replace")}')
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))


if __name__ == '__main__':
    main()
