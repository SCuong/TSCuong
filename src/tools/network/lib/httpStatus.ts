export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

export interface HttpStatus {
  code: number;
  name: string;
  /** One-line meaning. */
  summary: string;
  /** Longer usage notes. */
  details: string;
  /** Defining specification, e.g. "RFC 9110 §15.3.1". */
  spec: string;
  /** Not in the IANA registry (vendor-specific). */
  unofficial?: boolean;
  /** Registered but obsolete, reserved or not meant for use. */
  deprecated?: boolean;
}

export const STATUS_CLASSES: Array<{ id: StatusClass; name: string; description: string }> = [
  { id: '1xx', name: 'Informational', description: 'The request was received and processing continues.' },
  { id: '2xx', name: 'Success', description: 'The request was received, understood and accepted.' },
  { id: '3xx', name: 'Redirection', description: 'Further action is needed to complete the request.' },
  { id: '4xx', name: 'Client error', description: 'The request is wrong or cannot be fulfilled as sent.' },
  { id: '5xx', name: 'Server error', description: 'The server failed to fulfil a valid request.' },
];

/** Status codes that are heuristically cacheable by default (RFC 9110 §15.1). */
export const CACHEABLE_BY_DEFAULT = new Set([200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501]);

export const HTTP_STATUSES: HttpStatus[] = [
  {
    code: 100,
    name: 'Continue',
    summary: 'The headers were accepted; the client may send the request body.',
    details:
      'Sent in reply to a request carrying "Expect: 100-continue", so a client can check that a large upload will be accepted before transmitting it. Clients that did not ask for it simply ignore it.',
    spec: 'RFC 9110 §15.2.1',
  },
  {
    code: 101,
    name: 'Switching Protocols',
    summary: 'The server is switching to the protocol named in the Upgrade header.',
    details: 'Used most often to upgrade an HTTP/1.1 connection to WebSocket. The response includes an Upgrade header naming the new protocol, and the connection then speaks that protocol.',
    spec: 'RFC 9110 §15.2.2',
  },
  {
    code: 102,
    name: 'Processing',
    summary: 'WebDAV: the server is still working on a long request.',
    details: 'An interim response defined by WebDAV to stop clients from timing out. It is deprecated and rarely sent by modern servers.',
    spec: 'RFC 2518 §10.1',
    deprecated: true,
  },
  {
    code: 103,
    name: 'Early Hints',
    summary: 'Preliminary headers (usually Link preloads) sent before the final response.',
    details:
      'Lets a server tell the browser to start preloading or preconnecting (via Link headers) while it is still generating the real response. Browsers only act on hints for navigation requests.',
    spec: 'RFC 8297',
  },
  {
    code: 200,
    name: 'OK',
    summary: 'The request succeeded.',
    details: 'The standard success response. The body depends on the method: the resource for GET, only headers for HEAD, the result of the action for POST.',
    spec: 'RFC 9110 §15.3.1',
  },
  {
    code: 201,
    name: 'Created',
    summary: 'The request succeeded and created a new resource.',
    details: 'Typical reply to a POST or PUT that creates something. Include a Location header pointing at the new resource, and optionally a representation of it in the body.',
    spec: 'RFC 9110 §15.3.2',
  },
  {
    code: 202,
    name: 'Accepted',
    summary: 'The request was accepted for processing, which has not finished yet.',
    details: 'Use for asynchronous work such as queued jobs. The response usually points to a status endpoint the client can poll. It makes no promise that the work will succeed.',
    spec: 'RFC 9110 §15.3.3',
  },
  {
    code: 203,
    name: 'Non-Authoritative Information',
    summary: 'Success, but a proxy modified the origin server’s response.',
    details: 'Sent by a transforming proxy to signal that the payload differs from what the origin returned. Rare in practice.',
    spec: 'RFC 9110 §15.3.4',
  },
  {
    code: 204,
    name: 'No Content',
    summary: 'Success with no response body.',
    details: 'Common for DELETE, PUT or PATCH when there is nothing useful to return. The response must not contain a body. Browsers stay on the current page for form submissions answered with 204.',
    spec: 'RFC 9110 §15.3.5',
  },
  {
    code: 205,
    name: 'Reset Content',
    summary: 'Success; the client should reset the document view (e.g. clear the form).',
    details: 'Tells the user agent to reset the form or view that caused the request. Has no body. Seldom used.',
    spec: 'RFC 9110 §15.3.6',
  },
  {
    code: 206,
    name: 'Partial Content',
    summary: 'Only the requested byte range is returned.',
    details: 'The answer to a request with a Range header, used for resumable downloads and media seeking. Includes Content-Range (or a multipart/byteranges body for several ranges).',
    spec: 'RFC 9110 §15.3.7',
  },
  {
    code: 207,
    name: 'Multi-Status',
    summary: 'WebDAV: the body contains separate status codes for several resources.',
    details: 'Returns an XML document with a status for each affected resource, used by WebDAV operations that touch multiple items.',
    spec: 'RFC 4918 §11.1',
  },
  {
    code: 208,
    name: 'Already Reported',
    summary: 'WebDAV: members of this binding were already listed earlier in the response.',
    details: 'Used inside a 207 response to avoid listing the same resource repeatedly when bindings create cycles.',
    spec: 'RFC 5842 §7.1',
  },
  {
    code: 226,
    name: 'IM Used',
    summary: 'The response is the result of instance manipulations (delta encoding).',
    details: 'Defined for HTTP delta encoding: the server applied the manipulations listed in the IM header. Almost never seen in practice.',
    spec: 'RFC 3229 §10.4.1',
  },
  {
    code: 300,
    name: 'Multiple Choices',
    summary: 'Several representations are available; the client may pick one.',
    details: 'Rarely used because there is no standard way to choose automatically. A Location header can name the server’s preferred choice.',
    spec: 'RFC 9110 §15.4.1',
  },
  {
    code: 301,
    name: 'Moved Permanently',
    summary: 'The resource has a new permanent URL, given in Location.',
    details:
      'Search engines transfer ranking to the new URL and clients may update bookmarks. For historical reasons, clients may change a POST into a GET when following it; use 308 when the method must be kept.',
    spec: 'RFC 9110 §15.4.2',
  },
  {
    code: 302,
    name: 'Found',
    summary: 'The resource is temporarily at another URL, given in Location.',
    details: 'A temporary redirect. Like 301, clients may switch POST to GET when following it. Use 303 to force GET, or 307 to keep the method.',
    spec: 'RFC 9110 §15.4.3',
  },
  {
    code: 303,
    name: 'See Other',
    summary: 'Get the result from another URL with a GET request.',
    details: 'The classic "Post/Redirect/Get" response: after a form POST, redirect to a page that shows the result so refreshing does not resubmit the form. The follow-up request always uses GET.',
    spec: 'RFC 9110 §15.4.4',
  },
  {
    code: 304,
    name: 'Not Modified',
    summary: 'The cached copy is still valid; no body is sent.',
    details: 'The reply to a conditional request (If-None-Match or If-Modified-Since) when the resource has not changed. The client reuses its cached copy, saving bandwidth.',
    spec: 'RFC 9110 §15.4.5',
  },
  {
    code: 305,
    name: 'Use Proxy',
    summary: 'Deprecated: access the resource through a proxy.',
    details: 'Deprecated for security reasons; clients do not honour it.',
    spec: 'RFC 9110 §15.4.6',
    deprecated: true,
  },
  {
    code: 306,
    name: '(Unused)',
    summary: 'Reserved. Was “Switch Proxy” in an early draft.',
    details: 'This code is no longer used and is reserved.',
    spec: 'RFC 9110 §15.4.7',
    deprecated: true,
  },
  {
    code: 307,
    name: 'Temporary Redirect',
    summary: 'Temporarily at another URL; repeat the request with the same method and body.',
    details: 'Unlike 302, the client must not change the method, so a POST stays a POST. Also used by browsers internally for HSTS upgrades.',
    spec: 'RFC 9110 §15.4.8',
  },
  {
    code: 308,
    name: 'Permanent Redirect',
    summary: 'Permanently moved; repeat the request with the same method and body.',
    details: 'The method-preserving counterpart of 301. Use it for permanent API moves where POST/PUT requests must keep working.',
    spec: 'RFC 9110 §15.4.9',
  },
  {
    code: 400,
    name: 'Bad Request',
    summary: 'The server cannot process the request because it is malformed.',
    details: 'Use for syntax errors, invalid framing or parameters that cannot be parsed. For well-formed input that fails validation, many APIs prefer 422.',
    spec: 'RFC 9110 §15.5.1',
  },
  {
    code: 401,
    name: 'Unauthorized',
    summary: 'Authentication is required or the credentials are invalid.',
    details: 'Despite the name, it means "unauthenticated". The response must include a WWW-Authenticate header describing how to authenticate. Use 403 when the user is known but not allowed.',
    spec: 'RFC 9110 §15.5.2',
  },
  {
    code: 402,
    name: 'Payment Required',
    summary: 'Reserved for future use; sometimes used for billing or quota errors.',
    details: 'No standard semantics are defined. Some APIs use it when a subscription or payment is needed.',
    spec: 'RFC 9110 §15.5.3',
  },
  {
    code: 403,
    name: 'Forbidden',
    summary: 'The server understood the request but refuses to allow it.',
    details: 'The client’s identity is known (or irrelevant) and it lacks permission. Re-authenticating will not help. Servers may use 404 instead to hide that the resource exists.',
    spec: 'RFC 9110 §15.5.4',
  },
  {
    code: 404,
    name: 'Not Found',
    summary: 'The server has no resource at this URL.',
    details: 'The most familiar error. It does not say whether the absence is temporary or permanent; use 410 when a resource was deliberately removed.',
    spec: 'RFC 9110 §15.5.5',
  },
  {
    code: 405,
    name: 'Method Not Allowed',
    summary: 'The resource exists but does not support this HTTP method.',
    details: 'For example a POST to a read-only endpoint. The response must include an Allow header listing the supported methods.',
    spec: 'RFC 9110 §15.5.6',
  },
  {
    code: 406,
    name: 'Not Acceptable',
    summary: 'No representation matches the request’s Accept headers.',
    details: 'Returned when content negotiation fails, e.g. the client only accepts XML but the server only produces JSON. Many servers ignore Accept and send a default instead.',
    spec: 'RFC 9110 §15.5.7',
  },
  {
    code: 407,
    name: 'Proxy Authentication Required',
    summary: 'The client must authenticate with the proxy.',
    details: 'Like 401 but for a proxy; the proxy sends a Proxy-Authenticate header and the client answers with Proxy-Authorization.',
    spec: 'RFC 9110 §15.5.8',
  },
  {
    code: 408,
    name: 'Request Timeout',
    summary: 'The server gave up waiting for the client to finish sending the request.',
    details: 'Often sent on idle keep-alive connections before closing them. Clients may retry the request on a new connection.',
    spec: 'RFC 9110 §15.5.9',
  },
  {
    code: 409,
    name: 'Conflict',
    summary: 'The request conflicts with the current state of the resource.',
    details: 'Typical for edit conflicts, version mismatches or trying to create something that already exists. The body should explain how to resolve the conflict.',
    spec: 'RFC 9110 §15.5.10',
  },
  {
    code: 410,
    name: 'Gone',
    summary: 'The resource was removed permanently and will not return.',
    details: 'A stronger 404: tells clients and search engines to forget the URL. Useful for expired content or retired API versions.',
    spec: 'RFC 9110 §15.5.11',
  },
  {
    code: 411,
    name: 'Length Required',
    summary: 'The request must include a Content-Length header.',
    details: 'Sent by servers that refuse chunked or unknown-length request bodies.',
    spec: 'RFC 9110 §15.5.12',
  },
  {
    code: 412,
    name: 'Precondition Failed',
    summary: 'A conditional header such as If-Match did not match.',
    details: 'Used for optimistic concurrency: the client sends If-Match with the ETag it last saw, and the server rejects the update if someone else changed the resource first.',
    spec: 'RFC 9110 §15.5.13',
  },
  {
    code: 413,
    name: 'Content Too Large',
    summary: 'The request body is larger than the server allows.',
    details: 'Formerly "Payload Too Large". Common for oversized uploads. A Retry-After header may be included if the condition is temporary.',
    spec: 'RFC 9110 §15.5.14',
  },
  {
    code: 414,
    name: 'URI Too Long',
    summary: 'The URL is longer than the server will process.',
    details: 'Often caused by huge query strings; move the data into a POST body instead.',
    spec: 'RFC 9110 §15.5.15',
  },
  {
    code: 415,
    name: 'Unsupported Media Type',
    summary: 'The request body’s format is not supported.',
    details: 'For example sending XML to an endpoint that only accepts JSON, or forgetting the Content-Type header. An Accept or Accept-Post header can list the supported types.',
    spec: 'RFC 9110 §15.5.16',
  },
  {
    code: 416,
    name: 'Range Not Satisfiable',
    summary: 'The requested byte range lies outside the resource.',
    details: 'The response should include Content-Range: bytes */<length> so the client learns the actual size.',
    spec: 'RFC 9110 §15.5.17',
  },
  {
    code: 417,
    name: 'Expectation Failed',
    summary: 'The server cannot meet the request’s Expect header.',
    details: 'Usually means the server does not support "Expect: 100-continue"; retry without the header.',
    spec: 'RFC 9110 §15.5.18',
  },
  {
    code: 418,
    name: '(Unused) I’m a teapot',
    summary: 'An April Fools’ joke from the Hyper Text Coffee Pot Control Protocol; reserved.',
    details: 'Originally defined in RFC 2324 (1998). RFC 9110 reserves 418 because it is widely implemented as an easter egg, but it has no real HTTP meaning and should not be used for actual errors.',
    spec: 'RFC 9110 §15.5.19 (RFC 2324)',
    deprecated: true,
  },
  {
    code: 421,
    name: 'Misdirected Request',
    summary: 'The request reached a server that cannot answer for this host.',
    details: 'Happens with connection reuse in HTTP/2 when a connection is shared across host names the server is not configured for. Clients retry on a new connection.',
    spec: 'RFC 9110 §15.5.20',
  },
  {
    code: 422,
    name: 'Unprocessable Content',
    summary: 'The request is well-formed but its content fails validation.',
    details: 'Widely used by APIs for semantic validation errors (e.g. a missing required field), while 400 covers syntax errors. Originally from WebDAV as "Unprocessable Entity".',
    spec: 'RFC 9110 §15.5.21',
  },
  {
    code: 423,
    name: 'Locked',
    summary: 'WebDAV: the resource is locked.',
    details: 'The target resource is locked and the request did not provide the lock token.',
    spec: 'RFC 4918 §11.3',
  },
  {
    code: 424,
    name: 'Failed Dependency',
    summary: 'WebDAV: the request failed because a related request failed.',
    details: 'Used within multi-part WebDAV operations when one action depends on another that did not succeed.',
    spec: 'RFC 4918 §11.4',
  },
  {
    code: 425,
    name: 'Too Early',
    summary: 'The server will not process a request that might be replayed.',
    details: 'Relates to TLS 1.3 early data (0-RTT): the server asks the client to retry after the handshake completes, to avoid replay attacks.',
    spec: 'RFC 8470 §5.2',
  },
  {
    code: 426,
    name: 'Upgrade Required',
    summary: 'The client must switch to a different protocol.',
    details: 'The response includes an Upgrade header naming the required protocol, e.g. a newer TLS or HTTP version.',
    spec: 'RFC 9110 §15.5.22',
  },
  {
    code: 428,
    name: 'Precondition Required',
    summary: 'The server requires the request to be conditional.',
    details: 'Forces clients to send If-Match (or similar) on updates, preventing lost updates when two clients edit the same resource.',
    spec: 'RFC 6585 §3',
  },
  {
    code: 429,
    name: 'Too Many Requests',
    summary: 'The client has sent too many requests (rate limited).',
    details: 'Include a Retry-After header telling the client how long to wait. Many APIs also send rate-limit headers describing the quota.',
    spec: 'RFC 6585 §4',
  },
  {
    code: 431,
    name: 'Request Header Fields Too Large',
    summary: 'A single header or all headers together are too large.',
    details: 'Often caused by oversized cookies. Clearing cookies for the site usually fixes it for browsers.',
    spec: 'RFC 6585 §5',
  },
  {
    code: 451,
    name: 'Unavailable For Legal Reasons',
    summary: 'Access is denied because of a legal demand.',
    details: 'For example content blocked in a jurisdiction by court order. The number references the novel Fahrenheit 451. A Link header with rel="blocked-by" can identify the blocking entity.',
    spec: 'RFC 7725 §3',
  },
  {
    code: 500,
    name: 'Internal Server Error',
    summary: 'The server hit an unexpected condition.',
    details: 'A generic catch-all for unhandled exceptions and bugs. Check the server logs; clients cannot fix it by changing the request.',
    spec: 'RFC 9110 §15.6.1',
  },
  {
    code: 501,
    name: 'Not Implemented',
    summary: 'The server does not support the functionality needed, e.g. an unknown method.',
    details: 'Unlike 405 (method not allowed on this resource), 501 means the server does not recognise the method at all.',
    spec: 'RFC 9110 §15.6.2',
  },
  {
    code: 502,
    name: 'Bad Gateway',
    summary: 'A gateway or proxy got an invalid response from the upstream server.',
    details: 'Typical when a reverse proxy cannot reach the application server, or the app crashed mid-response.',
    spec: 'RFC 9110 §15.6.3',
  },
  {
    code: 503,
    name: 'Service Unavailable',
    summary: 'The server is temporarily unable to handle the request.',
    details: 'Used for maintenance windows or overload. Add a Retry-After header when you know when service will resume.',
    spec: 'RFC 9110 §15.6.4',
  },
  {
    code: 504,
    name: 'Gateway Timeout',
    summary: 'A gateway or proxy did not get a timely response from upstream.',
    details: 'The upstream server took too long. Look for slow queries or increase proxy timeouts carefully.',
    spec: 'RFC 9110 §15.6.5',
  },
  {
    code: 505,
    name: 'HTTP Version Not Supported',
    summary: 'The server does not support the HTTP version used.',
    details: 'Rare in practice; clients normally negotiate a supported version.',
    spec: 'RFC 9110 §15.6.6',
  },
  {
    code: 506,
    name: 'Variant Also Negotiates',
    summary: 'A server configuration error in transparent content negotiation.',
    details: 'The chosen variant is itself configured to negotiate, creating a loop. Experimental and very rare.',
    spec: 'RFC 2295 §8.1',
  },
  {
    code: 507,
    name: 'Insufficient Storage',
    summary: 'WebDAV: the server cannot store the representation.',
    details: 'The server is out of space to complete the request.',
    spec: 'RFC 4918 §11.5',
  },
  {
    code: 508,
    name: 'Loop Detected',
    summary: 'WebDAV: the server found an infinite loop while processing.',
    details: 'Sent when a request with "Depth: infinity" runs into a binding cycle.',
    spec: 'RFC 5842 §7.2',
  },
  {
    code: 510,
    name: 'Not Extended',
    summary: 'Further extensions to the request are required (obsolete).',
    details: 'From the HTTP Extension Framework, which is now historic. Marked obsolete in the IANA registry.',
    spec: 'RFC 2774 §7',
    deprecated: true,
  },
  {
    code: 511,
    name: 'Network Authentication Required',
    summary: 'The client must authenticate to gain network access.',
    details: 'Sent by captive portals (hotel or airport Wi-Fi) that intercept traffic until the user logs in or accepts terms.',
    spec: 'RFC 6585 §6',
  },
  // Common, but not registered with IANA.
  {
    code: 499,
    name: 'Client Closed Request',
    summary: 'nginx: the client closed the connection before the server answered.',
    details: 'Only appears in nginx logs; it is never sent to the client because the client already went away.',
    spec: 'nginx (unofficial)',
    unofficial: true,
  },
  {
    code: 520,
    name: 'Web Server Returned an Unknown Error',
    summary: 'Cloudflare: the origin returned an empty, unknown or unexpected response.',
    details: 'A proxy-specific catch-all used by Cloudflare. Check the origin server logs.',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
  {
    code: 521,
    name: 'Web Server Is Down',
    summary: 'Cloudflare: the origin server refused the connection.',
    details: 'The CDN could not connect to the origin at all, often because the server is down or a firewall blocks the CDN.',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
  {
    code: 522,
    name: 'Connection Timed Out',
    summary: 'Cloudflare: the TCP connection to the origin timed out.',
    details: 'The origin did not complete the TCP handshake in time.',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
  {
    code: 523,
    name: 'Origin Is Unreachable',
    summary: 'Cloudflare: the origin could not be reached (e.g. DNS or routing problems).',
    details: 'Often caused by incorrect DNS records pointing at the origin.',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
  {
    code: 524,
    name: 'A Timeout Occurred',
    summary: 'Cloudflare: the origin accepted the connection but did not respond in time.',
    details: 'The HTTP response took longer than the proxy’s timeout (100 seconds by default).',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
  {
    code: 525,
    name: 'SSL Handshake Failed',
    summary: 'Cloudflare: the TLS handshake with the origin failed.',
    details: 'Usually a certificate or cipher mismatch between the CDN and the origin.',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
  {
    code: 526,
    name: 'Invalid SSL Certificate',
    summary: 'Cloudflare: the origin’s certificate could not be validated.',
    details: 'Happens in strict TLS mode when the origin certificate is expired, self-signed or for the wrong host.',
    spec: 'Cloudflare (unofficial)',
    unofficial: true,
  },
].sort((a, b) => a.code - b.code);

export function statusClass(code: number): StatusClass {
  return `${Math.floor(code / 100)}xx` as StatusClass;
}

/** How redirects treat the request method. */
export function redirectMethodNote(code: number): string | null {
  switch (code) {
    case 301:
    case 302:
      return 'Clients may change POST to GET when following this redirect.';
    case 303:
      return 'The follow-up request always uses GET (or HEAD).';
    case 307:
    case 308:
      return 'The method and body are preserved when following this redirect.';
    default:
      return null;
  }
}

export interface StatusFilter {
  query: string;
  group: StatusClass | 'all';
}

/** Filters statuses by class and a free-text query (a number prefix or words). */
export function filterStatuses(list: HttpStatus[], { query, group }: StatusFilter): HttpStatus[] {
  const q = query.trim().toLowerCase();
  return list.filter((s) => {
    if (group !== 'all' && statusClass(s.code) !== group) return false;
    if (!q) return true;
    if (/^\d{1,3}$/.test(q)) return String(s.code).startsWith(q);
    if (/^[1-5]xx$/.test(q)) return statusClass(s.code) === q;
    const words = q.split(/\s+/);
    const hay = `${s.code} ${s.name} ${s.summary} ${s.details} ${s.spec}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
