import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from urllib.parse import urlsplit, urlunsplit, quote, parse_qsl, urlencode

DEFAULT_UA = "PYQRobot/1.0 (+https://github.com/amanmehta1352/AlphaTestbookapp)"

def _mask_query(qs, secrets=("token", "key", "signature", "sig", "access_token")):
    if not qs:
        return ""
    pairs = []
    for k, v in qs.items():
        if any(k.lower().startswith(s) for s in secrets):
            pairs.append((k, "[REDACTED]"))
        else:
            pairs.append((k, v))
    return urlencode(pairs)

def _safe_url_base(url):
    parts = urlsplit(url.strip())
    if not parts.scheme or not parts.netloc:
        raise ValueError("URL must include scheme and netloc (e.g. https://example.com/path)")
    safe_path = "/".join(quote(seg, safe="") for seg in parts.path.split("/"))
    return urlunsplit((parts.scheme, parts.netloc, safe_path, "", parts.fragment)), dict(parse_qsl(parts.query, keep_blank_values=True))

def _build_session(retries=3, backoff_factor=0.3, status_forcelist=(429, 500, 502, 503, 504)):
    s = requests.Session()
    retry = Retry(
        total=retries,
        backoff_factor=backoff_factor,
        status_forcelist=status_forcelist,
        allowed_methods=frozenset(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s

def safe_request(
    url,
    params=None,
    headers=None,
    method="GET",
    timeout=30,
    stream=False,
    verify=True,
    retries=3,
    backoff_factor=0.3,
    raise_for_status=False,
    debug=False,
):
    """
    Make an HTTP request with safe path encoding and robust retries.

    - url: may include query string. If you pass params dict, those override or extend existing query params.
    - method: GET/POST/etc. For GET, do not pass data/json.
    - stream: set True for large downloads (use resp.iter_content).
    - Returns: requests.Response (caller must close if stream=True).
    - Raises ValueError for malformed URL; raises requests.RequestException on networking errors;
      raises RuntimeError including response body for 4xx/5xx if raise_for_status True.
    """
    method = method.upper()
    headers = dict(headers or {})
    headers.setdefault("User-Agent", DEFAULT_UA)

    base_url, existing_qs = _safe_url_base(url)
    merged_params = {**existing_qs, **(params or {})}

    session = _build_session(retries=retries, backoff_factor=backoff_factor)
    try:
        if debug:
            masked_qs = _mask_query(merged_params)
            print(f"safe_request: {method} {base_url}?{masked_qs}", flush=True)
            print("Headers:", {k: ("[REDACTED]" if k.lower() in ("authorization", "apikey") else v) for k, v in headers.items()}, flush=True)

        resp = session.request(
            method,
            base_url,
            params=merged_params if merged_params else None,
            headers=headers,
            timeout=timeout,
            stream=stream,
            verify=verify,
        )
        if raise_for_status and resp.status_code >= 400:
            try:
                body = resp.text[:1000]
            except Exception:
                body = "<unreadable response body>"
            raise RuntimeError(f"HTTP {resp.status_code}: {body}")
        return resp
    finally:
        session.close()

def safe_download_file(url, dest_path, params=None, headers=None, timeout=120, chunk_size=16 * 1024, verify=True, retries=3, backoff_factor=0.3, debug=False):
    """
    Download URL to dest_path using streaming. Performs safe encoding and retries.
    Raises RuntimeError with server body on non-200 responses.
    """
    resp = safe_request(
        url,
        params=params,
        headers=headers,
        method="GET",
        timeout=timeout,
        stream=True,
        verify=verify,
        retries=retries,
        backoff_factor=backoff_factor,
        raise_for_status=False,
        debug=debug,
    )
    try:
        if resp.status_code != 200:
            try:
                body = resp.text[:1000]
            except Exception:
                body = "<unreadable response body>"
            raise RuntimeError(f"Failed to download: HTTP {resp.status_code}: {body}")

        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
    finally:
        resp.close()
