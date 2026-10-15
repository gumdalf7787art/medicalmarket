"""Loopback-only preview with a private, local supplier directory endpoint."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import mail_service
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parent
DIRECTORY = ROOT / 'sample-suppliers.json'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.headers.get('Host') not in ('127.0.0.1:8767', 'localhost:8767'):
            self.send_error(403)
            return
        if urlsplit(self.path).path == '/api/mail/status':
            if not self.local_request():
                self.send_error(403); return
            result = mail_service.status()
            delivery_id = parse_qs(urlsplit(self.path).query).get('deliveryId', [''])[0]
            if delivery_id:
                result['delivery'] = mail_service.receipt(delivery_id)
            self.json_response(result)
            return
        if urlsplit(self.path).path == '/api/local-suppliers':
            origin = self.headers.get('Origin')
            if origin and origin not in ('http://127.0.0.1:8767', 'http://localhost:8767'):
                self.send_error(403)
                return
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_error(403)
                return
            try:
                data = json.loads(DIRECTORY.read_text(encoding='utf-8'))
                if data.get('format') != 'medicalmarket-suppliers-v1':
                    raise ValueError('format')
                body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            except (OSError, ValueError):
                self.send_error(503, 'Supplier directory unavailable')
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def local_request(self):
        origin = self.headers.get('Origin')
        return self.headers.get('Host') in ('127.0.0.1:8767', 'localhost:8767') and (not origin or origin == 'http://' + self.headers.get('Host', '')) and self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def json_response(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.local_request() or self.headers.get('Origin') != 'http://' + self.headers.get('Host', '') or self.headers.get('X-Mail-Token') != mail_service.TOKEN:
            self.json_response({'error': '로컬 화면에서 다시 연결해 주세요.'}, 403); return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.json_response({'error': '지원하지 않는 요청 형식입니다.'}, 415); return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 12 * 1024 * 1024: raise ValueError('요청 크기가 올바르지 않습니다.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict): raise ValueError('요청 내용을 확인해 주세요.')
            path = urlsplit(self.path).path
            if path == '/api/product-image':
                from product_upload import save_image
                result = save_image(data)
            elif path == '/api/mail/customer-quote':
                from customer_quote import send
                result = send(data)
            elif path == '/api/mail/mailbox':
                from mailbox_service import action
                result = action(data)
            elif path == '/api/mail/replies':
                from reply_service import action
                result = action(data)
            elif path == '/api/mail/connect': result = mail_service.connect(data.get('password'))
            elif path == '/api/mail/attachment': result = mail_service.save_attachment(data)
            elif path == '/api/mail/send': result = mail_service.send(data)
            else:
                self.json_response({'error': '요청 경로를 찾을 수 없습니다.'}, 404); return
            self.json_response(result)
        except ValueError as exc:
            self.json_response({'error': str(exc)}, 400)
        except Exception:
            # Do not log request bodies, credentials or SMTP responses.
            self.json_response({'error': '처리 결과를 확인하지 못했습니다. 발송 중이었다면 상태를 새로 확인해 주세요.'}, 500)

    def list_directory(self, path):
        self.send_error(404)
        return None

if __name__ == '__main__':
    print('Local Medical Market preview: http://127.0.0.1:8767/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8767), Handler).serve_forever()
