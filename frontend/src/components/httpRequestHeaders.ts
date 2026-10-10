export interface HttpHeaderSuggestion {
  name: string;
  /** What the header is for, shown beside the name. */
  detail: string;
}

/**
 * HTTP request headers offered in the request editor's header-name combo box: the standard request
 * headers (RFC 9110 and the IANA message-header registry's common entries) plus widely used
 * conventional `X-` and `Idempotency-Key` style headers. It is a list of suggestions, not a
 * whitelist: any header name can still be typed, and nothing is validated against it.
 */
export const HTTP_REQUEST_HEADERS: readonly HttpHeaderSuggestion[] = [
  { name: "Accept", detail: "Media types the client accepts" },
  { name: "Accept-Charset", detail: "Character sets the client accepts" },
  { name: "Accept-Encoding", detail: "Content encodings the client accepts" },
  { name: "Accept-Language", detail: "Languages the client prefers" },
  { name: "Access-Control-Request-Headers", detail: "CORS preflight: headers the request will use" },
  { name: "Access-Control-Request-Method", detail: "CORS preflight: method the request will use" },
  { name: "Authorization", detail: "Credentials for the server" },
  { name: "Cache-Control", detail: "Caching directives" },
  { name: "Connection", detail: "Connection options" },
  { name: "Content-Disposition", detail: "How the body should be handled" },
  { name: "Content-Encoding", detail: "Encoding applied to the body" },
  { name: "Content-Language", detail: "Language of the body" },
  { name: "Content-Length", detail: "Size of the body in bytes" },
  { name: "Content-Location", detail: "Location of the body's resource" },
  { name: "Content-Type", detail: "Media type of the body" },
  { name: "Cookie", detail: "Cookies stored for the server" },
  { name: "Date", detail: "When the message was sent" },
  { name: "DNT", detail: "Do Not Track preference" },
  { name: "Expect", detail: "Behaviour the server must support" },
  { name: "Forwarded", detail: "Proxy-added client information" },
  { name: "From", detail: "Email address of the requester" },
  { name: "Host", detail: "Host and port of the server" },
  { name: "Idempotency-Key", detail: "Makes a POST safe to retry" },
  { name: "If-Match", detail: "Conditional on a matching ETag" },
  { name: "If-Modified-Since", detail: "Conditional on a change since a date" },
  { name: "If-None-Match", detail: "Conditional on no matching ETag" },
  { name: "If-Range", detail: "Conditional range request" },
  { name: "If-Unmodified-Since", detail: "Conditional on no change since a date" },
  { name: "Max-Forwards", detail: "Limit on proxy hops (TRACE, OPTIONS)" },
  { name: "Origin", detail: "Origin that started the request (CORS)" },
  { name: "Pragma", detail: "Legacy caching directive" },
  { name: "Prefer", detail: "Preferred server behaviour" },
  { name: "Proxy-Authorization", detail: "Credentials for a proxy" },
  { name: "Range", detail: "Part of the resource wanted" },
  { name: "Referer", detail: "Address of the previous page" },
  { name: "TE", detail: "Transfer encodings the client accepts" },
  { name: "Trailer", detail: "Fields sent after the body" },
  { name: "Transfer-Encoding", detail: "Encoding used to transfer the body" },
  { name: "Upgrade", detail: "Ask to switch protocols" },
  { name: "User-Agent", detail: "Client software identifier" },
  { name: "Via", detail: "Proxies the request passed through" },
  { name: "Warning", detail: "Information about possible problems" },
  { name: "X-API-Key", detail: "API key (convention)" },
  { name: "X-Correlation-ID", detail: "Traces a request across services (convention)" },
  { name: "X-CSRF-Token", detail: "Cross-site request forgery token (convention)" },
  { name: "X-Forwarded-For", detail: "Original client address behind a proxy" },
  { name: "X-Forwarded-Host", detail: "Original host behind a proxy" },
  { name: "X-Forwarded-Proto", detail: "Original protocol behind a proxy" },
  { name: "X-HTTP-Method-Override", detail: "Override the request method (convention)" },
  { name: "X-Request-ID", detail: "Identifies one request (convention)" },
  { name: "X-Requested-With", detail: "Marks an AJAX request (convention)" },
];
