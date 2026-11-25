"""Local Codex tool for the approved Medical Market guide connection."""

import ctypes
import hashlib
import argparse
from ctypes import wintypes
import html
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin
from urllib.request import HTTPRedirectHandler, Request, build_opener


ORIGIN = "https://medicalmarket.co.kr"
GUIDES = "/api/guides"
SLUG = r"[a-z0-9][a-z0-9-]{0,119}"
FIELD_LIMITS = {"productId": 100, "title": 200, "summary": 500, "body": 60000}


class ToolError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_token(scope="guide"):
    class DataBlob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    try:
        path = Path(os.environ["LOCALAPPDATA"]) / "MedicalMarket" / f"{scope}-connection-token.dpapi"
        protected = bytes.fromhex(path.read_text(encoding="ascii").strip())
        source_bytes = (ctypes.c_ubyte * len(protected)).from_buffer_copy(protected)
        source = DataBlob(len(protected), source_bytes)
        result = DataBlob()
        unprotect = ctypes.windll.crypt32.CryptUnprotectData
        unprotect.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.c_void_p,
                              ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                              ctypes.POINTER(DataBlob)]
        if not unprotect(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
            raise OSError("Windows account cannot decrypt this credential")
        try:
            token = ctypes.string_at(result.data, result.size).decode("utf-16-le")
        finally:
            ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
            ctypes.windll.kernel32.LocalFree(result.data)
    except (OSError, AttributeError, KeyError, ValueError):
        raise ToolError("이 Windows 계정에서 승인된 메디컬마켓 연결을 읽을 수 없습니다.") from None
    if not re.fullmatch(rf"mm_{scope}_[0-9a-f]{{64}}", token):
        raise ToolError("저장된 메디컬마켓 연결 형식을 확인해 주세요.")
    return token


def request(path, token=None, payload=None, *, raw=False, allow_missing=False, method=None, extra_headers=None):
    headers = {"Accept": "text/html" if raw else "application/json",
               "User-Agent": "MedicalMarket-GuidePublisher/1.1 (+https://medicalmarket.co.kr)"}
    headers.update(extra_headers or {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if isinstance(payload, bytes):
        data = payload
    elif payload is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(ORIGIN + path, data=data, headers=headers, method=method or ("PUT" if data else "GET"))
    try:
        with build_opener(NoRedirect).open(req, timeout=15) as response:
            text = response.read(1_000_000).decode("utf-8")
            return text if raw else json.loads(text)
    except HTTPError as error:
        media = error.headers.get_content_type()
        # Only the application's own missing-guide response permits a new write.
        body = error.read(8192)
        try:
            parsed = json.loads(body) if media == "application/json" else None
        except (ValueError, UnicodeError):
            parsed = None
        message = parsed.get("error") if isinstance(parsed, dict) else None
        if error.code == 404 and allow_missing and message == "글을 찾을 수 없습니다.":
            return None
        ray = error.headers.get("CF-Ray", "")
        detail = f", Cloudflare Ray {ray}" if re.fullmatch(r"[a-fA-F0-9]+-[A-Za-z]+", ray) else ""
        if message == "발행 권한이 없습니다.":
            detail += ", 제품 안내 API가 발행 권한을 거부했습니다"
        elif error.headers.get("cf-mitigated") == "challenge":
            detail += ", Cloudflare 확인 페이지"
        elif re.fullmatch(rb"\s*error code: (\d{4})\s*", body):
            detail += ", 오류 코드 " + body.strip()[-4:].decode("ascii")
        raise ToolError(f"{req.method} {path} HTTP {error.code} ({media}{detail})") from None
    except (URLError, TimeoutError, ValueError):
        raise ToolError("메디컬마켓에 연결하지 못했거나 응답을 읽을 수 없습니다.") from None


def guide_status():
    token = read_token()
    result = request("/api/guide-connections/status", token)
    if result.get("connected") is True:
        try:
            request(GUIDES + "?admin=1", token)
        except ToolError as error:
            raise ToolError(f"연결 승인 확인 성공, 관리자 글 목록 조회 실패: {error}") from None
    return {"connected": result.get("connected") is True, "state": result.get("state")}


def publish_guide(data):
    if not isinstance(data, dict) or set(data) != {"slug", "revision", "images", *FIELD_LIMITS}:
        raise ToolError("글 주소, 제품 ID, 제목, 요약, 본문, 사진, 리비전이 필요합니다.")
    slug = data["slug"]
    revision = data["revision"]
    images = data["images"]
    if not isinstance(slug, str) or not re.fullmatch(SLUG, slug) or type(revision) is not int or revision < 0:
        raise ToolError("글 주소 또는 저장 버전을 확인해 주세요.")
    for key, limit in FIELD_LIMITS.items():
        value = data[key]
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ToolError(f"{key} 항목을 확인해 주세요.")
    if (not isinstance(images, list) or not 1 <= len(images) <= 4
            or any(not isinstance(image, str) or len(image) > 2048 for image in images)
            or len(set(images)) != len(images)):
        raise ToolError("선택한 제품의 등록 사진을 1~4장 지정해 주세요.")
    token = read_token()
    path = f"{GUIDES}/{slug}"
    current = request(path + "?admin=1", token, allow_missing=True)
    payload = {key: data[key].strip() for key in FIELD_LIMITS}
    product_id = payload["productId"]
    read_fields = {key: value for key, value in payload.items() if key != "productId"}
    read_fields.update(product_id=product_id, images=images)
    if current and current.get("published") == 1 and all(current.get(k) == v for k, v in read_fields.items()):
        saved_revision = current["revision"]
    else:
        if revision != (current["revision"] if current else 0):
            raise ToolError("기존 글의 저장 버전이 다릅니다. 최신 글을 검토한 뒤 다시 요청해 주세요.")
        try:
            write_payload = {**payload, "images": images, "revision": revision, "published": True}
            saved_revision = request(path, token, write_payload)["revision"]
        except ToolError as error:
            raise ToolError(f"{error} 재시도 전에 같은 주소의 저장 상태를 조회해 주세요.") from None
    try:
        public = request(path)
        if public.get("revision") != saved_revision or public.get("published") != 1 or public.get("product_id") != product_id:
            raise ToolError("공개 API에서 저장한 글을 확인하지 못했습니다.")
        query = urlencode({"q": (public.get("model") or public["title"])[:100]})
        matches = request(GUIDES + "?" + query)["guides"]
        page = request(f"/guide/{slug}", raw=True)
        product_link = "/product.html?id=" + quote("managed-" + product_id, safe="")
        if (not any(guide["slug"] == slug for guide in matches) or product_link not in page
                or any(html.escape(urljoin(ORIGIN, image)) not in page for image in images)):
            raise ToolError("공개 검색, 제품 링크 또는 본문 사진을 확인하지 못했습니다.")
    except ToolError as error:
        raise ToolError(f"리비전 {saved_revision} 저장 후 공개 확인에 실패했습니다. {error}") from None
    return {"url": f"{ORIGIN}/guide/{slug}", "revision": saved_revision, "published": True}


def guide_lookup(args):
    if not isinstance(args, dict):
        raise ToolError("Invalid lookup arguments")
    resource = args.get("resource")
    if resource == "product":
        product_id = args.get("productId")
        if set(args) != {"resource", "productId"} or not isinstance(product_id, str) or not 1 <= len(product_id) <= 100:
            raise ToolError("Provide the product ID")
        return request("/api/cloud/products?" + urlencode({"id": product_id}))
    paths = {"catalog": "/api/cloud/products", "guides": GUIDES}
    page = args.get("page", 1)
    query = args.get("q", "")
    if (resource not in paths or set(args) - {"resource", "page", "q"}
            or type(page) is not int or page < 1 or not isinstance(query, str) or len(query) > 100):
        raise ToolError("Invalid catalog or guide query")
    return request(paths[resource] + "?" + urlencode({"page": page, "q": query}))



def product_status():
    result = request("/api/product-connections/status", read_token("product"))
    return {"connected": result.get("connected") is True, "state": result.get("state")}


def product_api(path, payload=None, headers=None):
    return request(path, read_token("product"), payload,
                   method="POST" if payload is not None else "GET", extra_headers=headers)


def upload_product_photo(source):
    root = Path(__file__).resolve().parents[2]
    path = Path(source).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() != ".webp":
        raise ToolError("메디컬마켓 작업 폴더의 WebP 사진을 지정하세요.")
    try:
        with path.open("rb") as photo:
            data = photo.read((8 << 20) + 1)
    except OSError:
        raise ToolError("지정한 사진을 읽을 수 없습니다.") from None
    if len(data) > 8 << 20 or len(data) < 20 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ToolError("8MB 이하의 WebP로 사진을 최적화해 주세요.")
    receipt = product_api("/api/cloud/image", data, {
        "Content-Type": "image/webp", "X-Image-SHA256": hashlib.sha256(data).hexdigest()})
    return {"url": receipt["url"]}


def save_product(product):
    if not isinstance(product, dict) or type(product.get("published")) is not bool:
        raise ToolError("제품 정보와 공개 여부를 확인해 주세요.")
    if product.get("revision", 0) != 0 or product.get("deleted"):
        raise ToolError("제품 연결은 신규 제품 등록에 사용할 수 있습니다.")
    result = product_api("/api/cloud/products", {**product, "revision": 0, "deleted": False})
    saved = result["product"]
    if saved["published"]:
        visible = request("/api/cloud/products?" + urlencode({"id": saved["id"]}))
        if visible["product"]["id"] != saved["id"]:
            raise ToolError("공개 제품 확인에 실패했습니다. 등록 상태를 확인하세요.")
    return {"id": saved["id"], "published": saved["published"],
            "url": ORIGIN + "/product.html?id=" + quote("managed-" + saved["id"]) if saved["published"] else None}


TOOLS = [
    {"name": "product_status", "description": "승인된 제품 등록 연결 상태를 확인합니다.",
     "annotations": {"readOnlyHint": True}, "inputSchema": {"type": "object", "additionalProperties": False}},
    {"name": "upload_product_photo", "description": "작업 폴더에 있는 최적화 WebP 사진을 제품 스토리지에 올립니다.",
     "inputSchema": {"type": "object", "required": ["path"], "additionalProperties": False, "properties": {"path": {"type": "string"}}}},
    {"name": "save_product", "description": "사용자가 요청한 신규 제품을 등록합니다. product.published가 true이면 공개합니다.",
     "inputSchema": {"type": "object", "required": ["product"], "additionalProperties": False, "properties": {"product": {"type": "object",
        "required": ["id", "name", "model", "maker", "categoryIds", "published", "image", "gallery", "descriptionHtml"]}}}},
    {"name": "guide_lookup", "description": "Read the public product catalog, product details or guide list without a browser.",
     "annotations": {"readOnlyHint": True},
     "inputSchema": {"type": "object", "required": ["resource"], "additionalProperties": False,
                     "properties": {"resource": {"enum": ["catalog", "product", "guides"]},
                                    "productId": {"type": "string", "maxLength": 100},
                                    "page": {"type": "integer", "minimum": 1},
                                    "q": {"type": "string", "maxLength": 100}}}},
    {"name": "guide_status", "description": "승인된 메디컬마켓 발행 API 연결을 읽기로 확인합니다.",
     "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
     "annotations": {"readOnlyHint": True}},
    {"name": "publish_guide", "description": "사용자가 공개를 요청한 메디컬마켓 제품 안내 글을 API로 발행하고 공개 주소를 확인합니다.",
     "inputSchema": {"type": "object", "additionalProperties": False,
                     "required": ["slug", "revision", "images", *FIELD_LIMITS],
                     "properties": {"slug": {"type": "string", "pattern": "^" + SLUG + "$"},
                                    "revision": {"type": "integer", "minimum": 0},
                                    "images": {"type": "array", "items": {"type": "string"},
                                               "minItems": 1, "maxItems": 4, "uniqueItems": True},
                                    **{key: {"type": "string", "maxLength": limit} for key, limit in FIELD_LIMITS.items()}}}},
]


def handle(message):
    method = message.get("method")
    if "id" not in message:
        return None
    response = {"jsonrpc": "2.0", "id": message["id"]}
    params = message.get("params") or {}
    if method == "initialize":
        supported = {"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}
        version = params.get("protocolVersion")
        result = {"protocolVersion": version if version in supported else "2025-11-25",
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "medicalmarket-guides", "version": "1.0.0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        try:
            name = params.get("name")
            if name == "guide_status":
                output = guide_status()
            elif name == "guide_lookup":
                output = guide_lookup(params.get("arguments"))
            elif name == "publish_guide":
                output = publish_guide(params.get("arguments"))
            elif name == "product_status":
                output = product_status()
            elif name == "upload_product_photo":
                output = upload_product_photo((params.get("arguments") or {}).get("path", ""))
            elif name == "save_product":
                output = save_product((params.get("arguments") or {}).get("product"))
            else:
                raise ToolError("지원하지 않는 도구입니다.")
            result = {"content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}]}
        except ToolError as error:
            result = {"isError": True, "content": [{"type": "text", "text": str(error)}]}
    elif method == "ping":
        result = {}
    else:
        return {**response, "error": {"code": -32601, "message": "Method not found"}}
    return {**response, "result": result}


def run_cli():
    parser = argparse.ArgumentParser(description="Medical Market direct publishing API")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("status", help="Check the approved connection without writing")
    submit = commands.add_parser("submit", help="Publish a prepared guide and verify its public page")
    submit.add_argument("draft", type=Path)
    submit.add_argument("--slug", required=True)
    args = parser.parse_args()
    try:
        if args.action == "status":
            result = guide_status()
        else:
            draft = json.loads(args.draft.read_text(encoding="utf-8-sig"))
            if not isinstance(draft, dict) or ("slug" in draft and draft["slug"] != args.slug):
                raise ToolError("원고 파일과 요청한 글 주소를 확인해 주세요.")
            result = publish_guide({**draft, "slug": args.slug})
        print(json.dumps(result, ensure_ascii=False))
        return 1 if result.get("connected") is False else 0
    except (OSError, ValueError, ToolError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(run_cli())
    for line in sys.stdin.buffer:
        try:
            message = json.loads(line)
            response = handle(message)
        except (AttributeError, KeyError, TypeError, ValueError):
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}
        if response is not None:
            sys.stdout.buffer.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
            sys.stdout.buffer.flush()
